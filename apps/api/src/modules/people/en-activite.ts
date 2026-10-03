import { sql, type SQL } from 'drizzle-orm';
import { problem } from '../../common/problem';
import type { Tx } from '../../db/tenant-db';

/* ————————————————————————————————————————————————————————————————
   En activité : un dossier actif, dont le contrat court encore.

   Un agent dont le CDD ou le stage est arrivé à terme n'est plus agent de
   l'APIX, que la liste l'ait déjà rangé ou non : il ne dirige rien, n'est
   le n+1 de personne, ne reçoit pas d'affectation ni d'accès au portail, et
   ne se connecte plus. Son dossier passe de lui-même dans les inactifs le
   lendemain de son dernier jour — la première fois que quelqu'un ouvre
   l'application, puisqu'aucune tâche ne tourne la nuit ; d'ici là, chaque
   porte vérifie la date elle-même.

   Le contrat qui fait foi est le DERNIER, par date de début : un CDD
   renouvelé d'avance compte par son successeur, déjà enregistré.

   Son compte, lui, reste ouvert un mois après son dernier jour, le temps de
   demander et de récupérer ses documents : un portail restreint, sans
   demande d'absence, objectifs, équipe, Academy ni organigramme. Passé ce
   délai, il ne se connecte plus, jusqu'à ce qu'un nouveau contrat rouvre
   son dossier.
   ———————————————————————————————————————————————————————————————— */

/** « 17 octobre 2026 » — jamais d'ISO brut dans un message lu par un humain. */
const jour = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** Le dernier contrat d'un agent, en sous-requête SQL. */
export const dernierContrat = (employeeId: SQL | string) => sql`(
  SELECT dc.id FROM contracts dc WHERE dc.employee_id = ${employeeId}
   ORDER BY dc.start_date DESC, dc.created_at DESC LIMIT 1)`;

/** Son dernier contrat a pris fin : sa date de fin est passée. En SQL. */
export const contratEchu = (employeeId: SQL | string) => sql`EXISTS (
  SELECT 1 FROM contracts ce
   WHERE ce.id = ${dernierContrat(employeeId)} AND ce.end_date < CURRENT_DATE)`;

/** Dossier actif et contrat en cours. En SQL, pour les listes de qui choisir. */
export const enActivite = (employeeId: SQL) =>
  sql`(SELECT ea.status = 'active' FROM employees ea WHERE ea.id = ${employeeId})
      AND NOT ${contratEchu(employeeId)}`;

/**
 * Refuse un geste qui suppose un agent en activité — diriger une unité, être
 * n+1, recevoir une affectation, reprendre une équipe. `pour` complète
 * « ne peut pas … ».
 */
export async function exigerEnActivite(tx: Tx, employeeId: string, pour: string): Promise<void> {
  const { rows } = await tx.execute<{ nom: string; status: string; fin: string | null }>(sql`
    SELECT p.given_name || ' ' || p.family_name AS nom, e.status,
           (SELECT ce.end_date::text FROM contracts ce
             WHERE ce.id = ${dernierContrat(sql`e.id`)} AND ce.end_date < CURRENT_DATE) AS fin
      FROM employees e JOIN persons p ON p.id = e.person_id
     WHERE e.id = ${employeeId}`);
  const a = rows[0];
  if (!a) problem(422, 'people.employee_not_found', 'Cet agent n’existe pas');
  if (a.status !== 'active') {
    problem(
      422,
      'people.agent_inactif',
      `${a.nom} est inactif`,
      `Un agent inactif ne peut pas ${pour}.`,
    );
  }
  if (a.fin) {
    problem(
      422,
      'people.contrat_echu',
      `Le contrat de ${a.nom} a pris fin le ${jour(a.fin)}`,
      `Un agent dont le contrat est arrivé à terme ne peut pas ${pour}. Enregistrez d’abord son nouveau contrat.`,
    );
  }
}

/** La date de fin passée de son dernier contrat — `null` s'il court encore. */
export async function finDeContratPassee(tx: Tx, employeeId: string): Promise<string | null> {
  const { rows } = await tx.execute<{ fin: string }>(sql`
    SELECT ce.end_date::text AS fin FROM contracts ce
     WHERE ce.id = ${dernierContrat(employeeId)} AND ce.end_date < CURRENT_DATE`);
  return rows[0]?.fin ?? null;
}

/**
 * L'accès au portail d'un compte, dans ce tenant.
 *   - `finDAcces` null : agent en activité, ou compte sans dossier ;
 *   - sinon, le dernier jour où il peut encore se connecter, un mois après
 *     sa fin d'activité ; `ferme` : ce jour est passé.
 * La fin d'activité est celle du dossier inactif ; d'un contrat échu que la
 * liste n'a pas encore rangé, sa date de fin.
 */
export async function accesDuCompte(
  tx: Tx,
  userId: string,
): Promise<{ finDAcces: string | null; ferme: boolean }> {
  const { rows } = await tx.execute<{ dernier: string | null; ferme: boolean | null }>(sql`
    WITH dossier AS (
      SELECT CASE WHEN e.status = 'archived'
                  THEN COALESCE(e.fin_activite, (e.archived_at AT TIME ZONE 'UTC')::date - 1)
                  ELSE (SELECT ce.end_date FROM contracts ce
                         WHERE ce.id = ${dernierContrat(sql`e.id`)} AND ce.end_date < CURRENT_DATE)
             END AS fin
        FROM employees e JOIN persons p ON p.id = e.person_id
       WHERE p.user_id = ${userId}
       LIMIT 1)
    SELECT (fin + interval '1 month')::date::text AS dernier,
           (fin + interval '1 month')::date < CURRENT_DATE AS ferme
      FROM dossier`);
  const a = rows[0];
  if (!a?.dernier) return { finDAcces: null, ferme: false };
  return { finDAcces: a.dernier, ferme: Boolean(a.ferme) };
}

/** « 30 octobre 2026 », pour les messages qui parlent de l'accès. */
export const dateLisible = jour;
