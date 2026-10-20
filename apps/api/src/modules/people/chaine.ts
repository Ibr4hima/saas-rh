import { eq, sql, type SQL } from 'drizzle-orm';
import type { ChangementRattachement, RattachementChoisi } from '@teranga/contracts';
import { problem } from '../../common/problem';
import * as t from '../../db/schema';
import type { Tx } from '../../db/tenant-db';
import { frDate } from '../notifications/phrases';
import {
  calculerLaChaine,
  peutChoisirSonRattachement,
  type PhotoDeLaChaine,
  type TypeDUnite,
} from './calcul-de-la-chaine';
import { contratEchu, debutDuStage, enActivite, exigerEnActivite } from './en-activite';

/*
   La chaîne hiérarchique : ses définitions, sa photo, et ce qui se choisit.

   Deux N+1 (ADR-0147). Le HIÉRARCHIQUE se calcule à partir de
   l'organigramme (`calcul-de-la-chaine.ts`) : la colonne
   `employees.manager_employee_id` en garde le résultat, que
   `recalculerLaChaine` réécrit après chaque geste. Le FONCTIONNEL se choisit
   (`n1_fonctionnel_employee_id`) ; par défaut, c'est le hiérarchique.

   Les définitions, partagées par la fiche agent, l'organigramme, le
   contrôle de la chaîne et l'Academy :
     - le SOMMET : la plus ancienne unité racine vivante (puis la plus petite
       id, pour que l'ordre ne dépende jamais du hasard). Il n'y en a qu'un ;
       s'il en traîne deux d'avant la règle, c'est lui qui fait foi ;
     - le DG : la tête du sommet ;
     - le PÉRIMÈTRE d'une unité : elle et ce qui en descend, sans entrer dans
       les directions qu'elle chapeaute. C'est là que travaille sa tête ;
     - l'affectation QUI FAIT FOI pour un agent : celle en cours, sinon la
       prochaine (un agent qui n'a pas encore pris son poste est compté dans
       l'unité rejointe) ;
     - la DIRECTION d'un agent : la plus proche direction au-dessus de
       l'unité de cette affectation.

   Toutes les requêtes récursives se protègent des boucles : une donnée
   ancienne qui en contiendrait une ne doit jamais faire tourner le serveur
   sans fin.
*/

/** L'id du sommet, en sous-requête SQL — la même partout. */
export const SOMMET = sql`(SELECT so.id FROM org_units so
  WHERE so.parent_id IS NULL AND so.deleted_at IS NULL
  ORDER BY so.created_at, so.id LIMIT 1)`;

/** L'id du DG, en sous-requête SQL (NULL s'il n'y en a pas). */
export const DG = sql`(SELECT sd.manager_employee_id FROM org_units sd WHERE sd.id = ${SOMMET})`;

/**
 * L'unité de l'affectation qui fait foi pour un agent (en cours, sinon la
 * prochaine), en sous-requête SQL.
 */
export const uniteEnVigueur = (employeeId: SQL) => sql`(SELECT av.org_unit_id
  FROM assignments av
  WHERE av.employee_id = ${employeeId}
    AND (av.validity @> CURRENT_DATE OR lower(av.validity) > CURRENT_DATE)
  ORDER BY lower(av.validity) LIMIT 1)`;

/**
 * Une colonne de la direction d'une unité (elle-même si c'en est une, sinon
 * la plus proche aïeule de type direction), en sous-requête SQL. Les unités
 * dissoutes comptent : l'historique d'un agent doit pouvoir nommer la
 * direction d'une unité qui n'existe plus.
 */
export const directionDeLUnite = (uniteId: SQL, colonne: 'id' | 'name' | 'short_name') => sql`(
  WITH RECURSIVE remontee AS (
    SELECT id, parent_id, unit_type, name, short_name, 0 AS prof
      FROM org_units WHERE id = ${uniteId}
    UNION ALL
    SELECT u.id, u.parent_id, u.unit_type, u.name, u.short_name, r.prof + 1
      FROM org_units u JOIN remontee r ON u.id = r.parent_id
     WHERE r.prof < 64
  )
  SELECT ${sql.raw(colonne)} FROM remontee WHERE unit_type = 'direction' ORDER BY prof LIMIT 1)`;

/**
 * La direction de CHAQUE unité, en une passe : les CTE `remontee_des_unites`
 * et `direction_des_unites(unite_id, id, name, short_name)`, à placer dans un
 * `WITH RECURSIVE`. La règle de `directionDeLUnite` (la plus proche direction
 * en remontant, l'unité comprise), calculée une fois pour toutes les unités
 * au lieu d'une fois par ligne lue : la liste du personnel la demandait 9 000
 * fois à 3 000 agents (ADR-0067).
 */
export const directionsDesUnites = sql`remontee_des_unites AS (
    SELECT id AS depart, id, parent_id, unit_type, name, short_name, 0 AS prof
      FROM org_units
    UNION ALL
    SELECT r.depart, u.id, u.parent_id, u.unit_type, u.name, u.short_name, r.prof + 1
      FROM org_units u JOIN remontee_des_unites r ON u.id = r.parent_id
     WHERE r.prof < 64
  ),
  direction_des_unites AS (
    SELECT DISTINCT ON (depart) depart AS unite_id, id, name, short_name
      FROM remontee_des_unites WHERE unit_type = 'direction'
     ORDER BY depart, prof
  )`;

/** Le périmètre d'une unité, en CTE `perimetre(id)` — sans ses sous-directions. */
export const perimetre = (uniteId: string | SQL) => sql`WITH RECURSIVE perimetre AS (
    SELECT id FROM org_units WHERE id = ${uniteId} AND deleted_at IS NULL
    UNION
    SELECT o.id FROM org_units o JOIN perimetre p ON o.parent_id = p.id
     WHERE o.deleted_at IS NULL AND o.unit_type <> 'direction'
  )`;

/**
 * Un seul changement de la chaîne à la fois, par organisation. Chaque règle
 * lit puis écrit : deux requêtes simultanées (A sous B pendant que B passe
 * sous A, deux sommets créés au même instant) passeraient chacune le
 * contrôle de l'autre. Le verrou tient jusqu'à la fin de la transaction.
 */
export async function verrouillerLaChaine(tx: Tx): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('chaine:' || current_setting('app.tenant_id', true)))`,
  );
}

/**
 * La direction d'une unité : elle-même si c'en est une, sinon la plus proche
 * aïeule de type direction. Un service de la DFC rend la DFC ; la DFC rend
 * la DFC ; une unité rattachée directement à la Direction Générale rend la
 * Direction Générale.
 */
export async function directionDeUnite(
  tx: Tx,
  orgUnitId: string | null,
): Promise<{ id: string; nom: string } | null> {
  if (!orgUnitId) return null;
  const r = await tx.execute<{ id: string; name: string }>(sql`
    WITH RECURSIVE remontee AS (
      SELECT id, parent_id, unit_type, name, 0 AS prof
        FROM org_units WHERE id = ${orgUnitId} AND deleted_at IS NULL
      UNION ALL
      SELECT o.id, o.parent_id, o.unit_type, o.name, r.prof + 1
        FROM remontee r JOIN org_units o ON o.id = r.parent_id AND o.deleted_at IS NULL
       WHERE r.prof < 64
    )
    SELECT id, name FROM remontee WHERE unit_type = 'direction' ORDER BY prof LIMIT 1`);
  const ligne = r.rows[0];
  return ligne ? { id: ligne.id, nom: ligne.name } : null;
}

/** La direction d'un agent, via l'affectation qui fait foi (en cours, sinon la prochaine). */
export async function directionDeEmploye(
  tx: Tx,
  employeeId: string,
): Promise<{ id: string; nom: string } | null> {
  const { rows } = await tx.execute<{ unite: string | null }>(
    sql`SELECT ${uniteEnVigueur(sql`${employeeId}`)} AS unite`,
  );
  return directionDeUnite(tx, rows[0]?.unite ?? null);
}

/** L'unité racine — la Direction Générale — et son responsable. */
export async function uniteRacine(
  tx: Tx,
): Promise<{ id: string; managerId: string | null } | null> {
  const { rows } = await tx.execute<{ id: string; manager_employee_id: string | null }>(
    sql`SELECT id, manager_employee_id FROM org_units WHERE id = ${SOMMET}`,
  );
  const r = rows[0];
  return r ? { id: r.id, managerId: r.manager_employee_id } : null;
}

/**
 * Le directeur général : le responsable du sommet.
 *
 * Il n'est ni désigné par un rôle ni marqué d'une case à cocher —
 * l'organigramme le dit déjà, et deux sources finiraient par se
 * contredire. C'est le seul agent sans n+1, et celui auquel les directeurs
 * se rattachent.
 */
export async function directeurGeneral(tx: Tx): Promise<string | null> {
  return (await uniteRacine(tx))?.managerId ?? null;
}

/**
 * Le DGA EN PLACE (ADR-0126) : l'agent que porte le sommet, en activité et
 * affecté aujourd'hui à la Direction Générale. Parti, ou muté ailleurs, la
 * place est vacante : la fiche du sommet ne montre plus personne, et la
 * prochaine désignation n'a pas de poste à rendre. `null` : pas de DGA.
 */
export async function adjointEnPlace(tx: Tx): Promise<string | null> {
  const { rows } = await tx.execute<{ sommet: string; adjoint: string | null }>(sql`
    SELECT so.id AS sommet, so.adjoint_employee_id AS adjoint
      FROM org_units so WHERE so.id = ${SOMMET}`);
  const r = rows[0];
  if (!r?.adjoint) return null;
  const { rows: place } = await tx.execute<{ enPlace: boolean }>(sql`
    ${perimetre(r.sommet)}
    SELECT COALESCE(${enActivite(sql`${r.adjoint}::uuid`)}, false)
       AND EXISTS (SELECT 1 FROM assignments a
                    WHERE a.employee_id = ${r.adjoint}
                      AND a.org_unit_id IN (SELECT id FROM perimetre)
                      AND a.validity @> CURRENT_DATE) AS "enPlace"`);
  return place[0]?.enPlace ? r.adjoint : null;
}

/** Cette direction a-t-elle un responsable désigné ? */
export async function directionADejaUnResponsable(tx: Tx, directionId: string): Promise<boolean> {
  const { rows } = await tx.execute<{ oui: boolean }>(sql`
    SELECT manager_employee_id IS NOT NULL AS oui
      FROM org_units WHERE id = ${directionId} AND deleted_at IS NULL`);
  return Boolean(rows[0]?.oui);
}

/** L'agent dirige-t-il une direction ? (hors sommet : c'est le DG) */
export async function dirigeUneDirection(tx: Tx, employeeId: string): Promise<boolean> {
  const { rows } = await tx.execute(sql`
    SELECT 1 FROM org_units
     WHERE manager_employee_id = ${employeeId} AND unit_type = 'direction'
       AND deleted_at IS NULL AND id IS DISTINCT FROM ${SOMMET}
     LIMIT 1`);
  return rows.length > 0;
}

/**
 * L'agent sort-il du périmètre d'une unité, aujourd'hui OU plus tard ?
 * Toutes ses affectations en cours et à venir doivent y tomber, et au moins
 * une doit être en vigueur : un responsable dont la mutation est déjà
 * programmée ailleurs ne peut pas prendre une tête qu'il quitterait.
 */
export async function sortDuPerimetre(
  tx: Tx,
  employeeId: string,
  uniteId: string,
): Promise<boolean> {
  const { rows } = await tx.execute<{ dedans: boolean; ailleurs: boolean }>(sql`
    ${perimetre(uniteId)}
    SELECT
      EXISTS (SELECT 1 FROM assignments a
               WHERE a.employee_id = ${employeeId}
                 AND a.org_unit_id IN (SELECT id FROM perimetre)
                 AND a.validity @> CURRENT_DATE) AS dedans,
      EXISTS (SELECT 1 FROM assignments a
               WHERE a.employee_id = ${employeeId}
                 AND (upper_inf(a.validity) OR upper(a.validity) > CURRENT_DATE)
                 AND (a.org_unit_id IS NULL OR a.org_unit_id NOT IN (SELECT id FROM perimetre)))
        AS ailleurs`);
  const r = rows[0];
  return !r?.dedans || Boolean(r.ailleurs);
}

// Les équipes.

/**
 * Les agents ACTIFS dont il est le n+1, par ordre alphabétique. Le DG n'est
 * de l'équipe de personne — même quand une donnée ancienne lui laisse un n+1.
 */
export async function equipeDe(
  tx: Tx,
  employeeId: string,
): Promise<{ id: string; name: string }[]> {
  const { rows } = await tx.execute<{ id: string; name: string }>(sql`
    SELECT e.id, p.given_name || ' ' || p.family_name AS name
      FROM employees e JOIN persons p ON p.id = e.person_id AND p.deleted_at IS NULL
     WHERE e.manager_employee_id = ${employeeId} AND e.status = 'active'
       AND e.id IS DISTINCT FROM ${DG}
     ORDER BY p.family_name, p.given_name, e.id`);
  return rows;
}

/**
 * Verse au journal d'une opération celui d'une opération qu'elle a menée en
 * chemin (une mutation, un départ) : un agent déjà au journal y garde son
 * N+1 d'avant et prend le N+1 d'après.
 */
export function fusionnerAuJournal(
  journal: ChangementRattachement[],
  autres: ChangementRattachement[],
): void {
  // Un agent a deux N+1 : le hiérarchique et le fonctionnel se suivent
  // séparément.
  const fonctionnel = (c: ChangementRattachement) => c.motif === 'fonctionnel_retire';
  for (const c of autres) {
    const precedent = journal.findIndex(
      (j) => j.employeeId === c.employeeId && fonctionnel(j) === fonctionnel(c),
    );
    if (precedent < 0) {
      journal.push(c);
      continue;
    }
    const avant = journal[precedent]!.avant;
    journal.splice(precedent, 1);
    // Revenu à son point de départ : rien n'a changé.
    if (avant !== c.apres) journal.push({ ...c, avant });
  }
}

/**
 * Le DG siège bien à la Direction Générale, aujourd'hui et dans les
 * affectations à venir : relu après toute opération qui peut déplacer des
 * unités ou des agents, une réorganisation ne doit pas en faire sortir le DG.
 */
export async function assertDGALaDirectionGenerale(tx: Tx): Promise<void> {
  const racine = await uniteRacine(tx);
  if (!racine?.managerId) return;
  if (await sortDuPerimetre(tx, racine.managerId, racine.id)) {
    problem(
      422,
      'org.dg_hors_direction_generale',
      'Le DG resterait hors de la Direction Générale',
      'Le DG siège à la Direction Générale : cette opération l’en ferait sortir. Désignez d’abord la relève.',
    );
  }
}

// Les deux N+1 (ADR-0147).

/**
 * Le N+1 FONCTIONNEL effectif d'un agent, en SQL : le N+1 choisi, sinon le
 * hiérarchique. `alias` : la table `employees` de la requête.
 */
export const n1Fonctionnel = (alias: string) =>
  sql`COALESCE(${sql.raw(alias)}.n1_fonctionnel_employee_id, ${sql.raw(alias)}.manager_employee_id)`;

/**
 * La photo dont se calcule la chaîne : les unités vivantes et leurs têtes,
 * les agents actifs et les choix faits à leur sujet, le DGA en place, et les
 * agents qui ne peuvent pas être N+1 fonctionnels (en stage ou sur le point
 * de l'être, ou hors contrat).
 */
export async function photographierLaChaine(tx: Tx): Promise<PhotoDeLaChaine> {
  const { rows: unites } = await tx.execute<{
    id: string;
    parent_id: string | null;
    unit_type: TypeDUnite;
    manager_employee_id: string | null;
  }>(sql`
    SELECT id, parent_id, unit_type, manager_employee_id
      FROM org_units WHERE deleted_at IS NULL ORDER BY created_at, id`);
  const { rows: sommet } = await tx.execute<{ id: string | null }>(sql`SELECT ${SOMMET} AS id`);
  const { rows: agents } = await tx.execute<{
    id: string;
    unite: string | null;
    n1: string | null;
    n1_unite_id: string | null;
    n1_dga: boolean;
    fonctionnel: string | null;
  }>(sql`
    SELECT e.id, ${uniteEnVigueur(sql`e.id`)} AS unite, e.manager_employee_id AS n1,
           e.n1_unite_id, e.n1_dga, e.n1_fonctionnel_employee_id AS fonctionnel
      FROM employees e WHERE e.status = 'active' ORDER BY e.id`);
  const { rows: inaptes } = await tx.execute<{ id: string }>(sql`
    SELECT e.id FROM employees e
     WHERE e.id IN (SELECT n1_fonctionnel_employee_id FROM employees
                     WHERE n1_fonctionnel_employee_id IS NOT NULL)
       AND (${debutDuStage(sql`e.id`)} IS NOT NULL OR ${contratEchu(sql`e.id`)})`);
  return {
    sommetId: sommet[0]?.id ?? null,
    adjointId: await adjointEnPlace(tx),
    unites: unites.map((u) => ({
      id: u.id,
      parentId: u.parent_id,
      type: u.unit_type,
      teteId: u.manager_employee_id,
    })),
    agents: agents.map((a) => ({
      id: a.id,
      uniteId: a.unite,
      n1Actuel: a.n1,
      n1UniteId: a.n1_unite_id,
      n1Dga: a.n1_dga,
      n1FonctionnelId: a.fonctionnel,
    })),
    inaptes: new Set(inaptes.map((i) => i.id)),
  };
}

/** Les noms de plusieurs agents, en une lecture. */
export async function nomsDe(tx: Tx, ids: Iterable<string | null>): Promise<Map<string, string>> {
  const voulus = [...new Set([...ids].filter((id): id is string => id !== null))];
  if (voulus.length === 0) return new Map();
  const { rows } = await tx.execute<{ id: string; nom: string }>(sql`
    SELECT e.id, p.given_name || ' ' || p.family_name AS nom
      FROM employees e JOIN persons p ON p.id = e.person_id
     WHERE e.id IN (${sql.join(
       voulus.map((id) => sql`${id}::uuid`),
       sql`, `,
     )})`);
  return new Map(rows.map((r) => [r.id, r.nom]));
}

/**
 * Le N+1 fonctionnel qu'on choisit pour un agent (ADR-0147) : tout agent
 * actif, sous contrat, hors stage, de n'importe quelle direction ; pas
 * soi-même, pas de boucle. Le DG n'a pas de N+1.
 */
export async function validerN1Fonctionnel(
  tx: Tx,
  employeeId: string,
  n1Id: string,
): Promise<void> {
  if (n1Id === employeeId) {
    problem(422, 'people.n1_soi_meme', 'Un agent ne peut pas être son propre N+1');
  }
  if (employeeId === (await directeurGeneral(tx))) {
    problem(
      422,
      'people.dg_sans_n1',
      'Le DG n’a pas de N+1',
      'Le DG dirige l’unité racine de l’organigramme : personne au-dessus.',
    );
  }
  const [n1] = await tx
    .select({ id: t.employees.id })
    .from(t.employees)
    .where(eq(t.employees.id, n1Id))
    .limit(1);
  if (!n1) problem(422, 'people.n1_introuvable', 'Ce N+1 n’existe pas');
  await exigerEnActivite(tx, n1Id, 'être N+1');
  // Une personne en stage n'est le N+1 de personne : ni pendant son stage,
  // ni avant qu'il commence.
  const { rows: stage } = await tx.execute<{ nom: string; debut: string | null; deja: boolean }>(
    sql`
    SELECT p.given_name || ' ' || p.family_name AS nom, s.debut::text AS debut,
           s.debut <= CURRENT_DATE AS deja
      FROM employees e
      JOIN persons p ON p.id = e.person_id
      CROSS JOIN LATERAL (SELECT ${debutDuStage(sql`e.id`)} AS debut) s
     WHERE e.id = ${n1Id}`,
  );
  const s = stage[0];
  if (s?.debut) {
    problem(
      422,
      'people.n1_stagiaire',
      'Une personne en stage ne peut pas être N+1',
      s.deja
        ? `${s.nom} est en stage : une personne en stage ne peut pas être N+1.`
        : `${s.nom} commence un stage le ${frDate(s.debut)} : une personne en stage ne peut pas être N+1.`,
    );
  }
  // UNION, pas UNION ALL : sur une boucle déjà présente dans les données, la
  // remontée s'arrête au lieu de tourner sans fin.
  const boucle = await tx.execute(sql`
    WITH RECURSIVE chaine AS (
      SELECT id, ${n1Fonctionnel('employees')} AS n1 FROM employees WHERE id = ${n1Id}
      UNION
      SELECT e.id, ${n1Fonctionnel('e')}
        FROM employees e JOIN chaine c ON e.id = c.n1
    )
    SELECT 1 FROM chaine WHERE id = ${employeeId} LIMIT 1`);
  if (boucle.rows.length > 0) {
    problem(
      422,
      'people.n1_boucle',
      'Ce choix créerait une boucle',
      'Cette personne relève déjà, directement ou non, de l’agent concerné.',
    );
  }
}

/**
 * Vérifie qu'un agent peut relever de cette place : l'agent est là où le
 * choix se fait, la place est occupée, et le choix ne crée pas de boucle.
 * Rend `null` quand la place choisie est celle du DG : c'est le rattachement
 * par défaut.
 */
export async function validerRattachementChoisi(
  tx: Tx,
  employeeId: string,
  choix: RattachementChoisi,
): Promise<RattachementChoisi | null> {
  const photo = await photographierLaChaine(tx);
  if (!peutChoisirSonRattachement(photo, employeeId)) {
    problem(
      422,
      'people.rattachement_non_choisi',
      'Ce N+1 hiérarchique ne se choisit pas',
      'Le N+1 hiérarchique découle de l’organigramme. Seules les têtes des unités rattachées directement à la Direction Générale, et les agents qui y sont rattachés directement, peuvent relever d’une autre place que le DG.',
    );
  }
  if (choix.type === 'dga') {
    if (!photo.adjointId) {
      problem(422, 'people.sans_dga', 'La Direction Générale n’a pas de DGA');
    }
  } else {
    if (choix.uniteId === photo.sommetId) return null;
    const unite = photo.unites.find((u) => u.id === choix.uniteId);
    if (!unite) problem(404, 'org.unit_not_found', 'Cette unité n’existe pas');
    const tete = photo.agents.some((a) => a.id === unite.teteId) ? unite.teteId : null;
    if (!tete) {
      problem(
        422,
        'people.unite_sans_tete',
        'Cette unité n’a pas de tête',
        'Le rattachement se fait à une responsabilité occupée.',
      );
    }
    if (tete === employeeId) {
      problem(422, 'people.n1_soi_meme', 'Un agent ne peut pas être son propre N+1');
    }
  }
  const essai: PhotoDeLaChaine = {
    ...photo,
    agents: photo.agents.map((a) =>
      a.id === employeeId
        ? {
            ...a,
            n1Dga: choix.type === 'dga',
            n1UniteId: choix.type === 'unite' ? choix.uniteId : null,
          }
        : a,
    ),
  };
  if (calculerLaChaine(essai).choixCaducs.includes(employeeId)) {
    problem(
      422,
      'people.n1_boucle',
      'Ce choix créerait une boucle',
      'La tête de cette unité relève déjà, directement ou non, de l’agent concerné.',
    );
  }
  return choix;
}

/** L'agent peut-il relever d'une autre place que celle de l'organigramme ? */
export async function choixDuRattachementOuvert(tx: Tx, employeeId: string): Promise<boolean> {
  return peutChoisirSonRattachement(await photographierLaChaine(tx), employeeId);
}
