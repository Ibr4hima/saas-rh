import { sql, type SQL } from 'drizzle-orm';
import type { EtapeConge } from '@teranga/contracts';
import type { Tx } from '../../db/tenant-db';
import { notifier } from '../notifications/notifier';
import { DG, directionDeEmploye } from '../people/chaine';
import { DELAI_RELANCE_JOURS_OUVRES, joursOuvresEcoules } from './workdays';

/* ————————————————————————————————————————————————————————————————
   Le circuit d'une demande d'absence : le N+1, puis la DCH.

   Qui vise, dans quel ordre, et qui est prévenu — écrit une fois, ici. Le
   service des congés s'en sert pour poser, viser, annuler, confier ; la
   fiche agent, l'organigramme et la boîte de notifications pour tenir le
   circuit à jour quand l'organisation bouge.

   Les règles, décidées avec l'APIX :
     1. le N+1 de l'agent vise d'abord — celui du MOMENT où il vise. Sans
        N+1 qui puisse viser (le DG, un N+1 archivé, sans accès au portail,
        ou en congé aujourd'hui), la demande va directement à la DCH ;
     2. la DCH, c'est son directeur — le responsable de la direction du
        personnel dans l'organigramme. Il traite, ou il confie : une demande
        à la fois, ou toutes, à un membre de sa direction. Confiée, la
        demande va directement au membre, et le directeur n'est plus
        prévenu ; il voit tout, et peut reprendre la main ;
     3. un membre qui ne peut plus traiter (parti de la DCH ou de l'agence,
        sans accès, en congé aujourd'hui, ou demandeur lui-même) rend la
        demande au directeur ;
     4. la demande du directeur du Capital Humain lui-même : le visa du DG
        suffit ;
     5. la même personne attendue aux deux étapes vise une seule fois ;
     6. personne ne vise sa propre demande.

   Rien de tout cela n'est COPIÉ sur la demande, sauf un geste explicite du
   directeur (« confier à ») : qui est attendu se calcule au moment où on le
   demande. Une mutation, une reprise d'équipe, un congé qui commence, un
   nouveau directeur font suivre la demande sans rien réécrire — et les
   appels à viser se réconcilient avec ce calcul.
   ———————————————————————————————————————————————————————————————— */

export const NIVEAU_N1 = 0;
export const NIVEAU_DCH = 1;

export const etapeDuNiveau = (niveau: number): EtapeConge => (niveau <= NIVEAU_N1 ? 'n1' : 'dch');

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

/** Le N+1 de l'agent, s'il peut viser (présent ou non). Le DG n'en a pas. */
export async function n1De(tx: Tx, employeeId: string): Promise<Viseur | null> {
  const { rows } = await tx.execute<{ n1: string | null }>(sql`
    SELECT CASE WHEN e.id IS DISTINCT FROM ${DG} AND e.manager_employee_id <> e.id
                THEN e.manager_employee_id END AS n1
      FROM employees e WHERE e.id = ${employeeId}`);
  return viseur(tx, rows[0]?.n1 ?? null);
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

/** Le choix en cours du directeur, pour ce type de demande. */
export async function choixDuDirecteur(
  tx: Tx,
  directeurEmployeeId: string,
  typeDemande = 'conges',
): Promise<{ id: string; delegueEmployeeId: string | null } | null> {
  const { rows } = await tx.execute<{ id: string; delegue_employee_id: string | null }>(sql`
    SELECT id, delegue_employee_id FROM delegations
     WHERE directeur_employee_id = ${directeurEmployeeId} AND type_demande = ${typeDemande}
       AND fin_at IS NULL
     LIMIT 1`);
  const r = rows[0];
  return r ? { id: r.id, delegueEmployeeId: r.delegue_employee_id } : null;
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

/** Qui est attendu, pour quoi, et au nom de qui. */
export interface Attendu {
  etape: EtapeConge;
  /** Qui doit viser (null : personne — poste de directeur vacant). */
  valideur: Viseur | null;
  /** Il vise pour le compte du directeur du Capital Humain. */
  parDelegationDe: Viseur | null;
  /** La demande vient du directeur du Capital Humain : le DG vise seul. */
  demandeDuDirecteur: boolean;
  /** La direction du personnel, telle qu'elle est. */
  dch: DirectionDuPersonnel | null;
}

interface DemandeCircuit {
  id: string;
  employeeId: string;
  status: string;
  currentLevel: number;
  confieeAEmployeeId: string | null;
}

/**
 * Qui traite pour la DCH : le membre à qui la demande est confiée — à la
 * main, ou par la règle du directeur — s'il le peut ; sinon le directeur.
 */
async function traitantDCH(
  tx: Tx,
  demande: DemandeCircuit,
  dch: DirectionDuPersonnel | null,
): Promise<{ valideur: Viseur | null; parDelegationDe: Viseur | null }> {
  const directeur = dch?.directeur ?? null;
  if (!dch || !directeur) return { valideur: null, parDelegationDe: null };
  const choix = await choixDuDirecteur(tx, directeur.employeeId);
  const confieA = demande.confieeAEmployeeId ?? choix?.delegueEmployeeId ?? null;
  if (confieA && confieA !== directeur.employeeId && confieA !== demande.employeeId) {
    const membre = await membreDCH(tx, dch, confieA);
    if (membre !== 'parti' && !membre.absent) {
      return { valideur: membre, parDelegationDe: directeur };
    }
  }
  // Le directeur lui-même — jamais pour sa propre demande, que le DG vise seul.
  if (directeur.employeeId === demande.employeeId) return { valideur: null, parDelegationDe: null };
  return { valideur: directeur, parDelegationDe: null };
}

/** Qui est attendu sur cette demande, maintenant — null si elle n'attend plus rien. */
export async function attendu(tx: Tx, demande: DemandeCircuit): Promise<Attendu | null> {
  if (demande.status !== 'pending') return null;
  const dch = await directionDuPersonnel(tx);
  const demandeDuDirecteur = Boolean(dch?.directeurEmployeeId === demande.employeeId);
  if (demande.currentLevel <= NIVEAU_N1) {
    const n1 = await n1De(tx, demande.employeeId);
    if (n1 && !n1.absent) {
      return { etape: 'n1', valideur: n1, parDelegationDe: null, demandeDuDirecteur, dch };
    }
    if (demandeDuDirecteur) {
      // Le directeur du Capital Humain : son N+1 (le DG) vise seul. Absent,
      // c'est son délégué qui prend le relais — sinon on attend le DG.
      const t = await traitantDCH(tx, demande, dch);
      if (t.valideur) return { etape: 'dch', ...t, demandeDuDirecteur, dch };
      return { etape: 'n1', valideur: n1, parDelegationDe: null, demandeDuDirecteur, dch };
    }
  }
  const t = await traitantDCH(tx, demande, dch);
  if (demandeDuDirecteur && !t.valideur) {
    // Passée à son délégué, qui ne peut plus : elle revient au DG.
    const n1 = await n1De(tx, demande.employeeId);
    return { etape: 'n1', valideur: n1, parDelegationDe: null, demandeDuDirecteur, dch };
  }
  return { etape: 'dch', ...t, demandeDuDirecteur, dch };
}

/** La demande, lue pour le circuit. */
export async function lireCircuit(tx: Tx, requestId: string): Promise<DemandeCircuit | null> {
  const { rows } = await tx.execute<{
    id: string;
    employee_id: string;
    status: string;
    current_level: number;
    confiee_a_employee_id: string | null;
  }>(sql`
    SELECT id, employee_id, status, current_level, confiee_a_employee_id
      FROM absence_requests WHERE id = ${requestId}`);
  const r = rows[0];
  return r
    ? {
        id: r.id,
        employeeId: r.employee_id,
        status: r.status,
        currentLevel: r.current_level,
        confieeAEmployeeId: r.confiee_a_employee_id,
      }
    : null;
}

// ———————————————————————————————————————————— les messages

interface Demande {
  id: string;
  tenantId: string;
  employeeId: string;
  nom: string;
  type: string;
  debut: string;
  fin: string;
  jours: number;
  demandeurUserId: string | null;
}

/** Ce qu'un message dit de la demande — qui, quoi, quand. */
export async function lireDemande(tx: Tx, requestId: string): Promise<Demande | null> {
  const { rows } = await tx.execute<{
    id: string;
    tenant_id: string;
    employee_id: string;
    nom: string;
    type: string;
    debut: string;
    fin: string;
    jours: string;
    user_id: string | null;
  }>(sql`
    SELECT r.id, r.tenant_id, r.employee_id, p.given_name || ' ' || p.family_name AS nom,
           ty.name AS type, r.start_date::text AS debut, r.end_date::text AS fin,
           r.days_count::text AS jours, p.user_id
      FROM absence_requests r
      JOIN employees e ON e.id = r.employee_id
      JOIN persons p ON p.id = e.person_id
      JOIN absence_types ty ON ty.id = r.absence_type_id
     WHERE r.id = ${requestId}`);
  const r = rows[0];
  return r
    ? {
        id: r.id,
        tenantId: r.tenant_id,
        employeeId: r.employee_id,
        nom: r.nom,
        type: r.type,
        debut: r.debut,
        fin: r.fin,
        jours: Number(r.jours),
        demandeurUserId: r.user_id,
      }
    : null;
}

/** « 9 septembre 2026 » — jamais d'ISO brut dans un texte lu par un humain. */
function frDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function periode(d: Demande): string {
  const jours = `${d.jours} jour${d.jours > 1 ? 's' : ''}`;
  return d.debut === d.fin
    ? `${d.type} · le ${frDate(d.debut)} (${jours})`
    : `${d.type} · du ${frDate(d.debut)} au ${frDate(d.fin)} (${jours})`;
}

/** La clé de l'appel à viser : une par demande, par étape. */
const cleAppel = (requestId: string, etape: EtapeConge) => `conge:${requestId}:appel:${etape}`;
const cleVerdict = (requestId: string) => `conge:${requestId}:verdict`;

/** Le demandeur apprend le verdict. */
export async function annoncerLeVerdict(
  tx: Tx,
  d: Demande,
  verdict: 'approved' | 'rejected',
  par: string,
  commentaire?: string | null,
): Promise<void> {
  if (!d.demandeurUserId) return;
  await notifier(tx, d.tenantId, d.demandeurUserId, {
    type: verdict === 'approved' ? 'conge_approuve' : 'conge_refuse',
    title: verdict === 'approved' ? 'Congé approuvé' : 'Congé refusé',
    body: `${periode(d)}. ${verdict === 'approved' ? 'Approuvée' : 'Refusée'} par ${par}.${
      commentaire ? ` « ${commentaire} »` : ''
    }`,
    link: '/moi/conges',
    dedupeKey: cleVerdict(d.id),
  });
}

/** Qui a visé l'étape du N+1, pour le dire à la DCH. */
async function viseParN1(tx: Tx, requestId: string): Promise<string | null> {
  const { rows } = await tx.execute<{ nom: string }>(sql`
    SELECT u.given_name || ' ' || u.family_name AS nom
      FROM absence_approvals a JOIN users u ON u.id = a.decided_by_user_id
     WHERE a.request_id = ${requestId} AND a.level = ${NIVEAU_N1} AND a.decision = 'approved'`);
  return rows[0]?.nom ?? null;
}

/**
 * Tient les appels à viser d'une demande d'accord avec le circuit : celui
 * qui est attendu a SON appel, et lui seul. Un appel adressé à quelqu'un qui
 * n'est plus attendu — N+1 remplacé, délégué parti, étape passée — s'en va.
 * Idempotente : la rejouer ne prévient personne deux fois.
 */
export async function reconcilierDemande(tx: Tx, requestId: string): Promise<void> {
  const demande = await lireCircuit(tx, requestId);
  if (!demande) return;
  const att = await attendu(tx, demande);
  // Arrivée à la DCH — visée par le N+1, ou sans N+1 qui puisse viser —,
  // elle y reste : un N+1 qui revient de congé ne la reprend pas en route.
  if (att?.etape === 'dch' && demande.currentLevel < NIVEAU_DCH) {
    await tx.execute(
      sql`UPDATE absence_requests SET current_level = ${NIVEAU_DCH} WHERE id = ${requestId}`,
    );
  }
  // Confiée par la règle du directeur : elle est désormais À ce membre. Un
  // nouveau directeur, ou une règle qui change, ne la lui reprend pas — ce
  // qui est confié reste confié ; le directeur peut toujours la reprendre.
  if (att?.etape === 'dch' && att.parDelegationDe && att.valideur && !demande.confieeAEmployeeId) {
    await tx.execute(sql`
      UPDATE absence_requests SET confiee_a_employee_id = ${att.valideur.employeeId}
       WHERE id = ${requestId}`);
  }
  const cle = att?.valideur ? cleAppel(requestId, att.etape) : null;
  // Les appels ET leurs rappels : ceux de qui n'est plus attendu s'en vont.
  const cleRappel = cle ? cle.replace(':appel:', ':rappel:') : null;
  await tx.execute(sql`
    DELETE FROM notifications
     WHERE (dedupe_key LIKE ${`conge:${requestId}:appel:%`}
            OR dedupe_key LIKE ${`conge:${requestId}:rappel:%`})
       AND (${cle}::text IS NULL
            OR dedupe_key NOT IN (${cle}, ${cleRappel})
            OR recipient_user_id <> ${att?.valideur?.userId ?? null}::uuid)`);
  if (!att?.valideur || !cle) return;
  const d = await lireDemande(tx, requestId);
  if (!d) return;
  if (att.etape === 'n1') {
    await notifier(tx, d.tenantId, att.valideur.userId, {
      type: 'conge_a_viser',
      title: `Congé à valider : ${d.nom}`,
      body: att.demandeDuDirecteur
        ? `${periode(d)}. Vous êtes son N+1 : votre visa suffit.`
        : `${periode(d)}. Vous êtes son N+1 : la DCH la reçoit après votre visa.`,
      link: '/moi/equipe',
      dedupeKey: cle,
    });
    return;
  }
  const n1 = await viseParN1(tx, requestId);
  const origine = n1
    ? `Visée par ${n1}, son N+1.`
    : 'Sans N+1 disponible, elle vient directement à la DCH.';
  await notifier(tx, d.tenantId, att.valideur.userId, {
    type: 'conge_a_viser',
    title: `Congé à traiter : ${d.nom}`,
    body: att.parDelegationDe
      ? `${periode(d)}. ${origine} Confiée par ${att.parDelegationDe.nom} (DCH).`
      : `${periode(d)}. ${origine} Vous pouvez la traiter, ou la confier à un membre de la DCH.`,
    link: '/moi/dch',
    dedupeKey: cle,
  });
}

/** Les demandes en attente — le circuit tient sur elles. */
async function demandesEnAttente(tx: Tx, employeeId?: string): Promise<string[]> {
  const { rows } = await tx.execute<{ id: string }>(sql`
    SELECT id FROM absence_requests
     WHERE status = 'pending' ${employeeId ? sql`AND employee_id = ${employeeId}` : sql``}
     ORDER BY created_at`);
  return rows.map((r) => r.id);
}

/** Le N+1 d'un agent vient de changer : ses demandes le suivent. */
export async function faireSuivreLesDemandes(tx: Tx, employeeId: string): Promise<void> {
  for (const id of await demandesEnAttente(tx, employeeId)) await reconcilierDemande(tx, id);
}

/**
 * L'organisation a bougé (organigramme, mutation, départ, délégation) : tout
 * le circuit se relit. Les demandes vont à qui les attend désormais ; le
 * directeur apprend que son délégué est parti ; l'administrateur, que plus
 * personne ne traite pour la DCH.
 */
export async function reconcilierLeCircuit(tx: Tx, tenantId: string): Promise<void> {
  const enAttente = await demandesEnAttente(tx);
  for (const id of enAttente) await reconcilierDemande(tx, id);
  await verifierLaDelegation(tx, tenantId);
  await verifierLaVacance(tx, tenantId, enAttente);
  await relancer(tx, tenantId);
}

/**
 * Les relances : qui est attendu depuis plus de deux jours ouvrés reçoit un
 * rappel — une fois par étape. L'appel à viser porte la date où la personne
 * a été appelée ; il n'existe que tant qu'elle est attendue, donc le rappel
 * va toujours à la bonne personne. Un changement de traitant repart à zéro.
 */
async function relancer(tx: Tx, tenantId: string): Promise<void> {
  const { rows: appels } = await tx.execute<{
    recipient_user_id: string;
    dedupe_key: string;
    le: string;
    title: string;
    body: string | null;
    link: string | null;
  }>(sql`
    SELECT recipient_user_id, dedupe_key, (created_at AT TIME ZONE 'UTC')::date::text AS le,
           title, body, link
      FROM notifications WHERE dedupe_key LIKE '%:appel:%'`);
  if (appels.length === 0) return;
  const { rows: jours } = await tx.execute<{ jour: string; aujourdhui: string }>(sql`
    SELECT day::text AS jour, CURRENT_DATE::text AS aujourdhui
      FROM holidays WHERE day IS NOT NULL
    UNION ALL SELECT NULL, CURRENT_DATE::text`);
  const aujourdhui = jours[0]!.aujourdhui;
  const feries = new Set(jours.map((j) => j.jour).filter((j): j is string => Boolean(j)));
  for (const a of appels) {
    if (joursOuvresEcoules(a.le, aujourdhui, feries) < DELAI_RELANCE_JOURS_OUVRES) continue;
    await notifier(tx, tenantId, a.recipient_user_id, {
      type: 'rappel',
      title: `Rappel — ${a.title}`,
      body: `En attente de vous depuis le ${frDate(a.le)}.${a.body ? ` ${a.body}` : ''}`,
      link: a.link ?? undefined,
      dedupeKey: a.dedupe_key.replace(':appel:', ':rappel:'),
    });
  }
}

/** Le délégué ne fait plus partie de la DCH : le directeur l'apprend, une fois. */
async function verifierLaDelegation(tx: Tx, tenantId: string): Promise<void> {
  const dch = await directionDuPersonnel(tx);
  if (!dch?.directeur) return;
  const choix = await choixDuDirecteur(tx, dch.directeur.employeeId);
  if (!choix?.delegueEmployeeId) return;
  const membre = await membreDCH(tx, dch, choix.delegueEmployeeId);
  if (membre !== 'parti') return;
  const { rows } = await tx.execute<{ nom: string }>(sql`
    SELECT p.given_name || ' ' || p.family_name AS nom
      FROM employees e JOIN persons p ON p.id = e.person_id
     WHERE e.id = ${choix.delegueEmployeeId}`);
  const nom = rows[0]?.nom ?? 'La personne désignée';
  await notifier(tx, tenantId, dch.directeur.userId, {
    type: 'delegation_rompue',
    title: `${nom} ne traite plus les demandes de congé`,
    body: `${nom} ne fait plus partie de la ${dch.nom} : les demandes de congé vous reviennent. Voulez-vous les confier à un autre membre de votre direction ?`,
    link: '/moi/dch',
    dedupeKey: `delegation:${choix.id}:rompue`,
  });
}

/**
 * Personne ne traite pour la DCH — aucune direction du personnel désignée,
 * ou pas de responsable (ni d'intérimaire) qui puisse viser — alors que des
 * demandes l'attendent : l'administrateur est prévenu, pour désigner
 * l'intérimaire. L'alerte s'efface d'elle-même dès que quelqu'un traite.
 */
async function verifierLaVacance(tx: Tx, tenantId: string, enAttente: string[]): Promise<void> {
  let bloquees = 0;
  let dch: DirectionDuPersonnel | null = null;
  for (const id of enAttente) {
    const demande = await lireCircuit(tx, id);
    const att = demande ? await attendu(tx, demande) : null;
    if (att?.etape === 'dch' && !att.valideur) {
      bloquees += 1;
      dch = att.dch;
    }
  }
  if (bloquees === 0) {
    await tx.execute(sql`DELETE FROM notifications WHERE dedupe_key = 'dch:vacante'`);
    return;
  }
  const { rows } = await tx.execute<{ user_id: string }>(sql`
    SELECT user_id FROM user_tenant_memberships WHERE tenant_id = ${tenantId} AND role = 'admin'`);
  const qui = dch
    ? `la ${dch.nom} n’a pas de responsable qui puisse les traiter`
    : 'aucune direction du personnel n’est désignée dans l’organigramme';
  for (const r of rows) {
    await notifier(tx, tenantId, r.user_id, {
      type: 'dch_vacante',
      title: 'Des demandes de congé attendent la DCH',
      body: `${bloquees > 1 ? `${bloquees} demandes attendent` : 'Une demande attend'} : ${qui}. Désignez le responsable — ou l’intérimaire — dans l’organigramme.`,
      link: '/organisation',
      dedupeKey: 'dch:vacante',
    });
  }
}

/**
 * Le circuit se relit au plus une fois par minute et par organisation, à la
 * lecture des notifications : un congé qui commence à minuit, un délégué
 * dont l'accès est fermé ne déclenchent aucune écriture — c'est ici qu'on
 * les voit passer.
 */
const derniereReconciliation = new Map<string, number>();
export async function reconcilierSiLeTempsEstVenu(tx: Tx, tenantId: string): Promise<void> {
  const maintenant = Date.now();
  if (maintenant - (derniereReconciliation.get(tenantId) ?? 0) < 60_000) return;
  derniereReconciliation.set(tenantId, maintenant);
  await reconcilierLeCircuit(tx, tenantId);
}

/** Les demandes qui attendent la DCH — le compteur de la RH. */
export async function compterEnAttenteDCH(tx: Tx): Promise<number> {
  let n = 0;
  for (const id of await demandesEnAttente(tx)) {
    const demande = await lireCircuit(tx, id);
    if (demande && (await attendu(tx, demande))?.etape === 'dch') n += 1;
  }
  return n;
}

/**
 * Qui viserait une demande de cet agent, aujourd'hui : son N+1 (s'il peut),
 * puis qui traite pour la DCH. Le portail l'annonce avant qu'il la pose.
 */
export async function quiViseraPour(
  tx: Tx,
  employeeId: string,
): Promise<{ n1: string | null; dch: string | null; demandeDuDirecteur: boolean }> {
  const fictive: DemandeCircuit = {
    id: '',
    employeeId,
    status: 'pending',
    currentLevel: NIVEAU_N1,
    confieeAEmployeeId: null,
  };
  const n1 = await n1De(tx, employeeId);
  const dch = await directionDuPersonnel(tx);
  const t = await traitantDCH(tx, fictive, dch);
  return {
    n1: n1 && !n1.absent ? n1.nom : null,
    dch: t.valideur?.nom ?? null,
    demandeDuDirecteur: Boolean(dch?.directeurEmployeeId === employeeId),
  };
}
