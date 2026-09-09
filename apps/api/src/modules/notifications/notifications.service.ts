import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type {
  ExpiringContractView,
  NotificationScope,
  NotificationsPage,
  SessionUser,
} from '@teranga/contracts';
import { problem } from '../../common/problem';
import * as t from '../../db/schema';
import { TenantDb, Tx } from '../../db/tenant-db';
import { holidayReminderDate } from '../time/workdays';

const HR_ROLES = ['admin', 'hr'];

export interface NotificationDraft {
  type: string;
  title: string;
  body?: string;
  link?: string;
  /** Rend la création idempotente : jamais deux fois la même clé par destinataire. */
  dedupeKey?: string;
}

/** « 9 septembre 2026 » — jamais d'ISO brut dans un texte lu par un humain. */
function frDate(iso: string, withWeekday = false): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('fr-FR', {
    ...(withWeekday ? { weekday: 'long' as const } : {}),
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Clé d'idempotence d'un rappel de férié : le JOUR, pas l'identifiant.
 *
 * `holidays` porte UNIQUE (tenant_id, day) : un jour désigne donc un férié et
 * un seul. Cette clé résiste à la façon dont on corrige un férié — l'API n'a
 * pas de mise à jour, donc rectifier un libellé passe par suppression puis
 * recréation, avec un identifiant NEUF. Clé sur l'identifiant, cela produisait
 * un second rappel pour le même jour ; clé sur le jour, la correction reste
 * silencieuse pour ceux déjà prévenus. Le déplacement d'une fête mobile est
 * traité à part : la suppression du férié retire ses rappels.
 */
export function holidayDedupeKey(dayIso: string): string {
  return `holiday:${dayIso}`;
}

/**
 * Sous-requête d'idempotence des rappels de fériés : « ce férié a-t-il déjà été
 * notifié à cet utilisateur ? ». Corrélée à la table `holidays` de la requête
 * englobante. Exportée UNIQUEMENT pour être testée contre un vrai Postgres.
 *
 * ATTENTION — la colonne de la table externe est qualifiée À LA MAIN.
 * Drizzle rend `${t.holidays.id}` en identifiant NU (`"id"`) ; à l'intérieur de
 * ce sous-SELECT sur `notifications`, la résolution de nom de Postgres consulte
 * d'abord la portée interne, donc `"id"` se lierait à `notifications.id` (qui
 * existe) au lieu de `holidays.id` : le garde-fou serait TOUJOURS faux et cet
 * endpoint, sondé par chaque session, retenterait une écriture à chaque appel.
 * `"day"` ne retomberait sur la table externe que par chance, `notifications`
 * n'ayant pas cette colonne — un hasard sur lequel on ne s'appuie pas.
 * Ne pas remplacer par des interpolations Drizzle. Couvert par
 * tests/holiday-reminders.spec.ts.
 */
export function holidayAlreadySentSql(userId: string) {
  return sql<boolean>`EXISTS (
    SELECT 1 FROM ${t.notifications} n
    WHERE n.recipient_user_id = ${userId}
      AND n.dedupe_key =
        'holiday:' || holidays.day::text
  )`;
}

/** Les trois prédicats qui reviennent partout, nommés une fois pour toutes. */
const mien = (userId: string) => eq(t.notifications.recipientUserId, userId);
const dansLaBoite = () => isNull(t.notifications.archivedAt);
const range = () => sql`${t.notifications.archivedAt} IS NOT NULL`;

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

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
  async list(user: SessionUser, scope: NotificationScope = 'inbox'): Promise<NotificationsPage> {
    const ctx = { tenantId: user.tenantId, userId: user.userId };

    // Génération dans sa PROPRE transaction, et jamais bloquante : une écriture
    // qui échoue (contrainte, verrou) ne doit pas priver l'utilisateur de sa
    // boîte de réception. Dans une transaction commune, l'échec d'un INSERT
    // avorte tout le reste — la lecture comprise.
    try {
      await this.db.withTenant(ctx, async (tx) => {
        // Les échéances de contrat ne concernent que ceux qui les traitent.
        if (HR_ROLES.includes(user.role)) {
          await this.generateContractDeadlines(tx, user.tenantId);
        }
        // Les fériés concernent tout le monde : le rappel est créé pour
        // l'utilisateur qui consulte (une ligne, idempotente par férié).
        await this.generateHolidayReminders(tx, user.tenantId, user.userId);
      });
    } catch (err) {
      this.logger.error(
        `Génération des notifications impossible (tenant ${user.tenantId}) : la boîte est servie sans elle.`,
        err instanceof Error ? err.stack : String(err),
      );
    }

    return this.db.withTenant(ctx, async (tx) => {
      const items = await tx
        .select()
        .from(t.notifications)
        .where(and(mien(user.userId), scope === 'archive' ? range() : dansLaBoite()))
        // Les archives se lisent par date de RANGEMENT : la dernière rangée est
        // celle qu'on vient de ranger, donc celle qu'on cherche à ressortir.
        .orderBy(
          scope === 'archive' ? desc(t.notifications.archivedAt) : desc(t.notifications.createdAt),
        )
        .limit(30);
      const [compte] = await tx
        .select({
          // Le compteur de la cloche ne parle que de la BOÎTE : une ligne
          // rangée sort du décompte sans qu'on ait eu à la déclarer lue.
          nonLues: sql<number>`count(*) FILTER (
            WHERE read_at IS NULL AND archived_at IS NULL)::int`,
          archivees: sql<number>`count(*) FILTER (WHERE archived_at IS NOT NULL)::int`,
        })
        .from(t.notifications)
        .where(mien(user.userId));
      return {
        unreadCount: compte?.nonLues ?? 0,
        archivedCount: compte?.archivees ?? 0,
        items: items.map((i) => ({
          id: i.id,
          type: i.type,
          title: i.title,
          body: i.body,
          link: i.link,
          readAt: i.readAt?.toISOString() ?? null,
          archivedAt: i.archivedAt?.toISOString() ?? null,
          createdAt: i.createdAt.toISOString(),
        })),
      };
    });
  }

  /**
   * Ranger : la ligne quitte la boîte, rien n'est effacé.
   *
   * On ne touche PAS à `read_at`. Ranger n'est pas lire — une échéance rangée
   * pour dégager la vue reste une échéance qu'on n'a pas ouverte, et les
   * archives le montrent encore. Le compteur de la cloche, lui, ne compte que
   * la boîte : ranger le fait bien descendre.
   *
   * L'idempotence des rappels générés (dedupeKey) survit au rangement :
   * l'index unique couvre la table entière, donc un rappel de férié rangé ne
   * revient PAS à la prochaine ouverture du panneau.
   */
  async archive(user: SessionUser, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      const rangees = await tx
        .update(t.notifications)
        .set({ archivedAt: new Date() })
        .where(and(mien(user.userId), inArray(t.notifications.id, ids), dansLaBoite()))
        .returning({ id: t.notifications.id });
      // Ranger deux fois n'est pas une erreur ; ranger une ligne qui n'existe
      // pas en est une — on ne laisse pas l'interface croire à un succès.
      if (rangees.length === 0) await this.exigerExistence(tx, user.userId, ids);
    });
  }

  /** Ressortir une ligne des archives : elle retrouve sa place dans la boîte. */
  async unarchive(user: SessionUser, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      const sorties = await tx
        .update(t.notifications)
        .set({ archivedAt: null })
        .where(and(mien(user.userId), inArray(t.notifications.id, ids), range()))
        .returning({ id: t.notifications.id });
      if (sorties.length === 0) await this.exigerExistence(tx, user.userId, ids);
    });
  }

  /**
   * Ranger d'un geste tout ce qui a été lu — le cas courant du « faire de la
   * place ». Les non-lues restent : personne n'a envie de voir disparaître un
   * avis qu'il n'a pas encore ouvert.
   */
  async archiveRead(user: SessionUser): Promise<void> {
    await this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, (tx) =>
      tx
        .update(t.notifications)
        .set({ archivedAt: new Date() })
        .where(and(mien(user.userId), dansLaBoite(), sql`${t.notifications.readAt} IS NOT NULL`)),
    );
  }

  /** 404 si l'un des identifiants n'est pas une notification de cet utilisateur. */
  private async exigerExistence(tx: Tx, userId: string, ids: string[]): Promise<void> {
    const connues = await tx
      .select({ id: t.notifications.id })
      .from(t.notifications)
      .where(and(mien(userId), inArray(t.notifications.id, ids)));
    if (connues.length !== ids.length) {
      problem(404, 'notifications.not_found', 'Notification introuvable');
    }
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
        daysLeft: r.daysLeft,
      }));
    });
  }

  /**
   * Rappel avant chaque jour férié : envoyé deux jours avant, reculé au
   * dernier jour ouvré si J−2 tombe un week-end ou un autre férié (un férié le
   * lundi prévient donc le vendredi). Créé pour l'utilisateur qui consulte ses
   * notifications, une seule fois par férié (dedupeKey).
   */
  private async generateHolidayReminders(tx: Tx, tenantId: string, userId: string): Promise<void> {
    // Une seule requête : les fériés de la quinzaine à venir, ceux qui les
    // précèdent (pour reculer un rappel tombant un jour chômé), la date du jour
    // LUE EN BASE (même horloge que le CURRENT_DATE du filtre) et le rappel
    // éventuellement déjà envoyé. Cet endpoint est pollé par chaque session
    // ouverte : en régime établi il ne doit produire AUCUNE écriture.
    const alreadySent = holidayAlreadySentSql(userId);
    const rows = await tx
      .select({
        id: t.holidays.id,
        day: sql<string>`${t.holidays.day}::text`,
        label: t.holidays.label,
        today: sql<string>`CURRENT_DATE::text`,
        /** false = simple voisin chargé pour le calcul de recul. */
        upcoming: sql<boolean>`${t.holidays.day} > CURRENT_DATE`,
        /** un férié tombant un week-end ne mérite pas de rappel. */
        onWeekend: sql<boolean>`EXTRACT(ISODOW FROM ${t.holidays.day}) >= 6`,
        alreadySent,
      })
      .from(t.holidays)
      // Bornée des deux côtés : le volume ne dépend pas de l'historique du
      // tenant. La borne basse couvre largement le recul (9 jours au pire).
      .where(
        and(
          sql`${t.holidays.day} > CURRENT_DATE - 14`,
          sql`${t.holidays.day} <= CURRENT_DATE + 14`,
        ),
      );
    if (rows.length === 0) return;

    const today = rows[0]!.today;
    const holidaySet = new Set(rows.map((h) => h.day));

    const due = rows.filter((h) => {
      if (!h.upcoming || h.alreadySent || h.onWeekend) return false;
      const remindOn = holidayReminderDate(h.day, holidaySet);
      return remindOn !== null && remindOn <= today;
    });
    if (due.length === 0) return; // cas courant : rien à écrire

    await tx
      .insert(t.notifications)
      .values(
        due.map((h) => ({
          id: uuidv7(),
          tenantId,
          recipientUserId: userId,
          type: 'holiday_reminder',
          title: `Jour férié à venir : ${h.label}`,
          body: `${frDate(h.day, true)} est chômé — pensez-y pour vos rendez-vous et vos échéances.`,
          link: '/calendrier',
          dedupeKey: holidayDedupeKey(h.day),
        })),
      )
      .onConflictDoNothing();
  }

  /**
   * Échéances : contrat AVEC date de fin, employé actif, fin dans ≤ 30 jours
   * (≤ 10 jours pour les contrats d'environ un mois) — notification RH
   * idempotente par contrat, visible jusqu'à expiration via le tableau de bord.
   */
  private async generateContractDeadlines(tx: Tx, tenantId: string): Promise<void> {
    const rows = await this.selectExpiring(tx);
    for (const { daysLeft, ...r } of rows) {
      await this.notifyHr(tx, tenantId, {
        type: 'contract_deadline',
        title: `Contrat de ${r.givenName} ${r.familyName} : échéance proche`,
        body: `${r.contractType.toUpperCase()} jusqu'au ${frDate(r.endDate)} — ${daysLeft} jour${daysLeft > 1 ? 's' : ''} restant${daysLeft > 1 ? 's' : ''}.`,
        link: `/employees/${r.employeeId}`,
        dedupeKey: `contract_deadline:${r.contractId}`,
      });
    }
  }

  private async selectExpiring(tx: Tx) {
    // Seuil : 30 j en général, 10 j pour les contrats courts (≤ 45 j de durée).
    // daysLeft se calcule EN SQL : le filtre utilise CURRENT_DATE (horloge du
    // serveur Postgres), un décompte fait en JS s'en écarterait d'un jour dès
    // que les deux processus ne sont pas sur le même fuseau.
    return tx
      .select({
        contractId: t.contracts.id,
        employeeId: t.contracts.employeeId,
        contractType: t.contracts.contractType,
        endDate: sql<string>`${t.contracts.endDate}::text`,
        daysLeft: sql<number>`(${t.contracts.endDate} - CURRENT_DATE)::int`,
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
