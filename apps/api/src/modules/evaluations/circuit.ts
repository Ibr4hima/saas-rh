import { sql, type SQL } from 'drizzle-orm';
import { periodeDEvaluationEnLettres } from '@teranga/contracts';
import type { Tx } from '../../db/tenant-db';
import { retirerLesAppels, tenirLesAppels } from '../acces/appels';
import { notifierChacun } from '../notifications/notifier';
import { DG } from '../people/chaine';
import { enActivite, enStage } from '../people/en-activite';

/* ────────────────────────────────────────────────────────────────
   Le circuit d'une grille d'évaluation (ADR-0149) : qui elle attend, et
   l'appel que reçoit cette personne.

   · le N+1, quand l'agent l'a renvoyée ou validée, et quand le N+2 l'a
     validée (ADR-0154) : son appel suit le N+1 d'aujourd'hui, comme celui
     d'un congé à viser ;
   · l'agent, une fois la grille envoyée par le N+1 ;
   · le N+2, une fois la grille transmise par le N+1.

   Les appels d'une grille ont pour clé `evaluation:<agent>:<année>`.
   ──────────────────────────────────────────────────────────────── */

export const prefixeDeLaGrille = (employeeId: string, annee: number) =>
  `evaluation:${employeeId}:${annee}`;

/** La grille, côté N+1 et N+2. */
export const lienDeLEquipe = (employeeId: string, annee: number) =>
  `/moi/equipe/evaluations/${employeeId}?annee=${annee}`;

/** La grille, côté agent. */
export const lienDeLAgent = (annee: number) => `/moi/evaluation?annee=${annee}`;

/**
 * Un agent qu'on évalue : un dossier en activité, hors stage, qui n'est pas
 * le DG. En SQL, sur l'alias d'un agent.
 */
export const evaluable = (e: SQL) =>
  sql`(${e}.status = 'active' AND ${e}.id IS DISTINCT FROM ${DG}
       AND ${enActivite(sql`${e}.id`)} AND NOT ${enStage(sql`${e}.id`)})`;

/**
 * Les grilles qui attendent le N+1 : renvoyées par l'agent, validées par
 * l'agent ou par le N+2. Leur appel va au N+1 d'aujourd'hui ; sans N+1 en
 * activité, il s'en va. Idempotente.
 */
export async function reconcilierLesGrilles(tx: Tx, employeeId?: string): Promise<void> {
  const { rows } = await tx.execute<{
    tenant_id: string;
    employee_id: string;
    annee: number;
    etat: string;
    nom: string;
    n2: string | null;
    n1: string | null;
  }>(sql`
    SELECT g.tenant_id, g.employee_id, g.annee, g.etat,
           p.given_name || ' ' || p.family_name AS nom,
           (g.n2_identite ->> 'prenom') || ' ' || (g.n2_identite ->> 'nom') AS n2,
           (SELECT pn.user_id FROM employees n JOIN persons pn ON pn.id = n.person_id
             WHERE n.id = e.manager_employee_id AND n.status = 'active'
               AND pn.deleted_at IS NULL) AS n1
      FROM evaluation_grilles g
      JOIN employees e ON e.id = g.employee_id
      JOIN persons p ON p.id = e.person_id
     WHERE (g.etat IN ('validee_agent', 'validee_n2')
            OR (g.etat = 'brouillon' AND g.renvoyee_le IS NOT NULL))
       ${employeeId ? sql`AND g.employee_id = ${employeeId}` : sql``}`);
  for (const r of rows) {
    const prefixe = prefixeDeLaGrille(r.employee_id, r.annee);
    if (!r.n1) {
      await retirerLesAppels(tx, prefixe);
      continue;
    }
    await tenirLesAppels(tx, r.tenant_id, prefixe, 'n1', [r.n1], {
      type: 'evaluation',
      sujet: 'equipe.evaluations',
      title:
        r.etat === 'validee_n2'
          ? `${r.n2 ?? 'Le N+2'} a validé la grille d’évaluation ${r.annee} de ${r.nom}`
          : r.etat === 'validee_agent'
            ? `${r.nom} a validé sa grille d’évaluation ${r.annee}`
            : `${r.nom} vous renvoie sa grille d’évaluation ${r.annee}`,
      link: lienDeLEquipe(r.employee_id, r.annee),
    });
  }
}

/**
 * La période d'une année s'ouvre : chaque N+1 qui a des agents à évaluer en
 * est prévenu, une fois. Entre le premier et le dernier jour de la période
 * seulement. Idempotente.
 */
export async function annoncerLOuverture(
  tx: Tx,
  tenantId: string,
  aujourdhui?: string,
): Promise<void> {
  const { rows: periodes } = await tx.execute<{
    id: string;
    annee: number;
    du: string;
    au: string;
  }>(sql`
    SELECT id, annee, du::text AS du, au::text AS au FROM evaluation_periodes
     WHERE ouverture_annoncee_le IS NULL
       AND COALESCE(${aujourdhui ?? null}::date, CURRENT_DATE) BETWEEN du AND au`);
  for (const p of periodes) {
    const { rows } = await tx.execute<{ user_id: string }>(sql`
      SELECT DISTINCT pn.user_id
        FROM employees e
        JOIN employees n ON n.id = e.manager_employee_id AND n.status = 'active'
        JOIN persons pn ON pn.id = n.person_id
       WHERE ${evaluable(sql`e`)} AND pn.user_id IS NOT NULL AND pn.deleted_at IS NULL`);
    await notifierChacun(
      tx,
      tenantId,
      rows.map((r) => ({
        userId: r.user_id,
        type: 'evaluation',
        sujet: 'equipe.evaluations' as const,
        title: `La période d’évaluation ${p.annee} est ouverte ${periodeDEvaluationEnLettres(p)}`,
        link: `/moi/equipe/evaluations?annee=${p.annee}`,
        dedupeKey: `evaluation:ouverture:${p.annee}`,
      })),
    );
    await tx.execute(
      sql`UPDATE evaluation_periodes SET ouverture_annoncee_le = now() WHERE id = ${p.id}`,
    );
  }
}
