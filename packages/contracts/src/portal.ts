import { z } from 'zod';

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
  /** Accorde l'accueil : « Apixien » ou « Apixienne ». Null = formulation neutre. */
  gender?: 'female' | 'male' | null;
  email?: string;
  role?: string;
}

/**
 * Volontairement permissif, à la différence de l'inscription.
 *
 * Ce champ porte DEUX choses selon le cas : le mot de passe qu'on se choisit
 * (compte à créer) ou celui d'un compte qui existe déjà, saisi pour le relier
 * au dossier. Appliquer la politique ici refuserait le second — un mot de
 * passe ancien n'a pas à satisfaire une règle adoptée depuis. La politique
 * s'applique donc côté serveur, sur la seule branche qui POSE un mot de
 * passe (cf. invitations.service.ts).
 */
export const acceptInvitationSchema = z.object({
  password: z.string().min(1).max(128),
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
  /**
   * Qui vise ses demandes de congé en premier : son n+1, s'il peut viser
   * (actif, avec un accès au portail). `null` : elles vont directement à la
   * RH.
   */
  valideurN1: string | null;
  /** Qui la traiterait ensuite pour la DCH (null : personne en ce moment). */
  valideurDCH: string | null;
  /** Il dirige la DCH : le visa de son N+1 (le DG) suffit. */
  demandeDuDirecteur: boolean;
}

export type PortalStatus = 'none' | 'invited' | 'active';
