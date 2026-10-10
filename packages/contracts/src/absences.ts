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
  /** Se demande aussi à l'heure, sur un jour : un rendez-vous, une démarche. */
  allowsHours: z.boolean().optional(),
  /** Au plus tant de jours ouvrés par demande ; null : pas de plafond. */
  maxDaysPerRequest: z.number().int().min(1).max(365).nullish(),
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

/** Les soldes se tiennent en jours : ce qui s'en décompte se prend à la journée. */
const heuresHorsSolde = (v: ChampsDuType & { allowsHours?: boolean }) =>
  !(v.allowsHours && v.deductsBalance);
const heuresMessage = {
  message: 'Un type décompté du solde se demande à la journée',
  path: ['allowsHours'] as PropertyKey[],
};

export const createAbsenceTypeSchema = absenceTypeFields
  .refine(quotaCoherent, quotaMessage)
  .refine(decompteSurQuota, decompteMessage)
  .refine(heuresHorsSolde, heuresMessage);
export type CreateAbsenceTypeInput = z.infer<typeof createAbsenceTypeSchema>;

/** La fenêtre de modification renvoie le type entier : même forme qu'à la création. */
export const updateAbsenceTypeSchema = absenceTypeFields
  .refine(quotaCoherent, quotaMessage)
  .refine(decompteSurQuota, decompteMessage)
  .refine(heuresHorsSolde, heuresMessage);
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
  allowsHours: boolean;
  maxDaysPerRequest: number | null;
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

/** Une heure du jour, « 09:30 ». */
const heure = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Heure attendue au format HH:MM');

/**
 * Une journée de travail, pour compter une absence à l'heure : quarante
 * heures par semaine, sur cinq jours.
 */
export const HEURES_PAR_JOUR = 8;

/** Une absence à l'heure se prend dans la journée de travail, de 8 h à 17 h. */
export const HEURE_DEBUT_JOURNEE = '08:00';
export const HEURE_FIN_JOURNEE = '17:00';

/** Les minutes entre deux heures du même jour (« 10:00 », « 11:30 » : 90). */
export function minutesEntre(debut: string, fin: string): number {
  const enMinutes = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
  return enMinutes(fin) - enMinutes(debut);
}

/**
 * Ce qu'une absence à l'heure compte, en jours : deux heures font 0,25 jour,
 * et une journée au plus, même quand les heures la dépassent.
 */
export function joursDHeures(debut: string, fin: string): number {
  const jours = Math.round((minutesEntre(debut, fin) / (HEURES_PAR_JOUR * 60)) * 100) / 100;
  return Math.min(1, Math.max(0.01, jours));
}

/** « 10 h », « 10 h 30 » : une heure telle qu'on l'écrit, d'un seul tenant. */
export function heureEnLettres(h: string): string {
  const minutes = h.slice(3, 5);
  return `${Number(h.slice(0, 2))}\u00a0h${minutes === '00' ? '' : `\u00a0${minutes}`}`;
}

/** De 8 h à 17 h au plus : les heures tiennent dans la journée de travail. */
export const dansLaJournee = (debut: string, fin: string) =>
  debut >= HEURE_DEBUT_JOURNEE && fin <= HEURE_FIN_JOURNEE;

/** « Une absence à l'heure se situe entre 8 h et 17 h ». */
export const horsDeLaJournee = `Une absence à l’heure se situe entre ${heureEnLettres(HEURE_DEBUT_JOURNEE)} et ${heureEnLettres(HEURE_FIN_JOURNEE)}`;

/** « 2 h », « 1 h 30 », « 45 min » : la durée d'une absence à l'heure. */
export function dureeEnLettres(debut: string, fin: string): string {
  const total = minutesEntre(debut, fin);
  const [heures, minutes] = [Math.floor(total / 60), total % 60];
  if (heures === 0) return `${minutes}\u00a0min`;
  return `${heures}\u00a0h${minutes === 0 ? '' : `\u00a0${String(minutes).padStart(2, '0')}`}`;
}

export const createAbsenceRequestSchema = z
  .object({
    employeeId: z.uuid(),
    absenceTypeId: z.uuid(),
    startDate: isoDate,
    endDate: isoDate,
    /** À l'heure : de telle heure à telle heure, le même jour. */
    startTime: heure.optional(),
    endTime: heure.optional(),
    reason: z.string().trim().max(1000).optional(),
    document: absenceJustificatifSchema.optional(),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: 'La date de fin doit être postérieure ou égale à la date de début',
    path: ['endDate'],
  })
  .refine((v) => (v.startTime === undefined) === (v.endTime === undefined), {
    message: 'Indiquez l’heure de début et l’heure de fin',
    path: ['endTime'],
  })
  .refine((v) => v.startTime === undefined || v.startDate === v.endDate, {
    message: 'Une absence à l’heure tient sur un seul jour',
    path: ['endDate'],
  })
  .refine((v) => !v.startTime || !v.endTime || minutesEntre(v.startTime, v.endTime) > 0, {
    message: 'L’heure de fin doit suivre l’heure de début',
    path: ['endTime'],
  })
  .refine((v) => !v.startTime || !v.endTime || dansLaJournee(v.startTime, v.endTime), {
    message: horsDeLaJournee,
    path: ['startTime'],
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
  /** En stage aujourd'hui : le congé annuel lui est fermé. */
  stagiaire: boolean;
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
  /** À l'heure : « 10:00 » à « 12:00 », le même jour ; null : journées entières. */
  startTime: string | null;
  endTime: string | null;
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
