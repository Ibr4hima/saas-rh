import { z } from 'zod';
import { passwordSchema } from './index';

/** Contrats du portail employé : invitations et espace personnel. */

/** Rôles attribuables par invitation — jamais admin par ce canal. */
export const invitableRoleSchema = z.enum(['hr', 'payroll', 'manager', 'employee']);
export type InvitableRole = z.infer<typeof invitableRoleSchema>;

export const inviteEmployeeSchema = z.object({
  role: invitableRoleSchema.default('employee'),
  /** Par défaut : email professionnel, sinon personnel, du dossier. */
  email: z.email().optional(),
});
export type InviteEmployeeInput = z.infer<typeof inviteEmployeeSchema>;

export interface InviteResult {
  /** Chemin relatif de la page d'acceptation (le front préfixe l'origine). */
  invitePath: string;
  email: string;
  role: InvitableRole;
  expiresAt: string;
}

export interface InvitationInfo {
  valid: boolean;
  /** Renseigné quand valid=false : expired | used | not_found */
  reason?: 'expired' | 'used' | 'not_found';
  organizationName?: string;
  givenName?: string;
  familyName?: string;
  email?: string;
  role?: string;
}

export const acceptInvitationSchema = z.object({
  password: passwordSchema,
});
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

export interface AcceptResult {
  /** true : un compte existait déjà pour cet email — se connecter avec son mot de passe. */
  existingUser: boolean;
}

export interface MyEmployeeView {
  employeeId: string;
  employeeNumber: string;
  givenName: string;
  familyName: string;
  hiredOn: string;
  status: string;
  workEmail: string | null;
  positionTitle: string | null;
  orgUnitName: string | null;
}

export type PortalStatus = 'none' | 'invited' | 'active';
