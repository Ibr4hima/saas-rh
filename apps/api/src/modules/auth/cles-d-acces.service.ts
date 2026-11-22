import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import {
  ALGORITHMES_DES_CLES,
  DELAI_DE_LA_CLE_MS,
  type OptionsDeConnexion,
  type OptionsDeCreation,
  type ReponseDeConnexion,
  type ReponseDeCreation,
  type SessionUser,
} from '@teranga/contracts';
import { EncryptionService } from '../../common/encryption.service';
import { problem } from '../../common/problem';
import { loadEnv } from '../../config/env';
import * as t from '../../db/schema';
import { TenantDb } from '../../db/tenant-db';
import { hashToken } from '../portal/invitation';
import { AuthService, type IssuedSession, type RequestMeta } from './auth.service';
import { ConnexionParCodeService } from './connexion-par-code.service';
import { CleRefusee, verifierLaConnexion, verifierLaCreation } from './webauthn';

/* ────────────────────────────────────────────────────────────────
   Les clés d'accès (ADR-0247).

   Après le premier code reçu par email, la personne crée une clé sur son
   appareil : Face ID, Touch ID, son empreinte, le code de l'appareil. Les
   fois suivantes, la clé ouvre la session, sans code. La clé privée ne
   quitte jamais l'appareil ; le serveur garde la clé publique, qui ne sert
   qu'à vérifier une signature.

   Chaque création, chaque connexion répond à un défi tiré au hasard, gardé
   cinq minutes derrière un cookie et pris une seule fois : une réponse
   rejouée ne trouve plus son défi. L'appareil doit avoir reconnu la
   personne (biométrie ou code), pas seulement constaté sa présence.

   Une clé ouvre la session de la première organisation où le compte se
   connecte encore, comme le code ; un compte inactif, coupé ou fermé ne
   s'ouvre pas, clé ou non.
   ──────────────────────────────────────────────────────────────── */

/** Le défi d'une demande vit cinq minutes : le temps de répondre à son appareil. */
export const DEFI_MINUTES = 5;

/** Les options données à l'appareil, et le jeton du cookie qui garde leur défi. */
export interface Defi<O> {
  jeton: string;
  expiresAt: Date;
  options: O;
}

type Usage = 'creation' | 'connexion';

const demandeExpiree = (): never =>
  problem(410, 'auth.cle_expiree', 'La demande a expiré. Recommencez.');
const cleRefusee = (): never =>
  problem(401, 'auth.cle_refusee', 'Clé d’accès refusée. Réessayez, ou recevez un code par email.');
const cleInconnue = (): never =>
  problem(
    401,
    'auth.cle_inconnue',
    'Cette clé d’accès n’est plus reconnue. Recevez un code par email pour vous connecter.',
  );

@Injectable()
export class ClesDAccesService {
  private readonly logger = new Logger('Clés d’accès');

  /** Le site des clés : le domaine (RP ID) et l'origine de l'application web. */
  site: () => { rpId: string; origines: string[] } = () => {
    const url = new URL(loadEnv().PUBLIC_WEB_URL);
    return { rpId: url.hostname, origines: [url.origin] };
  };

  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(EncryptionService) private readonly enc: EncryptionService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ConnexionParCodeService) private readonly comptes: ConnexionParCodeService,
  ) {}

  /**
   * L'identifiant du compte que l'appareil garde avec la clé : opaque, il ne
   * dit rien de la personne, et le même pour toutes ses clés.
   */
  poignee(userId: string): string {
    return this.enc.indexAveugle(userId, 'cles-d-acces:poignee').toString('base64url');
  }

  private async donnerUnDefi(usage: Usage, userId: string | null) {
    const jeton = randomBytes(32).toString('base64url');
    const defi = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + DEFI_MINUTES * 60_000);
    await this.db.global.transaction(async (tx) => {
      await tx.delete(t.defisDeCle).where(lt(t.defisDeCle.expiresAt, new Date()));
      await tx.insert(t.defisDeCle).values({
        id: uuidv7(),
        jetonHash: hashToken(jeton),
        defi,
        usage,
        userId,
        expiresAt,
      });
    });
    return { jeton, defi, expiresAt };
  }

  /** Le défi de ce navigateur, pris une fois pour toutes : une réponse rejouée ne le trouve plus. */
  private async prendreLeDefi(jeton: string | undefined, usage: Usage) {
    if (!jeton) return null;
    const [pris] = await this.db.global
      .delete(t.defisDeCle)
      .where(
        and(
          eq(t.defisDeCle.jetonHash, hashToken(jeton)),
          eq(t.defisDeCle.usage, usage),
          gt(t.defisDeCle.expiresAt, new Date()),
        ),
      )
      .returning({ defi: t.defisDeCle.defi, userId: t.defisDeCle.userId });
    return pris ?? null;
  }

  /** Les options de la création d'une clé, pour le compte de la session. */
  async optionsDeCreation(user: SessionUser): Promise<Defi<OptionsDeCreation>> {
    const { rpId } = this.site();
    // Une clé déjà sur cet appareil ne s'y crée pas deux fois.
    const cles = await this.db.global
      .select({ identifiant: t.clesDAcces.identifiant, transports: t.clesDAcces.transports })
      .from(t.clesDAcces)
      .where(eq(t.clesDAcces.userId, user.userId));
    const { jeton, defi, expiresAt } = await this.donnerUnDefi('creation', user.userId);
    return {
      jeton,
      expiresAt,
      options: {
        challenge: defi,
        rp: { id: rpId, name: user.organizationName },
        user: {
          id: this.poignee(user.userId),
          name: user.email,
          displayName: `${user.givenName} ${user.familyName}`.trim() || user.email,
        },
        pubKeyCredParams: ALGORITHMES_DES_CLES.map((alg) => ({ type: 'public-key', alg })),
        timeout: DELAI_DE_LA_CLE_MS,
        attestation: 'none',
        authenticatorSelection: {
          residentKey: 'required',
          requireResidentKey: true,
          userVerification: 'required',
        },
        excludeCredentials: cles.map((c) => ({
          type: 'public-key',
          id: c.identifiant,
          transports: c.transports,
        })),
      },
    };
  }

  /** La clé que l'appareil vient de créer, vérifiée, ajoutée au compte de la session. */
  async creer(
    jeton: string | undefined,
    user: SessionUser,
    reponse: ReponseDeCreation,
  ): Promise<void> {
    const pris = await this.prendreLeDefi(jeton, 'creation');
    if (!pris || pris.userId !== user.userId) return demandeExpiree();
    let cle: ReturnType<typeof verifierLaCreation>;
    try {
      cle = verifierLaCreation(reponse, { ...this.site(), defi: pris.defi });
    } catch (e) {
      if (!(e instanceof CleRefusee)) throw e;
      this.logger.warn(`Création refusée : ${e.message}`);
      return problem(400, 'auth.cle_refusee', 'La clé d’accès n’a pas pu être créée. Réessayez.');
    }
    const [ajoutee] = await this.db.global
      .insert(t.clesDAcces)
      .values({
        id: uuidv7(),
        userId: user.userId,
        identifiant: cle.identifiant,
        clePublique: cle.spki,
        algorithme: cle.algorithme,
        compteur: cle.compteur,
        transports: cle.transports,
        sauvegardee: cle.sauvegardee,
      })
      .onConflictDoNothing({ target: t.clesDAcces.identifiant })
      .returning({ id: t.clesDAcces.id });
    if (!ajoutee)
      problem(409, 'auth.cle_deja_enregistree', 'Cette clé d’accès est déjà enregistrée.');
  }

  /**
   * Les options d'une connexion : un défi, et aucune clé nommée. L'appareil
   * propose les clés qu'il garde pour ce site ; rien ne dit au navigateur
   * quels comptes existent.
   */
  async optionsDeConnexion(): Promise<Defi<OptionsDeConnexion>> {
    const { rpId } = this.site();
    const { jeton, defi, expiresAt } = await this.donnerUnDefi('connexion', null);
    return {
      jeton,
      expiresAt,
      options: {
        challenge: defi,
        rpId,
        timeout: DELAI_DE_LA_CLE_MS,
        userVerification: 'required',
        allowCredentials: [],
      },
    };
  }

  /** La clé présentée : vérifiée, elle ouvre la session de son compte. */
  async seConnecter(
    jeton: string | undefined,
    reponse: ReponseDeConnexion,
    meta: RequestMeta,
  ): Promise<IssuedSession> {
    const pris = await this.prendreLeDefi(jeton, 'connexion');
    if (!pris) return demandeExpiree();
    const identifiant = Buffer.from(reponse.rawId, 'base64url').toString('base64url');
    const [cle] = await this.db.global
      .select()
      .from(t.clesDAcces)
      .where(eq(t.clesDAcces.identifiant, identifiant))
      .limit(1);
    if (!cle) {
      this.logger.log('Connexion refusée : clé inconnue.');
      return cleInconnue();
    }
    // L'appareil rend le compte qu'il garde avec la clé : le même, ou rien.
    const poignee = reponse.response.userHandle;
    if (poignee && poignee !== this.poignee(cle.userId)) {
      this.logger.warn('Connexion refusée : la clé ne porte pas son compte.');
      return cleRefusee();
    }
    let suite: ReturnType<typeof verifierLaConnexion>;
    try {
      suite = verifierLaConnexion(
        reponse,
        { ...this.site(), defi: pris.defi },
        { spki: cle.clePublique, algorithme: cle.algorithme, compteur: cle.compteur },
      );
    } catch (e) {
      if (!(e instanceof CleRefusee)) throw e;
      this.logger.warn(`Connexion refusée : ${e.message}`);
      return cleRefusee();
    }
    // Le compteur ne recule jamais, même entre deux connexions simultanées.
    const [tenue] = await this.db.global
      .update(t.clesDAcces)
      .set({
        compteur: suite.compteur,
        sauvegardee: suite.sauvegardee,
        derniereUtilisation: new Date(),
      })
      .where(
        and(
          eq(t.clesDAcces.id, cle.id),
          suite.compteur > 0 ? lt(t.clesDAcces.compteur, suite.compteur) : sql`TRUE`,
        ),
      )
      .returning({ id: t.clesDAcces.id });
    if (!tenue) {
      this.logger.warn('Connexion refusée : compteur de signatures en arrière.');
      return cleRefusee();
    }
    const ouvert = await this.comptes.premierCompteOuvert(cle.userId);
    if (!ouvert) {
      return problem(
        403,
        'auth.acces_ferme',
        'Accès fermé',
        'Votre accès au portail est fermé : adressez-vous à la Direction du Capital Humain.',
      );
    }
    return this.auth.issueSession(cle.userId, ouvert.tenantId, meta);
  }
}
