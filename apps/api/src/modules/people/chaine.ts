import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { ChangementRattachement, MotifChangement } from '@teranga/contracts';
import { problem, ProblemException } from '../../common/problem';
import * as t from '../../db/schema';
import type { Tx } from '../../db/tenant-db';

/* ————————————————————————————————————————————————————————————————
   La chaîne hiérarchique : les lectures et la validation d'un rattachement.

   Partagées par la fiche agent (création, modification, mutation) et par
   l'organigramme (désignation d'un DG ou d'un directeur, réorganisation) :
   une seule écriture de chaque règle, sinon deux portes finissent par ne
   pas dire la même chose.

   Les règles de l'APIX, dans l'ordre où elles s'appliquent :
     1. le directeur général (responsable de l'unité RACINE, unique) ne
        relève de personne ;
     2. d'abord l'affectation à une direction, ensuite le n+1 — pour l'agent
        comme pour son n+1 ;
     3. le n+1 est de la même direction — sauf pour un directeur, qui relève
        du DG, et pour l'agent d'une direction sans tête, que le DG couvre ;
     4. pas de boucle, et un n+1 actif.
   ———————————————————————————————————————————————————————————————— */

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
      'Ce dossier est archivé.',
    );
  }
  const boucle = await tx.execute(sql`
    WITH RECURSIVE chaine AS (
      SELECT id, manager_employee_id FROM employees WHERE id = ${managerId}
      UNION ALL
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

  if (directionDuResponsable.id === directionCible.id) return;

  // ——— Une direction SANS directeur n'a personne d'autre au-dessus que le
  // directeur général. C'est ainsi, et seulement ainsi, qu'on crée un
  // directeur : son dossier n'existe pas encore quand on le rattache, il ne
  // dirige donc rien, et la règle de direction lui refuserait le DG. Dès
  // qu'un responsable est désigné sur la direction, ce chemin se referme —
  // et le contrôle de la chaîne signale ceux qui y seraient restés.
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
 * La direction d'une unité : elle-même si c'en est une, sinon son aïeule.
 *
 * On remonte l'organigramme jusqu'au premier ancêtre de type « direction ».
 * Un service de la DFC rend donc la DFC ; la DFC rend la DFC ; une unité
 * rattachée directement à la Direction Générale rend la DG.
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
    )
    SELECT id, name FROM remontee WHERE unit_type = 'direction' ORDER BY prof LIMIT 1`);
  const ligne = r.rows[0];
  return ligne ? { id: ligne.id, nom: ligne.name } : null;
}

/** La direction d'un agent, via son affectation du jour. */
export async function directionDeEmploye(
  tx: Tx,
  employeeId: string,
): Promise<{ id: string; nom: string } | null> {
  const [affectation] = await tx
    .select({ orgUnitId: t.assignments.orgUnitId })
    .from(t.assignments)
    .where(
      and(eq(t.assignments.employeeId, employeeId), sql`${t.assignments.validity} @> CURRENT_DATE`),
    )
    .limit(1);
  return directionDeUnite(tx, affectation?.orgUnitId ?? null);
}

/**
 * Le directeur général : le responsable de l'unité RACINE.
 *
 * Il n'est ni désigné par un rôle ni marqué d'une case à cocher —
 * l'organigramme le dit déjà, et deux sources finiraient par se
 * contredire. C'est le seul agent sans n+1, et celui auquel les directeurs
 * se rattachent.
 */
export async function directeurGeneral(tx: Tx): Promise<string | null> {
  const [racine] = await tx
    .select({ managerId: t.orgUnits.managerEmployeeId })
    .from(t.orgUnits)
    .where(and(isNull(t.orgUnits.parentId), isNull(t.orgUnits.deletedAt)))
    // Le sommet est unique ; s'il en traîne deux d'avant la règle, le plus
    // ancien fait foi — toujours le même, d'une lecture à l'autre.
    .orderBy(asc(t.orgUnits.createdAt))
    .limit(1);
  return racine?.managerId ?? null;
}

/** Cette direction a-t-elle un responsable désigné ? */
export async function directionADejaUnResponsable(tx: Tx, directionId: string): Promise<boolean> {
  const [unite] = await tx
    .select({ managerId: t.orgUnits.managerEmployeeId })
    .from(t.orgUnits)
    .where(and(eq(t.orgUnits.id, directionId), isNull(t.orgUnits.deletedAt)))
    .limit(1);
  return Boolean(unite?.managerId);
}

/** L'agent dirige-t-il une direction ? (hors unité racine : c'est le DG) */
export async function dirigeUneDirection(tx: Tx, employeeId: string): Promise<boolean> {
  const [unite] = await tx
    .select({ id: t.orgUnits.id })
    .from(t.orgUnits)
    .where(
      and(
        eq(t.orgUnits.managerEmployeeId, employeeId),
        eq(t.orgUnits.unitType, 'direction'),
        sql`${t.orgUnits.parentId} IS NOT NULL`,
        isNull(t.orgUnits.deletedAt),
      ),
    )
    .limit(1);
  return Boolean(unite);
}

// ———————————————————————————————————————————— équipes et cascades

/** Les agents ACTIFS dont il est le n+1, par ordre alphabétique. */
export async function equipeDe(
  tx: Tx,
  employeeId: string,
): Promise<{ id: string; name: string }[]> {
  const { rows } = await tx.execute<{ id: string; name: string }>(sql`
    SELECT e.id, p.given_name || ' ' || p.family_name AS name
      FROM employees e JOIN persons p ON p.id = e.person_id
     WHERE e.manager_employee_id = ${employeeId} AND e.status = 'active'
     ORDER BY p.family_name, p.given_name`);
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
 * la chaîne continue de le signaler.
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

/** Les responsables ACTIFS des directions, hors unité racine. */
async function directeurs(tx: Tx): Promise<{ id: string; uniteId: string }[]> {
  const { rows } = await tx.execute<{ id: string; unite_id: string }>(sql`
    SELECT DISTINCT o.manager_employee_id AS id, o.id AS unite_id
      FROM org_units o JOIN employees e ON e.id = o.manager_employee_id
     WHERE o.unit_type = 'direction' AND o.parent_id IS NOT NULL
       AND o.deleted_at IS NULL AND e.status = 'active'`);
  return rows.map((r) => ({ id: r.id, uniteId: r.unite_id }));
}

/**
 * Un nouveau directeur général. Ce que la règle impose, dans l'ordre :
 *   — il ne relève plus de personne ;
 *   — ce qui relevait de l'ancien DG relève de lui ;
 *   — tout directeur relève de lui ;
 *   — l'ancien DG, s'il reste à la Direction Générale, relève de lui.
 * Le responsable de la racine est DÉJÀ écrit quand on arrive ici.
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
    if (d.id !== nouveau) await tenterRattachement(tx, journal, d.id, nouveau, 'directeur');
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
}

/**
 * Une direction reçoit un (nouveau) responsable. Ce que la règle impose :
 *   — il relève du directeur général ;
 *   — les agents de la direction rattachés au DG EN ATTENDANT une tête
 *     relèvent désormais de lui ;
 *   — l'ancien directeur, s'il reste dans la direction, relève de lui.
 * Le responsable de l'unité est DÉJÀ écrit quand on arrive ici.
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
  if (nouveau !== dg) await tenterRattachement(tx, journal, nouveau, dg, 'directeur');

  const { rows } = await tx.execute<{ id: string }>(sql`
    WITH RECURSIVE sous_arbre AS (
      SELECT id FROM org_units WHERE id = ${directionId} AND deleted_at IS NULL
      UNION ALL
      SELECT o.id FROM org_units o JOIN sous_arbre s ON o.parent_id = s.id
       WHERE o.deleted_at IS NULL AND o.unit_type <> 'direction'
    )
    SELECT DISTINCT e.id
      FROM employees e
      JOIN assignments a ON a.employee_id = e.id AND a.validity @> CURRENT_DATE
     WHERE a.org_unit_id IN (SELECT id FROM sous_arbre)
       AND e.status = 'active' AND e.manager_employee_id = ${dg}`);
  for (const r of rows) {
    if (r.id === nouveau || r.id === ancien) continue;
    if (await dirigeUneDirection(tx, r.id)) continue;
    await tenterRattachement(tx, journal, r.id, nouveau, 'direction_pourvue');
  }

  if (ancien && ancien !== nouveau && ancien !== dg) {
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
 * L'équipe d'un agent qui part passe à son repreneur.
 *
 * Pris dans l'équipe, le repreneur PREND LA PLACE du partant : il relève
 * désormais du n+1 de celui-ci. Chaque rattachement passe par la règle, et
 * TOUS sont vérifiés avant qu'un seul ne s'écrive : un seul qui ne tient pas,
 * et rien n'a bougé — mieux vaut un refus clair qu'une équipe à moitié
 * reprise.
 */
export async function reprendreEquipe(
  tx: Tx,
  journal: ChangementRattachement[],
  partant: string,
  repreneur: string,
): Promise<void> {
  if (repreneur === partant) {
    problem(422, 'people.repreneur_partant', 'Le repreneur ne peut pas être celui qui part');
  }
  const [r] = await tx
    .select({ status: t.employees.status })
    .from(t.employees)
    .where(eq(t.employees.id, repreneur))
    .limit(1);
  if (!r || r.status !== 'active') {
    problem(422, 'people.repreneur_inactif', 'Le repreneur doit être un agent actif');
  }
  const equipe = await equipeDe(tx, partant);
  const priseDePlace = equipe.some((a) => a.id === repreneur);
  const [p] = await tx
    .select({ n1: t.employees.managerEmployeeId })
    .from(t.employees)
    .where(eq(t.employees.id, partant))
    .limit(1);
  const n1DuPartant = p?.n1 ?? null;

  // D'abord tout vérifier…
  if (priseDePlace && n1DuPartant) {
    await validerRattachement(tx, repreneur, n1DuPartant, await directionDeEmploye(tx, repreneur));
  }
  for (const a of equipe) {
    if (a.id === repreneur) continue;
    await validerRattachement(tx, a.id, repreneur, await directionDeEmploye(tx, a.id));
  }
  // … puis tout écrire.
  if (priseDePlace) await rattacher(tx, journal, repreneur, n1DuPartant, 'prend_la_place');
  for (const a of equipe) {
    if (a.id !== repreneur) await rattacher(tx, journal, a.id, repreneur, 'reprise_equipe');
  }
}

/** L'unité racine — la Direction Générale — et son responsable. */
export async function uniteRacine(
  tx: Tx,
): Promise<{ id: string; managerId: string | null } | null> {
  const [racine] = await tx
    .select({ id: t.orgUnits.id, managerId: t.orgUnits.managerEmployeeId })
    .from(t.orgUnits)
    .where(and(isNull(t.orgUnits.parentId), isNull(t.orgUnits.deletedAt)))
    .orderBy(asc(t.orgUnits.createdAt))
    .limit(1);
  return racine ?? null;
}
