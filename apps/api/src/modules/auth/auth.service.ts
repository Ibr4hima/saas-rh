import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { LoginInput, RegisterInput, SessionUser } from '@teranga/contracts';
import { loadEnv } from '../../config/env';
import { TenantDb } from '../../db/tenant-db';
import * as t from '../../db/schema';
import { problem } from '../../common/problem';
import { capacitesDe } from '../acces/dch';
import { accesDuCompte, dateLisible } from '../people/en-activite';

export interface IssuedSession {
  token: string;
  expiresAt: Date;
  user: SessionUser;
}

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

@Injectable()
export class AuthService {
  constructor(@Inject(TenantDb) private readonly db: TenantDb) {}

  /**
   * L'inscription publique crée une organisation : ouverte seulement sur une
   * base vide (la première organisation) ou si le serveur l'autorise.
   */
  async inscriptionOuverte(): Promise<boolean> {
    if (loadEnv().INSCRIPTION_OUVERTE) return true;
    const [compte] = await this.db.global.select({ id: t.users.id }).from(t.users).limit(1);
    return !compte;
  }

  async register(input: RegisterInput, meta: RequestMeta): Promise<IssuedSession> {
    // Deux premières inscriptions simultanées ne font pas deux organisations :
    // le verrou tient jusqu'à ce que la première soit écrite.
    return this.db.global.transaction(async (verrou) => {
      await verrou.execute(sql`SELECT pg_advisory_xact_lock(hashtext('inscription'))`);
      return this.inscrire(input, meta);
    });
  }

  private async inscrire(input: RegisterInput, meta: RequestMeta): Promise<IssuedSession> {
    if (!(await this.inscriptionOuverte())) {
      problem(
        403,
        'auth.inscription_fermee',
        'Les inscriptions sont fermées',
        'Un compte s’ouvre sur invitation de la Direction du Capital Humain.',
      );
    }
    const existing = await this.db.global
      .select({ id: t.users.id })
      .from(t.users)
      .where(sql`lower(${t.users.email}) = lower(${input.email})`)
      .limit(1);
    if (existing.length > 0) {
      problem(409, 'auth.email_taken', 'Un compte existe déjà avec cet email');
    }

    const tenantId = uuidv7();
    const userId = uuidv7();
    const passwordHash = await argonHash(input.password); // Argon2id par défaut
    const baseSlug = slugify(input.organizationName) || 'organisation';
    const slug = `${baseSlug}-${randomBytes(2).toString('hex')}`;

    await this.db.withTenant({ tenantId, userId }, async (tx) => {
      await tx.insert(t.users).values({
        id: userId,
        email: input.email,
        passwordHash,
        givenName: input.givenName,
        familyName: input.familyName,
      });
      await tx.insert(t.tenants).values({ id: tenantId, name: input.organizationName, slug });
      await tx.insert(t.userTenantMemberships).values({
        id: uuidv7(),
        tenantId,
        userId,
        role: 'admin',
      });
    });

    return this.issueSession(userId, tenantId, meta);
  }

  async login(input: LoginInput, meta: RequestMeta): Promise<IssuedSession> {
    const [user] = await this.db.global
      .select()
      .from(t.users)
      .where(sql`lower(${t.users.email}) = lower(${input.email})`)
      .limit(1);

    // Vérification systématique pour ne pas révéler l'existence du compte par le timing.
    // Un compte sans mot de passe (parti depuis plus de trente jours) ne
    // s'ouvre pas, et ne se distingue pas d'un compte inconnu.
    const validPassword = user?.passwordHash
      ? await argonVerify(user.passwordHash, input.password)
      : (await argonHash(input.password), false);
    if (!user || !validPassword || user.status !== 'active') {
      problem(401, 'auth.invalid_credentials', 'Email ou mot de passe incorrect');
    }

    const orgs = await this.db.withUser(user.id, (tx) =>
      tx
        .select({
          tenantId: t.userTenantMemberships.tenantId,
          slug: t.tenants.slug,
          accesCoupeLe: t.userTenantMemberships.accesCoupeLe,
        })
        .from(t.userTenantMemberships)
        .innerJoin(t.tenants, eq(t.tenants.id, t.userTenantMemberships.tenantId))
        .where(eq(t.userTenantMemberships.userId, user.id)),
    );

    if (orgs.length === 0) {
      problem(403, 'auth.no_membership', "Ce compte n'appartient à aucune organisation");
    }
    const selected = input.organizationSlug
      ? orgs.find((o) => o.slug === input.organizationSlug)
      : orgs.length === 1
        ? orgs[0]
        : undefined;
    if (!selected) {
      problem(
        409,
        'auth.organization_required',
        'Plusieurs organisations pour ce compte',
        `Préciser organizationSlug parmi : ${orgs.map((o) => o.slug).join(', ')}`,
      );
    }

    if (selected.accesCoupeLe) {
      problem(
        403,
        'auth.acces_coupe',
        'Votre accès est suspendu',
        'Votre accès au portail est suspendu : adressez-vous à la Direction du Capital Humain.',
      );
    }

    // La question se pose par tenant, pas globalement : le compte peut être
    // employé ailleurs, et la fin d'un contrat ici ne referme pas cette
    // porte-là. C'est aussi pourquoi on ne touche pas à `users.status`, qui,
    // lui, vaut pour toutes les organisations à la fois.
    const acces = await this.db.withTenant({ tenantId: selected.tenantId, userId: user.id }, (tx) =>
      accesDuCompte(tx, user.id),
    );
    if (acces.ferme && acces.finDAcces) {
      problem(
        403,
        'auth.employee_archived',
        'Votre accès a pris fin',
        // Le client affiche le DÉTAIL quand il existe : il doit donc se lire
        // seul, sans le titre au-dessus.
        `Votre accès au portail a pris fin le ${dateLisible(acces.finDAcces)}. Il sera rouvert à la signature d’un nouveau contrat.`,
      );
    }

    return this.issueSession(user.id, selected.tenantId, meta);
  }

  async logout(token: string): Promise<void> {
    await this.db.global
      .update(t.sessions)
      .set({ revokedAt: new Date() })
      .where(eq(t.sessions.tokenHash, hashToken(token)));
  }

  /**
   * Toutes les sessions d'un compte se ferment : chaque appareil devra se
   * reconnecter. Dans une organisation seulement, quand on la précise.
   * La coupure d'un accès s'en sert ; on ne le déclenche plus soi-même
   * (ADR-0047).
   */
  async deconnecterPartout(userId: string, tenantId?: string): Promise<void> {
    await this.db.global
      .update(t.sessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(t.sessions.userId, userId),
          isNull(t.sessions.revokedAt),
          tenantId ? eq(t.sessions.tenantId, tenantId) : undefined,
        ),
      );
  }

  /**
   * Résout une session active et reconstruit le SessionUser courant.
   *
   * Une session vit tant qu'on s'en sert : trois jours sans activité la
   * ferment (SESSION_INACTIVITE_HEURES), et elle ne dépasse jamais sa durée
   * maximale (`expires_at`). `activite` : la requête est un geste de
   * l'agent, qui la prolonge ; un relevé automatique de la page ne la
   * prolonge pas.
   */
  async resolveSession(token: string, o: { activite?: boolean } = {}): Promise<SessionUser | null> {
    const maintenant = new Date();
    const inactiveDepuis = new Date(
      maintenant.getTime() - loadEnv().SESSION_INACTIVITE_HEURES * 3600_000,
    );
    const [session] = await this.db.global
      .select()
      .from(t.sessions)
      .where(
        and(
          eq(t.sessions.tokenHash, hashToken(token)),
          isNull(t.sessions.revokedAt),
          gt(t.sessions.expiresAt, maintenant),
          gt(t.sessions.lastSeenAt, inactiveDepuis),
        ),
      )
      .limit(1);
    if (!session) return null;
    // Au plus une écriture par minute : un geste suffit à prolonger.
    if (o.activite && maintenant.getTime() - session.lastSeenAt.getTime() > 60_000) {
      await this.db.global
        .update(t.sessions)
        .set({ lastSeenAt: maintenant })
        .where(eq(t.sessions.id, session.id));
    }

    return this.db.withTenant(
      { tenantId: session.tenantId, userId: session.userId },
      async (tx) => {
        const [row] = await tx
          .select({
            email: t.users.email,
            givenName: t.users.givenName,
            familyName: t.users.familyName,
            organizationName: t.tenants.name,
            organizationSlug: t.tenants.slug,
            role: t.userTenantMemberships.role,
            accesCoupeLe: t.userTenantMemberships.accesCoupeLe,
          })
          .from(t.userTenantMemberships)
          .innerJoin(t.tenants, eq(t.tenants.id, t.userTenantMemberships.tenantId))
          .innerJoin(t.users, eq(t.users.id, t.userTenantMemberships.userId))
          .where(
            and(
              eq(t.userTenantMemberships.userId, session.userId),
              eq(t.userTenantMemberships.tenantId, session.tenantId),
            ),
          )
          .limit(1);
        // Un accès coupé ferme aussi les sessions qui auraient survécu.
        if (!row || row.accesCoupeLe) return null;
        // Plus en activité : le portail reste ouvert, restreint, un mois
        // après son dernier jour ; ce délai passé, le cookie encore valide
        // n'ouvre plus rien. C'est ici que la porte se referme.
        const { finDAcces, ferme } = await accesDuCompte(tx, session.userId);
        if (ferme) return null;
        const [personne] = await tx
          .select({ gender: t.persons.gender })
          .from(t.persons)
          .where(and(eq(t.persons.userId, session.userId), isNull(t.persons.deletedAt)))
          .limit(1);
        // Pendant ce mois, il n'est plus agent de l'APIX : aucune
        // habilitation, même si la liste ne l'a pas encore rangé.
        const { capacites, estAgent, dirigeLaDCH, estDG } = finDAcces
          ? { capacites: [], estAgent: false, dirigeLaDCH: false, estDG: false }
          : await capacitesDe(tx, session.userId, row.role);
        return {
          userId: session.userId,
          tenantId: session.tenantId,
          email: row.email,
          givenName: row.givenName,
          familyName: row.familyName,
          organizationName: row.organizationName,
          organizationSlug: row.organizationSlug,
          // Plus en activité, il n'est plus que l'agent qui s'en va : le rôle
          // d'administrateur ne lui donne plus rien pendant ce mois-là.
          role: (finDAcces ? 'employee' : row.role) as SessionUser['role'],
          capacites,
          estAgent,
          dirigeLaDCH,
          estDG,
          finDAcces,
          gender:
            personne?.gender === 'female' || personne?.gender === 'male' ? personne.gender : null,
        };
      },
    );
  }

  async issueSession(userId: string, tenantId: string, meta: RequestMeta): Promise<IssuedSession> {
    const env = loadEnv();
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + env.SESSION_DUREE_MAX_JOURS * 24 * 3600 * 1000);

    await this.db.global.insert(t.sessions).values({
      id: uuidv7(),
      userId,
      tenantId,
      tokenHash: hashToken(token),
      ip: meta.ip,
      userAgent: meta.userAgent?.slice(0, 512),
      expiresAt,
    });

    const user = await this.resolveSession(token);
    if (!user) {
      problem(500, 'auth.session_resolution_failed', 'Session créée mais irrésolvable');
    }
    return { token, expiresAt, user };
  }
}
