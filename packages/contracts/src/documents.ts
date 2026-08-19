import { z } from 'zod';

// ---------- Pièces justificatives du dossier employé ----------

export const documentCategorySchema = z.enum([
  'piece_identite',
  'diplome',
  'attestation_travail',
  'autre',
]);
export type DocumentCategory = z.infer<typeof documentCategorySchema>;

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  piece_identite: "Pièce d'identité",
  diplome: 'Diplôme / certification',
  attestation_travail: 'Attestation de travail / stage',
  autre: 'Autre document',
};

export const MAX_EMPLOYEE_DOCUMENT_BYTES = 5 * 1024 * 1024;

/** Formats acceptés pour les pièces justificatives. */
export const EMPLOYEE_DOCUMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;

export const uploadEmployeeDocumentSchema = z.object({
  category: documentCategorySchema,
  /** Ex : « CNI », « Master 2 Finance — UCAD », « Attestation APIX 2023 ». */
  label: z.string().trim().min(1).max(120),
  filename: z.string().trim().min(1).max(200),
  contentType: z.enum(EMPLOYEE_DOCUMENT_TYPES),
  contentBase64: z
    .string()
    .min(1)
    .max(Math.ceil((MAX_EMPLOYEE_DOCUMENT_BYTES * 4) / 3) + 4),
});
export type UploadEmployeeDocumentInput = z.infer<typeof uploadEmployeeDocumentSchema>;

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
  /** true si l'utilisateur COURANT est la contrepartie attendue pour valider. */
  canReview: boolean;
  canDelete: boolean;
}

// ---------- Notifications ----------

export interface NotificationView {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationsPage {
  items: NotificationView[];
  unreadCount: number;
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
