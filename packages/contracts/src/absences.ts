import { z } from 'zod';
import { membershipRoleSchema } from './index';

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

export const createAbsenceRequestSchema = z
  .object({
    employeeId: z.uuid(),
    absenceTypeId: z.uuid(),
    startDate: isoDate,
    endDate: isoDate,
    reason: z.string().trim().max(1000).optional(),
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
  createdAt: string;
}

/** Aperçu du décompte avant soumission. */
export const previewAbsenceSchema = z.object({
  startDate: isoDate,
  endDate: isoDate,
});
export interface AbsencePreview {
  workingDays: number;
  holidaysSkipped: { day: string; label: string }[];
}
