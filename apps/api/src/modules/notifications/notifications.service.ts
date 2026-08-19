import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { ExpiringContractView, NotificationsPage, SessionUser } from '@teranga/contracts';
import { problem } from '../../common/problem';
import * as t from '../../db/schema';
import { TenantDb, Tx } from '../../db/tenant-db';

const HR_ROLES = ['admin', 'hr'];

export interface NotificationDraft {
  type: string;
  title: string;
  body?: string;
  link?: string;
  /** Rend la création idempotente : jamais deux fois la même clé par destinataire. */
  dedupeKey?: string;
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round(
    (new Date(`${toIso}T00:00:00Z`).getTime() - new Date(`${fromIso}T00:00:00Z`).getTime()) /
      86_400_000,
  );
}

@Injectable()
export class NotificationsService {
  constructor(@Inject(TenantDb) private readonly db: TenantDb) {}

  /** Notifie un utilisateur précis (dans la transaction appelante). */
  async notifyUser(
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
  async notifyHr(
    tx: Tx,
    tenantId: string,
    draft: NotificationDraft,
    excludeUserId?: string,
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
      if (r.userId === excludeUserId) continue;
      await this.notifyUser(tx, tenantId, r.userId, draft);
    }
  }

  /** Boîte de réception : génère d'abord les échéances (idempotent). */
  async list(user: SessionUser): Promise<NotificationsPage> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      // Générées uniquement quand un destinataire consulte : inutile (et
      // coûteux, l'endpoint est pollé) de le faire pour les autres rôles.
      if (HR_ROLES.includes(user.role)) {
        await this.generateContractDeadlines(tx, user.tenantId);
      }

      const items = await tx
        .select()
        .from(t.notifications)
        .where(eq(t.notifications.recipientUserId, user.userId))
        .orderBy(desc(t.notifications.createdAt))
        .limit(30);
      const [unread] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(t.notifications)
        .where(
          and(eq(t.notifications.recipientUserId, user.userId), isNull(t.notifications.readAt)),
        );
      return {
        unreadCount: unread?.n ?? 0,
        items: items.map((i) => ({
          id: i.id,
          type: i.type,
          title: i.title,
          body: i.body,
          link: i.link,
          readAt: i.readAt?.toISOString() ?? null,
          createdAt: i.createdAt.toISOString(),
        })),
      };
    });
  }

  async markRead(user: SessionUser, id: string): Promise<void> {
    await this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      const updated = await tx
        .update(t.notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(t.notifications.id, id),
            eq(t.notifications.recipientUserId, user.userId),
            isNull(t.notifications.readAt),
          ),
        )
        .returning({ id: t.notifications.id });
      if (updated.length === 0) {
        const [exists] = await tx
          .select({ id: t.notifications.id })
          .from(t.notifications)
          .where(and(eq(t.notifications.id, id), eq(t.notifications.recipientUserId, user.userId)))
          .limit(1);
        if (!exists) {
          problem(404, 'notifications.not_found', 'Notification introuvable');
        }
      }
    });
  }

  async markAllRead(user: SessionUser): Promise<void> {
    await this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, (tx) =>
      tx
        .update(t.notifications)
        .set({ readAt: new Date() })
        .where(
          and(eq(t.notifications.recipientUserId, user.userId), isNull(t.notifications.readAt)),
        ),
    );
  }

  /** Contrats à échéance — la carte permanente du tableau de bord RH. */
  async expiringContracts(user: SessionUser): Promise<ExpiringContractView[]> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      const rows = await this.selectExpiring(tx);
      return rows.map((r) => ({
        contractId: r.contractId,
        employeeId: r.employeeId,
        employeeName: `${r.givenName} ${r.familyName}`,
        contractType: r.contractType,
        endDate: r.endDate,
        daysLeft: daysBetween(new Date().toISOString().slice(0, 10), r.endDate),
      }));
    });
  }

  /**
   * Échéances : contrat AVEC date de fin, employé actif, fin dans ≤ 30 jours
   * (≤ 10 jours pour les contrats d'environ un mois) — notification RH
   * idempotente par contrat, visible jusqu'à expiration via le tableau de bord.
   */
  private async generateContractDeadlines(tx: Tx, tenantId: string): Promise<void> {
    const rows = await this.selectExpiring(tx);
    const today = new Date().toISOString().slice(0, 10);
    for (const r of rows) {
      const daysLeft = daysBetween(today, r.endDate);
      await this.notifyHr(tx, tenantId, {
        type: 'contract_deadline',
        title: `Contrat de ${r.givenName} ${r.familyName} : échéance proche`,
        body: `${r.contractType.toUpperCase()} jusqu'au ${r.endDate} — ${daysLeft} jour(s) restant(s).`,
        link: `/employees/${r.employeeId}`,
        dedupeKey: `contract_deadline:${r.contractId}`,
      });
    }
  }

  private async selectExpiring(tx: Tx) {
    // Seuil : 30 j en général, 10 j pour les contrats courts (≤ 45 j de durée).
    return tx
      .select({
        contractId: t.contracts.id,
        employeeId: t.contracts.employeeId,
        contractType: t.contracts.contractType,
        endDate: sql<string>`${t.contracts.endDate}::text`,
        givenName: t.persons.givenName,
        familyName: t.persons.familyName,
      })
      .from(t.contracts)
      .innerJoin(t.employees, eq(t.employees.id, t.contracts.employeeId))
      .innerJoin(t.persons, eq(t.persons.id, t.employees.personId))
      .where(
        and(
          sql`${t.contracts.endDate} IS NOT NULL`,
          gte(t.contracts.endDate, sql`CURRENT_DATE`),
          eq(t.employees.status, 'active'),
          sql`${t.contracts.endDate} - CURRENT_DATE <=
            CASE WHEN ${t.contracts.endDate} - ${t.contracts.startDate} <= 45 THEN 10 ELSE 30 END`,
        ),
      )
      .orderBy(t.contracts.endDate);
  }
}
