import { z } from 'zod';
import { membershipRoleSchema } from './core';

/** Contrats du module « congés & absences » (Lot 1). */

const isoDate = z.iso.date();

// ---------- Types d'absences ----------

export const createAbsenceTypeSchema = z.object({
  name: z.string().trim().min(2).max(80),
  deductsBalance: z.boolean().default(true),
  defaultAnnualDays: z.number().min(0).max(365).nullish(),
  requiresDocument: z.boolean().default(false),
});
export type CreateAbsenceTypeInput = z.infer<typeof createAbsenceTypeSchema>;

export interface AbsenceType {
  id: string;
  name: string;
  deductsBalance: boolean;
  defaultAnnualDays: number | null;
  requiresDocument: boolean;
}

// ---------- Jours fériés ----------

export const createHolidaySchema = z.object({
  day: isoDate,
  label: z.string().trim().min(2).max(120),
});
export type CreateHolidayInput = z.infer<typeof createHolidaySchema>;

export interface Holiday {
  id: string;
  day: string;
  label: string;
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
 * Les 14 jours fériés sénégalais. Ceux à date fixe portent month/day et sont
 * préremplis chaque année ; les fêtes mobiles (religieuses) se datent à la main.
 */
export const SENEGAL_HOLIDAYS: Array<{ label: string; month?: number; day?: number }> = [
  { label: 'Nouvel an', month: 1, day: 1 },
  { label: "Fête de l'indépendance", month: 4, day: 4 },
  { label: 'Fête du travail', month: 5, day: 1 },
  { label: 'Assomption', month: 8, day: 15 },
  { label: 'Toussaint', month: 11, day: 1 },
  { label: 'Noël', month: 12, day: 25 },
  { label: 'Korité' },
  { label: 'Tabaski' },
  { label: 'Tamkharit' },
  { label: 'Maouloud' },
  { label: 'Magal de Touba' },
  { label: 'Lundi de Pâques' },
  { label: 'Ascension' },
  { label: 'Lundi de Pentecôte' },
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
