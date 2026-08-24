import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { DashboardView } from '@teranga/contracts';
import * as t from '../../db/schema';
import { TenantDb } from '../../db/tenant-db';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';

@Controller()
@UseGuards(SessionGuard, RolesGuard)
@Roles('admin', 'hr', 'payroll', 'manager')
export class DashboardController {
  constructor(@Inject(TenantDb) private readonly db: TenantDb) {}

  /**
   * Tout le tableau de bord en un appel. L'écran d'accueil est la page la plus
   * vue du produit : une requête par carte en ferait dix — tout part ensemble,
   * chaque bloc reste une requête SQL simple exécutée en parallèle.
   */
  @Get('dashboard')
  async stats(@Req() req: AuthenticatedRequest): Promise<DashboardView> {
    const user = req.sessionUser;
    const isManage = ['admin', 'hr'].includes(user.role);

    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      const count = async (query: Promise<Array<{ n: number }>>) => (await query)[0]?.n ?? 0;
      const n = sql<number>`count(*)::int`;

      const [
        activeEmployees,
        hiredLast90d,
        absentToday,
        pendingRequests,
        upcomingAbsences,
        orgUnits,
        pendingDocumentRequests,
        pendingProfileChanges,
        genders,
        directions,
        holidays,
        hires,
      ] = await Promise.all([
        count(tx.select({ n }).from(t.employees).where(eq(t.employees.status, 'active'))),
        count(
          tx
            .select({ n })
            .from(t.employees)
            .where(
              and(
                eq(t.employees.status, 'active'),
                // Bornée des DEUX côtés : un dossier préparé en avance
                // (hired_on futur) n'est pas un recrutement déjà arrivé.
                gte(t.employees.hiredOn, sql`CURRENT_DATE - 90`),
                lte(t.employees.hiredOn, sql`CURRENT_DATE`),
              ),
            ),
        ),
        count(
          tx
            .select({ n })
            .from(t.absenceRequests)
            .where(
              and(
                eq(t.absenceRequests.status, 'approved'),
                lte(t.absenceRequests.startDate, sql`CURRENT_DATE`),
                gte(t.absenceRequests.endDate, sql`CURRENT_DATE`),
              ),
            ),
        ),
        count(
          tx.select({ n }).from(t.absenceRequests).where(eq(t.absenceRequests.status, 'pending')),
        ),
        count(
          tx
            .select({ n })
            .from(t.absenceRequests)
            .where(
              and(
                eq(t.absenceRequests.status, 'approved'),
                // Strictement FUTURES : une absence en cours est déjà comptée
                // dans absentToday, la recompter gonflerait la même tuile.
                sql`${t.absenceRequests.startDate} > CURRENT_DATE`,
                lte(t.absenceRequests.startDate, sql`CURRENT_DATE + 30`),
              ),
            ),
        ),
        count(tx.select({ n }).from(t.orgUnits).where(isNull(t.orgUnits.deletedAt))),
        // « prête » est terminal : la compter ferait un badge qui ne redescend
        // jamais alors que la RH n'a plus rien à faire.
        isManage
          ? count(
              tx
                .select({ n })
                .from(t.documentRequests)
                .where(inArray(t.documentRequests.status, ['received', 'processing'])),
            )
          : Promise.resolve(0),
        isManage
          ? count(
              tx
                .select({ n })
                .from(t.profileChangeRequests)
                .where(eq(t.profileChangeRequests.status, 'pending')),
            )
          : Promise.resolve(0),
        tx
          .select({ gender: t.persons.gender, n })
          .from(t.employees)
          .innerJoin(t.persons, eq(t.persons.id, t.employees.personId))
          .where(eq(t.employees.status, 'active'))
          .groupBy(t.persons.gender),
        // Effectif par DIRECTION : l'affectation vise souvent un service — on
        // remonte l'arbre jusqu'à la direction qui le coiffe.
        tx.execute<{ name: string; short_name: string | null; headcount: number }>(sql`
          WITH RECURSIVE tree AS (
            SELECT id AS dir_id, id AS unit_id, name, short_name
            FROM org_units WHERE unit_type = 'direction' AND deleted_at IS NULL
            UNION ALL
            SELECT tree.dir_id, o.id, tree.name, tree.short_name
            FROM org_units o JOIN tree ON o.parent_id = tree.unit_id
            WHERE o.deleted_at IS NULL
          )
          SELECT tree.name, tree.short_name,
                 count(e.id)::int AS headcount
          FROM tree
          LEFT JOIN assignments a
            ON a.org_unit_id = tree.unit_id AND a.validity @> CURRENT_DATE
          LEFT JOIN employees e
            ON e.id = a.employee_id AND e.status = 'active'
          GROUP BY tree.dir_id, tree.name, tree.short_name
          ORDER BY headcount DESC, tree.name`),
        tx
          .select({ day: sql<string>`${t.holidays.day}::text`, label: t.holidays.label })
          .from(t.holidays)
          .where(gte(t.holidays.day, sql`CURRENT_DATE`))
          .orderBy(asc(t.holidays.day))
          .limit(3),
        tx
          .select({
            employeeId: t.employees.id,
            givenName: t.persons.givenName,
            familyName: t.persons.familyName,
            hiredOn: t.employees.hiredOn,
            positionTitle: sql<string | null>`(
              SELECT a.position_title FROM assignments a
              WHERE a.employee_id = employees.id AND a.validity @> CURRENT_DATE
              LIMIT 1)`,
          })
          .from(t.employees)
          .innerJoin(t.persons, eq(t.persons.id, t.employees.personId))
          // « depuis le ... » exige une date passée : un dossier préparé en
          // avance apparaîtra ici le jour de la prise de poste, pas avant.
          .where(and(eq(t.employees.status, 'active'), lte(t.employees.hiredOn, sql`CURRENT_DATE`)))
          .orderBy(desc(t.employees.hiredOn), desc(t.employees.id))
          .limit(3),
      ]);

      const byGender = Object.fromEntries(genders.map((g) => [g.gender ?? '?', g.n]));

      return {
        activeEmployees,
        hiredLast90d,
        absentToday,
        pendingRequests,
        upcomingAbsences,
        orgUnits,
        pendingDocumentRequests,
        pendingProfileChanges,
        women: byGender['female'] ?? 0,
        men: byGender['male'] ?? 0,
        headcountByDirection: directions.rows.map((d) => ({
          name: d.name,
          shortName: d.short_name,
          headcount: d.headcount,
        })),
        upcomingHolidays: holidays,
        recentHires: hires.map((h) => ({
          employeeId: h.employeeId,
          name: `${h.givenName} ${h.familyName}`,
          positionTitle: h.positionTitle,
          hiredOn: h.hiredOn,
        })),
      };
    });
  }
}
