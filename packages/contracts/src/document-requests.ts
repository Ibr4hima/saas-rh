import { z } from 'zod';
import type { TraitementView } from './acces';

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
  'attestation_stage',
  'contrat_travail',
  'bulletin_salaire',
  'attestation_salaire',
  'certificat_travail',
  'autre',
]);
export type RequestableDoc = z.infer<typeof requestableDocSchema>;

export const REQUESTABLE_DOC_LABELS: Record<RequestableDoc, string> = {
  attestation_travail: 'Attestation de travail',
  attestation_stage: 'Attestation de stage',
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
  'gris' | 'orange' | 'bleu' | 'teal' | 'rouge'
> = {
  received: 'gris',
  processing: 'orange',
  ready: 'bleu',
  delivered: 'teal',
  rejected: 'rouge',
};

/**
 * Statuts d'une demande encore OUVERTE — « prête » n'en fait pas partie :
 * c'est l'état final depuis que la remise en main propre n'est plus
 * enregistrée, et la compter bloquerait l'agent à vie.
 */
export const OPEN_DOCUMENT_REQUEST_STATUSES: DocumentRequestStatus[] = ['received', 'processing'];

/**
 * Le garde-fou contre les doublons de file : un document déjà demandé ne se
 * redemande pas tant que la demande est ouverte. Chaque document demandé
 * est une demande à part — il va à qui traite ce type de document —, si bien
 * qu'un plafond sur le NOMBRE de demandes empêcherait de demander, d'un coup,
 * les quatre pièces d'un dossier de visa.
 *
 * La règle vit ici : le portail l'annonce (le document en cours est grisé)
 * avant de se faire refuser à l'envoi.
 */
export const documentsEnCours = (
  demandes: ReadonlyArray<{ status: string; docTypes: readonly string[] }>,
): Set<string> =>
  new Set(
    demandes
      .filter((d) => (OPEN_DOCUMENT_REQUEST_STATUSES as string[]).includes(d.status))
      .flatMap((d) => d.docTypes),
  );

export const createDocumentRequestSchema = z.object({
  /** Un ou plusieurs documents : chacun devient une demande, qui va à qui le traite. */
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

/** Une demande par document demandé. */
export interface CreateDocumentRequestResult {
  ids: string[];
}

/** Transitions pilotées par la RH — « prête » clôt le circuit. */
export const advanceDocumentRequestSchema = z.object({
  status: z.enum(['processing', 'ready', 'rejected']),
  /** Requis pour « prête » : à qui l'employé doit s'adresser. */
  pickupContact: z.string().trim().max(120).optional(),
  /** Message libre (obligatoire en cas de refus : le motif). */
  message: z.string().trim().max(500).optional(),
});
export type AdvanceDocumentRequestInput = z.infer<typeof advanceDocumentRequestSchema>;

/**
 * Même geste, sur plusieurs demandes à la fois.
 *
 * La RH ne traite pas les demandes une par une : elle sort le parapheur du
 * jour, génère la pile, la fait signer, puis annonce tout d'un coup. Boucler
 * côté navigateur sur l'appel unitaire laisserait la file à moitié avancée au
 * premier échec ; le lot est donc appliqué en une seule transaction.
 */
export const batchAdvanceDocumentRequestSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(50),
  /** « processing » n'a pas de sens en lot : on valide ou on décline. */
  status: z.enum(['ready', 'rejected']),
  pickupContact: z.string().trim().max(120).optional(),
  message: z.string().trim().max(500).optional(),
});
export type BatchAdvanceDocumentRequestInput = z.infer<typeof batchAdvanceDocumentRequestSchema>;

/**
 * Ce que le lot a réellement fait. Une demande déjà traitée par un collègue
 * pendant que l'écran était ouvert n'annule pas les autres : elle est
 * ÉCARTÉE et nommée, pour que la RH sache exactement ce qui est parti.
 */
export interface BatchAdvanceResult {
  advanced: number;
  skipped: { id: string; employeeName: string; reason: string }[];
}

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
  /**
   * Date de clôture — mise à disposition, remise, ou refus. `null` tant que la
   * demande est ouverte. C'est elle qui donne la durée de traitement : une
   * correction du point de retrait ne la déplace pas.
   */
  handledAt: string | null;
  /** true si l'utilisateur courant peut la faire avancer : il la traite pour la DCH. */
  canAdvance: boolean;
  /** Qui la traite, tant qu'elle est ouverte (sinon null). */
  traitement: TraitementView | null;
}
