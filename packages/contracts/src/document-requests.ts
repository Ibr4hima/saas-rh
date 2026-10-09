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

/** Ce que l'attestation de travail imprimera, mot pour mot : l'aperçu le montre tel quel. */
export interface AttestationApercu {
  titre: string;
  paragraphes: string[];
  lieuEtDate: string;
  signature: string[];
}

/** `delivered` : statut historique, conservé en lecture (voir en-tête). */
export const documentRequestStatusSchema = z.enum([
  'received',
  'processing',
  'ready',
  'delivered',
  'rejected',
  'cancelled',
]);
export type DocumentRequestStatus = z.infer<typeof documentRequestStatusSchema>;

export const DOC_REQUEST_STATUS_LABELS: Record<DocumentRequestStatus, string> = {
  received: 'Reçue',
  processing: 'En traitement',
  ready: 'Prête à retirer',
  delivered: 'Remise',
  rejected: 'Refusée',
  cancelled: 'Annulée',
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
  cancelled: 'gris',
};

/**
 * Le statut tel qu'il se lit : prête, une demande dont le document est
 * déposé en ligne est « Disponible », plus « à retirer ».
 */
export function statutDeLaDemande(r: {
  status: DocumentRequestStatus;
  fichiers: readonly unknown[];
}): string {
  return r.status === 'ready' && r.fichiers.length > 0
    ? 'Disponible'
    : DOC_REQUEST_STATUS_LABELS[r.status];
}

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

/*
   Le bulletin de salaire se demande pour une période (ADR-0039) : un mois,
   les N derniers mois, ou de tel mois à tel mois. La DCH sait ainsi quels
   bulletins sortir, sans les chercher dans une précision libre.
*/

/** « 2026-09 » : un mois de paie. */
export const moisDePaieSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mois invalide');

/** Au plus douze bulletins par demande, quelle que soit la façon de les demander. */
export const BULLETINS_PAR_DEMANDE_MAX = 12;

export const MOIS_DE_L_ANNEE = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
] as const;

/** Le nombre de mois de `du` à `au`, l'un et l'autre compris. */
export function moisDeDuAu(du: string, au: string): number {
  const [a1, m1] = du.split('-').map(Number) as [number, number];
  const [a2, m2] = au.split('-').map(Number) as [number, number];
  return (a2 - a1) * 12 + (m2 - m1) + 1;
}

export const periodeDuBulletinSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('mois'), mois: moisDePaieSchema }),
  z.object({
    type: z.literal('derniers'),
    nombre: z.number().int().min(2).max(BULLETINS_PAR_DEMANDE_MAX),
  }),
  z
    .object({ type: z.literal('periode'), du: moisDePaieSchema, au: moisDePaieSchema })
    .refine((p) => p.au > p.du, {
      message: 'Le dernier mois vient après le premier',
      path: ['au'],
    })
    .refine((p) => moisDeDuAu(p.du, p.au) <= BULLETINS_PAR_DEMANDE_MAX, {
      message: `Au plus ${BULLETINS_PAR_DEMANDE_MAX} mois par demande`,
      path: ['au'],
    }),
]);
export type PeriodeDuBulletin = z.infer<typeof periodeDuBulletinSchema>;

/** « septembre 2026 ». */
export function moisEnLettres(mois: string): string {
  const [annee, m] = mois.split('-');
  return `${MOIS_DE_L_ANNEE[Number(m) - 1]} ${annee}`;
}

/**
 * « septembre 2026 », « 3 derniers mois », « janvier à juin 2026 »,
 * « novembre 2025 à février 2026 ».
 */
export function periodeEnLettres(p: PeriodeDuBulletin): string {
  if (p.type === 'mois') return moisEnLettres(p.mois);
  if (p.type === 'derniers') return `${p.nombre} derniers mois`;
  const memeAnnee = p.du.slice(0, 4) === p.au.slice(0, 4);
  const debut = memeAnnee ? MOIS_DE_L_ANNEE[Number(p.du.slice(5)) - 1] : moisEnLettres(p.du);
  return `${debut} à ${moisEnLettres(p.au)}`;
}

/** Le document tel qu'il se lit dans une file : « Bulletin de salaire · 3 derniers mois ». */
export function documentDemande(doc: RequestableDoc, bulletin: PeriodeDuBulletin | null): string {
  const libelle = REQUESTABLE_DOC_LABELS[doc] ?? doc;
  return doc === 'bulletin_salaire' && bulletin
    ? `${libelle} · ${periodeEnLettres(bulletin)}`
    : libelle;
}

export const createDocumentRequestSchema = z
  .object({
    /** Un ou plusieurs documents : chacun devient une demande, qui va à qui le traite. */
    docTypes: z.array(requestableDocSchema).min(1).max(6),
    /** Les mois du bulletin de salaire : requis avec lui, et seulement avec lui. */
    bulletin: periodeDuBulletinSchema.optional(),
    /** Le motif (banque, visa…) : facultatif mais utile à la RH. */
    note: z
      .string()
      .trim()
      .max(500)
      .transform((v) => (v === '' ? undefined : v))
      .optional(),
  })
  .refine((d) => !d.docTypes.includes('bulletin_salaire') || d.bulletin, {
    message: 'Précisez les mois du bulletin de salaire',
    path: ['bulletin'],
  })
  .refine((d) => d.docTypes.includes('bulletin_salaire') || !d.bulletin, {
    message: 'Des mois ne se précisent que pour un bulletin de salaire',
    path: ['bulletin'],
  });
export type CreateDocumentRequestInput = z.infer<typeof createDocumentRequestSchema>;

/** Une demande par document demandé. */
export interface CreateDocumentRequestResult {
  ids: string[];
}

/*
   La remise en ligne (ADR-0040) : qui traite la demande y dépose le
   document, et l'agent le télécharge depuis son espace une fois la demande
   prête. Plus besoin de passer au bureau, en télétravail ou en déplacement.
   PDF, JPEG ou PNG, 5 Mo au plus par fichier, douze fichiers au plus.
*/
export const TYPES_DE_FICHIER_REMIS = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export const MAX_FICHIER_REMIS_BYTES = 5 * 1024 * 1024;
export const FICHIERS_REMIS_MAX = 12;

export const deposerFichierSchema = z.object({
  filename: z.string().trim().min(1).max(200),
  contentType: z.enum(TYPES_DE_FICHIER_REMIS),
  contentBase64: z
    .string()
    .min(1)
    .max(Math.ceil((MAX_FICHIER_REMIS_BYTES * 4) / 3) + 4),
});
export type DeposerFichierInput = z.infer<typeof deposerFichierSchema>;

/** Un document remis en ligne, sans son contenu : seul le téléchargement le lit. */
export interface FichierRemisView {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}

/** Transitions pilotées par la RH — « prête » clôt le circuit. */
export const advanceDocumentRequestSchema = z.object({
  status: z.enum(['processing', 'ready', 'rejected']),
  /**
   * Pour « prête » : à qui s'adresser. Sans précision, à qui la traite ; à
   * personne si le document est déposé en ligne.
   */
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
  /** Les mois demandés, pour un bulletin de salaire ; `null` sinon (ou demandé avant). */
  bulletin: PeriodeDuBulletin | null;
  note: string | null;
  status: DocumentRequestStatus;
  pickupContact: string | null;
  /**
   * Les documents remis en ligne. L'agent les voit une fois la demande
   * prête ; qui la traite, dès leur dépôt.
   */
  fichiers: FichierRemisView[];
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
  /** true si c'est la sienne, et qu'elle n'est pas encore prête : il peut l'annuler. */
  canCancel: boolean;
  /**
   * true quand la session y dépose, retire et télécharge les documents
   * remis : ouverte, si elle la traite ; prête, si elle traite ce type de
   * document pour la DCH.
   */
  canHandleFiles: boolean;
  /** Qui la traite, tant qu'elle est ouverte (sinon null). */
  traitement: TraitementView | null;
}
