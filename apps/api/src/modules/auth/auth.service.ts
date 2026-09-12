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

  async register(input: RegisterInput, meta: RequestMeta): Promise<IssuedSession> {
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
    const validPassword = user
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

    if (await this.dossierArchive(user.id, selected.tenantId)) {
      problem(
        403,
        'auth.employee_archived',
        'Votre accès a été désactivé',
        // Le client affiche le DÉTAIL quand il existe : il doit donc se lire
        // seul, sans le titre au-dessus.
        'Votre accès a été désactivé. Le service des ressources humaines peut le rouvrir.',
      );
    }

    return this.issueSession(user.id, selected.tenantId, meta);
  }

  /**
   * Le dossier de cet agent est-il archivé DANS CETTE organisation ?
   *
   * La question se pose par tenant, pas globalement : le compte peut être
   * employé ailleurs, et la fin d'un contrat ici ne referme pas cette
   * porte-là. C'est aussi pourquoi on ne touche pas à `users.status`, qui,
   * lui, vaut pour toutes les organisations à la fois.
   */
  private async dossierArchive(userId: string, tenantId: string): Promise<boolean> {
    return this.db.withTenant({ tenantId, userId }, async (tx) => {
      const [row] = await tx
        .select({ status: t.employees.status })
        .from(t.employees)
        .innerJoin(t.persons, eq(t.persons.id, t.employees.personId))
        .where(eq(t.persons.userId, userId))
        .limit(1);
      return row?.status === 'archived';
    });
  }

  async logout(token: string): Promise<void> {
    await this.db.global
      .update(t.sessions)
      .set({ revokedAt: new Date() })
      .where(eq(t.sessions.tokenHash, hashToken(token)));
  }

  /** Résout une session active et reconstruit le SessionUser courant. */
  async resolveSession(token: string): Promise<SessionUser | null> {
    const [session] = await this.db.global
      .select()
      .from(t.sessions)
      .where(
        and(
          eq(t.sessions.tokenHash, hashToken(token)),
          isNull(t.sessions.revokedAt),
          gt(t.sessions.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!session) return null;

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
        if (!row) return null;
        // Un dossier archivé pendant que la session courait : le cookie est
        // encore valide, l'accès ne l'est plus. La révocation posée à
        // l'archivage suffirait, mais elle ne couvre pas les sessions ouvertes
        // ailleurs entre-temps ; c'est ici que la porte se referme vraiment.
        const [dossier] = await tx
          .select({ status: t.employees.status })
          .from(t.employees)
          .innerJoin(t.persons, eq(t.persons.id, t.employees.personId))
          .where(eq(t.persons.userId, session.userId))
          .limit(1);
        if (dossier?.status === 'archived') return null;
        return {
          userId: session.userId,
          tenantId: session.tenantId,
          email: row.email,
          givenName: row.givenName,
          familyName: row.familyName,
          organizationName: row.organizationName,
          organizationSlug: row.organizationSlug,
          role: row.role as SessionUser['role'],
        };
      },
    );
  }

  async issueSession(userId: string, tenantId: string, meta: RequestMeta): Promise<IssuedSession> {
    const env = loadEnv();
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 3600 * 1000);

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
