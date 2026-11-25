import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { and, asc, eq, gt, isNull, lt, ne, sql } from 'drizzle-orm';
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
import { ECHECS_DE_CODE_PAR_COUPLE, Limiteur } from '../../common/limiteur';
import { pourLeJournal, problem } from '../../common/problem';
import { loadEnv } from '../../config/env';
import * as t from '../../db/schema';
import { TenantDb } from '../../db/tenant-db';
import { directionDuPersonnel } from '../acces/dch';
import { ExpediteurCourriels } from '../courriels/expediteur';
import { directeurGeneral } from '../people/chaine';
import { accesDuCompte, enActivite } from '../people/en-activite';
import { compteALAdresse, hashToken } from '../portal/invitation';
import { reconcilierLeCircuit } from '../time/visas';
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
   quart d'heure, quarante-cinq secondes entre deux, douze par jour. Seuls
   comptent les codes qui n'ont pas servi : une connexion réussie remet le
   compteur à zéro, et se reconnecter aussitôt fait partir un nouveau code.
   Un code est lié à la personne, pas à la demande : des codes redemandés à
   sa place arrivent dans sa boîte et servent à sa propre connexion. Seul le
   dernier code envoyé vaut. Cinq essais par connexion en cours, comptés
   avant toute comparaison ; au-delà, on reprend depuis le début. Et dix
   codes faux par heure pour une même personne, toutes connexions
   confondues (ADR-0288).

   En campagne (ADR-0246), l'adresse se cherche aussi dans les dossiers :
   un agent en activité dont le dossier porte cette adresse professionnelle
   et ce nom reçoit son code à cette adresse, avec ou sans compte. Relié à
   un compte, le dossier doit porter l'adresse du compte (ADR-0288).
   Sans compte, le compte s'ouvre au premier code juste, relié au dossier,
   sans mot de passe. Un code qui ne part pas le dit dans le journal du
   serveur, sans l'adresse : jamais à l'écran.
   ──────────────────────────────────────────────────────────────── */

/** Une connexion en cours dure une heure : un courriel lent a le temps d'arriver. */
export const ATTENTE_MINUTES = 60;
export const ESSAIS_PAR_CONNEXION = 5;
export const ENVOIS_PAR_FENETRE = 3;
export const FENETRE_DES_ENVOIS_MINUTES = 15;
export const DELAI_ENTRE_ENVOIS_SECONDES = 45;
/** Les codes envoyés à une même personne sans servir, sur vingt-quatre heures (ADR-0288). */
export const CODES_PAR_JOUR = 12;

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

/**
 * En campagne, le dossier qu'un couple désigne : l'adresse professionnelle
 * qu'il porte, et le compte qui s'y relie, s'il y en a un.
 */
interface Dossier {
  tenantId: string;
  employeeId: string;
  userId: string | null;
  email: string;
  prenom: string;
  organisation: string;
  /** Les noms de famille qui le désignent : celui du dossier, celui du compte relié. */
  noms: string[];
}

/** À qui part le code : l'adresse, et de quoi composer le courriel. */
interface Destinataire {
  tenantId: string;
  /** `null` : pas encore de compte, il s'ouvrira au premier code juste. */
  userId: string | null;
  email: string;
  prenom: string;
  organisation: string;
}

type NouveauCode = { ok: true; id: string; code: string } | { ok: false; raison: InfoDuCode };

/** Le code d'erreur de Postgres, s'il y en a un. */
function pgCode(err: unknown): string | undefined {
  return (
    (err as { code?: string; cause?: { code?: string } } | null)?.code ??
    (err as { cause?: { code?: string } } | null)?.cause?.code
  );
}

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

  /** L'année de la campagne en cours, ou `null` : la plateforme complète (ADR-0211). */
  campagne: () => number | null = () => loadEnv().CAMPAGNE_D_EVALUATION;

  /** Ce qui empêche un code de partir, pour le journal du serveur : jamais l'adresse. */
  private pasEnvoye(raison: string): void {
    this.logger.log(`Code non envoyé : ${raison}`);
  }

  /** Les codes faux d'une personne, toutes connexions confondues (ADR-0288). */
  private readonly echecs: Limiteur;

  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(EncryptionService) private readonly enc: EncryptionService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ExpediteurCourriels) private readonly expediteur?: ExpediteurCourriels,
    @Optional() @Inject(Limiteur) limiteur?: Limiteur,
  ) {
    this.echecs = limiteur ?? new Limiteur(db);
  }

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
      // Le journal ne garde pas les valeurs de la requête : l'adresse en est une.
      enFond: this.rattacher(id, nom, email, code.ok ? code : null).catch((e: unknown) =>
        this.logger.error('Demande de code', pourLeJournal(e)),
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
      const { rows } = await tx.execute<{ n: number; jour: number; ecoule: number | null }>(sql`
        SELECT count(*) FILTER (
                 WHERE created_at > now() - make_interval(mins => ${FENETRE_DES_ENVOIS_MINUTES}::int)
               )::int AS n,
               count(*)::int AS jour,
               extract(epoch FROM now() - max(created_at))::float AS ecoule
          FROM codes_de_connexion
         WHERE compteur = ${compteur} AND used_at IS NULL
           AND created_at > now() - interval '24 hours'`);
      const { n, jour, ecoule } = rows[0]!;
      // Trois par quart d'heure, et douze par jour au plus : une boîte ne se
      // remplit pas de codes demandés à la place de la personne (ADR-0288).
      if (Number(n) >= ENVOIS_PAR_FENETRE || Number(jour) >= CODES_PAR_JOUR) {
        return { ok: false, raison: 'quota' };
      }
      if (ecoule !== null && Number(ecoule) < DELAI_ENTRE_ENVOIS_SECONDES) {
        return { ok: false, raison: 'trop_tot' };
      }
      // Seul le dernier code vaut : les précédents tombent. Ils comptent
      // toujours dans les plafonds d'envoi.
      await tx.execute(sql`
        UPDATE codes_de_connexion SET expires_at = now()
         WHERE compteur = ${compteur} AND used_at IS NULL AND expires_at > now()`);
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
   * Après la réponse : le compte que le couple désigne, ou en campagne son
   * dossier. Juste, la connexion en cours le retient et le code part ; faux,
   * rien ne se passe.
   */
  private async rattacher(
    attenteId: string,
    nom: string,
    email: string,
    envoi: { id: string; code: string } | null,
  ): Promise<void> {
    const compte = await this.compteDuCouple(nom, email);
    if (compte) {
      await this.db.global
        .update(t.connexionsEnAttente)
        .set({ userId: compte.userId, tenantId: compte.tenantId })
        .where(eq(t.connexionsEnAttente.id, attenteId));
      if (envoi) await this.envoyer(compte, envoi);
      return;
    }
    if (this.campagne() === null) return;
    const dossier = await this.dossierDuCouple(nom, email);
    if (!dossier) return;
    await this.db.global
      .update(t.connexionsEnAttente)
      .set({
        userId: dossier.userId,
        tenantId: dossier.tenantId,
        employeeId: dossier.employeeId,
      })
      .where(eq(t.connexionsEnAttente.id, attenteId));
    if (envoi) await this.envoyer(dossier, envoi);
  }

  /** Le compte à cette adresse, si le nom est le sien et qu'il se connecte encore. */
  private async compteDuCouple(nom: string, email: string): Promise<Compte | null> {
    const [utilisateur] = await this.db.global
      .select({ id: t.users.id })
      .from(t.users)
      .where(sql`lower(${t.users.email}) = ${email}`)
      .limit(1);
    if (!utilisateur) {
      // En campagne, le dossier prend le relais : il dira lui-même ce qui manque.
      if (this.campagne() === null) this.pasEnvoye('aucun compte à cette adresse.');
      return null;
    }
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
      if (compte.noms.some((n) => nomCompare(n) === nom)) return compte;
      if (this.campagne() === null) {
        this.pasEnvoye('le nom saisi n’est pas celui du compte de cette adresse.');
      }
      return null;
    }
    if (this.campagne() === null) {
      this.pasEnvoye('le compte de cette adresse ne se connecte plus (inactif, coupé ou fermé).');
    }
    return null;
  }

  /**
   * En campagne : le dossier en activité qui porte cette adresse
   * professionnelle et ce nom. Relié à un compte, ce compte doit se
   * connecter encore ; sans compte, l'adresse ne doit servir à aucun autre.
   */
  private async dossierDuCouple(nom: string, email: string): Promise<Dossier | null> {
    const { rows } = await this.db.global.execute<{ tenant_id: string; employee_id: string }>(
      sql`SELECT tenant_id, employee_id FROM dossiers_a_l_adresse(${email})`,
    );
    const actifs: Dossier[] = [];
    for (const r of rows) {
      const dossier = await this.dossier(r.tenant_id, r.employee_id);
      if (dossier) actifs.push(dossier);
    }
    const retenus = actifs.filter((d) => d.noms.some((n) => nomCompare(n) === nom));
    if (retenus.length !== 1) {
      this.pasEnvoye(
        actifs.length === 0
          ? 'aucun compte ni dossier en activité à cette adresse.'
          : retenus.length === 0
            ? 'le nom saisi n’est pas celui du dossier de cette adresse.'
            : 'plusieurs dossiers en activité portent cette adresse et ce nom.',
      );
      return null;
    }
    const dossier = retenus[0]!;
    if (dossier.userId) {
      const compte = await this.compteOuvert(dossier.userId, dossier.tenantId);
      if (!compte) {
        this.pasEnvoye('le compte relié au dossier ne se connecte plus (inactif, coupé ou fermé).');
        return null;
      }
      // L'adresse du dossier n'est pas celle du compte : elle se modifie
      // depuis la gestion du personnel, et le code ouvrirait le compte à qui
      // la change. Jamais pour un compte de direction ou d'administration,
      // ni vers l'adresse d'un autre compte (ADR-0288).
      if (compte.email.trim().toLowerCase() !== email) {
        if (await this.protege(dossier.tenantId, dossier.employeeId, dossier.userId)) {
          this.pasEnvoye('compte de direction ou d’administration : le code part à son adresse.');
          return null;
        }
        if (await this.adresseDUnAutreCompte(email, dossier.userId)) {
          this.pasEnvoye('l’adresse du dossier sert déjà à un autre compte.');
          return null;
        }
      }
      return { ...dossier, prenom: compte.prenom };
    }
    const [autre] = await this.db.global
      .select({ id: t.users.id })
      .from(t.users)
      .where(sql`lower(${t.users.email}) = ${email}`)
      .limit(1);
    if (autre) {
      this.pasEnvoye('l’adresse du dossier sert déjà à un autre compte.');
      return null;
    }
    return dossier;
  }

  /**
   * Un dossier de la direction (la personne qui dirige la DCH, le DG) ou
   * relié à un compte d'administration : comme son invitation, qui ne part
   * que de l'administration, son code ne part qu'à l'adresse du compte.
   */
  private async protege(tenantId: string, employeeId: string, userId: string): Promise<boolean> {
    return this.db.withTenant({ tenantId }, async (tx) => {
      if ((await directionDuPersonnel(tx))?.directeurEmployeeId === employeeId) return true;
      if ((await directeurGeneral(tx)) === employeeId) return true;
      const { rows } = await tx.execute<{ admin: boolean }>(sql`
        SELECT EXISTS (
          SELECT 1 FROM user_tenant_memberships
           WHERE user_id = ${userId} AND tenant_id = ${tenantId} AND role = 'admin') AS admin`);
      return Boolean(rows[0]?.admin);
    });
  }

  /** Vrai si l'adresse est celle d'un autre compte que `userId`. */
  private async adresseDUnAutreCompte(email: string, userId: string): Promise<boolean> {
    const [autre] = await this.db.global
      .select({ id: t.users.id })
      .from(t.users)
      .where(and(sql`lower(${t.users.email}) = ${email}`, ne(t.users.id, userId)))
      .limit(1);
    return Boolean(autre);
  }

  /** Un dossier de l'organisation, s'il est en activité : son adresse, ses noms, son compte. */
  private async dossier(tenantId: string, employeeId: string): Promise<Dossier | null> {
    const { rows } = await this.db.withTenant({ tenantId }, (tx) =>
      tx.execute<{
        user_id: string | null;
        prenom: string;
        nom: string;
        nom_du_compte: string | null;
        email: string | null;
        organisation: string;
        en_activite: boolean | null;
      }>(sql`
        SELECT p.user_id, p.given_name AS prenom, p.family_name AS nom,
               u.family_name AS nom_du_compte, e.work_email AS email, o.name AS organisation,
               ${enActivite(sql`e.id`)} AS en_activite
          FROM employees e
          JOIN persons p ON p.id = e.person_id AND p.deleted_at IS NULL
          JOIN tenants o ON o.id = e.tenant_id
          LEFT JOIN users u ON u.id = p.user_id
         WHERE e.id = ${employeeId}`),
    );
    const d = rows[0];
    if (!d?.en_activite || !d.email) return null;
    return {
      tenantId,
      employeeId,
      userId: d.user_id,
      email: d.email,
      prenom: d.prenom,
      organisation: d.organisation,
      noms: [d.nom, ...(d.nom_du_compte ? [d.nom_du_compte] : [])],
    };
  }

  /**
   * Le compte d'un dossier, ouvert au premier code juste : sans mot de
   * passe, aux noms du dossier, à son adresse professionnelle, relié au
   * dossier, comme une invitation acceptée. Un compte relié entre-temps
   * sert tel quel. `null` : le dossier n'est plus en activité, ou son
   * adresse sert déjà à un autre compte.
   */
  private async ouvrirLeCompte(tenantId: string, employeeId: string): Promise<string | null> {
    const userId = uuidv7();
    try {
      return await this.db.withTenant({ tenantId, userId }, async (tx) => {
        const { rows } = await tx.execute<{
          person_id: string;
          user_id: string | null;
          prenom: string;
          nom: string;
          email: string | null;
          en_activite: boolean | null;
        }>(sql`
          SELECT p.id AS person_id, p.user_id, p.given_name AS prenom, p.family_name AS nom,
                 e.work_email AS email, ${enActivite(sql`e.id`)} AS en_activite
            FROM employees e
            JOIN persons p ON p.id = e.person_id AND p.deleted_at IS NULL
           WHERE e.id = ${employeeId}
             FOR UPDATE OF p`);
        const d = rows[0];
        if (!d?.en_activite || !d.email) return null;
        if (d.user_id) return d.user_id;
        if (await compteALAdresse(tx, d.email)) return null;
        await tx.insert(t.users).values({
          id: userId,
          email: d.email,
          passwordHash: null,
          givenName: d.prenom,
          familyName: d.nom,
        });
        await tx.insert(t.userTenantMemberships).values({
          id: uuidv7(),
          tenantId,
          userId,
          role: 'employee',
        });
        await tx
          .update(t.persons)
          .set({ userId })
          .where(and(eq(t.persons.id, d.person_id), isNull(t.persons.userId)));
        // Ce que la DCH a délégué à l'agent l'attendait, comme à
        // l'acceptation d'une invitation.
        await reconcilierLeCircuit(tx, tenantId);
        return userId;
      });
    } catch (e) {
      // Un compte vient d'être créé à la même adresse : rien ne s'ouvre ici.
      if (pgCode(e) === '23505') return null;
      throw e;
    }
  }

  /** Où repart un code redemandé : là où est parti le premier. */
  private async destinataireDe(attente: {
    userId: string | null;
    tenantId: string | null;
    employeeId: string | null;
  }): Promise<Destinataire | null> {
    const { tenantId, userId, employeeId } = attente;
    if (!tenantId) return null;
    if (employeeId) {
      const dossier = await this.dossier(tenantId, employeeId);
      if (!dossier) return null;
      if (!dossier.userId) return dossier;
      return (await this.compteOuvert(dossier.userId, tenantId)) ? dossier : null;
    }
    return userId ? this.compteOuvert(userId, tenantId) : null;
  }

  /**
   * La première organisation où le compte se connecte encore : celle où
   * s'ouvre une session par clé d'accès (ADR-0247).
   */
  async premierCompteOuvert(userId: string): Promise<{ tenantId: string } | null> {
    const organisations = await this.db.withUser(userId, (tx) =>
      tx
        .select({ tenantId: t.userTenantMemberships.tenantId })
        .from(t.userTenantMemberships)
        .where(eq(t.userTenantMemberships.userId, userId))
        .orderBy(asc(t.userTenantMemberships.createdAt)),
    );
    for (const { tenantId } of organisations) {
      if (await this.compteOuvert(userId, tenantId)) return { tenantId };
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
  private async envoyer(a: Destinataire, envoi: { id: string; code: string }): Promise<void> {
    const expediteur = this.expediteur;
    if (!expediteur?.actif) {
      this.logger.warn('Code non envoyé : aucun serveur de courrier n’est configuré.');
      return;
    }
    await this.db.withTenant({ tenantId: a.tenantId, userId: a.userId ?? undefined }, (tx) =>
      expediteur.mettreEnFile(tx, {
        tenantId: a.tenantId,
        kind: 'code_connexion',
        subjectId: envoi.id,
        to: a.email,
        gabarit: {
          nom: 'code_connexion',
          prenom: a.prenom,
          organisation: a.organisation,
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
      const destinataire = await this.destinataireDe(attente);
      if (destinataire) await this.envoyer(destinataire, code);
    })().catch((e: unknown) => this.logger.error('Code redemandé', pourLeJournal(e)));
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
    // Trop de codes faux pour cette personne, toutes connexions confondues :
    // en ouvrir une autre ne rend pas d'essais (ADR-0288).
    if ((await this.echecs.consulter(ECHECS_DE_CODE_PAR_COUPLE, attente.compteur)).bloque) {
      codeBloque();
    }
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
    // L'essai se compte avant toute comparaison, en une seule écriture : de
    // dix saisies simultanées, cinq au plus sont comparées.
    const [compte] = await this.db.global
      .update(t.connexionsEnAttente)
      .set({ essais: sql`${t.connexionsEnAttente.essais} + 1` })
      .where(
        and(
          eq(t.connexionsEnAttente.id, attente.id),
          lt(t.connexionsEnAttente.essais, ESSAIS_PAR_CONNEXION),
        ),
      )
      .returning({ essais: t.connexionsEnAttente.essais });
    if (!compte) return codeBloque();
    const { essais } = compte;

    const propre = codeSaisi(saisie);
    const forme =
      propre.length === LONGUEUR_DU_CODE && [...propre].every((c) => ALPHABET_DU_CODE.includes(c));
    const empreinte = this.empreinte('code', attente.compteur, forme ? propre : '');
    // Chaque code valable est comparé, sans s'arrêter au premier : le temps
    // ne dit rien.
    let bon: string | null = null;
    for (const c of actifs) if (egales(empreinte, c.codeHash) && forme) bon = c.id;
    if (!bon || !attente.tenantId || (!attente.userId && !attente.employeeId)) {
      await this.echecs.compter(ECHECS_DE_CODE_PAR_COUPLE, attente.compteur);
      return essais >= ESSAIS_PAR_CONNEXION ? codeBloque() : codeIncorrect();
    }
    const codeId = bon;
    const { tenantId } = attente;

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
    await this.echecs.oublier(ECHECS_DE_CODE_PAR_COUPLE, attente.compteur);
    // En campagne, le dossier sans compte ouvre le sien.
    const userId =
      attente.userId ??
      (attente.employeeId ? await this.ouvrirLeCompte(tenantId, attente.employeeId) : null);
    // L'accès a pu être coupé depuis l'envoi du code.
    if (!userId || !(await this.compteOuvert(userId, tenantId))) {
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
