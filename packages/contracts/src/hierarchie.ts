/**
 * La chaîne hiérarchique, et son contrôle.
 *
 * Deux règles, décidées avec l'APIX :
 *
 *   1. TOUT agent actif a un responsable (n+1) — sauf le directeur général,
 *      qui n'en a pas dans l'agence (il répond au conseil d'administration).
 *   2. Ce responsable appartient à la MÊME DIRECTION que l'agent. L'exception
 *      est le directeur lui-même : son n+1 est le directeur général.
 *
 * Elles ne sont pas décoratives : tout le module d'évaluation en dépend. Une
 * campagne ouverte sur un effectif où trente agents n'ont pas de n+1, c'est
 * trente personnes que personne ne peut évaluer, découvert en décembre. D'où
 * ce contrôle, qui se lit AVANT d'ouvrir quoi que ce soit.
 */

/**
 * Ce qui peut clocher dans la chaîne, du plus bloquant au plus bénin.
 *
 * Une seule anomalie par agent — la première de cette liste qui s'applique.
 * En afficher trois pour le même dossier n'aide pas : on corrige la fiche une
 * fois, et le contrôle se relit.
 */
export type TypeAnomalieHierarchie =
  /** L'agent appartient à une boucle : A relève de B qui relève de A. */
  | 'boucle'
  /** Le directeur général a un n+1 : il entrerait dans l'équipe de quelqu'un. */
  | 'dg_rattache'
  /** Actif, sans n+1, et ce n'est pas le directeur général. */
  | 'sans_responsable'
  /** Le n+1 désigné a un dossier archivé : il n'encadre plus personne. */
  | 'responsable_archive'
  /** Un directeur dont le n+1 n'est pas le directeur général. */
  | 'directeur_mal_rattache'
  /** Le n+1 appartient à une autre direction. */
  | 'hors_direction'
  /** Sans affectation : la règle de direction n'est pas vérifiable. */
  | 'sans_direction';

export interface AnomalieHierarchie {
  employeeId: string;
  matricule: string;
  nom: string;
  /** La direction de l'agent, telle que l'organigramme la donne. */
  direction: string | null;
  type: TypeAnomalieHierarchie;
  /** Le n+1 désigné, quand il y en a un — c'est souvent lui le problème. */
  responsable: string | null;
  /** La direction du n+1, pour que « hors direction » se lise sans chercher. */
  directionDuResponsable: string | null;
}

/**
 * Les anomalies qui EMPÊCHENT d'évaluer, par opposition à celles qu'il faut
 * corriger sans qu'elles arrêtent quoi que ce soit.
 *
 * Un agent sans n+1 — ou dont le n+1 est archivé, ou pris dans une boucle —
 * ne peut ni recevoir d'objectifs ni être évalué : il n'y a personne pour les
 * lui fixer ni pour l'évaluer. Ce n'est pas une punition, c'est une
 * impossibilité. Un rattachement hors direction, lui, est une entorse à la
 * règle : quelqu'un peut l'évaluer, et la fiche se corrige sans bloquer la
 * campagne.
 *
 * Les dossiers déjà créés sans n+1 ne sont donc jamais supprimés ni modifiés
 * d'office : ils sont SIGNALÉS, et restent hors du champ de l'évaluation le
 * temps qu'on leur désigne un responsable.
 */
export const ANOMALIES_BLOQUANTES: TypeAnomalieHierarchie[] = [
  'boucle',
  'sans_responsable',
  'responsable_archive',
];

/**
 * Pourquoi un rattachement a changé sans qu'on touche à la fiche : c'est une
 * CASCADE, la conséquence qu'impose une règle quand l'organigramme bouge.
 */
export type MotifChangement =
  /** Le nouveau directeur général perd son n+1 : il ne relève de personne. */
  | 'devient_dg'
  /** Relevait de l'ancien DG : relève du nouveau. */
  | 'suit_le_dg'
  /** Un directeur relève du directeur général. */
  | 'directeur'
  /** L'ancien DG, resté à la Direction Générale, relève du nouveau. */
  | 'ancien_dg'
  /** Rattaché au DG le temps que sa direction ait une tête : relève du directeur. */
  | 'direction_pourvue'
  /** L'ancien directeur, resté dans la direction, relève du nouveau. */
  | 'ancien_directeur'
  /** L'équipe d'un agent qui part passe à son repreneur. */
  | 'reprise_equipe'
  /** Le repreneur, pris dans l'équipe, prend la place du partant. */
  | 'prend_la_place';

export interface ChangementRattachement {
  employeeId: string;
  nom: string;
  /** Le n+1 d'avant, et celui d'après — `null` : aucun. */
  avant: string | null;
  apres: string | null;
  motif: MotifChangement;
}

/**
 * Ce qu'une opération fait à la chaîne : les rattachements qu'elle change
 * d'elle-même, et ceux qu'elle rend FAUX et qu'il faudra revoir. Sert deux
 * fois : en aperçu, avant de valider ; en compte rendu, après.
 */
export interface ConsequencesHierarchie {
  changements: ChangementRattachement[];
  aRevoir: AnomalieHierarchie[];
}

export function bloqueLEvaluation(type: TypeAnomalieHierarchie): boolean {
  return ANOMALIES_BLOQUANTES.includes(type);
}

export interface ControleHierarchie {
  /** Le directeur général : le responsable de l'unité racine. */
  directeurGeneral: { employeeId: string; nom: string } | null;
  /**
   * Les unités au sommet, quand il y en a PLUSIEURS — vide sinon. Il n'en
   * faut qu'une (la Direction Générale) : deux sommets, c'est deux « DG ».
   */
  sommetsMultiples: string[];
  /** Agents actifs examinés. */
  effectif: number;
  anomalies: AnomalieHierarchie[];
  /** Le décompte par type, pour l'annoncer sans parcourir la liste. */
  parType: Record<TypeAnomalieHierarchie, number>;
  /** Agents qui ne peuvent ni recevoir d'objectifs ni être évalués. */
  nonEvaluables: number;
}
