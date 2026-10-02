import { z } from 'zod';
import type { RequestableDoc } from './document-requests';
import type { DocumentCategory } from './documents';

/**
 * Qui peut quoi — décidé avec l'APIX.
 *
 * Pas de rôles « RH », « Manager » ou « Paie » : tout le monde est AGENT. Ce
 * qu'on peut faire de plus s'acquiert par sa place dans l'organigramme :
 *
 *   — tout agent a son espace (congés, documents, informations, Academy,
 *     organigramme, textes — qu'il lit) ;
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
 *
 * Les documents se confient TYPE PAR TYPE — les attestations de travail à
 * l'un, les bulletins de salaire à l'autre : chaque document demandé est
 * une demande à part, qui va à qui traite ce type-là.
 */

/** Traiter un type de document : chaque document demandé va à qui le traite. */
export const CAPACITES_DOCUMENTS = [
  'demandes.documents.attestation_travail',
  'demandes.documents.contrat_travail',
  'demandes.documents.bulletin_salaire',
  'demandes.documents.attestation_salaire',
  'demandes.documents.certificat_travail',
  'demandes.documents.autre',
] as const satisfies readonly `demandes.documents.${RequestableDoc}`[];

/**
 * Vérifier un type de document officiel : chaque dépôt va à qui vérifie ce
 * type. `autre` ne se lit plus que sur des dépôts anciens — il reste au
 * directeur, sauf délégation.
 */
export const CAPACITES_PIECES = [
  'demandes.pieces.cni',
  'demandes.pieces.passeport',
  'demandes.pieces.diplome',
  'demandes.pieces.certification',
  'demandes.pieces.attestation_travail',
  'demandes.pieces.attestation_stage',
  'demandes.pieces.cv',
  'demandes.pieces.autre',
] as const satisfies readonly `demandes.pieces.${DocumentCategory}`[];

/** Traiter un type de demande : les demandes vont directement aux membres choisis. */
export const CAPACITES_DEMANDES = [
  'demandes.conges',
  ...CAPACITES_DOCUMENTS,
  'demandes.informations',
  ...CAPACITES_PIECES,
] as const;

/** Les accès : plusieurs membres peuvent détenir le même. */
export const CAPACITES_GESTION = [
  'personnel.consulter',
  'personnel.gerer',
  'personnel.sensible',
  'personnel.effacer',
  'conges.soldes',
  'conges.parametres',
  'feries',
  'organigramme',
  'recrutement.offres',
  'recrutement.candidatures',
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

/**
 * Réservées à l'administrateur : ni la direction de la DCH ni une délégation
 * ne les donnent. Le catalogue de l'APIX Academy en est : qui le gère voit
 * les questions des évaluations — confié à un agent, il le priverait de ses
 * propres certificats. Les textes de référence aussi (décision APIX) : un
 * seul dépositaire, l'administrateur, qui les dépose, les modifie et les
 * supprime ; les agents les lisent dans leur espace.
 */
export const CAPACITES_ADMINISTRATEUR = [
  'academy',
  'textes',
] as const satisfies readonly Capacite[];

/** Ce qu'a qui dirige la DCH, et ce qu'il peut confier : tout, sauf ce qui est à l'administrateur. */
export const CAPACITES_DELEGABLES: readonly Capacite[] = CAPACITES.filter(
  (c) => !(CAPACITES_ADMINISTRATEUR as readonly string[]).includes(c),
);

export const estDelegable = (c: Capacite): boolean => CAPACITES_DELEGABLES.includes(c);

/** Qui traite ce document-là : une habilitation par type de document. */
export const capaciteDuDocument = (doc: RequestableDoc): CapaciteDemande =>
  `demandes.documents.${doc}`;

/** Qui vérifie ce document officiel-là : une habilitation par type. */
export const capaciteDeLaPiece = (categorie: DocumentCategory): CapaciteDemande =>
  `demandes.pieces.${categorie}`;

export interface InfoCapacite {
  libelle: string;
  description: string;
  groupe:
    | 'Demandes'
    | 'Documents'
    | 'Vérification'
    | 'Personnel'
    | 'Congés'
    | 'Recrutement'
    | 'Organisation';
  /** Données sensibles : à confier avec soin. */
  sensible?: boolean;
}

export const CAPACITE_INFOS: Record<Capacite, InfoCapacite> = {
  'demandes.conges': {
    libelle: 'Demandes de congé',
    description: 'Les traiter une fois visées par le N+1 : elles lui arrivent directement.',
    groupe: 'Demandes',
  },
  'demandes.documents.attestation_travail': {
    libelle: 'Attestations de travail',
    description: 'L’application les génère : les relire, les faire signer, annoncer leur retrait.',
    groupe: 'Documents',
  },
  'demandes.documents.contrat_travail': {
    libelle: 'Copies de contrat de travail',
    description: 'Retrouver le contrat au dossier, en remettre une copie.',
    groupe: 'Documents',
  },
  'demandes.documents.bulletin_salaire': {
    libelle: 'Bulletins de salaire',
    description: 'Les obtenir du système de paie, les remettre.',
    groupe: 'Documents',
    sensible: true,
  },
  'demandes.documents.attestation_salaire': {
    libelle: 'Attestations de salaire',
    description: 'Les établir à partir des éléments de paie, les faire signer.',
    groupe: 'Documents',
    sensible: true,
  },
  'demandes.documents.certificat_travail': {
    libelle: 'Certificats de travail',
    description: 'Les établir, les faire signer, les remettre.',
    groupe: 'Documents',
  },
  'demandes.documents.autre': {
    libelle: 'Autres documents',
    description: 'Ce que l’agent demande hors de la liste — sa précision dit quoi.',
    groupe: 'Documents',
  },
  'demandes.informations': {
    libelle: 'Changements d’informations',
    description:
      'Les signalements des agents (adresse, téléphone…) : les appliquer ou les refuser.',
    groupe: 'Demandes',
  },
  'demandes.pieces.cni': {
    libelle: 'Cartes nationales d’identité',
    description: 'Les vérifier, puis les ajouter au dossier — ou les refuser.',
    groupe: 'Vérification',
    sensible: true,
  },
  'demandes.pieces.passeport': {
    libelle: 'Passeports',
    description: 'Les vérifier, puis les ajouter au dossier — ou les refuser.',
    groupe: 'Vérification',
    sensible: true,
  },
  'demandes.pieces.diplome': {
    libelle: 'Diplômes',
    description: 'Les vérifier, puis les ajouter au dossier — ou les refuser.',
    groupe: 'Vérification',
    sensible: true,
  },
  'demandes.pieces.certification': {
    libelle: 'Certifications',
    description: 'Les vérifier, puis les ajouter au dossier — ou les refuser.',
    groupe: 'Vérification',
    sensible: true,
  },
  'demandes.pieces.attestation_travail': {
    libelle: 'Attestations de travail déposées',
    description: 'Les vérifier, puis les ajouter au dossier — ou les refuser.',
    groupe: 'Vérification',
    sensible: true,
  },
  'demandes.pieces.attestation_stage': {
    libelle: 'Attestations de stage',
    description: 'Les vérifier, puis les ajouter au dossier — ou les refuser.',
    groupe: 'Vérification',
    sensible: true,
  },
  'demandes.pieces.cv': {
    libelle: 'Curriculum vitæ',
    description: 'Les vérifier, puis les ajouter au dossier — ou les refuser.',
    groupe: 'Vérification',
    sensible: true,
  },
  'demandes.pieces.autre': {
    libelle: 'Autres documents déposés',
    description: 'Les dépôts anciens hors de la liste.',
    groupe: 'Vérification',
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
      'Créer, modifier, muter, désactiver, importer ; ouvrir le portail d’un agent ; déposer une pièce à son dossier ; être prévenu des CDD et stages qui arrivent à leur terme.',
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
    description: 'Les types d’absence : leurs droits, leur décompte, leurs justificatifs.',
    groupe: 'Congés',
  },
  feries: {
    libelle: 'Jours fériés',
    description: 'Ajouter, déplacer ou retirer les jours fériés de l’année.',
    groupe: 'Congés',
  },
  organigramme: {
    libelle: 'Organigramme',
    description: 'Créer, déplacer, dissoudre les unités ; désigner leurs responsables.',
    groupe: 'Organisation',
  },
  'recrutement.offres': {
    libelle: 'Offres d’emploi',
    description: 'Créer, modifier, publier et clôturer les offres.',
    groupe: 'Recrutement',
  },
  'recrutement.candidatures': {
    libelle: 'Dossiers de candidature',
    description: 'Lire les dossiers reçus — CV et pièces — et les faire avancer.',
    groupe: 'Recrutement',
    sensible: true,
  },
  academy: {
    libelle: 'APIX Academy',
    description: 'Le catalogue des formations, et les certificats des agents.',
    groupe: 'Organisation',
  },
  textes: {
    libelle: 'Textes de référence',
    description: 'Déposer, modifier et supprimer le Code du travail et le règlement intérieur.',
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

/** Les habilitations qui traitent un type de demande — une par document pour les documents. */
export function capacitesDuType(type: TypeDemande): readonly CapaciteDemande[] {
  switch (type) {
    case 'conges':
      return ['demandes.conges'];
    case 'documents':
      return CAPACITES_DOCUMENTS;
    case 'informations':
      return ['demandes.informations'];
    case 'pieces':
      return CAPACITES_PIECES;
  }
}

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
  /** Pour le nommer simplement — « Awa et Khady traiteront… ». */
  prenom: string;
  poste: string | null;
  capacites: Capacite[];
  /** En congé aujourd'hui : ses demandes reviennent au directeur le temps de l'absence. */
  absent: boolean;
  /**
   * A activé son compte. Sans compte, on lui délègue déjà : il trouve ses
   * tâches en l'activant — d'ici là, ses demandes vont au directeur.
   */
  compte: boolean;
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

// ---------- Les deux espaces ----------

/**
 * Un compte, deux espaces : « Mon espace » (agent) et « Gestion RH »
 * (gestion). Qui ne gère rien n'a que le premier ; l'administrateur, que le
 * second.
 */
export type Espace = 'agent' | 'gestion';

/**
 * L'espace auquel une page appartient — `null` : elle est des deux (le
 * calendrier, l'organigramme).
 *
 * Une notification appartient à l'espace de la page où elle mène : c'est ainsi
 * que chaque espace a sa boîte (`espaceDeLaNotification`).
 */
export function espaceDuChemin(chemin: string): Espace | null {
  const path = chemin.split(/[?#]/)[0] ?? '';
  const sous = (p: string) => path === p || path.startsWith(`${p}/`);
  // Traiter pour la DCH, confier : de la gestion, même rangé sous /moi.
  if (sous('/moi/dch') || sous('/moi/delegations')) return 'gestion';
  if (sous('/moi')) return 'agent';
  if (sous('/academy/gerer')) return 'gestion';
  // Apprendre, ses certificats : Mon espace seulement (décision APIX).
  if (sous('/academy')) return 'agent';
  if (sous('/calendrier') || sous('/organisation')) return null;
  // Les textes se lisent dans Mon espace ; seul l'administrateur les dépose.
  if (sous('/reglementations')) return path.endsWith('/deposer') ? 'gestion' : 'agent';
  return 'gestion';
}

/**
 * Les avis de gestion qui mènent à une page commune — ou nulle part : une
 * habilitation accordée pour l'organigramme, une habilitation retirée, la DCH
 * sans responsable. Ils vont quand même à la boîte de Gestion RH.
 */
export const NOTIFICATIONS_DE_GESTION = ['delegation', 'delegation_rompue', 'dch_vacante'] as const;

/**
 * Les avis personnels qui mènent à une page commune : le rappel d'un jour
 * férié (vers le calendrier). Décision APIX : Mon espace seulement.
 */
export const NOTIFICATIONS_PERSONNELLES = ['holiday_reminder'] as const;

/**
 * La boîte où va une notification : l'espace de la page où elle mène ; à
 * défaut, celui de son type — `null` : les deux boîtes.
 *
 * Le serveur applique la même règle en SQL pour filtrer dans la base
 * (notifications.service.ts, `espaceDeLaNotificationSql`) ; un test les garde
 * d'accord.
 */
export function espaceDeLaNotification(n: { type: string; link: string | null }): Espace | null {
  const espace = n.link ? espaceDuChemin(n.link) : null;
  if (espace) return espace;
  if ((NOTIFICATIONS_DE_GESTION as readonly string[]).includes(n.type)) return 'gestion';
  if ((NOTIFICATIONS_PERSONNELLES as readonly string[]).includes(n.type)) return 'agent';
  return null;
}
