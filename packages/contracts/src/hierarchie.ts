import { z } from 'zod';

/**
 * Les deux N+1 (ADR-0147), et le contrôle de la chaîne.
 *
 * Le N+1 HIÉRARCHIQUE se calcule à partir de l'organigramme : ce N+1 vise
 * les congés et voit l'équipe. Le N+1 FONCTIONNEL se choisit : ce N+1 fixe
 * les objectifs et évalue ; par défaut, c'est le hiérarchique.
 *
 * Le hiérarchique ne se saisissant plus, ce N+1 ne peut plus être « faux » :
 * le contrôle ne signale que ce qui EMPÊCHE de le calculer.
 */

/** Ce qui empêche de calculer le N+1 hiérarchique d'un agent. */
export type TypeAnomalieHierarchie =
  /** Sans affectation à une unité : rien ne dit de qui l'agent relève. */
  | 'sans_unite'
  /** Personne au-dessus : la Direction Générale n'a pas de DG. */
  | 'sans_dg'
  /** Le DG est affecté hors de la Direction Générale. */
  | 'dg_hors_direction_generale';

export interface AnomalieHierarchie {
  employeeId: string;
  matricule: string;
  nom: string;
  /** La direction de l'agent, telle que l'organigramme la donne. */
  direction: string | null;
  type: TypeAnomalieHierarchie;
  /** Son N+1 fonctionnel choisi, le cas échéant : c'est ce N+1 qui évalue. */
  responsable: string | null;
  directionDuResponsable: string | null;
}

/**
 * Les anomalies qui EMPÊCHENT d'évaluer, faute de N+1 fonctionnel choisi :
 * il n'y a personne pour fixer les objectifs ni pour évaluer.
 */
export const ANOMALIES_BLOQUANTES: TypeAnomalieHierarchie[] = ['sans_unite', 'sans_dg'];

/** Pourquoi un N+1 a changé : la règle que l'organigramme applique. */
export type MotifChangement =
  /** Le DG : ne relève de personne. */
  | 'dg'
  /** Tête d'une direction : relève du DG. */
  | 'tete_de_direction'
  /** Le DGA : relève du DG. */
  | 'dga'
  /** Tête d'un département ou d'un service : relève de la tête de l'unité au-dessus. */
  | 'unite_au_dessus'
  /** Relève de la tête de son unité. */
  | 'tete_de_son_unite'
  /** Son unité est sans tête : relève du premier niveau occupé au-dessus. */
  | 'niveau_au_dessus'
  /** Rattaché directement à la Direction Générale : relève du DG. */
  | 'direction_generale'
  /** À la Direction Générale, la place que la DCH a choisie : le DGA ou une tête d'unité. */
  | 'rattachement_choisi'
  /** Sans unité : plus de N+1 hiérarchique. */
  | 'sans_unite'
  /** Personne au-dessus : la Direction Générale n'a pas de DG. */
  | 'sans_dg'
  /** Son N+1 fonctionnel ne peut plus l'être : l'agent revient au hiérarchique. */
  | 'fonctionnel_retire';

export interface ChangementRattachement {
  employeeId: string;
  nom: string;
  /** Le N+1 d'avant, et le N+1 d'après : `null`, aucun. */
  avant: string | null;
  apres: string | null;
  motif: MotifChangement;
}

/**
 * Ce qu'une opération fait à la chaîne : les N+1 qu'elle change. Sert deux
 * fois : en aperçu, avant de valider ; en compte rendu, après. `aRevoir` :
 * ce qu'elle laisse sans N+1 hiérarchique.
 */
export interface ConsequencesHierarchie {
  changements: ChangementRattachement[];
  aRevoir: AnomalieHierarchie[];
}

export function bloqueLEvaluation(type: TypeAnomalieHierarchie): boolean {
  return ANOMALIES_BLOQUANTES.includes(type);
}

/** Un agent dont la règle de l'ADR-0147 a changé le N+1, à revoir une fois. */
export interface ChangementParLaRegle {
  employeeId: string;
  matricule: string;
  nom: string;
  /** Son n+1 d'avant la règle. */
  avant: { id: string; nom: string };
  /** Son N+1 hiérarchique, désormais ; `null` : aucun. */
  apres: { id: string; nom: string } | null;
}

export interface ControleHierarchie {
  /** Le DG : la tête de l'unité racine. */
  directeurGeneral: { employeeId: string; nom: string } | null;
  /**
   * Les unités au sommet, quand il y en a PLUSIEURS — vide sinon. Il n'en
   * faut qu'une (la Direction Générale) : deux sommets, c'est deux « DG ».
   */
  sommetsMultiples: string[];
  /** Les directions rattachées ailleurs qu'à la Direction Générale. */
  directionsHorsDG: string[];
  /** Agents actifs examinés. */
  effectif: number;
  anomalies: AnomalieHierarchie[];
  /** Le décompte par type, pour l'annoncer sans parcourir la liste. */
  parType: Record<TypeAnomalieHierarchie, number>;
  /** Agents qui ne peuvent ni recevoir d'objectifs ni être évalués. */
  nonEvaluables: number;
  /** Les N+1 que la règle a changés, à revoir une fois. */
  changesParLaRegle: ChangementParLaRegle[];
}

/** Revoir un N+1 changé par la règle : garder l'ancien comme N+1 fonctionnel, ou non. */
export const revoirLeChangementSchema = z.object({ garder: z.boolean() });
export type RevoirLeChangement = z.infer<typeof revoirLeChangementSchema>;
