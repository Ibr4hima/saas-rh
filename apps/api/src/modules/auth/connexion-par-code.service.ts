import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import {
  ALPHABET_DU_CODE,
  DOMAINE_COURRIEL_PRO,
  LONGUEUR_DU_CODE,
  adresseProfessionnelle,
  codeSaisi,
  type AttenteDuCode,
  type DemandeDeCode,
  type EtatDeLAttente,
  type InfoDuCode,
} from '@teranga/contracts';
import { EncryptionService } from '../../common/encryption.service';
import { problem } from '../../common/problem';
import * as t from '../../db/schema';
import { TenantDb } from '../../db/tenant-db';
import { ExpediteurCourriels } from '../courriels/expediteur';
import { accesDuCompte } from '../people/en-activite';
import { hashToken } from '../portal/invitation';
import { AuthService, type IssuedSession, type RequestMeta } from './auth.service';

/* ────────────────────────────────────────────────────────────────
   La connexion par code (ADR-0204), sur le modèle du vote électronique.

   On donne son nom de famille et son adresse professionnelle. Si elles
   correspondent à un compte qui se connecte, un code de six caractères
   part à cette adresse ; saisi, il ouvre la session.

   Rien ne distingue, pour qui demande, un couple juste d'un faux : la
   réponse est la même et part tout de suite ; un code est créé dans tous
   les cas et ne part que si le couple est juste. Le compte se cherche
   après la réponse : le temps de réponse ne dit rien non plus.

   Chaque couple nom et adresse a son compteur d'envois : trois codes par
   quart d'heure, quarante-cinq secondes entre deux. Seuls comptent les
   codes qui n'ont pas servi : une connexion réussie remet le compteur à
   zéro, et se reconnecter aussitôt fait partir un nouveau code. Un code est
   lié à la personne, pas à la demande : des codes redemandés à sa place
   arrivent dans sa boîte et servent à sa propre connexion. Cinq essais par
   connexion en cours ; au-delà, on reprend depuis le début.
   ──────────────────────────────────────────────────────────────── */

/** Une connexion en cours dure une heure : un courriel lent a le temps d'arriver. */
export const ATTENTE_MINUTES = 60;
export const ESSAIS_PAR_CONNEXION = 5;
export const ENVOIS_PAR_FENETRE = 3;
export const FENETRE_DES_ENVOIS_MINUTES = 15;
export const DELAI_ENTRE_ENVOIS_SECONDES = 45;

/**
 * Le nom tel qu'il se compare : sans accent, en capitales, sans ce qui
 * sépare ses parties. « N'Diaye », « N DIAYE » et « Ndiaye » se valent,
 * « Touré » se saisit TOURE.
 */
export function nomCompare(nom: string): string {
  return nom
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z]+/g, '');
}

/** Une adresse à demi cachée, pour l'écran : « mo••••••@apix.sn ». */
export function masquerEmail(email: string): string {
  const [locale = '', domaine = ''] = email.split('@');
  return `${locale.slice(0, 2)}${'•'.repeat(Math.max(2, locale.length - 2))}@${domaine}`;
}

/** Le compte qu'ouvre un couple nom et adresse, et de quoi écrire à son adresse. */
interface Compte {
  userId: string;
  tenantId: string;
  email: string;
  prenom: string;
  organisation: string;
  /** Les noms de famille qui ouvrent ce compte : celui du compte, celui du dossier. */
  noms: string[];
}

type NouveauCode = { ok: true; id: string; code: string } | { ok: false; raison: InfoDuCode };

export interface Demande {
  jeton: string;
  expiresAt: Date;
  attente: AttenteDuCode;
  /** Ce qui suit la réponse : retrouver le compte, envoyer le code à son adresse. */
  enFond: Promise<void>;
}

const connexionExpiree = (): never =>
  problem(410, 'auth.connexion_expiree', 'Votre demande de code a expiré. Recommencez simplement.');
const codeIncorrect = (): never =>
  problem(400, 'auth.code_incorrect', 'Code incorrect. Vérifiez le code reçu par email.');
const codeExpire = (): never =>
  problem(
    400,
    'auth.code_expire',
    'Ce code a expiré ou a déjà été utilisé. Demandez un nouveau code.',
  );
const codeBloque = (): never =>
  problem(
    400,
    'auth.code_bloque',
    'Trop d’essais erronés. Reprenez la connexion depuis le début pour saisir votre code.',
  );

/** Deux empreintes, comparées sans que le temps ne dise où elles diffèrent. */
function egales(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}

@Injectable()
export class ConnexionParCodeService {
  private readonly logger = new Logger('Connexion par code');

  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(EncryptionService) private readonly enc: EncryptionService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ExpediteurCourriels) private readonly expediteur?: ExpediteurCourriels,
  ) {}

  /** L'empreinte d'un couple nom et adresse, ou d'un code : le clair n'est gardé nulle part. */
  private empreinte(usage: 'couple' | 'code', ...parties: string[]): string {
    return this.enc
      .indexAveugle(parties.join('\u001e'), `connexion-par-code:${usage}`)
      .toString('hex');
  }

  /**
   * La demande d'un code. `precedent` : le jeton d'une connexion en cours
   * dans ce navigateur, qui laisse sa place.
   */
  async demander(saisie: DemandeDeCode, precedent?: string): Promise<Demande> {
    const nom = nomCompare(saisie.nom);
    const email = adresseProfessionnelle(saisie.email);
    if (!nom || email === '') {
      problem(400, 'auth.champs_manquants', 'Merci de renseigner les deux champs.');
    }
    if (email === null) {
      problem(
        400,
        'auth.adresse_non_professionnelle',
        `Utilisez votre adresse professionnelle @${DOMAINE_COURRIEL_PRO}.`,
      );
    }
    const compteur = this.empreinte('couple', nom, email);
    const jeton = randomBytes(32).toString('base64url');
    const id = uuidv7();
    const expiresAt = new Date(Date.now() + ATTENTE_MINUTES * 60_000);
    await this.db.global.transaction(async (tx) => {
      if (precedent) {
        await tx
          .delete(t.connexionsEnAttente)
          .where(eq(t.connexionsEnAttente.jetonHash, hashToken(precedent)));
      }
      await tx.delete(t.connexionsEnAttente).where(lt(t.connexionsEnAttente.expiresAt, new Date()));
      await tx.insert(t.connexionsEnAttente).values({
        id,
        jetonHash: hashToken(jeton),
        compteur,
        emailMasque: masquerEmail(email),
        expiresAt,
      });
    });
    const code = await this.nouveauCode(compteur, expiresAt);
    return {
      jeton,
      expiresAt,
      attente: { email: masquerEmail(email), ...(code.ok ? {} : { info: code.raison }) },
      enFond: this.rattacher(id, nom, email, code.ok ? code : null).catch((e: Error) =>
        this.logger.error(`Demande de code : ${e.message}`),
      ),
    };
  }

  /**
   * Un nouveau code pour ce couple, valable jusqu'à `expiresAt` (la fin de
   * la connexion qui le demande), si le compteur d'envois le permet.
   */
  private async nouveauCode(compteur: string, expiresAt: Date): Promise<NouveauCode> {
    return this.db.global.transaction(async (tx) => {
      // Deux demandes simultanées pour le même couple ne passent pas toutes
      // deux sous la limite.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${compteur}))`);
      const { rows } = await tx.execute<{ n: number; ecoule: number | null }>(sql`
        SELECT count(*)::int AS n, extract(epoch FROM now() - max(created_at))::float AS ecoule
          FROM codes_de_connexion
         WHERE compteur = ${compteur} AND used_at IS NULL
           AND created_at > now() - make_interval(mins => ${FENETRE_DES_ENVOIS_MINUTES}::int)`);
      const { n, ecoule } = rows[0]!;
      if (Number(n) >= ENVOIS_PAR_FENETRE) return { ok: false, raison: 'quota' };
      if (ecoule !== null && Number(ecoule) < DELAI_ENTRE_ENVOIS_SECONDES) {
        return { ok: false, raison: 'trop_tot' };
      }
      const code = Array.from(
        { length: LONGUEUR_DU_CODE },
        () => ALPHABET_DU_CODE[randomInt(ALPHABET_DU_CODE.length)],
      ).join('');
      const id = uuidv7();
      await tx.insert(t.codesDeConnexion).values({
        id,
        compteur,
        codeHash: this.empreinte('code', compteur, code),
        expiresAt,
      });
      // Passé un jour, un code ne compte plus pour rien.
      await tx
        .delete(t.codesDeConnexion)
        .where(lt(t.codesDeConnexion.createdAt, new Date(Date.now() - 24 * 3600_000)));
      return { ok: true, id, code };
    });
  }

  /**
   * Après la réponse : le compte que le couple désigne. Juste, la connexion
   * en cours le retient et le code part ; faux, rien ne se passe.
   */
  private async rattacher(
    attenteId: string,
    nom: string,
    email: string,
    envoi: { id: string; code: string } | null,
  ): Promise<void> {
    const compte = await this.compteDuCouple(nom, email);
    if (!compte) return;
    await this.db.global
      .update(t.connexionsEnAttente)
      .set({ userId: compte.userId, tenantId: compte.tenantId })
      .where(eq(t.connexionsEnAttente.id, attenteId));
    if (envoi) await this.envoyer(compte, envoi);
  }

  /** Le compte à cette adresse, si le nom est le sien et qu'il se connecte encore. */
  private async compteDuCouple(nom: string, email: string): Promise<Compte | null> {
    const [utilisateur] = await this.db.global
      .select({ id: t.users.id })
      .from(t.users)
      .where(sql`lower(${t.users.email}) = ${email}`)
      .limit(1);
    if (!utilisateur) return null;
    const organisations = await this.db.withUser(utilisateur.id, (tx) =>
      tx
        .select({ tenantId: t.userTenantMemberships.tenantId })
        .from(t.userTenantMemberships)
        .where(eq(t.userTenantMemberships.userId, utilisateur.id))
        .orderBy(asc(t.userTenantMemberships.createdAt)),
    );
    // La première organisation où le compte se connecte encore, comme le
    // lien « mot de passe oublié ».
    for (const { tenantId } of organisations) {
      const compte = await this.compteOuvert(utilisateur.id, tenantId);
      if (!compte) continue;
      return compte.noms.some((n) => nomCompare(n) === nom) ? compte : null;
    }
    return null;
  }

  /**
   * Le compte, s'il se connecte encore à cette organisation : actif, accès
   * ni coupé ni fermé (un départ de plus de trente jours le ferme).
   */
  private async compteOuvert(userId: string, tenantId: string): Promise<Compte | null> {
    return this.db.withTenant({ tenantId, userId }, async (tx) => {
      const [ligne] = await tx
        .select({
          email: t.users.email,
          prenom: t.users.givenName,
          nomDuCompte: t.users.familyName,
          status: t.users.status,
          accesCoupeLe: t.userTenantMemberships.accesCoupeLe,
          organisation: t.tenants.name,
        })
        .from(t.userTenantMemberships)
        .innerJoin(t.users, eq(t.users.id, t.userTenantMemberships.userId))
        .innerJoin(t.tenants, eq(t.tenants.id, t.userTenantMemberships.tenantId))
        .where(
          and(
            eq(t.userTenantMemberships.userId, userId),
            eq(t.userTenantMemberships.tenantId, tenantId),
          ),
        )
        .limit(1);
      if (!ligne || ligne.status !== 'active' || ligne.accesCoupeLe) return null;
      if ((await accesDuCompte(tx, userId)).ferme) return null;
      const dossiers = await tx
        .select({ nom: t.persons.familyName })
        .from(t.persons)
        .where(and(eq(t.persons.userId, userId), isNull(t.persons.deletedAt)));
      return {
        userId,
        tenantId,
        email: ligne.email,
        prenom: ligne.prenom,
        organisation: ligne.organisation,
        noms: [ligne.nomDuCompte, ...dossiers.map((d) => d.nom)],
      };
    });
  }

  /** Le code part, en tête de la file des courriels. */
  private async envoyer(compte: Compte, envoi: { id: string; code: string }): Promise<void> {
    const expediteur = this.expediteur;
    if (!expediteur?.actif) return;
    await this.db.withTenant({ tenantId: compte.tenantId, userId: compte.userId }, (tx) =>
      expediteur.mettreEnFile(tx, {
        tenantId: compte.tenantId,
        kind: 'code_connexion',
        subjectId: envoi.id,
        to: compte.email,
        gabarit: {
          nom: 'code_connexion',
          prenom: compte.prenom,
          organisation: compte.organisation,
          code: envoi.code,
        },
      }),
    );
    expediteur.bientot();
  }

  /** La connexion en cours de ce navigateur, tant qu'elle dure. */
  private async attente(jeton: string | undefined) {
    if (!jeton) return null;
    const [attente] = await this.db.global
      .select()
      .from(t.connexionsEnAttente)
      .where(
        and(
          eq(t.connexionsEnAttente.jetonHash, hashToken(jeton)),
          gt(t.connexionsEnAttente.expiresAt, new Date()),
        ),
      )
      .limit(1);
    return attente ?? null;
  }

  /** L'écran du code, rechargé : l'adresse où le code est parti. */
  async etat(jeton: string | undefined): Promise<EtatDeLAttente> {
    const attente = await this.attente(jeton);
    return attente ? { enAttente: true, email: attente.emailMasque } : { enAttente: false };
  }

  /**
   * Un nouveau code, pour le même couple : un couple faux se comporte
   * exactement comme un juste, rien ne part.
   */
  async renvoyer(jeton: string | undefined): Promise<{ info: InfoDuCode; enFond: Promise<void> }> {
    const attente = (await this.attente(jeton)) ?? connexionExpiree();
    const code = await this.nouveauCode(attente.compteur, attente.expiresAt);
    if (!code.ok) return { info: code.raison, enFond: Promise.resolve() };
    const enFond = (async () => {
      if (!attente.userId || !attente.tenantId) return;
      const compte = await this.compteOuvert(attente.userId, attente.tenantId);
      if (compte) await this.envoyer(compte, code);
    })().catch((e: Error) => this.logger.error(`Code redemandé : ${e.message}`));
    return { info: 'renvoye', enFond };
  }

  /**
   * Le code saisi. Tout code encore valable de la personne convient ; l'un
   * d'eux sert, tous tombent, et la session s'ouvre.
   */
  async verifier(
    jeton: string | undefined,
    saisie: string,
    meta: RequestMeta,
  ): Promise<IssuedSession> {
    const attente = (await this.attente(jeton)) ?? connexionExpiree();
    if (attente.essais >= ESSAIS_PAR_CONNEXION) codeBloque();
    const maintenant = new Date();
    const actifs = await this.db.global
      .select({ id: t.codesDeConnexion.id, codeHash: t.codesDeConnexion.codeHash })
      .from(t.codesDeConnexion)
      .where(
        and(
          eq(t.codesDeConnexion.compteur, attente.compteur),
          isNull(t.codesDeConnexion.usedAt),
          gt(t.codesDeConnexion.expiresAt, maintenant),
        ),
      );
    if (actifs.length === 0) codeExpire();
    const [compte] = await this.db.global
      .update(t.connexionsEnAttente)
      .set({ essais: sql`${t.connexionsEnAttente.essais} + 1` })
      .where(eq(t.connexionsEnAttente.id, attente.id))
      .returning({ essais: t.connexionsEnAttente.essais });
    const essais = compte?.essais ?? ESSAIS_PAR_CONNEXION;

    const propre = codeSaisi(saisie);
    const forme =
      propre.length === LONGUEUR_DU_CODE && [...propre].every((c) => ALPHABET_DU_CODE.includes(c));
    const empreinte = this.empreinte('code', attente.compteur, forme ? propre : '');
    // Chaque code valable est comparé, sans s'arrêter au premier : le temps
    // ne dit rien.
    let bon: string | null = null;
    for (const c of actifs) if (egales(empreinte, c.codeHash) && forme) bon = c.id;
    if (!bon || !attente.userId || !attente.tenantId) {
      return essais >= ESSAIS_PAR_CONNEXION ? codeBloque() : codeIncorrect();
    }
    const codeId = bon;
    const { userId, tenantId } = attente;

    // Le code sert une fois : de deux saisies simultanées, la première l'emporte.
    const pris = await this.db.global.transaction(async (tx) => {
      const servi = await tx
        .update(t.codesDeConnexion)
        .set({ usedAt: maintenant })
        .where(
          and(
            eq(t.codesDeConnexion.id, codeId),
            isNull(t.codesDeConnexion.usedAt),
            gt(t.codesDeConnexion.expiresAt, maintenant),
          ),
        )
        .returning({ id: t.codesDeConnexion.id });
      if (servi.length === 0) return false;
      await tx
        .update(t.codesDeConnexion)
        .set({ usedAt: maintenant })
        .where(
          and(eq(t.codesDeConnexion.compteur, attente.compteur), isNull(t.codesDeConnexion.usedAt)),
        );
      await tx.delete(t.connexionsEnAttente).where(eq(t.connexionsEnAttente.id, attente.id));
      return true;
    });
    if (!pris) codeExpire();
    // L'accès a pu être coupé depuis l'envoi du code.
    if (!(await this.compteOuvert(userId, tenantId))) {
      problem(
        403,
        'auth.acces_ferme',
        'Accès fermé',
        'Votre accès au portail est fermé : adressez-vous à la Direction du Capital Humain.',
      );
    }
    return this.auth.issueSession(userId, tenantId, meta);
  }
}
