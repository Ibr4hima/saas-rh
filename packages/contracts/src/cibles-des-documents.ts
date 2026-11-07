import { z } from 'zod';
import {
  DOCUMENTS_DEMANDABLES,
  type DocumentDemandable,
  type DocumentGenere,
  type DocumentSansAgent,
} from './document-requests';
import type { ContractType, EmployeeStatus, Gender } from './employees';

/*
 * À qui chaque document s'adresse (ADR-0130). « Générer des documents » ne
 * propose que les agents de la cible du document choisi, et le serveur
 * refuse de le générer pour un autre : une attestation de travail ne se
 * délivre ni pour un stage, ni pour un dossier inactif. La règle vit ici, une
 * fois, pour la page et pour le serveur.
 */

/** Un document qui se génère pour un agent de l'application. */
export type DocumentAvecAgent = Exclude<DocumentGenere, DocumentSansAgent>;

/**
 * Le départ à la retraite se propose dès 40 ans : large, pour couvrir les
 * retraites anticipées (ADR-0131).
 */
export const AGE_MIN_DU_DEPART_A_LA_RETRAITE = 40;

/** Ce que la cible d'un document regarde au dossier d'un agent. */
export interface SituationDeLAgent {
  /** Le dossier est en activité. */
  enActivite: boolean;
  /**
   * Le contrat qui fait foi : le dernier commencé ; pour un dossier inactif,
   * le dernier commencé avant le départ. Null : aucun au dossier.
   */
  contrat: ContractType | null;
  /** Un stage commencé au dossier, en cours ou passé. */
  stage: boolean;
  genre: Gender | null;
  /** L'âge, en années révolues ; null : la date de naissance manque. */
  age: number | null;
}

/** La cible d'un document : ce que le dossier de l'agent doit porter. */
export interface CibleDuDocument {
  /** Les dossiers en activité, les inactifs, ou les deux. */
  dossiers: 'en_activite' | 'inactifs' | 'tous';
  /** Un contrat de travail : tout contrat, sauf un stage. */
  contratDeTravail?: true;
  /** Les seuls contrats admis : le contrat qui fait foi en est un. */
  contrats?: readonly ContractType[];
  /** Un stage commencé au dossier. */
  stage?: true;
  genre?: Gender;
  /** L'âge minimal, en années révolues. */
  ageMin?: number;
}

const SOUS_CONTRAT_DE_TRAVAIL: CibleDuDocument = {
  dossiers: 'en_activite',
  contratDeTravail: true,
};

export const CIBLES_DES_DOCUMENTS: Record<DocumentAvecAgent, CibleDuDocument> = {
  attestation_conge: SOUS_CONTRAT_DE_TRAVAIL,
  attestation_travail: SOUS_CONTRAT_DE_TRAVAIL,
  // Le congé de maternité : un dossier au genre féminin.
  attestation_reprise_service: { ...SOUS_CONTRAT_DE_TRAVAIL, genre: 'female' },
  attestation_reprise_disponibilite: SOUS_CONTRAT_DE_TRAVAIL,
  // Sous CDI ou CDD seulement (ADR-0131).
  attestation_depart_retraite: {
    dossiers: 'en_activite',
    contrats: ['cdi', 'cdd'],
    ageMin: AGE_MIN_DU_DEPART_A_LA_RETRAITE,
  },
  // Le stage s'atteste pendant, ou après : au départ, ou après l'embauche.
  attestation_stage: { dossiers: 'tous', stage: true },
  attestation_cessation: { ...SOUS_CONTRAT_DE_TRAVAIL, genre: 'female' },
  attestation_revenu: SOUS_CONTRAT_DE_TRAVAIL,
  // Le certificat de travail se délivre au départ, ou se prépare avant, pour
  // un agent encore en poste dont le départ est prévu (ADR-0176).
  certificat_travail: { dossiers: 'tous', contratDeTravail: true },
};

/** Un CDI ou un CDD en cours : ce que supposent les documents d'un emploi à l'APIX. */
const SOUS_CDI_OU_CDD: CibleDuDocument = { dossiers: 'en_activite', contrats: ['cdi', 'cdd'] };

/**
 * À qui chaque document se demande (ADR-0137) : « Demander un document »
 * n'offre à l'agent que les documents de sa cible, et le serveur refuse les
 * autres. Un document qui se génère pour un agent garde la cible de
 * « Générer des documents » ; ceux que la DCH renseigne sur une fiche
 * reçoivent la leur : la domiciliation bancaire et les décisions de
 * disponibilité supposent un CDI ou un CDD. Le certificat de travail se
 * demande une fois parti, pendant les trente jours où le portail reste
 * ouvert : un agent en poste demande une attestation de travail (ADR-0176).
 */
export const CIBLES_DES_DEMANDES: Record<DocumentDemandable, CibleDuDocument> = {
  ...CIBLES_DES_DOCUMENTS,
  certificat_travail: { dossiers: 'inactifs', contratDeTravail: true },
  domiciliation_bancaire: SOUS_CDI_OU_CDD,
  decision_disponibilite: SOUS_CDI_OU_CDD,
  decision_renouvellement_disponibilite: SOUS_CDI_OU_CDD,
};

/**
 * Les documents sans agent dont la fiche se préremplit au dossier d'un agent
 * choisi (ADR-0174) : la domiciliation bancaire, les décisions de
 * disponibilité et de renouvellement.
 */
export const FICHES_DEPUIS_LE_DOSSIER = [
  'domiciliation_bancaire',
  'decision_disponibilite',
  'decision_renouvellement_disponibilite',
] as const satisfies readonly DocumentSansAgent[];
export type FicheDepuisLeDossier = (typeof FICHES_DEPUIS_LE_DOSSIER)[number];

/**
 * Les documents où « Générer des documents » fait choisir un agent : ceux
 * qui se génèrent pour un agent, et ceux dont la fiche se préremplit à son
 * dossier.
 */
export type DocumentAChoixDAgent = DocumentAvecAgent | FicheDepuisLeDossier;

/** Les agents que chacun de ces documents propose : pour une fiche, sous CDI ou CDD. */
export const CIBLES_DES_CHOIX: Record<DocumentAChoixDAgent, CibleDuDocument> = {
  ...CIBLES_DES_DOCUMENTS,
  domiciliation_bancaire: SOUS_CDI_OU_CDD,
  decision_disponibilite: SOUS_CDI_OU_CDD,
  decision_renouvellement_disponibilite: SOUS_CDI_OU_CDD,
};

export const depuisLeDossier = (doc: string): doc is FicheDepuisLeDossier =>
  (FICHES_DEPUIS_LE_DOSSIER as readonly string[]).includes(doc);

export const aChoixDAgent = (doc: string): doc is DocumentAChoixDAgent => doc in CIBLES_DES_CHOIX;

/** Ce qui écarte un agent de la cible d'un document : le code du refus. */
export type HorsCible =
  'not_active' | 'en_activite' | 'stage' | 'contrat' | 'sans_stage' | 'genre' | 'age';

/** Ce qui écarte un agent de la cible ; null : l'agent en est. */
export function horsCible(cible: CibleDuDocument, s: SituationDeLAgent): HorsCible | null {
  if (cible.dossiers === 'en_activite' && !s.enActivite) return 'not_active';
  if (cible.dossiers === 'inactifs' && s.enActivite) return 'en_activite';
  if (cible.contratDeTravail && s.contrat === 'stage') return 'stage';
  if (cible.contrats && (s.contrat === null || !cible.contrats.includes(s.contrat))) {
    return 'contrat';
  }
  if (cible.stage && !s.stage) return 'sans_stage';
  if (cible.genre && s.genre !== cible.genre) return 'genre';
  if (cible.ageMin !== undefined && (s.age === null || s.age < cible.ageMin)) return 'age';
  return null;
}

/** Les documents qu'un agent peut demander, dans l'ordre de la liste. */
export const documentsDemandablesPar = (s: SituationDeLAgent): DocumentDemandable[] =>
  DOCUMENTS_DEMANDABLES.filter((doc) => horsCible(CIBLES_DES_DEMANDES[doc], s) === null);

/** Un agent de la cible, tel que « Générer des documents » le propose. */
export interface AgentDeLaCible {
  id: string;
  employeeNumber: string;
  givenName: string;
  familyName: string;
  /** Le poste en cours ; pour un dossier inactif, le dernier. */
  positionTitle: string | null;
  status: EmployeeStatus;
  situation: SituationDeLAgent;
}

/** La recherche dans la cible : un nom ou un matricule ; vide, toute la cible, par nom. */
export const agentsDeLaCibleQuerySchema = z.object({
  q: z.string().trim().max(100).default(''),
});
export type AgentsDeLaCibleQuery = z.infer<typeof agentsDeLaCibleQuerySchema>;

/**
 * Au plus tant d'agents par réponse : toute la cible d'une organisation, la
 * liste déroulante défile ; au-delà, la recherche resserre.
 */
export const AGENTS_DE_LA_CIBLE_MAX = 500;
