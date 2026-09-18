/* ————————————————————————————————————————————————————————————————
   L'import d'un fichier d'effectif : ce que le serveur en rend.

   L'import ne se fait JAMAIS à l'aveugle. Le même envoi sert deux fois : une
   première pour voir (`dryRun`), une seconde pour appliquer. Le rapport a la
   même forme dans les deux cas — c'est ce qui permet à l'écran d'aperçu et à
   l'écran de résultat d'être le même tableau, lu deux fois.
   ———————————————————————————————————————————————————————————————— */

/** Le sort d'une ligne du fichier. */
export type EtatLigneImport =
  /** Prête : le dossier sera créé (ou l'a été). */
  | 'a-creer'
  /** Le matricule existe déjà dans la plateforme — le dossier reste intact. */
  | 'ignore'
  /** Une donnée manque ou ne se comprend pas : la ligne ne crée rien. */
  | 'erreur';

/**
 * Ce qui MANQUERA au dossier créé, sans empêcher sa création.
 *
 * À ne pas confondre avec le motif d'un refus : celui-ci dit pourquoi rien
 * n'est écrit, ceux-là disent ce que le dossier n'aura pas. Une même ligne
 * peut en porter plusieurs — un abrégé de direction inconnu ET un matricule
 * de responsable introuvable —, et n'en montrer qu'un ferait corriger la
 * moitié du problème.
 */
export interface AvertissementImport {
  /** L'intitulé de la colonne en cause, pour retrouver la case du tableur. */
  colonne: string;
  texte: string;
}

export interface LigneImport {
  /** Numéro de ligne DANS LE FICHIER — la RH corrige dans son tableur. */
  ligne: number;
  matricule: string | null;
  nom: string | null;
  poste: string | null;
  /** L'abrégé tel que le fichier l'écrit (« DIPE »). */
  uniteAbrege: string | null;
  /** L'unité retrouvée dans l'organigramme, ou null si l'abrégé est inconnu. */
  uniteResolue: string | null;
  /** Le matricule du responsable hiérarchique, tel que le fichier l'écrit. */
  responsable: string | null;
  /** Le nom du responsable retrouvé, ou null si le matricule est introuvable. */
  responsableResolu: string | null;
  etat: EtatLigneImport;
  /** Pour une ligne refusée ou ignorée : ce qui cloche, en une phrase. */
  motif: string | null;
  /** L'intitulé de la colonne fautive, quand une seule est en cause. */
  colonne: string | null;
  /** Ce qui manquera au dossier, sans l'empêcher d'exister. */
  avertissements: AvertissementImport[];
}

export interface RapportImportEmployes {
  /** Le nom de l'onglet lu — pour que la RH sache qu'on a lu le bon. */
  feuille: string;
  /** Intitulés présents dans le fichier que l'import ne sait pas placer. */
  colonnesInconnues: string[];
  /** Colonnes indispensables absentes du fichier : rien ne peut être importé. */
  colonnesManquantes: string[];
  lignes: LigneImport[];
  total: number;
  aCreer: number;
  ignores: number;
  erreurs: number;
  /** Dossiers créés sans rattachement d'unité, faute d'un abrégé connu. */
  sansUnite: number;
  /** Dossiers dont le responsable hiérarchique a été retrouvé et rattaché. */
  rattaches: number;
  /**
   * Dossiers qui entrent SANS responsable hiérarchique — colonne vide ou
   * matricule introuvable. Ils ne pourront ni recevoir d'objectifs ni être
   * évalués avant qu'on leur en désigne un : c'est le contrôle de la chaîne
   * hiérarchique qui les reprend ensuite.
   */
  sansResponsable: number;
  /** Faux en aperçu : rien n'a été écrit dans la base. */
  applique: boolean;
  crees: number;
}
