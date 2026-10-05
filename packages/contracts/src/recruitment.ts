import { z } from 'zod';
import { contractTypeSchema } from './employees';

// ---------- Offres d'emploi ----------

export const jobStatusSchema = z.enum(['draft', 'published', 'closed']);
export type JobStatus = z.infer<typeof jobStatusSchema>;

const trimmed = (max: number) => z.string().trim().min(1).max(max);

/* ---------- Le profil recherché ----------
   Tout se choisit dans une liste, rien ne se tape : une offre se lit d'un
   coup d'œil, se compare à la suivante, et ne porte pas « Bac +3 » ici et
   « BAC+3 » là. */

export const NIVEAUX_ETUDES = ['bac1', 'bac2', 'bac3', 'bac4', 'bac5', 'bac5plus'] as const;
export const niveauEtudesSchema = z.enum(NIVEAUX_ETUDES);
export type NiveauEtudes = z.infer<typeof niveauEtudesSchema>;
export const NIVEAU_ETUDES_LABELS: Record<NiveauEtudes, string> = {
  bac1: 'Bac+1',
  bac2: 'Bac+2',
  bac3: 'Bac+3',
  bac4: 'Bac+4',
  bac5: 'Bac+5',
  bac5plus: 'Au-delà de Bac+5',
};

/** Années d'expérience minimum, par paliers ; 10 vaut « 10 ans et plus ». */
export const EXPERIENCES_MIN = [0, 1, 2, 3, 5, 7, 10] as const;
export function libelleExperience(ans: number): string {
  if (ans === 0) return 'Aucune';
  if (ans >= 10) return '10 ans et plus';
  return ans === 1 ? '1 an' : `${ans} ans`;
}

/** Les langues qu'une offre peut exiger, dans l'ordre où on les propose. */
export const LANGUES = ['en', 'zh', 'es', 'ar', 'it'] as const;
export const langueSchema = z.enum(LANGUES);
export type Langue = z.infer<typeof langueSchema>;
export const LANGUE_LABELS: Record<Langue, string> = {
  en: 'Anglais',
  zh: 'Mandarin',
  es: 'Espagnol',
  ar: 'Arabe',
  it: 'Italien',
};

/**
 * Les contrats qu'une offre propose. Le consultant et le détachement restent
 * des contrats d'agent, mais ne se recrutent pas par une offre publiée.
 */
export const jobContractTypeSchema = z.enum(['cdi', 'cdd', 'stage']);

/** La durée ne se demande qu'aux contrats qui en ont une. */
export const CONTRATS_A_DUREE: readonly string[] = ['cdd', 'stage'];
export const DUREES_MOIS = [3, 6, 12, 18, 24] as const;

const languesSchema = z
  .array(langueSchema)
  .max(LANGUES.length)
  .transform((l) => [...new Set(l)]);

export const createJobPostingSchema = z.object({
  title: trimmed(140),
  description: trimmed(20_000),
  orgUnitId: z
    .uuid()
    .nullish()
    .or(z.literal('').transform(() => undefined)),
  contractType: jobContractTypeSchema,
  location: z
    .string()
    .trim()
    .max(120)
    .transform((v) => (v === '' ? undefined : v))
    .optional(),
  deadline: z.iso
    .date()
    .or(z.literal('').transform(() => undefined))
    .optional(),
  requiredDocuments: z.array(trimmed(60)).max(5).default([]),
  niveauEtudes: niveauEtudesSchema,
  experienceMin: z.literal(EXPERIENCES_MIN),
  langues: languesSchema.default([]),
  /** Exigée pour un CDD ou un stage, ignorée pour les autres contrats. */
  dureeMois: z.literal(DUREES_MOIS).nullish(),
});
export type CreateJobPostingInput = z.infer<typeof createJobPostingSchema>;

export const updateJobPostingSchema = z.object({
  title: trimmed(140).optional(),
  description: trimmed(20_000).optional(),
  orgUnitId: z.uuid().nullable().optional(),
  contractType: jobContractTypeSchema.optional(),
  location: z.string().trim().max(120).nullable().optional(),
  deadline: z.iso.date().nullable().optional(),
  requiredDocuments: z.array(trimmed(60)).max(5).optional(),
  niveauEtudes: niveauEtudesSchema.optional(),
  experienceMin: z.literal(EXPERIENCES_MIN).optional(),
  langues: languesSchema.optional(),
  dureeMois: z.literal(DUREES_MOIS).nullable().optional(),
  status: jobStatusSchema.optional(),
});
export type UpdateJobPostingInput = z.infer<typeof updateJobPostingSchema>;

export interface JobPostingView {
  id: string;
  /** OFF-AAAA-NNN : ce qu'on cite dans un courrier ou une relance. */
  reference: string;
  title: string;
  description: string;
  orgUnitId: string | null;
  orgUnitName: string | null;
  contractType: string;
  location: string | null;
  deadline: string | null;
  requiredDocuments: string[];
  /** Null sur une offre antérieure au profil recherché. */
  niveauEtudes: NiveauEtudes | null;
  experienceMin: number | null;
  langues: Langue[];
  dureeMois: number | null;
  status: JobStatus;
  publicSlug: string;
  createdAt: string;
  /** Null tant qu'elle n'a jamais été publiée. */
  publishedAt: string | null;
  /** Nombre de candidatures par étape (pour la liste des offres). */
  applicationCounts: Record<string, number>;
}

// ---------- Pipeline de candidatures ----------

export const applicationStageSchema = z.enum([
  'received',
  'screening',
  'interview',
  'offer',
  'hired',
  'rejected',
]);
export type ApplicationStage = z.infer<typeof applicationStageSchema>;

export const APPLICATION_STAGES: ApplicationStage[] = [
  'received',
  'screening',
  'interview',
  'offer',
  'hired',
  'rejected',
];

/**
 * Suppression d'offres, une ou plusieurs.
 *
 * Une offre qui a reçu des candidatures n'est PAS supprimable : les dossiers
 * déposés appartiennent à des personnes, et les effacer par ricochet en
 * fermant une campagne serait une perte silencieuse. Ces offres-là se ferment.
 */
export const deleteJobPostingsSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(50),
});
export type DeleteJobPostingsInput = z.infer<typeof deleteJobPostingsSchema>;

export interface DeleteJobPostingsResult {
  deleted: number;
  skipped: { id: string; title: string; reason: string }[];
}

export const updateApplicationSchema = z.object({
  stage: applicationStageSchema,
});
export type UpdateApplicationInput = z.infer<typeof updateApplicationSchema>;

export interface ApplicationView {
  id: string;
  jobPostingId: string;
  givenName: string;
  familyName: string;
  email: string;
  phone: string | null;
  message: string | null;
  stage: ApplicationStage;
  createdAt: string;
  documents: ApplicationDocumentMeta[];
}

export interface ApplicationDocumentMeta {
  id: string;
  label: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
}

// ---------- Face publique (page de candidature) ----------

/** Ce que voit un candidat qui suit le lien : l'offre, rien d'autre. */
export type PublicJobInfo =
  | { valid: false; reason: 'not_found' | 'closed' }
  | {
      valid: true;
      organizationName: string;
      /** OFF-AAAA-NNN — ce que le candidat cite quand il relance. */
      reference: string;
      /** Mise en ligne de l'offre : « publiée il y a trois jours ». */
      publishedAt: string;
      title: string;
      description: string;
      contractType: string;
      location: string | null;
      deadline: string | null;
      requiredDocuments: string[];
      niveauEtudes: NiveauEtudes | null;
      experienceMin: number | null;
      langues: Langue[];
      dureeMois: number | null;
    };

export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const MAX_DOCUMENTS_PER_APPLICATION = 5;

/**
 * Le PDF, et lui seul.
 *
 * Un dossier de candidature est lu, annoté et archivé : un .docx s'ouvre
 * différemment d'un poste à l'autre, une photo de CV ne se lit pas à l'écran,
 * et ni l'un ni l'autre ne s'affiche dans la visionneuse du produit. Exiger le
 * PDF, c'est garantir au recruteur que tous les dossiers s'ouvrent pareil — et
 * au candidat que son document arrive tel qu'il l'a mis en page.
 */
export const ALLOWED_DOCUMENT_TYPES: Record<string, string> = {
  'application/pdf': '.pdf',
};

export const applyDocumentSchema = z.object({
  label: trimmed(60),
  filename: trimmed(200),
  contentType: z.enum(Object.keys(ALLOWED_DOCUMENT_TYPES) as [string, ...string[]]),
  /** Contenu encodé base64 (standard, sans data-URI). */
  contentBase64: z
    .string()
    .min(1)
    // 4/3 du binaire + marge : borne dure avant même le décodage.
    .max(Math.ceil((MAX_DOCUMENT_BYTES * 4) / 3) + 4),
});

export const applySchema = z.object({
  givenName: trimmed(80),
  familyName: trimmed(80),
  email: z.email(),
  phone: z
    .string()
    .trim()
    .max(30)
    .transform((v) => (v === '' ? undefined : v))
    .optional(),
  message: z
    .string()
    .trim()
    .max(4000)
    .transform((v) => (v === '' ? undefined : v))
    .optional(),
  documents: z.array(applyDocumentSchema).max(MAX_DOCUMENTS_PER_APPLICATION).default([]),
});
export type ApplyInput = z.infer<typeof applySchema>;
