import { sql, type SQL } from 'drizzle-orm';
import {
  CAPACITE_INFOS,
  CAPACITES_DELEGABLES,
  CAPACITES_GESTION,
  type Capacite,
  type CapaciteDemande,
} from '@teranga/contracts';
import { problem } from '../../common/problem';
import type { Tx } from '../../db/tenant-db';
import { notifier, type NotificationDraft } from '../notifications/notifier';
import { directionDeEmploye, directionDeLUnite, uniteEnVigueur } from '../people/chaine';

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
}

/** Absent aujourd'hui : une absence approuvée couvre ce jour. En SQL. */
const estAbsent = (employeeId: SQL) => sql`EXISTS (
  SELECT 1 FROM absence_requests ab
   WHERE ab.employee_id = ${employeeId} AND ab.status = 'approved'
     AND CURRENT_DATE BETWEEN ab.start_date AND ab.end_date)`;

/** Un agent, s'il peut viser — sinon null. */
export async function viseur(tx: Tx, employeeId: string | null): Promise<Viseur | null> {
  if (!employeeId) return null;
  const { rows } = await tx.execute<{
    employee_id: string;
    user_id: string;
    nom: string;
    absent: boolean;
  }>(sql`
    SELECT e.id AS employee_id, u.id AS user_id,
           p.given_name || ' ' || p.family_name AS nom,
           ${estAbsent(sql`e.id`)} AS absent
      FROM employees e
      JOIN persons p ON p.id = e.person_id AND p.user_id IS NOT NULL AND p.deleted_at IS NULL
      JOIN users u ON u.id = p.user_id AND u.status = 'active'
      JOIN user_tenant_memberships m ON m.user_id = u.id AND m.tenant_id = e.tenant_id
     WHERE e.id = ${employeeId} AND e.status = 'active'
     LIMIT 1`);
  const r = rows[0];
  return r ? { employeeId: r.employee_id, userId: r.user_id, nom: r.nom, absent: r.absent } : null;
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
export async function directionDuPersonnel(tx: Tx): Promise<DirectionDuPersonnel | null> {
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
export async function membreDCH(
  tx: Tx,
  dch: DirectionDuPersonnel,
  employeeId: string,
): Promise<Viseur | 'parti'> {
  const v = await viseur(tx, employeeId);
  if (!v) return 'parti';
  const direction = await directionDeEmploye(tx, employeeId);
  return direction?.id === dch.uniteId ? v : 'parti';
}

/** Les membres à qui une habilitation est confiée, en cours — du plus ancien au plus récent. */
export async function detenteursDe(tx: Tx, capacite: Capacite): Promise<string[]> {
  const { rows } = await tx.execute<{ employee_id: string }>(sql`
    SELECT employee_id FROM habilitations
     WHERE capacite = ${capacite} AND fin_at IS NULL
     ORDER BY created_at, employee_id`);
  return rows.map((r) => r.employee_id);
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
}

/**
 * Qui traite une demande pour la DCH — la règle, pour tous les types :
 *
 *   1. le membre à qui le directeur l'a confiée, à la main, s'il le peut ;
 *   2. sinon, les membres habilités à ce type de demande qui le peuvent —
 *      tous prévenus ;
 *   3. sinon, le directeur du Capital Humain (en congé ou non : il n'y a
 *      personne après lui).
 *
 * « Le peut » : membre de la DCH, avec un accès ouvert, présent aujourd'hui.
 * Personne ne traite sa propre demande — celle du directeur va à ses
 * membres habilités, ou attend qu'il la confie.
 */
export async function traitementDe(
  tx: Tx,
  capacite: CapaciteDemande,
  demande: { employeeId: string; confieeA: string | null },
  dchConnue?: DirectionDuPersonnel | null,
): Promise<Traitement> {
  const dch = dchConnue === undefined ? await directionDuPersonnel(tx) : dchConnue;
  if (!dch) return { traitants: [], parDelegationDe: null, aConfier: false, dch: null };
  const directeur = dch.directeur;
  const disponible = async (employeeId: string): Promise<Viseur | null> => {
    if (employeeId === demande.employeeId || employeeId === dch.directeurEmployeeId) return null;
    const m = await membreDCH(tx, dch, employeeId);
    return m !== 'parti' && !m.absent ? m : null;
  };
  const repriseParLeDirecteur =
    demande.confieeA !== null && demande.confieeA === dch.directeurEmployeeId;
  if (demande.confieeA && !repriseParLeDirecteur) {
    const m = await disponible(demande.confieeA);
    if (m) return { traitants: [m], parDelegationDe: directeur, aConfier: false, dch };
  }
  if (!repriseParLeDirecteur || directeur?.employeeId === demande.employeeId) {
    const membres: Viseur[] = [];
    for (const id of await detenteursDe(tx, capacite)) {
      const m = await disponible(id);
      if (m) membres.push(m);
    }
    if (membres.length > 0) {
      return { traitants: membres, parDelegationDe: directeur, aConfier: false, dch };
    }
  }
  if (directeur && directeur.employeeId !== demande.employeeId) {
    return { traitants: [directeur], parDelegationDe: null, aConfier: false, dch };
  }
  return {
    traitants: [],
    parDelegationDe: null,
    aConfier: Boolean(directeur && directeur.employeeId === demande.employeeId),
    dch,
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

/** Les membres actifs de la DCH, directeur exclu : à qui l'on peut confier. */
export async function membresDeLaDCH(
  tx: Tx,
  dch: DirectionDuPersonnel,
): Promise<Array<{ employeeId: string; nom: string; poste: string | null; absent: boolean }>> {
  const { rows } = await tx.execute<{
    id: string;
    nom: string;
    poste: string | null;
    absent: boolean;
  }>(sql`
    SELECT e.id, p.given_name || ' ' || p.family_name AS nom,
           (SELECT a.position_title FROM assignments a
             WHERE a.employee_id = e.id
               AND (a.validity @> CURRENT_DATE OR lower(a.validity) > CURRENT_DATE)
             ORDER BY lower(a.validity) LIMIT 1) AS poste,
           ${estAbsent(sql`e.id`)} AS absent
      FROM employees e
      JOIN persons p ON p.id = e.person_id AND p.user_id IS NOT NULL AND p.deleted_at IS NULL
      JOIN users u ON u.id = p.user_id AND u.status = 'active'
      JOIN user_tenant_memberships m ON m.user_id = u.id AND m.tenant_id = e.tenant_id
     WHERE e.status = 'active'
       AND e.id IS DISTINCT FROM ${dch.directeurEmployeeId}
       AND ${directionDeLUnite(uniteEnVigueur(sql`e.id`), 'id')} = ${dch.uniteId}
     ORDER BY p.family_name, p.given_name`);
  return rows.map((r) => ({ employeeId: r.id, nom: r.nom, poste: r.poste, absent: r.absent }));
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
  const moi = await agentDuCompte(tx, userId);
  if (!moi || !employeeIds.includes(moi)) return;
  problem(
    403,
    'acces.son_propre_dossier',
    `Vous ne pouvez pas ${geste} vous-même`,
    'Ce qui vous concerne passe par une demande, comme pour tout agent : un autre membre de la DCH — ou l’administrateur — s’en charge. Un changement d’informations se signale depuis « Mes informations ».',
  );
}

/** L'agent relié à ce compte, s'il est actif. */
export async function agentDuCompte(tx: Tx, userId: string): Promise<string | null> {
  const { rows } = await tx.execute<{ id: string }>(sql`
    SELECT e.id FROM employees e JOIN persons p ON p.id = e.person_id
     WHERE p.user_id = ${userId} AND e.status = 'active' AND p.deleted_at IS NULL
     LIMIT 1`);
  return rows[0]?.id ?? null;
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
): Promise<{ capacites: Capacite[]; estAgent: boolean; dirigeLaDCH: boolean }> {
  const base = new Set<Capacite>(role === 'admin' ? CAPACITES_GESTION : []);
  const moi = await agentDuCompte(tx, userId);
  if (!moi) return { capacites: [...base], estAgent: false, dirigeLaDCH: false };
  const dch = await directionDuPersonnel(tx);
  if (dch?.directeurEmployeeId === moi) {
    // Tout ce qui se délègue — l'Academy reste à l'administrateur.
    return { capacites: [...CAPACITES_DELEGABLES], estAgent: true, dirigeLaDCH: true };
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
  return { capacites: [...base], estAgent: true, dirigeLaDCH: false };
}

const libelles = (capacites: string[]) =>
  capacites
    .map((c) => CAPACITE_INFOS[c as Capacite]?.libelle ?? c)
    .map((l) => l.charAt(0).toLowerCase() + l.slice(1))
    .join(', ');

export async function nomDe(tx: Tx, employeeId: string): Promise<string> {
  const { rows } = await tx.execute<{ nom: string }>(sql`
    SELECT p.given_name || ' ' || p.family_name AS nom
      FROM employees e JOIN persons p ON p.id = e.person_id WHERE e.id = ${employeeId}`);
  return rows[0]?.nom ?? 'Un membre';
}

/**
 * Un membre qui n'est plus de la DCH — muté, parti, sans accès — perd ses
 * habilitations : elles se closent, et le directeur l'apprend. Ce qu'il
 * traitait revient au directeur.
 */
export async function verifierLesHabilitations(tx: Tx, tenantId: string): Promise<void> {
  const { rows } = await tx.execute<{ employee_id: string; capacites: string[] }>(sql`
    SELECT employee_id, array_agg(capacite ORDER BY capacite) AS capacites
      FROM habilitations WHERE fin_at IS NULL GROUP BY employee_id`);
  if (rows.length === 0) return;
  const dch = await directionDuPersonnel(tx);
  for (const r of rows) {
    const membre = dch ? await membreDCH(tx, dch, r.employee_id) : 'parti';
    if (membre !== 'parti') continue;
    await tx.execute(sql`
      UPDATE habilitations SET fin_at = now(), fin_motif = 'partie'
       WHERE employee_id = ${r.employee_id} AND fin_at IS NULL`);
    if (!dch?.directeur) continue;
    const nom = await nomDe(tx, r.employee_id);
    await notifier(tx, tenantId, dch.directeur.userId, {
      type: 'delegation_rompue',
      title: `${nom} ne fait plus partie de la DCH`,
      body: `Ses habilitations sont retirées : ${libelles(r.capacites)}. Les demandes qu’elle ou il traitait passent aux autres membres habilités, ou vous reviennent. Vous pouvez confier ces tâches à un autre membre de votre direction.`,
      link: '/moi/delegations',
      dedupeKey: `habilitations:${r.employee_id}:partie:${new Date().toISOString().slice(0, 10)}`,
    });
  }
}

/**
 * Un nouveau directeur du Capital Humain trouve les délégations en place —
 * elles appartiennent à la DCH, et le travail continue. Il en reçoit la
 * liste, une fois, pour les revoir s'il le veut.
 */
export async function accueillirLeDirecteur(tx: Tx, tenantId: string): Promise<void> {
  const dch = await directionDuPersonnel(tx);
  if (!dch?.directeur) return;
  const { rows } = await tx.execute<{ employee_id: string; capacites: string[] }>(sql`
    SELECT employee_id, array_agg(capacite ORDER BY capacite) AS capacites
      FROM habilitations WHERE fin_at IS NULL GROUP BY employee_id`);
  const lignes: string[] = [];
  for (const r of rows) lignes.push(`${await nomDe(tx, r.employee_id)} : ${libelles(r.capacites)}`);
  await notifier(tx, tenantId, dch.directeur.userId, {
    type: 'delegation',
    title: `Vous dirigez la ${dch.nom}`,
    body:
      lignes.length > 0
        ? `Les délégations en place sont maintenues — ${lignes.join(' ; ')}. Vous pouvez les modifier dans « Délégations ».`
        : 'Toutes les demandes et tous les accès de la DCH vous reviennent. Vous pouvez en confier aux membres de votre direction dans « Délégations ».',
    link: '/moi/delegations',
    dedupeKey: `dch:directeur:${dch.directeur.employeeId}`,
  });
}

/**
 * Prévient la DCH d'une affaire qui relève d'une habilitation : son
 * directeur, et les membres qui la détiennent. Sans DCH qui puisse l'être,
 * l'administrateur — pour que rien ne se perde.
 */
export async function notifierLaDCH(
  tx: Tx,
  tenantId: string,
  capacite: Capacite,
  draft: NotificationDraft,
): Promise<void> {
  const dch = await directionDuPersonnel(tx);
  const qui = new Set<string>();
  if (dch?.directeur) qui.add(dch.directeur.userId);
  if (dch) {
    for (const id of await detenteursDe(tx, capacite)) {
      const m = await membreDCH(tx, dch, id);
      if (m !== 'parti') qui.add(m.userId);
    }
  }
  if (qui.size === 0) {
    const { rows } = await tx.execute<{ user_id: string }>(sql`
      SELECT user_id FROM user_tenant_memberships WHERE tenant_id = ${tenantId} AND role = 'admin'`);
    for (const r of rows) qui.add(r.user_id);
  }
  for (const userId of qui) await notifier(tx, tenantId, userId, draft);
}
