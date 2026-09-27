import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common';
import { and, asc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { peut, type DashboardView } from '@teranga/contracts';
import * as t from '../../db/schema';
import { TenantDb } from '../../db/tenant-db';
import { AccesGuard, Peut } from '../auth/acces.guard';
import { compterEnAttenteDCH } from '../time/visas';
import { compterLeSuiviDesContrats, suiviDesContrats } from '../people/suivi-contrats';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';

@Controller()
@UseGuards(SessionGuard, AccesGuard)
@Peut('pilotage')
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
    // Les files de la DCH ne se comptent que pour qui les voit.
    const isManage = peut(user, 'personnel.consulter');
    const seesContracts = peut(user, 'pilotage') || isManage;

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
        // Ce qui attend la DCH — pas ce qui attend encore le N+1 : un badge
        // qui compte une demande qu'on ne peut pas encore traiter fait
        // cliquer pour rien. Le circuit en décide, demande par demande.
        compterEnAttenteDCH(tx),
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
        // remonte l'arbre jusqu'à la PLUS PROCHE direction qui le coiffe, et
        // chacun n'est compté qu'une fois. Descendre depuis chaque direction
        // comptait un agent dans la sienne ET dans toutes celles au-dessus
        // (la Direction Générale les avait tous) : la somme dépassait
        // l'effectif, et « sans affectation » ne s'affichait jamais.
        tx.execute<{
          dir_id: string;
          name: string;
          short_name: string | null;
          headcount: number;
        }>(sql`
          WITH RECURSIVE remontee AS (
            SELECT id AS depart, id, parent_id, unit_type, 0 AS prof
              FROM org_units WHERE deleted_at IS NULL
            UNION ALL
            SELECT r.depart, o.id, o.parent_id, o.unit_type, r.prof + 1
              FROM remontee r JOIN org_units o ON o.id = r.parent_id AND o.deleted_at IS NULL
             WHERE r.prof < 50
          ),
          direction_de AS (
            SELECT DISTINCT ON (depart) depart AS unite_id, id AS dir_id
              FROM remontee WHERE unit_type = 'direction'
             ORDER BY depart, prof
          )
          SELECT d.id AS dir_id, d.name, d.short_name, count(e.id)::int AS headcount
          FROM org_units d
          LEFT JOIN direction_de dd ON dd.dir_id = d.id
          LEFT JOIN assignments a
            ON a.org_unit_id = dd.unite_id AND a.validity @> CURRENT_DATE
          LEFT JOIN employees e
            ON e.id = a.employee_id AND e.status = 'active'
          WHERE d.unit_type = 'direction' AND d.deleted_at IS NULL
          GROUP BY d.id, d.name, d.short_name
          ORDER BY headcount DESC, d.name`),
        // Une frise a besoin d'un avant : le férié qui vient de passer ancre
        // « aujourd'hui » quelque part sur le rail, au lieu de le laisser
        // flotter avant la première date. Un seul, et les trois qui viennent.
        tx.execute<{ day: string; label: string }>(sql`
          (SELECT day::text AS day, label FROM holidays
             WHERE day < CURRENT_DATE ORDER BY day DESC LIMIT 1)
          UNION ALL
          (SELECT day::text AS day, label FROM holidays
             WHERE day >= CURRENT_DATE ORDER BY day ASC LIMIT 3)
          ORDER BY day`),
        // La carte n'affiche que les plus urgents ; le total suit, pour que le
        // reste soit annoncé plutôt que tu.
        seesContracts ? suiviDesContrats(tx, 8) : Promise.resolve([]),
        seesContracts ? compterLeSuiviDesContrats(tx) : Promise.resolve(0),
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
          id: d.dir_id,
          name: d.name,
          shortName: d.short_name,
          headcount: d.headcount,
        })),
        holidayWindow: holidays.rows,
        contractFollowUp: followUp,
        contractFollowUpTotal: followUpTotal,
      };
    });
  }
}
