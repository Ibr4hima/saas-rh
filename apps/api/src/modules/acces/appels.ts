import { sql } from 'drizzle-orm';
import { sujetSchema, type SujetNotification } from '@teranga/contracts';
import type { Tx } from '../../db/tenant-db';
import { notifier, type NotificationDraft } from '../notifications/notifier';
import { pourLesBackups, rappel } from '../notifications/phrases';
import { DELAI_RELANCE_JOURS_OUVRES, joursOuvresEcoules } from '../time/workdays';
import type { FenetreDuPrincipal, Viseur } from './dch';

/* ————————————————————————————————————————————————————————————————
   Les appels à traiter, et leurs relances — pour toutes les demandes.

   Un APPEL est la notification « à vous de traiter » : une par demande, par
   étape, par personne attendue. Il n'existe que tant que la personne est
   attendue — la demande passe à quelqu'un d'autre, l'appel s'en va. Sa clé
   dit à quoi il se rapporte : `conge:<id>:appel:dch`, `document:<id>:appel:dch`…

   Une RELANCE part quand l'appel attend depuis plus de deux jours ouvrés,
   une fois. Elle suit l'appel : un changement de traitant repart à zéro.
   Le N+1 attendu sur un congé, lui, est rappelé tous les deux jours
   ouvrés, jusqu'à ce que la demande passe à la DCH. La personne principale
   d'une délégation l'est quinze heures ouvrées avant la fin de la fenêtre
   de 48 heures (ADR-0128).
   ———————————————————————————————————————————————————————————————— */

export { frDate } from '../notifications/phrases';

/**
 * Tient les appels d'une demande d'accord avec qui l'attend : chacun des
 * `destinataires` a le sien, à cette étape ; tout autre appel de la demande
 * (et sa relance) s'en va. Sans étape, la demande n'attend plus personne.
 * Idempotente : la rejouer ne prévient personne deux fois.
 */
export async function tenirLesAppels(
  tx: Tx,
  tenantId: string,
  prefixe: string,
  etape: string | null,
  destinataires: readonly string[],
  message: Omit<NotificationDraft, 'dedupeKey'>,
): Promise<void> {
  await tenirDesAppels(tx, tenantId, prefixe, etape ? [{ etape, destinataires, message }] : []);
}

/** Des appels à une étape : qui les reçoit, et ce qu'ils disent. */
export interface GroupeDAppels {
  etape: string;
  destinataires: readonly string[];
  message: Omit<NotificationDraft, 'dedupeKey'>;
}

/**
 * Comme `tenirLesAppels`, groupe par groupe : deux étapes à la fois (l'appel
 * à la personne principale, l'avis aux backups), ou deux messages à la même
 * étape.
 * Sans groupe, la demande n'attend plus personne.
 */
export async function tenirDesAppels(
  tx: Tx,
  tenantId: string,
  prefixe: string,
  groupes: readonly GroupeDAppels[],
): Promise<void> {
  // Restent les appels attendus, et leurs relances ; tout autre s'en va.
  const attendus = groupes.map(({ etape, destinataires }) => {
    const cle = `${prefixe}:appel:${etape}`;
    return sql`(dedupe_key IN (${cle}, ${`${prefixe}:rappel:${etape}`})
                AND recipient_user_id = ANY (${`{${destinataires.join(',')}}`}::uuid[]))`;
  });
  // `^@` (commence par) plutôt que LIKE : sous la RLS, seul un opérateur
  // « leakproof » descend dans l'index des clés (cf. migration 0107).
  await tx.execute(sql`
    DELETE FROM notifications
     WHERE (dedupe_key ^@ ${`${prefixe}:appel:`} OR dedupe_key ^@ ${`${prefixe}:rappel:`})
       ${attendus.length > 0 ? sql`AND NOT (${sql.join(attendus, sql` OR `)})` : sql``}`);
  for (const { etape, destinataires, message } of groupes) {
    for (const userId of destinataires) {
      await notifier(tx, tenantId, userId, { ...message, dedupeKey: `${prefixe}:appel:${etape}` });
    }
  }
}

/**
 * Les appels de la DCH sur une demande, d'après qui la traite (cf.
 * `traitementDe`). Avec une personne principale et des backups (ADR-0128) :
 * l'appel va à la personne principale ; les backups sont prévenus (étape
 * `backup`) sans pouvoir encore traiter, puis appelés quand la fenêtre
 * s'ouvre, par un message qui le dit. Quinze heures ouvrées avant la fin de
 * la fenêtre, la personne principale reçoit un rappel, une fois.
 */
export async function appelerPourLaDCH(
  tx: Tx,
  tenantId: string,
  prefixe: string,
  t: { traitants: readonly Viseur[]; fenetre: FenetreDuPrincipal | null },
  message: Omit<NotificationDraft, 'dedupeKey'>,
): Promise<void> {
  const f = t.fenetre;
  if (!f) {
    await tenirLesAppels(
      tx,
      tenantId,
      prefixe,
      'dch',
      t.traitants.map((v) => v.userId),
      message,
    );
    return;
  }
  const backups = f.backups.map((v) => v.userId);
  await tenirDesAppels(tx, tenantId, prefixe, [
    { etape: 'dch', destinataires: [f.principal.userId], message },
    f.ouverte
      ? {
          etape: 'dch',
          destinataires: backups,
          message: {
            ...message,
            title: pourLesBackups(message.title, f.confieeParLePrincipal ? f.principal.nom : null),
          },
        }
      : { etape: 'backup', destinataires: backups, message },
  ]);
  if (!f.ouverte && Date.now() >= f.rappelLe.getTime()) {
    await notifier(tx, tenantId, f.principal.userId, {
      ...message,
      type: 'rappel',
      title: rappel(message.title),
      dedupeKey: `${prefixe}:rappel:dch`,
      remplace: `${prefixe}:appel:dch`,
    });
  }
}

/** La demande n'attend plus personne : ses appels et leurs relances s'en vont. */
export async function retirerLesAppels(tx: Tx, prefixe: string): Promise<void> {
  await tx.execute(sql`
    DELETE FROM notifications
     WHERE dedupe_key ^@ ${`${prefixe}:appel:`} OR dedupe_key ^@ ${`${prefixe}:rappel:`}`);
}

/**
 * Le sujet d'un appel, qui le porte depuis 0093 ; un appel plus ancien se
 * reconnaît à sa clé.
 */
function sujetDeLAppel(sujet: string | null, cle: string): SujetNotification {
  if (sujet && sujetSchema.safeParse(sujet).success) return sujet as SujetNotification;
  if (/^(conge|reprise):[^:]+:appel:n1$/.test(cle)) return 'equipe.conges';
  if (/:appel:a-confier$/.test(cle)) return 'dch.delegations';
  if (cle.startsWith('objectifs:')) return 'equipe.objectifs';
  if (cle.startsWith('document:')) return 'dch.documents';
  if (cle.startsWith('information:')) return 'dch.informations';
  if (cle.startsWith('piece:')) return 'dch.pieces';
  return 'dch.conges';
}

/** Les appels dont le rappel revient tous les deux jours ouvrés : le N+1 d'un congé. */
const RAPPEL_REPETE = /^conge:[^:]+:appel:n1$/;

/**
 * Qui est attendu depuis plus de deux jours ouvrés reçoit un rappel, une
 * fois par appel, sauf le N+1 d'un congé, rappelé tous les deux jours
 * ouvrés. L'appel porte la date où la personne a été appelée ; le rappel
 * prend sa place dans la boîte, et le suivant celle du précédent.
 */
export async function relancer(tx: Tx, tenantId: string): Promise<void> {
  const { rows: appels } = await tx.execute<{
    recipient_user_id: string;
    dedupe_key: string;
    le: string;
    rappele_le: string | null;
    title: string;
    link: string | null;
    sujet: string | null;
  }>(sql`
    SELECT a.recipient_user_id, a.dedupe_key, a.sujet, (a.created_at AT TIME ZONE 'UTC')::date::text AS le,
           (SELECT (r.created_at AT TIME ZONE 'UTC')::date::text FROM notifications r
             WHERE r.recipient_user_id = a.recipient_user_id
               AND r.dedupe_key = replace(a.dedupe_key, ':appel:', ':rappel:')) AS rappele_le,
           a.title, a.link
      FROM notifications a
     WHERE a.dedupe_key LIKE '%:appel:%'
       -- Les backups prévenus ne traitent pas encore : rien à rappeler (ADR-0128).
       AND a.dedupe_key NOT LIKE '%:appel:backup'`);
  if (appels.length === 0) return;
  const { rows: jours } = await tx.execute<{ jour: string | null; aujourdhui: string }>(sql`
    SELECT day::text AS jour, CURRENT_DATE::text AS aujourdhui
      FROM holidays WHERE day IS NOT NULL
    UNION ALL SELECT NULL, CURRENT_DATE::text`);
  const aujourdhui = jours[0]!.aujourdhui;
  const feries = new Set(jours.map((j) => j.jour).filter((j): j is string => Boolean(j)));
  for (const a of appels) {
    const cleRappel = a.dedupe_key.replace(':appel:', ':rappel:');
    if (a.rappele_le) {
      // Déjà rappelé : seul le N+1 d'un congé l'est à nouveau, deux jours
      // ouvrés après le précédent rappel, qui laisse sa place au nouveau.
      if (!RAPPEL_REPETE.test(a.dedupe_key)) continue;
      if (joursOuvresEcoules(a.rappele_le, aujourdhui, feries) < DELAI_RELANCE_JOURS_OUVRES) {
        continue;
      }
      await tx.execute(sql`
        DELETE FROM notifications
         WHERE recipient_user_id = ${a.recipient_user_id} AND dedupe_key = ${cleRappel}`);
    } else if (joursOuvresEcoules(a.le, aujourdhui, feries) < DELAI_RELANCE_JOURS_OUVRES) {
      continue;
    }
    await notifier(tx, tenantId, a.recipient_user_id, {
      type: 'rappel',
      // Le rappel suit l'appel : même sujet, mêmes canaux.
      sujet: sujetDeLAppel(a.sujet, a.dedupe_key),
      title: rappel(a.title),
      link: a.link ?? undefined,
      dedupeKey: cleRappel,
      remplace: a.dedupe_key,
    });
  }
}
