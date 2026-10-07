import { Injectable } from '@nestjs/common';
import { and, desc, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { AcademyCategory, TeamCourseProgress } from '@teranga/contracts';
import * as t from '../../db/schema';
import type { Tx } from '../../db/tenant-db';
import { taillesDesBanques } from './academy-evaluation.service';
import { statutSuivi } from './suivi';
import { statutCertificat } from './evaluation';

/*
   APIX Academy : où en sont des agents sur les formations du catalogue.
   La fiche d'objectifs s'en sert pour les formations à suivre.

   Tout se calcule en quelques requêtes pour tous les agents demandés :
   quarante agents ne font pas quarante allers-retours.
 */

@Injectable()
export class AcademySuiviService {
  /** L'horloge du serveur, remplaçable dans les tests seulement. */
  horloge: () => Date = () => new Date();

  /**
   * Où en est chaque agent sur chaque formation du catalogue — plus les
   * certificats valides de formations retirées depuis, qu'il tient toujours.
   */
  async suivi(tx: Tx, employeeIds: string[]): Promise<Map<string, TeamCourseProgress[]>> {
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
}
