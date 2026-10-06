import { Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { EncryptionService } from '../../common/encryption.service';
import * as t from '../../db/schema';
import { TenantDb, type Tx } from '../../db/tenant-db';
import type { ContenuCourriel } from './gabarits';
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
   ──────────────────────────────────────────────────────────────── */

/** Au-delà, on renonce : un peu plus de quatre heures d'essais. */
export const ESSAIS_MAX = 8;
const PAR_PASSAGE = 20;
const RESERVATION = "interval '10 minutes'";
const INTERVALLE_MS = 30_000;

export interface CourrielEnFile extends ContenuCourriel {
  tenantId: string;
  /** Ce qui le fait partir (« invitation ») et ce dont il parle. */
  kind: string;
  subjectId: string;
  to: string;
}

/** Le délai avant l'essai suivant : 1, 2, 4… minutes, au plus 6 heures. */
export const delaiAvantEssai = (essais: number) =>
  Math.min(60 * 2 ** Math.max(0, essais - 1), 6 * 3600);

const contexteDuCorps = (tenantId: string, id: string) => `${tenantId}:outbound_emails:${id}:body`;

/**
 * Un courriel qui n'a plus lieu d'être ne part pas : l'invitation qu'il porte
 * a été remplacée par une autre, close (dossier archivé) ou déjà acceptée.
 * Vérifié au moment d'envoyer, quel que soit le chemin qui l'a close.
 */
async function annulerCeQuiNaPlusLieu(tx: Tx): Promise<void> {
  await tx.execute(sql`
    UPDATE outbound_emails o
       SET status = 'cancelled', body_encrypted = NULL
     WHERE o.status = 'pending' AND o.next_attempt_at <= now() AND o.kind = 'invitation'
       AND NOT EXISTS (SELECT 1 FROM invitations i
                        WHERE i.id = o.subject_id
                          AND i.accepted_at IS NULL AND i.expires_at > now())`);
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
    private readonly cadence = INTERVALLE_MS,
  ) {}

  /** Un serveur de courrier est configuré : les invitations partent seules. */
  get actif(): boolean {
    return this.transport !== null;
  }

  onModuleInit(): void {
    if (!this.transport) return;
    this.logger.log(`Envoi des courriels par ${this.transport.nom}`);
    this.minuterie = setInterval(() => void this.envoyerCeQuiAttend(), this.cadence);
    this.minuterie.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.minuterie) clearInterval(this.minuterie);
    if (this.relance) clearTimeout(this.relance);
    await this.passage?.catch(() => undefined);
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
      subject: c.subject,
      bodyEncrypted: this.enc.chiffrerTexte(
        JSON.stringify({ text: c.text, html: c.html }),
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
        return tx.execute<{
          id: string;
          recipient: string;
          subject: string;
          body_encrypted: string;
          attempts: number;
        }>(sql`
          UPDATE outbound_emails
             SET attempts = attempts + 1,
                 next_attempt_at = now() + ${sql.raw(RESERVATION)}
           WHERE id IN (SELECT id FROM outbound_emails
                         WHERE status = 'pending' AND next_attempt_at <= now()
                         ORDER BY created_at
                         LIMIT ${PAR_PASSAGE}
                         FOR UPDATE SKIP LOCKED)
       RETURNING id, recipient, subject, body_encrypted, attempts`);
      });
      for (const courriel of lot) {
        const issue = await this.envoyerUn(transport, tenantId, courriel);
        await this.db.withTenant({ tenantId }, (tx) => this.consigner(tx, courriel, issue));
      }
    }
  }

  private async envoyerUn(
    transport: Transport,
    tenantId: string,
    c: { id: string; recipient: string; subject: string; body_encrypted: string },
  ): Promise<{ ok: true } | { ok: false; erreur: string; definitif: boolean }> {
    let corps: { text: string; html: string };
    try {
      corps = JSON.parse(
        this.enc.dechiffrerTexte(c.body_encrypted, contexteDuCorps(tenantId, c.id)),
      );
    } catch {
      // Clé changée ou ligne recopiée : aucun essai ne le rendra lisible.
      return { ok: false, erreur: 'Corps illisible', definitif: true };
    }
    try {
      await transport.envoyer({
        from: this.expediteur,
        to: c.recipient,
        subject: c.subject,
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
