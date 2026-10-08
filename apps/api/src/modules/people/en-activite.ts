import { sql, type SQL } from 'drizzle-orm';
import { problem } from '../../common/problem';
import type { Tx } from '../../db/tenant-db';

/* ————————————————————————————————————————————————————————————————
   En activité : un dossier actif, dont le contrat court encore.

   Un agent dont le CDD ou le stage est arrivé à terme n'est plus agent de
   l'APIX, que la liste l'ait déjà rangé ou non : il ne dirige rien, n'est
   le n+1 de personne, ne reçoit pas d'affectation ni d'accès au portail, et
   ne se connecte plus. Son dossier passe de lui-même dans les inactifs le
   lendemain de son dernier jour, au passage de minuit (cf.
   `PassageDeMinuit`) ; chaque porte vérifie aussi la date elle-même.

   Ce qui fait foi, c'est d'être sous contrat AUJOURD'HUI. Un CDD renouvelé
   d'avance, sans interruption, enchaîne sur son successeur. Un contrat qui
   commence plus tard, après une interruption, ne couvre pas l'intervalle :
   l'agent y est hors contrat, et ne reprend que le jour où il commence.

   Son compte, lui, reste ouvert trente jours après son dernier jour, le
   temps de demander et de récupérer ses documents : un portail restreint,
   sans demande d'absence, objectifs, équipe, Academy ni organigramme. Passé
   ce délai, il ne se connecte plus, et son mot de passe s'efface. S'il
   revient, une invitation le lui fait choisir à nouveau, sur le même
   compte : rien de ce qu'il y avait laissé ne se perd.
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

/**
 * Le type du contrat qui le couvre ce jour-là, le plus récent s'il y en a
 * deux, en SQL ; null : aucun ne le couvre.
 */
export const typeDeContratAu = (employeeId: SQL | string, jour: SQL) => sql`(
  SELECT tc.contract_type FROM contracts tc
   WHERE tc.employee_id = ${employeeId} AND tc.start_date <= ${jour}
     AND (tc.end_date IS NULL OR tc.end_date >= ${jour})
   ORDER BY tc.start_date DESC, tc.created_at DESC LIMIT 1)`;

/** En stage aujourd'hui : le contrat qui le couvre est un stage. En SQL. */
export const enStage = (employeeId: SQL | string) =>
  sql`COALESCE(${typeDeContratAu(employeeId, sql`CURRENT_DATE`)} = 'stage', false)`;

/**
 * Les stagiaires ne dirigent pas d'unité : le stage n'est pas un emploi.
 * Refuse de faire d'un stagiaire le responsable d'une unité.
 */
export async function exigerHorsStage(tx: Tx, employeeId: string): Promise<void> {
  const { rows } = await tx.execute<{ nom: string; stage: boolean }>(sql`
    SELECT p.given_name || ' ' || p.family_name AS nom, ${enStage(sql`e.id`)} AS stage
      FROM employees e JOIN persons p ON p.id = e.person_id
     WHERE e.id = ${employeeId}`);
  if (rows[0]?.stage) {
    problem(
      422,
      'org.manager_stagiaire',
      `${rows[0].nom} est en stage`,
      'Les stagiaires ne dirigent pas d’unité.',
    );
  }
}

/** Un contrat le couvre aujourd'hui. En SQL. */
export const sousContrat = (employeeId: SQL | string) => sql`EXISTS (
  SELECT 1 FROM contracts sc
   WHERE sc.employee_id = ${employeeId} AND sc.start_date <= CURRENT_DATE
     AND (sc.end_date IS NULL OR sc.end_date >= CURRENT_DATE))`;

/** Le dernier jour de son dernier contrat terminé, en SQL ; null s'il n'en a pas. */
const finDuDernierContrat = (employeeId: SQL | string) => sql`(
  SELECT max(cf.end_date) FROM contracts cf
   WHERE cf.employee_id = ${employeeId} AND cf.end_date < CURRENT_DATE)`;

/**
 * Il n'est plus sous contrat : son dernier contrat a pris fin, et le
 * suivant, s'il est déjà enregistré, n'a pas commencé. Entre les deux, il
 * n'est pas agent de l'APIX. En SQL.
 */
export const contratEchu = (employeeId: SQL | string) =>
  sql`(NOT ${sousContrat(employeeId)} AND ${finDuDernierContrat(employeeId)} IS NOT NULL)`;

/** Le dernier jour de son contrat quand il n'est plus sous contrat ; sinon null. En SQL. */
const finDeContrat = (employeeId: SQL | string) =>
  sql`CASE WHEN ${contratEchu(employeeId)} THEN ${finDuDernierContrat(employeeId)} END`;

/** Le premier jour d'un contrat qui n'a pas commencé, en SQL ; null s'il n'y en a pas. */
export const debutDuContratAVenir = (employeeId: SQL | string) => sql`(
  SELECT min(cv.start_date) FROM contracts cv
   WHERE cv.employee_id = ${employeeId} AND cv.start_date > CURRENT_DATE)`;

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
  const { rows } = await tx.execute<{
    nom: string;
    status: string;
    fin: string | null;
    suivant: string | null;
  }>(sql`
    SELECT p.given_name || ' ' || p.family_name AS nom, e.status,
           (${finDeContrat(sql`e.id`)})::text AS fin,
           (${debutDuContratAVenir(sql`e.id`)})::text AS suivant
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
      `Un agent dont le contrat est arrivé à terme ne peut pas ${pour}. ${
        a.suivant
          ? `Son nouveau contrat commence le ${jour(a.suivant)}.`
          : 'Enregistrez d’abord son nouveau contrat.'
      }`,
    );
  }
}

/** Le dernier jour de son contrat quand il n'est plus sous contrat ; `null` s'il l'est. */
export async function finDeContratPassee(tx: Tx, employeeId: string): Promise<string | null> {
  const { rows } = await tx.execute<{ fin: string | null }>(sql`
    SELECT (${finDeContrat(employeeId)})::text AS fin`);
  return rows[0]?.fin ?? null;
}

/** Combien de jours le portail reste ouvert, restreint, après le dernier jour. */
export const DELAI_D_ACCES_JOURS = 30;

/**
 * Le dernier jour d'activité d'un dossier, en SQL : celui du dossier
 * inactif ; d'un agent qui n'est plus sous contrat et que la liste n'a pas
 * encore rangé, la fin de son contrat. `null` : en activité.
 */
const finDActivite = (e: SQL) => sql`CASE WHEN ${e}.status = 'archived'
  THEN COALESCE(${e}.fin_activite, (${e}.archived_at AT TIME ZONE 'UTC')::date - 1)
  ELSE ${finDeContrat(sql`${e}.id`)}
  END`;

/**
 * L'accès au portail d'un compte, dans ce tenant.
 *   - `finDAcces` null : agent en activité, ou compte sans dossier ;
 *   - sinon, le dernier jour où il peut encore se connecter, trente jours
 *     après sa fin d'activité ; `ferme` : ce jour est passé.
 *
 * Un licenciement ou un décès ne laisse pas ce délai : l'accès se ferme le
 * jour même.
 */
export async function accesDuCompte(
  tx: Tx,
  userId: string,
): Promise<{ finDAcces: string | null; ferme: boolean }> {
  const { rows } = await tx.execute<{ dernier: string | null; ferme: boolean | null }>(sql`
    WITH dossier AS (
      SELECT ${finDActivite(sql`e`)} AS fin,
             e.status = 'archived' AND e.inactivite_motif IN ('licenciement', 'deces') AS sans_delai
        FROM employees e JOIN persons p ON p.id = e.person_id
       WHERE p.user_id = ${userId}
       LIMIT 1)
    SELECT CASE WHEN sans_delai THEN fin ELSE fin + ${DELAI_D_ACCES_JOURS}::int END::text AS dernier,
           sans_delai OR fin + ${DELAI_D_ACCES_JOURS}::int < CURRENT_DATE AS ferme
      FROM dossier`);
  const a = rows[0];
  if (!a?.dernier) return { finDAcces: null, ferme: false };
  return { finDAcces: a.dernier, ferme: Boolean(a.ferme) };
}

/**
 * Parti depuis plus de trente jours, quel qu'en soit le motif : son mot de
 * passe s'efface, et ses sessions se ferment. Sauf si le compte sert aussi
 * dans une autre organisation : son mot de passe vaut pour elle aussi.
 * Tous les dossiers de l'organisation, ou celui qu'on nomme.
 */
export async function effacerLesMotsDePasseEchus(tx: Tx, employeeId?: string): Promise<number> {
  const { rows } = await tx.execute<{ id: string }>(sql`
    UPDATE users u SET password_hash = NULL
      FROM employees e JOIN persons p ON p.id = e.person_id
     WHERE p.user_id = u.id AND u.password_hash IS NOT NULL
       AND ${employeeId ? sql`e.id = ${employeeId}` : sql`TRUE`}
       AND ${finDActivite(sql`e`)} + ${DELAI_D_ACCES_JOURS}::int < CURRENT_DATE
       AND NOT compte_d_une_autre_organisation(u.id)
    RETURNING u.id`);
  if (rows.length === 0) return 0;
  await tx.execute(sql`
    UPDATE sessions SET revoked_at = now()
     WHERE user_id = ANY(${`{${rows.map((r) => r.id).join(',')}}`}::uuid[]) AND revoked_at IS NULL`);
  return rows.length;
}

/** « 30 octobre 2026 », pour les messages qui parlent de l'accès. */
export const dateLisible = jour;
