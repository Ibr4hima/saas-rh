import { z } from 'zod';

/** Contrats du module « dossier employé » (Lot 1). */

export const maritalStatusSchema = z.enum(['single', 'married', 'divorced', 'widowed']);
export const genderSchema = z.enum(['female', 'male']);
/**
 * Deux états, et deux seulement.
 *
 * `active` : l'agent est dans l'organisation. `archived` : il n'y est plus,
 * mais on a encore le droit de conserver son dossier — le portail se ferme,
 * le dossier reste, et le rendre actif rouvre l'accès tel quel. Au-delà du
 * délai de conservation, le dossier ne s'archive plus : il s'efface.
 */
export const employeeStatusSchema = z.enum(['active', 'archived']);
export type EmployeeStatus = z.infer<typeof employeeStatusSchema>;
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
    // Effaçable comme les autres champs facultatifs : depuis la migration
    // 0015, « pas renseignée » est un état, plus un défaut silencieux.
    nationality: z
      .string()
      .length(2)
      .transform((v) => v.toUpperCase())
      .nullable(),
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
    /**
     * Le statut n'est PAS ici : fermer un dossier révoque des sessions et se
     * refuse dans des cas précis (soi-même, dernier administrateur, chef
     * d'unité). Le laisser passer par la modification générique aurait posé le
     * statut sans rien de tout cela — un dossier archivé dont le portail reste
     * ouvert. Il a sa route : POST employees/archive.
     */
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

/** Les trois colonnes qu'on trie ; `recent` est l'ordre d'arrivée, par défaut. */
export const employeeSortSchema = z.enum(['recent', 'name', 'contractStart', 'contractEnd']);
export type EmployeeSort = z.infer<typeof employeeSortSchema>;

const optionalFiltre = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? undefined : v))
    .optional();

/**
 * La liste passe au décalage plutôt qu'au curseur.
 *
 * Un curseur est arrimé À UNE clé de tri — ici la date de création. Dès que la
 * colonne de tri change, il faudrait un curseur par clé, et pour les dates de
 * contrat, qui sont des sous-requêtes corrélées, il faudrait répéter la
 * sous-requête dans le WHERE de chaque page. À l'échelle d'un effectif —
 * quelques centaines d'agents, vingt-cinq par page — le décalage est la
 * réponse honnête. Sa faiblesse est connue : une embauche enregistrée pendant
 * qu'on feuillette décale la fenêtre d'un rang.
 */
export const listEmployeesQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: employeeStatusSchema.optional(),
  positionTitle: optionalFiltre(120),
  managerId: z
    .uuid()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  /** L'unité TELLE QU'ELLE S'AFFICHE : l'abrégé de la direction, sinon le nom. */
  unit: optionalFiltre(120),
  sort: employeeSortSchema.default('recent'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListEmployeesQuery = z.infer<typeof listEmployeesQuerySchema>;

/** Ce qui remplit les listes déroulantes de filtre, pour l'onglet courant. */
export interface EmployeeFacets {
  positions: string[];
  managers: { id: string; name: string }[];
  units: string[];
}

export interface EmployeeListPage {
  items: EmployeeListItem[];
  /** Décalage de la page suivante ; null quand il n'y en a plus. */
  nextOffset: number | null;
  /**
   * Effectifs par statut À RECHERCHE ÉGALE, mais sans tenir compte de l'onglet :
   * c'est ce qui permet aux onglets de dire où se trouve ce qu'on cherche.
   */
  counts: { active: number; archived: number };
  facets: EmployeeFacets;
}

/**
 * Archiver ou réactiver, par lot — le même geste dans les deux sens.
 *
 * Rien n'est touché au compte : mot de passe, identifiant et rôle restent en
 * place. C'est ce qui permet de rouvrir l'accès sans rien redemander à
 * l'agent, six mois plus tard, avec les identifiants qu'il connaît déjà.
 */
export const archiveEmployeesSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(100),
  archived: z.boolean(),
});
export type ArchiveEmployeesInput = z.infer<typeof archiveEmployeesSchema>;

/**
 * Suppression définitive. Sans retour, et sans reste : le dossier, le portail,
 * les congés, les documents, les demandes — et jusqu'au contenu que le journal
 * d'audit avait recopié au passage.
 */
export const deleteEmployeesSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(50),
});
export type DeleteEmployeesInput = z.infer<typeof deleteEmployeesSchema>;

/** Ce qu'un lot a réellement fait, et ce qu'il a laissé de côté, avec le motif. */
export interface EmployeeBatchResult {
  done: number;
  skipped: { id: string; name: string; reason: string }[];
}

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
  /** Date d'archivage — c'est elle qui fait courir le délai de conservation. */
  archivedAt: string | null;
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
    nationality: string | null;
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
