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
  etat: EtatLigneImport;
  /** Pour une erreur ou un abrégé inconnu : ce qui cloche, en une phrase. */
  motif: string | null;
  /** L'intitulé de la colonne fautive, quand une seule est en cause. */
  colonne: string | null;
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
  /** Dossiers créés sans rattachement, faute d'un abrégé connu. */
  sansUnite: number;
  /** Faux en aperçu : rien n'a été écrit dans la base. */
  applique: boolean;
  crees: number;
}
