import { Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { creneauWhatsApp, texteWhatsApp } from '@teranga/contracts';
import { EncryptionService } from '../../common/encryption.service';
import * as t from '../../db/schema';
import { TenantDb, type Tx } from '../../db/tenant-db';
import { delaiAvantEssai, ESSAIS_MAX } from '../courriels/expediteur';
import { enCongeAujourdhui } from '../notifications/canaux';
import { RefusDefinitif, type MessageWhatsApp, type TransportWhatsApp } from './transports';

/* La file des messages WhatsApp.

   Elle suit celle des courriels : le message se met en file dans la
   transaction qui crée la notification (annulée, rien ne part), puis
   l'expéditeur passe juste après et toutes les 30 secondes, sous verrou
   (SKIP LOCKED), et réessaie de plus en plus espacé.

   Ce qui lui est propre :
   · le numéro ne voyage pas avec le message : il se lit au départ. Un
     numéro retiré ou changé entre-temps, et le message ne part pas ;
   · il se recompose au départ, et se demande encore s'il a lieu d'être :
     notification lue ou rangée, WhatsApp décoché depuis pour ce sujet, accès
     coupé, personne partie en congé avec la pause : il ne part pas ;
   · les heures calmes : hors des jours ouvrés et de 8 h à 19 h, il attend
     (cf. creneauWhatsApp) ; un code de vérification, lui, part tout de suite. */

const PAR_PASSAGE = 20;
const RESERVATION = "interval '10 minutes'";
const INTERVALLE_MS = 30_000;
/** Le code d'un numéro à vérifier vaut dix minutes. */
export const CODE_TTL_MINUTES = 10;

export const contexteDuNumero = (tenantId: string, userId: string) =>
  `${tenantId}:notification_reglages:${userId}:whatsapp`;
export const contexteDeLaVerification = (tenantId: string, id: string, champ: 'numero' | 'code') =>
  `${tenantId}:whatsapp_verifications:${id}:${champ}`;

type APrendre = {
  id: string;
  kind: 'notification' | 'code';
  subject_id: string;
  user_id: string;
  attempts: number;
  titre: string | null;
  lien: string | null;
  sujet: string | null;
  prenom: string | null;
  numero_chiffre: string | null;
  v_numero_chiffre: string | null;
  v_code_chiffre: string | null;
};

let enService: ExpediteurWhatsApp | null = null;

/** L'expéditeur en service, si un fournisseur WhatsApp est configuré. */
export const whatsappEnService = (): ExpediteurWhatsApp | null => enService;

/** Les jours fériés des six prochaines semaines : de quoi trouver le prochain créneau. */
async function feriesAVenir(tx: Tx): Promise<Set<string>> {
  const { rows } = await tx.execute<{ jour: string }>(sql`
    SELECT day::text AS jour FROM holidays
     WHERE day BETWEEN CURRENT_DATE AND CURRENT_DATE + 45`);
  return new Set(rows.map((r) => r.jour));
}

/**
 * Double des notifications par WhatsApp, dans la transaction qui les crée.
 * Ceux qui gardent leurs heures calmes reçoivent le message au prochain
 * créneau ouvré.
 */
export async function doublerParWhatsApp(
  tx: Tx,
  tenantId: string,
  envois: { notificationId: string; userId: string; heuresCalmes: boolean }[],
): Promise<void> {
  const expediteur = enService;
  if (!expediteur || envois.length === 0) return;
  const maintenant = new Date();
  const feries = envois.some((e) => e.heuresCalmes) ? await feriesAVenir(tx) : new Set<string>();
  const creneau = creneauWhatsApp(maintenant, feries);
  await tx.insert(t.outboundWhatsapp).values(
    envois.map((e) => ({
      id: uuidv7(),
      tenantId,
      kind: 'notification',
      subjectId: e.notificationId,
      userId: e.userId,
      nextAttemptAt: e.heuresCalmes ? creneau : maintenant,
    })),
  );
  if (!envois.every((e) => e.heuresCalmes) || creneau === maintenant) expediteur.bientot();
}

/**
 * Ce qui n'a plus lieu de partir ne part pas : vérifié au moment d'envoyer,
 * quel que soit le chemin qui y a mené.
 */
async function annulerCeQuiNaPlusLieu(tx: Tx): Promise<void> {
  await tx.execute(sql`
    UPDATE outbound_whatsapp o
       SET status = 'cancelled'
     WHERE o.status = 'pending' AND o.next_attempt_at <= now()
       AND CASE o.kind
             WHEN 'notification' THEN NOT EXISTS (
               SELECT 1 FROM notifications n
                 JOIN user_tenant_memberships m
                   ON m.user_id = n.recipient_user_id AND m.tenant_id = n.tenant_id
                 JOIN notification_reglages r
                   ON r.user_id = n.recipient_user_id AND r.tenant_id = n.tenant_id
                 LEFT JOIN notification_preferences p
                   ON p.user_id = n.recipient_user_id AND p.tenant_id = n.tenant_id
                  AND p.sujet = n.sujet
                WHERE n.id = o.subject_id
                  AND n.read_at IS NULL AND n.archived_at IS NULL AND n.remplacee_le IS NULL
                  AND m.acces_coupe_le IS NULL
                  AND r.whatsapp_verifie_le IS NOT NULL
                  AND coalesce(p.whatsapp, false)
                  AND NOT (r.pause_conges AND ${enCongeAujourdhui(sql`n.recipient_user_id`)}))
             WHEN 'code' THEN NOT EXISTS (
               SELECT 1 FROM whatsapp_verifications v
                WHERE v.id = o.subject_id AND v.utilisee_le IS NULL
                  AND v.expire_le > now() AND v.code_chiffre IS NOT NULL)
             ELSE FALSE
           END`);
}

export class ExpediteurWhatsApp implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('WhatsApp');
  private minuterie: NodeJS.Timeout | null = null;
  private relance: NodeJS.Timeout | null = null;
  private passage: Promise<void> | null = null;
  private encore = false;

  constructor(
    private readonly db: TenantDb,
    private readonly enc: EncryptionService,
    private readonly transport: TransportWhatsApp | null,
    private readonly cadence = INTERVALLE_MS,
  ) {}

  /** Un fournisseur est configuré : WhatsApp s'offre aux agents. */
  get actif(): boolean {
    return this.transport !== null;
  }

  onModuleInit(): void {
    if (!this.transport) return;
    this.logger.log(`Envoi des messages WhatsApp par ${this.transport.nom}`);
    this.brancher();
    this.minuterie = setInterval(() => void this.envoyerCeQuiAttend(), this.cadence);
    this.minuterie.unref();
  }

  async onModuleDestroy(): Promise<void> {
    this.debrancher();
    if (this.minuterie) clearInterval(this.minuterie);
    if (this.relance) clearTimeout(this.relance);
    await this.passage?.catch(() => undefined);
  }

  brancher(): void {
    if (this.transport) enService = this;
  }

  debrancher(): void {
    if (enService === this) enService = null;
  }

  /** Le code d'une vérification part tout de suite, sans heures calmes. */
  async mettreCodeEnFile(
    tx: Tx,
    tenantId: string,
    verificationId: string,
    userId: string,
  ): Promise<void> {
    await tx.insert(t.outboundWhatsapp).values({
      id: uuidv7(),
      tenantId,
      kind: 'code',
      subjectId: verificationId,
      userId,
    });
  }

  bientot(): void {
    if (!this.transport || this.relance) return;
    this.relance = setTimeout(() => {
      this.relance = null;
      void this.envoyerCeQuiAttend();
    }, 500);
    this.relance.unref();
  }

  envoyerCeQuiAttend(): Promise<void> {
    if (this.passage) {
      this.encore = true;
      return this.passage;
    }
    this.passage = (async () => {
      try {
        do {
          this.encore = false;
          await this.unPassage();
        } while (this.encore);
      } catch (e) {
        this.logger.error(`Passage interrompu : ${(e as Error).message}`);
      } finally {
        this.passage = null;
      }
    })();
    return this.passage;
  }

  private async unPassage(): Promise<void> {
    const transport = this.transport;
    if (!transport) return;
    const { rows: organisations } = await this.db.global.execute<{ tenant_id: string }>(
      sql`SELECT outbound_whatsapp_tenants() AS tenant_id`,
    );
    for (const { tenant_id: tenantId } of organisations) {
      const { rows: lot } = await this.db.withTenant({ tenantId }, async (tx) => {
        await annulerCeQuiNaPlusLieu(tx);
        return tx.execute<APrendre>(sql`
          WITH pris AS (
            UPDATE outbound_whatsapp
               SET attempts = attempts + 1,
                   next_attempt_at = now() + ${sql.raw(RESERVATION)}
             WHERE id IN (SELECT id FROM outbound_whatsapp
                           WHERE status = 'pending' AND next_attempt_at <= now()
                           ORDER BY created_at
                           LIMIT ${PAR_PASSAGE}
                           FOR UPDATE SKIP LOCKED)
         RETURNING id, kind, subject_id, user_id, attempts, created_at)
          SELECT p.id, p.kind, p.subject_id, p.user_id, p.attempts,
                 n.title AS titre, n.link AS lien, n.sujet, u.given_name AS prenom,
                 r.whatsapp_numero_chiffre AS numero_chiffre,
                 v.numero_chiffre AS v_numero_chiffre, v.code_chiffre AS v_code_chiffre
            FROM pris p
            JOIN users u ON u.id = p.user_id
            LEFT JOIN notifications n ON p.kind = 'notification' AND n.id = p.subject_id
            LEFT JOIN notification_reglages r ON p.kind = 'notification' AND r.user_id = p.user_id
            LEFT JOIN whatsapp_verifications v ON p.kind = 'code' AND v.id = p.subject_id
           ORDER BY p.created_at`);
      });
      for (const m of lot) {
        const issue = await this.envoyerUn(transport, tenantId, m);
        await this.db.withTenant({ tenantId }, (tx) => this.consigner(tx, m, issue));
      }
    }
  }

  /** Le message, recomposé au départ ; null s'il ne peut plus se lire. */
  private message(tenantId: string, m: APrendre): MessageWhatsApp | null {
    try {
      if (m.kind === 'code') {
        if (!m.v_numero_chiffre || !m.v_code_chiffre) return null;
        return {
          modele: 'code',
          to: this.enc.dechiffrerTexte(
            m.v_numero_chiffre,
            contexteDeLaVerification(tenantId, m.subject_id, 'numero'),
            'dossiers',
          ),
          code: this.enc.dechiffrerTexte(
            m.v_code_chiffre,
            contexteDeLaVerification(tenantId, m.subject_id, 'code'),
            'dossiers',
          ),
        };
      }
      if (!m.numero_chiffre || m.titre === null) return null;
      return {
        modele: 'notification',
        to: this.enc.dechiffrerTexte(
          m.numero_chiffre,
          contexteDuNumero(tenantId, m.user_id),
          'dossiers',
        ),
        prenom: m.prenom ?? '',
        texte: texteWhatsApp(m.sujet, m.titre),
        chemin: (m.lien ?? '').replace(/^\//, ''),
      };
    } catch {
      return null;
    }
  }

  private async envoyerUn(
    transport: TransportWhatsApp,
    tenantId: string,
    m: APrendre,
  ): Promise<{ ok: true } | { ok: false; erreur: string; definitif: boolean }> {
    const message = this.message(tenantId, m);
    if (!message) return { ok: false, erreur: 'Message illisible', definitif: true };
    try {
      await transport.envoyer(message);
      return { ok: true };
    } catch (e) {
      return {
        ok: false,
        erreur: (e as Error).message || 'Envoi refusé',
        definitif: e instanceof RefusDefinitif,
      };
    }
  }

  private async consigner(
    tx: Tx,
    m: APrendre,
    issue: { ok: true } | { ok: false; erreur: string; definitif: boolean },
  ): Promise<void> {
    const fini = issue.ok || issue.definitif || m.attempts >= ESSAIS_MAX;
    // Un code parti (ou abandonné) ne se garde plus en clair, même chiffré.
    if (m.kind === 'code' && fini) {
      await tx.execute(sql`
        UPDATE whatsapp_verifications SET code_chiffre = NULL WHERE id = ${m.subject_id}`);
    }
    if (issue.ok) {
      await tx.execute(sql`
        UPDATE outbound_whatsapp SET status = 'sent', sent_at = now(), last_error = NULL
         WHERE id = ${m.id}`);
      return;
    }
    const erreur = issue.erreur.slice(0, 500);
    if (fini) {
      this.logger.warn(`Message ${m.id} abandonné après ${m.attempts} essai(s) : ${erreur}`);
      await tx.execute(sql`
        UPDATE outbound_whatsapp SET status = 'failed', last_error = ${erreur} WHERE id = ${m.id}`);
      return;
    }
    await tx.execute(sql`
      UPDATE outbound_whatsapp
         SET last_error = ${erreur},
             next_attempt_at = now() + make_interval(secs => ${delaiAvantEssai(m.attempts)}::double precision)
       WHERE id = ${m.id}`);
  }
}
