import { sql } from 'drizzle-orm';
import type { Tx } from '../../db/tenant-db';
import { retirerLesAppels, tenirLesAppels } from '../acces/appels';
import { duSemestre } from '../notifications/phrases';
import { DG } from '../people/chaine';

/** Les appels à évaluer une fiche : un par auto-évaluation envoyée. */
export const prefixeEvaluation = (employeeId: string, annee: number, semestre: number) =>
  `objectifs:${employeeId}:${annee}:${semestre}`;

/**
 * Une auto-évaluation envoyée attend le N+1 d'aujourd'hui. Son appel le
 * suit : l'agent change de N+1, le nouveau est appelé et l'ancien perd le
 * sien. Un N+1 sans accès ouvert l'est dès qu'il en a un. Idempotente.
 */
export async function reconcilierLesEvaluations(tx: Tx, employeeId?: string): Promise<void> {
  // Une fiche qui n'attend plus d'évaluation (validée, ou rouverte) ne garde
  // pas d'appel.
  await tx.execute(sql`
    DELETE FROM notifications n
     WHERE n.dedupe_key ~ '^objectifs:[0-9a-f-]{36}:[0-9]{4}:[12]:(appel|rappel):'
       ${employeeId ? sql`AND n.dedupe_key LIKE ${`objectifs:${employeeId}:%`}` : sql``}
       AND NOT EXISTS (
         SELECT 1 FROM objectifs_fiches f
          WHERE f.commentaires_envoyes_le IS NOT NULL AND f.evaluation_validee_le IS NULL
            AND n.dedupe_key LIKE 'objectifs:' || f.employee_id || ':' || f.annee || ':'
                                  || f.semestre || ':%')`);
  const { rows } = await tx.execute<{
    tenant_id: string;
    employee_id: string;
    annee: number;
    semestre: number;
    nom: string;
    n1: string | null;
  }>(sql`
    SELECT f.tenant_id, f.employee_id, f.annee, f.semestre,
           p.given_name || ' ' || p.family_name AS nom,
           (SELECT pn.user_id FROM employees n JOIN persons pn ON pn.id = n.person_id
             WHERE n.id = e.manager_employee_id AND n.status = 'active'
               AND pn.deleted_at IS NULL AND e.id IS DISTINCT FROM ${DG}) AS n1
      FROM objectifs_fiches f
      JOIN employees e ON e.id = f.employee_id
      JOIN persons p ON p.id = e.person_id
     WHERE f.commentaires_envoyes_le IS NOT NULL AND f.evaluation_validee_le IS NULL
       ${employeeId ? sql`AND f.employee_id = ${employeeId}` : sql``}`);
  for (const r of rows) {
    const prefixe = prefixeEvaluation(r.employee_id, r.annee, r.semestre);
    if (!r.n1) {
      await retirerLesAppels(tx, prefixe);
      continue;
    }
    await tenirLesAppels(tx, r.tenant_id, prefixe, 'n1', [r.n1], {
      type: 'objectif',
      sujet: 'equipe.objectifs',
      title: `${r.nom} a envoyé son auto-évaluation ${duSemestre(r.semestre, r.annee)}`,
      // L'année de la fiche : la page du direct n'en montre qu'une à la fois.
      link: `/moi/equipe/suivi/${r.employee_id}?vue=evaluation&annee=${r.annee}`,
    });
  }
}
