import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type {
  CreateOrgUnitInput,
  OrgUnitMember,
  OrgUnitView,
  SessionUser,
  UpdateOrgUnitInput,
} from '@teranga/contracts';
import { problem } from '../../common/problem';
import * as t from '../../db/schema';
import { TenantDb, Tx } from '../../db/tenant-db';

@Injectable()
export class OrgUnitsService {
  constructor(@Inject(TenantDb) private readonly db: TenantDb) {}

  /** Liste enrichie pour l'organigramme : responsable et effectif direct. */
  async list(user: SessionUser): Promise<OrgUnitView[]> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      const managerPersons = t.persons;
      const rows = await tx
        .select({
          id: t.orgUnits.id,
          name: t.orgUnits.name,
          unitType: t.orgUnits.unitType,
          parentId: t.orgUnits.parentId,
          managerEmployeeId: t.orgUnits.managerEmployeeId,
          managerGivenName: managerPersons.givenName,
          managerFamilyName: managerPersons.familyName,
          managerPosition: sql<string | null>`(
            SELECT a.position_title FROM assignments a
            WHERE a.employee_id = ${t.orgUnits.managerEmployeeId}
              AND a.validity @> CURRENT_DATE
            LIMIT 1)`,
          headcount: sql<number>`(
            SELECT count(*)::int FROM assignments a
            JOIN employees e ON e.id = a.employee_id
            WHERE a.org_unit_id = ${t.orgUnits.id}
              AND a.validity @> CURRENT_DATE
              AND e.status = 'active')`,
        })
        .from(t.orgUnits)
        .leftJoin(t.employees, eq(t.employees.id, t.orgUnits.managerEmployeeId))
        .leftJoin(managerPersons, eq(managerPersons.id, t.employees.personId))
        .where(isNull(t.orgUnits.deletedAt))
        .orderBy(asc(t.orgUnits.unitType), asc(t.orgUnits.name));

      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        unitType: r.unitType as OrgUnitView['unitType'],
        parentId: r.parentId,
        managerEmployeeId: r.managerEmployeeId,
        managerName: r.managerGivenName ? `${r.managerGivenName} ${r.managerFamilyName}` : null,
        managerPosition: r.managerPosition,
        headcount: r.headcount,
      }));
    });
  }

  async create(user: SessionUser, input: CreateOrgUnitInput): Promise<{ id: string }> {
    const id = uuidv7();
    await this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      if (input.parentId) await this.requireUnit(tx, input.parentId, 'org.parent_not_found');
      await tx.insert(t.orgUnits).values({
        id,
        tenantId: user.tenantId,
        name: input.name,
        unitType: input.unitType,
        parentId: input.parentId || null,
      });
    });
    return { id };
  }

  /** Renommage, re-rattachement (anti-cycle) ou changement de responsable. */
  async update(user: SessionUser, id: string, input: UpdateOrgUnitInput): Promise<void> {
    await this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      await this.requireUnit(tx, id, 'org.unit_not_found');

      if (input.parentId !== undefined && input.parentId !== null) {
        if (input.parentId === id) {
          problem(422, 'org.cycle', 'Une unité ne peut pas être rattachée à elle-même');
        }
        await this.requireUnit(tx, input.parentId, 'org.parent_not_found');
        // Anti-cycle : le nouveau parent ne doit pas être un descendant de l'unité.
        const cycle = await tx.execute(sql`
          WITH RECURSIVE ancestors AS (
            SELECT id, parent_id FROM org_units WHERE id = ${input.parentId}
            UNION ALL
            SELECT o.id, o.parent_id FROM org_units o
            JOIN ancestors anc ON o.id = anc.parent_id
          )
          SELECT 1 FROM ancestors WHERE id = ${id} LIMIT 1`);
        if (cycle.rows.length > 0) {
          problem(
            422,
            'org.cycle',
            'Rattachement impossible : cela créerait une boucle dans la structure',
          );
        }
      }

      if (input.managerEmployeeId) {
        const [emp] = await tx
          .select({ id: t.employees.id })
          .from(t.employees)
          .where(eq(t.employees.id, input.managerEmployeeId))
          .limit(1);
        if (!emp) {
          problem(422, 'org.manager_not_found', "Cet employé n'existe pas");
        }
      }

      const changes: Partial<typeof t.orgUnits.$inferInsert> = {};
      if (input.name !== undefined) changes.name = input.name;
      if (input.unitType !== undefined) changes.unitType = input.unitType;
      if (input.parentId !== undefined) changes.parentId = input.parentId;
      if (input.managerEmployeeId !== undefined) {
        changes.managerEmployeeId = input.managerEmployeeId;
      }
      if (Object.keys(changes).length === 0) return;
      changes.updatedAt = new Date();
      await tx.update(t.orgUnits).set(changes).where(eq(t.orgUnits.id, id));
    });
  }

  /** Les personnes actuellement affectées à l'unité (annuaire interne). */
  async members(user: SessionUser, id: string): Promise<OrgUnitMember[]> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      await this.requireUnit(tx, id, 'org.unit_not_found');
      const rows = await tx
        .select({
          employeeId: t.employees.id,
          employeeNumber: t.employees.employeeNumber,
          givenName: t.persons.givenName,
          familyName: t.persons.familyName,
          positionTitle: t.assignments.positionTitle,
        })
        .from(t.assignments)
        .innerJoin(t.employees, eq(t.employees.id, t.assignments.employeeId))
        .innerJoin(t.persons, eq(t.persons.id, t.employees.personId))
        .where(
          and(
            eq(t.assignments.orgUnitId, id),
            sql`${t.assignments.validity} @> CURRENT_DATE`,
            eq(t.employees.status, 'active'),
          ),
        )
        .orderBy(asc(t.persons.familyName), asc(t.persons.givenName));
      return rows;
    });
  }

  private async requireUnit(tx: Tx, id: string, code: string) {
    const [unit] = await tx
      .select({ id: t.orgUnits.id })
      .from(t.orgUnits)
      .where(and(eq(t.orgUnits.id, id), isNull(t.orgUnits.deletedAt)))
      .limit(1);
    if (!unit) {
      problem(code === 'org.parent_not_found' ? 422 : 404, code, "Cette unité n'existe pas");
    }
    return unit;
  }
}
