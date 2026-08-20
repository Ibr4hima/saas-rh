import { z } from 'zod';

/**
 * Demandes de documents administratifs (ADR-0012).
 * Circuit : reçue → en traitement → prête à retirer (ou refusée avec motif).
 * Les documents sont remis EN MAIN PROPRE, cachetés et signés.
 *
 * « Prête » est l'état FINAL : la RH annonce auprès de qui retirer, mais elle
 * ne peut pas savoir quand l'employé est effectivement passé chez cette
 * personne. Le statut « Remise » reste défini pour les demandes déjà closes
 * en base, sans pouvoir être posé à nouveau.
 */

export const requestableDocSchema = z.enum([
  'attestation_travail',
  'contrat_travail',
  'bulletin_salaire',
  'attestation_salaire',
  'certificat_travail',
  'autre',
]);
export type RequestableDoc = z.infer<typeof requestableDocSchema>;

export const REQUESTABLE_DOC_LABELS: Record<RequestableDoc, string> = {
  attestation_travail: 'Attestation de travail',
  contrat_travail: 'Contrat de travail',
  bulletin_salaire: 'Bulletin de salaire',
  attestation_salaire: 'Attestation de salaire',
  certificat_travail: 'Certificat de travail',
  autre: 'Autre document',
};

/** Ce que l'application sait générer elle-même (le reste vient du système de paie). */
export const GENERATED_DOCS: RequestableDoc[] = ['attestation_travail'];

/** `delivered` : statut historique, conservé en lecture (voir en-tête). */
export const documentRequestStatusSchema = z.enum([
  'received',
  'processing',
  'ready',
  'delivered',
  'rejected',
]);
export type DocumentRequestStatus = z.infer<typeof documentRequestStatusSchema>;

export const DOC_REQUEST_STATUS_LABELS: Record<DocumentRequestStatus, string> = {
  received: 'Reçue',
  processing: 'En traitement',
  ready: 'Prête à retirer',
  delivered: 'Remise',
  rejected: 'Refusée',
};

export const DOC_REQUEST_STATUS_TONES: Record<
  DocumentRequestStatus,
  'neutral' | 'warning' | 'primary' | 'success' | 'danger'
> = {
  received: 'neutral',
  processing: 'warning',
  ready: 'primary',
  delivered: 'success',
  rejected: 'danger',
};

export const createDocumentRequestSchema = z.object({
  /** Un ou plusieurs documents en une seule demande. */
  docTypes: z.array(requestableDocSchema).min(1).max(6),
  /** Période du bulletin, motif (banque, visa…) — facultatif mais utile à la RH. */
  note: z
    .string()
    .trim()
    .max(500)
    .transform((v) => (v === '' ? undefined : v))
    .optional(),
});
export type CreateDocumentRequestInput = z.infer<typeof createDocumentRequestSchema>;

/** Transitions pilotées par la RH — « prête » clôt le circuit. */
export const advanceDocumentRequestSchema = z.object({
  status: z.enum(['processing', 'ready', 'rejected']),
  /** Requis pour « prête » : à qui l'employé doit s'adresser. */
  pickupContact: z.string().trim().max(120).optional(),
  /** Message libre (obligatoire en cas de refus : le motif). */
  message: z.string().trim().max(500).optional(),
});
export type AdvanceDocumentRequestInput = z.infer<typeof advanceDocumentRequestSchema>;

export interface DocumentRequestView {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeNumber: string;
  /** Statut du dossier : conditionne la génération d'attestation. */
  employeeStatus: string;
  docTypes: RequestableDoc[];
  note: string | null;
  status: DocumentRequestStatus;
  pickupContact: string | null;
  hrMessage: string | null;
  handledByName: string | null;
  createdAt: string;
  processingAt: string | null;
  readyAt: string | null;
  deliveredAt: string | null;
  /** true si l'utilisateur courant (RH) peut faire avancer la demande. */
  canAdvance: boolean;
}
