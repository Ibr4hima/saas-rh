import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common';
import { and, asc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
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
    // Le suivi des contrats est une donnée de gestion : le manager voit son
    // équipe dans les autres cartes, pas les échéances contractuelles.
    const seesContracts = isManage || user.role === 'payroll';

    /**
     * Contrats à durée limitée en cours. Le contrat retenu est le PLUS RÉCENT
     * de l'employé (DISTINCT ON) : un CDD renouvelé en CDI quitte le suivi de
     * lui-même. Les échéances dépassées remontent en tête — un CDD échu sur un
     * dossier resté actif est l'anomalie la plus coûteuse de la liste.
     */
    const followUpSql = (limit: number | null) => sql`
      WITH dernier AS (
        SELECT DISTINCT ON (c.employee_id)
               c.employee_id, c.contract_type, c.end_date
        FROM contracts c
        ORDER BY c.employee_id, c.start_date DESC, c.created_at DESC
      )
      SELECT e.id AS employee_id, e.employee_number,
             p.given_name, p.family_name,
             d.contract_type, d.end_date::text AS end_date,
             (d.end_date - CURRENT_DATE)::int AS days_left,
             (SELECT a.position_title FROM assignments a
               WHERE a.employee_id = e.id AND a.validity @> CURRENT_DATE
               LIMIT 1) AS position_title
      FROM dernier d
      JOIN employees e ON e.id = d.employee_id AND e.status = 'active'
      JOIN persons p ON p.id = e.person_id
      WHERE d.contract_type IN ('cdd', 'stage')
      ORDER BY days_left ASC NULLS LAST, p.family_name, p.given_name
      ${limit === null ? sql`` : sql`LIMIT ${limit}`}`;

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
        followUp,
        followUpTotal,
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
        // La carte n'affiche que les plus urgents ; le total suit, pour que le
        // reste soit annoncé plutôt que tu.
        seesContracts
          ? tx.execute<{
              employee_id: string;
              employee_number: string;
              given_name: string;
              family_name: string;
              contract_type: string;
              end_date: string | null;
              days_left: number | null;
              position_title: string | null;
            }>(followUpSql(8))
          : Promise.resolve({ rows: [] as never[] }),
        seesContracts
          ? count(
              tx
                .execute<{ n: number }>(
                  sql`SELECT count(*)::int AS n FROM (${followUpSql(null)}) s`,
                )
                .then((r) => r.rows),
            )
          : Promise.resolve(0),
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
        contractFollowUp: followUp.rows.map((c) => ({
          employeeId: c.employee_id,
          employeeNumber: c.employee_number,
          name: `${c.given_name} ${c.family_name}`,
          positionTitle: c.position_title,
          contractType: c.contract_type,
          endDate: c.end_date,
          daysLeft: c.days_left,
        })),
        contractFollowUpTotal: followUpTotal,
      };
    });
  }
}
