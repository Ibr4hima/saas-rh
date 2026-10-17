import { z } from 'zod';
import type { TraitementView } from './acces';
import { SALAIRE_MAX } from './montants';

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

/** Ce qu'un agent demande : la liste de la DCH, dans son ordre (ADR-0084). */
export const requestableDocSchema = z.enum([
  'contrat_cdd',
  'contrat_cdi',
  'contrat_stage',
  'attestation_conge',
  'attestation_travail',
  'attestation_reprise_service',
  'attestation_reprise_disponibilite',
  'attestation_depart_retraite',
  'attestation_stage',
  'attestation_cessation',
  'attestation_revenu',
  'domiciliation_bancaire',
  'decision_disponibilite',
  'decision_renouvellement_disponibilite',
  'declaration_mouvement',
  'certificat_travail',
]);

/**
 * Ce qui ne se demande plus (ADR-0045, ADR-0084) : ces documents ne se
 * lisent que sur les demandes anciennes, qui se traitent comme avant.
 */
export const DOCUMENTS_RETIRES = [
  'contrat_travail',
  'bulletin_salaire',
  'attestation_salaire',
  'autre',
] as const;

/** Un document demandé : un de la liste, ou un document retiré sur une demande ancienne. */
export type RequestableDoc =
  z.infer<typeof requestableDocSchema> | (typeof DOCUMENTS_RETIRES)[number];

export const REQUESTABLE_DOC_LABELS: Record<RequestableDoc, string> = {
  contrat_cdd: 'Contrat de travail à durée déterminée',
  contrat_cdi: 'Contrat de travail à durée indéterminée',
  contrat_stage: 'Contrat de stage',
  attestation_conge: 'Attestation de congé',
  attestation_travail: 'Attestation de travail',
  attestation_reprise_service: 'Attestation de reprise de service',
  attestation_reprise_disponibilite: 'Attestation de reprise après disponibilité',
  attestation_depart_retraite: 'Attestation de départ à la retraite',
  attestation_stage: 'Attestation de stage',
  attestation_cessation: 'Attestation de cessation de paiement et d’activités',
  attestation_revenu: 'Attestation de revenu',
  domiciliation_bancaire: 'Domiciliation bancaire',
  decision_disponibilite: 'Décision de mise en disponibilité',
  decision_renouvellement_disponibilite: 'Décision de renouvellement de disponibilité',
  declaration_mouvement: 'Déclaration de mouvement du travailleur',
  certificat_travail: 'Certificat de travail',
  contrat_travail: 'Contrat de travail',
  bulletin_salaire: 'Bulletin de salaire',
  attestation_salaire: 'Attestation de salaire',
  autre: 'Autre document',
};

/** Un document de la liste de la DCH, celui qu'un agent demande aujourd'hui. */
export type DocumentDeLaListe = z.infer<typeof requestableDocSchema>;

/**
 * Ce que l'application sait générer elle-même : les documents dont le modèle
 * est configuré (ADR-0085). Les autres, la DCH les prépare hors de l'outil.
 */
export const GENERATED_DOCS = [
  'attestation_travail',
  'attestation_revenu',
] as const satisfies readonly DocumentDeLaListe[];

/** Un document dont le modèle est configuré. */
export type DocumentGenere = (typeof GENERATED_DOCS)[number];

export const estGenere = (doc: string): doc is DocumentGenere =>
  (GENERATED_DOCS as readonly string[]).includes(doc);

/**
 * Ceux qui demandent un salaire, que la DCH saisit avant de générer : le
 * dossier ne le porte pas, la paie le connaît (ADR-0087).
 */
export const DOCS_AVEC_SALAIRE = [
  'attestation_revenu',
] as const satisfies readonly DocumentGenere[];

export const demandeUnSalaire = (doc: string): boolean =>
  (DOCS_AVEC_SALAIRE as readonly string[]).includes(doc);

/**
 * Ce que la DCH saisit pour générer un document. Il part dans le corps d'un
 * POST, jamais dans l'adresse : les journaux des serveurs gardent les
 * adresses, et un salaire n'a rien à y faire.
 */
export const saisiesDuDocumentSchema = z
  .object({
    /** Le salaire net mensuel, en francs CFA. */
    salaire: z.number().int().min(1).max(SALAIRE_MAX).optional(),
  })
  .strict();
export type SaisiesDuDocument = z.infer<typeof saisiesDuDocumentSchema>;

/**
 * Le nom du fichier d'un document généré : « attestation-travail-M0012.pdf ».
 * Un nom se répète, un matricule non. L'API le donne au PDF, le site à ce
 * qu'il enregistre : les deux tiennent la même règle d'ici.
 */
export function nomDuDocumentGenere(doc: DocumentGenere, matricule: string): string {
  return `${doc.replace(/_/g, '-')}-${matricule.replace(/[^A-Za-z0-9-]/g, '_')}.pdf`;
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
   Le bulletin de salaire se demandait pour une période (ADR-0039) : un mois,
   les N derniers mois, ou de tel mois à tel mois. Il ne se demande plus
   (ADR-0084) ; une demande ancienne se lit toujours avec ses mois.
*/

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

/** Les mois d'un bulletin demandé : « 2026-09 », les N derniers, ou de « 2026-07 » à « 2026-09 ». */
export type PeriodeDuBulletin =
  | { type: 'mois'; mois: string }
  | { type: 'derniers'; nombre: number }
  | { type: 'periode'; du: string; au: string };

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

export const createDocumentRequestSchema = z.object({
  /** Un ou plusieurs documents : chacun devient une demande, qui va à qui le traite. */
  docTypes: z.array(requestableDocSchema).min(1).max(requestableDocSchema.options.length),
  /** Le motif (banque, visa…) : facultatif mais utile à la RH. */
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

/*
   La remise en ligne (ADR-0040, ADR-0041) : qui traite la demande y dépose
   le document, et l'agent le télécharge depuis son espace une fois la
   demande prête. Plus besoin de passer au bureau, en télétravail ou en
   déplacement. Un PDF, 5 Mo au plus par fichier, douze fichiers au plus.
*/
export const TYPES_DE_FICHIER_REMIS = ['application/pdf'] as const;
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

/** Le nom d'un document remis se corrige : c'est celui que l'agent enregistre. */
export const renommerFichierSchema = z.object({
  filename: z.string().trim().min(1).max(200),
});
export type RenommerFichierInput = z.infer<typeof renommerFichierSchema>;

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
 * Les demandes nouvellement traitées que l'agent vient de voir sur son
 * suivi : leurs avis passent pour lus (ADR-0048).
 */
export const demandesVuesSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(100),
});
export type DemandesVuesInput = z.infer<typeof demandesVuesSchema>;

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
  /** Les mois d'un bulletin de salaire demandé avant l'ADR-0084 ; `null` sinon. */
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
  /**
   * Traitée, et l'avis qui l'annonce n'est pas encore lu : l'agent ne l'a
   * pas encore vue (ADR-0048). Dans son propre suivi seulement
   * (`scope=mine`) ; ailleurs, toujours faux.
   */
  nouvelle: boolean;
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
