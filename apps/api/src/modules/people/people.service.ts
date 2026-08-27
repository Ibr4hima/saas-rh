import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type {
  ArchiveEmployeesInput,
  AssignmentView,
  CreateEmployeeInput,
  CursorPage,
  DeleteEmployeesInput,
  EmployeeBatchResult,
  EmployeeDetail,
  EmployeeHistoryEntry,
  EmployeeListItem,
  ListEmployeesQuery,
  NewAssignmentInput,
  SessionUser,
  UpdateEmployeeInput,
} from '@teranga/contracts';
import { EncryptionService } from '../../common/encryption.service';
import { problem } from '../../common/problem';
import * as t from '../../db/schema';
import { TenantDb, Tx } from '../../db/tenant-db';

/** Rôles autorisés à lire les champs ultra-sensibles (CNI). */
const SENSITIVE_ROLES = new Set(['admin', 'hr']);

function ctxOf(user: SessionUser): { tenantId: string; userId: string } {
  return { tenantId: user.tenantId, userId: user.userId };
}

function pgCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code ?? e?.cause?.code;
}

interface Cursor {
  createdAt: string;
  id: string;
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}

function decodeCursor(raw: string): Cursor {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Cursor;
    if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string') throw new Error();
    return parsed;
  } catch {
    problem(400, 'pagination.invalid_cursor', 'Curseur de pagination invalide');
  }
}

@Injectable()
export class PeopleService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(EncryptionService) private readonly crypto: EncryptionService,
  ) {}

  async list(user: SessionUser, query: ListEmployeesQuery): Promise<CursorPage<EmployeeListItem>> {
    return this.db.withTenant(ctxOf(user), async (tx) => {
      const conditions = [];
      if (query.status) conditions.push(eq(t.employees.status, query.status));
      if (query.q) {
        const like = `%${query.q}%`;
        conditions.push(
          sql`(${t.persons.givenName} ILIKE ${like}
            OR ${t.persons.familyName} ILIKE ${like}
            OR ${t.employees.employeeNumber} ILIKE ${like})`,
        );
      }
      if (query.cursor) {
        const c = decodeCursor(query.cursor);
        conditions.push(
          sql`(${t.employees.createdAt}, ${t.employees.id}) < (${new Date(c.createdAt)}, ${c.id}::uuid)`,
        );
      }

      const rows = await tx
        .select({
          id: t.employees.id,
          employeeNumber: t.employees.employeeNumber,
          givenName: t.persons.givenName,
          familyName: t.persons.familyName,
          status: t.employees.status,
          hiredOn: t.employees.hiredOn,
          workEmail: t.employees.workEmail,
          positionTitle: t.assignments.positionTitle,
          orgUnitName: t.orgUnits.name,
          // La direction de rattachement se trouve en REMONTANT l'arbre : un
          // agent affecté à un service relève de la direction qui le coiffe.
          // Les colonnes de la table externe sont qualifiées à la main —
          // Drizzle les rendrait nues et la portée interne les capterait.
          directionShortName: sql<string | null>`(
            WITH RECURSIVE remontee AS (
              SELECT id, parent_id, unit_type, short_name, name
              FROM org_units WHERE id = assignments.org_unit_id
              UNION ALL
              SELECT o.id, o.parent_id, o.unit_type, o.short_name, o.name
              FROM org_units o JOIN remontee r ON o.id = r.parent_id
            )
            SELECT short_name FROM remontee WHERE unit_type = 'direction' LIMIT 1)`,
          directionName: sql<string | null>`(
            WITH RECURSIVE remontee AS (
              SELECT id, parent_id, unit_type, name
              FROM org_units WHERE id = assignments.org_unit_id
              UNION ALL
              SELECT o.id, o.parent_id, o.unit_type, o.name
              FROM org_units o JOIN remontee r ON o.id = r.parent_id
            )
            SELECT name FROM remontee WHERE unit_type = 'direction' LIMIT 1)`,
          // Contrat le plus récent, même convention que la fiche employé.
          contractStartDate: sql<string | null>`(
            SELECT c.start_date::text FROM contracts c
            WHERE c.employee_id = employees.id
            ORDER BY c.start_date DESC LIMIT 1)`,
          contractEndDate: sql<string | null>`(
            SELECT c.end_date::text FROM contracts c
            WHERE c.employee_id = employees.id
            ORDER BY c.start_date DESC LIMIT 1)`,
          managerId: t.employees.managerEmployeeId,
          managerName: sql<string | null>`(
            SELECT mp.given_name || ' ' || mp.family_name
            FROM employees me JOIN persons mp ON mp.id = me.person_id
            WHERE me.id = employees.manager_employee_id)`,
          createdAt: t.employees.createdAt,
        })
        .from(t.employees)
        .innerJoin(t.persons, eq(t.persons.id, t.employees.personId))
        .leftJoin(
          t.assignments,
          and(
            eq(t.assignments.employeeId, t.employees.id),
            sql`${t.assignments.validity} @> CURRENT_DATE`,
          ),
        )
        .leftJoin(t.orgUnits, eq(t.orgUnits.id, t.assignments.orgUnitId))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(t.employees.createdAt), desc(t.employees.id))
        .limit(query.limit + 1);

      const hasMore = rows.length > query.limit;
      const page = hasMore ? rows.slice(0, query.limit) : rows;
      const last = page[page.length - 1];
      return {
        items: page.map((r) => ({
          id: r.id,
          employeeNumber: r.employeeNumber,
          givenName: r.givenName,
          familyName: r.familyName,
          status: r.status,
          hiredOn: r.hiredOn,
          workEmail: r.workEmail,
          positionTitle: r.positionTitle ?? null,
          orgUnitName: r.orgUnitName ?? null,
          directionShortName: r.directionShortName ?? null,
          directionName: r.directionName ?? null,
          contractStartDate: r.contractStartDate ?? null,
          contractEndDate: r.contractEndDate ?? null,
          managerId: r.managerId ?? null,
          managerName: r.managerName ?? null,
        })),
        nextCursor:
          hasMore && last
            ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
            : null,
      };
    });
  }

  async create(user: SessionUser, input: CreateEmployeeInput): Promise<{ id: string }> {
    const employeeId = uuidv7();
    const personId = uuidv7();

    try {
      await this.db.withTenant(ctxOf(user), async (tx) => {
        const { nationalId, ...person } = input.person;
        await tx.insert(t.persons).values({
          id: personId,
          tenantId: user.tenantId,
          ...person,
          nationalIdEncrypted: nationalId ? this.crypto.encrypt(nationalId) : null,
        });
        if (input.employee.managerEmployeeId) {
          await this.assertManagerValid(tx, employeeId, input.employee.managerEmployeeId);
        }
        await tx.insert(t.employees).values({
          id: employeeId,
          tenantId: user.tenantId,
          personId,
          employeeNumber: input.employee.employeeNumber,
          hiredOn: input.employee.hiredOn,
          workEmail: input.employee.workEmail,
          workPhone: input.employee.workPhone,
          managerEmployeeId: input.employee.managerEmployeeId ?? null,
          customFields: input.employee.customFields ?? {},
        });
        if (input.contract) {
          await tx.insert(t.contracts).values({
            id: uuidv7(),
            tenantId: user.tenantId,
            employeeId,
            contractType: input.contract.contractType,
            startDate: input.contract.startDate,
            endDate: input.contract.endDate,
            trialPeriodEnd: input.contract.trialPeriodEnd,
            notes: input.contract.notes,
          });
        }
        if (input.assignment) {
          if (input.assignment.orgUnitId) {
            await this.requireLiveOrgUnit(tx, input.assignment.orgUnitId);
          }
          await tx.insert(t.assignments).values({
            id: uuidv7(),
            tenantId: user.tenantId,
            employeeId,
            orgUnitId: input.assignment.orgUnitId,
            positionTitle: input.assignment.positionTitle,
            validity: `[${input.assignment.startDate},)`,
          });
        }
      });
    } catch (err) {
      if (pgCode(err) === '23505') {
        problem(409, 'people.employee_number_taken', 'Ce matricule est déjà utilisé');
      }
      throw err;
    }
    return { id: employeeId };
  }

  async detail(user: SessionUser, id: string): Promise<EmployeeDetail> {
    return this.db.withTenant(ctxOf(user), async (tx) => {
      const employee = await this.requireEmployee(tx, id);
      const [person] = await tx
        .select()
        .from(t.persons)
        .where(eq(t.persons.id, employee.personId))
        .limit(1);
      if (!person) {
        problem(500, 'people.person_missing', 'Dossier incohérent : personne absente');
      }

      // Périmètre : les gestionnaires voient tout ; les autres, leur dossier.
      const isManage = ['admin', 'hr', 'payroll'].includes(user.role);
      const isSelf = person.userId === user.userId;
      if (!isManage && !isSelf) {
        problem(403, 'people.forbidden_scope', 'Accès limité à votre propre dossier');
      }

      const assignmentRows = await tx
        .select({
          id: t.assignments.id,
          positionTitle: t.assignments.positionTitle,
          orgUnitId: t.assignments.orgUnitId,
          orgUnitName: t.orgUnits.name,
          validity: t.assignments.validity,
          current: sql<boolean>`${t.assignments.validity} @> CURRENT_DATE`,
          validFrom: sql<string>`lower(${t.assignments.validity})::text`,
          validTo: sql<string | null>`CASE WHEN upper_inf(${t.assignments.validity})
            THEN NULL ELSE upper(${t.assignments.validity})::text END`,
        })
        .from(t.assignments)
        .leftJoin(t.orgUnits, eq(t.orgUnits.id, t.assignments.orgUnitId))
        .where(eq(t.assignments.employeeId, id))
        .orderBy(desc(sql`lower(${t.assignments.validity})`));

      const contractRows = await tx
        .select()
        .from(t.contracts)
        .where(eq(t.contracts.employeeId, id))
        .orderBy(desc(t.contracts.startDate));

      const [managerRow] = employee.managerEmployeeId
        ? await tx
            .select({ givenName: t.persons.givenName, familyName: t.persons.familyName })
            .from(t.employees)
            .innerJoin(t.persons, eq(t.persons.id, t.employees.personId))
            .where(eq(t.employees.id, employee.managerEmployeeId))
            .limit(1)
        : [];

      const canSeeSensitive = SENSITIVE_ROLES.has(user.role) || isSelf;
      return {
        id: employee.id,
        employeeNumber: employee.employeeNumber,
        status: employee.status,
        archivedAt: employee.archivedAt?.toISOString() ?? null,
        hiredOn: employee.hiredOn,
        workEmail: employee.workEmail,
        workPhone: employee.workPhone,
        managerId: employee.managerEmployeeId,
        managerName: managerRow ? `${managerRow.givenName} ${managerRow.familyName}` : null,
        customFields: (employee.customFields ?? {}) as Record<string, unknown>,
        person: {
          id: person.id,
          givenName: person.givenName,
          familyName: person.familyName,
          gender: person.gender,
          birthDate: person.birthDate,
          birthPlace: person.birthPlace,
          maritalStatus: person.maritalStatus,
          nationality: person.nationality,
          nationalId:
            canSeeSensitive && person.nationalIdEncrypted
              ? this.crypto.decrypt(person.nationalIdEncrypted)
              : null,
          idDocumentType: person.idDocumentType,
          idDocumentIssuedOn: person.idDocumentIssuedOn,
          idDocumentExpiresOn: person.idDocumentExpiresOn,
          personalEmail: person.personalEmail,
          phone: person.phone,
          addressLine: person.addressLine,
          city: person.city,
          emergencyContactName: person.emergencyContactName,
          emergencyContactPhone: person.emergencyContactPhone,
        },
        assignments: assignmentRows.map((a): AssignmentView => ({
          id: a.id,
          positionTitle: a.positionTitle,
          orgUnitId: a.orgUnitId,
          orgUnitName: a.orgUnitName,
          validFrom: a.validFrom,
          validTo: a.validTo,
          current: a.current,
        })),
        contracts: contractRows.map((c) => ({
          id: c.id,
          contractType: c.contractType,
          startDate: c.startDate,
          endDate: c.endDate,
          trialPeriodEnd: c.trialPeriodEnd,
          notes: c.notes,
        })),
        portal: await this.portalStatus(tx, user.tenantId, person.id, person.userId),
      };
    });
  }

  /** Statut d'accès au portail : compte actif, invitation en cours, ou rien. */
  private async portalStatus(
    tx: Tx,
    tenantId: string,
    personId: string,
    personUserId: string | null,
  ): Promise<{ status: 'none' | 'invited' | 'active'; role: string | null }> {
    if (personUserId) {
      const [membership] = await tx
        .select({ role: t.userTenantMemberships.role })
        .from(t.userTenantMemberships)
        .where(
          and(
            eq(t.userTenantMemberships.userId, personUserId),
            eq(t.userTenantMemberships.tenantId, tenantId),
          ),
        )
        .limit(1);
      return { status: 'active', role: membership?.role ?? null };
    }
    const [pending] = await tx
      .select({ role: t.invitations.role })
      .from(t.invitations)
      .where(
        and(
          eq(t.invitations.personId, personId),
          isNull(t.invitations.acceptedAt),
          gt(t.invitations.expiresAt, new Date()),
        ),
      )
      .limit(1);
    return pending ? { status: 'invited', role: pending.role } : { status: 'none', role: null };
  }

  async update(user: SessionUser, id: string, input: UpdateEmployeeInput): Promise<void> {
    try {
      await this.db.withTenant(ctxOf(user), async (tx) => {
        const employee = await this.requireEmployee(tx, id);

        if (input.person && Object.keys(input.person).length > 0) {
          const { nationalId, ...rest } = input.person;
          await tx
            .update(t.persons)
            .set({
              ...rest,
              ...(nationalId !== undefined
                ? { nationalIdEncrypted: nationalId ? this.crypto.encrypt(nationalId) : null }
                : {}),
            })
            .where(eq(t.persons.id, employee.personId));
        }
        if (input.employee && Object.keys(input.employee).length > 0) {
          if (input.employee.managerEmployeeId) {
            await this.assertManagerValid(tx, id, input.employee.managerEmployeeId);
          }
          // Les colonnes sont nommées une à une, jamais l'objet reçu en bloc.
          // Le schéma Zod ne laisse déjà rien passer d'autre, mais il ne
          // s'applique qu'à la frontière HTTP : un appel interne écrirait le
          // statut sans révoquer une seule session, et le dossier serait
          // archivé avec son portail grand ouvert.
          const champs: Partial<typeof t.employees.$inferInsert> = {};
          const e = input.employee;
          if (e.employeeNumber !== undefined) champs.employeeNumber = e.employeeNumber;
          if (e.hiredOn !== undefined) champs.hiredOn = e.hiredOn;
          if (e.workEmail !== undefined) champs.workEmail = e.workEmail;
          if (e.workPhone !== undefined) champs.workPhone = e.workPhone;
          if (e.managerEmployeeId !== undefined) champs.managerEmployeeId = e.managerEmployeeId;
          if (Object.keys(champs).length > 0) {
            champs.updatedAt = new Date();
            await tx.update(t.employees).set(champs).where(eq(t.employees.id, id));
          }
        }
      });
    } catch (err) {
      if (pgCode(err) === '23505') {
        problem(409, 'people.employee_number_taken', 'Ce matricule est déjà utilisé');
      }
      throw err;
    }
  }

  /**
   * Nouvelle affectation effective-dated (ADR-0003) : clôt l'affectation
   * courante à startDate (borne exclusive) et ouvre la nouvelle [startDate,).
   * Jamais d'UPDATE destructif : l'historique reste intégralement lisible.
   */
  /**
   * Le manager désigné doit être un employé ACTIF du tenant, différent de
   * l'intéressé, et ne pas relever lui-même de lui : une boucle hiérarchique
   * ferait tourner sans fin toute remontée de chaîne (validation d'absence,
   * organigramme). La contrainte CHECK couvre le cas « soi-même » ; les boucles
   * plus longues demandent de remonter, donc c'est ici.
   */
  private async assertManagerValid(tx: Tx, employeeId: string, managerId: string): Promise<void> {
    if (managerId === employeeId) {
      problem(422, 'people.manager_is_self', 'Un employé ne peut pas être son propre manager');
    }
    const [manager] = await tx
      .select({ status: t.employees.status })
      .from(t.employees)
      .where(eq(t.employees.id, managerId))
      .limit(1);
    if (!manager) {
      problem(422, 'people.manager_not_found', "Ce manager n'existe pas");
    }
    if (manager.status !== 'active') {
      problem(
        422,
        'people.manager_not_active',
        'Seul un employé actif peut être désigné manager',
        'Ce dossier est archivé.',
      );
    }
    const boucle = await tx.execute(sql`
      WITH RECURSIVE chaine AS (
        SELECT id, manager_employee_id FROM employees WHERE id = ${managerId}
        UNION ALL
        SELECT e.id, e.manager_employee_id
        FROM employees e JOIN chaine c ON e.id = c.manager_employee_id
      )
      SELECT 1 FROM chaine WHERE id = ${employeeId} LIMIT 1`);
    if (boucle.rows.length > 0) {
      problem(
        422,
        'people.manager_cycle',
        'Ce rattachement créerait une boucle hiérarchique',
        'Cette personne relève déjà, directement ou non, de l’employé concerné.',
      );
    }
  }

  /**
   * Une affectation ne peut viser qu'une unité VIVANTE. Seule la clé étrangère
   * protégeait : elle accepte une unité dissoute, ce qui annulait la garantie
   * de la dissolution (les membres réaffectés y revenaient aussitôt).
   */
  private async requireLiveOrgUnit(tx: Tx, orgUnitId: string): Promise<void> {
    const [unit] = await tx
      .select({ id: t.orgUnits.id })
      .from(t.orgUnits)
      .where(and(eq(t.orgUnits.id, orgUnitId), isNull(t.orgUnits.deletedAt)))
      .limit(1);
    if (!unit) {
      problem(
        422,
        'people.org_unit_not_found',
        'Cette unité n’existe pas ou a été dissoute',
        'Choisissez une unité de l’organigramme actuel.',
      );
    }
  }

  async newAssignment(user: SessionUser, id: string, input: NewAssignmentInput): Promise<void> {
    try {
      await this.db.withTenant(ctxOf(user), async (tx) => {
        await this.requireEmployee(tx, id);
        if (input.orgUnitId) await this.requireLiveOrgUnit(tx, input.orgUnitId);

        const [current] = await tx
          .select({
            id: t.assignments.id,
            validFrom: sql<string>`lower(${t.assignments.validity})::text`,
          })
          .from(t.assignments)
          .where(and(eq(t.assignments.employeeId, id), sql`upper_inf(${t.assignments.validity})`))
          .limit(1);

        if (current) {
          if (input.startDate <= current.validFrom) {
            problem(
              422,
              'people.assignment_start_too_early',
              "La nouvelle affectation doit démarrer après le début de l'affectation courante",
              `Affectation courante depuis le ${current.validFrom}`,
            );
          }
          await tx
            .update(t.assignments)
            .set({
              validity: sql`daterange(lower(${t.assignments.validity}), ${input.startDate}::date)`,
            })
            .where(eq(t.assignments.id, current.id));
        }

        // Un responsable ne peut pas quitter l'unité qu'il dirige sans qu'un
        // successeur soit désigné : sinon l'organigramme affiche un chef parti
        // ailleurs. On refuse plutôt que de le retirer en douce — la RH doit
        // décider qui reprend l'unité.
        const [headed] = await tx
          .select({ id: t.orgUnits.id, name: t.orgUnits.name })
          .from(t.orgUnits)
          .where(and(eq(t.orgUnits.managerEmployeeId, id), isNull(t.orgUnits.deletedAt)))
          .limit(1);
        if (headed) {
          const stillInside = input.orgUnitId
            ? await tx.execute(sql`
                WITH RECURSIVE subtree AS (
                  SELECT id FROM org_units WHERE id = ${headed.id} AND deleted_at IS NULL
                  UNION ALL
                  SELECT o.id FROM org_units o
                  JOIN subtree s ON o.parent_id = s.id
                  WHERE o.deleted_at IS NULL
                )
                SELECT 1 FROM subtree WHERE id = ${input.orgUnitId} LIMIT 1`)
            : { rows: [] };
          if (stillInside.rows.length === 0) {
            problem(
              422,
              'people.manager_cannot_leave_unit',
              `Cet employé dirige « ${headed.name} »`,
              'Désignez d’abord un nouveau responsable pour cette unité, puis remutez-le.',
            );
          }
        }

        await tx.insert(t.assignments).values({
          id: uuidv7(),
          tenantId: user.tenantId,
          employeeId: id,
          orgUnitId: input.orgUnitId ?? null,
          positionTitle: input.positionTitle,
          validity: `[${input.startDate},)`,
        });
      });
    } catch (err) {
      if (pgCode(err) === '23P01') {
        problem(
          409,
          'people.assignment_overlap',
          'Cette affectation chevaucherait une affectation existante',
        );
      }
      throw err;
    }
  }

  /** Historique d'audit du dossier : qui a changé quoi, quand (ADR-0008). */
  async history(user: SessionUser, id: string): Promise<EmployeeHistoryEntry[]> {
    return this.db.withTenant(ctxOf(user), async (tx) => {
      const employee = await this.requireEmployee(tx, id);
      const assignmentIds = (
        await tx
          .select({ id: t.assignments.id })
          .from(t.assignments)
          .where(eq(t.assignments.employeeId, id))
      ).map((r) => r.id);
      const contractIds = (
        await tx
          .select({ id: t.contracts.id })
          .from(t.contracts)
          .where(eq(t.contracts.employeeId, id))
      ).map((r) => r.id);

      const rowIds = [employee.id, employee.personId, ...assignmentIds, ...contractIds];
      const entries = await tx
        .select()
        .from(t.auditLog)
        .where(inArray(t.auditLog.rowId, rowIds))
        .orderBy(desc(t.auditLog.occurredAt))
        .limit(100);

      return entries.map((e) => {
        const oldData = (e.oldData ?? {}) as Record<string, unknown>;
        const newData = (e.newData ?? {}) as Record<string, unknown>;
        const changedFields =
          e.action === 'UPDATE'
            ? Object.keys(newData).filter(
                (k) =>
                  k !== 'updated_at' && JSON.stringify(oldData[k]) !== JSON.stringify(newData[k]),
              )
            : [];
        return {
          id: e.id,
          tableName: e.tableName,
          action: e.action,
          occurredAt: e.occurredAt.toISOString(),
          actorUserId: e.actorUserId,
          changedFields,
        };
      });
    });
  }

  // ---------- Fin de dossier : archiver, ou effacer ----------

  /**
   * Archiver un dossier, ou le rouvrir. Le même geste dans les deux sens.
   *
   * Archiver ferme le portail SANS toucher au compte : ni le mot de passe, ni
   * l'identifiant, ni le rôle ne bougent. C'est ce qui permet, six mois plus
   * tard, de rendre l'accès sans rien redemander à l'agent — il se reconnecte
   * avec ce qu'il connaît déjà. Les sessions ouvertes sont révoquées sur-le-
   * champ : sinon l'agent continuerait de naviguer jusqu'à l'expiration de son
   * cookie, ce qui est exactement ce qu'on vient de lui retirer.
   */
  async archive(user: SessionUser, input: ArchiveEmployeesInput): Promise<EmployeeBatchResult> {
    return this.db.withTenant(ctxOf(user), async (tx) => {
      const cibles = await this.chargerCibles(tx, input.ids);
      const skipped: EmployeeBatchResult['skipped'] = [];
      const retenus: typeof cibles = [];

      for (const c of cibles) {
        const motif = await this.motifDeRefus(
          tx,
          user,
          c,
          input.archived ? 'archive' : 'reouverture',
        );
        if (motif) skipped.push({ id: c.id, name: c.nom, reason: motif });
        else retenus.push(c);
      }
      if (retenus.length === 0) return { done: 0, skipped };

      const ids = retenus.map((c) => c.id);
      await tx
        .update(t.employees)
        .set({
          status: input.archived ? 'archived' : 'active',
          archivedAt: input.archived ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(inArray(t.employees.id, ids));

      if (input.archived) {
        const comptes = retenus.map((c) => c.userId).filter((u): u is string => u !== null);
        if (comptes.length > 0) {
          // Dans CE tenant seulement : l'agent peut être employé ailleurs, et
          // la fin de son contrat ici ne le déconnecte pas de là-bas.
          await tx
            .update(t.sessions)
            .set({ revokedAt: new Date() })
            .where(
              and(
                inArray(t.sessions.userId, comptes),
                eq(t.sessions.tenantId, user.tenantId),
                isNull(t.sessions.revokedAt),
              ),
            );
        }
      }
      return { done: retenus.length, skipped };
    });
  }

  /**
   * Effacer un dossier, définitivement.
   *
   * La règle tient en une phrase : ce qui EST la personne disparaît, ce qu'elle
   * a fait au dossier des AUTRES est anonymisé. On ne peut pas supprimer la
   * ligne de compte de qui a validé les congés d'un collègue sans crever le
   * dossier du collègue ; on la vide donc de son contenu et on la laisse porter
   * la référence. Le reste — état civil, contrats, congés, pièces, demandes,
   * portail — s'en va.
   *
   * Y compris ce que le journal d'audit avait recopié au passage : son
   * déclencheur garde la ligne entière à chaque suppression, si bien qu'un
   * effacement qui l'ignorerait laisserait le dossier complet dans la table
   * qu'on ne peut pas purger. `erase_audit_payload` en retire le contenu et
   * laisse la trace (cf. migration 0018).
   */
  async remove(user: SessionUser, input: DeleteEmployeesInput): Promise<EmployeeBatchResult> {
    return this.db.withTenant(ctxOf(user), async (tx) => {
      const cibles = await this.chargerCibles(tx, input.ids);
      const skipped: EmployeeBatchResult['skipped'] = [];
      let done = 0;

      for (const c of cibles) {
        const motif = await this.motifDeRefus(tx, user, c, 'suppression');
        if (motif) {
          skipped.push({ id: c.id, name: c.nom, reason: motif });
          continue;
        }
        await this.effacer(tx, user, c);
        done += 1;
      }
      return { done, skipped };
    });
  }

  /** Les dossiers visés, avec de quoi les nommer dans un message d'erreur. */
  private async chargerCibles(tx: Tx, ids: string[]) {
    return tx
      .select({
        id: t.employees.id,
        personId: t.employees.personId,
        employeeNumber: t.employees.employeeNumber,
        status: t.employees.status,
        userId: t.persons.userId,
        nom: sql<string>`${t.persons.givenName} || ' ' || ${t.persons.familyName}`,
      })
      .from(t.employees)
      .innerJoin(t.persons, eq(t.persons.id, t.employees.personId))
      .where(inArray(t.employees.id, ids));
  }

  /**
   * Ce qui interdit de fermer ou d'effacer un dossier — null si rien ne s'y
   * oppose. Trois garde-fous, et chacun a coûté cher ailleurs :
   *
   *  — son propre dossier : on se retirerait l'accès à l'écran d'où l'on agit ;
   *  — le dernier administrateur : plus personne ne pourrait rendre les droits ;
   *  — un responsable d'unité : l'organigramme désignerait un chef parti.
   */
  private async motifDeRefus(
    tx: Tx,
    user: SessionUser,
    cible: { id: string; userId: string | null },
    geste: 'archive' | 'reouverture' | 'suppression',
  ): Promise<string | null> {
    if (cible.userId && cible.userId === user.userId) {
      return 'Vous ne pouvez pas fermer ni effacer votre propre dossier';
    }
    if (cible.userId) {
      const [autreAdmin] = await tx
        .select({ id: t.userTenantMemberships.id })
        .from(t.userTenantMemberships)
        .where(
          and(
            eq(t.userTenantMemberships.tenantId, user.tenantId),
            eq(t.userTenantMemberships.role, 'admin'),
            sql`${t.userTenantMemberships.userId} <> ${cible.userId}`,
          ),
        )
        .limit(1);
      const [estAdmin] = await tx
        .select({ id: t.userTenantMemberships.id })
        .from(t.userTenantMemberships)
        .where(
          and(
            eq(t.userTenantMemberships.tenantId, user.tenantId),
            eq(t.userTenantMemberships.userId, cible.userId),
            eq(t.userTenantMemberships.role, 'admin'),
          ),
        )
        .limit(1);
      if (estAdmin && !autreAdmin) {
        return "Dernier administrateur de l'organisation";
      }
    }
    // Rouvrir un dossier ne décapite aucune unité : ce garde-fou ne vaut que
    // pour les deux gestes qui ferment.
    if (geste !== 'reouverture') {
      const [unite] = await tx
        .select({ name: t.orgUnits.name })
        .from(t.orgUnits)
        .where(and(eq(t.orgUnits.managerEmployeeId, cible.id), isNull(t.orgUnits.deletedAt)))
        .limit(1);
      if (unite) return `Dirige « ${unite.name} » — nommez d'abord un successeur`;
    }
    return null;
  }

  /**
   * L'effacement lui-même, dans l'ordre imposé par les clés étrangères.
   *
   * Chaque suppression rend les identifiants qu'elle a retirés, et c'est cette
   * récolte-là qu'on donne au journal d'audit à nettoyer. Tenir la liste à la
   * main serait la laisser vieillir : dix-neuf tables portent un déclencheur
   * d'audit, une migration en ajoute une sans y penser, et l'oubli ne se voit
   * pas — il laisse simplement une adresse email de plus dans le journal.
   * Ici la liste est le résultat de ce qu'on a réellement effacé.
   */
  private async effacer(
    tx: Tx,
    user: SessionUser,
    cible: { id: string; personId: string; userId: string | null; nom: string },
  ): Promise<void> {
    const { id, personId, userId, nom } = cible;
    const traces: string[] = [];
    const recolter = (lignes: { id: string }[]) => {
      for (const l of lignes) traces.push(l.id);
    };

    // Les demandes d'absence se relèvent avant leurs enfants : c'est par elles
    // que visas et justificatifs se retrouvent.
    const demandeIds = (
      await tx
        .select({ id: t.absenceRequests.id })
        .from(t.absenceRequests)
        .where(eq(t.absenceRequests.employeeId, id))
    ).map((d) => d.id);

    if (demandeIds.length > 0) {
      recolter(
        await tx
          .delete(t.absenceDocuments)
          .where(inArray(t.absenceDocuments.requestId, demandeIds))
          .returning({ id: t.absenceDocuments.id }),
      );
      recolter(
        await tx
          .delete(t.absenceApprovals)
          .where(inArray(t.absenceApprovals.requestId, demandeIds))
          .returning({ id: t.absenceApprovals.id }),
      );
    }
    recolter(
      await tx
        .delete(t.absenceRequests)
        .where(eq(t.absenceRequests.employeeId, id))
        .returning({ id: t.absenceRequests.id }),
    );
    recolter(
      await tx
        .delete(t.absenceBalances)
        .where(eq(t.absenceBalances.employeeId, id))
        .returning({ id: t.absenceBalances.id }),
    );
    recolter(
      await tx
        .delete(t.employeeDocuments)
        .where(eq(t.employeeDocuments.employeeId, id))
        .returning({ id: t.employeeDocuments.id }),
    );
    recolter(
      await tx
        .delete(t.documentRequests)
        .where(eq(t.documentRequests.employeeId, id))
        .returning({ id: t.documentRequests.id }),
    );
    recolter(
      await tx
        .delete(t.profileChangeRequests)
        .where(eq(t.profileChangeRequests.employeeId, id))
        .returning({ id: t.profileChangeRequests.id }),
    );
    recolter(
      await tx
        .delete(t.assignments)
        .where(eq(t.assignments.employeeId, id))
        .returning({ id: t.assignments.id }),
    );
    recolter(
      await tx
        .delete(t.contracts)
        .where(eq(t.contracts.employeeId, id))
        .returning({ id: t.contracts.id }),
    );

    // Ce qui POINTE vers lui se détache — un successeur se nomme, il ne se
    // devine pas. Les subordonnés remontent sans manager plutôt que de
    // désigner un dossier qui n'existe plus.
    await tx
      .update(t.employees)
      .set({ managerEmployeeId: null })
      .where(eq(t.employees.managerEmployeeId, id));
    await tx
      .update(t.orgUnits)
      .set({ managerEmployeeId: null })
      .where(eq(t.orgUnits.managerEmployeeId, id));

    recolter(
      await tx.delete(t.employees).where(eq(t.employees.id, id)).returning({ id: t.employees.id }),
    );
    recolter(
      await tx
        .delete(t.invitations)
        .where(eq(t.invitations.personId, personId))
        .returning({ id: t.invitations.id }),
    );
    recolter(
      await tx.delete(t.persons).where(eq(t.persons.id, personId)).returning({ id: t.persons.id }),
    );

    /**
     * Les notifications qui PARLENT de lui, dans la boîte des autres.
     *
     * « Moussa Ndiaye demande des documents » dort chez la RH : elle nomme la
     * personne et mène à une demande qu'on vient d'effacer. On la retire donc
     * aussi — par l'identifiant quand le lien le porte, par le nom sinon.
     *
     * Le nom est un repère grossier, et c'est une limite assumée : une
     * notification qui désignerait la personne autrement (initiales, email
     * professionnel) survivrait. Le jour où ces notifications porteront
     * l'identifiant de la ligne qu'elles annoncent, ce filet-là deviendra
     * inutile — c'est la vraie correction, elle touche leur émission.
     */
    recolter(
      await tx
        .delete(t.notifications)
        .where(
          sql`(${t.notifications.link} LIKE ${`%${id}%`}
            OR ${t.notifications.dedupeKey} LIKE ${`%${id}%`}
            OR ${t.notifications.title} LIKE ${`%${nom}%`}
            OR ${t.notifications.body} LIKE ${`%${nom}%`})`,
        )
        .returning({ id: t.notifications.id }),
    );

    if (userId) {
      recolter(
        await tx
          .delete(t.notifications)
          .where(eq(t.notifications.recipientUserId, userId))
          .returning({ id: t.notifications.id }),
      );
      // Une session porte l'adresse IP et le navigateur : la révoquer laisserait
      // ces traces-là. Ici on efface, on ne range pas.
      await tx
        .delete(t.sessions)
        .where(and(eq(t.sessions.userId, userId), eq(t.sessions.tenantId, user.tenantId)));
      recolter(
        await tx
          .delete(t.userTenantMemberships)
          .where(
            and(
              eq(t.userTenantMemberships.userId, userId),
              eq(t.userTenantMemberships.tenantId, user.tenantId),
            ),
          )
          .returning({ id: t.userTenantMemberships.id }),
      );

      const restantes = await tx
        .select({ id: t.userTenantMemberships.id })
        .from(t.userTenantMemberships)
        .where(eq(t.userTenantMemberships.userId, userId))
        .limit(1);
      if (restantes.length === 0) {
        // Plus aucune organisation : le compte ne sert plus qu'à porter les
        // références des dossiers d'autrui. On le vide de la personne.
        await tx
          .update(t.users)
          .set({
            email: `supprime+${userId}@compte.invalide`,
            passwordHash: randomBytes(32).toString('base64'),
            givenName: 'Compte',
            familyName: 'supprimé',
            status: 'deleted',
            mfaTotpSecret: null,
            updatedAt: new Date(),
          })
          .where(eq(t.users.id, userId));
      }
    }

    // En dernier : chaque suppression ci-dessus vient d'écrire dans le journal
    // une copie de la ligne effacée. C'est ce contenu-là qu'on retire, en
    // laissant la trace de l'opération. Un seul paramètre, découpé côté base :
    // passer le tableau tel quel le ferait développer en tuple `($1, $2, …)`,
    // que Postgres refuse de couler en uuid[].
    await tx.execute(
      sql`SELECT erase_audit_payload(string_to_array(${traces.join(',')}, ',')::uuid[])`,
    );
  }

  private async requireEmployee(tx: Tx, id: string) {
    const [employee] = await tx.select().from(t.employees).where(eq(t.employees.id, id)).limit(1);
    if (!employee) {
      problem(404, 'people.employee_not_found', 'Employé introuvable');
    }
    return employee;
  }
}
