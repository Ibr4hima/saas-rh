import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { hash as argonHash } from '@node-rs/argon2';
import { and, asc, eq, gt, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import {
  passwordDiffersFromEmail,
  passwordShortfall,
  type LienDeReinitialisation,
} from '@teranga/contracts';
import { problem } from '../../common/problem';
import { loadEnv } from '../../config/env';
import * as t from '../../db/schema';
import { TenantDb } from '../../db/tenant-db';
import { ExpediteurCourriels } from '../courriels/expediteur';
import { accesDuCompte } from '../people/en-activite';
import { hashToken } from '../portal/invitation';

/* ────────────────────────────────────────────────────────────────
   Mot de passe oublié.

   L'adresse du compte reçoit un lien, valable une heure, qui sert une fois.
   Le lien ne fait que REMPLACER un mot de passe : un compte qui n'en a plus
   (parti depuis plus de trente jours), dont l'accès est coupé ou fermé, ne
   reçoit rien. Celui-là revient par une invitation de la DCH.

   Rien ne dit, à qui demande, si l'adresse a un compte : la réponse est la
   même, et elle part avant que le travail ne commence (cf. le contrôleur).
   ──────────────────────────────────────────────────────────────── */

export const REINITIALISATION_TTL_MINUTES = 60;

const lienInvalide = (): never =>
  problem(410, 'auth.lien_invalide', 'Ce lien n’est plus valable', 'Demandez un nouveau lien.');

@Injectable()
export class ReinitialisationService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(ExpediteurCourriels)
    private readonly expediteur?: ExpediteurCourriels,
  ) {}

  /**
   * L'organisation où ce compte se connecte encore : la première dont
   * l'accès n'est ni coupé ni fermé. Aucune : le compte ne repart pas d'ici.
   */
  private async organisationOuverte(
    userId: string,
  ): Promise<{ tenantId: string; nom: string } | null> {
    const organisations = await this.db.withUser(userId, (tx) =>
      tx
        .select({
          tenantId: t.userTenantMemberships.tenantId,
          nom: t.tenants.name,
          accesCoupeLe: t.userTenantMemberships.accesCoupeLe,
        })
        .from(t.userTenantMemberships)
        .innerJoin(t.tenants, eq(t.tenants.id, t.userTenantMemberships.tenantId))
        .where(eq(t.userTenantMemberships.userId, userId))
        .orderBy(asc(t.userTenantMemberships.createdAt)),
    );
    for (const o of organisations) {
      if (o.accesCoupeLe) continue;
      const { ferme } = await this.db.withTenant({ tenantId: o.tenantId, userId }, (tx) =>
        accesDuCompte(tx, userId),
      );
      if (!ferme) return { tenantId: o.tenantId, nom: o.nom };
    }
    return null;
  }

  /**
   * Envoie un lien à l'adresse, si elle est celle d'un compte qui se
   * connecte encore. Sinon, rien : ni erreur, ni trace pour qui demande.
   */
  async demander(email: string): Promise<void> {
    const expediteur = this.expediteur;
    if (!expediteur?.actif) return;
    const [compte] = await this.db.global
      .select({
        id: t.users.id,
        email: t.users.email,
        givenName: t.users.givenName,
        passwordHash: t.users.passwordHash,
        status: t.users.status,
      })
      .from(t.users)
      .where(sql`lower(${t.users.email}) = lower(${email.trim()})`)
      .limit(1);
    if (!compte?.passwordHash || compte.status !== 'active') return;
    const organisation = await this.organisationOuverte(compte.id);
    if (!organisation) return;

    const token = randomBytes(32).toString('base64url');
    const id = uuidv7();
    const maintenant = new Date();
    await this.db.withTenant({ tenantId: organisation.tenantId, userId: compte.id }, async (tx) => {
      // Un seul lien à la fois : le dernier demandé. Le courriel d'un lien
      // remplacé, s'il attend encore, ne part plus.
      await tx
        .update(t.passwordResets)
        .set({ expiresAt: maintenant })
        .where(
          and(
            eq(t.passwordResets.userId, compte.id),
            isNull(t.passwordResets.usedAt),
            gt(t.passwordResets.expiresAt, maintenant),
          ),
        );
      // Les liens passés depuis un jour ne servent plus à rien.
      await tx
        .delete(t.passwordResets)
        .where(lt(t.passwordResets.expiresAt, new Date(maintenant.getTime() - 24 * 3600_000)));
      await tx.insert(t.passwordResets).values({
        id,
        userId: compte.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(maintenant.getTime() + REINITIALISATION_TTL_MINUTES * 60_000),
      });
      await expediteur.mettreEnFile(tx, {
        tenantId: organisation.tenantId,
        kind: 'reinitialisation',
        subjectId: id,
        to: compte.email,
        gabarit: {
          nom: 'reinitialisation',
          prenom: compte.givenName,
          organisation: organisation.nom,
          lien: `${loadEnv().PUBLIC_WEB_URL.replace(/\/$/, '')}/reinitialisation/${token}`,
        },
      });
    });
    expediteur.bientot();
  }

  /** Le lien et son compte, tant que le lien sert et que le compte se connecte encore. */
  private async valable(token: string) {
    const [lien] = await this.db.global
      .select({
        id: t.passwordResets.id,
        userId: t.passwordResets.userId,
        email: t.users.email,
        passwordHash: t.users.passwordHash,
        status: t.users.status,
      })
      .from(t.passwordResets)
      .innerJoin(t.users, eq(t.users.id, t.passwordResets.userId))
      .where(
        and(
          eq(t.passwordResets.tokenHash, hashToken(token)),
          isNull(t.passwordResets.usedAt),
          gt(t.passwordResets.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!lien?.passwordHash || lien.status !== 'active') return null;
    if (!(await this.organisationOuverte(lien.userId))) return null;
    return lien;
  }

  /** La page du lien : valable ou non, et l'adresse qu'il rouvre. */
  async lien(token: string): Promise<LienDeReinitialisation> {
    const lien = await this.valable(token);
    return lien ? { valide: true, email: lien.email } : { valide: false };
  }

  /**
   * Le nouveau mot de passe. Le lien sert une fois ; les autres liens du
   * compte tombent, et toutes ses sessions se ferment : qui avait le mot de
   * passe d'avant n'a plus rien d'ouvert.
   */
  async enregistrer(token: string, password: string): Promise<{ email: string }> {
    const lien = (await this.valable(token)) ?? lienInvalide();
    const manque = passwordShortfall(password);
    if (manque) problem(422, 'auth.weak_password', 'Mot de passe trop faible', manque);
    if (!passwordDiffersFromEmail(password, lien.email)) {
      problem(
        422,
        'auth.password_reprend_l_adresse',
        'Mot de passe trop proche de l’adresse',
        'Le mot de passe ne doit pas reprendre votre adresse email.',
      );
    }
    // Argon2id AVANT la transaction : pas de travail long sous verrou.
    const passwordHash = await argonHash(password);
    await this.db.global.transaction(async (tx) => {
      const maintenant = new Date();
      const pris = await tx
        .update(t.passwordResets)
        .set({ usedAt: maintenant })
        .where(
          and(
            eq(t.passwordResets.id, lien.id),
            isNull(t.passwordResets.usedAt),
            gt(t.passwordResets.expiresAt, maintenant),
          ),
        )
        .returning({ id: t.passwordResets.id });
      if (pris.length === 0) lienInvalide();
      // Un compte fermé entre-temps (mot de passe effacé) ne se rouvre pas ici.
      const change = await tx
        .update(t.users)
        .set({ passwordHash, updatedAt: maintenant })
        .where(
          and(
            eq(t.users.id, lien.userId),
            isNotNull(t.users.passwordHash),
            eq(t.users.status, 'active'),
          ),
        )
        .returning({ id: t.users.id });
      if (change.length === 0) lienInvalide();
      await tx
        .update(t.passwordResets)
        .set({ expiresAt: maintenant })
        .where(and(eq(t.passwordResets.userId, lien.userId), isNull(t.passwordResets.usedAt)));
      await tx
        .update(t.sessions)
        .set({ revokedAt: maintenant })
        .where(and(eq(t.sessions.userId, lien.userId), isNull(t.sessions.revokedAt)));
    });
    return { email: lien.email };
  }
}
