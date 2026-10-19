import { z } from 'zod';
import type { DocumentGenere, DocumentSansAgent } from './document-requests';
import type { ContractType, EmployeeStatus, Gender } from './employees';

/*
 * À qui chaque document s'adresse (ADR-0130). « Générer des documents » ne
 * propose que les agents de la cible du document choisi, et le serveur
 * refuse de le générer pour un autre : une attestation de travail ne se
 * délivre pas pour un stage, ni un certificat de travail pour un dossier en
 * activité. La règle vit ici, une fois, pour la page et pour le serveur.
 */

/** Un document qui se génère pour un agent de l'application. */
export type DocumentAvecAgent = Exclude<DocumentGenere, DocumentSansAgent>;

/**
 * La retraite se prend au plus tôt à 55 ans, par la retraite anticipée de
 * l'IPRES ; 60 ans est l'âge ordinaire.
 */
export const AGE_DE_LA_RETRAITE_ANTICIPEE = 55;

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
  attestation_depart_retraite: {
    ...SOUS_CONTRAT_DE_TRAVAIL,
    ageMin: AGE_DE_LA_RETRAITE_ANTICIPEE,
  },
  // Le stage s'atteste pendant, ou après : au départ, ou après l'embauche.
  attestation_stage: { dossiers: 'tous', stage: true },
  attestation_cessation: { ...SOUS_CONTRAT_DE_TRAVAIL, genre: 'female' },
  attestation_revenu: SOUS_CONTRAT_DE_TRAVAIL,
  // Le certificat de travail se délivre au départ.
  certificat_travail: { dossiers: 'inactifs', contratDeTravail: true },
};

/** Ce qui écarte un agent de la cible d'un document : le code du refus. */
export type HorsCible = 'not_active' | 'en_activite' | 'stage' | 'sans_stage' | 'genre' | 'age';

/** Ce qui écarte un agent de la cible ; null : l'agent en est. */
export function horsCible(cible: CibleDuDocument, s: SituationDeLAgent): HorsCible | null {
  if (cible.dossiers === 'en_activite' && !s.enActivite) return 'not_active';
  if (cible.dossiers === 'inactifs' && s.enActivite) return 'en_activite';
  if (cible.contratDeTravail && s.contrat === 'stage') return 'stage';
  if (cible.stage && !s.stage) return 'sans_stage';
  if (cible.genre && s.genre !== cible.genre) return 'genre';
  if (cible.ageMin !== undefined && (s.age === null || s.age < cible.ageMin)) return 'age';
  return null;
}

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
