import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type {
  ArchiveEmployeesInput,
  ChangementRattachement,
  ConsequencesHierarchie,
  EmployeeListPage,
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
import { problem, ProblemException } from '../../common/problem';
import * as t from '../../db/schema';
import { TenantDb, Tx } from '../../db/tenant-db';
import {
  appliquerReprise,
  DG,
  directionDeEmploye,
  directionDeLUnite,
  directionDeUnite,
  equipeDe,
  perimetre,
  planifierReprise,
  reprendreEquipe,
  sortDuPerimetre,
  uniteRacine,
  validerRattachement,
  verrouillerLaChaine,
  type PlanDeReprise,
} from './chaine';
import { faireSuivreLesDemandes, retirerLesAppels } from '../time/visas';
import { lireLaChaine, nouvellesAnomalies } from './hierarchie.service';

/** Rôles autorisés à lire les champs ultra-sensibles (CNI). */
const SENSITIVE_ROLES = new Set(['admin', 'hr']);

function ctxOf(user: SessionUser): { tenantId: string; userId: string } {
  return { tenantId: user.tenantId, userId: user.userId };
}

function pgCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code ?? e?.cause?.code;
}

/** Une ligne du SQL de liste, en snake_case comme la base la rend. */
interface LigneListe extends Record<string, unknown> {
  id: string;
  employee_number: string;
  given_name: string;
  family_name: string;
  status: string;
  hired_on: string;
  work_email: string | null;
  created_at: Date;
  position_title: string | null;
  org_unit_name: string | null;
  direction_short_name: string | null;
  direction_name: string | null;
  contract_start_date: string | null;
  contract_end_date: string | null;
  manager_employee_id: string | null;
  manager_name: string | null;
  manager_number: string | null;
  team_size: number;
  unite: string | null;
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

  /**
   * La liste du personnel : recherche, onglet, filtres, tri, page.
   *
   * Écrite en SQL plutôt qu'au constructeur de requêtes, pour une raison
   * précise : trois des colonnes affichées sont calculées — la direction se
   * trouve en REMONTANT l'arbre des unités, le contrat est le plus récent des
   * contrats — et l'on doit pouvoir FILTRER et TRIER dessus. En SQL, un alias
   * ne se réutilise pas dans le WHERE de la même requête ; il faudrait donc
   * répéter chaque sous-requête à chaque endroit où elle sert. Une CTE la
   * nomme une fois, et tout le reste — filtres, tri, effectifs, valeurs des
   * listes déroulantes — s'appuie dessus.
   */
  async list(user: SessionUser, query: ListEmployeesQuery): Promise<EmployeeListPage> {
    return this.db.withTenant(ctxOf(user), async (tx) => {
      const like = query.q ? `%${query.q}%` : null;

      /**
       * Le socle : une ligne par agent, colonnes affichées comprises. La
       * recherche y est appliquée tout de suite — elle vaut pour la page, pour
       * les effectifs des onglets ET pour les listes déroulantes.
       */
      const socle = sql`
        WITH socle AS (
          SELECT
            e.id,
            e.employee_number,
            p.given_name,
            p.family_name,
            e.status,
            e.hired_on::text            AS hired_on,
            e.work_email,
            e.created_at,
            a.position_title,
            o.name                      AS org_unit_name,
            ${directionDeLUnite(sql`a.org_unit_id`, 'short_name')} AS direction_short_name,
            ${directionDeLUnite(sql`a.org_unit_id`, 'name')}       AS direction_name,
            (SELECT c.start_date::text FROM contracts c
              WHERE c.employee_id = e.id ORDER BY c.start_date DESC LIMIT 1)
                                        AS contract_start_date,
            (SELECT c.end_date::text FROM contracts c
              WHERE c.employee_id = e.id ORDER BY c.start_date DESC LIMIT 1)
                                        AS contract_end_date,
            e.manager_employee_id,
            (SELECT mp.given_name || ' ' || mp.family_name
               FROM employees me JOIN persons mp ON mp.id = me.person_id
              WHERE me.id = e.manager_employee_id)
                                        AS manager_name,
            -- Le matricule du n+1 : c'est LUI que la liste affiche, un nom
            -- pouvant être porté par deux agents.
            (SELECT me.employee_number FROM employees me
              WHERE me.id = e.manager_employee_id)
                                        AS manager_number,
            -- Ses agents directs actifs : qui part avec une équipe la confie.
            -- Le DG n'est de l'équipe de personne, même par une donnée ancienne.
            (SELECT count(*)::int FROM employees s
              WHERE s.manager_employee_id = e.id AND s.status = 'active'
                AND s.id IS DISTINCT FROM ${DG})
                                        AS team_size
          FROM employees e
          JOIN persons p ON p.id = e.person_id
          -- L'affectation qui fait foi — en cours, sinon la prochaine : un
          -- agent qui n'a pas encore pris son poste est déjà de sa direction,
          -- comme partout ailleurs dans la chaîne.
          LEFT JOIN assignments a
            ON a.id = (SELECT av.id FROM assignments av
                        WHERE av.employee_id = e.id
                          AND (av.validity @> CURRENT_DATE OR lower(av.validity) > CURRENT_DATE)
                        ORDER BY lower(av.validity) LIMIT 1)
          LEFT JOIN org_units o ON o.id = a.org_unit_id
          WHERE ${
            like === null
              ? sql`TRUE`
              : sql`(p.given_name ILIKE ${like} OR p.family_name ILIKE ${like}
                     OR e.employee_number ILIKE ${like})`
          }
        ),
        -- L'unité TELLE QU'ELLE S'AFFICHE : la colonne montre l'abrégé de la
        -- direction, et un filtre qui porterait sur autre chose ne
        -- correspondrait pas à ce qu'on lit.
        vue AS (
          SELECT socle.*,
                 COALESCE(direction_short_name, direction_name, org_unit_name) AS unite
          FROM socle
        )`;

      const filtres = [
        query.status ? sql`status = ${query.status}` : null,
        query.positionTitle ? sql`position_title = ${query.positionTitle}` : null,
        query.managerId ? sql`manager_employee_id = ${query.managerId}` : null,
        query.unit ? sql`unite = ${query.unit}` : null,
      ].filter((c): c is NonNullable<typeof c> => c !== null);
      const ou = filtres.length > 0 ? sql`WHERE ${sql.join(filtres, sql` AND `)}` : sql``;

      // NULLS LAST dans les deux sens : un contrat sans date de fin n'est pas
      // « le plus ancien », il est absent — sa place est en bas de la pile.
      const sens = query.dir === 'asc' ? sql`ASC` : sql`DESC`;
      const ordre = {
        recent: sql`created_at ${sens}, id ${sens}`,
        name: sql`family_name ${sens}, given_name ${sens}, id ASC`,
        contractStart: sql`contract_start_date ${sens} NULLS LAST, family_name ASC`,
        contractEnd: sql`contract_end_date ${sens} NULLS LAST, family_name ASC`,
      }[query.sort];

      const lignes = await tx.execute<LigneListe>(sql`
        ${socle}
        SELECT * FROM vue ${ou}
        ORDER BY ${ordre}
        LIMIT ${query.limit + 1} OFFSET ${query.offset}
      `);
      const trop = lignes.rows.length > query.limit;
      const page = trop ? lignes.rows.slice(0, query.limit) : lignes.rows;

      // Le total de CETTE requête-là, filtres compris : c'est le nombre de
      // pages. Une requête de plus, sur la même vue — `count(*) OVER ()`
      // l'aurait donnée avec les lignes, mais serait revenue vide sur une
      // page au-delà de la fin, précisément le cas où la pagination a besoin
      // de savoir combien de pages il reste.
      const totalRows = await tx.execute<{ n: string }>(sql`
        ${socle}
        SELECT count(*)::text AS n FROM vue ${ou}
      `);

      // Les effectifs ignorent l'onglet — c'est leur raison d'être : dire
      // combien il y en a DE L'AUTRE CÔTÉ.
      const effectifs = await tx.execute<{ status: string; n: string }>(sql`
        ${socle}
        SELECT status, count(*)::text AS n FROM vue GROUP BY status
      `);
      const compte = (s: string) => Number(effectifs.rows.find((r) => r.status === s)?.n ?? 0);

      // Les valeurs proposées suivent l'onglet, pas les autres filtres : sinon
      // choisir un poste viderait la liste des managers, et l'on ne pourrait
      // plus revenir en arrière sans tout défaire.
      const cadre = query.status ? sql` AND status = ${query.status}` : sql``;
      const facettes = await tx.execute<{
        kind: string;
        value: string;
        label: string;
      }>(sql`
        ${socle}
        SELECT 'position' AS kind, position_title AS value, position_title AS label
          FROM vue WHERE position_title IS NOT NULL ${cadre}
        UNION
        SELECT 'unit', unite, unite
          FROM vue WHERE unite IS NOT NULL ${cadre}
        UNION
        SELECT 'manager', manager_employee_id::text,
               manager_name || ' (' || manager_number || ')'
          FROM vue WHERE manager_employee_id IS NOT NULL ${cadre}
        ORDER BY 3
      `);

      return {
        items: page.map((r) => ({
          id: r.id,
          employeeNumber: r.employee_number,
          givenName: r.given_name,
          familyName: r.family_name,
          status: r.status,
          hiredOn: r.hired_on,
          workEmail: r.work_email,
          positionTitle: r.position_title,
          orgUnitName: r.org_unit_name,
          directionShortName: r.direction_short_name,
          directionName: r.direction_name,
          contractStartDate: r.contract_start_date,
          contractEndDate: r.contract_end_date,
          managerId: r.manager_employee_id,
          managerName: r.manager_name,
          managerNumber: r.manager_number,
          teamSize: Number(r.team_size ?? 0),
        })),
        nextOffset: trop ? query.offset + query.limit : null,
        total: Number(totalRows.rows[0]?.n ?? 0),
        counts: { active: compte('active'), archived: compte('archived') },
        facets: {
          positions: facettes.rows.filter((f) => f.kind === 'position').map((f) => f.value),
          units: facettes.rows.filter((f) => f.kind === 'unit').map((f) => f.value),
          managers: facettes.rows
            .filter((f) => f.kind === 'manager')
            .map((f) => ({ id: f.value, name: f.label })),
        },
      };
    });
  }

  /**
   * Un dossier neuf.
   *
   * Le responsable hiérarchique n'est PAS exigé ici, et c'est un choix : on
   * crée souvent un dossier avant de savoir de qui l'agent relèvera, et un
   * import n'en sait rien du tout. La règle de l'APIX — un n+1 pour chacun —
   * ne se tient donc pas par un refus mais par un AVERTISSEMENT (le contrôle
   * de la chaîne hiérarchique) et par une conséquence : sans n+1, ni
   * objectifs ni évaluation.
   *
   * Ce qui est vérifié, en revanche, c'est le rattachement QUAND il est
   * donné : même direction, responsable actif, pas de boucle.
   */
  async create(user: SessionUser, input: CreateEmployeeInput): Promise<{ id: string }> {
    const employeeId = uuidv7();
    const personId = uuidv7();

    try {
      await this.db.withTenant(ctxOf(user), async (tx) => {
        await verrouillerLaChaine(tx);
        if (input.assignment?.orgUnitId) {
          await this.requireLiveOrgUnit(tx, input.assignment.orgUnitId);
        }
        const { nationalId, ...person } = input.person;
        await tx.insert(t.persons).values({
          id: personId,
          tenantId: user.tenantId,
          ...person,
          nationalIdEncrypted: nationalId ? this.crypto.encrypt(nationalId) : null,
        });
        if (input.employee.managerEmployeeId) {
          await validerRattachement(
            tx,
            employeeId,
            input.employee.managerEmployeeId,
            await directionDeUnite(tx, input.assignment?.orgUnitId ?? null),
          );
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
          // La direction ne se lit pas sur l'unité : il faut REMONTER l'arbre
          // jusqu'au premier ancêtre de type « direction ». Même remontée que
          // dans la liste du personnel, où la colonne « Unité » affiche déjà
          // l'abrégé.
          directionShortName: sql<
            string | null
          >`${directionDeLUnite(sql`${t.assignments.orgUnitId}`, 'short_name')}`,
          directionName: sql<
            string | null
          >`${directionDeLUnite(sql`${t.assignments.orgUnitId}`, 'name')}`,
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
      const team = await equipeDe(tx, employee.id);

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
        team,
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
          directionShortName: a.directionShortName,
          directionName: a.directionName,
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
        if (input.employee?.managerEmployeeId !== undefined) await verrouillerLaChaine(tx);

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
            await validerRattachement(
              tx,
              id,
              input.employee.managerEmployeeId,
              await directionDeEmploye(tx, id),
            );
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
          // Un nouveau n+1 reprend les demandes de congé qui attendaient
          // le visa de l'ancien.
          if (
            e.managerEmployeeId !== undefined &&
            e.managerEmployeeId !== employee.managerEmployeeId
          ) {
            await faireSuivreLesDemandes(tx, id);
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

  /**
   * Nouvelle affectation effective-dated (ADR-0003) : clôt l'affectation
   * courante à startDate (borne exclusive) et ouvre la nouvelle [startDate,).
   * Jamais d'UPDATE destructif : l'historique reste intégralement lisible.
   *
   * La chaîne hiérarchique doit y survivre, et les refus viennent dans
   * l'ordre où l'on corrige : d'abord qui dirige quoi (le DG, un responsable
   * d'unité), puis la date, puis l'équipe, puis son propre n+1.
   */
  async newAssignment(
    user: SessionUser,
    id: string,
    input: NewAssignmentInput,
  ): Promise<ConsequencesHierarchie> {
    let resultat: ConsequencesHierarchie = { changements: [], aRevoir: [] };
    try {
      await this.db.withTenant(ctxOf(user), async (tx) => {
        await verrouillerLaChaine(tx);
        const [dossier] = await tx
          .select({ managerId: t.employees.managerEmployeeId })
          .from(t.employees)
          .where(eq(t.employees.id, id))
          .limit(1);
        if (!dossier) problem(404, 'people.employee_not_found', 'Employé introuvable');
        if (input.orgUnitId) await this.requireLiveOrgUnit(tx, input.orgUnitId);
        const avant = await lireLaChaine(tx);
        const journal: ChangementRattachement[] = [];

        // ——— 1. Le directeur général siège à la Direction Générale : il n'en
        // sort pas, sans quoi ses collaborateurs directs relèveraient d'une
        // autre direction que la leur.
        const racine = await uniteRacine(tx);
        const directionVisee = await directionDeUnite(tx, input.orgUnitId ?? null);
        if (racine?.managerId === id && directionVisee?.id !== racine.id) {
          problem(
            422,
            'people.dg_quitte_la_dg',
            'Le directeur général reste affecté à la Direction Générale',
            'Pour lui confier une autre direction, désignez d’abord son successeur à la tête de la Direction Générale.',
          );
        }

        // ——— 2. Un responsable ne quitte pas le périmètre de l'unité qu'il
        // dirige sans qu'un successeur soit désigné : sinon l'organigramme
        // affiche un chef parti ailleurs. On refuse plutôt que de le retirer
        // en douce — la RH décide qui reprend l'unité.
        const [dirigee] = await tx
          .select({ id: t.orgUnits.id, name: t.orgUnits.name })
          .from(t.orgUnits)
          .where(and(eq(t.orgUnits.managerEmployeeId, id), isNull(t.orgUnits.deletedAt)))
          .limit(1);
        if (dirigee) {
          const dedans = input.orgUnitId
            ? await tx.execute(sql`
                ${perimetre(dirigee.id)}
                SELECT 1 FROM perimetre WHERE id = ${input.orgUnitId} LIMIT 1`)
            : { rows: [] };
          if (dedans.rows.length === 0) {
            problem(
              422,
              'people.manager_cannot_leave_unit',
              `Cet employé dirige « ${dirigee.name} »`,
              'Désignez d’abord un nouveau responsable pour cette unité, puis remutez-le.',
            );
          }
        }

        // ——— 3. Le n+1 n'est pas daté : il vaut dès aujourd'hui. Une mutation
        // PROGRAMMÉE vers une autre direction laisserait donc la chaîne
        // fausse jusqu'à la date, ou fausse après — selon qu'on change le
        // n+1 maintenant ou pas. Tant qu'elle touche à la hiérarchie, elle
        // s'enregistre le jour où elle prend effet.
        const equipe = await equipeDe(tx, id);
        const directionActuelle = await directionDeEmploye(tx, id);
        const changeDeDirection = directionVisee?.id !== directionActuelle?.id;
        const [{ futur }] = (
          await tx.execute<{ futur: boolean }>(
            sql`SELECT ${input.startDate}::date > CURRENT_DATE AS futur`,
          )
        ).rows as [{ futur: boolean }];
        if (
          futur &&
          changeDeDirection &&
          (dossier.managerId || input.managerEmployeeId || equipe.length > 0)
        ) {
          problem(
            422,
            'people.mutation_programmee_hors_direction',
            'Une mutation vers une autre direction s’enregistre le jour où elle prend effet',
            'Le n+1 vaut dès aujourd’hui : programmée, la mutation laisserait la chaîne hiérarchique fausse jusqu’à sa date. Enregistrez-la ce jour-là, avec son nouveau n+1.',
          );
        }

        // Ce qui tenait AVANT la mutation doit tenir APRÈS. Une anomalie
        // ancienne ne bloque pas une mutation qui n'y est pour rien : le
        // contrôle de la chaîne continue de la signaler.
        const tenait = async (agent: string, n1: string) => {
          try {
            await validerRattachement(tx, agent, n1, await directionDeEmploye(tx, agent));
            return true;
          } catch (err) {
            if (err instanceof ProblemException) return false;
            throw err;
          }
        };
        const equipeEnRegle = new Set<string>();
        for (const a of equipe) if (await tenait(a.id, id)) equipeEnRegle.add(a.id);
        const n1Garde = input.managerEmployeeId ? null : dossier.managerId;
        const n1GardeEnRegle = n1Garde ? await tenait(id, n1Garde) : false;

        // ——— 4. L'équipe, confiée si l'on en désigne le repreneur.
        if (input.repreneurEquipeId) {
          await reprendreEquipe(tx, journal, id, input.repreneurEquipeId);
        }

        // ——— L'écriture : on clôt l'affectation courante, on ouvre la neuve.
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
        await tx.insert(t.assignments).values({
          id: uuidv7(),
          tenantId: user.tenantId,
          employeeId: id,
          orgUnitId: input.orgUnitId ?? null,
          positionTitle: input.positionTitle,
          validity: `[${input.startDate},)`,
        });

        // ——— Relu sur l'état écrit. Le responsable d'unité, d'abord : une
        // affectation déjà programmée ailleurs le ferait sortir plus tard.
        if (dirigee && (await sortDuPerimetre(tx, id, dirigee.id))) {
          problem(
            422,
            'people.manager_cannot_leave_unit',
            `Cet employé dirige « ${dirigee.name} »`,
            'Désignez d’abord un nouveau responsable pour cette unité, puis remutez-le.',
          );
        }

        // L'équipe qui reste doit pouvoir le suivre ; sinon, un repreneur.
        const restants = (await equipeDe(tx, id)).filter((a) => equipeEnRegle.has(a.id));
        for (const a of restants) {
          if (!(await tenait(a.id, id))) {
            problem(
              422,
              'people.equipe_sans_repreneur',
              `Cet agent encadre ${restants.length > 1 ? `${restants.length} agents` : 'un agent'}`,
              'Ils restent dans leur direction : choisissez qui reprend son équipe, dans la même opération.',
            );
          }
        }

        // ——— 5. Son n+1 : le nouveau, désigné dans le même geste — changer de
        // direction rend l'ancien caduc, et le corriger avant serait refusé
        // (il ne serait pas encore de la direction de l'agent) —, ou celui
        // qu'il garde, s'il tient toujours.
        if (input.managerEmployeeId) {
          await validerRattachement(
            tx,
            id,
            input.managerEmployeeId,
            await directionDeEmploye(tx, id),
          );
          await tx
            .update(t.employees)
            .set({ managerEmployeeId: input.managerEmployeeId, updatedAt: new Date() })
            .where(eq(t.employees.id, id));
        } else if (n1Garde && n1GardeEnRegle && !(await tenait(id, n1Garde))) {
          const direction = await directionDeEmploye(tx, id);
          if (!direction) {
            problem(
              422,
              'people.mutation_sans_direction',
              'Un agent rattaché à un n+1 reste affecté à une direction',
              'Choisissez une unité rattachée à une direction, ou retirez d’abord son n+1.',
            );
          }
          problem(
            422,
            'people.responsable_hors_nouvelle_direction',
            'Le responsable actuel n’appartient pas à la nouvelle direction',
            `L’agent rejoint « ${direction.nom} » : désignez son nouveau responsable dans la même opération.`,
          );
        }

        await this.faireSuivre(tx, journal, input.managerEmployeeId ? [id] : []);
        resultat = {
          changements: journal,
          aRevoir: nouvellesAnomalies(avant, await lireLaChaine(tx)),
        };
      });
      return resultat;
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
      await verrouillerLaChaine(tx);
      const avant = await lireLaChaine(tx);
      const cibles = await this.chargerCibles(tx, input.ids);
      const skipped: EmployeeBatchResult['skipped'] = [];
      const geste = input.archived ? 'archive' : 'reouverture';
      let retenus: typeof cibles = [];
      for (const c of cibles) {
        const motif = await this.motifDeRefus(tx, user, c, geste);
        if (motif) skipped.push({ id: c.id, name: c.nom, reason: motif });
        else retenus.push(c);
      }

      const journal: ChangementRattachement[] = [];
      if (input.archived) {
        const depart = await this.planifierLesDeparts(tx, retenus, input.repreneurs);
        skipped.push(...depart.refus);
        retenus = depart.retenus;
        for (const plan of depart.plans) await appliquerReprise(tx, journal, plan);
      }
      if (retenus.length === 0) return { done: 0, skipped, changements: journal, aRevoir: [] };

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
        // Qui part ne prend plus de congé : ses demandes encore en attente
        // sont annulées, et leurs appels à viser retirés des boîtes.
        const annulees = await tx
          .update(t.absenceRequests)
          .set({ status: 'cancelled', decidedAt: new Date() })
          .where(
            and(
              inArray(t.absenceRequests.employeeId, ids),
              eq(t.absenceRequests.status, 'pending'),
            ),
          )
          .returning({ id: t.absenceRequests.id });
        for (const d of annulees) await retirerLesAppels(tx, d.id);
        await this.faireSuivre(tx, journal);
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
      // Un dossier rouvert revient avec le n+1 et l'affectation qu'il avait :
      // l'un ou l'autre a pu changer depuis. Ce qu'il faut revoir se dit
      // tout de suite, plutôt que d'attendre le prochain contrôle.
      return {
        done: retenus.length,
        skipped,
        changements: journal,
        aRevoir: nouvellesAnomalies(avant, await lireLaChaine(tx)),
      };
    });
  }

  /**
   * Les agents dont le n+1 vient de changer : leurs demandes de congé qui
   * attendaient le visa de l'ancien passent au nouveau, qui est prévenu.
   */
  private async faireSuivre(
    tx: Tx,
    journal: ChangementRattachement[],
    autres: string[] = [],
  ): Promise<void> {
    for (const id of new Set([...journal.map((c) => c.employeeId), ...autres])) {
      await faireSuivreLesDemandes(tx, id);
    }
  }

  /**
   * Qui part avec une équipe la confie : les reprises d'un LOT, vérifiées
   * ensemble avant que rien ne s'écrive.
   *
   * Les agents qui partent dans le même lot ne comptent pas — on ne confie
   * pas une équipe qui s'en va aussi, ni à quelqu'un qui s'en va. Mais un
   * départ refusé change la donne pour les autres : l'agent qui reste
   * redevient un membre d'équipe à confier, un repreneur possible, un n+1 à
   * la place duquel on peut se mettre. On recommence donc jusqu'à ce que
   * plus rien ne bouge — le lot ne fait que rétrécir, le calcul s'arrête.
   */
  private async planifierLesDeparts<C extends { id: string; nom: string }>(
    tx: Tx,
    candidats: C[],
    repreneurs: Record<string, string> | undefined,
  ): Promise<{ retenus: C[]; plans: PlanDeReprise[]; refus: EmployeeBatchResult['skipped'] }> {
    let retenus = candidats;
    const refus: EmployeeBatchResult['skipped'] = [];
    for (;;) {
      const partants = new Set(retenus.map((c) => c.id));
      const plans: PlanDeReprise[] = [];
      const tour: EmployeeBatchResult['skipped'] = [];
      for (const c of retenus) {
        const equipe = (await equipeDe(tx, c.id)).filter((a) => !partants.has(a.id));
        if (equipe.length === 0) continue;
        const repreneur = repreneurs?.[c.id];
        const effectif = equipe.length > 1 ? `${equipe.length} agents` : 'un agent';
        if (!repreneur) {
          tour.push({
            id: c.id,
            name: c.nom,
            reason: `Encadre ${effectif} — choisissez qui reprend son équipe`,
          });
          continue;
        }
        try {
          plans.push(await planifierReprise(tx, c.id, repreneur, equipe, partants));
        } catch (err) {
          if (!(err instanceof ProblemException)) throw err;
          tour.push({
            id: c.id,
            name: c.nom,
            reason: [err.problem.title, err.problem.detail].filter(Boolean).join(' — '),
          });
        }
      }
      if (tour.length === 0) return { retenus, plans, refus };
      refus.push(...tour);
      const refuses = new Set(tour.map((r) => r.id));
      retenus = retenus.filter((c) => !refuses.has(c.id));
    }
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
      await verrouillerLaChaine(tx);
      const avant = await lireLaChaine(tx);
      const cibles = await this.chargerCibles(tx, input.ids);
      const skipped: EmployeeBatchResult['skipped'] = [];
      const candidats: typeof cibles = [];
      for (const c of cibles) {
        const motif = await this.motifDeRefus(tx, user, c, 'suppression');
        if (motif) skipped.push({ id: c.id, name: c.nom, reason: motif });
        else candidats.push(c);
      }

      const journal: ChangementRattachement[] = [];
      const depart = await this.planifierLesDeparts(tx, candidats, input.repreneurs);
      skipped.push(...depart.refus);
      for (const plan of depart.plans) await appliquerReprise(tx, journal, plan);
      for (const c of depart.retenus) await this.effacer(tx, user, c);
      await this.faireSuivre(tx, journal);
      return {
        done: depart.retenus.length,
        skipped,
        changements: journal,
        aRevoir: nouvellesAnomalies(avant, await lireLaChaine(tx)),
      };
    });
  }

  /** Les dossiers visés, avec de quoi les nommer dans un message d'erreur. */
  private async chargerCibles(tx: Tx, ids: string[]) {
    return (
      tx
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
        .where(inArray(t.employees.id, ids))
        // Un ordre fixe : deux essais du même lot rendent les mêmes refus.
        .orderBy(t.employees.employeeNumber, t.employees.id)
    );
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
