import { Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { EncryptionService } from '../../common/encryption.service';
import { loadEnv } from '../../config/env';
import * as t from '../../db/schema';
import { TenantDb, type Tx } from '../../db/tenant-db';
import { composer, objetDe, type ContenuCourriel, type Gabarit } from './gabarits';
import { sonderLogo, type LogoCourriel } from './logo';
import type { Transport } from './transports';

/* ────────────────────────────────────────────────────────────────
   La file des courriels.

   Le geste (une invitation) met son courriel en file dans sa propre
   transaction : annulé, rien ne part. L'expéditeur passe ensuite, juste après
   le geste puis toutes les 30 secondes, et envoie ce qui attend. Un serveur
   de courrier qui ne répond pas ne fait rien perdre : le courriel réessaie,
   de plus en plus espacé, puis on y renonce et la fiche le dit.

   Plusieurs instances de l'API peuvent tourner : chacune prend ses courriels
   sous verrou (SKIP LOCKED) et les réserve dix minutes. Une instance qui
   tombe en plein envoi les laisse repartir après ce délai : un courriel peut
   alors arriver deux fois, jamais se perdre.

   Un courriel se compose au moment de partir : il prend la dernière mise en
   forme et le logo du jour. L'invitation garde, chiffré, ce qu'elle dit (un
   lien à usage unique qu'on ne retrouverait nulle part ailleurs). La
   notification ne garde rien : elle se compose de la notification elle-même,
   qui dit aussi si elle a encore lieu d'être.
   ──────────────────────────────────────────────────────────────── */

/** Au-delà, on renonce : un peu plus de quatre heures d'essais. */
export const ESSAIS_MAX = 8;
const PAR_PASSAGE = 20;
const RESERVATION = "interval '10 minutes'";
const INTERVALLE_MS = 30_000;

/** Un courriel pris pour l'envoi, et de quoi composer une notification. */
type APrendre = {
  id: string;
  kind: string;
  recipient: string;
  subject: string;
  body_encrypted: string | null;
  attempts: number;
  titre: string | null;
  lien: string | null;
  prenom: string | null;
  organisation: string | null;
};

export interface CourrielEnFile {
  tenantId: string;
  /** Ce qui le fait partir (« invitation ») et ce dont il parle. */
  kind: string;
  subjectId: string;
  to: string;
  gabarit: Gabarit;
}

/** Le délai avant l'essai suivant : 1, 2, 4… minutes, au plus 6 heures. */
export const delaiAvantEssai = (essais: number) =>
  Math.min(60 * 2 ** Math.max(0, essais - 1), 6 * 3600);

const contexteDuCorps = (tenantId: string, id: string) => `${tenantId}:outbound_emails:${id}:body`;

/**
 * Un courriel qui n'a plus lieu d'être ne part pas. L'invitation qu'il porte
 * a été remplacée par une autre, close (dossier archivé) ou déjà acceptée ;
 * la notification a été lue, rangée, remplacée par une plus récente ou
 * effacée, ou l'accès de son destinataire a été coupé. Vérifié au moment
 * d'envoyer, quel que soit le chemin qui y a mené.
 */
async function annulerCeQuiNaPlusLieu(tx: Tx): Promise<void> {
  await tx.execute(sql`
    UPDATE outbound_emails o
       SET status = 'cancelled', body_encrypted = NULL
     WHERE o.status = 'pending' AND o.next_attempt_at <= now()
       AND CASE o.kind
             WHEN 'invitation' THEN NOT EXISTS (
               SELECT 1 FROM invitations i
                WHERE i.id = o.subject_id
                  AND i.accepted_at IS NULL AND i.expires_at > now())
             WHEN 'notification' THEN NOT EXISTS (
               SELECT 1 FROM notifications n
                 JOIN user_tenant_memberships m
                   ON m.user_id = n.recipient_user_id AND m.tenant_id = n.tenant_id
                WHERE n.id = o.subject_id
                  AND n.read_at IS NULL AND n.archived_at IS NULL AND n.remplacee_le IS NULL
                  AND m.acces_coupe_le IS NULL)
             ELSE FALSE
           END`);
}

/**
 * L'expéditeur en service, quand un serveur de courrier est configuré.
 * `notifier` est une fonction, appelée hors de l'injection (cf. notifier.ts) :
 * c'est ici qu'elle le trouve.
 */
let enService: ExpediteurCourriels | null = null;

/**
 * Toute notification part aussi par courriel, à l'adresse du compte de son
 * destinataire : on n'a pas toujours le réflexe d'ouvrir la plateforme, le
 * courriel le rappelle. Dans la transaction qui crée les notifications ;
 * rien pour qui n'a plus accès à l'organisation.
 */
export async function doublerParCourriel(
  tx: Tx,
  tenantId: string,
  notifications: { id: string; recipientUserId: string; title: string }[],
): Promise<void> {
  const expediteur = enService;
  if (!expediteur || notifications.length === 0) return;
  const lignes = notifications.map((n) => ({
    id: uuidv7(),
    notification_id: n.id,
    user_id: n.recipientUserId,
    titre: n.title,
  }));
  await tx.execute(sql`
    INSERT INTO outbound_emails (id, tenant_id, kind, subject_id, recipient, subject)
    SELECT x.id, ${tenantId}, 'notification', x.notification_id, u.email, left(x.titre, 300)
      FROM jsonb_to_recordset(${JSON.stringify(lignes)}::jsonb)
             AS x(id uuid, notification_id uuid, user_id uuid, titre text)
      JOIN users u ON u.id = x.user_id AND u.status = 'active'
      JOIN user_tenant_memberships m ON m.user_id = x.user_id AND m.tenant_id = ${tenantId}
     WHERE m.acces_coupe_le IS NULL`);
  expediteur.bientot();
}

export class ExpediteurCourriels implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Courriels');
  private minuterie: NodeJS.Timeout | null = null;
  private relance: NodeJS.Timeout | null = null;
  private passage: Promise<void> | null = null;
  private encore = false;

  constructor(
    private readonly db: TenantDb,
    private readonly enc: EncryptionService,
    private readonly transport: Transport | null,
    private readonly expediteur: string,
    private readonly portail = loadEnv().PUBLIC_WEB_URL.replace(/\/$/, ''),
    private readonly sonde: (portail: string) => Promise<LogoCourriel | null> = sonderLogo,
    private readonly cadence = INTERVALLE_MS,
  ) {}

  /** Le logo que le site sert, revu toutes les dix minutes : un logo déposé entre-temps est pris. */
  private logo: { valeur: Promise<LogoCourriel | null>; jusqua: number } | null = null;

  /** Un serveur de courrier est configuré : les invitations partent seules. */
  get actif(): boolean {
    return this.transport !== null;
  }

  onModuleInit(): void {
    if (!this.transport) return;
    this.logger.log(`Envoi des courriels par ${this.transport.nom}`);
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

  /** Les notifications partent désormais aussi par lui. */
  brancher(): void {
    if (this.transport) enService = this;
  }

  debrancher(): void {
    if (enService === this) enService = null;
  }

  /**
   * Met un courriel en file, dans la transaction du geste (contexte du
   * tenant posé). Sans serveur configuré, rien n'est mis en file : `false`.
   */
  async mettreEnFile(tx: Tx, c: CourrielEnFile): Promise<boolean> {
    if (!this.transport) return false;
    const id = uuidv7();
    await tx.insert(t.outboundEmails).values({
      id,
      tenantId: c.tenantId,
      kind: c.kind,
      subjectId: c.subjectId,
      recipient: c.to,
      subject: objetDe(c.gabarit),
      bodyEncrypted: this.enc.chiffrerTexte(
        JSON.stringify(c.gabarit),
        contexteDuCorps(c.tenantId, id),
      ),
    });
    return true;
  }

  /** Après le geste : l'envoi part sans attendre le prochain passage. */
  bientot(): void {
    if (!this.transport || this.relance) return;
    this.relance = setTimeout(() => {
      this.relance = null;
      void this.envoyerCeQuiAttend();
    }, 500);
    this.relance.unref();
  }

  /** Envoie ce qui attend, organisation par organisation. Jamais deux passages à la fois. */
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
      sql`SELECT outbound_email_tenants() AS tenant_id`,
    );
    for (const { tenant_id: tenantId } of organisations) {
      const { rows: lot } = await this.db.withTenant({ tenantId }, async (tx) => {
        await annulerCeQuiNaPlusLieu(tx);
        // Une notification se compose de ce qu'elle est au moment de partir.
        return tx.execute<APrendre>(sql`
          WITH pris AS (
            UPDATE outbound_emails
               SET attempts = attempts + 1,
                   next_attempt_at = now() + ${sql.raw(RESERVATION)}
             WHERE id IN (SELECT id FROM outbound_emails
                           WHERE status = 'pending' AND next_attempt_at <= now()
                           ORDER BY created_at
                           LIMIT ${PAR_PASSAGE}
                           FOR UPDATE SKIP LOCKED)
         RETURNING id, kind, subject_id, recipient, subject, body_encrypted, attempts, created_at)
          SELECT p.id, p.kind, p.recipient, p.subject, p.body_encrypted, p.attempts,
                 n.title AS titre, n.link AS lien, u.given_name AS prenom, o.name AS organisation
            FROM pris p
            LEFT JOIN notifications n ON p.kind = 'notification' AND n.id = p.subject_id
            LEFT JOIN users u ON u.id = n.recipient_user_id
            LEFT JOIN tenants o ON o.id = n.tenant_id
           ORDER BY p.created_at`);
      });
      if (lot.length === 0) continue;
      if (!this.logo || this.logo.jusqua < Date.now()) {
        this.logo = { valeur: this.sonde(this.portail), jusqua: Date.now() + 10 * 60_000 };
      }
      const logo = await this.logo.valeur;
      for (const courriel of lot) {
        const issue = await this.envoyerUn(transport, tenantId, courriel, logo);
        await this.db.withTenant({ tenantId }, (tx) => this.consigner(tx, courriel, issue));
      }
    }
  }

  /** Ce que dit le courriel : ce qu'il garde, chiffré, ou la notification qu'il double. */
  private contenu(
    tenantId: string,
    c: APrendre,
    logo: LogoCourriel | null,
  ): ContenuCourriel | null {
    const rendu = { logo, portail: this.portail };
    if (c.kind === 'notification') {
      if (c.titre === null) return null;
      return composer(
        {
          nom: 'notification',
          prenom: c.prenom ?? '',
          organisation: c.organisation ?? '',
          titre: c.titre,
          lien: `${this.portail}${c.lien?.startsWith('/') ? c.lien : '/'}`,
        },
        rendu,
      );
    }
    if (!c.body_encrypted) return null;
    try {
      const garde = JSON.parse(
        this.enc.dechiffrerTexte(c.body_encrypted, contexteDuCorps(tenantId, c.id)),
      ) as Gabarit | { text: string; html: string };
      // Mis en file avant que le courriel ne se compose au départ : déjà écrit.
      if ('html' in garde) return { subject: c.subject, ...garde };
      return composer(garde, rendu);
    } catch {
      return null;
    }
  }

  private async envoyerUn(
    transport: Transport,
    tenantId: string,
    c: APrendre,
    logo: LogoCourriel | null,
  ): Promise<{ ok: true } | { ok: false; erreur: string; definitif: boolean }> {
    const corps = this.contenu(tenantId, c, logo);
    // Clé changée, ligne recopiée, notification disparue : aucun essai ne le
    // rendra lisible.
    if (!corps) return { ok: false, erreur: 'Corps illisible', definitif: true };
    try {
      await transport.envoyer({
        from: this.expediteur,
        to: c.recipient,
        subject: corps.subject,
        text: corps.text,
        html: corps.html,
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, erreur: (e as Error).message || 'Envoi refusé', definitif: false };
    }
  }

  private async consigner(
    tx: Tx,
    c: { id: string; attempts: number },
    issue: { ok: true } | { ok: false; erreur: string; definitif: boolean },
  ): Promise<void> {
    if (issue.ok) {
      await tx.execute(sql`
        UPDATE outbound_emails
           SET status = 'sent', sent_at = now(), body_encrypted = NULL, last_error = NULL
         WHERE id = ${c.id}`);
      return;
    }
    const erreur = issue.erreur.slice(0, 500);
    if (issue.definitif || c.attempts >= ESSAIS_MAX) {
      this.logger.warn(`Courriel ${c.id} abandonné après ${c.attempts} essai(s) : ${erreur}`);
      await tx.execute(sql`
        UPDATE outbound_emails
           SET status = 'failed', body_encrypted = NULL, last_error = ${erreur}
         WHERE id = ${c.id}`);
      return;
    }
    await tx.execute(sql`
      UPDATE outbound_emails
         SET last_error = ${erreur},
             next_attempt_at = now() + make_interval(secs => ${delaiAvantEssai(c.attempts)}::double precision)
       WHERE id = ${c.id}`);
  }
}
