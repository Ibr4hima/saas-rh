import { eq, sql, type SQL } from 'drizzle-orm';
import type { ChangementRattachement, MotifChangement } from '@teranga/contracts';
import { problem, ProblemException } from '../../common/problem';
import * as t from '../../db/schema';
import type { Tx } from '../../db/tenant-db';
import { frDate } from '../notifications/phrases';
import { debutDuStage, exigerEnActivite } from './en-activite';

/* ————————————————————————————————————————————————————————————————
   La chaîne hiérarchique : ses définitions, la validation d'un rattachement,
   et les cascades.

   Partagées par la fiche agent (création, modification, mutation, départ),
   par l'organigramme (désignation, réorganisation, dissolution), par le
   contrôle de la chaîne et par l'Academy : UNE écriture de chaque notion,
   sinon deux portes finissent par ne pas dire la même chose.

   Les définitions :
     — le SOMMET : la plus ancienne unité racine vivante (puis la plus petite
       id, pour que l'ordre ne dépende jamais du hasard). Il n'y en a qu'un ;
       s'il en traîne deux d'avant la règle, c'est lui qui fait foi ;
     — le DG : le responsable du sommet ;
     — un DIRECTEUR : le responsable d'une unité de type direction qui n'est
       pas le sommet — sous-directions comprises ;
     — le PÉRIMÈTRE d'une unité : elle et ce qui en descend, sans entrer dans
       les directions qu'elle chapeaute — c'est là que travaille son
       responsable ;
     — l'affectation QUI FAIT FOI pour un agent : celle en cours, sinon la
       prochaine (un agent qui n'a pas encore pris son poste est compté dans
       la direction qu'il rejoint) ;
     — la DIRECTION d'un agent : la plus proche direction au-dessus de
       l'unité de cette affectation.

   Les règles de l'APIX, dans l'ordre où elles s'appliquent :
     1. le DG ne relève de personne, et siège à la Direction Générale ;
     2. d'abord l'affectation à une direction, ensuite le n+1 — pour l'agent
        comme pour son n+1 ;
     3. le n+1 est de la même direction — sauf pour un directeur, qui relève
        du DG, et pour l'agent d'une direction sans tête, que le DG couvre ;
     3 bis. le chef d'un département ou d'un service relève du responsable
        de l'unité qui coiffe la sienne : le chef du département pour un
        service qui en dépend, sinon le directeur, et le DG quand la
        direction attend sa tête. Son n+1 ne se choisit pas ;
     4. pas de boucle, et un n+1 actif ;
     5. le directeur coiffe sa direction : qui n'y a pas de n+1 relève
        d'office de lui (le DG, à la Direction Générale ; le DG, pour un
        directeur). Qui en a un le garde — le directeur est alors au bout de
        sa chaîne, n+2 ou plus haut.

   Toutes les requêtes récursives se protègent des boucles : une donnée
   ancienne qui en contiendrait une ne doit jamais faire tourner le serveur
   sans fin.
   ———————————————————————————————————————————————————————————————— */

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
 * Le manager désigné doit être un employé ACTIF du tenant, différent de
 * l'intéressé, et ne pas relever lui-même de lui : une boucle hiérarchique
 * ferait tourner sans fin toute remontée de chaîne (validation d'absence,
 * organigramme). La contrainte CHECK couvre le cas « soi-même » ; les boucles
 * plus longues demandent de remonter, donc c'est ici.
 */
export async function validerRattachement(
  tx: Tx,
  employeeId: string,
  managerId: string,
  /**
   * La direction de l'agent APRÈS l'écriture en cours. On la reçoit plutôt
   * que de la lire : à la création, l'affectation n'est pas encore posée, et
   * lors d'une mutation c'est la nouvelle unité qui compte, pas l'ancienne.
   */
  directionCible: { id: string; nom: string } | null,
): Promise<void> {
  if (managerId === employeeId) {
    problem(422, 'people.manager_is_self', 'Un employé ne peut pas être son propre manager');
  }
  // ——— La première règle de l'APIX : le directeur général ne relève de
  // personne dans l'agence — il répond au conseil d'administration. Lui
  // donner un n+1 le ferait entrer dans l'équipe de quelqu'un.
  const dg = await directeurGeneral(tx);
  if (employeeId === dg) {
    problem(
      422,
      'people.dg_sans_responsable',
      'Le directeur général ne relève de personne',
      'Cet agent dirige l’unité racine de l’organigramme : il n’a pas de n+1 dans l’agence.',
    );
  }
  const [manager] = await tx
    .select({ status: t.employees.status })
    .from(t.employees)
    .where(eq(t.employees.id, managerId))
    .limit(1);
  if (!manager) {
    problem(422, 'people.manager_not_found', "Ce manager n'existe pas");
  }
  if (manager.status !== 'active') {
    problem(
      422,
      'people.manager_not_active',
      'Seul un employé actif peut être désigné manager',
      'Ce dossier est inactif.',
    );
  }
  // Un n+1 dont le contrat est arrivé à terme n'est plus de l'APIX, même si
  // son dossier n'est pas encore passé dans les inactifs.
  await exigerEnActivite(tx, managerId, 'être n+1');
  // Un stagiaire n'est le n+1 de personne : ni pendant son stage, ni avant
  // qu'il commence.
  const { rows: stage } = await tx.execute<{ nom: string; debut: string | null; deja: boolean }>(
    sql`
    SELECT p.given_name || ' ' || p.family_name AS nom, s.debut::text AS debut,
           s.debut <= CURRENT_DATE AS deja
      FROM employees e
      JOIN persons p ON p.id = e.person_id
      CROSS JOIN LATERAL (SELECT ${debutDuStage(sql`e.id`)} AS debut) s
     WHERE e.id = ${managerId}`,
  );
  const s = stage[0];
  if (s?.debut) {
    problem(
      422,
      'people.n1_stagiaire',
      'Un stagiaire ne peut pas être n+1',
      s.deja
        ? `${s.nom} est en stage : un stagiaire ne peut pas être n+1.`
        : `${s.nom} commence un stage le ${frDate(s.debut)} : un stagiaire ne peut pas être n+1.`,
    );
  }
  // UNION, pas UNION ALL : sur une boucle déjà présente dans les données, la
  // remontée s'arrête au lieu de tourner sans fin.
  const boucle = await tx.execute(sql`
    WITH RECURSIVE chaine AS (
      SELECT id, manager_employee_id FROM employees WHERE id = ${managerId}
      UNION
      SELECT e.id, e.manager_employee_id
      FROM employees e JOIN chaine c ON e.id = c.manager_employee_id
    )
    SELECT 1 FROM chaine WHERE id = ${employeeId} LIMIT 1`);
  if (boucle.rows.length > 0) {
    problem(
      422,
      'people.manager_cycle',
      'Ce rattachement créerait une boucle hiérarchique',
      'Cette personne relève déjà, directement ou non, de l’employé concerné.',
    );
  }

  // ——— D'abord l'affectation, ensuite la hiérarchie. Un n+1 ne se désigne
  // qu'entre deux agents AFFECTÉS À UNE DIRECTION : sans elle, la règle de
  // direction ne se vérifie pas, et un rattachement posé à l'aveugle est
  // exactement ce qui finit par mélanger les équipes.
  if (!directionCible) {
    problem(
      422,
      'people.sans_affectation',
      'Affectez d’abord l’agent à une direction',
      'Le n+1 se désigne ensuite : c’est la direction qui dit parmi qui le choisir.',
    );
  }
  const directionDuResponsable = await directionDeEmploye(tx, managerId);
  if (!directionDuResponsable) {
    problem(
      422,
      'people.responsable_sans_affectation',
      'Le n+1 désigné n’est affecté à aucune direction',
      'Affectez-le d’abord à une direction ; ses agents pourront ensuite lui être rattachés.',
    );
  }

  // ——— La règle de l'APIX : le n+1 est dans la MÊME DIRECTION.
  //
  // Un directeur fait exception : il relève du directeur général, qui siège
  // à la Direction Générale — donc dans une autre direction que la sienne.
  // C'est la seule exception, et elle se déduit de l'organigramme.
  if (await dirigeUneDirection(tx, employeeId)) {
    if (dg === null) {
      problem(
        422,
        'people.aucun_directeur_general',
        'Aucun directeur général n’est désigné',
        'Un directeur relève du directeur général : désignez d’abord le responsable de l’unité racine dans l’organigramme.',
      );
    }
    if (managerId !== dg) {
      problem(
        422,
        'people.directeur_hors_dg',
        'Un directeur relève du directeur général',
        'Cet agent dirige une direction : son responsable hiérarchique ne peut être que le directeur général.',
      );
    }
    return;
  }

  // Le chef d'un département ou d'un service relève de l'unité qui coiffe
  // la sienne (règle 3 bis) : son n+1 ne se choisit pas.
  const place = await superieurAttendu(tx, employeeId);
  if (place?.superieur) {
    if (managerId !== place.superieur.id) {
      problem(
        422,
        'people.chef_mal_rattache',
        `Le responsable de « ${place.unite} » relève de ${place.superieur.nom}`,
        `Le responsable de « ${place.unite} » relève de ${place.superieur.nom}, qui dirige « ${place.superieur.unite} », l’unité au-dessus de la sienne.`,
      );
    }
    return;
  }

  if (directionDuResponsable.id === directionCible.id) return;

  // ——— Une direction SANS directeur n'a personne d'autre au-dessus que le
  // directeur général. C'est ainsi, et seulement ainsi, qu'on crée un
  // directeur : son dossier n'existe pas encore quand on le rattache, il ne
  // dirige donc rien, et la règle de direction lui refuserait le DG. Dès
  // qu'un responsable est désigné sur la direction, la cascade rattache à
  // lui ceux que le DG couvrait en attendant.
  if (managerId === dg && !(await directionADejaUnResponsable(tx, directionCible.id))) {
    return;
  }
  problem(
    422,
    'people.manager_autre_direction',
    'Le responsable doit appartenir à la même direction',
    `L’agent relève de « ${directionCible.nom} », le responsable désigné de « ${directionDuResponsable.nom} ».`,
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

/** La place du chef d'un département ou d'un service, et le n+1 qu'elle lui impose. */
export interface PlaceDeChef {
  /** Le nom de l'unité qu'il dirige. */
  unite: string;
  /** Son n+1, et l'unité qu'il dirige ; `null` : personne au-dessus de lui. */
  superieur: { id: string; nom: string; unite: string } | null;
}

/**
 * Les chefs de département et de service, et le n+1 que leur impose leur
 * place (règle 3 bis) : en remontant depuis l'unité qu'ils dirigent, le
 * premier responsable actif, jusqu'à la direction comprise, puis le DG
 * quand elle attend sa tête. En une requête : l'organigramme compare
 * l'avant et l'après d'une opération. `chef` : celui-là seulement.
 */
export async function placesDesChefs(tx: Tx, chef?: string): Promise<Map<string, PlaceDeChef>> {
  const { rows } = await tx.execute<{
    chef: string;
    unite: string;
    superieur: string | null;
    superieur_nom: string | null;
    superieur_unite: string | null;
  }>(sql`
    WITH RECURSIVE montee AS (
      SELECT u.id AS unite, u.name AS unite_nom, u.manager_employee_id AS chef,
             p.id AS anc, p.unit_type AS anc_type, p.parent_id AS anc_parent, 1 AS prof
        FROM org_units u
        JOIN org_units p ON p.id = u.parent_id AND p.deleted_at IS NULL
       WHERE u.deleted_at IS NULL AND u.unit_type <> 'direction'
         AND u.manager_employee_id IS NOT NULL
         ${chef ? sql`AND u.manager_employee_id = ${chef}` : sql``}
      UNION ALL
      SELECT m.unite, m.unite_nom, m.chef, p.id, p.unit_type, p.parent_id, m.prof + 1
        FROM montee m
        JOIN org_units p ON p.id = m.anc_parent AND p.deleted_at IS NULL
       WHERE m.anc_type <> 'direction' AND m.prof < 64
    ),
    pourvue AS (
      SELECT DISTINCT ON (m.unite) m.unite, a.manager_employee_id AS superieur,
             a.name AS superieur_unite
        FROM montee m
        JOIN org_units a ON a.id = m.anc
        JOIN employees e ON e.id = a.manager_employee_id AND e.status = 'active'
       WHERE a.manager_employee_id <> m.chef
       ORDER BY m.unite, m.prof
    ),
    place AS (
      SELECT DISTINCT ON (m.unite) m.chef, m.unite_nom,
             COALESCE(pv.superieur, NULLIF(${DG}, m.chef)) AS superieur,
             COALESCE(pv.superieur_unite, (SELECT so.name FROM org_units so WHERE so.id = ${SOMMET}))
               AS superieur_unite
        FROM montee m
        LEFT JOIN pourvue pv ON pv.unite = m.unite
       ORDER BY m.unite
    )
    SELECT pl.chef, pl.unite_nom AS unite, pl.superieur,
           sp.given_name || ' ' || sp.family_name AS superieur_nom, pl.superieur_unite
      FROM place pl
      LEFT JOIN employees se ON se.id = pl.superieur
      LEFT JOIN persons sp ON sp.id = se.person_id`);
  return new Map(
    rows.map((r) => [
      r.chef,
      {
        unite: r.unite,
        superieur: r.superieur
          ? { id: r.superieur, nom: r.superieur_nom ?? '', unite: r.superieur_unite ?? '' }
          : null,
      },
    ]),
  );
}

/** Sa place de chef d'un département ou d'un service ; `null` : il n'en dirige pas. */
export async function superieurAttendu(tx: Tx, employeeId: string): Promise<PlaceDeChef | null> {
  return (await placesDesChefs(tx, employeeId)).get(employeeId) ?? null;
}

/**
 * Après une opération sur l'organigramme : le chef dont le supérieur a
 * changé (nouvelle désignation, responsable retiré, unité re-rattachée), ou
 * qui vient de prendre la tête d'une unité, relève désormais de celui-ci.
 * Un rattachement faux d'avant l'opération, qu'elle ne touche pas, reste
 * signalé par le contrôle.
 */
export async function alignerLesChefs(
  tx: Tx,
  journal: ChangementRattachement[],
  avant: Map<string, PlaceDeChef>,
): Promise<void> {
  for (const [chef, place] of await placesDesChefs(tx)) {
    if (!place.superieur || avant.get(chef)?.superieur?.id === place.superieur.id) continue;
    await tenterRattachement(tx, journal, chef, place.superieur.id, 'chef_d_unite');
  }
}

// ———————————————————————————————————————————— équipes et cascades

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

async function nomDe(tx: Tx, employeeId: string | null): Promise<string | null> {
  if (!employeeId) return null;
  const { rows } = await tx.execute<{ nom: string }>(sql`
    SELECT p.given_name || ' ' || p.family_name AS nom
      FROM employees e JOIN persons p ON p.id = e.person_id
     WHERE e.id = ${employeeId}`);
  return rows[0]?.nom ?? null;
}

/**
 * Écrit un rattachement décidé par une CASCADE, et le consigne au journal
 * de l'opération — c'est ce journal que l'écran montre, en aperçu comme en
 * compte rendu. Un rattachement déjà en place ne s'écrit pas deux fois.
 */
export async function rattacher(
  tx: Tx,
  journal: ChangementRattachement[],
  employeeId: string,
  managerId: string | null,
  motif: MotifChangement,
): Promise<void> {
  const [dossier] = await tx
    .select({ avant: t.employees.managerEmployeeId })
    .from(t.employees)
    .where(eq(t.employees.id, employeeId))
    .limit(1);
  if (!dossier || dossier.avant === managerId) return;
  await tx
    .update(t.employees)
    .set({ managerEmployeeId: managerId, updatedAt: new Date() })
    .where(eq(t.employees.id, employeeId));
  const precedent = journal.findIndex((c) => c.employeeId === employeeId);
  const avant = precedent >= 0 ? journal[precedent]!.avant : await nomDe(tx, dossier.avant);
  if (precedent >= 0) journal.splice(precedent, 1);
  journal.push({
    employeeId,
    nom: (await nomDe(tx, employeeId)) ?? '',
    avant,
    apres: await nomDe(tx, managerId),
    motif,
  });
}

/**
 * Comme `rattacher`, mais sous la règle : si le rattachement ne tient pas,
 * rien ne s'écrit et l'on rend `false`. Une cascade ne se laisse pas bloquer
 * par une anomalie ANCIENNE — l'agent reste où il était, et le contrôle de
 * la chaîne continue de le signaler (l'aperçu le montre « à revoir »).
 */
async function tenterRattachement(
  tx: Tx,
  journal: ChangementRattachement[],
  employeeId: string,
  managerId: string,
  motif: MotifChangement,
): Promise<boolean> {
  try {
    await validerRattachement(tx, employeeId, managerId, await directionDeEmploye(tx, employeeId));
  } catch (err) {
    if (err instanceof ProblemException) return false;
    throw err;
  }
  await rattacher(tx, journal, employeeId, managerId, motif);
  return true;
}

/** Les responsables ACTIFS des directions, hors sommet. */
async function directeurs(tx: Tx): Promise<string[]> {
  const { rows } = await tx.execute<{ id: string }>(sql`
    SELECT DISTINCT o.manager_employee_id AS id
      FROM org_units o JOIN employees e ON e.id = o.manager_employee_id
     WHERE o.unit_type = 'direction' AND o.deleted_at IS NULL
       AND o.id IS DISTINCT FROM ${SOMMET} AND e.status = 'active'
     ORDER BY 1`);
  return rows.map((r) => r.id);
}

/**
 * Les agents ACTIFS sans n+1 du périmètre d'une direction, hors ceux qui
 * dirigent une direction (ils relèvent du DG, cf. apresNouveauDG).
 */
async function sansN1DansLaDirection(tx: Tx, directionId: string | SQL): Promise<string[]> {
  const { rows } = await tx.execute<{ id: string }>(sql`
    ${perimetre(directionId)}
    SELECT e.id FROM employees e
     WHERE ${uniteEnVigueur(sql`e.id`)} IN (SELECT id FROM perimetre)
       AND e.status = 'active' AND e.manager_employee_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM org_units od
                        WHERE od.manager_employee_id = e.id AND od.unit_type = 'direction'
                          AND od.deleted_at IS NULL AND od.id IS DISTINCT FROM ${SOMMET})
     ORDER BY e.id`);
  return rows.map((r) => r.id);
}

/**
 * Le n+1 qui revient d'office à un agent qui n'en a pas (règle 5) : pour un
 * directeur, le DG ; pour le chef d'un département ou d'un service, le
 * responsable de l'unité au-dessus (règle 3 bis) ; sinon le responsable ACTIF
 * de sa direction, le DG pour la Direction Générale. `null` : il est le DG,
 * il n'a pas de direction, ou personne n'est au-dessus de lui.
 */
export async function n1DOffice(
  tx: Tx,
  employeeId: string,
): Promise<{ id: string; motif: MotifChangement } | null> {
  const dg = await directeurGeneral(tx);
  if (employeeId === dg) return null;
  if (await dirigeUneDirection(tx, employeeId)) return dg ? { id: dg, motif: 'directeur' } : null;
  // Le chef d'un département ou d'un service : l'unité qui coiffe la sienne.
  const place = await superieurAttendu(tx, employeeId);
  if (place) return place.superieur ? { id: place.superieur.id, motif: 'chef_d_unite' } : null;
  const direction = await directionDeEmploye(tx, employeeId);
  if (!direction) return null;
  const { rows } = await tx.execute<{ id: string }>(sql`
    SELECT o.manager_employee_id AS id FROM org_units o
      JOIN employees e ON e.id = o.manager_employee_id AND e.status = 'active'
     WHERE o.id = ${direction.id} AND o.deleted_at IS NULL`);
  const tete = rows[0]?.id ?? null;
  return tete && tete !== employeeId ? { id: tete, motif: 'responsable_de_sa_direction' } : null;
}

/**
 * Un agent actif SANS n+1 relève d'office du responsable de sa direction
 * (règle 5), si elle en a un et que le rattachement tient. Rend `true` s'il
 * a été écrit. Qui a déjà un n+1 n'est pas touché.
 */
export async function rattacherDOffice(
  tx: Tx,
  journal: ChangementRattachement[],
  employeeId: string,
): Promise<boolean> {
  const [dossier] = await tx
    .select({ n1: t.employees.managerEmployeeId, status: t.employees.status })
    .from(t.employees)
    .where(eq(t.employees.id, employeeId))
    .limit(1);
  if (!dossier || dossier.status !== 'active' || dossier.n1 !== null) return false;
  const cible = await n1DOffice(tx, employeeId);
  if (!cible) return false;
  return tenterRattachement(tx, journal, employeeId, cible.id, cible.motif);
}

/**
 * Un nouveau directeur général. Ce que la règle impose, dans l'ordre :
 *   — il ne relève plus de personne ;
 *   — ce qui relevait de l'ancien DG relève de lui ;
 *   — tout directeur relève de lui ;
 *   — l'ancien DG, s'il reste à la Direction Générale, relève de lui.
 * Le responsable du sommet est DÉJÀ écrit quand on arrive ici.
 */
export async function apresNouveauDG(
  tx: Tx,
  journal: ChangementRattachement[],
  ancien: string | null,
  nouveau: string,
): Promise<void> {
  await rattacher(tx, journal, nouveau, null, 'devient_dg');
  if (ancien && ancien !== nouveau) {
    for (const agent of await equipeDe(tx, ancien)) {
      if (agent.id !== nouveau)
        await tenterRattachement(tx, journal, agent.id, nouveau, 'suit_le_dg');
    }
  }
  for (const d of await directeurs(tx)) {
    if (d !== nouveau) await tenterRattachement(tx, journal, d, nouveau, 'directeur');
  }
  if (ancien && ancien !== nouveau) {
    const [a] = await tx
      .select({ status: t.employees.status, n1: t.employees.managerEmployeeId })
      .from(t.employees)
      .where(eq(t.employees.id, ancien))
      .limit(1);
    if (a?.status === 'active' && a.n1 === null) {
      await tenterRattachement(tx, journal, ancien, nouveau, 'ancien_dg');
    }
  }
  // La Direction Générale est la direction du DG : qui y est sans n+1 relève de lui.
  for (const id of await sansN1DansLaDirection(tx, SOMMET)) {
    if (id !== nouveau && id !== ancien) {
      await tenterRattachement(tx, journal, id, nouveau, 'responsable_de_sa_direction');
    }
  }
}

/**
 * Une direction reçoit un (nouveau) responsable. Ce que la règle impose :
 *   — il relève du directeur général ;
 *   — les agents de la direction rattachés au DG EN ATTENDANT une tête,
 *     et ceux qui n'avaient pas de n+1, relèvent désormais de lui ;
 *   — l'ancien directeur, s'il reste dans la direction, relève de lui.
 * Le responsable de l'unité est DÉJÀ écrit quand on arrive ici. (Le DG ne
 * peut pas diriger une autre direction : il n'en sort pas, et une personne
 * ne dirige qu'une unité.)
 */
export async function apresNouveauDirecteur(
  tx: Tx,
  journal: ChangementRattachement[],
  directionId: string,
  ancien: string | null,
  nouveau: string,
): Promise<void> {
  const dg = await directeurGeneral(tx);
  if (!dg) return;
  await tenterRattachement(tx, journal, nouveau, dg, 'directeur');

  const { rows } = await tx.execute<{ id: string }>(sql`
    ${perimetre(directionId)}
    SELECT e.id FROM employees e
     WHERE ${uniteEnVigueur(sql`e.id`)} IN (SELECT id FROM perimetre)
       AND e.status = 'active'
       AND (e.manager_employee_id = ${dg} OR e.manager_employee_id IS NULL)
     ORDER BY e.id`);
  for (const r of rows) {
    if (r.id === nouveau || r.id === ancien) continue;
    if (await dirigeUneDirection(tx, r.id)) continue;
    await tenterRattachement(tx, journal, r.id, nouveau, 'direction_pourvue');
  }

  if (ancien && ancien !== nouveau) {
    const [a] = await tx
      .select({ status: t.employees.status, n1: t.employees.managerEmployeeId })
      .from(t.employees)
      .where(eq(t.employees.id, ancien))
      .limit(1);
    const direction = await directionDeEmploye(tx, ancien);
    if (a?.status === 'active' && a.n1 === dg && direction?.id === directionId) {
      await tenterRattachement(tx, journal, ancien, nouveau, 'ancien_directeur');
    }
  }
}

/**
 * Un département ou un service change de responsable. Ce que la règle
 * impose, outre la place du nouveau (règle 3 bis, cf. `alignerLesChefs`) :
 *   - ce qui relevait de l'ancien relève du nouveau ;
 *   - l'ancien, s'il reste dans l'unité, relève du nouveau.
 * Le responsable de l'unité est DÉJÀ écrit quand on arrive ici.
 */
export async function apresNouveauChef(
  tx: Tx,
  journal: ChangementRattachement[],
  uniteId: string,
  ancien: string | null,
  nouveau: string,
): Promise<void> {
  if (!ancien || ancien === nouveau) return;
  for (const agent of await equipeDe(tx, ancien)) {
    if (agent.id !== nouveau) {
      await tenterRattachement(tx, journal, agent.id, nouveau, 'suit_le_chef');
    }
  }
  const [a] = await tx
    .select({ status: t.employees.status })
    .from(t.employees)
    .where(eq(t.employees.id, ancien))
    .limit(1);
  if (a?.status === 'active' && !(await sortDuPerimetre(tx, ancien, uniteId))) {
    await tenterRattachement(tx, journal, ancien, nouveau, 'ancien_chef');
  }
}

/** Une reprise d'équipe vérifiée, prête à s'écrire. */
export interface PlanDeReprise {
  partant: string;
  repreneur: string;
  equipe: { id: string; name: string }[];
  /** Le repreneur est pris dans l'équipe : il prend la place du partant, sous ce n+1. */
  place: string | null;
  priseDePlace: boolean;
}

/**
 * Vérifie qu'une équipe peut passer à son repreneur — sans rien écrire.
 *
 * Pris dans l'équipe, le repreneur PREND LA PLACE du partant : il relèvera
 * du n+1 de celui-ci. Encore faut-il que ce n+1 existe et reste : sinon le
 * repreneur se retrouverait sans n+1, ou sous quelqu'un qui part.
 *
 * @param equipe  l'équipe à reprendre — déjà privée de ceux qui partent aussi.
 * @param partants tous ceux qui partent dans la même opération.
 */
export async function planifierReprise(
  tx: Tx,
  partant: string,
  repreneur: string,
  equipe: { id: string; name: string }[],
  partants: ReadonlySet<string> = new Set([partant]),
): Promise<PlanDeReprise> {
  if (repreneur === partant) {
    problem(422, 'people.repreneur_partant', 'Le repreneur ne peut pas être celui qui part');
  }
  if (partants.has(repreneur)) {
    problem(422, 'people.repreneur_partant', 'Le repreneur part aussi');
  }
  const [r] = await tx
    .select({ status: t.employees.status })
    .from(t.employees)
    .where(eq(t.employees.id, repreneur))
    .limit(1);
  if (!r || r.status !== 'active') {
    problem(422, 'people.repreneur_inactif', 'Le repreneur doit être un agent actif');
  }
  await exigerEnActivite(tx, repreneur, 'reprendre une équipe');
  const priseDePlace = equipe.some((a) => a.id === repreneur);
  const [p] = await tx
    .select({ n1: t.employees.managerEmployeeId })
    .from(t.employees)
    .where(eq(t.employees.id, partant))
    .limit(1);
  const place = p?.n1 ?? null;

  if (priseDePlace) {
    if (!place) {
      problem(
        422,
        'people.repreneur_sans_place',
        'Le repreneur ne peut pas prendre sa place : il n’a pas de n+1',
        'Pris dans l’équipe, le repreneur relèverait du n+1 du partant. Choisissez-le hors de l’équipe, ou désignez d’abord ce n+1.',
      );
    }
    if (partants.has(place)) {
      problem(
        422,
        'people.repreneur_sans_place',
        'Le repreneur ne peut pas prendre sa place : son n+1 part aussi',
        'Traitez d’abord le départ de ce n+1, ou choisissez un repreneur hors de l’équipe.',
      );
    }
    await validerRattachement(tx, repreneur, place, await directionDeEmploye(tx, repreneur));
  }
  for (const a of equipe) {
    if (a.id === repreneur) continue;
    await validerRattachement(tx, a.id, repreneur, await directionDeEmploye(tx, a.id));
  }
  return { partant, repreneur, equipe, place, priseDePlace };
}

/**
 * Écrit une reprise vérifiée par `planifierReprise`. Chaque rattachement se
 * revérifie au moment de s'écrire : dans un lot, deux reprises vérifiées
 * chacune de leur côté peuvent former une boucle une fois toutes deux
 * écrites. Le refus annule alors le lot entier — rien n'est à moitié repris.
 */
export async function appliquerReprise(
  tx: Tx,
  journal: ChangementRattachement[],
  plan: PlanDeReprise,
): Promise<void> {
  if (plan.priseDePlace && plan.place) {
    await validerRattachement(
      tx,
      plan.repreneur,
      plan.place,
      await directionDeEmploye(tx, plan.repreneur),
    );
    await rattacher(tx, journal, plan.repreneur, plan.place, 'prend_la_place');
  }
  for (const a of plan.equipe) {
    if (a.id === plan.repreneur) continue;
    await validerRattachement(tx, a.id, plan.repreneur, await directionDeEmploye(tx, a.id));
    await rattacher(tx, journal, a.id, plan.repreneur, 'reprise_equipe');
  }
}

/**
 * L'équipe d'un agent qui part passe à son repreneur : tout est vérifié
 * avant que rien ne s'écrive — un seul rattachement qui ne tient pas, et
 * rien n'a bougé. Mieux vaut un refus clair qu'une équipe à moitié reprise.
 */
export async function reprendreEquipe(
  tx: Tx,
  journal: ChangementRattachement[],
  partant: string,
  repreneur: string,
): Promise<void> {
  const plan = await planifierReprise(tx, partant, repreneur, await equipeDe(tx, partant));
  await appliquerReprise(tx, journal, plan);
}

/**
 * Le DG siège-t-il bien à la Direction Générale — aujourd'hui et dans ses
 * affectations à venir ? Relu après toute opération qui peut déplacer des
 * unités ou des agents : une réorganisation ne doit pas l'en faire sortir.
 */
export async function assertDGALaDirectionGenerale(tx: Tx): Promise<void> {
  const racine = await uniteRacine(tx);
  if (!racine?.managerId) return;
  if (await sortDuPerimetre(tx, racine.managerId, racine.id)) {
    problem(
      422,
      'org.dg_hors_direction_generale',
      'Le directeur général resterait hors de la Direction Générale',
      'Il siège à la Direction Générale : cette opération l’en ferait sortir. Désignez d’abord son successeur.',
    );
  }
}
