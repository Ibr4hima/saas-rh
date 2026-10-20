import { sql } from 'drizzle-orm';
import {
  JOUR_D_EVALUATION_PAR_DEFAUT,
  dateDEvaluation,
  ouvertureDeLAutoEvaluation,
} from '@teranga/contracts';
import type { Tx } from '../../db/tenant-db';
import { retirerLesAppels, tenirLesAppels } from '../acces/appels';
import { notifierChacun } from '../notifications/notifier';
import { deLAnnee } from '../notifications/phrases';
import { DG, n1Fonctionnel } from '../people/chaine';

/** Le jour de l'évaluation de l'organisation, « MM-JJ » : le 15 décembre sans réglage. */
export async function lireLeJourDEvaluation(tx: Tx): Promise<string> {
  const { rows } = await tx.execute<{ review_month: number; review_day: number }>(
    sql`SELECT review_month, review_day FROM objective_review_schedule`,
  );
  const r = rows[0];
  if (!r) return JOUR_D_EVALUATION_PAR_DEFAUT;
  return `${String(r.review_month).padStart(2, '0')}-${String(r.review_day).padStart(2, '0')}`;
}

/** Une case à cocher qui dit quelque chose, ou une formation, à quelque profondeur que ce soit. */
const CONTIENT_UN_OBJECTIF =
  'strict $.** ? ((@.type == "checkListItem" && exists(@.content[*] ? (@.type == "text" && @.text like_regex "[^[:space:]]"))) || @.type == "formation")';

/**
 * L'auto-évaluation de l'année s'ouvre (ADR-0076) : chaque agent qui a des
 * objectifs pour l'année, un N+1 à qui l'envoyer et rien d'envoyé encore en
 * est prévenu, une fois. De l'ouverture au jour de l'évaluation seulement :
 * une année passée ne se rappelle pas. Idempotente.
 */
export async function prevenirDeLOuverture(
  tx: Tx,
  tenantId: string,
  aujourdhui?: string,
): Promise<void> {
  const jour = await lireLeJourDEvaluation(tx);
  const { rows: horloge } = await tx.execute<{ jour: string }>(
    sql`SELECT COALESCE(${aujourdhui ?? null}::date, current_date)::text AS jour`,
  );
  const date = horloge[0]!.jour;
  const annee = Number(date.slice(0, 4));
  if (date < ouvertureDeLAutoEvaluation(annee, jour) || date > dateDEvaluation(annee, jour)) {
    return;
  }
  // Une fiche qui a un objectif : une case qui dit quelque chose, ou une formation.
  const { rows } = await tx.execute<{ employee_id: string; user_id: string }>(sql`
    SELECT f.employee_id, p.user_id
      FROM objectifs_fiches f
      JOIN employees e ON e.id = f.employee_id
      JOIN persons p ON p.id = e.person_id
     WHERE f.annee = ${annee} AND f.commentaires_envoyes_le IS NULL
       AND e.status = 'active' AND p.user_id IS NOT NULL AND p.deleted_at IS NULL
       AND ${n1Fonctionnel('e')} IS NOT NULL AND e.id IS DISTINCT FROM ${DG}
       AND jsonb_path_exists(f.contenu, ${CONTIENT_UN_OBJECTIF}::jsonpath)`);
  await notifierChacun(
    tx,
    tenantId,
    rows.map((r) => ({
      userId: r.user_id,
      type: 'objectif',
      sujet: 'objectifs' as const,
      title: `Votre auto-évaluation ${deLAnnee(annee)} est ouverte`,
      link: `/moi/objectifs?annee=${annee}`,
      dedupeKey: `objectifs:ouverture:${r.employee_id}:${annee}`,
    })),
  );
}

/** Les appels à évaluer une fiche : un par auto-évaluation envoyée, une par année. */
export const prefixeEvaluation = (employeeId: string, annee: number) =>
  `objectifs:${employeeId}:${annee}`;

/**
 * Une auto-évaluation envoyée attend le N+1 fonctionnel d'aujourd'hui
 * (ADR-0147). Son appel le suit : l'agent change de N+1, le nouveau est
 * appelé et l'ancien perd le sien. Un N+1 sans accès ouvert l'est dès l'ouverture de son accès.
 * Idempotente.
 */
export async function reconcilierLesEvaluations(tx: Tx, employeeId?: string): Promise<void> {
  // Une fiche qui n'attend plus d'évaluation (validée, ou rouverte) ne garde
  // pas d'appel.
  // Le préfixe par `^@` (leakproof) borne la lecture dans l'index des clés ;
  // l'expression régulière ne trie plus que les clés des objectifs.
  await tx.execute(sql`
    DELETE FROM notifications n
     WHERE n.dedupe_key ^@ ${employeeId ? `objectifs:${employeeId}:` : 'objectifs:'}
       AND n.dedupe_key ~ '^objectifs:[0-9a-f-]{36}:[0-9]{4}:(appel|rappel):'
       AND NOT EXISTS (
         SELECT 1 FROM objectifs_fiches f
          WHERE f.commentaires_envoyes_le IS NOT NULL AND f.evaluation_validee_le IS NULL
            AND n.dedupe_key ^@ ('objectifs:' || f.employee_id || ':' || f.annee || ':'))`);
  const { rows } = await tx.execute<{
    tenant_id: string;
    employee_id: string;
    annee: number;
    nom: string;
    n1: string | null;
  }>(sql`
    SELECT f.tenant_id, f.employee_id, f.annee,
           p.given_name || ' ' || p.family_name AS nom,
           (SELECT pn.user_id FROM employees n JOIN persons pn ON pn.id = n.person_id
             WHERE n.id = ${n1Fonctionnel('e')} AND n.status = 'active'
               AND pn.deleted_at IS NULL AND e.id IS DISTINCT FROM ${DG}) AS n1
      FROM objectifs_fiches f
      JOIN employees e ON e.id = f.employee_id
      JOIN persons p ON p.id = e.person_id
     WHERE f.commentaires_envoyes_le IS NOT NULL AND f.evaluation_validee_le IS NULL
       ${employeeId ? sql`AND f.employee_id = ${employeeId}` : sql``}`);
  for (const r of rows) {
    const prefixe = prefixeEvaluation(r.employee_id, r.annee);
    if (!r.n1) {
      await retirerLesAppels(tx, prefixe);
      continue;
    }
    await tenirLesAppels(tx, r.tenant_id, prefixe, 'n1', [r.n1], {
      type: 'objectif',
      sujet: 'equipe.objectifs',
      title: `${r.nom} a envoyé son auto-évaluation ${deLAnnee(r.annee)}`,
      // L'année de la fiche : la page du direct n'en montre qu'une à la fois.
      link: `/moi/equipe/suivi/${r.employee_id}?vue=evaluation&annee=${r.annee}`,
    });
  }
}
