import { createHash, randomBytes } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { AccueilInvitation, InvitableRole, InviteResult } from '@teranga/contracts';
import { loadEnv } from '../../config/env';
import { problem } from '../../common/problem';
import * as t from '../../db/schema';
import type { Tx } from '../../db/tenant-db';
import type { ExpediteurCourriels } from '../courriels/expediteur';
import { finDeContratPassee } from '../people/en-activite';

/*
   Une invitation au portail, préparée dans la transaction de qui l'envoie :
   la fiche, un lot, un retour, ou la plateforme elle-même le jour où le
   contrat d'un agent commence. Sans service ni injection : le balayage des
   contrats s'en sert aussi.
*/

export const INVITATION_TTL_DAYS = 7;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Le compte qui répond à cette adresse, quel qu'il soit. */
export async function compteALAdresse(tx: Tx, email: string) {
  const [compte] = await tx
    .select({ id: t.users.id, passwordHash: t.users.passwordHash, status: t.users.status })
    .from(t.users)
    .where(sql`lower(${t.users.email}) = lower(${email})`)
    .limit(1);
  return compte ?? null;
}

/**
 * Qui l'invitation accueille : celui qui revient retrouve son compte
 * (`personUserId`, fermé) ; une adresse portée par un compte en service
 * demande son mot de passe ; sinon, un compte neuf.
 */
export async function accueilDe(
  tx: Tx,
  personUserId: string | null,
  email: string,
): Promise<AccueilInvitation> {
  if (personUserId) return 'retour';
  const compte = await compteALAdresse(tx, email);
  return compte?.passwordHash && compte.status === 'active' ? 'compte' : 'nouveau';
}

/**
 * Génère un lien d'invitation pour l'employé (compte relié à son dossier),
 * et le met en file pour partir par courriel quand un serveur de courrier
 * est configuré. Dans la transaction de l'appelant : à lui de réveiller
 * l'expéditeur (`bientot`) une fois validée. Le lien reste rendu : la DCH
 * peut toujours le transmettre elle-même.
 */
export async function preparerInvitation(
  tx: Tx,
  expediteur: ExpediteurCourriels | null | undefined,
  /** Qui l'envoie ; `userId` null : la plateforme, d'elle-même. */
  user: { tenantId: string; userId: string | null },
  employeeId: string,
  role: InvitableRole,
  emailOverride?: string,
): Promise<InviteResult> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 3600 * 1000);
  let email = emailOverride ?? '';
  let courriel = false;
  const [row] = await tx
    .select({
      personId: t.employees.personId,
      personUserId: t.persons.userId,
      givenName: t.persons.givenName,
      status: t.employees.status,
      workEmail: t.employees.workEmail,
    })
    .from(t.employees)
    .innerJoin(t.persons, eq(t.persons.id, t.employees.personId))
    .where(eq(t.employees.id, employeeId))
    .limit(1)
    .for('update');
  if (!row) {
    problem(404, 'people.employee_not_found', 'Employé introuvable');
  }
  // Un compte relié qui a encore son mot de passe : il a déjà son accès.
  // Sans mot de passe (parti depuis plus de trente jours), il revient
  // par une invitation, sur ce même compte.
  if (row.personUserId) {
    const [compte] = await tx
      .select({ passwordHash: t.users.passwordHash })
      .from(t.users)
      .where(eq(t.users.id, row.personUserId));
    if (compte?.passwordHash) {
      problem(409, 'portal.already_active', 'Cet employé a déjà un accès au portail');
    }
    const [membre] = await tx
      .select({ accesCoupeLe: t.userTenantMemberships.accesCoupeLe })
      .from(t.userTenantMemberships)
      .where(
        and(
          eq(t.userTenantMemberships.userId, row.personUserId),
          eq(t.userTenantMemberships.tenantId, user.tenantId),
        ),
      );
    if (membre?.accesCoupeLe) {
      problem(
        409,
        'portal.acces_coupe',
        'Son accès est coupé',
        'Rétablissez son accès avant de lui envoyer une invitation.',
      );
    }
  }
  // Ouvrir un portail à un dossier archivé donnerait un accès que la
  // première requête refuserait : l'invitation partirait pour rien, et
  // l'agent buterait sur une porte fermée après avoir choisi son mot de
  // passe.
  if (row.status !== 'active') {
    problem(
      422,
      'portal.employee_archived',
      'Ce dossier est inactif',
      'Un agent inactif n’a pas accès au portail : réactivez son dossier d’abord.',
    );
  }
  if (await finDeContratPassee(tx, employeeId)) {
    problem(
      422,
      'portal.contrat_echu',
      'Son contrat est arrivé à terme',
      'Un agent dont le contrat a pris fin n’a pas accès au portail : enregistrez d’abord son nouveau contrat.',
    );
  }
  // Le portail s'ouvre avec l'adresse professionnelle.
  email = emailOverride ?? row.workEmail ?? '';
  if (!email) {
    problem(
      422,
      'portal.email_required',
      'Aucune adresse professionnelle',
      'Renseignez son adresse professionnelle sur la fiche.',
    );
  }
  // Qui revient garde son compte : l'adresse ne peut pas être celle d'un
  // autre compte en service.
  if (row.personUserId) {
    const autre = await compteALAdresse(tx, email);
    if (autre && autre.id !== row.personUserId && autre.passwordHash) {
      problem(
        409,
        'portal.adresse_prise',
        'Cette adresse est celle d’un autre compte',
        'Changez l’adresse de sa fiche, puis envoyez l’invitation.',
      );
    }
  }
  const accueil = await accueilDe(tx, row.personUserId, email);

  // Une seule invitation active par personne : on expire les précédentes.
  await tx
    .update(t.invitations)
    .set({ expiresAt: new Date() })
    .where(and(eq(t.invitations.personId, row.personId), isNull(t.invitations.acceptedAt)));

  const invitationId = uuidv7();
  await tx.insert(t.invitations).values({
    id: invitationId,
    tenantId: user.tenantId,
    personId: row.personId,
    email,
    role,
    tokenHash: hashToken(token),
    invitedByUserId: user.userId,
    expiresAt,
  });

  if (expediteur?.actif) {
    const [organisation] = await tx
      .select({ name: t.tenants.name })
      .from(t.tenants)
      .where(eq(t.tenants.id, user.tenantId));
    courriel = await expediteur.mettreEnFile(tx, {
      gabarit: {
        nom: 'invitation',
        prenom: row.givenName,
        organisation: organisation?.name ?? 'Votre organisation',
        lien: `${loadEnv().PUBLIC_WEB_URL.replace(/\/$/, '')}/invitation/${token}`,
        expireLe: expiresAt.toISOString(),
        ...(accueil === 'nouveau' ? {} : { accueil }),
      },
      tenantId: user.tenantId,
      kind: 'invitation',
      subjectId: invitationId,
      to: email,
    });
  }
  return {
    invitePath: `/invitation/${token}`,
    email,
    role,
    expiresAt: expiresAt.toISOString(),
    courriel,
  };
}
