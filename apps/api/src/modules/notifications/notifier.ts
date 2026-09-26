import { and, eq, inArray } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import * as t from '../../db/schema';
import type { Tx } from '../../db/tenant-db';

/* L'envoi d'une notification, dans la transaction appelante. À part du
   service : le circuit des congés prévient ses valideurs depuis des
   opérations qui ne passent pas par l'injection, et le service, lui, relit
   ce circuit — deux modules qui s'importeraient l'un l'autre. */

const HR_ROLES = ['admin', 'hr'];

export interface NotificationDraft {
  type: string;
  title: string;
  body?: string;
  link?: string;
  /** Rend la création idempotente : jamais deux fois la même clé par destinataire. */
  dedupeKey?: string;
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
  await tx
    .insert(t.notifications)
    .values({
      id: uuidv7(),
      tenantId,
      recipientUserId: userId,
      type: draft.type,
      title: draft.title,
      body: draft.body ?? null,
      link: draft.link ?? null,
      dedupeKey: draft.dedupeKey ?? null,
    })
    .onConflictDoNothing();
}

/** Notifie toute la RH du tenant (fan-out : une ligne par admin/RH). */
export async function notifierLaRH(
  tx: Tx,
  tenantId: string,
  draft: NotificationDraft,
  exclure: ReadonlyArray<string | null | undefined> = [],
): Promise<void> {
  const recipients = await tx
    .select({ userId: t.userTenantMemberships.userId })
    .from(t.userTenantMemberships)
    .where(
      and(
        eq(t.userTenantMemberships.tenantId, tenantId),
        inArray(t.userTenantMemberships.role, HR_ROLES),
      ),
    );
  for (const r of recipients) {
    if (exclure.includes(r.userId)) continue;
    await notifier(tx, tenantId, r.userId, draft);
  }
}
