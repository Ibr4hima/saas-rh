import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type {
  AcceptResult,
  InvitationInfo,
  InvitableRole,
  InviteResult,
  SessionUser,
} from '@teranga/contracts';
import { problem } from '../../common/problem';
import * as t from '../../db/schema';
import { TenantDb } from '../../db/tenant-db';
import { AuthService, IssuedSession } from '../auth/auth.service';

const INVITATION_TTL_DAYS = 7;

function pgCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code ?? e?.cause?.code;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class InvitationsService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  /** Génère un lien d'invitation pour l'employé (compte relié à son dossier). */
  async invite(
    user: SessionUser,
    employeeId: string,
    role: InvitableRole,
    emailOverride?: string,
  ): Promise<InviteResult> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 3600 * 1000);
    let email = emailOverride ?? '';

    await this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      const [row] = await tx
        .select({
          personId: t.employees.personId,
          personUserId: t.persons.userId,
          status: t.employees.status,
          workEmail: t.employees.workEmail,
          personalEmail: t.persons.personalEmail,
        })
        .from(t.employees)
        .innerJoin(t.persons, eq(t.persons.id, t.employees.personId))
        .where(eq(t.employees.id, employeeId))
        .limit(1)
        .for('update');
      if (!row) {
        problem(404, 'people.employee_not_found', 'Employé introuvable');
      }
      if (row.personUserId) {
        problem(409, 'portal.already_active', 'Cet employé a déjà un accès au portail');
      }
      // Ouvrir un portail à un dossier archivé donnerait un accès que la
      // première requête refuserait : l'invitation partirait pour rien, et
      // l'agent buterait sur une porte fermée après avoir choisi son mot de
      // passe.
      if (row.status !== 'active') {
        problem(
          422,
          'portal.employee_archived',
          'Ce dossier est archivé',
          'Ce dossier est archivé : réactivez-le avant d’ouvrir un accès au portail.',
        );
      }
      email = emailOverride ?? row.workEmail ?? row.personalEmail ?? '';
      if (!email) {
        problem(
          422,
          'portal.email_required',
          'Aucun email dans le dossier',
          "Renseignez un email professionnel ou personnel sur la fiche, ou fournissez-en un avec l'invitation.",
        );
      }

      // Une seule invitation active par personne : on expire les précédentes.
      await tx
        .update(t.invitations)
        .set({ expiresAt: new Date() })
        .where(and(eq(t.invitations.personId, row.personId), isNull(t.invitations.acceptedAt)));

      await tx.insert(t.invitations).values({
        id: uuidv7(),
        tenantId: user.tenantId,
        personId: row.personId,
        email,
        role,
        tokenHash: hashToken(token),
        invitedByUserId: user.userId,
        expiresAt,
      });
    });

    return {
      invitePath: `/invitation/${token}`,
      email,
      role,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /** Page publique : renseigne l'écran d'acceptation sans révéler autre chose. */
  async info(token: string): Promise<InvitationInfo> {
    return this.db.withInvitationToken(hashToken(token), async (tx) => {
      const [row] = await tx
        .select({
          invitation: t.invitations,
          organizationName: t.tenants.name,
          givenName: t.persons.givenName,
          familyName: t.persons.familyName,
        })
        .from(t.invitations)
        .innerJoin(t.tenants, eq(t.tenants.id, t.invitations.tenantId))
        .innerJoin(t.persons, eq(t.persons.id, t.invitations.personId))
        .limit(1);
      if (!row) return { valid: false, reason: 'not_found' };
      if (row.invitation.acceptedAt) return { valid: false, reason: 'used' };
      if (row.invitation.expiresAt < new Date()) return { valid: false, reason: 'expired' };
      return {
        valid: true,
        organizationName: row.organizationName,
        givenName: row.givenName,
        familyName: row.familyName,
        email: row.invitation.email,
        role: row.invitation.role,
      };
    });
  }

  /**
   * Acceptation : crée le compte (ou rattache un compte existant), le relie au
   * dossier (persons.user_id) et crée l'appartenance avec le rôle invité.
   */
  async accept(
    token: string,
    password: string,
    meta: { ip?: string; userAgent?: string },
  ): Promise<{ result: AcceptResult; session?: IssuedSession }> {
    const tokenHash = hashToken(token);
    // Argon2id AVANT la transaction : pas de travail long sous verrou.
    const passwordHash = await argonHash(password);

    const outcome = await this.db
      .withInvitationToken(tokenHash, async (tx) => {
        const [invitation] = await tx.select().from(t.invitations).limit(1);
        if (!invitation || invitation.expiresAt < new Date()) {
          problem(410, 'portal.invitation_invalid', "Cette invitation n'est plus valable");
        }

        // Le tenant est maintenant connu et prouvé par le token : on le pose
        // dans la transaction pour que les triggers d'audit puissent écrire
        // (leur policy exige app.tenant_id) et que les écritures suivantes
        // passent par les policies standard du tenant.
        await tx.execute(sql`SELECT set_config('app.tenant_id', ${invitation.tenantId}, true)`);

        // Anti double-emploi : le premier UPDATE gagne, les suivants échouent.
        const marked = await tx
          .update(t.invitations)
          .set({ acceptedAt: new Date() })
          .where(and(eq(t.invitations.id, invitation.id), isNull(t.invitations.acceptedAt)))
          .returning({ id: t.invitations.id });
        if (marked.length === 0) {
          problem(410, 'portal.invitation_used', 'Cette invitation a déjà été utilisée');
        }

        const [existing] = await tx
          .select()
          .from(t.users)
          .where(sql`lower(${t.users.email}) = lower(${invitation.email})`)
          .limit(1);

        let userId: string;
        if (existing) {
          // Preuve de possession : relier un compte EXISTANT à un dossier exige
          // le mot de passe de CE compte — un email saisi par l'invitant ne
          // suffit jamais à rattacher le compte d'un tiers.
          const owned = await argonVerify(existing.passwordHash, password);
          if (!owned || existing.status !== 'active') {
            problem(
              401,
              'portal.existing_account',
              'Un compte existe déjà avec cet email',
              'Saisissez le mot de passe de ce compte pour le relier à ce dossier.',
            );
          }
          userId = existing.id;
        } else {
          userId = uuidv7();
        }
        await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);

        if (!existing) {
          const [person] = await tx
            .select({ givenName: t.persons.givenName, familyName: t.persons.familyName })
            .from(t.persons)
            .where(eq(t.persons.id, invitation.personId))
            .limit(1);
          await tx.insert(t.users).values({
            id: userId,
            email: invitation.email,
            passwordHash,
            givenName: person?.givenName ?? '',
            familyName: person?.familyName ?? '',
          });
        }

        // Appartenance : jamais de changement de rôle silencieux. Si le compte
        // est déjà membre de l'organisation, son rôle actuel prévaut — une
        // invitation ne rétrograde ni n'élève un membre existant.
        const [member] = await tx
          .select({ id: t.userTenantMemberships.id })
          .from(t.userTenantMemberships)
          .where(
            and(
              eq(t.userTenantMemberships.tenantId, invitation.tenantId),
              eq(t.userTenantMemberships.userId, userId),
            ),
          )
          .limit(1);
        if (!member) {
          await tx.insert(t.userTenantMemberships).values({
            id: uuidv7(),
            tenantId: invitation.tenantId,
            userId,
            role: invitation.role,
          });
        }

        // Liaison conditionnelle : si la personne a été reliée entre-temps
        // (course invite/accept), on refuse au lieu d'écraser.
        const linked = await tx
          .update(t.persons)
          .set({ userId })
          .where(and(eq(t.persons.id, invitation.personId), isNull(t.persons.userId)))
          .returning({ id: t.persons.id });
        if (linked.length === 0) {
          problem(409, 'portal.already_active', 'Ce dossier est déjà relié à un compte');
        }

        return { existingUser: Boolean(existing), userId, tenantId: invitation.tenantId };
      })
      .catch((err: unknown) => {
        if (pgCode(err) === '23505') {
          problem(
            409,
            'portal.email_conflict',
            'Un compte vient d’être créé avec cet email',
            'Réessayez : si ce compte est le vôtre, son mot de passe sera demandé.',
          );
        }
        throw err;
      });

    // Possession prouvée dans les deux cas (compte créé, ou mot de passe du
    // compte existant vérifié) : la session est émise directement.
    const session = await this.auth.issueSession(outcome.userId, outcome.tenantId, meta);
    return { result: { existingUser: outcome.existingUser }, session };
  }
}
