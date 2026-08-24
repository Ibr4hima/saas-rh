import { z } from 'zod';
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
 */

export const PROFILE_CHANGE_FIELDS = [
  'maritalStatus',
  'personalEmail',
  'phone',
  'addressLine',
  'city',
  'emergencyContactName',
  'emergencyContactPhone',
] as const;
export type ProfileChangeField = (typeof PROFILE_CHANGE_FIELDS)[number];

export const PROFILE_CHANGE_LABELS: Record<ProfileChangeField, string> = {
  maritalStatus: 'Situation matrimoniale',
  personalEmail: 'Email personnel',
  phone: 'Téléphone personnel',
  addressLine: 'Adresse',
  city: 'Ville',
  emergencyContactName: 'Contact d’urgence',
  emergencyContactPhone: 'Téléphone du contact d’urgence',
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
    city: clearable(120),
    emergencyContactName: clearable(120),
    emergencyContactPhone: clearable(30),
  })
  .partial();
export type ProfileChangeValues = z.infer<typeof profileChangeValuesSchema>;

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
});
export type CreateProfileChangeRequestInput = z.infer<typeof createProfileChangeRequestSchema>;

/** Décision de la RH : confirmer applique les valeurs, refuser exige un motif. */
export const decideProfileChangeRequestSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  message: z.string().trim().max(500).optional(),
});
export type DecideProfileChangeRequestInput = z.infer<typeof decideProfileChangeRequestSchema>;

export const profileChangeStatusSchema = z.enum(['pending', 'approved', 'rejected']);
export type ProfileChangeStatus = z.infer<typeof profileChangeStatusSchema>;

export const PROFILE_CHANGE_STATUS_LABELS: Record<ProfileChangeStatus, string> = {
  pending: 'En attente',
  approved: 'Appliquée',
  rejected: 'Refusée',
};

export const PROFILE_CHANGE_STATUS_TONES: Record<
  ProfileChangeStatus,
  'warning' | 'success' | 'danger'
> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
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
  /** Une ligne par champ : ce qui change, et depuis quoi. */
  fields: {
    field: ProfileChangeField;
    label: string;
    /** Valeur au moment de la demande — pour repérer un dossier modifié depuis. */
    previous: string | null;
    next: string | null;
  }[];
  /** true si l'utilisateur courant peut trancher cette demande. */
  canDecide: boolean;
}
