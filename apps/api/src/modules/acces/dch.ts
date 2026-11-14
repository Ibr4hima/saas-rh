import { sql, type SQL } from 'drizzle-orm';
import {
  CAPACITES_DELEGABLES,
  CAPACITES_DE_L_ADMINISTRATEUR,
  FENETRE_DU_PRINCIPAL_HEURES,
  RAPPEL_AVANT_LA_FIN_HEURES,
  type Capacite,
  type CapaciteDemande,
} from '@teranga/contracts';
import { enPortee, memoriser } from '../../common/memoire';
import { problem } from '../../common/problem';
import { contratEchu } from '../people/en-activite';
import type { Tx } from '../../db/tenant-db';
import { notifier, type NotificationDraft } from '../notifications/notifier';
import {
  directeurGeneral,
  directionDeEmploye,
  directionDeLUnite,
  uniteEnVigueur,
} from '../people/chaine';
import { ajouterHeuresOuvrees } from '../time/heures-ouvrees';

/* ————————————————————————————————————————————————————————————————
   La Direction du Capital Humain, et ce qu'elle confie.

   Qui peut quoi, lu dans l'organigramme — c'est ici qu'on l'écrit, une fois,
   pour l'accès aux écrans comme pour les circuits de demandes :

     — la DCH, c'est la direction du personnel que l'organigramme désigne ;
       son responsable est le directeur du Capital Humain, qui a TOUTES les
       habilitations ;
     — un membre de la DCH a celles que le directeur lui confie. Qu'il quitte
       la direction, et elles tombent — le directeur l'apprend ;
     — l'administrateur (compte technique) a toute la gestion, jamais le
       traitement d'une demande ;
     — tout autre agent n'a que son espace.

   Les habilitations appartiennent à la DCH : un nouveau directeur les trouve
   en place, et les modifie s'il le veut.
   ———————————————————————————————————————————————————————————————— */

/** Quelqu'un qui peut viser : actif, avec un compte ouvert dans l'organisation. */
export interface Viseur {
  employeeId: string;
  userId: string;
  nom: string;
  /** En congé aujourd'hui (absence approuvée qui couvre ce jour). */
  absent: boolean;
  /** Absent : le dernier jour de son absence (ISO), sinon null. */
  absentJusquAu: string | null;
}

/**
 * Le dernier jour de l'absence en cours : une absence approuvée couvre ce
 * jour, et elle l'éloigne (une mission le laisse joignable ; quelques heures
 * d'absence le laissent présent dans la journée). Null : présent.
 */
const finDAbsence = (employeeId: SQL) => sql`(
  SELECT max(ab.end_date)::text FROM absence_requests ab
    JOIN absence_types ty ON ty.id = ab.absence_type_id AND NOT ty.reste_joignable
   WHERE ab.employee_id = ${employeeId} AND ab.status = 'approved'
     AND ab.start_time IS NULL
     AND CURRENT_DATE BETWEEN ab.start_date AND ab.end_date)`;
const estAbsent = (employeeId: SQL) => sql`(${finDAbsence(employeeId)} IS NOT NULL)`;

/** Un agent qui peut viser, ou null. Mémorisé dans une portée (cf. `memoriser`). */
export function viseur(tx: Tx, employeeId: string | null): Promise<Viseur | null> {
  if (!employeeId) return Promise.resolve(null);
  return memoriser(`viseur:${employeeId}`, () => lireViseur(tx, employeeId));
}

async function lireViseur(tx: Tx, employeeId: string): Promise<Viseur | null> {
  const { rows } = await tx.execute<{
    employee_id: string;
    user_id: string;
    nom: string;
    absent_jusqu_au: string | null;
  }>(sql`
    SELECT e.id AS employee_id, u.id AS user_id,
           p.given_name || ' ' || p.family_name AS nom,
           ${finDAbsence(sql`e.id`)} AS absent_jusqu_au
      FROM employees e
      JOIN persons p ON p.id = e.person_id AND p.user_id IS NOT NULL AND p.deleted_at IS NULL
      JOIN users u ON u.id = p.user_id AND u.status = 'active'
      JOIN user_tenant_memberships m ON m.user_id = u.id AND m.tenant_id = e.tenant_id
     WHERE e.id = ${employeeId} AND e.status = 'active' AND NOT ${contratEchu(sql`e.id`)}
     LIMIT 1`);
  const r = rows[0];
  return r
    ? {
        employeeId: r.employee_id,
        userId: r.user_id,
        nom: r.nom,
        absent: r.absent_jusqu_au !== null,
        absentJusquAu: r.absent_jusqu_au,
      }
    : null;
}

// ———————————————————————————————————————————— la direction du personnel

export interface DirectionDuPersonnel {
  uniteId: string;
  nom: string;
  /** Son responsable, tel que l'organigramme le désigne (null : poste vacant). */
  directeurEmployeeId: string | null;
  /** Le même, s'il peut viser. */
  directeur: Viseur | null;
}

/** La direction du personnel (la DCH), ou null si aucune n'est désignée. */
export function directionDuPersonnel(tx: Tx): Promise<DirectionDuPersonnel | null> {
  return memoriser('dch', () => lireLaDirectionDuPersonnel(tx));
}

async function lireLaDirectionDuPersonnel(tx: Tx): Promise<DirectionDuPersonnel | null> {
  const { rows } = await tx.execute<{
    id: string;
    name: string;
    manager_employee_id: string | null;
  }>(
    sql`SELECT id, name, manager_employee_id FROM org_units
         WHERE direction_du_personnel AND deleted_at IS NULL LIMIT 1`,
  );
  const u = rows[0];
  if (!u) return null;
  return {
    uniteId: u.id,
    nom: u.name,
    directeurEmployeeId: u.manager_employee_id,
    directeur: await viseur(tx, u.manager_employee_id),
  };
}

/**
 * Un membre de la DCH qui peut traiter : il peut viser, et sa direction est
 * la direction du personnel. `parti` quand il ne l'est plus — sorti de la
 * DCH, de l'agence, ou sans accès.
 */
export function membreDCH(
  tx: Tx,
  dch: DirectionDuPersonnel,
  employeeId: string,
): Promise<Viseur | 'parti'> {
  return memoriser(`membre:${dch.uniteId}:${employeeId}`, () => lireLeMembre(tx, dch, employeeId));
}

async function lireLeMembre(
  tx: Tx,
  dch: DirectionDuPersonnel,
  employeeId: string,
): Promise<Viseur | 'parti'> {
  const v = await viseur(tx, employeeId);
  if (!v) return 'parti';
  const direction = await directionDeEmploye(tx, employeeId);
  return direction?.id === dch.uniteId ? v : 'parti';
}

/** Hors contrat, son contrat à venir le ramène à la DCH. */
async function revientALaDCH(
  tx: Tx,
  dch: DirectionDuPersonnel,
  employeeId: string,
): Promise<boolean> {
  const { rows } = await tx.execute<{ oui: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM contracts c
       WHERE c.employee_id = ${employeeId} AND c.planned_position_title IS NOT NULL
         AND ${directionDeLUnite(sql`c.planned_org_unit_id`, 'id')} = ${dch.uniteId}) AS oui`);
  return Boolean(rows[0]?.oui);
}

/**
 * Un agent de la DCH, sous contrat — qu'il ait activé son compte ou non :
 * c'est à lui que les tâches se délèguent, et sa délégation tient. Il ne
 * TRAITE qu'une fois son compte ouvert (`membreDCH`) : il trouve alors ce
 * qui lui est délégué.
 */
export async function estDeLaDCH(
  tx: Tx,
  dch: DirectionDuPersonnel,
  employeeId: string,
): Promise<boolean> {
  const { rows } = await tx.execute<{ actif: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM employees e
        JOIN persons p ON p.id = e.person_id AND p.deleted_at IS NULL
       WHERE e.id = ${employeeId} AND e.status = 'active'
         AND NOT ${contratEchu(sql`e.id`)}) AS actif`);
  if (!rows[0]?.actif) return false;
  return (await directionDeEmploye(tx, employeeId))?.id === dch.uniteId;
}

/** Les membres à qui une habilitation est confiée, en cours — du plus ancien au plus récent. */
export function detenteursDe(tx: Tx, capacite: Capacite): Promise<string[]> {
  return memoriser(`detenteurs:${capacite}`, async () => {
    const { rows } = await tx.execute<{ employee_id: string }>(sql`
      SELECT employee_id FROM habilitations
       WHERE capacite = ${capacite} AND fin_at IS NULL
       ORDER BY created_at, employee_id`);
    return rows.map((r) => r.employee_id);
  });
}

/**
 * La personne principale d'une délégation de demandes (ADR-0128), ou null.
 * Sans backup, rien ne change : une délégation à une seule personne se
 * traite comme avant.
 */
export function principalDe(tx: Tx, capacite: Capacite): Promise<string | null> {
  return memoriser(`principal:${capacite}`, async () => {
    const { rows } = await tx.execute<{ employee_id: string }>(sql`
      SELECT employee_id FROM habilitations
       WHERE capacite = ${capacite} AND fin_at IS NULL AND principal`);
    return rows[0]?.employee_id ?? null;
  });
}

/**
 * Chaque délégation de demandes a sa personne principale : à défaut (la
 * première délégation, un départ, un retrait), la personne déléguée la
 * première l'est. Qui dirige la DCH en désigne une autre à sa guise.
 */
export async function tenirLesPrincipaux(tx: Tx): Promise<void> {
  await tx.execute(sql`
    UPDATE habilitations h SET principal = true
     WHERE h.fin_at IS NULL AND NOT h.principal AND h.capacite LIKE 'demandes.%'
       AND NOT EXISTS (SELECT 1 FROM habilitations p
                        WHERE p.capacite = h.capacite AND p.fin_at IS NULL AND p.principal)
       AND NOT EXISTS (SELECT 1 FROM habilitations a
                        WHERE a.capacite = h.capacite AND a.fin_at IS NULL
                          AND (a.created_at, a.employee_id) < (h.created_at, h.employee_id))`);
}

/** Les jours fériés datés, pour compter les heures ouvrées. */
export function joursFeries(tx: Tx): Promise<Set<string>> {
  return memoriser('feries', async () => {
    const { rows } = await tx.execute<{ jour: string }>(sql`
      SELECT day::text AS jour FROM holidays WHERE day IS NOT NULL`);
    return new Set(rows.map((r) => r.jour));
  });
}

/**
 * Qui relève de l'agent, à tout niveau de la chaîne des N+1 : ces
 * personnes-là ne traitent pas ses demandes.
 *
 * Dans une portée (cf. `avecMemoire`), la chaîne entière se lit une fois et
 * chaque agent s'y parcourt en mémoire : une file de cent demandes faisait
 * cent lectures récursives (ADR-0068). Hors portée, pour un seul agent, la
 * lecture récursive ne parcourt que la branche qui en relève.
 */
export function subordonnesDe(tx: Tx, employeeId: string): Promise<Set<string>> {
  if (!enPortee()) return lireLesSubordonnes(tx, employeeId);
  return memoriser(`sous:${employeeId}`, async () => {
    const equipes = await memoriser('equipes', () => lireLesEquipes(tx));
    const sous = new Set<string>();
    const aVoir = [employeeId];
    while (aVoir.length > 0) {
      for (const id of equipes.get(aVoir.pop()!) ?? []) {
        if (sous.has(id)) continue;
        sous.add(id);
        aVoir.push(id);
      }
    }
    return sous;
  });
}

async function lireLesSubordonnes(tx: Tx, employeeId: string): Promise<Set<string>> {
  const { rows } = await tx.execute<{ id: string }>(sql`
    WITH RECURSIVE sous AS (
      SELECT e.id FROM employees e WHERE e.manager_employee_id = ${employeeId}
      UNION
      SELECT e.id FROM employees e JOIN sous s ON e.manager_employee_id = s.id
    )
    SELECT id FROM sous`);
  return new Set(rows.map((r) => r.id));
}

/** Les agents directs de chacun : toute la chaîne des N+1, en une lecture. */
async function lireLesEquipes(tx: Tx): Promise<Map<string, string[]>> {
  const { rows } = await tx.execute<{ id: string; manager_employee_id: string }>(sql`
    SELECT id, manager_employee_id FROM employees WHERE manager_employee_id IS NOT NULL`);
  const equipes = new Map<string, string[]>();
  for (const r of rows) {
    const equipe = equipes.get(r.manager_employee_id);
    if (equipe) equipe.push(r.id);
    else equipes.set(r.manager_employee_id, [r.id]);
  }
  return equipes;
}

/**
 * Depuis quand une demande attend la DCH, et si elle a été confiée aux
 * backups (ADR-0128).
 */
export interface Attente {
  /** L'arrivée à la DCH ; null : elle arrive à l'instant. */
  depuis: Date | string | null;
  /** Confiée aux backups avant la fin de la fenêtre de 48 heures (null : non). */
  ouverteAuxBackupsLe: Date | string | null;
}

/**
 * La fenêtre de 48 heures (ADR-0128) : une délégation de demandes confiée à
 * plusieurs personnes a sa personne principale, qui traite seule pendant 48
 * heures ouvrées ; les backups voient la demande, puis la reçoivent et la
 * traitent aussi, le premier geste l'emportant.
 */
export interface FenetreDuPrincipal {
  principal: Viseur;
  /** Les backups qui le peuvent, selon la règle commune (cf. `traitementDe`). */
  backups: Viseur[];
  /** La fin des 48 heures ouvrées. */
  finLe: Date;
  /** Le rappel à la personne principale, 15 heures ouvrées avant la fin. */
  rappelLe: Date;
  /** Ouverte aux backups : la fenêtre a pris fin, ou la demande leur a été confiée. */
  ouverte: boolean;
  /** Confiée aux backups avant la fin de la fenêtre. */
  confieeParLePrincipal: boolean;
}

async function fenetreDe(
  tx: Tx,
  principal: Viseur,
  backups: Viseur[],
  attente: Attente,
): Promise<FenetreDuPrincipal> {
  const feries = await joursFeries(tx);
  const depuis = attente.depuis ? new Date(attente.depuis) : new Date();
  const finLe = ajouterHeuresOuvrees(depuis, FENETRE_DU_PRINCIPAL_HEURES, feries);
  const rappelLe = ajouterHeuresOuvrees(
    depuis,
    FENETRE_DU_PRINCIPAL_HEURES - RAPPEL_AVANT_LA_FIN_HEURES,
    feries,
  );
  const confiee = attente.ouverteAuxBackupsLe !== null;
  return {
    principal,
    backups,
    finLe,
    rappelLe,
    ouverte: confiee || Date.now() >= finLe.getTime(),
    confieeParLePrincipal: confiee,
  };
}

/** Qui traite une demande pour la DCH, maintenant. */
export interface Traitement {
  /**
   * Qui la traite : chacun est prévenu, le premier qui agit l'emporte. Vide :
   * personne — poste vacant, ou demande du directeur que nul n'est habilité
   * à traiter (`aConfier`).
   */
  traitants: Viseur[];
  /** Ils traitent pour le compte du directeur du Capital Humain. */
  parDelegationDe: Viseur | null;
  /** La demande du directeur lui-même, sans membre habilité : à lui de la confier. */
  aConfier: boolean;
  dch: DirectionDuPersonnel | null;
  /**
   * La fenêtre de 48 heures, quand la délégation a une personne principale
   * en mesure de traiter, ou une personne qui assure la suppléance (ADR-0128,
   * ADR-0129). Null : l'appel va à tous d'emblée.
   */
  fenetre: FenetreDuPrincipal | null;
}

/**
 * Qui traite une demande pour la DCH — la règle, pour tous les types :
 *
 *   1. le membre à qui le directeur l'a confiée, à la main, s'il le peut ;
 *   2. sinon, les membres habilités à ce type de demande qui le peuvent —
 *      tous prévenus. À plusieurs, la personne principale traite seule le
 *      temps de la fenêtre, puis avec les backups (ADR-0128) ; la personne
 *      principale indisponible, la première personne disponible parmi les
 *      backups assure la suppléance (ADR-0129) ;
 *   3. sinon, le directeur du Capital Humain (en congé ou non : il n'y a
 *      personne après lui).
 *
 * « Le peut » : membre de la DCH, avec un accès ouvert, présent aujourd'hui.
 * Personne ne traite sa propre demande, ni celle de son chef : qui relève du
 * demandeur s'efface, et à défaut de membre, le directeur traite. Celle du
 * directeur, qui n'a que des subordonnés à la DCH, va à ses membres
 * habilités, ou attend qu'il la confie.
 *
 * `attente` porte la fenêtre de 48 heures ; null (un retour de congé à
 * confirmer, un congé validé qui change), tous les membres sont appelés.
 */
export async function traitementDe(
  tx: Tx,
  capacite: CapaciteDemande,
  demande: { employeeId: string; confieeA: string | null; attente: Attente | null },
  dchConnue?: DirectionDuPersonnel | null,
): Promise<Traitement> {
  const dch = dchConnue === undefined ? await directionDuPersonnel(tx) : dchConnue;
  if (!dch) {
    return { traitants: [], parDelegationDe: null, aConfier: false, dch: null, fenetre: null };
  }
  const directeur = dch.directeur;
  let sous: Set<string> | null = null;
  const relevantDuDemandeur = async (employeeId: string) => {
    if (dch.directeurEmployeeId === demande.employeeId) return false;
    sous ??= await subordonnesDe(tx, demande.employeeId);
    return sous.has(employeeId);
  };
  const disponible = async (employeeId: string): Promise<Viseur | null> => {
    if (employeeId === demande.employeeId || employeeId === dch.directeurEmployeeId) return null;
    if (await relevantDuDemandeur(employeeId)) return null;
    const m = await membreDCH(tx, dch, employeeId);
    return m !== 'parti' && !m.absent ? m : null;
  };
  const repriseParLeDirecteur =
    demande.confieeA !== null && demande.confieeA === dch.directeurEmployeeId;
  if (demande.confieeA && !repriseParLeDirecteur) {
    const m = await disponible(demande.confieeA);
    if (m) {
      return { traitants: [m], parDelegationDe: directeur, aConfier: false, dch, fenetre: null };
    }
  }
  if (!repriseParLeDirecteur || directeur?.employeeId === demande.employeeId) {
    const detenteurs = await detenteursDe(tx, capacite);
    const membres: Viseur[] = [];
    for (const id of detenteurs) {
      const m = await disponible(id);
      if (m) membres.push(m);
    }
    const principalId =
      demande.attente && detenteurs.length > 1 ? await principalDe(tx, capacite) : null;
    // La personne principale indisponible (absente, à l'origine de la
    // demande…), la première personne disponible dans l'ordre des
    // délégations assure la suppléance, avec la fenêtre ; au retour de la
    // personne principale, la suppléance cesse (ADR-0129).
    const principal = principalId
      ? (membres.find((m) => m.employeeId === principalId) ?? membres[0] ?? null)
      : null;
    if (principal && demande.attente) {
      const backups = membres.filter((m) => m !== principal);
      const fenetre = await fenetreDe(tx, principal, backups, demande.attente);
      return {
        traitants: fenetre.ouverte ? [principal, ...backups] : [principal],
        parDelegationDe: directeur,
        aConfier: false,
        dch,
        fenetre,
      };
    }
    if (membres.length > 0) {
      return {
        traitants: membres,
        parDelegationDe: directeur,
        aConfier: false,
        dch,
        fenetre: null,
      };
    }
  }
  if (directeur && directeur.employeeId !== demande.employeeId) {
    return { traitants: [directeur], parDelegationDe: null, aConfier: false, dch, fenetre: null };
  }
  return {
    traitants: [],
    parDelegationDe: null,
    aConfier: Boolean(directeur && directeur.employeeId === demande.employeeId),
    dch,
    fenetre: null,
  };
}

/**
 * Peut-il décider de cette demande ? Un de ses traitants, ou le directeur du
 * Capital Humain — qui garde la main sur tout ce qu'il confie. Jamais le
 * demandeur.
 */
export function decideur(t: Traitement, moi: string | null, demandeurEmployeeId: string): boolean {
  if (!moi || moi === demandeurEmployeeId) return false;
  return t.traitants.some((v) => v.employeeId === moi) || t.dch?.directeurEmployeeId === moi;
}

/** « Awa Diop », « Awa Diop ou Moussa Ndiaye » — qui la demande attend. */
export const nomsDe = (viseurs: readonly Viseur[]): string | null =>
  viseurs.length === 0
    ? null
    : viseurs.length === 1
      ? viseurs[0]!.nom
      : `${viseurs
          .slice(0, -1)
          .map((v) => v.nom)
          .join(', ')} ou ${viseurs[viseurs.length - 1]!.nom}`;

/**
 * Les agents de la DCH sous contrat, directeur exclu : à qui l'on délègue —
 * compte activé ou non (`compte`).
 */
export async function membresDeLaDCH(
  tx: Tx,
  dch: DirectionDuPersonnel,
): Promise<
  Array<{
    employeeId: string;
    nom: string;
    prenom: string;
    poste: string | null;
    absent: boolean;
    compte: boolean;
  }>
> {
  const { rows } = await tx.execute<{
    id: string;
    nom: string;
    prenom: string;
    poste: string | null;
    absent: boolean;
    compte: boolean;
  }>(sql`
    SELECT e.id, p.given_name || ' ' || p.family_name AS nom, p.given_name AS prenom,
           (SELECT a.position_title FROM assignments a
             WHERE a.employee_id = e.id
               AND (a.validity @> CURRENT_DATE OR lower(a.validity) > CURRENT_DATE)
             ORDER BY lower(a.validity) LIMIT 1) AS poste,
           ${estAbsent(sql`e.id`)} AS absent,
           EXISTS (
             SELECT 1 FROM users u
               JOIN user_tenant_memberships m ON m.user_id = u.id AND m.tenant_id = e.tenant_id
              WHERE u.id = p.user_id AND u.status = 'active') AS compte
      FROM employees e
      JOIN persons p ON p.id = e.person_id AND p.deleted_at IS NULL
     WHERE e.status = 'active' AND NOT ${contratEchu(sql`e.id`)}
       AND e.id IS DISTINCT FROM ${dch.directeurEmployeeId}
       AND ${directionDeLUnite(uniteEnVigueur(sql`e.id`), 'id')} = ${dch.uniteId}
     ORDER BY p.family_name, p.given_name`);
  return rows.map((r) => ({
    employeeId: r.id,
    nom: r.nom,
    prenom: r.prenom,
    poste: r.poste,
    absent: r.absent,
    compte: r.compte,
  }));
}

/**
 * Personne n'agit sur SON dossier avec une habilitation de gestion : un
 * membre de la DCH est aussi un agent, et ce qui le concerne passe par les
 * mêmes demandes que pour tout agent — traitées par quelqu'un d'autre. Sans
 * quoi il pourrait modifier son dossier, ses soldes, se désigner
 * responsable… sans que personne ne le voie.
 */
export async function pasSurSoi(
  tx: Tx,
  userId: string,
  employeeIds: readonly (string | null | undefined)[],
  geste: string,
): Promise<void> {
  // Son dossier, même inactif : un agent parti ne s'ajoute pas un contrat.
  const { rows } = await tx.execute<{ id: string }>(sql`
    SELECT e.id FROM employees e JOIN persons p ON p.id = e.person_id
     WHERE p.user_id = ${userId}`);
  if (!rows.some((r) => employeeIds.includes(r.id))) return;
  problem(
    403,
    'acces.son_propre_dossier',
    `Vous ne pouvez pas ${geste} vous-même`,
    'Comme pour tout agent, les demandes qui vous concernent sont traitées par un autre membre de la DCH ou par l’administrateur. Pour modifier vos informations, faites un signalement depuis « Mes infos personnelles ».',
  );
}

/**
 * Personne ne se désigne N+1 d'un agent, ni repreneur d'une équipe : il se
 * donnerait le visa de leurs congés et leur évaluation, sans que personne
 * l'ait décidé. Sauf ce que la règle fait déjà : le responsable de la
 * direction de l'agent en est le N+1 d'office.
 */
export async function pasResponsableDeSoi(
  tx: Tx,
  userId: string,
  responsableId: string | null | undefined,
  direction: { id: string } | null,
): Promise<void> {
  if (!responsableId) return;
  if (direction) {
    const { rows } = await tx.execute<{ id: string }>(sql`
      SELECT id FROM org_units
       WHERE id = ${direction.id} AND manager_employee_id = ${responsableId}
         AND deleted_at IS NULL`);
    if (rows.length > 0) return;
  }
  await pasSurSoi(tx, userId, [responsableId], 'vous désigner responsable');
}

/**
 * L'agent relié à ce compte, s'il est en activité : dossier actif et contrat
 * en cours. Un contrat échu compte dès le lendemain du dernier jour, sans
 * attendre que la liste range le dossier dans les inactifs.
 */
export async function agentDuCompte(tx: Tx, userId: string): Promise<string | null> {
  const { rows } = await tx.execute<{ id: string }>(sql`
    SELECT e.id FROM employees e JOIN persons p ON p.id = e.person_id
     WHERE p.user_id = ${userId} AND e.status = 'active' AND p.deleted_at IS NULL
       AND NOT ${contratEchu(sql`e.id`)}
     LIMIT 1`);
  return rows[0]?.id ?? null;
}

/**
 * Les administrateurs en fonction, `sauf` un : accès ouvert, et dossier en
 * activité s'ils en ont un. Un administrateur relié à un dossier parti ne
 * compte plus, même pendant le mois où son portail reste ouvert.
 */
export async function administrateursEnFonction(
  tx: Tx,
  tenantId: string,
  sauf: string | null = null,
): Promise<string[]> {
  const { rows } = await tx.execute<{ user_id: string }>(sql`
    SELECT m.user_id FROM user_tenant_memberships m
     WHERE m.tenant_id = ${tenantId} AND m.role = 'admin' AND m.acces_coupe_le IS NULL
       AND m.user_id IS DISTINCT FROM ${sauf}
       AND (NOT EXISTS (SELECT 1 FROM persons p JOIN employees e ON e.person_id = p.id
                         WHERE p.user_id = m.user_id AND p.deleted_at IS NULL)
            OR EXISTS (SELECT 1 FROM persons p JOIN employees e ON e.person_id = p.id
                        WHERE p.user_id = m.user_id AND p.deleted_at IS NULL
                          AND e.status = 'active' AND NOT ${contratEchu(sql`e.id`)}))`);
  return rows.map((r) => r.user_id);
}

/**
 * Ce qu'un compte peut faire de plus qu'un agent — relu à chaque requête :
 * une nomination, une délégation, un départ de la DCH prennent effet tout de
 * suite, sans se reconnecter.
 */
export async function capacitesDe(
  tx: Tx,
  userId: string,
  role: string,
): Promise<{ capacites: Capacite[]; estAgent: boolean; dirigeLaDCH: boolean; estDG: boolean }> {
  const base = new Set<Capacite>(role === 'admin' ? CAPACITES_DE_L_ADMINISTRATEUR : []);
  const moi = await agentDuCompte(tx, userId);
  if (!moi) return { capacites: [...base], estAgent: false, dirigeLaDCH: false, estDG: false };
  const estDG = (await directeurGeneral(tx)) === moi;
  const dch = await directionDuPersonnel(tx);
  if (dch?.directeurEmployeeId === moi) {
    // Tout ce qui se délègue ; les textes restent à l'administrateur.
    return { capacites: [...CAPACITES_DELEGABLES], estAgent: true, dirigeLaDCH: true, estDG };
  }
  const { rows } = await tx.execute<{ capacite: string }>(sql`
    SELECT capacite FROM habilitations WHERE employee_id = ${moi} AND fin_at IS NULL`);
  if (rows.length > 0 && dch && (await membreDCH(tx, dch, moi)) !== 'parti') {
    for (const r of rows) {
      if ((CAPACITES_DELEGABLES as readonly string[]).includes(r.capacite)) {
        base.add(r.capacite as Capacite);
      }
    }
  }
  return { capacites: [...base], estAgent: true, dirigeLaDCH: false, estDG };
}

export async function nomDe(tx: Tx, employeeId: string): Promise<string> {
  const { rows } = await tx.execute<{ nom: string }>(sql`
    SELECT p.given_name || ' ' || p.family_name AS nom
      FROM employees e JOIN persons p ON p.id = e.person_id WHERE e.id = ${employeeId}`);
  return rows[0]?.nom ?? 'Un membre';
}

/**
 * Un membre qui n'est plus de la DCH — muté, parti — perd ses habilitations :
 * elles se closent, et le directeur l'apprend. Ce qu'il traitait revient au
 * directeur. Un compte pas encore activé ne les fait pas tomber : elles
 * l'attendent. Celles d'un membre entre deux contrats, que le suivant ramène
 * à la DCH, l'attendent aussi : il les retrouve le jour où il commence.
 */
export async function verifierLesHabilitations(tx: Tx, tenantId: string): Promise<void> {
  const { rows } = await tx.execute<{ employee_id: string }>(sql`
    SELECT DISTINCT employee_id FROM habilitations WHERE fin_at IS NULL`);
  if (rows.length === 0) return;
  const dch = await directionDuPersonnel(tx);
  for (const r of rows) {
    if (dch && (await estDeLaDCH(tx, dch, r.employee_id))) continue;
    if (dch && (await revientALaDCH(tx, dch, r.employee_id))) continue;
    await tx.execute(sql`
      UPDATE habilitations SET fin_at = now(), fin_motif = 'partie'
       WHERE employee_id = ${r.employee_id} AND fin_at IS NULL`);
    if (!dch?.directeur) continue;
    const nom = await nomDe(tx, r.employee_id);
    await notifier(tx, tenantId, dch.directeur.userId, {
      type: 'delegation_rompue',
      sujet: 'dch.delegations',
      title: `${nom} a quitté la DCH : ses délégations ont été retirées`,
      link: '/moi/delegations',
      dedupeKey: `habilitations:${r.employee_id}:partie:${new Date().toISOString().slice(0, 10)}`,
    });
  }
  // La personne principale partie, la délégation en reçoit une autre (ADR-0128).
  await tenirLesPrincipaux(tx);
}

/**
 * Une alerte de la DCH — l'échéance d'un contrat : elle va à qui en tient
 * l'habilitation, sauf à l'agent qu'elle concerne (on ne suit pas son propre
 * contrat) et présents ; sans eux, à qui dirige la DCH ; sans lui, aux
 * administrateurs. Comme une demande déléguée : le directeur n'est plus
 * dérangé pour ce qu'il a délégué — sauf quand aucun délégué n'est là.
 */
export async function alerterLaDCH(
  tx: Tx,
  tenantId: string,
  capacite: Capacite,
  draft: NotificationDraft,
  concerne: string | null,
): Promise<void> {
  const dch = await directionDuPersonnel(tx);
  const qui = new Set<string>();
  if (dch) {
    for (const id of await detenteursDe(tx, capacite)) {
      if (id === concerne) continue;
      const m = await membreDCH(tx, dch, id);
      if (m !== 'parti' && !m.absent) qui.add(m.userId);
    }
    if (qui.size === 0 && dch.directeur && dch.directeur.employeeId !== concerne) {
      qui.add(dch.directeur.userId);
    }
  }
  if (qui.size === 0) {
    for (const id of await administrateursEnFonction(tx, tenantId)) qui.add(id);
  }
  for (const userId of qui) await notifier(tx, tenantId, userId, draft);
}
