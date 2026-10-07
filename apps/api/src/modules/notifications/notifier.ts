import { and, eq, isNull, like, ne, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { SujetNotification } from '@teranga/contracts';
import * as t from '../../db/schema';
import type { Tx } from '../../db/tenant-db';
import { doublerParCourriel } from '../courriels/expediteur';
import { doublerParWhatsApp } from '../whatsapp/expediteur';
import { canauxDe, type CanauxDuDestinataire } from './canaux';

/* L'envoi d'une notification, dans la transaction appelante. À part du
   service : le circuit des congés prévient ses valideurs depuis des
   opérations qui ne passent pas par l'injection, et le service, lui, relit
   ce circuit : deux modules qui s'importeraient l'un l'autre.

   C'est le seul endroit où une notification naît (un test y veille). Elle
   suit les réglages de son destinataire pour son SUJET : dans la plateforme
   ou non, par courriel ou non, sur WhatsApp ou non (cf. canaux.ts). Elle
   naît même quand il ne la veut nulle part : ses clés (doublon, remplacement,
   appels et rappels) tiennent ainsi comme avant. */

export interface NotificationDraft {
  type: string;
  /** Ce que le destinataire règle : où la notification le trouve. */
  sujet: SujetNotification;
  title: string;
  body?: string;
  link?: string;
  /** Rend la création idempotente : jamais deux fois la même clé par destinataire. */
  dedupeKey?: string;
  /**
   * Le sujet : les notifications de ce destinataire dont la clé commence
   * ainsi sont remplacées par celle-ci, et quittent la boîte. Le rappel
   * d'une échéance chasse le précédent ; la dernière mise à jour d'une fiche,
   * les autres.
   */
  remplace?: string;
}

/**
 * Notifie un utilisateur précis, dans la transaction appelante. Une fonction
 * autant qu'une méthode : le circuit des congés prévient ses valideurs depuis
 * des opérations qui ne passent pas par l'injection (cascades de la chaîne
 * hiérarchique).
 */
export async function notifier(
  tx: Tx,
  tenantId: string,
  userId: string,
  draft: NotificationDraft,
): Promise<void> {
  const canaux = (await canauxDe(tx, [userId], draft.sujet)).get(userId);
  const id = uuidv7();
  const [cree] = await tx
    .insert(t.notifications)
    .values({
      id,
      tenantId,
      recipientUserId: userId,
      type: draft.type,
      sujet: draft.sujet,
      title: draft.title,
      body: draft.body ?? null,
      link: draft.link ?? null,
      dedupeKey: draft.dedupeKey ?? null,
      dansLaPlateforme: canaux?.plateforme ?? true,
    })
    .onConflictDoNothing()
    .returning({ id: t.notifications.id });
  // Déjà envoyée : rien ne change. Nouvelle : elle part par les canaux choisis,
  // et chasse les précédentes (dont le courriel, s'il attend encore, ne part plus).
  if (!cree) return;
  await doubler(tx, tenantId, [{ id, recipientUserId: userId, title: draft.title }], (u) =>
    u === userId ? canaux : undefined,
  );
  if (!draft.remplace) return;
  await tx
    .update(t.notifications)
    .set({ remplaceeLe: sql`now()` })
    .where(
      and(
        eq(t.notifications.tenantId, tenantId),
        eq(t.notifications.recipientUserId, userId),
        like(t.notifications.dedupeKey, `${draft.remplace.replace(/[\\%_]/g, '\\$&')}%`),
        ne(t.notifications.id, id),
        isNull(t.notifications.remplaceeLe),
      ),
    );
}

/** Les doubles d'une notification nouvelle : courriel, WhatsApp, selon chacun. */
async function doubler(
  tx: Tx,
  tenantId: string,
  creees: { id: string; recipientUserId: string; title: string }[],
  canauxDu: (userId: string) => CanauxDuDestinataire | undefined,
): Promise<void> {
  // Sans réglage connu (compte disparu entre-temps), ce qui se faisait : le courriel.
  await doublerParCourriel(
    tx,
    tenantId,
    creees.filter((n) => canauxDu(n.recipientUserId)?.courriel ?? true),
  );
  await doublerParWhatsApp(
    tx,
    tenantId,
    creees.flatMap((n) => {
      const c = canauxDu(n.recipientUserId);
      return c?.whatsapp
        ? [{ notificationId: n.id, userId: n.recipientUserId, heuresCalmes: c.heuresCalmes }]
        : [];
    }),
  );
}

/**
 * Plusieurs notifications d'un coup, sans remplacement (les rappels de
 * fériés) : celles qui existaient déjà ne repartent pas.
 */
export async function notifierChacun(
  tx: Tx,
  tenantId: string,
  envois: ({ userId: string } & Omit<NotificationDraft, 'remplace'>)[],
): Promise<void> {
  if (envois.length === 0) return;
  // Les réglages de chacun, sujet par sujet.
  const canaux = new Map<string, CanauxDuDestinataire>();
  for (const sujet of new Set(envois.map((e) => e.sujet))) {
    const parSujet = await canauxDe(
      tx,
      envois.filter((e) => e.sujet === sujet).map((e) => e.userId),
      sujet,
    );
    for (const [userId, c] of parSujet) canaux.set(`${sujet}:${userId}`, c);
  }
  const creees = await tx
    .insert(t.notifications)
    .values(
      envois.map((e) => ({
        id: uuidv7(),
        tenantId,
        recipientUserId: e.userId,
        type: e.type,
        sujet: e.sujet,
        title: e.title,
        body: e.body ?? null,
        link: e.link ?? null,
        dedupeKey: e.dedupeKey ?? null,
        dansLaPlateforme: canaux.get(`${e.sujet}:${e.userId}`)?.plateforme ?? true,
      })),
    )
    .onConflictDoNothing()
    .returning({
      id: t.notifications.id,
      recipientUserId: t.notifications.recipientUserId,
      title: t.notifications.title,
      sujet: t.notifications.sujet,
    });
  for (const sujet of new Set(creees.map((n) => n.sujet))) {
    await doubler(
      tx,
      tenantId,
      creees.filter((n) => n.sujet === sujet),
      (userId) => canaux.get(`${sujet}:${userId}`),
    );
  }
}
