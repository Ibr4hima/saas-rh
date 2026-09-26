import { z } from 'zod';

/**
 * Qui peut quoi — décidé avec l'APIX.
 *
 * Pas de rôles « RH », « Manager » ou « Paie » : tout le monde est AGENT. Ce
 * qu'on peut faire de plus s'acquiert par sa place dans l'organigramme :
 *
 *   — tout agent a son espace (congés, documents, informations, Academy,
 *     organigramme, textes) ;
 *   — un N+1 vise les congés de son équipe et suit sa formation ;
 *   — le DIRECTEUR DU CAPITAL HUMAIN (le responsable de la direction du
 *     personnel) a TOUTES les habilitations ci-dessous. Il les délègue,
 *     une à une, aux membres de sa direction : il connaît son équipe, et
 *     certaines parties sont sensibles ;
 *   — l'ADMINISTRATEUR est un compte technique, hors organigramme : il
 *     configure et débloque (toutes les habilitations de gestion), mais ne
 *     traite aucune demande.
 *
 * Les délégations appartiennent à la DCH, pas à son directeur : quand il
 * change, elles restent en place pour que rien ne se bloque — le nouveau
 * directeur les trouve, et les modifie s'il le veut. Un membre qui quitte la
 * DCH perd les siennes, et le directeur en est prévenu.
 */

/** Traiter un type de demande : la demande va directement au délégué. */
export const CAPACITES_DEMANDES = [
  'demandes.conges',
  'demandes.documents',
  'demandes.informations',
  'demandes.pieces',
] as const;

/** Les accès : plusieurs membres peuvent détenir le même. */
export const CAPACITES_GESTION = [
  'personnel.consulter',
  'personnel.gerer',
  'personnel.sensible',
  'personnel.effacer',
  'conges.soldes',
  'conges.parametres',
  'organigramme',
  'recrutement',
  'academy',
  'textes',
  'pilotage',
] as const;

export const CAPACITES = [...CAPACITES_DEMANDES, ...CAPACITES_GESTION] as const;
export const capaciteSchema = z.enum(CAPACITES);
export type Capacite = z.infer<typeof capaciteSchema>;
export type CapaciteDemande = (typeof CAPACITES_DEMANDES)[number];

export const estCapaciteDemande = (c: string): c is CapaciteDemande =>
  (CAPACITES_DEMANDES as readonly string[]).includes(c);

export interface InfoCapacite {
  libelle: string;
  description: string;
  groupe: 'Demandes' | 'Personnel' | 'Congés' | 'Organisation';
  /** Données sensibles : à confier avec soin. */
  sensible?: boolean;
}

export const CAPACITE_INFOS: Record<Capacite, InfoCapacite> = {
  'demandes.conges': {
    libelle: 'Demandes de congé',
    description: 'Les traiter une fois visées par le N+1 : elles lui arrivent directement.',
    groupe: 'Demandes',
  },
  'demandes.documents': {
    libelle: 'Demandes de documents',
    description: 'Attestations, bulletins, certificats : les préparer et les remettre.',
    groupe: 'Demandes',
  },
  'demandes.informations': {
    libelle: 'Changements d’informations',
    description:
      'Les signalements des agents (adresse, téléphone…) : les appliquer ou les refuser.',
    groupe: 'Demandes',
  },
  'demandes.pieces': {
    libelle: 'Pièces justificatives',
    description: 'Les pièces déposées par les agents : les valider ou les refuser.',
    groupe: 'Demandes',
    sensible: true,
  },
  'personnel.consulter': {
    libelle: 'Consulter les dossiers',
    description: 'La liste du personnel, les fiches et leur historique.',
    groupe: 'Personnel',
  },
  'personnel.gerer': {
    libelle: 'Gérer les dossiers',
    description:
      'Créer, modifier, muter, désactiver, importer ; ouvrir le portail d’un agent ; déposer une pièce à son dossier.',
    groupe: 'Personnel',
  },
  'personnel.sensible': {
    libelle: 'Données sensibles',
    description: 'Le numéro de pièce d’identité, les pièces et les justificatifs d’absence.',
    groupe: 'Personnel',
    sensible: true,
  },
  'personnel.effacer': {
    libelle: 'Effacer un dossier',
    description: 'Supprimer définitivement un dossier et tout ce qui s’y rattache.',
    groupe: 'Personnel',
    sensible: true,
  },
  'conges.soldes': {
    libelle: 'Soldes de congés',
    description: 'Ajouter ou retirer des jours sur les soldes des agents.',
    groupe: 'Congés',
  },
  'conges.parametres': {
    libelle: 'Paramètres des congés',
    description: 'Les types d’absence et les jours fériés.',
    groupe: 'Congés',
  },
  organigramme: {
    libelle: 'Organigramme',
    description: 'Créer, déplacer, dissoudre les unités ; désigner leurs responsables.',
    groupe: 'Organisation',
  },
  recrutement: {
    libelle: 'Recrutement',
    description: 'Les offres d’emploi et les dossiers de candidature.',
    groupe: 'Organisation',
  },
  academy: {
    libelle: 'APIX Academy',
    description: 'Le catalogue des formations, et les certificats des agents.',
    groupe: 'Organisation',
  },
  textes: {
    libelle: 'Textes de référence',
    description: 'Déposer le Code du travail et le règlement intérieur.',
    groupe: 'Organisation',
  },
  pilotage: {
    libelle: 'Tableau de bord',
    description: 'Les indicateurs, le contrôle de la chaîne hiérarchique, les fins de contrat.',
    groupe: 'Organisation',
  },
};

/** Les demandes du personnel, toutes traitées par la DCH. */
export const TYPES_DEMANDE = ['conges', 'documents', 'informations', 'pieces'] as const;
export const typeDemandeSchema = z.enum(TYPES_DEMANDE);
export type TypeDemande = z.infer<typeof typeDemandeSchema>;

export const CAPACITE_DU_TYPE: Record<TypeDemande, CapaciteDemande> = {
  conges: 'demandes.conges',
  documents: 'demandes.documents',
  informations: 'demandes.informations',
  pieces: 'demandes.pieces',
};

/** Qui traite une demande, tel que l'écran le montre. */
export interface TraitementView {
  /** Qui la traite maintenant — « Awa Diop ou Moussa Ndiaye » ; null : personne. */
  traitants: string | null;
  /** Confiée à la main à ce membre de la DCH. */
  confiee: { employeeId: string; nom: string } | null;
  /** L'appelant dirige la DCH : il peut la confier, ou la reprendre. */
  peutConfier: boolean;
  /** La demande du directeur lui-même, que nul n'est habilité à traiter : à lui de la confier. */
  aConfier: boolean;
  /** Elle attend l'appelant : il la traite — ou, directeur, il doit la confier. */
  pourMoi: boolean;
}

/** Confier une demande à un membre de la DCH — `null` : la reprendre. */
export const confierSchema = z.object({ employeeId: z.uuid().nullable() });
export type ConfierInput = z.infer<typeof confierSchema>;

/** Ce qui attend l'appelant, par type de demande (badges du menu). */
export type CompteursDemandes = Record<TypeDemande, number>;

/** Un membre de la DCH et ce qui lui est confié. */
export interface MembreHabilite {
  employeeId: string;
  nom: string;
  poste: string | null;
  capacites: Capacite[];
  /** En congé aujourd'hui : ses demandes reviennent au directeur le temps de l'absence. */
  absent: boolean;
}

/** L'espace du directeur du Capital Humain : ses délégations. */
export interface EtatHabilitations {
  /** L'appelant dirige la direction du personnel. */
  estDirecteur: boolean;
  directeur: { employeeId: string; nom: string } | null;
  direction: { id: string; nom: string } | null;
  /** Les membres actifs de la DCH (hors directeur), et ce qui leur est confié. */
  membres: MembreHabilite[];
}

export const accorderSchema = z.object({
  employeeId: z.uuid(),
  capacite: capaciteSchema,
  /** `false` : retirer. */
  accordee: z.boolean(),
});
export type AccorderInput = z.infer<typeof accorderSchema>;

/** Ce qu'une habilitation emporte avec elle : on ne gère pas un dossier sans le voir. */
const EMPORTE: Partial<Record<Capacite, readonly Capacite[]>> = {
  'personnel.consulter': ['personnel.gerer', 'personnel.sensible', 'personnel.effacer'],
};

/** Ce qu'un utilisateur peut, dans la session. L'administrateur a toute la gestion. */
export function peut(
  user: { role: string; capacites?: readonly string[] } | null | undefined,
  capacite: Capacite,
): boolean {
  if (!user) return false;
  if (user.role === 'admin' && !estCapaciteDemande(capacite)) return true;
  const detenues = user.capacites ?? [];
  return detenues.includes(capacite) || (EMPORTE[capacite] ?? []).some((c) => detenues.includes(c));
}

/** A-t-il au moins une habilitation de gestion ? (espace de gestion au menu) */
export function gereQuelqueChose(
  user: { role: string; capacites?: readonly string[] } | null | undefined,
): boolean {
  return CAPACITES_GESTION.some((c) => peut(user, c));
}
