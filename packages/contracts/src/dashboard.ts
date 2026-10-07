/**
 * Tableau de bord — l'écran d'accueil répond à trois questions, dans l'ordre :
 * « Y a-t-il quelque chose qui m'attend ? », « Qui est là ? », « Que se
 * passe-t-il bientôt ? ». Tout ce contrat sert ces trois questions ; ce qui ne
 * s'y range pas n'a rien à y faire.
 */

export interface DashboardDirectionHeadcount {
  /** L'unité elle-même : la barre mène à l'organigramme, ouvert dessus. */
  id: string;
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
  /** Absents AUJOURD'HUI (congé approuvé couvrant la date du jour). */
  absentToday: number;
  /**
   * L'âge moyen de l'effectif actif de toute l'organisation, en années
   * révolues, à une décimale : sur les agents dont la date de naissance est
   * connue (`agesKnown`). null : aucune n'est connue.
   */
  averageAge: number | null;
  /** Le plus jeune et le plus âgé, en années révolues. */
  youngestAge: number | null;
  oldestAge: number | null;
  /** Combien d'agents actifs ont une date de naissance connue. */
  agesKnown: number;
  /** Absences approuvées démarrant dans les 30 prochains jours. */
  upcomingAbsences: number;
  /** Parité de l'effectif actif. */
  women: number;
  men: number;
  headcountByDirection: DashboardDirectionHeadcount[];
  /**
   * Fenêtre de fériés autour d'aujourd'hui : le dernier passé (s'il y en a
   * un) puis les trois suivants, par date croissante. Le passé sert d'ancre à
   * la frise — sans lui, « aujourd'hui » n'aurait rien devant quoi se poser.
   */
  holidayWindow: DashboardHoliday[];
  /** Tous les contrats à durée limitée, les plus urgents d'abord. Vide hors RH/paie. */
  contractFollowUp: DashboardContractFollowUp[];
}
