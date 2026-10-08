import { sql } from 'drizzle-orm';
import type { EtapeConge, SujetNotification } from '@teranga/contracts';
import type { Tx } from '../../db/tenant-db';
import { notifier, type NotificationDraft } from '../notifications/notifier';
import { relancer, retirerLesAppels, tenirLesAppels } from '../acces/appels';
import { ABSENCE, absence, accord, de, duAu, frDate, leLa, sonSa } from '../notifications/phrases';
import type { Heures, Nom } from '../notifications/phrases';
import {
  administrateursEnFonction,
  directionDuPersonnel,
  nomsDe,
  traitementDe,
  verifierLesHabilitations,
  viseur,
  type DirectionDuPersonnel,
  type Viseur,
} from '../acces/dch';
import { compterLesBloquees, libererLesConfiees, reconcilierLesDemandes } from '../acces/demandes';
import { DG } from '../people/chaine';
import { DELAI_N1_JOURS_OUVRES } from './workdays';
import { reconcilierLesEvaluations } from '../objectifs/evaluation-attendue';
import { parLeSysteme } from '../../db/systeme';

/* ————————————————————————————————————————————————————————————————
   Le circuit d'une demande d'absence : le N+1, puis la DCH.

   Qui vise, dans quel ordre, et qui est prévenu — écrit une fois, ici. Le
   service des congés s'en sert pour poser, viser, annuler, confier ; la
   fiche agent, l'organigramme et la boîte de notifications pour tenir le
   circuit à jour quand l'organisation bouge.

   Les règles, décidées avec l'APIX :
     1. le N+1 de l'agent vise d'abord — celui du MOMENT où il vise. Sans
        N+1 qui puisse viser (le DG, un N+1 archivé, sans accès au portail),
        la demande va directement à la DCH ; elle y va aussi quand le N+1
        n'a pas visé cinq jours ouvrés après le dépôt. Un N+1 absent (une
        mission le laisse joignable) garde la main s'il rentre au plus tard
        la veille du congé demandé ; sinon la DCH traite le temps de son
        absence, et la demande lui revient s'il rentre avant qu'elle ait
        visé. Déposée avant son premier jour, une demande toujours en
        attente ce jour-là expire ;
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
  /** Le N+1 n'a pas visé dans le délai : la demande est passée à la DCH. */
  n1SansReponse: boolean;
  /**
   * La DCH traite le temps de l'absence du N+1 : la demande ne lui est pas
   * acquise, elle revient au N+1 s'il rentre avant qu'elle ait visé.
   */
  n1Absent: boolean;
}

interface DemandeCircuit {
  id: string;
  employeeId: string;
  status: string;
  currentLevel: number;
  confieeAEmployeeId: string | null;
  /** Le moment du dépôt : le délai du N+1 court depuis. */
  deposeeLe: Date | string;
  /** Le premier jour demandé (ISO) : le N+1 absent doit être rentré la veille. */
  debut: string | null;
}

/**
 * Le N+1, absent, sera rentré au plus tard la veille du congé : il garde la
 * main. Sans date de congé connue, son absence suffit à passer la main.
 */
function rentreAvantLeConge(n1: Viseur, demande: DemandeCircuit): boolean {
  if (!n1.absentJusquAu || !demande.debut) return false;
  const [a, m, j] = demande.debut.split('-').map(Number) as [number, number, number];
  const avantVeille = new Date(Date.UTC(a, m - 1, j - 2)).toISOString().slice(0, 10);
  return n1.absentJusquAu <= avantVeille;
}

/**
 * Le N+1 a laissé passer son délai : cinq jours ouvrés entiers depuis le
 * dépôt, sans le compter, jusqu'à la veille (cf. joursOuvresEcoules).
 */
async function delaiDuN1Passe(tx: Tx, demande: DemandeCircuit): Promise<boolean> {
  const { rows } = await tx.execute<{ jours: number }>(sql`
    SELECT count(*)::int AS jours
      FROM generate_series((${demande.deposeeLe}::timestamptz)::date + 1, CURRENT_DATE - 1,
                           interval '1 day') AS g(d)
     WHERE extract(isodow FROM g.d) < 6
       AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.day = g.d::date)`);
  return (rows[0]?.jours ?? 0) >= DELAI_N1_JOURS_OUVRES;
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
    n1SansReponse: false,
    n1Absent: false,
  });
  let n1SansReponse = false;
  let n1Absent = false;
  if (demande.currentLevel <= NIVEAU_N1) {
    const n1 = await n1De(tx, demande.employeeId);
    if (n1 && (!n1.absent || rentreAvantLeConge(n1, demande))) {
      if (!(await delaiDuN1Passe(tx, demande))) return leN1(n1);
      n1SansReponse = true;
    } else if (n1) {
      n1Absent = true;
    }
    if (demandeDuDirecteur) {
      // Le directeur du Capital Humain : son N+1 (le DG) vise seul. Absent,
      // ou sans réponse dans le délai, ce sont ses membres habilités qui
      // prennent le relais ; sinon on attend le DG.
      const t = await traitantDCH(tx, demande, dch);
      if (t.valideurs.length > 0) {
        return { etape: 'dch', ...t, demandeDuDirecteur, dch, n1SansReponse, n1Absent };
      }
      return leN1(n1);
    }
  }
  const t = await traitantDCH(tx, demande, dch);
  if (demandeDuDirecteur && t.valideurs.length === 0) {
    // Passée à ses membres, qui ne peuvent plus : elle revient au DG.
    return leN1(await n1De(tx, demande.employeeId));
  }
  return { etape: 'dch', ...t, demandeDuDirecteur, dch, n1SansReponse, n1Absent };
}

/** La demande, lue pour le circuit. */
export async function lireCircuit(tx: Tx, requestId: string): Promise<DemandeCircuit | null> {
  const { rows } = await tx.execute<{
    id: string;
    employee_id: string;
    status: string;
    current_level: number;
    confiee_a_employee_id: string | null;
    created_at: string;
    start_date: string;
  }>(sql`
    SELECT id, employee_id, status, current_level, confiee_a_employee_id, created_at::text,
           start_date::text
      FROM absence_requests WHERE id = ${requestId}`);
  const r = rows[0];
  return r
    ? {
        id: r.id,
        employeeId: r.employee_id,
        status: r.status,
        currentLevel: r.current_level,
        confieeAEmployeeId: r.confiee_a_employee_id,
        deposeeLe: r.created_at,
        debut: r.start_date,
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
  /** À l'heure : de telle heure à telle heure, ce jour-là (null : journées entières). */
  heures: Heures | null;
  jours: number;
  demandeurUserId: string | null;
  /** Le motif ne regarde que l'agent et la DCH (cf. migration 0076). */
  confidentiel: boolean;
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
    heure_debut: string | null;
    heure_fin: string | null;
    jours: string;
    user_id: string | null;
    confidentiel: boolean;
  }>(sql`
    SELECT r.id, r.tenant_id, r.employee_id, p.given_name || ' ' || p.family_name AS nom,
           ty.name AS type, r.start_date::text AS debut, r.end_date::text AS fin,
           to_char(r.start_time, 'HH24:MI') AS heure_debut,
           to_char(r.end_time, 'HH24:MI') AS heure_fin,
           r.days_count::text AS jours, p.user_id, ty.motif_confidentiel AS confidentiel
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
        heures: r.heure_debut && r.heure_fin ? { debut: r.heure_debut, fin: r.heure_fin } : null,
        jours: Number(r.jours),
        demandeurUserId: r.user_id,
        confidentiel: r.confidentiel,
      }
    : null;
}

/**
 * Ce que le message dit du motif. L'agent et la DCH lisent « congé
 * maladie » ; le N+1, d'un motif confidentiel, « absence ».
 */
function motif(d: Demande, pour: 'agent' | 'n1' | 'dch'): Nom {
  return pour === 'n1' && d.confidentiel ? ABSENCE : absence(d.type);
}

/** « Moussa Ndiaye demande un congé annuel du 10 au 12 mai 2027 ». */
function demandeDe(d: Demande, a: Nom): string {
  return `${d.nom} demande ${a.article} ${a.nom} ${duAu(d.debut, d.fin, d.heures)}`;
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
    sujet: 'conges',
    title: `Votre ${a.nom} ${duAu(d.debut, d.fin, d.heures)} est ${accord(verdict === 'approved' ? 'approuvé' : 'refusé', a)}`,
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
  // Arrivée à la DCH (visée par le N+1, sans N+1 qui puisse viser, ou
  // sans réponse dans le délai), elle y reste. Passée le temps d'une
  // absence du N+1, elle ne lui est pas retirée : il la retrouve en rentrant.
  if (att?.etape === 'dch' && demande.currentLevel < NIVEAU_DCH && !att.n1Absent) {
    await tx.execute(sql`
      UPDATE absence_requests
         SET current_level = ${NIVEAU_DCH}, n1_sans_reponse = ${att.n1SansReponse}
       WHERE id = ${requestId}`);
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
      sujet: 'equipe.conges',
      title: demandeDe(d, motif(d, 'n1')),
      link: '/moi/equipe',
    });
    return;
  }
  await tenirLesAppels(tx, d.tenantId, prefixe, 'dch', destinataires, {
    type: 'conge_a_viser',
    sujet: 'dch.conges',
    title: demandeDe(d, motif(d, 'dch')),
    link: '/moi/dch',
  });
}

// ──────────────────────────────────────────── un congé validé qui change

/**
 * Qui confirme le retour anticipé d'un agent : son N+1, présent ; sinon qui
 * traite les congés pour la DCH. Le N+1 est le mieux placé pour dire que
 * l'agent est bien revenu, puisque les jours lui sont rendus.
 */
export async function attenduPourLaReprise(
  tx: Tx,
  demande: { id: string; employeeId: string },
): Promise<Attendu> {
  const dch = await directionDuPersonnel(tx);
  const demandeDuDirecteur = Boolean(dch?.directeurEmployeeId === demande.employeeId);
  const n1 = await n1De(tx, demande.employeeId);
  if (n1 && !n1.absent) {
    return {
      etape: 'n1',
      valideurs: [n1],
      parDelegationDe: null,
      demandeDuDirecteur,
      dch,
      n1SansReponse: false,
      n1Absent: false,
    };
  }
  const t = await traitantDCH(
    tx,
    {
      id: demande.id,
      employeeId: demande.employeeId,
      status: 'pending',
      currentLevel: NIVEAU_DCH,
      confieeAEmployeeId: null,
      deposeeLe: new Date(),
      debut: null,
    },
    dch,
  );
  return { etape: 'dch', ...t, demandeDuDirecteur, dch, n1SansReponse: false, n1Absent: false };
}

/** Le préfixe des appels à confirmer un retour : à part de ceux du visa. */
const prefixeReprise = (requestId: string) => `reprise:${requestId}`;

/**
 * Tient les appels à confirmer le retour d'un agent : tant qu'il attend,
 * qui doit le confirmer a le sien ; confirmé, refusé ou retiré, il s'en va.
 */
export async function reconcilierReprise(tx: Tx, requestId: string): Promise<void> {
  const { rows } = await tx.execute<{ reprise: string | null; status: string }>(sql`
    SELECT reprise_demandee::text AS reprise, status FROM absence_requests WHERE id = ${requestId}`);
  const r = rows[0];
  const d = r?.reprise && r.status === 'approved' ? await lireDemande(tx, requestId) : null;
  if (!r?.reprise || !d) {
    await retirerLesAppels(tx, prefixeReprise(requestId));
    return;
  }
  const att = await attenduPourLaReprise(tx, d);
  const a = motif(d, att.etape);
  await tenirLesAppels(
    tx,
    d.tenantId,
    prefixeReprise(requestId),
    att.etape,
    att.valideurs.map((v) => v.userId),
    {
      type: 'reprise_a_confirmer',
      sujet: att.etape === 'n1' ? 'equipe.conges' : 'dch.conges',
      title: `${d.nom} écourte ${sonSa(a)} ${a.nom} : reprise le ${frDate(r.reprise)}`,
      link: att.etape === 'n1' ? '/moi/equipe' : '/moi/dch',
    },
  );
}

/** Les congés validés dont l'agent attend qu'on confirme son retour. */
export async function reprisesEnAttente(tx: Tx, employeeId?: string): Promise<string[]> {
  const { rows } = await tx.execute<{ id: string }>(sql`
    SELECT id FROM absence_requests
     WHERE status = 'approved' AND reprise_demandee IS NOT NULL
       ${employeeId ? sql`AND employee_id = ${employeeId}` : sql``}
     ORDER BY created_at`);
  return rows.map((r) => r.id);
}

/** Ce qui arrive à un congé validé : chacun l'apprend à sa façon. */
export type Changement =
  | { quoi: 'annule'; parLAgent: boolean }
  | { quoi: 'ecourte'; reprise: string; nature: 'retour' | 'rappel' }
  | { quoi: 'reprise_refusee'; reprise: string };

/**
 * Un congé validé change : l'agent, son N+1 et la DCH l'avaient vu validé,
 * chacun apprend ce qu'il devient. Qui a fait le geste n'est pas prévenu de
 * son propre geste. Pour la DCH, ce sont ceux qui traitent les congés : les
 * membres habilités, sinon le directeur.
 */
export async function annoncerLeChangement(
  tx: Tx,
  d: Demande,
  changement: Changement,
  auteurUserId: string,
): Promise<void> {
  const a = absence(d.type);
  const cle = (suite: string) => `conge:${d.id}:${suite}`;
  const envoyer = async (
    userId: string | null | undefined,
    message: Omit<NotificationDraft, 'sujet'>,
    sujet: SujetNotification,
  ) => {
    if (!userId || userId === auteurUserId) return;
    await notifier(tx, d.tenantId, userId, { ...message, sujet });
  };

  if (changement.quoi === 'reprise_refusee') {
    await envoyer(
      d.demandeurUserId,
      {
        type: 'conge_refuse',
        title: `Votre reprise le ${frDate(changement.reprise)} n’est pas confirmée`,
        link: '/moi/conges/historique',
        dedupeKey: cle(`reprise-refusee:${changement.reprise}`),
      },
      'conges',
    );
    return;
  }

  const n1 = await n1De(tx, d.employeeId);
  const dch = await traitementDe(tx, 'demandes.conges', {
    employeeId: d.employeeId,
    confieeA: null,
  });
  // Le N+1 et la DCH lisent la même phrase, chacun avec le motif qu'il voit.
  const aux = async (title: (a: Nom) => string, dedupeKey: string) => {
    await envoyer(
      n1?.userId,
      { type: 'conge_modifie', title: title(motif(d, 'n1')), link: '/moi/equipe', dedupeKey },
      'equipe.conges',
    );
    for (const v of dch.traitants) {
      if (v.userId === n1?.userId) continue;
      await envoyer(
        v.userId,
        { type: 'conge_modifie', title: title(motif(d, 'dch')), link: '/moi/dch', dedupeKey },
        'dch.conges',
      );
    }
  };
  const leConge = (a: Nom) => `${leLa(a)}${a.nom} ${de(d.nom)} ${duAu(d.debut, d.fin, d.heures)}`;

  if (changement.quoi === 'annule') {
    // L'avis « approuvé » ne dit plus vrai : il quitte la boîte de l'agent.
    if (changement.parLAgent && d.demandeurUserId) {
      await tx.execute(sql`
        UPDATE notifications SET remplacee_le = now()
         WHERE dedupe_key = ${cle('verdict')} AND recipient_user_id = ${d.demandeurUserId}
           AND remplacee_le IS NULL`);
    }
    await envoyer(
      d.demandeurUserId,
      {
        type: 'conge_refuse',
        title: `Votre ${a.nom} ${duAu(d.debut, d.fin, d.heures)} est ${accord('annulé', a)}`,
        link: '/moi/conges/historique',
        dedupeKey: cle('annule'),
        remplace: cle('verdict'),
      },
      'conges',
    );
    await aux((a) => `${leConge(a)} est ${accord('annulé', a)}`, cle('annule'));
    return;
  }

  const reprise = frDate(changement.reprise);
  await envoyer(
    d.demandeurUserId,
    {
      type: 'conge_modifie',
      title:
        changement.nature === 'retour'
          ? `Votre reprise le ${reprise} est confirmée`
          : `Votre ${a.nom} est ${accord('écourté', a)} : reprise le ${reprise}`,
      link: '/moi/conges/historique',
      dedupeKey: cle(`ecourte:${changement.reprise}`),
    },
    'conges',
  );
  await aux(
    (a) => `${leConge(a)} est ${accord('écourté', a)} : reprise le ${reprise}`,
    cle(`ecourte:${changement.reprise}`),
  );
}

// ──────────────────────────────────────────── l'échéance

/**
 * Une demande expirée : déposée avant son premier jour, ce jour est arrivé
 * sans qu'elle soit décidée. Une demande déposée le jour même ou après coup
 * (une régularisation, un arrêt maladie) n'expire pas. En SQL, sur `r`.
 */
const EXPIREE = sql`r.status = 'pending' AND r.start_date <= CURRENT_DATE
                    AND r.created_at::date < r.start_date`;

/** Cette demande a-t-elle passé son échéance (même si rien ne l'a encore notée) ? */
export async function aExpire(tx: Tx, requestId: string): Promise<boolean> {
  const { rows } = await tx.execute(
    sql`SELECT 1 FROM absence_requests r WHERE r.id = ${requestId} AND ${EXPIREE}`,
  );
  return rows.length > 0;
}

/**
 * Les demandes arrivées à leur premier jour sans réponse expirent : le
 * solde n'en retient plus rien, les appels s'en vont. L'agent, son N+1 et
 * qui traite pour la DCH l'apprennent ; l'agent peut en déposer une autre.
 */
export async function expirerLesDemandes(tx: Tx): Promise<void> {
  await parLeSysteme(tx, () => expirer(tx));
}

async function expirer(tx: Tx): Promise<void> {
  const { rows } = await tx.execute<{ id: string }>(sql`
    SELECT r.id FROM absence_requests r WHERE ${EXPIREE} ORDER BY r.created_at FOR UPDATE`);
  for (const { id } of rows) {
    const d = await lireDemande(tx, id);
    const demande = await lireCircuit(tx, id);
    if (!d || !demande) continue;
    const n1 = await n1De(tx, d.employeeId);
    const t = await traitantDCH(tx, demande, await directionDuPersonnel(tx));
    // Elle expire là où elle attendait : à la DCH, le temps d'une absence
    // du N+1 aussi.
    const aLaDCH = (await attendu(tx, demande))?.etape === 'dch';
    await tx.execute(sql`
      UPDATE absence_requests
         SET status = 'expired', decided_at = now(),
             current_level = ${aLaDCH ? sql`GREATEST(current_level, ${NIVEAU_DCH})` : sql`current_level`}
       WHERE id = ${id}`);
    await retirerLesAppels(tx, `conge:${id}`);

    const a = absence(d.type);
    const periode = duAu(d.debut, d.fin, d.heures);
    const cle = `conge:${id}:expiree`;
    if (d.demandeurUserId) {
      await notifier(tx, d.tenantId, d.demandeurUserId, {
        type: 'conge_expire',
        sujet: 'conges',
        title: `Votre demande ${de(a.nom)} ${periode} a expiré sans réponse`,
        link: '/moi/conges/historique',
        dedupeKey: cle,
      });
    }
    const titre = (m: Nom) =>
      `La demande ${de(m.nom)} ${de(d.nom)} ${periode} a expiré sans réponse`;
    const prevenus = new Set<string>(d.demandeurUserId ? [d.demandeurUserId] : []);
    const prevenir = async (userId: string, pour: 'n1' | 'dch') => {
      if (prevenus.has(userId)) return;
      prevenus.add(userId);
      await notifier(tx, d.tenantId, userId, {
        type: 'conge_expire',
        sujet: pour === 'n1' ? 'equipe.conges' : 'dch.conges',
        title: titre(motif(d, pour)),
        link: pour === 'n1' ? '/moi/equipe' : '/moi/dch',
        dedupeKey: cle,
      });
    };
    if (n1) await prevenir(n1.userId, 'n1');
    for (const v of t.valideurs) await prevenir(v.userId, 'dch');
  }
}

/** Les demandes en attente — le circuit tient sur elles. */
async function demandesEnAttente(tx: Tx, employeeId?: string): Promise<string[]> {
  const { rows } = await tx.execute<{ id: string }>(sql`
    SELECT id FROM absence_requests
     WHERE status = 'pending' ${employeeId ? sql`AND employee_id = ${employeeId}` : sql``}
     ORDER BY created_at`);
  return rows.map((r) => r.id);
}

/** Le N+1 d'un agent vient de changer : ses demandes le suivent, son auto-évaluation aussi. */
export async function faireSuivreLesDemandes(tx: Tx, employeeId: string): Promise<void> {
  for (const id of await demandesEnAttente(tx, employeeId)) await reconcilierDemande(tx, id);
  for (const id of await reprisesEnAttente(tx, employeeId)) await reconcilierReprise(tx, id);
  await reconcilierLesEvaluations(tx, employeeId);
}

/**
 * L'organisation a bougé (organigramme, mutation, départ, délégation) : tout
 * le circuit se relit. Les demandes vont à qui les attend désormais ; le
 * directeur apprend que son délégué est parti ; l'administrateur, que plus
 * personne ne traite pour la DCH.
 */
export async function reconcilierLeCircuit(tx: Tx, tenantId: string): Promise<void> {
  await expirerLesDemandes(tx);
  await verifierLesHabilitations(tx, tenantId);
  await libererLesConfiees(tx);
  const enAttente = await demandesEnAttente(tx);
  for (const id of enAttente) await reconcilierDemande(tx, id);
  for (const id of await reprisesEnAttente(tx)) await reconcilierReprise(tx, id);
  await reconcilierLesEvaluations(tx);
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
  for (const userId of await administrateursEnFonction(tx, tenantId)) {
    await notifier(tx, tenantId, userId, {
      type: 'dch_vacante',
      sujet: 'admin.dch',
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

/**
 * Ce qui attend un agent, demande par demande, comme le circuit le dit : à
 * viser comme N+1, à traiter pour la DCH (retours anticipés compris). Un N+1
 * en congé, un membre parti ne comptent pas ; le directeur du Capital Humain
 * compte aussi ce qu'il a délégué, il peut le traiter. Le menu et le tableau
 * de bord comptent ainsi la file que l'écran « Congés à traiter » montre.
 */
export async function compterLesVisas(
  tx: Tx,
  moi: string,
): Promise<{ aViser: number; conges: number }> {
  let aViser = 0;
  let conges = 0;
  const compter = (att: Attendu | null) => {
    if (!att) return;
    if (att.valideurs.some((v) => v.employeeId === moi)) {
      if (att.etape === 'n1') aViser += 1;
      else conges += 1;
    } else if (
      att.etape === 'dch' &&
      !att.demandeDuDirecteur &&
      att.dch?.directeurEmployeeId === moi
    ) {
      conges += 1;
    }
  };
  for (const id of await demandesEnAttente(tx)) {
    const demande = await lireCircuit(tx, id);
    compter(demande ? await attendu(tx, demande) : null);
  }
  for (const id of await reprisesEnAttente(tx)) {
    const demande = await lireCircuit(tx, id);
    if (demande) compter(await attenduPourLaReprise(tx, demande));
  }
  return { aViser, conges };
}

/** Les demandes qui attendent la DCH, pour toute l'agence. */
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
    deposeeLe: new Date(),
    debut: null,
  };
  const n1 = await n1De(tx, employeeId);
  const dch = await directionDuPersonnel(tx);
  const t = await traitantDCH(tx, fictive, dch);
  // Les dates ne sont pas encore choisies : le N+1, même absent ce jour,
  // vise s'il rentre avant le congé.
  return {
    n1: n1 ? n1.nom : null,
    dch: nomsDe(t.valideurs),
    demandeDuDirecteur: Boolean(dch?.directeurEmployeeId === employeeId),
  };
}
