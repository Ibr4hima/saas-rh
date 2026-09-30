import { z } from 'zod';
import type { StatutSuivi } from './academy';

/* ————————————————————————————————————————————————————————————————
   Les objectifs — trois niveaux qui descendent l'organigramme.

   · l'APIX : ses orientations, que le directeur général fixe et diffuse à
     tous les agents, ou aux directeurs seulement ;
   · la direction : ses objectifs, que le directeur général fixe ;
   · l'agent : ses objectifs individuels, que son n+1 fixe — un objectif
     libre, ou une formation de l'APIX Academy à suivre, avec ou sans
     échéance.

   Un objectif appartient à une année. Qui l'a fixé l'évalue : atteint,
   partiellement, non atteint. Une formation s'évalue d'elle-même : elle est
   atteinte quand l'agent l'a terminée — certifiée si elle s'évalue.
   ———————————————————————————————————————————————————————————————— */

export const NIVEAUX_OBJECTIF = ['apix', 'direction', 'individuel'] as const;
export type NiveauObjectif = (typeof NIVEAUX_OBJECTIF)[number];

export const DIFFUSIONS_OBJECTIF = ['tous', 'directeurs'] as const;
export type DiffusionObjectif = (typeof DIFFUSIONS_OBJECTIF)[number];

export const NATURES_OBJECTIF = ['libre', 'formation'] as const;
export type NatureObjectif = (typeof NATURES_OBJECTIF)[number];

export const EVALUATIONS_OBJECTIF = ['atteint', 'partiel', 'non_atteint'] as const;
export type EvaluationObjectif = (typeof EVALUATIONS_OBJECTIF)[number];

export const LIBELLES_EVALUATION: Record<EvaluationObjectif, string> = {
  atteint: 'Atteint',
  partiel: 'Partiellement atteint',
  non_atteint: 'Non atteint',
};

export const LIBELLES_DIFFUSION: Record<DiffusionObjectif, string> = {
  tous: 'Tous les agents',
  directeurs: 'Directeurs seulement',
};

/** Une formation à suivre, et où l'agent en est dans l'Academy. */
export interface FormationObjectif {
  /** `null` : la formation a été retirée du catalogue depuis. */
  courseId: string | null;
  statut: StatutSuivi | null;
  lecons: number;
  validees: number;
}

export interface ObjectifView {
  id: string;
  niveau: NiveauObjectif;
  annee: number;
  nature: NatureObjectif;
  titre: string;
  description: string | null;
  /** Date ISO (AAAA-MM-JJ), facultative. */
  echeance: string | null;
  diffusion: DiffusionObjectif | null;
  evaluation: EvaluationObjectif | null;
  commentaire: string | null;
  evalueLe: string | null;
  formation: FormationObjectif | null;
  /** Atteint : évalué comme tel, ou formation terminée. */
  atteint: boolean;
  /** L'échéance est passée sans que l'objectif soit atteint ni évalué. */
  enRetard: boolean;
  /** Qui l'a fixé. */
  auteur: string | null;
  creeLe: string;
}

/** « Mes objectifs » : ce que l'agent voit de l'APIX, de sa direction, et les siens. */
export interface MesObjectifs {
  annee: number;
  apix: ObjectifView[];
  direction: { id: string; nom: string; objectifs: ObjectifView[] } | null;
  individuels: ObjectifView[];
  /** Ses fiches, rédigées par son n+1 — les plus récentes d'abord ; une
      fiche vide n'y figure pas. */
  fiches: FicheObjectifs[];
  /** Les formations qu'il a commencées, pour les blocs « Formation ». */
  formations: FormationDeLaFiche[];
}

// ---------- Fiche d'objectifs (éditeur de blocs) ----------

/**
 * Où en est l'agent d'une formation de l'APIX Academy — ce qu'un bloc
 * « Formation » de sa fiche affiche.
 */
export interface FormationDeLaFiche {
  courseId: string;
  statut: StatutSuivi;
  lecons: number;
  validees: number;
}

/** Le semestre d'une fiche : le 1er (janvier-juin), le 2nd (juillet-décembre). */
export type Semestre = 1 | 2;

/** « Objectifs du 1er semestre de 2026 ». */
export function titreDuSemestre(semestre: Semestre, annee: number): string {
  return `Objectifs du ${semestre === 1 ? '1er' : '2nd'} semestre de ${annee}`;
}

/**
 * La fiche d'objectifs d'un agent pour un semestre : les blocs de l'éditeur,
 * tels qu'enregistrés (cases à cocher, échéances, formations…).
 */
export interface FicheObjectifs {
  annee: number;
  semestre: Semestre;
  contenu: Record<string, unknown>[];
  /** Dernière mise à jour, et par qui. */
  majLe: string;
  auteur: string | null;
}

/** La fiche fait au plus 300 000 caractères une fois sérialisée. */
export const FICHE_OBJECTIFS_MAX = 300_000;

export const enregistrerFicheObjectifsSchema = z.object({
  annee: z.number().int().min(2000).max(2100).optional(),
  semestre: z.union([z.literal(1), z.literal(2)]),
  contenu: z.array(z.record(z.string(), z.unknown())).max(2000),
});
export type EnregistrerFicheObjectifsInput = z.infer<typeof enregistrerFicheObjectifsSchema>;

/** Un membre de l'équipe, et où en sont ses objectifs de l'année. */
export interface MembreSuivi {
  employeeId: string;
  givenName: string;
  familyName: string;
  number: string;
  positionTitle: string | null;
  unitName: string | null;
  /** La direction de son unité d'affectation — l'abrégé et le nom. */
  directionShortName: string | null;
  directionName: string | null;
  workEmail: string | null;
  workPhone: string | null;
  /** Le téléphone portable. */
  phone: string | null;
  total: number;
  atteints: number;
  enRetard: number;
}

export interface SuiviEquipe {
  annee: number;
  membres: MembreSuivi[];
}

export interface FicheSuivi {
  annee: number;
  membre: MembreSuivi;
  objectifs: ObjectifView[];
  /** Toutes ses fiches, les plus récentes d'abord ; une fiche vide n'y figure pas. */
  fiches: FicheObjectifs[];
  /** Les formations qu'il a commencées, pour les blocs « Formation ». */
  formations: FormationDeLaFiche[];
}

/** « Objectifs de l'APIX » : ce que le directeur général fixe. */
export interface ObjectifsAPIX {
  annee: number;
  orientations: ObjectifView[];
  directions: {
    id: string;
    nom: string;
    directeur: string | null;
    objectifs: ObjectifView[];
  }[];
}

/** Une formation publiée qu'un n+1 peut donner à suivre. */
export interface FormationProposable {
  id: string;
  title: string;
}

const titreSchema = z.string().trim().min(2, 'Deux caractères au moins').max(200);
const descriptionSchema = z.string().trim().max(2000).nullable().optional();
const echeanceSchema = z.iso.date().nullable().optional();

export const creerObjectifSchema = z
  .object({
    niveau: z.enum(NIVEAUX_OBJECTIF),
    annee: z.number().int().min(2000).max(2100).optional(),
    diffusion: z.enum(DIFFUSIONS_OBJECTIF).optional(),
    directionId: z.uuid().optional(),
    employeeId: z.uuid().optional(),
    nature: z.enum(NATURES_OBJECTIF).default('libre'),
    courseId: z.uuid().optional(),
    titre: titreSchema.optional(),
    description: descriptionSchema,
    echeance: echeanceSchema,
  })
  .superRefine((o, ctx) => {
    const manque = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    if (o.niveau === 'apix' && !o.diffusion) manque('diffusion', 'À qui le diffuser ?');
    if (o.niveau === 'direction' && !o.directionId) manque('directionId', 'Quelle direction ?');
    if (o.niveau === 'individuel' && !o.employeeId) manque('employeeId', 'Pour quel agent ?');
    if (o.nature === 'formation') {
      if (o.niveau !== 'individuel') manque('nature', 'Une formation se fixe à un agent');
      if (!o.courseId) manque('courseId', 'Quelle formation ?');
    } else if (!o.titre) {
      manque('titre', 'Intitulé requis');
    }
  });
export type CreerObjectifInput = z.infer<typeof creerObjectifSchema>;

export const modifierObjectifSchema = z.object({
  titre: titreSchema.optional(),
  description: descriptionSchema,
  echeance: echeanceSchema,
  diffusion: z.enum(DIFFUSIONS_OBJECTIF).optional(),
});
export type ModifierObjectifInput = z.infer<typeof modifierObjectifSchema>;

/** `evaluation: null` : retirer l'évaluation. */
export const evaluerObjectifSchema = z.object({
  evaluation: z.enum(EVALUATIONS_OBJECTIF).nullable(),
  commentaire: z.string().trim().max(1000).nullable().optional(),
});
export type EvaluerObjectifInput = z.infer<typeof evaluerObjectifSchema>;

export const anneeQuerySchema = z.object({
  annee: z.coerce.number().int().min(2000).max(2100).optional(),
});
