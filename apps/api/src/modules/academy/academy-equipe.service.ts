import { Inject, Injectable } from '@nestjs/common';
import { and, desc, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type {
  AcademyCategory,
  SessionUser,
  TeamCourseProgress,
  TeamMember,
  TeamMemberDetail,
  TeamSize,
  TeamView,
} from '@teranga/contracts';
import { problem } from '../../common/problem';
import * as t from '../../db/schema';
import { TenantDb, type Tx } from '../../db/tenant-db';
import { employeActif, taillesDesBanques } from './academy-evaluation.service';
import { compterStatuts, ordreDeSuivi, statutSuivi } from './equipe';
import { statutCertificat } from './evaluation';

/* ————————————————————————————————————————————————————————————————
   APIX Academy — « Mon équipe » : ce que le n+1 voit de la progression de
   ceux qui lui rendent compte.

   L'équipe se lit dans l'ORGANIGRAMME, à partir du dossier d'agent relié au
   compte : ceux dont il est le n+1, puis les leurs, jusqu'au bout de la
   chaîne. Aucun rôle n'entre en compte — un agent qui encadre voit son
   équipe, un compte RH sans équipe n'en voit aucune. Hors de cette chaîne,
   un agent n'existe pas : sa fiche répond « introuvable », pas « interdit ».

   Tout se calcule en quelques requêtes pour l'équipe entière : une direction
   de deux cents agents ne fait pas deux cents allers-retours.
   ———————————————————————————————————————————————————————————————— */

/**
 * Garde-fou contre une boucle dans l'organigramme. La saisie les refuse
 * déjà ; une donnée importée à la main ne doit pas pour autant faire tourner
 * la requête sans fin.
 */
const PROFONDEUR_MAX = 30;

interface LigneAgent extends Record<string, unknown> {
  id: string;
  niveau: number;
  responsable_id: string;
  responsable_prenom: string;
  responsable_nom: string;
  employee_number: string;
  given_name: string;
  family_name: string;
  position_title: string | null;
  unite: string | null;
}

@Injectable()
export class AcademyEquipeService {
  /** L'horloge du serveur — remplaçable dans les tests seulement. */
  horloge: () => Date = () => new Date();

  constructor(@Inject(TenantDb) private readonly db: TenantDb) {}

  private ctx(user: SessionUser) {
    return { tenantId: user.tenantId, userId: user.userId };
  }

  /** Combien d'agents vous rendent compte — de quoi montrer l'entrée, ou pas. */
  async effectif(user: SessionUser): Promise<TeamSize> {
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const agents = await this.agents(tx, user);
      return { total: agents.length, direct: agents.filter((a) => a.niveau === 1).length };
    });
  }

  async equipe(user: SessionUser): Promise<TeamView> {
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const agents = await this.agents(tx, user);
      const suivi = await this.suivi(
        tx,
        agents.map((a) => a.id),
      );
      return { members: agents.map((a) => this.membre(a, suivi.get(a.id) ?? [])) };
    });
  }

  async agent(user: SessionUser, employeeId: string): Promise<TeamMemberDetail> {
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const agent = (await this.agents(tx, user)).find((a) => a.id === employeeId);
      if (!agent) {
        problem(
          404,
          'academy.team_member_not_found',
          'Cet agent ne fait pas partie de votre équipe',
        );
      }
      const formations = (await this.suivi(tx, [agent.id])).get(agent.id) ?? [];
      formations.sort(ordreDeSuivi);
      return { ...this.membre(agent, formations), courses: formations };
    });
  }

  // ———————————————————————————— lectures

  /**
   * Les agents ACTIFS de la chaîne descendante, avec leur poste du jour et
   * leur n+1. Un agent qui rend compte à un dossier archivé reste dans la
   * chaîne : l'organigramme a un trou, l'équipe n'en perd pas pour autant.
   */
  private async agents(tx: Tx, user: SessionUser): Promise<LigneAgent[]> {
    const moi = await employeActif(tx, user.userId);
    if (!moi) return [];
    const { rows } = await tx.execute<LigneAgent>(sql`
      WITH RECURSIVE chaine AS (
        SELECT e.id, e.manager_employee_id AS responsable_id, 1 AS niveau
          FROM employees e
         WHERE e.manager_employee_id = ${moi}
        UNION ALL
        SELECT e.id, e.manager_employee_id, c.niveau + 1
          FROM employees e
          JOIN chaine c ON e.manager_employee_id = c.id
         WHERE c.niveau < ${PROFONDEUR_MAX} AND e.id <> ${moi}
      )
      SELECT DISTINCT ON (c.id)
             c.id, c.niveau, c.responsable_id,
             rp.given_name AS responsable_prenom, rp.family_name AS responsable_nom,
             e.employee_number, p.given_name, p.family_name,
             a.position_title, o.name AS unite
        FROM chaine c
        JOIN employees e ON e.id = c.id AND e.status = 'active'
        JOIN persons p ON p.id = e.person_id AND p.deleted_at IS NULL
        JOIN employees re ON re.id = c.responsable_id
        JOIN persons rp ON rp.id = re.person_id
        LEFT JOIN LATERAL (
          SELECT position_title, org_unit_id
            FROM assignments
           WHERE employee_id = e.id AND validity @> CURRENT_DATE
           ORDER BY lower(validity) DESC
           LIMIT 1
        ) a ON true
        LEFT JOIN org_units o ON o.id = a.org_unit_id AND o.deleted_at IS NULL
       ORDER BY c.id, c.niveau`);
    return rows
      .map((r) => ({ ...r, niveau: Number(r.niveau) }))
      .sort(
        (a, b) =>
          a.niveau - b.niveau ||
          a.family_name.localeCompare(b.family_name, 'fr') ||
          a.given_name.localeCompare(b.given_name, 'fr'),
      );
  }

  /**
   * Où en est chaque agent sur chaque formation du catalogue — plus les
   * certificats valides de formations retirées depuis, qu'il tient toujours.
   */
  private async suivi(tx: Tx, employeeIds: string[]): Promise<Map<string, TeamCourseProgress[]>> {
    if (employeeIds.length === 0) return new Map();
    const maintenant = this.horloge();

    const formations = await tx
      .select({
        id: t.academyCourses.id,
        title: t.academyCourses.title,
        category: t.academyCourses.category,
      })
      .from(t.academyCourses)
      .where(isNotNull(t.academyCourses.publishedAt));

    // Les leçons qui comptent sont celles que l'agent peut suivre : vidéo
    // prête, dans un module — exactement celles que compte le catalogue.
    const { rows: lecons } = formations.length
      ? await tx.execute<{ course_id: string; n: number }>(sql`
          SELECT l.course_id, count(*)::int AS n
            FROM academy_lessons l
            JOIN academy_modules m ON m.id = l.module_id
           WHERE l.video_status = 'prete' AND l.course_id IN ${formations.map((f) => f.id)}
           GROUP BY l.course_id`)
      : { rows: [] };
    const nombreDeLecons = new Map(lecons.map((l) => [l.course_id, Number(l.n)]));
    const catalogue = formations.filter((f) => (nombreDeLecons.get(f.id) ?? 0) > 0);
    const banques = await taillesDesBanques(
      tx,
      catalogue.map((f) => f.id),
    );

    const { rows: progres } = await tx.execute<{
      employee_id: string;
      course_id: string;
      validees: number;
      derniere: Date | string;
    }>(sql`
      SELECT p.employee_id, l.course_id,
             count(*) FILTER (WHERE p.completed_at IS NOT NULL)::int AS validees,
             max(p.updated_at) AS derniere
        FROM academy_lesson_progress p
        JOIN academy_lessons l ON l.id = p.lesson_id AND l.video_status = 'prete'
        JOIN academy_modules m ON m.id = l.module_id
       WHERE p.employee_id IN ${employeeIds}
       GROUP BY p.employee_id, l.course_id`);

    const { rows: copies } = await tx.execute<{
      employee_id: string;
      course_id: string;
      reussie: boolean;
      rendue: boolean;
      derniere: Date | string | null;
    }>(sql`
      SELECT employee_id, course_id,
             bool_or(passed IS TRUE) AS reussie,
             bool_or(submitted_at IS NOT NULL) AS rendue,
             max(submitted_at) AS derniere
        FROM academy_quiz_attempts
       WHERE employee_id IN ${employeeIds}
       GROUP BY employee_id, course_id`);

    const certificats = await tx
      .select()
      .from(t.academyCertificates)
      .where(
        and(
          inArray(t.academyCertificates.employeeId, employeeIds),
          isNull(t.academyCertificates.revokedAt),
        ),
      )
      .orderBy(desc(t.academyCertificates.issuedAt));

    const cle = (employeeId: string, courseId: string) => `${employeeId}:${courseId}`;
    const progresDe = new Map(progres.map((p) => [cle(p.employee_id, p.course_id), p]));
    const copiesDe = new Map(copies.map((c) => [cle(c.employee_id, c.course_id), c]));
    // Le plus récent d'abord : le premier vu pour une formation est le bon.
    const certificatDe = new Map<string, (typeof certificats)[number]>();
    for (const c of certificats) {
      const k = cle(c.employeeId, c.courseId ?? c.id);
      if (!certificatDe.has(k)) certificatDe.set(k, c);
    }

    const suivi = new Map<string, TeamCourseProgress[]>();
    for (const employeeId of employeeIds) {
      const lignes: TeamCourseProgress[] = catalogue.map((f) => {
        const k = cle(employeeId, f.id);
        const p = progresDe.get(k);
        const copie = copiesDe.get(k);
        const certificat = certificatDe.get(k);
        const statutDuCertificat = certificat ? statutCertificat(certificat, maintenant) : null;
        const activites = [p?.derniere, copie?.derniere]
          .filter((x): x is Date | string => Boolean(x))
          .map((x) => new Date(x).getTime());
        return {
          courseId: f.id,
          title: f.title,
          category: f.category as AcademyCategory,
          lessonCount: nombreDeLecons.get(f.id) ?? 0,
          completedLessons: p ? Number(p.validees) : 0,
          lastActivityAt: activites.length ? new Date(Math.max(...activites)).toISOString() : null,
          hasEvaluation: (banques.get(f.id) ?? 0) > 0,
          status: statutSuivi({
            lecons: nombreDeLecons.get(f.id) ?? 0,
            validees: p ? Number(p.validees) : 0,
            commencee: Boolean(p),
            evaluation: (banques.get(f.id) ?? 0) > 0,
            certifiee: statutDuCertificat === 'valide',
            echec: Boolean(copie?.rendue && !copie.reussie),
          }),
          certificate:
            certificat && statutDuCertificat !== 'revoque'
              ? {
                  score: certificat.score,
                  issuedAt: certificat.issuedAt.toISOString(),
                  expiresAt: certificat.expiresAt?.toISOString() ?? null,
                  status: statutDuCertificat === 'valide' ? 'valide' : 'expire',
                }
              : null,
        };
      });

      // Une formation retirée du catalogue ne se suit plus, mais son
      // certificat, s'il vaut encore, reste un acquis de l'agent.
      const auCatalogue = new Set(catalogue.map((f) => f.id));
      for (const c of certificats) {
        if (c.employeeId !== employeeId) continue;
        if (c.courseId && auCatalogue.has(c.courseId)) continue;
        if (certificatDe.get(cle(employeeId, c.courseId ?? c.id)) !== c) continue;
        if (statutCertificat(c, maintenant) !== 'valide') continue;
        lignes.push({
          courseId: null,
          title: c.courseTitle,
          category: c.courseCategory as AcademyCategory,
          lessonCount: 0,
          completedLessons: 0,
          lastActivityAt: c.issuedAt.toISOString(),
          hasEvaluation: true,
          status: 'certifiee',
          certificate: {
            score: c.score,
            issuedAt: c.issuedAt.toISOString(),
            expiresAt: c.expiresAt?.toISOString() ?? null,
            status: 'valide',
          },
        });
      }
      suivi.set(employeeId, lignes);
    }
    return suivi;
  }

  // ———————————————————————————— assemblage

  private membre(a: LigneAgent, formations: TeamCourseProgress[]): TeamMember {
    const activites = formations
      .map((f) => f.lastActivityAt)
      .filter((x): x is string => x !== null)
      .sort();
    return {
      employeeId: a.id,
      givenName: a.given_name,
      familyName: a.family_name,
      number: a.employee_number,
      positionTitle: a.position_title,
      unitName: a.unite,
      manager: {
        employeeId: a.responsable_id,
        name: `${a.responsable_prenom} ${a.responsable_nom}`,
      },
      level: a.niveau,
      counts: compterStatuts(formations.map((f) => f.status)),
      lastActivityAt: activites.at(-1) ?? null,
    };
  }
}
