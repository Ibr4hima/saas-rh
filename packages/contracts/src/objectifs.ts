import { z } from 'zod';
import type { StatutSuivi } from './academy';
import { MOIS_DE_L_ANNEE } from './document-requests';

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
  /** Ses fiches, une par année, rédigées par son n+1, les plus récentes
      d'abord ; une fiche vide n'y figure pas. */
  fiches: FicheObjectifs[];
  /** Les formations qu'il a commencées, pour les blocs « Formation ». */
  formations: FormationDeLaFiche[];
  /** Le jour de l'évaluation annuelle, « MM-JJ » : il borne les échéances de chaque année. */
  jourEvaluation: string;
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

/** « Objectifs de l’année 2026 ». */
export function titreDeLAnnee(annee: number): string {
  return `Objectifs de l’année ${annee}`;
}

/**
 * La fiche d'objectifs d'un agent pour une année : les blocs de l'éditeur,
 * tels qu'enregistrés (cases à cocher, échéances, formations…), une case
 * cochée quand l'agent dit l'objectif atteint ; et son évaluation, une par
 * an (ADR-0075).
 */
export interface FicheObjectifs {
  annee: number;
  contenu: Record<string, unknown>[];
  /** Dernière mise à jour, et par qui. */
  majLe: string;
  auteur: string | null;
  /**
   * Par objectif (l'id du bloc) : où l'agent dit en être. Seuls les statuts
   * qui répondent au texte actuel de l'objectif y figurent. Celui d'une
   * formation vient de l'APIX Academy, figé à l'envoi avec la fiche.
   */
  statuts: Record<string, StatutObjectif>;
  /** Les objectifs réécrits depuis que l'agent a dit où il en était : à revoir. */
  statutsCaducs: string[];
  /**
   * L'état des formations de la fiche, figé à l'envoi de l'auto-évaluation ;
   * `null` tant qu'elle n'est pas envoyée (il se lit alors au présent).
   */
  formations: FormationDeLaFiche[] | null;
  evaluation: EvaluationFiche;
}

/**
 * Où en est un objectif, selon l'agent : la case de la fiche en prend la
 * couleur — bleu, jaune, rouge.
 */
export const STATUTS_OBJECTIF = EVALUATIONS_OBJECTIF;
export type StatutObjectif = EvaluationObjectif;

export const LIBELLES_STATUT: Record<StatutObjectif, string> = {
  atteint: 'Atteint',
  partiel: 'Partiellement',
  non_atteint: 'Non atteint',
};

// ---------- Commentaires et évaluation de l'année ----------

/** L'appréciation globale du n+1. */
export const NOTES_GLOBALES = ['A', 'B', 'C', 'D'] as const;
export type NoteGlobale = (typeof NOTES_GLOBALES)[number];

export const LIBELLES_NOTE: Record<NoteGlobale, string> = {
  A: 'Dépasse les attentes',
  B: 'Conforme aux attentes',
  C: 'À améliorer',
  D: 'Insuffisant',
};

/**
 * Ce que l'agent et son n+1 disent des objectifs de l'année. Chacun ne
 * voit de l'autre que ce qui est envoyé : le n+1, les commentaires de l'agent
 * une fois son auto-évaluation envoyée ; l'agent, ceux du n+1 et la note une
 * fois validés. Les statuts, eux, se voient à mesure.
 */
export interface EvaluationFiche {
  /** Par objectif (l'id du bloc) : ce qu'en dit l'agent. */
  commentairesAgent: Record<string, string>;
  /** L'auto-évaluation envoyée au n+1 — `null` : encore au brouillon. Envoyée, plus rien ne change. */
  envoyesLe: string | null;
  /** Par objectif : ce qu'en dit le n+1. */
  commentairesN1: Record<string, string>;
  /**
   * Par case à cocher : son atteinte selon le n+1 (ADR-0076). Celle d'une
   * formation est le statut que lui donne l'APIX Academy.
   */
  atteintesN1: Record<string, StatutObjectif>;
  /** Les objectifs que le n+1 reporte à l'année suivante. */
  reportes: string[];
  note: NoteGlobale | null;
  /** `null` : encore au brouillon. */
  valideeLe: string | null;
  evaluateur: string | null;
}

/** Un objectif de l'année évaluée, et le résultat obtenu (ADR-0077). */
export interface ObjectifEvalue {
  id: string;
  texte: string;
  /**
   * L'atteinte retenue par le n+1 ; pour une formation, le statut de l'APIX
   * Academy. Une évaluation validée avant 0112 n'en a pas : l'auto-évaluation
   * de l'agent, seul résultat noté alors. `null` : rien n'a été dit.
   */
  atteinte: StatutObjectif | null;
}

/**
 * Une évaluation validée, telle que le dossier de l'agent la garde : l'année,
 * qui l'a évalué, la note, et chaque objectif avec son atteinte : la note
 * ne se lit jamais seule (ADR-0076).
 */
export interface EvaluationValidee {
  annee: number;
  /** Le n+1 qui l'a validée — `null` s'il n'a plus de dossier. */
  manager: string | null;
  note: NoteGlobale;
  valideeLe: string;
  objectifs: ObjectifEvalue[];
}

/** Combien d'objectifs sont atteints, partiellement atteints, non atteints. */
export function bilanDesAtteintes(
  atteintes: readonly (StatutObjectif | null | undefined)[],
): Record<StatutObjectif, number> {
  const bilan: Record<StatutObjectif, number> = { atteint: 0, partiel: 0, non_atteint: 0 };
  for (const a of atteintes) if (a) bilan[a] += 1;
  return bilan;
}

const commentaires = z
  .record(z.string().min(1).max(100), z.string().max(2000))
  .refine((c) => Object.keys(c).length <= 300, 'Trop d’objectifs');

/** `statut: null` : l'agent revient sur son choix. */
export const statutObjectifSchema = z.object({
  id: z.string().min(1).max(100),
  statut: z.enum(STATUTS_OBJECTIF).nullable(),
  /** L'empreinte du texte que l'agent avait sous les yeux (cf. `ObjectifDeLaFiche`). */
  empreinte: z.string().max(20_000).optional(),
});
export type StatutObjectifInput = z.infer<typeof statutObjectifSchema>;

export const evaluationN1Schema = z.object({
  commentaires,
  note: z.enum(NOTES_GLOBALES).nullable(),
  // Un écran ouvert avant l'atteinte par objectif (ADR-0076) n'envoie ni
  // l'une ni les autres.
  atteintes: z
    .record(z.string().min(1).max(100), z.enum(STATUTS_OBJECTIF))
    .refine((c) => Object.keys(c).length <= 300, 'Trop d’objectifs')
    .default({}),
  reportes: z.array(z.string().min(1).max(100)).max(300).default([]),
});
export type EvaluationN1Input = z.infer<typeof evaluationN1Schema>;

/** L'année d'une fiche, dans l'adresse. */
export const anneeParamsSchema = z.object({
  annee: z.coerce.number().int().min(2000).max(2100),
});

/**
 * Un objectif de la fiche : une case à cocher, ou une formation à suivre ;
 * son texte, et son contenu mis en forme.
 */
export interface ObjectifDeLaFiche {
  id: string;
  texte: string;
  /**
   * Ce que dit l'objectif, indépendamment de la mise en forme et de la langue
   * d'affichage : un statut répond à cette empreinte, pas à l'id du bloc.
   */
  empreinte: string;
  /** Le contenu du bloc, tel que l'éditeur l'enregistre (texte stylé, échéances…). */
  contenu: Record<string, unknown>[];
  /** L'échéance de l'objectif, date ISO ; facultative : sans elle, il vaut pour l'année. */
  echeance: string | null;
  /**
   * Un bloc « Formation » : la formation qu'il donne à suivre. Son statut ne
   * se choisit pas, il vient de l'APIX Academy (cf. `statutDeFormation`).
   */
  formation: string | null;
}

function texteDe(contenu: unknown): string {
  if (!Array.isArray(contenu)) return '';
  return contenu
    .map((c: Record<string, unknown>) => {
      if (c.type === 'text') return String(c.text ?? '');
      if (c.type === 'link') return texteDe(c.content);
      if (c.type === 'echeance') {
        const date = String((c.props as { date?: string } | undefined)?.date ?? '');
        const d = new Date(`${date}T00:00:00`);
        return Number.isNaN(d.getTime())
          ? date
          : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
      }
      return '';
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Le texte d'un objectif, ses liens et ses échéances en date ISO. */
function empreinteDe(contenu: unknown): string {
  if (!Array.isArray(contenu)) return '';
  return contenu
    .map((c: Record<string, unknown>) => {
      if (c.type === 'text') return String(c.text ?? '');
      if (c.type === 'link') return empreinteDe(c.content);
      if (c.type === 'echeance') {
        return `[${String((c.props as { date?: string } | undefined)?.date ?? '')}]`;
      }
      return '';
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Une date ISO (AAAA-MM-JJ) qui existe : pas de 30 février. */
function dateExistante(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const t = Date.parse(`${date}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === date;
}

/** L'échéance d'une case, quand elle en a une : une date ISO. */
export function echeanceDuBloc(b: Record<string, unknown>): string | null {
  const echeance = (b.props as { echeance?: unknown } | undefined)?.echeance;
  return typeof echeance === 'string' && dateExistante(echeance) ? echeance : null;
}

/**
 * Les objectifs d'une fiche : ses cases à cocher qui disent quelque chose, et
 * ses formations à suivre, dans l'ordre de lecture. Un paragraphe n'en est
 * pas un.
 */
export function objectifsDeLaFiche(contenu: Record<string, unknown>[]): ObjectifDeLaFiche[] {
  const tous: ObjectifDeLaFiche[] = [];
  const parcourir = (blocs: unknown) => {
    if (!Array.isArray(blocs)) return;
    for (const b of blocs as Record<string, unknown>[]) {
      if (b.type === 'checkListItem' && typeof b.id === 'string') {
        const texte = texteDe(b.content);
        if (texte) {
          tous.push({
            id: b.id,
            texte,
            empreinte: empreinteDe(b.content),
            contenu: Array.isArray(b.content) ? (b.content as Record<string, unknown>[]) : [],
            echeance: echeanceDuBloc(b),
            formation: null,
          });
        }
      }
      if (b.type === 'formation' && typeof b.id === 'string') {
        const props = (b.props ?? {}) as { courseId?: unknown; titre?: unknown };
        const courseId = typeof props.courseId === 'string' ? props.courseId : '';
        if (courseId) {
          const texte =
            typeof props.titre === 'string' && props.titre.trim()
              ? props.titre.trim()
              : 'Formation APIX Academy';
          tous.push({
            id: b.id,
            texte,
            empreinte: `formation:${courseId}`,
            contenu: [{ type: 'text', text: texte, styles: {} }],
            echeance: null,
            formation: courseId,
          });
        }
      }
      parcourir(b.children);
    }
  };
  parcourir(contenu);
  return tous;
}

/**
 * Le statut d'une formation donnée à suivre, lu dans l'APIX Academy.
 * Atteinte : certifiée, ou terminée quand elle n'a pas d'évaluation.
 * Partiellement : la moitié de ses leçons vues au moins, sans l'être
 * encore (évaluation pas réussie, ou leçons pas toutes vues). Non atteinte :
 * moins de la moitié.
 */
export function statutDeFormation(suivi: FormationDeLaFiche | undefined): StatutObjectif {
  if (!suivi) return 'non_atteint';
  if (suivi.statut === 'certifiee' || suivi.statut === 'terminee') return 'atteint';
  const part = suivi.lecons > 0 ? suivi.validees / suivi.lecons : 0;
  return part >= 0.5 ? 'partiel' : 'non_atteint';
}

/** Les statuts des formations d'une fiche, selon l'état de chacune. */
export function statutsDesFormations(
  objectifs: ObjectifDeLaFiche[],
  formations: FormationDeLaFiche[],
): Record<string, StatutObjectif> {
  const statuts: Record<string, StatutObjectif> = {};
  for (const o of objectifs) {
    if (!o.formation) continue;
    statuts[o.id] = statutDeFormation(formations.find((f) => f.courseId === o.formation));
  }
  return statuts;
}

/** Les formations que cite une fiche : les blocs « Formation », dans l'ordre de lecture. */
export function formationsDeLaFiche(contenu: Record<string, unknown>[]): string[] {
  const ids: string[] = [];
  const parcourir = (blocs: unknown) => {
    if (!Array.isArray(blocs)) return;
    for (const b of blocs as Record<string, unknown>[]) {
      const courseId = (b.props as { courseId?: unknown } | undefined)?.courseId;
      if (
        b.type === 'formation' &&
        typeof courseId === 'string' &&
        courseId &&
        !ids.includes(courseId)
      ) {
        ids.push(courseId);
      }
      parcourir(b.children);
    }
  };
  parcourir(contenu);
  return ids;
}

/** La fiche fait au plus 300 000 caractères une fois sérialisée. */
export const FICHE_OBJECTIFS_MAX = 300_000;

export const enregistrerFicheObjectifsSchema = z.object({
  annee: z.number().int().min(2000).max(2100).optional(),
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
  /** Ses fiches dont l'auto-évaluation est envoyée, pas encore évaluées. */
  aEvaluer: number;
  /** Parti de l'APIX : il reste là le temps que son n+1 termine son évaluation. */
  parti: boolean;
}

export interface SuiviEquipe {
  annee: number;
  membres: MembreSuivi[];
}

export interface FicheSuivi {
  annee: number;
  membre: MembreSuivi;
  objectifs: ObjectifView[];
  /** Toutes ses fiches, une par année, les plus récentes d'abord ; une fiche vide n'y figure pas. */
  fiches: FicheObjectifs[];
  /** Les formations qu'il a commencées, pour les blocs « Formation ». */
  formations: FormationDeLaFiche[];
  /**
   * Les formations que l'agent encadre : celles que l'agent anime. Elles ne
   * se donnent pas à suivre (ADR-0057, ADR-0070).
   */
  formationsEncadrees: string[];
  /** Le jour de l'évaluation annuelle, « MM-JJ » : il borne les échéances de chaque année. */
  jourEvaluation: string;
}

/** « Objectifs de l'APIX » : ce que le directeur général fixe. */
export interface ObjectifsAPIX {
  annee: number;
  orientations: ObjectifView[];
  directions: {
    id: string;
    nom: string;
    /**
     * Qui la dirige, avec son genre pour le titre et la civilité
     * (« Directrice : Madame … ») ; null quand personne n'est désigné.
     */
    responsable: { nom: string; genre: 'female' | 'male' | null } | null;
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

// ---------- Date d'évaluation ----------

/**
 * Les jours de chaque mois d'une année ordinaire : la date d'évaluation
 * revient chaque année, le 29 février n'en est donc pas une.
 */
export const JOURS_PAR_MOIS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/** « 12-15 » : un jour et un mois, sans l'année. */
export const jourDeLAnneeSchema = z
  .string()
  .regex(/^\d{2}-\d{2}$/, 'Un jour et un mois')
  .refine((v) => {
    const [mois = 0, jour = 0] = v.split('-').map(Number);
    return mois >= 1 && mois <= 12 && jour >= 1 && jour <= JOURS_PAR_MOIS[mois - 1]!;
  }, 'Ce jour ne revient pas chaque année');

/**
 * Le jour où les notes de A à D se donnent : un jour et un mois qui
 * reviennent chaque année (ADR-0075), posés sur l'année de la prochaine
 * évaluation.
 */
export interface DateEvaluation {
  annee: number;
  /** Le jour et le mois, « MM-JJ ». */
  jour: string;
  /** Ce jour-là dans l'année affichée : date ISO (AAAA-MM-JJ). */
  date: string;
  /** Qui dirige la DCH la change. */
  modifiable: boolean;
}

export const dateEvaluationSchema = z.object({ jour: jourDeLAnneeSchema });
export type DateEvaluationInput = z.infer<typeof dateEvaluationSchema>;

/** Tant que la DCH n'en a pas fixé d'autre : le 15 décembre. */
export const JOUR_D_EVALUATION_PAR_DEFAUT = '12-15';

/** La date de l'évaluation d'une année. */
export function dateDEvaluation(annee: number, jour: string): string {
  return `${annee}-${jour}`;
}

/**
 * Les échéances possibles des objectifs d'une année : de son 1er janvier au
 * jour de son évaluation.
 */
export function echeancesDeLAnnee(annee: number, jour: string): { du: string; au: string } {
  return { du: `${annee}-01-01`, au: dateDEvaluation(annee, jour) };
}

/** L'auto-évaluation s'ouvre deux semaines avant le jour de l'évaluation (ADR-0076). */
export const JOURS_D_AUTO_EVALUATION = 14;

/**
 * Le jour où s'ouvre l'auto-évaluation d'une année : le 1er décembre pour
 * une évaluation au 15. Avant, l'agent coche les objectifs terminés.
 */
export function ouvertureDeLAutoEvaluation(annee: number, jour: string): string {
  const [mois = 12, j = 15] = jour.split('-').map(Number);
  const debut = Date.UTC(annee, mois - 1, j) - JOURS_D_AUTO_EVALUATION * 86_400_000;
  return new Date(debut).toISOString().slice(0, 10);
}

/** « 30 juin », « 1er janvier » : un jour et un mois, « MM-JJ », en lettres. */
export function jourEtMoisEnLettres(jour: string): string {
  const [mois = 1, j = 1] = jour.split('-').map(Number);
  return `${j === 1 ? '1er' : j} ${MOIS_DE_L_ANNEE[mois - 1]}`;
}

/** « 20 mars 2027 », ou « 20 mars » sans l'année : une date ISO en lettres. */
export function dateEnLettres(date: string, avecAnnee = true): string {
  const jour = jourEtMoisEnLettres(date.slice(5, 10));
  return avecAnnee ? `${jour} ${date.slice(0, 4)}` : jour;
}

/**
 * Ce que l'enregistrement d'une fiche a changé. `majLe` vaut `null` quand la
 * fiche n'existe pas : neuve, rien n'y a été écrit.
 */
export interface FicheEnregistree {
  majLe: string | null;
}

/** Un objectif ponctuel tient sur une ligne. */
export const OBJECTIF_TEXTE_MAX = 500;
