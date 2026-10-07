import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import {
  CANAUX_PAR_DEFAUT,
  type ChangerReglagesInput,
  type ChangerSujetsInput,
  numeroLisible,
  numeroMasque,
  numeroWhatsApp,
  type ProfilDeNotification,
  type ReglagesNotifications,
  type SessionUser,
  SUJETS,
  sujetsDe,
} from '@teranga/contracts';
import { EncryptionService } from '../../common/encryption.service';
import { problem } from '../../common/problem';
import { TenantDb, type Tx } from '../../db/tenant-db';
import { employeActif } from '../academy/academy-evaluation.service';
import { DG } from '../people/chaine';
import {
  CODE_TTL_MINUTES,
  contexteDeLaVerification,
  contexteDuNumero,
  ExpediteurWhatsApp,
} from '../whatsapp/expediteur';

/* Les réglages des notifications d'une personne : ses sujets, son numéro
   WhatsApp, ses heures calmes, sa pause pendant ses congés.

   Le numéro WhatsApp se prouve : un code à six chiffres part par WhatsApp,
   valable dix minutes, cinq essais. Un code par minute, cinq par jour : on ne
   fait pas sonner le téléphone d'un autre à volonté. Le numéro se garde
   chiffré ; l'écran n'en montre que le début et la fin. */

const ESSAIS_CODE = 5;
const CODES_PAR_JOUR = 5;

const hacher = (id: string, code: string) =>
  createHash('sha256').update(`${id}:${code}`).digest('hex');

@Injectable()
export class NotificationsReglagesService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(EncryptionService) private readonly enc: EncryptionService,
    @Inject(ExpediteurWhatsApp) private readonly whatsapp: ExpediteurWhatsApp,
  ) {}

  private ctx(user: SessionUser) {
    return { tenantId: user.tenantId, userId: user.userId };
  }

  /** Ce qu'il faut savoir de la personne pour lui proposer ses sujets. */
  private async profil(tx: Tx, user: SessionUser): Promise<ProfilDeNotification> {
    const moi = await employeActif(tx, user.userId);
    let aUneEquipe = false;
    if (moi) {
      const { rows } = await tx.execute<{ oui: boolean }>(sql`
        SELECT EXISTS (
          SELECT 1 FROM employees e
           WHERE e.manager_employee_id = ${moi} AND e.status = 'active'
             AND e.id IS DISTINCT FROM ${DG}) AS oui`);
      aUneEquipe = Boolean(rows[0]?.oui);
    }
    return {
      role: user.role,
      capacites: user.capacites,
      estAgent: user.estAgent,
      estDG: user.estDG,
      dirigeLaDCH: user.dirigeLaDCH,
      aUneEquipe,
    };
  }

  async lire(user: SessionUser): Promise<ReglagesNotifications> {
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const profil = await this.profil(tx, user);
      const { rows: prefs } = await tx.execute<{
        sujet: string;
        plateforme: boolean;
        courriel: boolean;
        whatsapp: boolean;
      }>(sql`
        SELECT sujet, plateforme, courriel, whatsapp FROM notification_preferences
         WHERE user_id = ${user.userId}`);
      const { rows: reglages } = await tx.execute<{
        masque: string | null;
        verifie: boolean;
        heures_calmes: boolean;
        pause_conges: boolean;
      }>(sql`
        SELECT whatsapp_numero_masque AS masque, whatsapp_verifie_le IS NOT NULL AS verifie,
               heures_calmes, pause_conges
          FROM notification_reglages WHERE user_id = ${user.userId}`);
      const r = reglages[0];
      const verifie = Boolean(r?.verifie);
      const { rows: dossier } = await tx.execute<{ phone: string | null }>(sql`
        SELECT phone FROM persons WHERE user_id = ${user.userId} AND deleted_at IS NULL LIMIT 1`);
      const mobile = dossier[0]?.phone ? numeroWhatsApp(dossier[0].phone) : null;
      const { rows: enCours } = await tx.execute<{ masque: string }>(sql`
        SELECT numero_masque AS masque FROM whatsapp_verifications
         WHERE user_id = ${user.userId} AND utilisee_le IS NULL AND expire_le > now()
           AND essais < ${ESSAIS_CODE}
         ORDER BY created_at DESC LIMIT 1`);
      const parSujet = new Map(prefs.map((p) => [p.sujet, p]));
      return {
        sujets: sujetsDe(profil).map((sujet) => {
          const p = parSujet.get(sujet);
          const d = SUJETS[sujet];
          return {
            sujet,
            groupe: d.groupe,
            libelle: d.libelle,
            icone: d.icone,
            plateforme: p?.plateforme ?? CANAUX_PAR_DEFAUT.plateforme,
            courriel: p?.courriel ?? CANAUX_PAR_DEFAUT.courriel,
            // Sans numéro vérifié, rien ne part : l'écran le montre décoché.
            whatsapp: verifie && (p?.whatsapp ?? CANAUX_PAR_DEFAUT.whatsapp),
          };
        }),
        whatsapp: {
          disponible: this.whatsapp.actif,
          numero: verifie ? (r?.masque ?? null) : null,
          numeroDuDossier: mobile ? numeroLisible(mobile) : null,
          codeEnvoyeA: enCours[0]?.masque ?? null,
        },
        heuresCalmes: r?.heures_calmes ?? true,
        pauseConges: user.estAgent ? (r?.pause_conges ?? false) : null,
      };
    });
  }

  async changerSujets(
    user: SessionUser,
    input: ChangerSujetsInput,
  ): Promise<ReglagesNotifications> {
    await this.db.withTenant(this.ctx(user), async (tx) => {
      const permis = new Set(sujetsDe(await this.profil(tx, user)));
      if (input.sujets.some((s) => !permis.has(s.sujet))) {
        problem(422, 'notifications.sujet_hors_profil', 'Ce sujet ne vous concerne pas');
      }
      if (input.sujets.some((s) => s.whatsapp)) {
        const { rows } = await tx.execute<{ oui: boolean }>(sql`
          SELECT EXISTS (SELECT 1 FROM notification_reglages
                          WHERE user_id = ${user.userId} AND whatsapp_verifie_le IS NOT NULL) AS oui`);
        if (!rows[0]?.oui) {
          problem(
            422,
            'notifications.whatsapp_non_verifie',
            'Vérifiez d’abord votre numéro WhatsApp',
          );
        }
      }
      for (const s of input.sujets) {
        // Une ligne par sujet changé ; inchangée, elle n'écrit rien (ni au journal).
        await tx.execute(sql`
          INSERT INTO notification_preferences
            (id, tenant_id, user_id, sujet, plateforme, courriel, whatsapp)
          VALUES (${uuidv7()}, ${user.tenantId}, ${user.userId}, ${s.sujet},
                  ${s.plateforme}, ${s.courriel}, ${s.whatsapp})
          ON CONFLICT (tenant_id, user_id, sujet) DO UPDATE
             SET plateforme = EXCLUDED.plateforme, courriel = EXCLUDED.courriel,
                 whatsapp = EXCLUDED.whatsapp, updated_at = now()
           WHERE (notification_preferences.plateforme, notification_preferences.courriel,
                  notification_preferences.whatsapp)
                 IS DISTINCT FROM (EXCLUDED.plateforme, EXCLUDED.courriel, EXCLUDED.whatsapp)`);
      }
    });
    return this.lire(user);
  }

  /** Crée la ligne des réglages au besoin, et la renvoie verrouillée. */
  private async reglages(tx: Tx, user: SessionUser): Promise<void> {
    await tx.execute(sql`
      INSERT INTO notification_reglages (id, tenant_id, user_id)
      VALUES (${uuidv7()}, ${user.tenantId}, ${user.userId})
      ON CONFLICT (tenant_id, user_id) DO NOTHING`);
  }

  async changerReglages(
    user: SessionUser,
    input: ChangerReglagesInput,
  ): Promise<ReglagesNotifications> {
    await this.db.withTenant(this.ctx(user), async (tx) => {
      await this.reglages(tx, user);
      await tx.execute(sql`
        UPDATE notification_reglages
           SET heures_calmes = coalesce(${input.heuresCalmes ?? null}::boolean, heures_calmes),
               pause_conges = coalesce(${user.estAgent ? (input.pauseConges ?? null) : null}::boolean, pause_conges),
               updated_at = now()
         WHERE user_id = ${user.userId}`);
    });
    return this.lire(user);
  }

  /** Envoie par WhatsApp un code qui prouve que le numéro est le sien. */
  async demanderCode(user: SessionUser, numero: string): Promise<ReglagesNotifications> {
    if (!this.whatsapp.actif) {
      problem(503, 'notifications.whatsapp_indisponible', 'WhatsApp n’est pas disponible');
    }
    const e164 = numeroWhatsApp(numero);
    if (!e164) {
      problem(422, 'notifications.numero_invalide', 'Ce numéro ne peut pas recevoir WhatsApp');
    }
    await this.db.withTenant(this.ctx(user), async (tx) => {
      const { rows } = await tx.execute<{ minute: number; jour: number }>(sql`
        SELECT count(*) FILTER (WHERE created_at > now() - interval '1 minute')::int AS minute,
               count(*) FILTER (WHERE created_at > now() - interval '1 day')::int AS jour
          FROM whatsapp_verifications WHERE user_id = ${user.userId}`);
      if ((rows[0]?.minute ?? 0) > 0) {
        problem(
          429,
          'notifications.code_trop_tot',
          'Un code vient de partir : attendez une minute',
        );
      }
      if ((rows[0]?.jour ?? 0) >= CODES_PAR_JOUR) {
        problem(429, 'notifications.codes_epuises', 'Trop de codes aujourd’hui : réessayez demain');
      }
      // Un seul code vaut à la fois : le nouveau remplace les précédents.
      await tx.execute(sql`
        UPDATE whatsapp_verifications SET expire_le = now(), code_chiffre = NULL
         WHERE user_id = ${user.userId} AND utilisee_le IS NULL AND expire_le > now()`);
      const id = uuidv7();
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      await tx.execute(sql`
        INSERT INTO whatsapp_verifications
          (id, tenant_id, user_id, numero_chiffre, numero_masque, code_hash, code_chiffre, expire_le)
        VALUES (${id}, ${user.tenantId}, ${user.userId},
                ${this.enc.chiffrerTexte(e164, contexteDeLaVerification(user.tenantId, id, 'numero'), 'dossiers')},
                ${numeroMasque(e164)}, ${hacher(id, code)},
                ${this.enc.chiffrerTexte(code, contexteDeLaVerification(user.tenantId, id, 'code'), 'dossiers')},
                now() + make_interval(mins => ${CODE_TTL_MINUTES}))`);
      await this.whatsapp.mettreCodeEnFile(tx, user.tenantId, id, user.userId);
    });
    this.whatsapp.bientot();
    return this.lire(user);
  }

  /** Le bon code : le numéro devient celui de la personne. */
  async verifierCode(user: SessionUser, code: string): Promise<ReglagesNotifications> {
    // L'essai compte, juste ou faux : il s'écrit avant de comparer.
    const essai = await this.db.withTenant(this.ctx(user), async (tx) => {
      const { rows } = await tx.execute<{
        id: string;
        code_hash: string;
        numero_chiffre: string;
        numero_masque: string;
        essais: number;
      }>(sql`
        UPDATE whatsapp_verifications SET essais = essais + 1
         WHERE id = (SELECT id FROM whatsapp_verifications
                      WHERE user_id = ${user.userId} AND utilisee_le IS NULL AND expire_le > now()
                      ORDER BY created_at DESC LIMIT 1)
           AND essais < ${ESSAIS_CODE}
        RETURNING id, code_hash, numero_chiffre, numero_masque, essais`);
      return rows[0] ?? null;
    });
    if (!essai) {
      problem(
        422,
        'notifications.code_expire',
        'Ce code n’est plus valable : demandez-en un nouveau',
      );
    }
    const attendu = Buffer.from(essai.code_hash, 'hex');
    const donne = Buffer.from(hacher(essai.id, code), 'hex');
    if (attendu.length !== donne.length || !timingSafeEqual(attendu, donne)) {
      problem(
        422,
        'notifications.code_incorrect',
        essai.essais >= ESSAIS_CODE
          ? 'Code incorrect : demandez un nouveau code'
          : 'Code incorrect',
      );
    }
    await this.db.withTenant(this.ctx(user), async (tx) => {
      const e164 = this.enc.dechiffrerTexte(
        essai.numero_chiffre,
        contexteDeLaVerification(user.tenantId, essai.id, 'numero'),
        'dossiers',
      );
      await this.reglages(tx, user);
      await tx.execute(sql`
        UPDATE notification_reglages
           SET whatsapp_numero_chiffre = ${this.enc.chiffrerTexte(e164, contexteDuNumero(user.tenantId, user.userId), 'dossiers')},
               whatsapp_numero_masque = ${essai.numero_masque},
               whatsapp_verifie_le = now(), updated_at = now()
         WHERE user_id = ${user.userId}`);
      // La vérification a servi : elle ne garde plus rien qui la rejoue.
      await tx.execute(sql`
        DELETE FROM whatsapp_verifications WHERE user_id = ${user.userId}`);
    });
    return this.lire(user);
  }

  /** Retire le numéro : plus rien ne part sur WhatsApp, ce qui attendait non plus. */
  async retirerNumero(user: SessionUser): Promise<ReglagesNotifications> {
    await this.db.withTenant(this.ctx(user), async (tx) => {
      await tx.execute(sql`
        UPDATE notification_reglages
           SET whatsapp_numero_chiffre = NULL, whatsapp_numero_masque = NULL,
               whatsapp_verifie_le = NULL, updated_at = now()
         WHERE user_id = ${user.userId}`);
      await tx.execute(sql`
        UPDATE outbound_whatsapp SET status = 'cancelled'
         WHERE user_id = ${user.userId} AND status = 'pending'`);
      await tx.execute(sql`DELETE FROM whatsapp_verifications WHERE user_id = ${user.userId}`);
    });
    return this.lire(user);
  }
}
