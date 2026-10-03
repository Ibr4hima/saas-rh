import { sql } from 'drizzle-orm';
import type { EtapeConge } from '@teranga/contracts';
import type { Tx } from '../../db/tenant-db';
import { notifier } from '../notifications/notifier';
import { relancer, retirerLesAppels, tenirLesAppels } from '../acces/appels';
import { absence, accord, duAu } from '../notifications/phrases';
import {
  directionDuPersonnel,
  nomsDe,
  traitementDe,
  verifierLesHabilitations,
  viseur,
  type DirectionDuPersonnel,
  type Viseur,
} from '../acces/dch';
import { compterLesBloquees, reconcilierLesDemandes } from '../acces/demandes';
import { DG } from '../people/chaine';

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
        à la main, ou toutes, en habilitant des membres de sa direction.
        Confiée, la demande va directement aux membres, et le directeur
        n'est plus prévenu ; il voit tout, et peut reprendre la main ;
     3. un membre qui ne peut plus traiter (parti de la DCH ou de l'agence,
        sans accès, en congé aujourd'hui, ou demandeur lui-même) passe la
        main aux autres membres habilités, sinon au directeur ;
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

/** Le N+1 de l'agent, s'il peut viser (présent ou non). Le DG n'en a pas. */
export async function n1De(tx: Tx, employeeId: string): Promise<Viseur | null> {
  const { rows } = await tx.execute<{ n1: string | null }>(sql`
    SELECT CASE WHEN e.id IS DISTINCT FROM ${DG} AND e.manager_employee_id <> e.id
                THEN e.manager_employee_id END AS n1
      FROM employees e WHERE e.id = ${employeeId}`);
  return viseur(tx, rows[0]?.n1 ?? null);
}

/** Qui est attendu, pour quoi, et au nom de qui. */
export interface Attendu {
  etape: EtapeConge;
  /**
   * Qui peut viser — tous appelés, le premier qui vise l'emporte. Vide :
   * personne (poste de directeur vacant, DG sans accès).
   */
  valideurs: Viseur[];
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

/** Qui traite pour la DCH — la règle commune à toutes les demandes. */
async function traitantDCH(
  tx: Tx,
  demande: DemandeCircuit,
  dch: DirectionDuPersonnel | null,
): Promise<{ valideurs: Viseur[]; parDelegationDe: Viseur | null }> {
  const t = await traitementDe(
    tx,
    'demandes.conges',
    { employeeId: demande.employeeId, confieeA: demande.confieeAEmployeeId },
    dch,
  );
  return { valideurs: t.traitants, parDelegationDe: t.parDelegationDe };
}

/** Qui est attendu sur cette demande, maintenant — null si elle n'attend plus rien. */
export async function attendu(tx: Tx, demande: DemandeCircuit): Promise<Attendu | null> {
  if (demande.status !== 'pending') return null;
  const dch = await directionDuPersonnel(tx);
  const demandeDuDirecteur = Boolean(dch?.directeurEmployeeId === demande.employeeId);
  const leN1 = (n1: Viseur | null): Attendu => ({
    etape: 'n1',
    valideurs: n1 ? [n1] : [],
    parDelegationDe: null,
    demandeDuDirecteur,
    dch,
  });
  if (demande.currentLevel <= NIVEAU_N1) {
    const n1 = await n1De(tx, demande.employeeId);
    if (n1 && !n1.absent) return leN1(n1);
    if (demandeDuDirecteur) {
      // Le directeur du Capital Humain : son N+1 (le DG) vise seul. Absent,
      // ce sont ses membres habilités qui prennent le relais — sinon on
      // attend le DG.
      const t = await traitantDCH(tx, demande, dch);
      if (t.valideurs.length > 0) return { etape: 'dch', ...t, demandeDuDirecteur, dch };
      return leN1(n1);
    }
  }
  const t = await traitantDCH(tx, demande, dch);
  if (demandeDuDirecteur && t.valideurs.length === 0) {
    // Passée à ses membres, qui ne peuvent plus : elle revient au DG.
    return leN1(await n1De(tx, demande.employeeId));
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

/** « Moussa Ndiaye demande un congé annuel du 10 au 12 mai 2027 ». */
function demandeDe(d: Demande): string {
  const a = absence(d.type);
  return `${d.nom} demande ${a.article} ${a.nom} ${duAu(d.debut, d.fin)}`;
}

/** La clé de l'appel à viser : une par demande, par étape. */
const cleAppel = (requestId: string, etape: EtapeConge) => `conge:${requestId}:appel:${etape}`;
const cleVerdict = (requestId: string) => `conge:${requestId}:verdict`;

/** Le demandeur apprend le verdict. */
export async function annoncerLeVerdict(
  tx: Tx,
  d: Demande,
  verdict: 'approved' | 'rejected',
): Promise<void> {
  if (!d.demandeurUserId) return;
  const a = absence(d.type);
  await notifier(tx, d.tenantId, d.demandeurUserId, {
    type: verdict === 'approved' ? 'conge_approuve' : 'conge_refuse',
    title: `Votre ${a.nom} ${duAu(d.debut, d.fin)} est ${accord(verdict === 'approved' ? 'approuvé' : 'refusé', a)}`,
    link: '/moi/conges/historique',
    dedupeKey: cleVerdict(d.id),
  });
}

/**
 * Tient les appels à viser d'une demande d'accord avec le circuit : ceux qui
 * sont attendus ont LEUR appel, et eux seuls. Un appel adressé à quelqu'un
 * qui n'est plus attendu — N+1 remplacé, membre parti, étape passée — s'en
 * va. Idempotente : la rejouer ne prévient personne deux fois.
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
  const d = att && att.valideurs.length > 0 ? await lireDemande(tx, requestId) : null;
  const prefixe = `conge:${requestId}`;
  if (!att || !d) {
    await retirerLesAppels(tx, prefixe);
    return;
  }
  const destinataires = att.valideurs.map((v) => v.userId);
  if (att.etape === 'n1') {
    await tenirLesAppels(tx, d.tenantId, prefixe, 'n1', destinataires, {
      type: 'conge_a_viser',
      title: demandeDe(d),
      link: '/moi/equipe',
    });
    return;
  }
  await tenirLesAppels(tx, d.tenantId, prefixe, 'dch', destinataires, {
    type: 'conge_a_viser',
    title: demandeDe(d),
    link: '/moi/dch',
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
  await verifierLesHabilitations(tx, tenantId);
  const enAttente = await demandesEnAttente(tx);
  for (const id of enAttente) await reconcilierDemande(tx, id);
  await reconcilierLesDemandes(tx, tenantId);
  await verifierLaVacance(tx, tenantId, enAttente);
  await relancer(tx, tenantId);
}

/**
 * Personne ne traite pour la DCH — aucune direction du personnel désignée,
 * ou pas de responsable (ni d'intérimaire) qui puisse viser — alors que des
 * demandes l'attendent : l'administrateur est prévenu, pour désigner
 * l'intérimaire. L'alerte s'efface d'elle-même dès que quelqu'un traite.
 */
async function verifierLaVacance(tx: Tx, tenantId: string, enAttente: string[]): Promise<void> {
  let bloquees = await compterLesBloquees(tx);
  for (const id of enAttente) {
    const demande = await lireCircuit(tx, id);
    const att = demande ? await attendu(tx, demande) : null;
    if (att?.etape === 'dch' && att.valideurs.length === 0) bloquees += 1;
  }
  const dch = await directionDuPersonnel(tx);
  if (bloquees === 0) {
    await tx.execute(sql`DELETE FROM notifications WHERE dedupe_key = 'dch:vacante'`);
    return;
  }
  const { rows } = await tx.execute<{ user_id: string }>(sql`
    SELECT user_id FROM user_tenant_memberships WHERE tenant_id = ${tenantId} AND role = 'admin'`);
  for (const r of rows) {
    await notifier(tx, tenantId, r.user_id, {
      type: 'dch_vacante',
      title: dch
        ? `${bloquees > 1 ? 'Des demandes attendent' : 'Une demande attend'} un responsable à la ${dch.nom}`
        : `${bloquees > 1 ? 'Des demandes attendent' : 'Une demande attend'} une direction du personnel`,
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
    dch: nomsDe(t.valideurs),
    demandeDuDirecteur: Boolean(dch?.directeurEmployeeId === employeeId),
  };
}
