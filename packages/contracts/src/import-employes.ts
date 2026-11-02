import { z } from 'zod';

/* ────────────────────────────────────────────────────────────────
   L'import du fichier du personnel tenu par la DCH (ADR-0159) : ce que le
   serveur en rend.

   L'import ne se fait jamais à l'aveugle. Le même envoi sert deux fois :
   une première pour voir (`apercu=1`), une seconde pour appliquer. L'aperçu
   joue l'import en entier puis l'annule : il dit ce que l'import fera, pas
   ce qu'il devrait faire. Le rapport a la même forme dans les deux cas.
   ──────────────────────────────────────────────────────────────── */

/** Le sort d'une ligne du fichier. */
export type EtatLigneImport =
  /** Matricule inconnu : le dossier sera créé (ou l'a été). */
  | 'a-creer'
  /** Le dossier existe : la fiche reçoit ce que le fichier change. */
  | 'a-modifier'
  /** Le dossier existe, et le fichier n'y change rien. */
  | 'inchange'
  /** La ligne ne crée ni ne modifie rien. */
  | 'erreur';

/** Ce qui manquera au dossier, ou ce qui n'a pas pu se faire, sans bloquer la ligne. */
export interface AvertissementImport {
  /** L'intitulé de la colonne en cause, pour retrouver la case du tableur. */
  colonne: string;
  texte: string;
}

/** Une valeur du fichier corrigée à la lecture : « St Louis » devient Saint-Louis. */
export interface CorrectionImport {
  colonne: string;
  lu: string;
  retenu: string;
}

/** Ce que la ligne change sur une fiche existante. */
export interface ChangementImport {
  champ: string;
  /** null : la fiche n'avait rien. */
  avant: string | null;
  apres: string;
}

/** Une personne qui porte le nom écrit dans le fichier. */
export interface CandidatImport {
  /** `d:<id>` pour un dossier existant, `l:<ligne>` pour une ligne du fichier. */
  cle: string;
  nom: string;
  /** Matricule, poste, direction : de quoi reconnaître la bonne personne. */
  detail: string;
}

/** Le choix qui écarte tout candidat : l'agent garde son N+1 par défaut. */
export const CHOIX_AUCUN = 'aucun';

/** Les homonymes départagés, renvoyés avec le fichier : la clé du choix, le candidat retenu. */
export const choixDImportSchema = z
  .record(z.string().max(300), z.string().max(60))
  .refine((c) => Object.keys(c).length <= 500, 'Trop de choix');

/**
 * Un nom porté par plusieurs personnes : l'import demande de qui il s'agit.
 * Un même nom, pour les agents d'une même direction, se départage une fois.
 */
export interface ChoixImport {
  /** La clé du choix, à renvoyer avec le candidat retenu. */
  cle: string;
  role: 'n1' | 'fonctionnel';
  colonne: string;
  /** Le nom tel que le fichier l'écrit. */
  nom: string;
  /** Les lignes du fichier qui le citent. */
  lignes: number[];
  candidats: CandidatImport[];
  /** Le candidat retenu, ou `aucun` ; null tant que rien n'est choisi. */
  retenu: string | null;
}

export interface LigneImport {
  /** Numéro de ligne dans le fichier : la DCH corrige dans son tableur. */
  ligne: number;
  matricule: string | null;
  /** Un matricule en double dans le fichier reçoit 50-A, 50-B. */
  matriculeProvisoire: boolean;
  nom: string | null;
  poste: string | null;
  /** L'unité de l'agent, telle que l'organigramme la nomme. */
  unite: string | null;
  /** Le N+1 de l'agent, une fois l'import joué. */
  responsable: string | null;
  etat: EtatLigneImport;
  /** Pour une ligne en erreur : ce qui cloche, en une phrase. */
  motif: string | null;
  /** L'intitulé de la colonne fautive, quand une seule est en cause. */
  colonne: string | null;
  corrections: CorrectionImport[];
  changements: ChangementImport[];
  avertissements: AvertissementImport[];
  /** Son adresse professionnelle : l'invitation au portail y part. */
  emailPro?: string | null;
  /** Le dossier créé ou modifié. */
  employeeId?: string | null;
}

/**
 * Les noms corrigés dans l'aperçu, renvoyés avec le fichier : la clé de
 * l'unité à créer, le nom qu'elle prendra.
 */
export const nomsDUnitesSchema = z
  .record(z.string().max(400), z.string().trim().min(1).max(120))
  .refine((n) => Object.keys(n).length <= 200, 'Trop de noms');

/** Une unité que l'import crée, faute de la trouver dans l'organigramme. */
export interface UniteCreeeImport {
  /** La clé de l'unité, à renvoyer avec son nom corrigé. */
  cle: string;
  nom: string;
  /** Le nom que l'import tire du fichier, avant toute correction dans l'aperçu. */
  propose: string;
  /** La direction, ou le département, sous lequel elle se range. */
  parent: string;
  /** Pourquoi elle n'a pas pu être créée : ses agents vont à l'unité au-dessus. */
  echec?: string | null;
}

/** Une désignation que l'import fait : responsable d'unité, DG ou DGA. */
export interface DesignationImport {
  /** « Directeur de la DFC », « Cheffe du département Études ». */
  poste: string;
  nom: string;
}

/**
 * « Vider l'import » (ADR-0165) : ce que le vidage supprime, ou a supprimé.
 * L'administrateur seul le voit et le lance.
 */
export interface BilanDuVidage {
  /** Les dossiers que l'import a créés, actifs ou inactifs. */
  dossiers: number;
  /** Les comptes de ces agents, fermés avec leur dossier. Ceux des administrateurs restent. */
  comptes: number;
  /** Les unités que l'import a créées. */
  unites: number;
  /** Parmi elles, celles qui restent : une unité, un dossier ou une offre saisis à la main y tiennent. */
  unitesGardees: number;
}

export interface RapportImportEmployes {
  /** Le nom de l'onglet lu : la DCH voit qu'on a lu le bon. */
  feuille: string;
  /** Intitulés présents dans le fichier que l'import ne sait pas placer. */
  colonnesInconnues: string[];
  /** Colonnes indispensables absentes du fichier : rien ne peut être importé. */
  colonnesManquantes: string[];
  /** Colonnes remplies que l'import ne reprend pas : la rémunération, sans l'accès aux données sensibles. */
  colonnesNonImportees: string[];
  lignes: LigneImport[];
  unitesCreees: UniteCreeeImport[];
  designations: DesignationImport[];
  /** Les homonymes à départager avant d'appliquer. */
  choix: ChoixImport[];
  total: number;
  aCreer: number;
  aModifier: number;
  inchanges: number;
  erreurs: number;
  /** Dossiers créés ou modifiés qui restent sans N+1. */
  sansN1: number;
  /** Faux en aperçu : rien n'a été écrit dans la base. */
  applique: boolean;
}
