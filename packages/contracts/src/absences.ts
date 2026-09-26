import { z } from 'zod';
import type { CompteursDemandes, TraitementView } from './acces';

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

/**
 * La date est facultative : la Korité s'inscrit dès janvier et ne se date qu'à
 * l'annonce. C'est l'année qui rattache la fête au tableau, pas le jour.
 */
export const createHolidaySchema = z.object({
  year: z.number().int().min(2000).max(2100),
  day: isoDate.nullish(),
  label: z.string().trim().min(2).max(120),
});
export type CreateHolidayInput = z.infer<typeof createHolidaySchema>;

/** Dater une fête mobile, la recaler ou la renommer : le même geste. */
export const updateHolidaySchema = z.object({
  day: isoDate.nullish(),
  label: z.string().trim().min(2).max(120),
});
export type UpdateHolidayInput = z.infer<typeof updateHolidaySchema>;

export interface Holiday {
  id: string;
  year: number;
  /** Null tant que la fête n'est pas datée. */
  day: string | null;
  label: string;
  /** Férié à date civile : le produit refuse de le déplacer (il se retire). */
  fixed: boolean;
}

// ---------- Circuit d'approbation ----------

/**
 * Le circuit d'une demande d'absence, décidé avec l'APIX : le N+1 de l'agent
 * la vise d'abord ; une fois visée, elle passe au DIRECTEUR DU CAPITAL
 * HUMAIN (le responsable de la direction du personnel, dans l'organigramme),
 * qui la traite ou la confie à un membre de sa direction.
 *
 * Il n'est pas paramétrable, et c'est voulu : « qui valide mes congés ? » a
 * une seule réponse dans l'agence, lue dans l'organigramme — pas dans une
 * liste de rôles qu'on réordonne.
 *
 *   — le N+1 est celui de l'agent AU MOMENT où il vise : une mutation, une
 *     reprise d'équipe, une cascade font passer la demande au nouveau ;
 *   — sans N+1 qui puisse viser (le DG, un N+1 archivé, sans accès au
 *     portail, ou en congé), la demande va directement à la DCH ;
 *   — le directeur du Capital Humain traite, ou confie : une demande à la
 *     fois, ou toutes, à un membre de sa direction — il n'est alors plus
 *     prévenu, mais il voit tout et peut reprendre la main ;
 *   — la demande du directeur du Capital Humain lui-même : le visa du DG
 *     suffit ;
 *   — la même personne attendue aux deux étapes vise une seule fois ;
 *   — personne ne vise sa propre demande.
 */
export const CIRCUIT_CONGES = ['n1', 'dch'] as const;
export type EtapeConge = (typeof CIRCUIT_CONGES)[number];

export const ETAPE_CONGE_LABELS: Record<EtapeConge, string> = {
  n1: 'N+1',
  dch: 'DCH',
};

/**
 * Où en est une étape du circuit :
 *   — visée / refusée : quelqu'un a signé ;
 *   — attendue : c'est elle qui bloque, en ce moment ;
 *   — à venir : elle viendra après l'étape attendue ;
 *   — passée : pas de N+1 qui puisse viser, la demande est allée à la DCH ;
 *   — sans objet : elle n'aura pas lieu (refus plus tôt, annulation, ou
 *     demande du directeur du Capital Humain, que le DG vise seul).
 */
export type EtatEtapeConge = 'visee' | 'refusee' | 'attendue' | 'a_venir' | 'passee' | 'sans_objet';

export interface EtapeCircuitView {
  etape: EtapeConge;
  etat: EtatEtapeConge;
  /** Qui a signé ; ou, pour l'étape attendue, qui est attendu. */
  qui: string | null;
  /** Visée pour le compte du directeur du Capital Humain, par délégation. */
  parDelegationDe: string | null;
  decidedAt: string | null;
  comment: string | null;
}

/** Ce que l'appelant a devant lui : son équipe, ce qu'il vise, ce qu'il traite. */
export interface CompteursValidations {
  /** Ses agents directs actifs (le DG n'est de l'équipe de personne). */
  equipe: number;
  /** Les demandes de ses agents qui attendent SON visa. */
  aViser: number;
  /** Les demandes qui attendent qu'IL les traite pour la DCH, par type. */
  aTraiter: CompteursDemandes;
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
  /** Les demandes des agents directs de l'appelant — celles qu'il vise. */
  equipe: z.stringbool().optional(),
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
  /** L'étape en cours (0 : n+1, 1 : RH) — celle qui compte AUJOURD'HUI. */
  currentLevel: number;
  /** L'étape qui attend un visa, tant que la demande est en attente. */
  etapeAttendue: EtapeConge | null;
  /** Le circuit, étape par étape : qui a signé, qui est attendu. */
  circuit: EtapeCircuitView[];
  /** true si l'utilisateur courant peut viser l'étape attendue. */
  canDecide: boolean;
  /** Qui traite pour la DCH — quand c'est l'étape attendue (sinon null). */
  traitement: TraitementView | null;
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
