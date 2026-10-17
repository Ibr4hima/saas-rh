import { z } from 'zod';
import type { TraitementView } from './acces';
import { EMPLOYEE_DOCUMENT_TYPES, MAX_EMPLOYEE_DOCUMENT_BYTES } from './documents';
import { maritalStatusSchema } from './employees';

/**
 * Demandes de mise à jour des informations personnelles.
 *
 * L'employé sait avant tout le monde qu'il a déménagé ou changé de numéro : il
 * propose la correction, la RH confirme, le dossier se met à jour. Même
 * principe que les demandes de documents.
 *
 * Le périmètre est volontairement ÉTROIT. N'y figure que ce qui relève de la
 * vie privée et qu'une déclaration suffit à établir. L'identité (nom, date de
 * naissance, nationalité), les pièces d'identité et tout ce qui touche au
 * contrat restent la main de la RH : ils s'appuient sur un document, pas sur
 * une déclaration.
 *
 * Le mariage fait exception : passer à « Marié(e) » se signale avec le
 * certificat que délivre la mairie. Qui vérifie les mises à jour
 * d'informations s'y fie ; validé, il rejoint les pièces du dossier
 * (ADR-0080).
 */

export const PROFILE_CHANGE_FIELDS = [
  'maritalStatus',
  'personalEmail',
  'phone',
  'addressLine',
] as const;
export type ProfileChangeField = (typeof PROFILE_CHANGE_FIELDS)[number];

/** Les intitulés des champs qu'on peut demander à faire changer aujourd'hui. */
export const PROFILE_CHANGE_LABELS: Record<ProfileChangeField, string> = {
  maritalStatus: 'Situation matrimoniale',
  personalEmail: 'Email personnel',
  phone: 'Téléphone personnel',
  addressLine: 'Adresse',
};

/**
 * Les intitulés de champs RETIRÉS de la liste.
 *
 * Une demande déposée avant le retrait porte encore ses clés d'origine dans
 * son jsonb. Sans son intitulé, elle s'afficherait à la RH sous son nom de
 * colonne, ou disparaîtrait de la comparaison — dans les deux cas on lui
 * demanderait d'approuver ce qu'elle ne peut pas lire.
 */
const LIBELLES_RETIRES: Record<string, string> = {
  emergencyContactName: 'Contact d’urgence',
  emergencyContactPhone: 'Téléphone du contact d’urgence',
};

/** Tout intitulé connu, courant ou retiré : ce que l'AFFICHAGE consulte. */
export const PROFILE_CHANGE_ALL_LABELS: Record<string, string> = {
  ...PROFILE_CHANGE_LABELS,
  ...LIBELLES_RETIRES,
};

/** Vidé, un champ vaut « effacer » : on distingue absent (inchangé) et null. */
const clearable = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable();

/**
 * Les valeurs proposées. Chaque clé est facultative : l'employé n'envoie que ce
 * qu'il change. La forme est REVALIDÉE à l'application côté serveur — un jsonb
 * stocké n'est jamais réinjecté tel quel dans un UPDATE.
 */
export const profileChangeValuesSchema = z
  .object({
    maritalStatus: maritalStatusSchema.nullable(),
    personalEmail: z
      .union([z.email().max(254), z.literal('')])
      .transform((v) => (v === '' ? null : v))
      .nullable(),
    phone: clearable(30),
    addressLine: clearable(200),
    // Plus proposés à la saisie, mais toujours validés : une demande en cours
    // de circuit doit s'appliquer ENTIÈRE le jour où la RH la valide, pas
    // amputée en silence des champs qu'on a cessé d'afficher entre-temps.
    emergencyContactName: clearable(120),
    emergencyContactPhone: clearable(30),
  })
  .partial();
export type ProfileChangeValues = z.infer<typeof profileChangeValuesSchema>;

/** Passer à « Marié(e) » : le certificat de mariage est exigé (ADR-0080). */
export const exigeLeCertificatDeMariage = (changes: { maritalStatus?: string | null }): boolean =>
  changes.maritalStatus === 'married';

/** Le certificat de mariage, en PDF, comme les pièces du dossier. */
export const certificatDeMariageSchema = z.object({
  filename: z.string().trim().min(1).max(200),
  contentType: z.enum(EMPLOYEE_DOCUMENT_TYPES),
  contentBase64: z
    .string()
    .min(1)
    .max(Math.ceil((MAX_EMPLOYEE_DOCUMENT_BYTES * 4) / 3) + 4),
});
export type CertificatDeMariageInput = z.infer<typeof certificatDeMariageSchema>;

export const createProfileChangeRequestSchema = z.object({
  changes: profileChangeValuesSchema.refine((v) => Object.keys(v).length > 0, {
    message: 'Indiquez au moins une information à corriger',
  }),
  note: z
    .string()
    .trim()
    .max(500)
    .transform((v) => (v === '' ? undefined : v))
    .optional(),
  /** Exigé avec un passage à « Marié(e) », refusé sans lui : le serveur en juge. */
  certificat: certificatDeMariageSchema.optional(),
});
export type CreateProfileChangeRequestInput = z.infer<typeof createProfileChangeRequestSchema>;

/** Décision de la RH : confirmer applique les valeurs, refuser exige un motif. */
export const decideProfileChangeRequestSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  message: z.string().trim().max(500).optional(),
  /**
   * Valider malgré un dossier modifié depuis la demande : la valeur demandée
   * remplace ce que la RH avait corrigé entre-temps. Sans lui, refusé.
   */
  ecraser: z.boolean().optional(),
});
export type DecideProfileChangeRequestInput = z.infer<typeof decideProfileChangeRequestSchema>;

export const profileChangeStatusSchema = z.enum(['pending', 'approved', 'rejected', 'cancelled']);
export type ProfileChangeStatus = z.infer<typeof profileChangeStatusSchema>;

export const PROFILE_CHANGE_STATUS_LABELS: Record<ProfileChangeStatus, string> = {
  pending: 'En attente',
  approved: 'Appliquée',
  rejected: 'Refusée',
  cancelled: 'Annulée',
};

export const PROFILE_CHANGE_STATUS_TONES: Record<
  ProfileChangeStatus,
  'orange' | 'teal' | 'rouge' | 'gris'
> = {
  pending: 'orange',
  approved: 'teal',
  rejected: 'rouge',
  cancelled: 'gris',
};

export interface ProfileChangeRequestView {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeNumber: string;
  status: ProfileChangeStatus;
  note: string | null;
  hrMessage: string | null;
  handledByName: string | null;
  createdAt: string;
  handledAt: string | null;
  /**
   * Une ligne par champ : ce qui change, et depuis quoi.
   *
   * `field` est une chaîne, pas l'union des champs demandables : une demande
   * déposée avant qu'un champ soit retiré de la liste doit rester lisible, et
   * le type doit dire ce que le service peut réellement renvoyer.
   */
  fields: {
    field: string;
    label: string;
    /** Valeur au moment de la demande — pour repérer un dossier modifié depuis. */
    previous: string | null;
    next: string | null;
    /** Valeur au dossier aujourd'hui (demande en attente) ; sinon null. */
    actuel: string | null;
    /** En attente, et le dossier a changé depuis la demande sur ce champ. */
    modifieDepuis: boolean;
  }[];
  /**
   * Le certificat de mariage joint, tant que la demande attend : pour qui
   * l'a envoyée et qui la traite (sinon null). Décidée, la demande ne le
   * garde pas : validé, il est au dossier.
   */
  certificat: { filename: string; sizeBytes: number } | null;
  /** true si l'utilisateur courant peut trancher cette demande. */
  canDecide: boolean;
  /** true si c'est la sienne, encore en attente : il peut l'annuler. */
  canCancel: boolean;
  /** Qui la traite, tant qu'elle est en attente (sinon null). */
  traitement: TraitementView | null;
}
