import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type {
  AssignmentView,
  CreateEmployeeInput,
  CursorPage,
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
        await tx.insert(t.employees).values({
          id: employeeId,
          tenantId: user.tenantId,
          personId,
          employeeNumber: input.employee.employeeNumber,
          hiredOn: input.employee.hiredOn,
          workEmail: input.employee.workEmail,
          workPhone: input.employee.workPhone,
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

      const canSeeSensitive = SENSITIVE_ROLES.has(user.role) || isSelf;
      return {
        id: employee.id,
        employeeNumber: employee.employeeNumber,
        status: employee.status,
        hiredOn: employee.hiredOn,
        workEmail: employee.workEmail,
        workPhone: employee.workPhone,
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
          await tx.update(t.employees).set(input.employee).where(eq(t.employees.id, id));
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
  async newAssignment(user: SessionUser, id: string, input: NewAssignmentInput): Promise<void> {
    try {
      await this.db.withTenant(ctxOf(user), async (tx) => {
        await this.requireEmployee(tx, id);

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

  private async requireEmployee(tx: Tx, id: string) {
    const [employee] = await tx.select().from(t.employees).where(eq(t.employees.id, id)).limit(1);
    if (!employee) {
      problem(404, 'people.employee_not_found', 'Employé introuvable');
    }
    return employee;
  }
}
