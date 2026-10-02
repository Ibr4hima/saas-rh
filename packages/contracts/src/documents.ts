import { z } from 'zod';
import type { TraitementView } from './acces';

// ---------- Documents officiels du dossier employé ----------

/** Ce qu'un agent dépose, dans l'ordre de la liste. */
export const documentCategorySchema = z.enum([
  'cni',
  'passeport',
  'diplome',
  'certification',
  'attestation_travail',
  'attestation_stage',
  'cv',
]);
/** Un type de document — `autre` ne se lit plus que sur les dépôts anciens. */
export type DocumentCategory = z.infer<typeof documentCategorySchema> | 'autre';

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  cni: 'Carte Nationale d’Identité',
  passeport: 'Passeport',
  diplome: 'Diplôme',
  certification: 'Certification',
  attestation_travail: 'Attestation de travail',
  attestation_stage: 'Attestation de stage',
  cv: 'Curriculum Vitæ',
  autre: 'Autre document',
};

/**
 * Les titres d'identité : l'agent en donne la date d'expiration au dépôt, et
 * il est prévenu quinze jours avant, puis le jour même.
 */
export const DOCUMENTS_A_EXPIRATION = [
  'cni',
  'passeport',
] as const satisfies readonly DocumentCategory[];

/**
 * Un seul exemplaire au dossier : le nouveau, une fois vérifié, prend la place
 * de l'ancien. Les autres types s'ajoutent sans limite.
 */
export const DOCUMENTS_UNIQUES = [
  'cni',
  'passeport',
  'cv',
] as const satisfies readonly DocumentCategory[];

/**
 * Le titre d'identité que l'agent doit déposer : celui de sa fiche — la CNI,
 * ou le passeport. `null` sans type de pièce renseigné.
 */
export function titreDeLaFiche(idDocumentType: string | null): 'cni' | 'passeport' | null {
  return idDocumentType === 'cni' ? 'cni' : idDocumentType === 'passport' ? 'passeport' : null;
}

export const aUneExpiration = (c: DocumentCategory): boolean =>
  (DOCUMENTS_A_EXPIRATION as readonly string[]).includes(c);
export const estUnique = (c: DocumentCategory): boolean =>
  (DOCUMENTS_UNIQUES as readonly string[]).includes(c);

export const MAX_EMPLOYEE_DOCUMENT_BYTES = 5 * 1024 * 1024;

/** Les documents officiels se déposent en PDF, et en PDF seulement. */
export const EMPLOYEE_DOCUMENT_TYPES = ['application/pdf'] as const;

/** Le fichier et son nom : ce qui se dépose, et ce qui se remplace. */
const fichierSchema = z.object({
  /** Le nom que l'agent donne au document — celui du fichier, s'il ne le change pas. */
  label: z.string().trim().min(1).max(120),
  filename: z.string().trim().min(1).max(200),
  contentType: z.enum(EMPLOYEE_DOCUMENT_TYPES),
  contentBase64: z
    .string()
    .min(1)
    .max(Math.ceil((MAX_EMPLOYEE_DOCUMENT_BYTES * 4) / 3) + 4),
  /** CNI et passeport seulement — exigée pour eux. */
  expiresOn: z.iso.date().optional(),
});

export const uploadEmployeeDocumentSchema = fichierSchema
  .extend({ category: documentCategorySchema })
  .refine((d) => !aUneExpiration(d.category) || Boolean(d.expiresOn), {
    message: 'Indiquez la date d’expiration du document.',
    path: ['expiresOn'],
  });
export type UploadEmployeeDocumentInput = z.infer<typeof uploadEmployeeDocumentSchema>;

/** Changer le fichier d'un dépôt encore en vérification — son type ne change pas. */
export const replaceEmployeeDocumentSchema = fichierSchema;
export type ReplaceEmployeeDocumentInput = z.infer<typeof replaceEmployeeDocumentSchema>;

export const reviewEmployeeDocumentSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  comment: z.string().trim().max(500).optional(),
});
export type ReviewEmployeeDocumentInput = z.infer<typeof reviewEmployeeDocumentSchema>;

export type DocumentStatus = 'pending' | 'approved' | 'rejected';

export interface EmployeeDocumentView {
  id: string;
  employeeId: string;
  category: DocumentCategory;
  label: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  status: DocumentStatus;
  /** Qui a déposé : l'employé lui-même ou la RH. */
  uploadedBySide: 'employee' | 'hr';
  uploadedByName: string;
  reviewedByName: string | null;
  reviewComment: string | null;
  createdAt: string;
  /** CNI et passeport : la date d'expiration — pour le titulaire seulement. */
  expiresOn: string | null;
  /** true si l'utilisateur COURANT est la contrepartie attendue pour valider. */
  canReview: boolean;
  canDelete: boolean;
  /** Le titulaire, tant que le document est en vérification : il en change le fichier. */
  canReplace: boolean;
  /**
   * Déposée par l'agent et en attente : qui la vérifie pour la DCH (sinon
   * null — une pièce déposée par la DCH, c'est l'agent qui la vérifie).
   */
  traitement: TraitementView | null;
}

/** Une pièce dans la file de la DCH : la même, avec son agent. */
export interface PieceATraiterView extends EmployeeDocumentView {
  employeeName: string;
  employeeNumber: string;
}

// ---------- Notifications ----------

export interface NotificationView {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  /** Rangée hors de la boîte — consultable et restaurable, jamais perdue. */
  archivedAt: string | null;
  createdAt: string;
}

/** Les deux vues de la boîte : ce qui reste à voir, et ce qu'on a rangé. */
export const notificationScopeSchema = z.enum(['inbox', 'archive']).default('inbox');
export type NotificationScope = z.infer<typeof notificationScopeSchema>;

/**
 * `espace` : la boîte de cet espace seulement (qui en a deux). Absent : toute
 * la boîte.
 */
export const notificationEspaceSchema = z.enum(['agent', 'gestion']).optional();

export const notificationScopeQuerySchema = z.object({
  scope: notificationScopeSchema,
  espace: notificationEspaceSchema,
});

/** Tout lire, tout ranger : dans la boîte d'un espace, ou dans toute la boîte. */
export const notificationEspaceQuerySchema = z.object({ espace: notificationEspaceSchema });

/** Ranger ou ressortir : toujours une LISTE, même pour une seule ligne. */
export const notificationIdsSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(60),
});
export type NotificationIdsInput = z.infer<typeof notificationIdsSchema>;

export interface NotificationsPage {
  items: NotificationView[];
  /** Non lues DANS LA BOÎTE : ranger une notification la retire du compteur. */
  unreadCount: number;
  /** Combien de lignes dorment dans les archives (pour l'onglet). */
  archivedCount: number;
}

// ---------- Contrats à échéance ----------

export interface ExpiringContractView {
  contractId: string;
  employeeId: string;
  employeeName: string;
  contractType: string;
  endDate: string;
  daysLeft: number;
}
