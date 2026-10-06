import { and, eq, isNull, like, ne, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import * as t from '../../db/schema';
import type { Tx } from '../../db/tenant-db';
import { doublerParCourriel } from '../courriels/expediteur';

/* L'envoi d'une notification, dans la transaction appelante. À part du
   service : le circuit des congés prévient ses valideurs depuis des
   opérations qui ne passent pas par l'injection, et le service, lui, relit
   ce circuit : deux modules qui s'importeraient l'un l'autre.

   C'est le seul endroit où une notification naît (un test y veille) : chacune
   part aussi par courriel, une fois, à sa création. */

export interface NotificationDraft {
  type: string;
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
  const id = uuidv7();
  const [cree] = await tx
    .insert(t.notifications)
    .values({
      id,
      tenantId,
      recipientUserId: userId,
      type: draft.type,
      title: draft.title,
      body: draft.body ?? null,
      link: draft.link ?? null,
      dedupeKey: draft.dedupeKey ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: t.notifications.id });
  // Déjà envoyée : rien ne change. Nouvelle : elle part aussi par courriel, et
  // chasse les précédentes (dont le courriel, s'il attend encore, ne part plus).
  if (!cree) return;
  await doublerParCourriel(tx, tenantId, [{ id, recipientUserId: userId, title: draft.title }]);
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
  const creees = await tx
    .insert(t.notifications)
    .values(
      envois.map((e) => ({
        id: uuidv7(),
        tenantId,
        recipientUserId: e.userId,
        type: e.type,
        title: e.title,
        body: e.body ?? null,
        link: e.link ?? null,
        dedupeKey: e.dedupeKey ?? null,
      })),
    )
    .onConflictDoNothing()
    .returning({
      id: t.notifications.id,
      recipientUserId: t.notifications.recipientUserId,
      title: t.notifications.title,
    });
  await doublerParCourriel(tx, tenantId, creees);
}
