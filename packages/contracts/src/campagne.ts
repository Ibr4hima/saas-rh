import { z } from 'zod';
import {
  autoEvaluationSchema,
  evaluationDuN1Schema,
  LONGUEURS_DE_LA_FICHE,
  partieReserveeSchema,
  type AutoEvaluation,
  type EvaluationDuN1,
  type ObjectifEvalue,
  type PartieReservee,
  type PersonnelDeLaFiche,
} from './entretien-annuel';
import type { Gender } from './employees';

/* ────────────────────────────────────────────────────────────────
   La campagne d'évaluation annuelle (ADR-0211) : ce que l'accueil montre
   à qui se connecte. Sa fiche, comme celle de son dossier ; son
   auto-évaluation ; et les agents que cette personne évalue, s'il y en a,
   avec où en est chaque auto-évaluation.
   ──────────────────────────────────────────────────────────────── */

/** Où en est la campagne, ce jour. */
export type PhaseDeLaCampagne =
  /** Aucune période fixée pour l'année. */
  | 'non_fixee'
  /** Avant le début de la période. */
  | 'a_venir'
  /** Du début de la période à la fin de l'auto-évaluation. */
  | 'auto_evaluation'
  /** Ensuite, jusqu'à la fin de la période : le N+1 évalue. */
  | 'evaluation'
  /** Après la fin de la période. */
  | 'terminee';

/** L'auto-évaluation d'un agent. */
export type EtatDeLAuto = 'a_faire' | 'en_cours' | 'transmise';

/** L'évaluation d'un agent par son N+1 (ADR-0216, ADR-0217, ADR-0267). */
export type EtatDeLEvaluation =
  | 'a_faire'
  | 'en_cours'
  /** Transmise à l'agent, qui la lit, puis la valide. */
  | 'transmise'
  /** Validée par l'agent : elle ne change plus. */
  | 'validee';

/**
 * Son évaluation par le N+1, vue par l'agent (ADR-0217) : tant que le N+1
 * ne l'a pas transmise, l'agent n'en sait rien de plus.
 */
export type EtatDeMonEvaluation = 'en_attente' | 'a_valider' | 'validee';

/** Les commentaires du N+2 sur la fiche d'un agent (ADR-0218). */
export type EtatDesCommentaires =
  /** La fiche n'est pas encore validée par l'agent. */
  | 'en_attente'
  /** Validée par l'agent : le N+2 la lit, et la commente s'il y a lieu. */
  | 'a_commenter'
  /** Le N+2 a commencé d'écrire. */
  | 'en_cours'
  /** Transmis au N+1 : ils ne changent plus. */
  | 'transmis'
  /** Le N+1 a repris la fiche avant les commentaires : le N+2 ne la commente plus (ADR-0221). */
  | 'reprise';

/** La transmission de la fiche à la DCH, par le N+1 (ADR-0221). */
export type EtatDeLaTransmission =
  /** Pas encore : la fiche attend la validation de l'agent, ou les commentaires du N+2. */
  | 'en_attente'
  /** Validée par l'agent, commentée par le N+2 s'il y en a un, ou reprise au N+2 : le N+1 la transmet. */
  | 'a_transmettre'
  /** Transmise : la fiche ne change plus. */
  | 'transmise';

/** Les commentaires du N+2, une fois transmis au N+1. */
export interface CommentairesDuN2 {
  /** Vide : la fiche est revenue sans commentaire. */
  texte: string;
  /** AAAA-MM-JJ : le jour de leur transmission. */
  le: string;
  /** Le N+2 qui les a écrits. */
  par: PersonneDeLaCampagne | null;
}

/** Son évaluation par le N+1, sur son accueil. */
export interface EvaluationRecue {
  etat: EtatDeMonEvaluation;
  /** AAAA-MM-JJ : le jour où le N+1 l'a transmise. */
  transmiseLe: string | null;
  /** AAAA-MM-JJ : le jour où l'agent l'a validée. */
  valideeLe: string | null;
}

export interface AutoDeLAgent {
  etat: EtatDeLAuto;
  /** AAAA-MM-JJ : le jour de la transmission au N+1. */
  transmiseLe: string | null;
}

/** La période de l'année, AAAA-MM-JJ. */
export interface PeriodeDeLaCampagne {
  du: string;
  /** La fin de l'auto-évaluation ; `null` : la période entière. */
  autoAu: string | null;
  au: string;
}

/** Une personne citée : son nom et son poste. */
export interface PersonneDeLaCampagne {
  prenom: string;
  nom: string;
  poste: string | null;
  /** Le sexe inscrit au dossier, qui accorde le libellé du repère ; `null` : non renseigné (ADR-0224). */
  genre?: Gender | null;
}

/** La personne connectée, telle que la fiche de son dossier la présente. */
export interface AgentDeLaCampagne {
  employeeId: string;
  prenom: string;
  nom: string;
  matricule: string;
  poste: string | null;
  /** Le statut : cadre ou non cadre. */
  personnel: PersonnelDeLaFiche | null;
  direction: string | null;
  /** L'abrégé de la direction (« DCH »), comme sur la fiche du dossier. */
  directionAbregee: string | null;
  departement: string | null;
  service: string | null;
  /** L'adresse professionnelle (ADR-0224). */
  email: string | null;
  /** L'évaluateur de la campagne : le N+1. */
  evaluateur: PersonneDeLaCampagne | null;
  /** `null` : cette personne n'est pas évaluée (le sommet de l'organigramme, un stage). */
  auto: AutoDeLAgent | null;
}

/** Un agent de l'équipe, tel que sa carte le présente. */
export interface AgentDeLEquipe {
  employeeId: string;
  prenom: string;
  nom: string;
  matricule: string;
  poste: string | null;
  /** L'adresse professionnelle, sur la carte de l'agent (ADR-0234). */
  email: string | null;
  /** Le statut : cadre ou non cadre, à droite de l'adresse sur la carte (ADR-0235). */
  personnel: PersonnelDeLaFiche | null;
  auto: AutoDeLAgent;
  /** Où en est son évaluation par la personne connectée (ADR-0216). */
  evaluation: EtatDeLEvaluation;
  /** Où en sont les commentaires du N+2 ; `null` : l'agent n'a pas de N+2 (ADR-0218). */
  commentaires: EtatDesCommentaires | null;
  /** Où en est sa transmission à la DCH (ADR-0221). */
  dch: EtatDeLaTransmission;
}

/**
 * Un agent dont la personne connectée est le N+2, tel que sa carte le
 * présente : l'agent, son N+1, et où en sont les commentaires sur sa fiche,
 * validée par l'agent (ADR-0218, ADR-0255).
 */
export interface AgentACommenter {
  employeeId: string;
  prenom: string;
  nom: string;
  matricule: string;
  poste: string | null;
  /** L'adresse professionnelle, sur la carte de l'agent (ADR-0234). */
  email: string | null;
  /** Son N+1, l'évaluateur de la campagne. */
  n1: PersonneDeLaCampagne;
  auto: AutoDeLAgent;
  evaluation: EtatDeLEvaluation;
  commentaires: EtatDesCommentaires;
}

export interface AccueilDeLaCampagne {
  annee: number;
  periode: PeriodeDeLaCampagne | null;
  phase: PhaseDeLaCampagne;
  /** `null` : le compte n'a pas de dossier d'agent en activité. */
  moi: AgentDeLaCampagne | null;
  /** Les agents qu'évalue la personne connectée ; vide s'il n'y en a pas. */
  equipe: AgentDeLEquipe[];
  /** Son évaluation par le N+1 ; `null` : cette personne n'est pas évaluée (ADR-0217). */
  monEvaluation: EvaluationRecue | null;
  /**
   * Les fiches arrivées chez la personne connectée, N+2 de leurs agents :
   * validées par l'agent (ADR-0218, ADR-0255) ; vide s'il n'y en a pas.
   */
  aCommenter: AgentACommenter[];
  /**
   * Le suivi des évaluations, en deux nombres, pour qui a l'habilitation
   * « Tableau de bord » ; `null` sinon (ADR-0221). Non nul, la barre porte
   * le bouton « Suivi des évaluations » (ADR-0256).
   */
  dch: { fiches: number; transmises: number } | null;
  /** Un compte d'administration : l'accueil ouvre l'administration de la campagne (ADR-0222). */
  administration: boolean;
}

/** Un agent de l'équipe, tel que son évaluateur l'ouvre depuis sa carte. */
export interface EvaluationDeLAgent {
  annee: number;
  periode: PeriodeDeLaCampagne | null;
  phase: PhaseDeLaCampagne;
  agent: AgentDeLaCampagne;
  /** Les objectifs fixés à l'agent pour l'année, dans l'ordre de la fiche. */
  objectifs: ObjectifEvalue[];
  /** Son auto-évaluation, une fois transmise ; `null` avant (ADR-0215). */
  autoEvaluation: AutoEvaluation | null;
  /** L'évaluation du N+1, telle qu'elle est écrite ; vide tant que rien ne l'est (ADR-0216). */
  evaluation: EvaluationDuN1;
  /** La partie réservée à la hiérarchie : jamais lue par l'agent. */
  reservee: PartieReservee;
  etatDeLEvaluation: EtatDeLEvaluation;
  /** AAAA-MM-JJ : le jour où le N+1 l'a transmise à l'agent. */
  evaluationTransmiseLe: string | null;
  /** AAAA-MM-JJ : le jour où l'agent l'a validée (ADR-0217). */
  valideeLe: string | null;
  /** Le N+2 de l'agent : l'évaluateur du N+1 ; `null` s'il n'y en a pas (ADR-0218). */
  n2: PersonneDeLaCampagne | null;
  etatDesCommentaires: EtatDesCommentaires | null;
  /** Les commentaires du N+2, une fois transmis. */
  commentairesDuN2: CommentairesDuN2 | null;
  /** AAAA-MM-JJ : le jour où le N+1 a repris la fiche au N+2, tant qu'elle n'est pas renvoyée au N+2. */
  repriseAuN2Le: string | null;
  /** Où en est sa transmission à la DCH (ADR-0221). */
  dch: EtatDeLaTransmission;
  /** AAAA-MM-JJ : le jour de sa transmission à la DCH. */
  transmiseALaDCHLe: string | null;
  /**
   * Ouverte à l'écriture du N+1 : l'auto-évaluation transmise, pendant la
   * période de l'année, tant que l'évaluation n'est pas transmise.
   */
  modifiable: boolean;
}

/** L'écriture de l'évaluation du N+1 : le brouillon, ou la version transmise. */
export const ecritureDeLEvaluationSchema = z.object({
  evaluation: evaluationDuN1Schema,
  reservee: partieReserveeSchema,
});
export type EcritureDeLEvaluation = z.infer<typeof ecritureDeLEvaluationSchema>;

/** Son auto-évaluation, telle que son formulaire la lit (ADR-0215). */
export interface MonAutoEvaluation {
  annee: number;
  periode: PeriodeDeLaCampagne | null;
  phase: PhaseDeLaCampagne;
  /** Les objectifs fixés pour l'année, dans l'ordre de la fiche. */
  objectifs: ObjectifEvalue[];
  /** Ce qui est écrit ; vide tant que rien ne l'est. */
  auto: AutoEvaluation;
  etat: EtatDeLAuto;
  /** AAAA-MM-JJ : le jour de la transmission au N+1. */
  transmiseLe: string | null;
  /** Le N+1 qui la reçoit. */
  evaluateur: PersonneDeLaCampagne | null;
  /** Ouverte à l'écriture : pendant l'auto-évaluation, tant qu'elle n'est pas transmise. */
  modifiable: boolean;
}

/** L'écriture de son auto-évaluation : le brouillon, ou la version transmise. */
export const ecritureDeLAutoSchema = z.object({ auto: autoEvaluationSchema });
export type EcritureDeLAuto = z.infer<typeof ecritureDeLAutoSchema>;

/** Son évaluation par le N+1, telle que l'agent la lit (ADR-0217) : jamais la partie réservée. */
export interface MonEvaluation extends EvaluationRecue {
  annee: number;
  /** Son matricule : le nom du PDF qu'enregistre « Télécharger » (ADR-0268). */
  matricule: string;
  periode: PeriodeDeLaCampagne | null;
  phase: PhaseDeLaCampagne;
  /** Le personnel de sa fiche : le management n'y figure que pour le personnel cadre. */
  personnel: PersonnelDeLaFiche;
  objectifs: ObjectifEvalue[];
  /** Son auto-évaluation. */
  auto: AutoEvaluation;
  /** L'évaluation transmise par le N+1 ; `null` tant qu'elle ne l'est pas. */
  evaluation: EvaluationDuN1 | null;
  /** Le N+1 qui l'évalue. */
  evaluateur: PersonneDeLaCampagne | null;
  /** À valider : transmise, pas encore validée. */
  validable: boolean;
}

/** La fiche complète d'un agent : son auto-évaluation, l'évaluation du N+1, la partie réservée. */
export interface FicheComplete {
  auto: AutoEvaluation;
  evaluation: EvaluationDuN1;
  reservee: PartieReservee;
}

/** La fiche d'un agent, telle que son N+2 l'ouvre pour la commenter (ADR-0218). */
export interface FichePourLeN2 {
  annee: number;
  periode: PeriodeDeLaCampagne | null;
  phase: PhaseDeLaCampagne;
  /** L'agent, et son N+1 en évaluateur. */
  agent: AgentDeLaCampagne;
  objectifs: ObjectifEvalue[];
  /** La fiche, une fois validée par l'agent ; `null` avant. */
  fiche: FicheComplete | null;
  /** AAAA-MM-JJ. */
  autoTransmiseLe: string | null;
  evaluationTransmiseLe: string | null;
  valideeLe: string | null;
  /** Ses commentaires, tels qu'ils sont écrits. */
  commentaires: string;
  etat: EtatDesCommentaires;
  /** AAAA-MM-JJ : le jour de leur transmission au N+1. */
  transmisLe: string | null;
  /** Ouverts à l'écriture : la fiche validée par l'agent, tant qu'ils ne sont pas transmis. */
  modifiable: boolean;
}

/** L'écriture des commentaires du N+2 : le brouillon, ou la version transmise. */
export const ecritureDesCommentairesSchema = z.object({
  commentaires: z.string().max(LONGUEURS_DE_LA_FICHE.texte),
});
export type EcritureDesCommentaires = z.infer<typeof ecritureDesCommentairesSchema>;

/** Où en est la fiche d'un agent, pour la DCH (ADR-0221). */
export type EtapeDeLaFiche =
  /** L'auto-évaluation n'est pas faite : pas encore transmise au N+1, brouillon ou pas (ADR-0226). */
  | 'auto_non_faite'
  /** Le N+1 l'évalue. */
  | 'chez_le_n1'
  /** Transmise à l'agent, qui la valide. */
  | 'chez_l_agent'
  /** Validée par l'agent : le N+2 la commente. */
  | 'chez_le_n2'
  /** De retour chez le N+1, qui la transmet à la DCH. */
  | 'a_transmettre'
  /** Transmise à la DCH. */
  | 'transmise';

/** La fiche d'un agent, sur une ligne du suivi de la DCH. */
export interface FicheSuivie {
  employeeId: string;
  prenom: string;
  nom: string;
  matricule: string;
  poste: string | null;
  /** L'abrégé de la direction (« DCH »). */
  direction: string | null;
  /** Son N+1, l'évaluateur de la campagne. */
  n1: PersonneDeLaCampagne | null;
  etape: EtapeDeLaFiche;
  /** AAAA-MM-JJ : le jour de sa transmission à la DCH. */
  transmiseLe: string | null;
}

/** Le suivi de la DCH : chaque agent à évaluer cette année, et où en est sa fiche. */
export interface SuiviDeLaDCH {
  annee: number;
  periode: PeriodeDeLaCampagne | null;
  phase: PhaseDeLaCampagne;
  /** Par ordre alphabétique. */
  fiches: FicheSuivie[];
}

/** La fiche d'un agent, telle que la DCH la lit une fois transmise : en entier. */
export interface FichePourLaDCH {
  annee: number;
  /** L'agent, et son N+1 en évaluateur. */
  agent: AgentDeLaCampagne;
  objectifs: ObjectifEvalue[];
  fiche: FicheComplete;
  /** AAAA-MM-JJ. */
  autoTransmiseLe: string | null;
  evaluationTransmiseLe: string | null;
  valideeLe: string | null;
  /** Le N+2 de l'agent ; `null` s'il n'y en a pas. */
  n2: PersonneDeLaCampagne | null;
  commentairesDuN2: CommentairesDuN2 | null;
  /** AAAA-MM-JJ : le jour où le N+1 l'a reprise au N+2, sans ses commentaires. */
  repriseAuN2Le: string | null;
  /** AAAA-MM-JJ. */
  transmiseLe: string;
  /** Le N+1 qui l'a transmise. */
  transmisePar: PersonneDeLaCampagne | null;
}

/* ────────────────────────────────────────────────────────────────
   L'administration de la campagne (ADR-0222) : les dates de l'évaluation
   et qui évalue qui, réservées aux comptes d'administration.
   ──────────────────────────────────────────────────────────────── */

/** Une personne désignée : son dossier, son nom, son poste. */
export interface PersonneDesignee extends PersonneDeLaCampagne {
  employeeId: string;
  matricule: string;
}

/** Un agent de la campagne, et qui l'évalue. */
export interface EvaluateurDeLAgent {
  employeeId: string;
  prenom: string;
  nom: string;
  matricule: string;
  poste: string | null;
  /** L'abrégé de la direction (« DCH »). */
  direction: string | null;
  /** Le N+1 de l'organigramme ; `null` : l'agent n'en a pas. */
  organigramme: PersonneDesignee | null;
  /** Le choix de l'administration pour la campagne ; `null` : le N+1 de l'organigramme. */
  choisi: PersonneDesignee | null;
  /** Transmise à la DCH, la fiche garde son évaluateur. */
  transmise: boolean;
}

export interface AdministrationDeLaCampagne {
  annee: number;
  periode: PeriodeDeLaCampagne | null;
  phase: PhaseDeLaCampagne;
  /** Les agents à évaluer cette année, par ordre alphabétique. */
  agents: EvaluateurDeLAgent[];
}

/** Les dates de l'évaluation : le début, la fin de l'auto-évaluation, la fin. */
export const datesDeLaCampagneSchema = z
  .object({ du: z.iso.date(), autoAu: z.iso.date(), au: z.iso.date() })
  .refine((p) => p.du <= p.autoAu, {
    message: 'La fin de l’auto-évaluation doit suivre le début de la période',
    path: ['autoAu'],
  })
  .refine((p) => p.autoAu <= p.au, {
    message: 'La fin de la période doit suivre la fin de l’auto-évaluation',
    path: ['au'],
  });
export type DatesDeLaCampagne = z.infer<typeof datesDeLaCampagneSchema>;

/** L'évaluateur d'un agent pour la campagne ; `null` : le N+1 de l'organigramme. */
export const choixDeLEvaluateurSchema = z.object({ evaluateurEmployeeId: z.uuid().nullable() });
export type ChoixDeLEvaluateur = z.infer<typeof choixDeLEvaluateurSchema>;
