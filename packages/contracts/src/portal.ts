import { z } from 'zod';

/** Contrats du portail employé : invitations et espace personnel. */

/**
 * Tout le monde entre au portail comme AGENT : il n'y a plus de rôle à
 * choisir. Ce qu'on peut faire de plus vient de l'organigramme (cf. acces.ts).
 */
export const invitableRoleSchema = z.enum(['employee']);
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
  /** Le lien part aussi par courriel (un serveur de courrier est configuré). */
  courriel: boolean;
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
  /**
   * Qui ouvre le lien : `nouveau`, sans compte ; `retour`, parti depuis plus
   * de trente jours, il retrouve son compte avec un mot de passe neuf ;
   * `compte`, un compte en service existe à cette adresse : son mot de passe
   * le relie au dossier.
   */
  accueil?: AccueilInvitation;
}

export type AccueilInvitation = 'nouveau' | 'retour' | 'compte';

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
  /** Le titre d'identité de sa fiche — à déposer : sa CNI ou son passeport. */
  pieceDIdentite: 'cni' | 'passeport' | null;
}

export type PortalStatus = 'none' | 'invited' | 'active';

/** Inviter plusieurs agents d'un coup : après un import, depuis la gestion des accès. */
export const inviterPlusieursSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(1000),
});
export type InviterPlusieursInput = z.infer<typeof inviterPlusieursSchema>;

export interface InviterPlusieursResult {
  invites: { employeeId: string; nom: string; email: string }[];
  refus: { employeeId: string; nom: string; raison: string }[];
  /** Un serveur de courrier est configuré : les invitations partent par courriel. */
  parCourriel: boolean;
}

/**
 * Où en est l'accès d'un agent au portail.
 *   - `actif` : son compte fonctionne ;
 *   - `invite` : une invitation attend d'être acceptée ;
 *   - `expire` : la dernière invitation a expiré sans être acceptée ;
 *   - `jamais` : aucune invitation ;
 *   - `ferme` : parti plus de trente jours puis revenu, son compte attend
 *     une invitation ;
 *   - `coupe` : son accès est coupé.
 */
export type EtatAcces = 'actif' | 'invite' | 'expire' | 'jamais' | 'ferme' | 'coupe';

export interface AccesAgent {
  employeeId: string;
  nom: string;
  matricule: string;
  /** L'abrégé de sa direction (ou le nom de son unité). */
  unite: string | null;
  etat: EtatAcces;
  /** L'adresse où partirait l'invitation : professionnelle, sinon personnelle. */
  adresse: string | null;
  adresseProfessionnelle: boolean;
  /** La dernière invitation : envoyée le, valable jusqu'au, son courriel. */
  inviteLe: string | null;
  expireLe: string | null;
  courriel: 'en_attente' | 'envoye' | 'echec' | null;
  /** Le jour où son compte a été relié au dossier. */
  activeLe: string | null;
  derniereConnexion: string | null;
}

export interface EtatDesAcces {
  /** Un serveur de courrier est configuré : les invitations partent par courriel. */
  parCourriel: boolean;
  agents: AccesAgent[];
}
