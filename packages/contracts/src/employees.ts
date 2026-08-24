import { z } from 'zod';
import { cursorPageQuerySchema } from './core';

/** Contrats du module « dossier employé » (Lot 1). */

export const maritalStatusSchema = z.enum(['single', 'married', 'divorced', 'widowed']);
export const genderSchema = z.enum(['female', 'male']);
export const employeeStatusSchema = z.enum(['active', 'suspended', 'terminated']);
export const contractTypeSchema = z.enum(['cdi', 'cdd', 'stage', 'consultant', 'detachement']);
export const orgUnitTypeSchema = z.enum(['direction', 'department', 'service']);
export type OrgUnitType = z.infer<typeof orgUnitTypeSchema>;

const isoDate = z.iso.date();
const trimmed = (max: number) => z.string().trim().min(1).max(max);
const optionalTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? undefined : v))
    .optional();

// ---------- Unités d'organisation ----------

/** Un <select> HTML envoie '' pour « aucun » : on le tolère comme absent. */
const optionalUuid = z
  .uuid()
  .nullish()
  .or(z.literal('').transform(() => undefined));

/**
 * Abrégé d'une direction : « DCH » pour « Direction du Capital Humain ».
 * Normalisé en majuscules — un sigle ne se saisit pas en minuscules, et
 * l'unicité en base est insensible à la casse.
 */
const shortNameField = z
  .string()
  .trim()
  .max(12)
  .regex(/^[A-Za-zÀ-ÿ0-9&.\-\s]*$/, 'Lettres, chiffres et tirets uniquement')
  .transform((v) => (v === '' ? undefined : v.toUpperCase()))
  .optional();

export const createOrgUnitSchema = z.object({
  name: trimmed(120),
  unitType: orgUnitTypeSchema,
  parentId: optionalUuid,
  /** Réservé aux directions : refusé sur un département ou un service. */
  shortName: shortNameField,
});
export type CreateOrgUnitInput = z.infer<typeof createOrgUnitSchema>;

export const updateOrgUnitSchema = z.object({
  name: trimmed(120).optional(),
  unitType: orgUnitTypeSchema.optional(),
  /** null = détacher (racine) / retirer le responsable ; absent = inchangé. */
  parentId: z.uuid().nullable().optional(),
  managerEmployeeId: z.uuid().nullable().optional(),
  /**
   * `null` efface l'abrégé, l'absence le laisse inchangé. Attention : la chaîne
   * vide est traitée comme une ABSENCE (le formulaire web envoie `null`).
   */
  shortName: shortNameField.or(z.null()),
});
export type UpdateOrgUnitInput = z.infer<typeof updateOrgUnitSchema>;

/** Suppression d'une unité : ses membres doivent atterrir quelque part. */
export const deleteOrgUnitSchema = z.object({
  /** Unité d'accueil des membres — requise dès que l'unité en compte un. */
  reassignTo: optionalUuid,
});
export type DeleteOrgUnitInput = z.infer<typeof deleteOrgUnitSchema>;

export const orgUnitSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  unitType: orgUnitTypeSchema,
  parentId: z.uuid().nullable(),
  shortName: z.string().nullable(),
});
export type OrgUnit = z.infer<typeof orgUnitSchema>;

/** Libellé d'unité : « Direction du Capital Humain (DCH) ». */
export function orgUnitLabel(unit: { name: string; shortName?: string | null }): string {
  return unit.shortName ? `${unit.name} (${unit.shortName})` : unit.name;
}

/**
 * Rattachements autorisés : une direction est racine, un département relève
 * d'une direction, un service d'un département ou directement d'une direction.
 * Sans cette règle, on pouvait ranger une direction sous un service.
 */
export const ORG_UNIT_PARENT_TYPES: Record<OrgUnitType, OrgUnitType[]> = {
  direction: [],
  department: ['direction'],
  service: ['direction', 'department'],
};

export const ORG_UNIT_TYPE_LABELS: Record<OrgUnitType, string> = {
  direction: 'Direction',
  department: 'Département',
  service: 'Service',
};

/** Unité enrichie pour l'organigramme : responsable et effectif direct. */
export interface OrgUnitView extends OrgUnit {
  managerEmployeeId: string | null;
  managerName: string | null;
  managerPosition: string | null;
  /** Effectif AFFICHÉ : les personnes actives qui y travaillent aujourd'hui. */
  headcount: number;
  /**
   * Affectations non terminées pointant sur l'unité — suspendus et affectations
   * futures INCLUS. C'est ce nombre, et non l'effectif, qui décide si une
   * dissolution exige une unité d'accueil : un agent suspendu compte pour zéro
   * à l'écran mais reste rattaché quelque part.
   */
  openAssignments: number;
}

/** Membre d'une unité : les personnes actuellement affectées. */
export interface OrgUnitMember {
  employeeId: string;
  employeeNumber: string;
  givenName: string;
  familyName: string;
  positionTitle: string | null;
}

/**
 * Libellés d'état civil accordés selon le sexe. Partagés parce que le serveur
 * en a besoin lui aussi : il décrit « Célibataire → Mariée » dans les demandes
 * de correction, et l'accord ne se devine pas côté client.
 */
export function maritalLabelsFor(gender: string | null | undefined): Record<string, string> {
  const suffix = gender === 'female' ? 'e' : gender === 'male' ? '' : '·e';
  return {
    single: 'Célibataire',
    married: `Marié${suffix}`,
    divorced: `Divorcé${suffix}`,
    widowed: gender === 'female' ? 'Veuve' : gender === 'male' ? 'Veuf' : 'Veuf·ve',
  };
}

// ---------- Employé : création / mise à jour ----------

export const idDocumentTypeSchema = z.enum(['cni', 'passport']);
export type IdDocumentType = z.infer<typeof idDocumentTypeSchema>;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Date de naissance : dans le passé, et âge minimum de 15 ans. */
const birthDateSchema = isoDate.refine(
  (v) => {
    const today = new Date();
    const min = new Date(
      Date.UTC(today.getUTCFullYear() - 15, today.getUTCMonth(), today.getUTCDate()),
    )
      .toISOString()
      .slice(0, 10);
    return v <= min;
  },
  { message: 'La personne doit avoir au moins 15 ans (date dans le passé)' },
);

/** Cohérence de la pièce d'identité — partagée entre création et mise à jour. */
function checkIdDocument(
  p: {
    nationalId?: string | null;
    idDocumentType?: string | null;
    idDocumentIssuedOn?: string | null;
    idDocumentExpiresOn?: string | null;
  },
  ctx: z.RefinementCtx,
  requireTypeWithNumber: boolean,
): void {
  if (requireTypeWithNumber && p.nationalId && !p.idDocumentType) {
    ctx.addIssue({
      code: 'custom',
      path: ['idDocumentType'],
      message: 'Précisez le type de pièce (CNI ou passeport)',
    });
  }
  if (
    p.idDocumentIssuedOn &&
    p.idDocumentExpiresOn &&
    p.idDocumentIssuedOn >= p.idDocumentExpiresOn
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['idDocumentExpiresOn'],
      message: "La date d'expiration doit être postérieure à la date de délivrance",
    });
  }
  if (p.idDocumentExpiresOn && p.idDocumentExpiresOn <= todayIso()) {
    ctx.addIssue({
      code: 'custom',
      path: ['idDocumentExpiresOn'],
      message: "La pièce est expirée : la date d'expiration doit être dans le futur",
    });
  }
}

export const personFieldsBaseSchema = z.object({
  givenName: trimmed(80),
  familyName: trimmed(80),
  gender: genderSchema.optional(),
  birthDate: birthDateSchema.optional(),
  /** Pays de naissance (libellé français, choisi dans la liste). */
  birthPlace: optionalTrimmed(120),
  maritalStatus: maritalStatusSchema.optional(),
  nationality: z
    .string()
    .length(2)
    .transform((v) => v.toUpperCase())
    .optional(),
  /** Numéro de la pièce d'identité — chiffré au stockage. */
  nationalId: optionalTrimmed(40),
  idDocumentType: idDocumentTypeSchema.optional(),
  idDocumentIssuedOn: isoDate.optional(),
  idDocumentExpiresOn: isoDate.optional(),
  personalEmail: z.email().optional(),
  phone: optionalTrimmed(30),
  addressLine: optionalTrimmed(200),
  city: optionalTrimmed(80),
  emergencyContactName: optionalTrimmed(120),
  emergencyContactPhone: optionalTrimmed(30),
});

export const personFieldsSchema = personFieldsBaseSchema.superRefine((p, ctx) =>
  checkIdDocument(p, ctx, true),
);

export const employeeFieldsSchema = z.object({
  employeeNumber: trimmed(30),
  hiredOn: isoDate,
  workEmail: z.email().optional(),
  workPhone: optionalTrimmed(30),
  /** À qui l'agent rend compte. Absent = personne (un DG n'a pas de manager). */
  managerEmployeeId: optionalUuid,
  customFields: z.record(z.string(), z.unknown()).optional(),
});

export const initialContractSchema = z.object({
  contractType: contractTypeSchema,
  startDate: isoDate,
  endDate: isoDate.optional(),
  trialPeriodEnd: isoDate.optional(),
  notes: optionalTrimmed(2000),
});

export const initialAssignmentSchema = z.object({
  positionTitle: trimmed(120),
  orgUnitId: z.uuid().optional(),
  startDate: isoDate,
});

export const createEmployeeSchema = z.object({
  person: personFieldsSchema,
  employee: employeeFieldsSchema,
  contract: initialContractSchema.optional(),
  assignment: initialAssignmentSchema.optional(),
});
export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;

/** En mise à jour : absent = inchangé, null = effacé, valeur = remplacée. */
const clearableString = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable();

export const updatePersonFieldsSchema = z
  .object({
    givenName: trimmed(80),
    familyName: trimmed(80),
    gender: genderSchema.nullable(),
    birthDate: birthDateSchema.nullable(),
    birthPlace: clearableString(120),
    maritalStatus: maritalStatusSchema.nullable(),
    // NOT NULL en base (défaut 'SN') : modifiable mais jamais effaçable.
    nationality: z
      .string()
      .length(2)
      .transform((v) => v.toUpperCase()),
    nationalId: clearableString(40),
    idDocumentType: idDocumentTypeSchema.nullable(),
    idDocumentIssuedOn: isoDate.nullable(),
    idDocumentExpiresOn: isoDate.nullable(),
    personalEmail: z.email().nullable(),
    phone: clearableString(30),
    addressLine: clearableString(200),
    city: clearableString(80),
    emergencyContactName: clearableString(120),
    emergencyContactPhone: clearableString(30),
  })
  .partial()
  // En mise à jour partielle on ne peut pas exiger le type avec le numéro
  // (les champs absents sont « inchangés ») : seule la cohérence des dates
  // fournies est vérifiée.
  .superRefine((p, ctx) => checkIdDocument(p, ctx, false));

export const updateEmployeeFieldsSchema = z
  .object({
    employeeNumber: trimmed(30),
    hiredOn: isoDate,
    workEmail: z.email().nullable(),
    workPhone: clearableString(30),
    status: employeeStatusSchema,
    /** null = plus de manager ; absent = inchangé. */
    managerEmployeeId: z.uuid().nullable(),
  })
  .partial();

export const updateEmployeeSchema = z.object({
  person: updatePersonFieldsSchema.optional(),
  employee: updateEmployeeFieldsSchema.optional(),
});
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;

/** Nouvelle affectation effective-dated : clôt la précédente à startDate. */
export const newAssignmentSchema = z.object({
  positionTitle: trimmed(120),
  orgUnitId: z.uuid().nullish(),
  startDate: isoDate,
});
export type NewAssignmentInput = z.infer<typeof newAssignmentSchema>;

// ---------- Employé : lecture ----------

export const listEmployeesQuerySchema = cursorPageQuerySchema.extend({
  q: z.string().trim().max(120).optional(),
  status: employeeStatusSchema.optional(),
});
export type ListEmployeesQuery = z.infer<typeof listEmployeesQuerySchema>;

export interface EmployeeListItem {
  id: string;
  employeeNumber: string;
  givenName: string;
  familyName: string;
  status: string;
  hiredOn: string;
  positionTitle: string | null;
  orgUnitName: string | null;
  /**
   * Abrégé de la DIRECTION de rattachement (« DCH »), remonté depuis l'unité
   * d'affectation quel que soit son niveau : un agent du Service Comptabilité
   * relève de la DFC. Le nom complet de la direction est dans `directionName`,
   * pour l'infobulle — la colonne, elle, doit rester courte.
   */
  directionShortName: string | null;
  directionName: string | null;
  /** Contrat le plus récent : c'est lui que la RH lit dans la liste. */
  contractStartDate: string | null;
  contractEndDate: string | null;
  managerId: string | null;
  managerName: string | null;
  workEmail: string | null;
}

export interface AssignmentView {
  id: string;
  positionTitle: string;
  orgUnitId: string | null;
  orgUnitName: string | null;
  validFrom: string;
  validTo: string | null;
  current: boolean;
}

export interface ContractView {
  id: string;
  contractType: string;
  startDate: string;
  endDate: string | null;
  trialPeriodEnd: string | null;
  notes: string | null;
}

export interface EmployeeDetail {
  id: string;
  employeeNumber: string;
  status: string;
  hiredOn: string;
  workEmail: string | null;
  workPhone: string | null;
  managerId: string | null;
  managerName: string | null;
  customFields: Record<string, unknown>;
  person: {
    id: string;
    givenName: string;
    familyName: string;
    gender: string | null;
    birthDate: string | null;
    birthPlace: string | null;
    maritalStatus: string | null;
    nationality: string;
    nationalId: string | null;
    idDocumentType: string | null;
    idDocumentIssuedOn: string | null;
    idDocumentExpiresOn: string | null;
    personalEmail: string | null;
    phone: string | null;
    addressLine: string | null;
    city: string | null;
    emergencyContactName: string | null;
    emergencyContactPhone: string | null;
  };
  assignments: AssignmentView[];
  contracts: ContractView[];
  portal: {
    status: 'none' | 'invited' | 'active';
    role: string | null;
  };
}

export interface EmployeeHistoryEntry {
  id: string;
  tableName: string;
  action: string;
  occurredAt: string;
  actorUserId: string | null;
  changedFields: string[];
}
