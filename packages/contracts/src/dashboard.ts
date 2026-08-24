/**
 * Tableau de bord — l'écran d'accueil répond à trois questions, dans l'ordre :
 * « Y a-t-il quelque chose qui m'attend ? », « Qui est là ? », « Que se
 * passe-t-il bientôt ? ». Tout ce contrat sert ces trois questions ; ce qui ne
 * s'y range pas n'a rien à y faire.
 */

export interface DashboardDirectionHeadcount {
  name: string;
  shortName: string | null;
  /** Employés ACTIFS affectés à la direction ou à une unité en dessous. */
  headcount: number;
}

export interface DashboardHoliday {
  day: string;
  label: string;
}

/**
 * Un contrat à durée limitée en cours de suivi (CDD ou stage).
 * Le contrat retenu est le PLUS RÉCENT de l'employé : un CDD renouvelé en CDI
 * sort du suivi de lui-même, sans quoi l'ancien CDD y resterait à vie.
 */
export interface DashboardContractFollowUp {
  employeeId: string;
  employeeNumber: string;
  name: string;
  positionTitle: string | null;
  /** 'cdd' | 'stage' — les seuls types à durée limitée suivis ici. */
  contractType: string;
  /** null = date de fin non saisie : anomalie à corriger, pas à masquer. */
  endDate: string | null;
  /** Jours restants. Négatif = échéance dépassée. null = pas de date de fin. */
  daysLeft: number | null;
}

export interface DashboardView {
  activeEmployees: number;
  /** Recrutés au cours des 90 derniers jours — le pouls des arrivées. */
  hiredLast90d: number;
  /** Absents AUJOURD'HUI (congé approuvé couvrant la date du jour). */
  absentToday: number;
  /** Demandes de congés en attente d'un visa. */
  pendingRequests: number;
  /** Absences approuvées démarrant dans les 30 prochains jours. */
  upcomingAbsences: number;
  orgUnits: number;
  /** Files RH — 0 pour les rôles qui ne les traitent pas. */
  pendingDocumentRequests: number;
  pendingProfileChanges: number;
  /** Parité de l'effectif actif. */
  women: number;
  men: number;
  headcountByDirection: DashboardDirectionHeadcount[];
  upcomingHolidays: DashboardHoliday[];
  /** Contrats à durée limitée, les plus urgents d'abord. Vide hors RH/paie. */
  contractFollowUp: DashboardContractFollowUp[];
  /** Total suivi, y compris ce que la carte ne montre pas — pas de troncature muette. */
  contractFollowUpTotal: number;
}
