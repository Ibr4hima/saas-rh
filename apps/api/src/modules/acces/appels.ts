import { sql } from 'drizzle-orm';
import type { Tx } from '../../db/tenant-db';
import { notifier, type NotificationDraft } from '../notifications/notifier';
import { DELAI_RELANCE_JOURS_OUVRES, joursOuvresEcoules } from '../time/workdays';

/* ————————————————————————————————————————————————————————————————
   Les appels à traiter, et leurs relances — pour toutes les demandes.

   Un APPEL est la notification « à vous de traiter » : une par demande, par
   étape, par personne attendue. Il n'existe que tant que la personne est
   attendue — la demande passe à quelqu'un d'autre, l'appel s'en va. Sa clé
   dit à quoi il se rapporte : `conge:<id>:appel:dch`, `document:<id>:appel:dch`…

   Une RELANCE part quand l'appel attend depuis plus de deux jours ouvrés —
   une fois. Elle suit l'appel : un changement de traitant repart à zéro.
   ———————————————————————————————————————————————————————————————— */

/** « 9 septembre 2026 » — jamais d'ISO brut dans un texte lu par un humain. */
export function frDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

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
  const cle = etape ? `${prefixe}:appel:${etape}` : null;
  const cleRappel = cle ? cle.replace(':appel:', ':rappel:') : null;
  const qui = `{${destinataires.join(',')}}`;
  await tx.execute(sql`
    DELETE FROM notifications
     WHERE (dedupe_key LIKE ${`${prefixe}:appel:%`} OR dedupe_key LIKE ${`${prefixe}:rappel:%`})
       AND (${cle}::text IS NULL
            OR dedupe_key NOT IN (${cle}, ${cleRappel})
            OR NOT (recipient_user_id = ANY (${qui}::uuid[])))`);
  if (!cle) return;
  for (const userId of destinataires) {
    await notifier(tx, tenantId, userId, { ...message, dedupeKey: cle });
  }
}

/** La demande n'attend plus personne : ses appels et leurs relances s'en vont. */
export async function retirerLesAppels(tx: Tx, prefixe: string): Promise<void> {
  await tx.execute(sql`
    DELETE FROM notifications
     WHERE dedupe_key LIKE ${`${prefixe}:appel:%`} OR dedupe_key LIKE ${`${prefixe}:rappel:%`}`);
}

/**
 * Qui est attendu depuis plus de deux jours ouvrés reçoit un rappel — une
 * fois par appel. L'appel porte la date où la personne a été appelée.
 */
export async function relancer(tx: Tx, tenantId: string): Promise<void> {
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
  const { rows: jours } = await tx.execute<{ jour: string | null; aujourdhui: string }>(sql`
    SELECT day::text AS jour, CURRENT_DATE::text AS aujourdhui
      FROM holidays WHERE day IS NOT NULL
    UNION ALL SELECT NULL, CURRENT_DATE::text`);
  const aujourdhui = jours[0]!.aujourdhui;
  const feries = new Set(jours.map((j) => j.jour).filter((j): j is string => Boolean(j)));
  for (const a of appels) {
    if (joursOuvresEcoules(a.le, aujourdhui, feries) < DELAI_RELANCE_JOURS_OUVRES) continue;
    await notifier(tx, tenantId, a.recipient_user_id, {
      type: 'rappel',
      title: `${a.title} (rappel)`,
      body: `En attente de vous depuis le ${frDate(a.le)}.${a.body ? ` ${a.body}` : ''}`,
      link: a.link ?? undefined,
      dedupeKey: a.dedupe_key.replace(':appel:', ':rappel:'),
    });
  }
}
