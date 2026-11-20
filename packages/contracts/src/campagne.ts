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

/** L'évaluation d'un agent par son N+1 (ADR-0216, ADR-0217). */
export type EtatDeLEvaluation =
  | 'a_faire'
  | 'en_cours'
  /** Renvoyée par l'agent, avec un mot : le N+1 la reprend. */
  | 'renvoyee'
  /** Transmise à l'agent, qui la lit, puis la valide ou la renvoie. */
  | 'transmise'
  /** Validée par l'agent : elle ne change plus. */
  | 'validee';

/**
 * Son évaluation par le N+1, vue par l'agent (ADR-0217) : tant que le N+1
 * ne l'a pas transmise, l'agent n'en sait rien de plus.
 */
export type EtatDeMonEvaluation = 'en_attente' | 'a_valider' | 'renvoyee' | 'validee';

/** Le mot de l'agent qui renvoie son évaluation au N+1. */
export interface RenvoiDeLEvaluation {
  mot: string;
  /** AAAA-MM-JJ. */
  le: string;
}

/** Son évaluation par le N+1, sur son accueil. */
export interface EvaluationRecue {
  etat: EtatDeMonEvaluation;
  /** AAAA-MM-JJ : le jour où le N+1 l'a transmise. */
  transmiseLe: string | null;
  /** AAAA-MM-JJ : le jour où l'agent l'a validée. */
  valideeLe: string | null;
  /** AAAA-MM-JJ : le jour du renvoi au N+1, tant qu'elle n'est pas revenue. */
  renvoyeeLe: string | null;
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
  auto: AutoDeLAgent;
  /** Où en est son évaluation par la personne connectée (ADR-0216). */
  evaluation: EtatDeLEvaluation;
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
  /** Le mot de l'agent qui l'a renvoyée, tant que le N+1 ne l'a pas transmise à nouveau. */
  renvoi: RenvoiDeLEvaluation | null;
  /**
   * Ouverte à l'écriture du N+1 : l'auto-évaluation transmise, pendant la
   * période de l'année, tant que l'évaluation n'est pas transmise, ou une
   * fois renvoyée par l'agent.
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
  /** Le mot de son renvoi, tant que l'évaluation n'est pas revenue. */
  renvoi: RenvoiDeLEvaluation | null;
  /** À valider : transmise, pas encore validée. */
  validable: boolean;
  /** À renvoyer, s'il y a lieu : tant que le N+1 peut encore la reprendre. */
  renvoyable: boolean;
}

/** Le renvoi de son évaluation au N+1 : son mot, obligatoire. */
export const renvoiSchema = z.object({
  mot: z.string().trim().min(1).max(LONGUEURS_DE_LA_FICHE.texte),
});
export type Renvoi = z.infer<typeof renvoiSchema>;
