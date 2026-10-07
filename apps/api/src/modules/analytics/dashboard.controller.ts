import { Controller, Get, Inject, Logger, Req, UseGuards } from '@nestjs/common';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { peut, type DashboardView } from '@teranga/contracts';
import * as t from '../../db/schema';
import { TenantDb } from '../../db/tenant-db';
import { AccesGuard, Peut } from '../auth/acces.guard';
import { absencesDesTrenteJours, AbsencesService } from '../time/absences.service';
import { expirerLesDemandes } from '../time/visas';
import { inactiverLesContratsEchus } from '../people/activite';
import { suiviDesContrats } from '../people/suivi-contrats';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';

@Controller()
@UseGuards(SessionGuard, AccesGuard)
@Peut('pilotage')
export class DashboardController {
  private readonly logger = new Logger(DashboardController.name);

  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(AbsencesService) private readonly absences: AbsencesService,
  ) {}

  /**
   * Tout le tableau de bord en un appel. L'écran d'accueil est la page la plus
   * vue du produit : une requête par carte en ferait dix — tout part ensemble,
   * chaque bloc reste une requête SQL simple exécutée en parallèle.
   */
  @Get('dashboard')
  async stats(@Req() req: AuthenticatedRequest): Promise<DashboardView> {
    const user = req.sessionUser;
    const seesContracts = peut(user, 'pilotage') || peut(user, 'personnel.consulter');
    const ctx = { tenantId: user.tenantId, userId: user.userId };

    // Chaque chiffre compte ce que montre l'écran qu'il ouvre. Les contrats
    // échus passent d'abord dans les inactifs, comme avant la liste du
    // personnel ; dans leur transaction, et sans priver l'accueil s'ils
    // échouent.
    try {
      await this.db.withTenant(ctx, (tx) => inactiverLesContratsEchus(tx, user.tenantId));
    } catch (err) {
      this.logger.error(
        `Fin des contrats échus impossible (tenant ${user.tenantId}) : l'accueil est servi sans elle.`,
        err instanceof Error ? err.stack : String(err),
      );
    }

    return this.db.withTenant(ctx, async (tx) => {
      const count = async (query: Promise<Array<{ n: number }>>) => (await query)[0]?.n ?? 0;
      const n = sql<number>`count(*)::int`;
      // Les demandes échues s'en vont, et les fériés de l'année existent,
      // avant qu'on les compte : comme sur leurs écrans.
      await expirerLesDemandes(tx);
      await this.absences.semerAutourDAujourdhui(tx, user.tenantId);

      const [
        activeEmployees,
        absentToday,
        upcomingAbsences,
        genders,
        ages,
        directions,
        holidays,
        followUp,
      ] = await Promise.all([
        count(tx.select({ n }).from(t.employees).where(eq(t.employees.status, 'active'))),
        // Le calendrier des absences, coupé en deux : en cours, puis à venir.
        count(
          tx
            .select({ n })
            .from(t.absenceRequests)
            .where(
              and(...absencesDesTrenteJours(), lte(t.absenceRequests.startDate, sql`CURRENT_DATE`)),
            ),
        ),
        count(
          tx
            .select({ n })
            .from(t.absenceRequests)
            .where(
              and(
                ...absencesDesTrenteJours(),
                gte(t.absenceRequests.startDate, sql`CURRENT_DATE + 1`),
              ),
            ),
        ),
        tx
          .select({ gender: t.persons.gender, n })
          .from(t.employees)
          .innerJoin(t.persons, eq(t.persons.id, t.employees.personId))
          .where(eq(t.employees.status, 'active'))
          .groupBy(t.persons.gender),
        // L'âge de l'effectif actif, en années révolues : ceux dont la date de
        // naissance est connue.
        tx.execute<{
          moyenne: string | null;
          jeune: number | null;
          age: number | null;
          n: number;
        }>(sql`
          SELECT round(avg(a.ans)::numeric, 1)::text AS moyenne, min(a.ans)::int AS jeune,
                 max(a.ans)::int AS age, count(*)::int AS n
            FROM (SELECT date_part('year', age(CURRENT_DATE, p.birth_date)) AS ans
                    FROM employees e JOIN persons p ON p.id = e.person_id
                   WHERE e.status = 'active' AND p.birth_date IS NOT NULL) a`),
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
          ),
          -- L'affectation de chacun, comme la liste du personnel la lit : en
          -- cours, sinon la prochaine.
          affecte AS (
            SELECT e.id AS employee_id,
                   (SELECT av.org_unit_id FROM assignments av
                     WHERE av.employee_id = e.id
                       AND (av.validity @> CURRENT_DATE OR lower(av.validity) > CURRENT_DATE)
                     ORDER BY lower(av.validity) LIMIT 1) AS unite_id
              FROM employees e WHERE e.status = 'active'
          )
          SELECT d.id AS dir_id, d.name, d.short_name, count(af.employee_id)::int AS headcount
          FROM org_units d
          LEFT JOIN direction_de dd ON dd.dir_id = d.id
          LEFT JOIN affecte af ON af.unite_id = dd.unite_id
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
        // Tous les contrats suivis : le tableau de bord en est la seule liste.
        seesContracts ? suiviDesContrats(tx) : Promise.resolve([]),
      ]);

      const byGender = Object.fromEntries(genders.map((g) => [g.gender ?? '?', g.n]));
      const age = ages.rows[0];

      return {
        activeEmployees,
        absentToday,
        averageAge: age?.moyenne != null ? Number(age.moyenne) : null,
        youngestAge: age?.jeune ?? null,
        oldestAge: age?.age ?? null,
        agesKnown: age?.n ?? 0,
        upcomingAbsences,
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
      };
    });
  }
}
