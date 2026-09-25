import { z } from 'zod';

/**
 * APIX Academy : des formations en ligne, suivies et vérifiées.
 *
 * Une formation se range en modules, un module en leçons ; une leçon est une
 * vidéo de douze minutes au plus. Les agents la suivent DANS L'ORDRE, et une
 * leçon ne compte pour « vue » qu'à partir de 90 % de passages réellement
 * regardés — pas de position atteinte : un passage sauté ne compte pas.
 *
 * Les règles chiffrées vivent ici, d'un seul tenant : l'écran les annonce et
 * le serveur les tient, et un chiffre qui divergerait entre les deux ferait
 * promettre à l'un ce que l'autre refuse.
 */

/** Douze minutes : la durée maximale d'une leçon, décidée avec l'APIX. */
export const DUREE_MAX_LECON_S = 12 * 60;

/**
 * Une seconde de marge sur les douze minutes : un enregistrement arrêté pile
 * à 12:00 dure 720,04 s une fois encodé, et le refuser pour quatre centièmes
 * ferait recommencer la RH pour rien.
 */
export const MARGE_DUREE_S = 1;

/** La part d'une vidéo qu'il faut avoir réellement regardée pour la valider. */
export const SEUIL_VISIONNAGE = 0.9;

/** Le lecteur rend compte au serveur à ce rythme, pendant la lecture. */
export const BATTEMENT_S = 10;

/** Le plus gros support PDF qu'on puisse joindre à une leçon. */
export const MAX_SUPPORT_BYTES = 10 * 1024 * 1024;

/** Le plus gros fichier vidéo qu'accepte le stockage LOCAL (développement). */
export const MAX_VIDEO_LOCALE_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * Les familles de formations — dix, dans l'ordre où la RH les parcourt.
 *
 * Une liste FERMÉE plutôt que des familles saisies au fil de l'eau : chacune
 * a son icône et sa couverture, et le catalogue reste lisible quand trois
 * personnes l'enrichissent. Une onzième se prend par une migration — c'est ce
 * qui la fait discuter plutôt qu'inventer.
 */
export const ACADEMY_CATEGORIES = [
  'bureautique',
  'digital',
  'economie',
  'droit',
  'metier',
  'management',
  'projets',
  'communication',
  'langues',
  'conformite',
] as const;
export type AcademyCategory = (typeof ACADEMY_CATEGORIES)[number];

export const ACADEMY_CATEGORY_LABELS: Record<AcademyCategory, string> = {
  bureautique: 'Bureautique',
  digital: 'Digital et informatique',
  economie: 'Économie',
  droit: 'Droit et fiscalité',
  metier: 'Métier de l’APIX',
  management: 'Management',
  projets: 'Gestion de projet',
  communication: 'Communication',
  langues: 'Langues',
  conformite: 'Conformité',
};

export type VideoStatus = 'absente' | 'envoi' | 'traitement' | 'prete' | 'erreur';

// ---------- Saisie (RH) ----------

export const saveCourseSchema = z.object({
  title: z.string().trim().min(3, '3 caractères minimum').max(160),
  summary: z
    .string()
    .trim()
    .max(2000)
    .nullish()
    .transform((v) => (v ? v : null)),
  category: z.enum(ACADEMY_CATEGORIES),
});
export type SaveCourseInput = z.infer<typeof saveCourseSchema>;

export const publishCourseSchema = z.object({ published: z.boolean() });

export const titleSchema = z.object({ title: z.string().trim().min(1).max(160) });
export type TitleInput = z.infer<typeof titleSchema>;

export const moveSchema = z.object({ sens: z.enum(['haut', 'bas']) });
export type MoveInput = z.infer<typeof moveSchema>;

export const prepareVideoSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  size: z.number().int().positive(),
  contentType: z.string().max(120).optional(),
});
export type PrepareVideoInput = z.infer<typeof prepareVideoSchema>;

export const supportQuerySchema = z.object({
  filename: z.string().trim().min(1).max(255),
});

// ---------- Lecture (agent) ----------

/**
 * Un battement : le passage que le lecteur vient de jouer d'une traite, de
 * `de` à `a`, en secondes de vidéo.
 *
 * Le lecteur DÉCLARE ; le serveur décide. Il ne crédite que ce que le temps
 * réellement écoulé rend possible, et refuse un passage qui commence au-delà
 * de ce qui a déjà été vu.
 */
export const beatSchema = z.object({
  sessionId: z.uuid(),
  de: z
    .number()
    .min(0)
    .max(DUREE_MAX_LECON_S + 60),
  a: z
    .number()
    .min(0)
    .max(DUREE_MAX_LECON_S + 60),
});
export type BeatInput = z.infer<typeof beatSchema>;

/** Un passage crédité : [début, fin] en secondes. */
export type Intervalle = [number, number];

export type EtatLecon = 'verrouillee' | 'a_suivre' | 'en_cours' | 'validee';

/**
 * `suivi` : un agent sur une formation publiée — tout est compté, rien ne se
 * saute. `apercu` : la RH qui relit, ou un compte sans dossier d'agent —
 * lecture libre, rien n'est enregistré.
 */
export type ModeLecture = 'suivi' | 'apercu';

export interface LessonView {
  id: string;
  moduleId: string;
  title: string;
  position: number;
  durationSeconds: number | null;
  support: { filename: string; size: number } | null;
  /** RH seulement : où en est la vidéo. Les agents ne voient que les leçons prêtes. */
  videoStatus: VideoStatus;
  videoError: string | null;
  etat: EtatLecon;
  /** Part réellement vue, de 0 à 1. */
  vu: number;
}

export interface ModuleView {
  id: string;
  title: string;
  position: number;
  lessons: LessonView[];
}

export interface CourseSummary {
  id: string;
  title: string;
  summary: string | null;
  category: AcademyCategory;
  published: boolean;
  lessonCount: number;
  moduleCount: number;
  totalSeconds: number;
  /** Leçons validées par l'agent connecté. */
  completedLessons: number;
  /** La leçon où reprendre : la première non validée. */
  resumeLessonId: string | null;
  /** Dernière activité de l'agent sur la formation, pour ranger « Reprendre ». */
  lastActivityAt: string | null;
  updatedAt: string;
}

export interface CourseDetail extends CourseSummary {
  mode: ModeLecture;
  modules: ModuleView[];
}

/** Ce qui empêche une formation d'être publiée, en mots de la RH. */
export interface ObstaclePublication {
  lessonId: string | null;
  texte: string;
}

export interface CourseAdminView extends CourseDetail {
  obstacles: ObstaclePublication[];
}

export interface CourseAdminSummary extends CourseSummary {
  /** Ce qui manque encore pour publier. Zéro : publiable. */
  obstacleCount: number;
}

export interface LessonPlayback {
  lessonId: string;
  courseId: string;
  title: string;
  mode: ModeLecture;
  /** La session de lecture : présente en mode suivi seulement. */
  sessionId: string | null;
  source: { type: 'mp4' | 'hls'; url: string };
  durationSeconds: number;
  /** Passages déjà crédités. */
  intervalles: Intervalle[];
  /** Jusqu'où l'on peut aller en première lecture. */
  plusLoin: number;
  /** Là où reprendre. */
  reprise: number;
  validee: boolean;
  vu: number;
  precedente: string | null;
  suivante: string | null;
}

export interface BeatResult {
  intervalles: Intervalle[];
  plusLoin: number;
  vu: number;
  validee: boolean;
  /** Vrai au battement qui fait passer la leçon au-dessus du seuil. */
  vientDeValider: boolean;
  /** Le passage commençait au-delà de ce qui a été vu : rien n'est crédité. */
  refus: 'saut' | null;
}

/**
 * Où envoyer le fichier vidéo.
 *
 * `local` : le serveur de l'application le reçoit lui-même et le garde sur
 * son disque — pour développer et démontrer, jamais pour trois cents agents.
 * `cloudflare` : le navigateur l'envoie DIRECTEMENT au fournisseur ; aucun
 * octet ne traverse l'application.
 */
export interface VideoUploadTarget {
  mode: 'local' | 'cloudflare';
  url: string;
  method: 'PUT' | 'POST';
}
