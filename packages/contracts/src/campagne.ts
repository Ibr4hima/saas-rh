import type { PersonnelDeLaFiche } from './entretien-annuel';

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
}

export interface AccueilDeLaCampagne {
  annee: number;
  periode: PeriodeDeLaCampagne | null;
  phase: PhaseDeLaCampagne;
  /** `null` : le compte n'a pas de dossier d'agent en activité. */
  moi: AgentDeLaCampagne | null;
  /** Les agents qu'évalue la personne connectée ; vide s'il n'y en a pas. */
  equipe: AgentDeLEquipe[];
}

/** Un agent de l'équipe, tel que son évaluateur l'ouvre depuis sa carte. */
export interface EvaluationDeLAgent {
  annee: number;
  periode: PeriodeDeLaCampagne | null;
  phase: PhaseDeLaCampagne;
  agent: AgentDeLaCampagne;
}
