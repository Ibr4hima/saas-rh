import { z } from 'zod';
import { contractTypeSchema } from './employees';

// ---------- Offres d'emploi ----------

export const jobStatusSchema = z.enum(['draft', 'published', 'closed']);
export type JobStatus = z.infer<typeof jobStatusSchema>;

const trimmed = (max: number) => z.string().trim().min(1).max(max);

export const createJobPostingSchema = z.object({
  title: trimmed(140),
  description: trimmed(20_000),
  orgUnitId: z
    .uuid()
    .nullish()
    .or(z.literal('').transform(() => undefined)),
  contractType: contractTypeSchema,
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
});
export type CreateJobPostingInput = z.infer<typeof createJobPostingSchema>;

export const updateJobPostingSchema = z.object({
  title: trimmed(140).optional(),
  description: trimmed(20_000).optional(),
  orgUnitId: z.uuid().nullable().optional(),
  contractType: contractTypeSchema.optional(),
  location: z.string().trim().max(120).nullable().optional(),
  deadline: z.iso.date().nullable().optional(),
  requiredDocuments: z.array(trimmed(60)).max(5).optional(),
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
  status: JobStatus;
  publicSlug: string;
  createdAt: string;
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
      title: string;
      description: string;
      contractType: string;
      location: string | null;
      deadline: string | null;
      requiredDocuments: string[];
    };

export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const MAX_DOCUMENTS_PER_APPLICATION = 5;

/** Types de fichiers acceptés pour les documents de candidature. */
export const ALLOWED_DOCUMENT_TYPES: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'image/jpeg': '.jpg',
  'image/png': '.png',
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
