import { sql, type SQL } from 'drizzle-orm';
import type { EtapeConge } from '@teranga/contracts';
import type { Tx } from '../../db/tenant-db';
import { notifier, notifierLaRH } from '../notifications/notifications.service';
import { DG } from '../people/chaine';

/* ————————————————————————————————————————————————————————————————
   Le circuit d'une demande d'absence : le n+1, puis la RH.

   Qui vise, dans quel ordre, et qui est prévenu — écrit une fois, ici. Le
   service des congés s'en sert pour poser, viser, annuler ; la fiche agent
   et l'organigramme pour faire suivre les demandes quand le n+1 change.

   Le n+1 n'est pas COPIÉ sur la demande : c'est celui de l'agent au moment
   où l'on vise. Une mutation, une reprise d'équipe, une cascade font donc
   passer la demande au nouveau n+1 sans rien réécrire — et on le prévient.
   ———————————————————————————————————————————————————————————————— */

export const NIVEAU_N1 = 0;
export const NIVEAU_RH = 1;
export const ROLES_RH = ['admin', 'hr'];

export const etapeDuNiveau = (niveau: number): EtapeConge => (niveau <= NIVEAU_N1 ? 'n1' : 'rh');

/** Le n+1 qui peut viser : actif, avec un compte ouvert dans l'organisation. */
export interface ValideurN1 {
  employeeId: string;
  userId: string;
  nom: string;
  /** Son rôle dans l'organisation : un n+1 RH vise les deux étapes. */
  role: string;
}

/**
 * Le n+1 de cet agent PEUT-IL viser ? En sous-requête SQL, pour les
 * compteurs. Il faut un n+1 actif — pas le DG lui-même, qui n'en a pas —,
 * rattaché à un compte actif de l'organisation : un n+1 sans accès au
 * portail ne verrait jamais la demande, qui resterait en attente pour
 * rien.
 */
export const aUnN1QuiPeutViser = (employeeId: SQL) => sql`EXISTS (
  SELECT 1
    FROM employees ag
    JOIN employees n1 ON n1.id = ag.manager_employee_id AND n1.status = 'active' AND n1.id <> ag.id
    JOIN persons pn ON pn.id = n1.person_id AND pn.user_id IS NOT NULL AND pn.deleted_at IS NULL
    JOIN users un ON un.id = pn.user_id AND un.status = 'active'
    JOIN user_tenant_memberships mn ON mn.user_id = un.id AND mn.tenant_id = ag.tenant_id
   WHERE ag.id = ${employeeId} AND ag.id IS DISTINCT FROM ${DG})`;

/** Le même n+1, en clair — ou null quand personne ne peut viser à ce titre. */
export async function n1QuiPeutViser(tx: Tx, employeeId: string): Promise<ValideurN1 | null> {
  const { rows } = await tx.execute<{
    employee_id: string;
    user_id: string;
    nom: string;
    role: string;
  }>(sql`
    SELECT n1.id AS employee_id, un.id AS user_id,
           pn.given_name || ' ' || pn.family_name AS nom, mn.role
      FROM employees ag
      JOIN employees n1 ON n1.id = ag.manager_employee_id AND n1.status = 'active' AND n1.id <> ag.id
      JOIN persons pn ON pn.id = n1.person_id AND pn.user_id IS NOT NULL AND pn.deleted_at IS NULL
      JOIN users un ON un.id = pn.user_id AND un.status = 'active'
      JOIN user_tenant_memberships mn ON mn.user_id = un.id AND mn.tenant_id = ag.tenant_id
     WHERE ag.id = ${employeeId} AND ag.id IS DISTINCT FROM ${DG}
     LIMIT 1`);
  const r = rows[0];
  return r ? { employeeId: r.employee_id, userId: r.user_id, nom: r.nom, role: r.role } : null;
}

/**
 * L'étape qui compte AUJOURD'HUI. Une demande posée à l'étape du n+1 passe
 * à la RH si, entre-temps, il n'y a plus de n+1 qui puisse viser — un
 * départ, un compte fermé : elle n'attend pas indéfiniment quelqu'un qui ne
 * viendra pas.
 */
export function niveauEffectif(niveauEnregistre: number, n1: ValideurN1 | null): number {
  return niveauEnregistre === NIVEAU_N1 && !n1 ? NIVEAU_RH : niveauEnregistre;
}

/** Les clés des appels à viser : une par étape, pour les retirer une fois l'étape passée. */
export const cleAppel = (requestId: string, etape: EtapeConge) => `conge:${requestId}:${etape}`;
const cleVerdict = (requestId: string) => `conge:${requestId}:verdict`;

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

/** Le n+1 est prévenu : une demande de son équipe attend son visa. */
export async function appelerLeN1(tx: Tx, d: Demande, n1: ValideurN1): Promise<void> {
  await notifier(tx, d.tenantId, n1.userId, {
    type: 'conge_a_viser',
    title: `Congé à valider : ${d.nom}`,
    body: `${periode(d)}. Vous êtes son n+1 : la RH la reçoit après votre visa.`,
    link: '/moi/equipe',
    dedupeKey: cleAppel(d.id, 'n1'),
  });
}

/** La RH est prévenue : la demande attend son visa. */
export async function appelerLaRH(tx: Tx, d: Demande, viseeParN1: string | null): Promise<void> {
  await notifierLaRH(
    tx,
    d.tenantId,
    {
      type: 'conge_a_viser',
      title: `Congé à valider : ${d.nom}`,
      body: viseeParN1
        ? `${periode(d)}. Visée par ${viseeParN1}, son n+1.`
        : `${periode(d)}. Sans n+1 qui puisse viser : elle vient directement à la RH.`,
      link: '/absences',
      dedupeKey: cleAppel(d.id, 'rh'),
    },
    // Personne n'est appelé à viser sa propre demande.
    [d.demandeurUserId],
  );
}

/** Le demandeur apprend le verdict. */
export async function annoncerLeVerdict(
  tx: Tx,
  d: Demande,
  verdict: 'approved' | 'rejected',
  par: { nom: string; etape: EtapeConge },
  commentaire?: string | null,
): Promise<void> {
  if (!d.demandeurUserId) return;
  const qui = par.etape === 'n1' ? `${par.nom}, votre n+1` : `${par.nom} (RH)`;
  await notifier(tx, d.tenantId, d.demandeurUserId, {
    type: verdict === 'approved' ? 'conge_approuve' : 'conge_refuse',
    title: verdict === 'approved' ? 'Congé approuvé' : 'Congé refusé',
    body: `${periode(d)}. ${verdict === 'approved' ? 'Approuvée' : 'Refusée'} par ${qui}.${
      commentaire ? ` « ${commentaire} »` : ''
    }`,
    link: '/moi/conges',
    dedupeKey: cleVerdict(d.id),
  });
}

/**
 * Retire les appels à viser d'une demande : l'étape est passée, ou la
 * demande n'attend plus rien. Un appel resté dans une boîte mènerait à une
 * demande qu'on ne peut plus viser.
 */
export async function retirerLesAppels(
  tx: Tx,
  requestId: string,
  etapes: EtapeConge[] = ['n1', 'rh'],
): Promise<void> {
  const cles = etapes.map((e) => cleAppel(requestId, e));
  await tx.execute(
    sql`DELETE FROM notifications WHERE dedupe_key IN (${sql.join(
      cles.map((c) => sql`${c}`),
      sql`, `,
    )})`,
  );
}

/**
 * Le n+1 d'un agent vient de changer : ses demandes qui attendaient le visa
 * du n+1 passent au nouveau, qui est prévenu — ou à la RH, s'il n'y a plus
 * personne qui puisse viser à ce titre.
 */
export async function faireSuivreLesDemandes(tx: Tx, employeeId: string): Promise<void> {
  const { rows } = await tx.execute<{ id: string }>(sql`
    SELECT id FROM absence_requests
     WHERE employee_id = ${employeeId} AND status = 'pending' AND current_level = ${NIVEAU_N1}
     ORDER BY created_at`);
  if (rows.length === 0) return;
  const n1 = await n1QuiPeutViser(tx, employeeId);
  for (const { id } of rows) {
    const d = await lireDemande(tx, id);
    if (!d) continue;
    await retirerLesAppels(tx, id, ['n1']);
    if (n1) {
      await appelerLeN1(tx, d, n1);
    } else {
      await tx.execute(
        sql`UPDATE absence_requests SET current_level = ${NIVEAU_RH} WHERE id = ${id}`,
      );
      await appelerLaRH(tx, d, null);
    }
  }
}
