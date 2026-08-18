import { z } from 'zod';
import { cursorPageQuerySchema } from './index';

/** Contrats du module « dossier employé » (Lot 1). */

export const maritalStatusSchema = z.enum(['single', 'married', 'divorced', 'widowed']);
export const genderSchema = z.enum(['female', 'male']);
export const employeeStatusSchema = z.enum(['active', 'suspended', 'terminated']);
export const contractTypeSchema = z.enum(['cdi', 'cdd', 'stage', 'consultant', 'detachement']);
export const orgUnitTypeSchema = z.enum(['direction', 'department', 'service']);

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

export const createOrgUnitSchema = z.object({
  name: trimmed(120),
  unitType: orgUnitTypeSchema,
  parentId: optionalUuid,
});
export type CreateOrgUnitInput = z.infer<typeof createOrgUnitSchema>;

export const updateOrgUnitSchema = z.object({
  name: trimmed(120).optional(),
  unitType: orgUnitTypeSchema.optional(),
  /** null = détacher (racine) / retirer le responsable ; absent = inchangé. */
  parentId: z.uuid().nullable().optional(),
  managerEmployeeId: z.uuid().nullable().optional(),
});
export type UpdateOrgUnitInput = z.infer<typeof updateOrgUnitSchema>;

export const orgUnitSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  unitType: orgUnitTypeSchema,
  parentId: z.uuid().nullable(),
});
export type OrgUnit = z.infer<typeof orgUnitSchema>;

/** Unité enrichie pour l'organigramme : responsable et effectif direct. */
export interface OrgUnitView extends OrgUnit {
  managerEmployeeId: string | null;
  managerName: string | null;
  managerPosition: string | null;
  headcount: number;
}

/** Membre d'une unité : les personnes actuellement affectées. */
export interface OrgUnitMember {
  employeeId: string;
  employeeNumber: string;
  givenName: string;
  familyName: string;
  positionTitle: string | null;
}

// ---------- Employé : création / mise à jour ----------

export const personFieldsSchema = z.object({
  givenName: trimmed(80),
  familyName: trimmed(80),
  gender: genderSchema.optional(),
  birthDate: isoDate.optional(),
  birthPlace: optionalTrimmed(120),
  maritalStatus: maritalStatusSchema.optional(),
  nationality: z
    .string()
    .length(2)
    .transform((v) => v.toUpperCase())
    .optional(),
  nationalId: optionalTrimmed(40),
  personalEmail: z.email().optional(),
  phone: optionalTrimmed(30),
  addressLine: optionalTrimmed(200),
  city: optionalTrimmed(80),
  emergencyContactName: optionalTrimmed(120),
  emergencyContactPhone: optionalTrimmed(30),
});

export const employeeFieldsSchema = z.object({
  employeeNumber: trimmed(30),
  hiredOn: isoDate,
  workEmail: z.email().optional(),
  workPhone: optionalTrimmed(30),
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
    birthDate: isoDate.nullable(),
    birthPlace: clearableString(120),
    maritalStatus: maritalStatusSchema.nullable(),
    // NOT NULL en base (défaut 'SN') : modifiable mais jamais effaçable.
    nationality: z
      .string()
      .length(2)
      .transform((v) => v.toUpperCase()),
    nationalId: clearableString(40),
    personalEmail: z.email().nullable(),
    phone: clearableString(30),
    addressLine: clearableString(200),
    city: clearableString(80),
    emergencyContactName: clearableString(120),
    emergencyContactPhone: clearableString(30),
  })
  .partial();

export const updateEmployeeFieldsSchema = z
  .object({
    employeeNumber: trimmed(30),
    hiredOn: isoDate,
    workEmail: z.email().nullable(),
    workPhone: clearableString(30),
    status: employeeStatusSchema,
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

// ---------- Import CSV ----------

export const importEmployeesSchema = z.object({
  /** Contenu brut du fichier CSV (séparateur ; ou ,). */
  content: z.string().min(1).max(5_000_000),
  /** true = valider seulement, ne rien écrire. */
  dryRun: z.boolean().default(true),
});
export type ImportEmployeesInput = z.infer<typeof importEmployeesSchema>;

export interface ImportRowError {
  line: number;
  field: string;
  message: string;
}

export interface ImportReport {
  dryRun: boolean;
  totalRows: number;
  validRows: number;
  importedRows: number;
  errors: ImportRowError[];
}

/** Colonnes attendues du gabarit d'import (en-têtes exacts, insensibles à la casse). */
export const IMPORT_COLUMNS = [
  'matricule',
  'prenom',
  'nom',
  'date_embauche',
  'email_pro',
  'telephone',
  'poste',
  'type_contrat',
  'date_debut_contrat',
] as const;
