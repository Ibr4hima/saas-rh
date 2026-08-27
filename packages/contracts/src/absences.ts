import { z } from 'zod';
import { membershipRoleSchema } from './core';

/** Contrats du module « congés & absences » (Lot 1). */

const isoDate = z.iso.date();

// ---------- Types d'absences ----------

/**
 * La période sur laquelle le quota se rouvre. « none » n'est pas un trou : la
 * maternité ouvre ses jours à la naissance, pas au 1er janvier.
 */
export const absenceFrequencySchema = z.enum(['annual', 'monthly', 'none']);
export type AbsenceFrequency = z.infer<typeof absenceFrequencySchema>;

export const ABSENCE_FREQUENCY_LABELS: Record<AbsenceFrequency, string> = {
  annual: 'Par an',
  monthly: 'Par mois',
  none: 'Par événement',
};

const absenceTypeFields = z.object({
  name: z.string().trim().min(2).max(80),
  deductsBalance: z.boolean().default(true),
  allowanceDays: z.number().min(0).max(365).nullish(),
  frequency: absenceFrequencySchema.default('none'),
  requiresDocument: z.boolean().default(false),
});

/** « 30 par an » se comprend ; « par an » tout court ne veut rien dire. */
const allowanceMatchesFrequency = (v: {
  frequency: AbsenceFrequency;
  allowanceDays?: number | null;
}) => v.frequency === 'none' || v.allowanceDays != null;
const allowanceMessage = {
  message: 'Indiquez un nombre de jours, ou choisissez « Par événement »',
  path: ['allowanceDays'] as PropertyKey[],
};

export const createAbsenceTypeSchema = absenceTypeFields.refine(
  allowanceMatchesFrequency,
  allowanceMessage,
);
export type CreateAbsenceTypeInput = z.infer<typeof createAbsenceTypeSchema>;

/** La fenêtre de modification renvoie le type entier : même forme qu'à la création. */
export const updateAbsenceTypeSchema = absenceTypeFields.refine(
  allowanceMatchesFrequency,
  allowanceMessage,
);
export type UpdateAbsenceTypeInput = z.infer<typeof updateAbsenceTypeSchema>;

export interface AbsenceType {
  id: string;
  name: string;
  deductsBalance: boolean;
  allowanceDays: number | null;
  frequency: AbsenceFrequency;
  requiresDocument: boolean;
  /** Nombre de demandes déjà déposées sur ce type : il ne se supprime pas à la légère. */
  usageCount: number;
}

// ---------- Jours fériés ----------

export const createHolidaySchema = z.object({
  day: isoDate,
  label: z.string().trim().min(2).max(120),
});
export type CreateHolidayInput = z.infer<typeof createHolidaySchema>;

/** Corriger une fête mobile, c'est en changer la date, l'intitulé, ou les deux. */
export const updateHolidaySchema = createHolidaySchema;
export type UpdateHolidayInput = z.infer<typeof updateHolidaySchema>;

export interface Holiday {
  id: string;
  day: string;
  label: string;
  /** Férié à date civile : le produit refuse de le déplacer ou de le retirer. */
  fixed: boolean;
}

// ---------- Circuit d'approbation ----------

export const updateApprovalChainSchema = z.object({
  levels: z.array(membershipRoleSchema).min(1).max(5),
});
export type UpdateApprovalChainInput = z.infer<typeof updateApprovalChainSchema>;

export interface ApprovalChain {
  levels: string[];
}

// ---------- Soldes ----------

export const setBalanceSchema = z.object({
  employeeId: z.uuid(),
  absenceTypeId: z.uuid(),
  year: z.number().int().min(2000).max(2100),
  entitledDays: z.number().min(0).max(365),
});
export type SetBalanceInput = z.infer<typeof setBalanceSchema>;

export interface BalanceView {
  absenceTypeId: string;
  absenceTypeName: string;
  deductsBalance: boolean;
  year: number;
  entitledDays: number;
  takenDays: number;
  pendingDays: number;
  remainingDays: number;
}

// ---------- Demandes ----------

export const MAX_JUSTIFICATIF_BYTES = 5 * 1024 * 1024;

/** Justificatif d'absence : PDF uniquement (attestation, ordre de mission…). */
export const absenceJustificatifSchema = z.object({
  filename: z.string().trim().min(1).max(200),
  contentBase64: z
    .string()
    .min(1)
    .max(Math.ceil((MAX_JUSTIFICATIF_BYTES * 4) / 3) + 4),
});

export const createAbsenceRequestSchema = z
  .object({
    employeeId: z.uuid(),
    absenceTypeId: z.uuid(),
    startDate: isoDate,
    endDate: isoDate,
    reason: z.string().trim().max(1000).optional(),
    document: absenceJustificatifSchema.optional(),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: 'La date de fin doit être postérieure ou égale à la date de début',
    path: ['endDate'],
  });
export type CreateAbsenceRequestInput = z.infer<typeof createAbsenceRequestSchema>;

export const decideAbsenceRequestSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  comment: z.string().trim().max(1000).optional(),
});
export type DecideAbsenceRequestInput = z.infer<typeof decideAbsenceRequestSchema>;

export const listAbsenceRequestsQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
  employeeId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListAbsenceRequestsQuery = z.infer<typeof listAbsenceRequestsQuerySchema>;

export interface ApprovalView {
  level: number;
  decision: string;
  decidedByName: string;
  comment: string | null;
  decidedAt: string;
}

export interface AbsenceRequestView {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeNumber: string;
  workEmail: string | null;
  absenceTypeId: string;
  absenceTypeName: string;
  deductsBalance: boolean;
  startDate: string;
  endDate: string;
  daysCount: number;
  reason: string | null;
  status: string;
  currentLevel: number;
  /** Rôles de la chaîne, dans l'ordre ; longueur = nombre de niveaux. */
  chainLevels: string[];
  /** true si l'utilisateur courant peut viser le niveau en attente. */
  canDecide: boolean;
  approvals: ApprovalView[];
  /** Nom du justificatif PDF joint, s'il y en a un. */
  documentName: string | null;
  createdAt: string;
}

// ---------- Jours fériés du Sénégal ----------

/**
 * Les six fériés sénégalais à date civile. Ils sont posés d'office sur chaque
 * année consultée : ils tomberont là, quoi qu'il arrive.
 */
export const SENEGAL_FIXED_HOLIDAYS: Array<{ label: string; month: number; day: number }> = [
  { label: 'Nouvel an', month: 1, day: 1 },
  { label: "Fête de l'indépendance", month: 4, day: 4 },
  { label: 'Fête du travail', month: 5, day: 1 },
  { label: 'Assomption', month: 8, day: 15 },
  { label: 'Toussaint', month: 11, day: 1 },
  { label: 'Noël', month: 12, day: 25 },
];

/**
 * Les huit fêtes mobiles : elles se datent à la main, à l'annonce — le
 * croissant pour les unes, le calendrier pascal pour les autres. Simple liste
 * de suggestions à la saisie, rien n'oblige à s'y tenir.
 */
export const SENEGAL_MOBILE_HOLIDAYS: string[] = [
  'Korité',
  'Tabaski',
  'Tamkharit',
  'Maouloud',
  'Magal de Touba',
  'Lundi de Pâques',
  'Ascension',
  'Lundi de Pentecôte',
];

/** Aperçu du décompte avant soumission. */
export const previewAbsenceSchema = z.object({
  startDate: isoDate,
  endDate: isoDate,
});
export interface AbsencePreview {
  workingDays: number;
  holidaysSkipped: { day: string; label: string }[];
}
