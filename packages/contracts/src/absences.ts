import { z } from 'zod';
import type { CompteursDemandes, TraitementView } from './acces';

/** Contrats du module « congés & absences » (Lot 1). */

const isoDate = z.iso.date();

// ---------- Types d'absences ----------

/**
 * Un type a un quota annuel, ou n'en a pas. « Par mois » et « par événement »
 * se proposaient sans jamais s'appliquer : ils sont retirés (migration 0075).
 */
export const absenceFrequencySchema = z.enum(['annual', 'none']);
export type AbsenceFrequency = z.infer<typeof absenceFrequencySchema>;

export const ABSENCE_FREQUENCY_LABELS: Record<AbsenceFrequency, string> = {
  annual: 'Par an',
  none: 'Sans quota',
};

const absenceTypeFields = z.object({
  name: z.string().trim().min(2).max(80),
  deductsBalance: z.boolean().default(false),
  allowanceDays: z.number().min(0).max(365).nullish(),
  frequency: absenceFrequencySchema.default('none'),
  requiresDocument: z.boolean().default(false),
  /** L'agent reste joignable (une mission) : il vise encore ce qui l'attend. */
  resteJoignable: z.boolean().optional(),
  /** Le motif ne regarde que l'agent et la DCH : le N+1 voit une absence. */
  motifConfidentiel: z.boolean().optional(),
});

type ChampsDuType = {
  frequency: AbsenceFrequency;
  allowanceDays?: number | null;
  deductsBalance: boolean;
};

/** Un quota annuel a son nombre de jours ; sans quota, pas de nombre. */
const quotaCoherent = (v: ChampsDuType) => (v.frequency === 'annual') === (v.allowanceDays != null);
const quotaMessage = {
  message: 'Un quota annuel se donne en jours ; sans quota, pas de nombre de jours',
  path: ['allowanceDays'] as PropertyKey[],
};
/** Seul un quota se décompte : décompter sans quota refuserait toute demande. */
const decompteSurQuota = (v: ChampsDuType) => !v.deductsBalance || v.frequency === 'annual';
const decompteMessage = {
  message: 'Seul un quota annuel se décompte du solde',
  path: ['deductsBalance'] as PropertyKey[],
};

export const createAbsenceTypeSchema = absenceTypeFields
  .refine(quotaCoherent, quotaMessage)
  .refine(decompteSurQuota, decompteMessage);
export type CreateAbsenceTypeInput = z.infer<typeof createAbsenceTypeSchema>;

/** La fenêtre de modification renvoie le type entier : même forme qu'à la création. */
export const updateAbsenceTypeSchema = absenceTypeFields
  .refine(quotaCoherent, quotaMessage)
  .refine(decompteSurQuota, decompteMessage);
export type UpdateAbsenceTypeInput = z.infer<typeof updateAbsenceTypeSchema>;

export interface AbsenceType {
  id: string;
  name: string;
  deductsBalance: boolean;
  allowanceDays: number | null;
  frequency: AbsenceFrequency;
  requiresDocument: boolean;
  resteJoignable: boolean;
  motifConfidentiel: boolean;
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
 *   - sans réponse : personne n'a visé dans le délai ; la demande est
 *     passée à la DCH (étape du N+1), ou elle a expiré ;
 *   — sans objet : elle n'aura pas lieu (refus plus tôt, annulation, ou
 *     demande du directeur du Capital Humain, que le DG vise seul).
 */
export type EtatEtapeConge =
  'visee' | 'refusee' | 'attendue' | 'a_venir' | 'passee' | 'sans_reponse' | 'sans_objet';

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
  /**
   * Ses agents directs actifs, et ceux partis dont l'évaluation reste à
   * terminer (le DG n'est de l'équipe de personne).
   */
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
  /**
   * Type retiré depuis : son solde de l'année reste lisible (ses demandes y
   * comptent), mais il ne se propose plus.
   */
  retire: boolean;
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

/** Le justificatif joint après coup. */
export const joindreJustificatifSchema = absenceJustificatifSchema;
export type JoindreJustificatifInput = z.infer<typeof joindreJustificatifSchema>;

/** Un agent pour qui la DCH saisit une demande. */
export interface AgentSaisieView {
  id: string;
  nom: string;
  matricule: string;
}

export const decideAbsenceRequestSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  comment: z.string().trim().max(1000).optional(),
});
export type DecideAbsenceRequestInput = z.infer<typeof decideAbsenceRequestSchema>;

// ---------- Un congé validé qui change ----------

/**
 * Annuler. L'agent annule le sien tant qu'il n'a pas commencé, sans motif ;
 * la DCH qui annule le congé validé d'un autre dit pourquoi.
 */
export const annulerAbsenceSchema = z
  .object({
    motif: z.string().trim().max(1000).optional(),
  })
  .default({});
export type AnnulerAbsenceInput = z.infer<typeof annulerAbsenceSchema>;

/** Revenir plus tôt : le jour où l'agent reprend le travail. */
export const demanderRepriseSchema = z.object({ reprise: isoDate });
export type DemanderRepriseInput = z.infer<typeof demanderRepriseSchema>;

/** Le N+1 (ou la DCH, à défaut) confirme le retour, ou le refuse. */
export const deciderRepriseSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
});
export type DeciderRepriseInput = z.infer<typeof deciderRepriseSchema>;

/** Rappeler l'agent en congé : le jour où il reprend, et pourquoi. */
export const rappelerSchema = z.object({
  reprise: isoDate,
  motif: z.string().trim().min(1, 'Indiquez le motif du rappel').max(1000),
});
export type RappelerInput = z.infer<typeof rappelerSchema>;

export const listAbsenceRequestsQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled', 'expired']).optional(),
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
  /**
   * Null, et « Absence » pour nom, quand le motif est confidentiel et que
   * l'utilisateur n'est ni l'agent ni la DCH : le motif saisi et le
   * justificatif lui sont tus aussi.
   */
  absenceTypeId: string | null;
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
  /** Le type exige un justificatif, la demande attend encore le sien. */
  justificatifAttendu: boolean;
  /** Saisie par la DCH pour l'agent : qui l'a saisie (sinon null). */
  saisiePar: string | null;
  /** La fin validée au départ, quand le congé a été écourté. */
  finInitiale: string | null;
  /** Écourté : le retour de l'agent, confirmé, ou un rappel de l'employeur. */
  ecourtement: {
    nature: 'retour' | 'rappel';
    par: string | null;
    le: string;
    motif: string | null;
  } | null;
  /** Annulé par la DCH (et non par l'agent) : qui, et pourquoi. */
  annulation: { par: string | null; motif: string | null } | null;
  /** Le jour de reprise que l'agent demande, tant qu'il attend confirmation. */
  repriseDemandee: string | null;
  /** Qui doit confirmer ce retour. */
  repriseAttendDe: string | null;
  /** Ce que l'utilisateur courant peut faire de ce congé. */
  gestes: {
    annuler: boolean;
    demanderReprise: boolean;
    confirmerReprise: boolean;
    rappeler: boolean;
    joindreJustificatif: boolean;
  };
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
  /** Les jours ouvrés de chaque année touchée : chacune les retranche de son solde. */
  parAnnee: { annee: number; jours: number }[];
}
