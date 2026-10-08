import { z } from 'zod';
import type { AnomalieHierarchie, ChangementRattachement } from './hierarchie';

/** Contrats du module « dossier employé » (Lot 1). */

export const maritalStatusSchema = z.enum(['single', 'married', 'divorced', 'widowed']);
export const genderSchema = z.enum(['female', 'male']);
/**
 * Deux états, et deux seulement.
 *
 * `active` : l'agent est dans l'organisation. `archived` : il n'y est plus.
 * Le portail se ferme, le dossier reste, pour toujours : qui revient, même
 * des années plus tard, retrouve le sien et son matricule. Un dossier ne
 * s'efface que dans les 30 jours qui suivent sa saisie, une erreur.
 */
export const employeeStatusSchema = z.enum(['active', 'archived']);
export type EmployeeStatus = z.infer<typeof employeeStatusSchema>;

/**
 * Pourquoi un agent est devenu inactif. La fin de contrat se pose d'elle-même,
 * le lendemain du dernier jour d'un CDD ou d'un stage ; les autres, la DCH
 * les choisit en désactivant le dossier.
 */
export const MOTIFS_INACTIVITE = [
  'fin_de_contrat',
  'demission',
  'licenciement',
  'retraite',
  'deces',
] as const;
export const motifInactiviteSchema = z.enum(MOTIFS_INACTIVITE);
export type MotifInactivite = z.infer<typeof motifInactiviteSchema>;

export const MOTIF_INACTIVITE_LABELS: Record<MotifInactivite, string> = {
  fin_de_contrat: 'Fin de contrat',
  demission: 'A quitté l’APIX',
  licenciement: 'Licenciement',
  retraite: 'Départ à la retraite',
  deces: 'Décès',
};
export const contractTypeSchema = z.enum(['cdi', 'cdd', 'stage', 'consultant', 'detachement']);

/* Les trois vocabulaires d'état civil et celui des contrats, nommés : l'import
   d'un fichier RH traduit « Homme » en `male` et doit pouvoir le TYPER. */
export type Gender = z.infer<typeof genderSchema>;
export type MaritalStatus = z.infer<typeof maritalStatusSchema>;
export type ContractType = z.infer<typeof contractTypeSchema>;
export const orgUnitTypeSchema = z.enum(['direction', 'department', 'service']);
export type OrgUnitType = z.infer<typeof orgUnitTypeSchema>;

const isoDate = z.iso.date();
const trimmed = (max: number) => z.string().trim().min(1).max(max);
/** Un matricule s'écrit en capitales, quelle que soit la frappe. */
const matricule = trimmed(30).toUpperCase();
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
 * Acronyme d'une direction : « DCH » pour « Direction du Capital Humain ».
 * Obligatoire pour une direction, refusé aux départements et services.
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

export const createOrgUnitSchema = z
  .object({
    name: trimmed(120),
    unitType: orgUnitTypeSchema,
    parentId: optionalUuid,
    /** Réservé aux directions, et obligatoire pour elles. */
    shortName: shortNameField,
  })
  .refine((u) => u.unitType !== 'direction' || Boolean(u.shortName), {
    message: 'Une direction a un acronyme',
    path: ['shortName'],
  });
export type CreateOrgUnitInput = z.infer<typeof createOrgUnitSchema>;

export const updateOrgUnitSchema = z.object({
  name: trimmed(120).optional(),
  unitType: orgUnitTypeSchema.optional(),
  /** null = détacher (racine) / retirer le responsable ; absent = inchangé. */
  parentId: z.uuid().nullable().optional(),
  managerEmployeeId: z.uuid().nullable().optional(),
  /**
   * Avec un changement de responsable : le jour où le nouveau prend ses
   * fonctions, et où l'ancien les quitte. Leurs affectations le disent dès ce
   * jour-là. Au plus tard aujourd'hui ; par défaut, aujourd'hui.
   */
  depuis: isoDate.optional(),
  /** Le poste que l'ancien responsable occupe ensuite, dans la même unité. */
  posteDeLAncien: trimmed(120).optional(),
  /**
   * `null` efface l'acronyme, l'absence le laisse inchangé. Attention : la chaîne
   * vide est traitée comme une ABSENCE (le formulaire web envoie `null`).
   */
  shortName: shortNameField.or(z.null()),
  /**
   * La direction du personnel (la DCH) : elle traite les demandes des agents,
   * son responsable est le directeur du Capital Humain. Une seule : la
   * marquer la retire à l'autre.
   */
  directionDuPersonnel: z.boolean().optional(),
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
 * Le poste de qui dirige une unité, tel que ses affectations l'écrivent :
 * « Directeur de la DGT », « Directrice générale », « Chef du service
 * Comptabilité ». Sans genre connu, l'intitulé ne le devine pas :
 * « Responsable de la DGT ».
 */
export function posteDeResponsable(
  unite: { name: string; unitType: OrgUnitType; shortName?: string | null; sommet: boolean },
  genre: string | null | undefined,
): string {
  const f = genre === 'female';
  const m = genre === 'male';
  let poste: string;
  if (unite.sommet && (f || m)) {
    poste = f ? 'Directrice générale' : 'Directeur général';
  } else if (unite.unitType === 'direction') {
    const titre = f ? 'Directrice' : m ? 'Directeur' : 'Responsable';
    poste = `${titre} de la ${unite.shortName || unite.name}`;
  } else {
    const nature = unite.unitType === 'department' ? 'département' : 'service';
    const titre = f ? 'Cheffe' : m ? 'Chef' : 'Responsable';
    // « Service Comptabilité » se dit « du service Comptabilité » : le mot
    // ne se répète pas.
    const nom = unite.name.replace(new RegExp(`^${nature}\\s+`, 'iu'), '');
    poste = `${titre} du ${nature} ${nom}`;
  }
  return poste.slice(0, 120);
}

/**
 * Rattachements autorisés : une direction relève d'une autre direction — la
 * Direction Générale chapeaute les directions métier —, un département d'une
 * direction, un service d'un département ou directement d'une direction.
 * Sans cette règle, on pouvait ranger une direction sous un service.
 */
export const ORG_UNIT_PARENT_TYPES: Record<OrgUnitType, OrgUnitType[]> = {
  direction: ['direction'],
  department: ['direction'],
  service: ['direction', 'department'],
};

/**
 * Les types qui peuvent vivre SANS parent, au sommet de l'organigramme.
 *
 * Seule une direction le peut, et une seule le fait en pratique : la Direction
 * Générale. Mais l'organigramme se construit rarement de haut en bas — on
 * saisit les directions métier d'abord, la Générale ensuite —, alors on
 * n'impose pas qu'un parent existe déjà. Un département orphelin, lui, n'a
 * aucun sens : il n'existe que rattaché.
 */
export const ORG_UNIT_ROOT_TYPES: OrgUnitType[] = ['direction'];

export const ORG_UNIT_TYPE_LABELS: Record<OrgUnitType, string> = {
  direction: 'Direction',
  department: 'Département',
  service: 'Service',
};

/** Unité enrichie pour l'organigramme : responsable et effectif direct. */
export interface OrgUnitView extends OrgUnit {
  managerEmployeeId: string | null;
  managerName: string | null;
  /**
   * Le responsable tel qu'il tient dans un bloc d'organigramme : premier
   * prénom en entier, suivants en initiales (cf. `nomAbrege`). `managerName`
   * reste le nom complet, pour les écrans qui ont la place de l'écrire.
   */
  managerShortName: string | null;
  /** Son genre, pour la civilité du bloc : « M. Abdoulaye Diallo ». */
  managerGender: 'female' | 'male' | null;
  /** Son matricule : « Mariama C. · EMP-002 » se lit sans ambiguïté. */
  managerNumber: string | null;
  managerPosition: string | null;
  /**
   * Le début de l'affectation en cours du responsable, quand il est en
   * activité : remplacé, il reçoit un nouveau poste, daté au plus tôt de ce
   * jour. `null` : rien à lui donner.
   */
  managerDepuis: string | null;
  /**
   * L'unité est LE sommet de l'organigramme — la Direction Générale, dont le
   * responsable est le directeur général. Dit par le serveur, avec la même
   * définition que l'écriture : un vestige d'avant la règle (une seconde
   * unité sans parent) n'est pas le sommet.
   */
  sommet: boolean;
  /** La direction du personnel (la DCH) — une seule dans l'organisation. */
  directionDuPersonnel: boolean;
  /**
   * Effectif AFFICHÉ : les personnes actives qui y travaillent aujourd'hui,
   * dans l'unité ou ses sous-unités (sans les directions qu'elle coiffe).
   */
  headcount: number;
  /**
   * Personnes dont l'affectation à cette unité n'a pas pris fin — suspendus et
   * affectations futures INCLUS. C'est ce nombre, et non l'effectif, qu'il faut
   * annoncer avant une dissolution : un agent suspendu compte pour zéro à
   * l'écran mais se retrouverait, lui aussi, sans unité.
   */
  attachedEmployees: number;
}

/** Membre d'une unité : les personnes actuellement affectées. */
export interface OrgUnitMember {
  employeeId: string;
  employeeNumber: string;
  givenName: string;
  familyName: string;
  positionTitle: string | null;
  /** Membre d'une sous-unité : son nom ; affecté à l'unité même : `null`. */
  unite?: string | null;
  /**
   * Parmi qui peut diriger l'unité : le début de son affectation en cours.
   * Ses fonctions de responsable commencent au plus tôt ce jour-là.
   */
  depuis?: string;
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
  if (requireTypeWithNumber && p.idDocumentType && !p.nationalId) {
    ctx.addIssue({
      code: 'custom',
      path: ['nationalId'],
      message: 'Indiquez le numéro de la pièce',
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
  emergencyContactName: optionalTrimmed(120),
  emergencyContactPhone: optionalTrimmed(30),
});

export const personFieldsSchema = personFieldsBaseSchema.superRefine((p, ctx) =>
  checkIdDocument(p, ctx, true),
);

export const employeeFieldsSchema = z.object({
  employeeNumber: matricule,
  hiredOn: isoDate,
  workEmail: z.email().optional(),
  workPhone: optionalTrimmed(30),
  /** À qui l'agent rend compte. Absent = personne (un DG n'a pas de manager). */
  managerEmployeeId: optionalUuid,
  customFields: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Un contrat, le premier comme les suivants : un CDI, un CDD ou un stage ;
 * plus de consultant ni de détachement (ceux d'avant restent lisibles). Un
 * CDD ou un stage a une date de fin : c'est elle qui fera passer l'agent
 * dans les inactifs. Les mêmes règles à la création, au formulaire comme à
 * l'import, et pour un nouveau contrat.
 */
const champsDuContrat = {
  contractType: contractTypeSchema,
  startDate: isoDate,
  endDate: isoDate.optional(),
  trialPeriodEnd: isoDate.optional(),
  notes: optionalTrimmed(2000),
};
const reglesDuContrat = <
  S extends z.ZodType<{ contractType: string; startDate: string; endDate?: string }>,
>(
  schema: S,
) =>
  schema
    .refine((c) => ['cdi', 'cdd', 'stage'].includes(c.contractType), {
      message: 'Un contrat est un CDI, un CDD ou un stage',
      path: ['contractType'],
    })
    .refine((c) => !['cdd', 'stage'].includes(c.contractType) || c.endDate !== undefined, {
      message: 'Un CDD ou un stage a une date de fin',
      path: ['endDate'],
    })
    .refine((c) => !c.endDate || c.endDate >= c.startDate, {
      message: 'La fin du contrat précède son début',
      path: ['endDate'],
    });

export const initialContractSchema = reglesDuContrat(z.object(champsDuContrat));

/**
 * Un nouveau contrat : le précédent s'arrête la veille, s'il courait encore.
 * Il dit aussi le poste et la direction où l'agent travaille sous ce contrat :
 * inchangés, rien ne bouge ; changés, une nouvelle affectation part du début
 * du contrat. Sur un dossier inactif, il le réactive.
 */
/**
 * Ce qu'un agent qui revient reprend : la RH le décide. Les unités dont il
 * redevient responsable, parmi celles qu'il dirigeait ; son équipe, quand il
 * n'en dirigeait aucune (sinon, elle suit l'unité).
 */
export const repriseDesResponsabilitesSchema = z.object({
  unites: z.array(z.uuid()).max(20).default([]),
  equipe: z.boolean().default(false),
});
export type RepriseDesResponsabilites = z.infer<typeof repriseDesResponsabilitesSchema>;

export const newContractSchema = reglesDuContrat(
  z.object({
    ...champsDuContrat,
    affectation: z.object({
      positionTitle: trimmed(120),
      /** La direction : dans la même direction, l'unité en cours est gardée. */
      orgUnitId: z.uuid(),
    }),
    /** Un retour : ce qu'il reprend, à la reprise ou le jour où le contrat commence. */
    reprendre: repriseDesResponsabilitesSchema.optional(),
  }),
);
export type NewContractInput = z.infer<typeof newContractSchema>;

/**
 * Corriger le dernier contrat, saisi par erreur : un CDD saisi à un mois au
 * lieu de douze. Les mêmes règles qu'un nouveau contrat.
 */
export const corrigerContratSchema = initialContractSchema;
export type CorrigerContratInput = z.infer<typeof corrigerContratSchema>;

/** Corriger l'affectation en cours : son intitulé de poste, sa date de début. */
export const corrigerAffectationSchema = z.object({
  positionTitle: trimmed(120),
  startDate: isoDate,
});
export type CorrigerAffectationInput = z.infer<typeof corrigerAffectationSchema>;

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
  /** Envoyer l'invitation au portail dans la foulée. */
  inviter: z.boolean().optional(),
});
export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;

export interface CreateEmployeeResult {
  id: string;
  /** Demandée à la création : partie, ou ce qui l'a empêchée. */
  invitation: InvitationAuPassage | null;
}

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
    employeeNumber: matricule,
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
const nouvelleAffectation = z.object({
  /** Sans objet pour qui prend la tête de l'unité : son poste est celui de responsable. */
  positionTitle: trimmed(120).optional(),
  orgUnitId: z.uuid().nullish(),
  startDate: isoDate,
  /**
   * Il prend la tête de l'unité, ce jour-là : son poste est celui de
   * responsable, et celui qu'il remplace reçoit `posteDeLAncien`.
   */
  responsable: z.boolean().optional(),
  posteDeLAncien: trimmed(120).optional(),
  /**
   * Le nouveau responsable hiérarchique, dans la même opération.
   *
   * Muter un agent d'une direction à l'autre rend son n+1 caduc — il reste
   * dans l'ancienne direction. Et l'on ne peut pas le changer AVANT la
   * mutation : la règle refuserait un responsable d'une autre direction. Les
   * deux gestes n'en font donc qu'un. Absent, le n+1 courant est conservé, à
   * condition qu'il tienne encore après la mutation.
   */
  managerEmployeeId: z.uuid().optional(),
  /**
   * Qui reprend l'équipe de l'agent, quand il en encadre une et quitte sa
   * direction : ses agents, eux, y restent. Sans repreneur, la mutation est
   * refusée — une équipe ne se retrouve pas rattachée hors de sa direction.
   */
  repreneurEquipeId: z.uuid().optional(),
});
export const newAssignmentSchema = nouvelleAffectation
  .refine((a) => a.responsable || a.positionTitle, {
    message: 'Indiquez le poste',
    path: ['positionTitle'],
  })
  .refine((a) => !a.responsable || a.orgUnitId, {
    message: 'Choisissez l’unité qu’il dirigera',
    path: ['orgUnitId'],
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
 * Un filtre qui prend PLUSIEURS valeurs : `?unit=DCH&unit=DG`. Une seule
 * arrive en chaîne, plusieurs en tableau ; les deux sortent en tableau, et
 * rien du tout (ou que des vides) sort en `undefined`, comme un filtre absent.
 */
const filtreMultiple = (max: number) =>
  z
    .union([z.string().trim().max(max), z.array(z.string().trim().max(max)).max(50)])
    .transform((v) => {
      const valeurs = (Array.isArray(v) ? v : [v]).filter((x) => x !== '');
      return valeurs.length > 0 ? valeurs : undefined;
    })
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
  /** Les unités TELLES QU'ELLES S'AFFICHENT : l'abrégé de la direction, sinon le nom. */
  unit: filtreMultiple(120),
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
   * Le nombre de lignes que la requête trouve EN TOUT — onglet, recherche et
   * filtres compris. C'est lui qui donne le nombre de pages, et c'est
   * pourquoi il ne se confond pas avec `counts` : les effectifs des onglets
   * ignorent volontairement l'onglet ET les filtres, pour dire « il y en a
   * trois de l'autre côté ». Compter les pages avec eux afficherait des
   * pages vides dès qu'un filtre est posé.
   */
  total: number;
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
/**
 * Qui reprend l'équipe de chaque agent qui part et en encadre une : partant →
 * repreneur. Un encadrant sans repreneur reste de côté, avec le motif.
 */
const repreneursSchema = z.record(z.uuid(), z.uuid()).optional();

export const archiveEmployeesSchema = z
  .object({
    ids: z.array(z.uuid()).min(1).max(100),
    archived: z.boolean(),
    /** Pourquoi il devient inactif — exigé pour désactiver, ignoré pour réactiver. */
    motif: motifInactiviteSchema.optional(),
    /**
     * Le dernier jour d'activité (départ), ou le premier jour de la reprise
     * (réactivation). Par défaut : aujourd'hui pour un départ ; pour une
     * reprise, le début du nouveau contrat s'il suit le départ, sinon
     * aujourd'hui. Jamais dans le futur.
     */
    le: isoDate.optional(),
    repreneurs: repreneursSchema,
    /** Réactivation : ce que chaque agent reprend, par identifiant. */
    reprendre: z.record(z.uuid(), repriseDesResponsabilitesSchema).optional(),
  })
  .refine((v) => !v.archived || v.motif !== undefined, {
    message: 'Précisez pourquoi le dossier devient inactif',
    path: ['motif'],
  });
export type ArchiveEmployeesInput = z.infer<typeof archiveEmployeesSchema>;

/**
 * Suppression définitive. Sans retour, et sans reste : le dossier, le portail,
 * les congés, les documents, les demandes — et jusqu'au contenu que le journal
 * d'audit avait recopié au passage.
 */
export const deleteEmployeesSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(50),
  repreneurs: repreneursSchema,
});
export type DeleteEmployeesInput = z.infer<typeof deleteEmployeesSchema>;

/** Ce qu'un lot a réellement fait, et ce qu'il a laissé de côté, avec le motif. */
/** Une invitation au portail partie d'elle-même, ou qui n'a pas pu partir. */
export interface InvitationAuPassage {
  /** L'adresse à laquelle elle part ; `null` : elle n'est pas partie. */
  email: string | null;
  /** Ce qui l'a empêchée, quand elle n'est pas partie. */
  raison: string | null;
}

export interface NewContractResult {
  id: string;
  /** Le dossier inactif s'est rouvert avec ce contrat. */
  rouvert: boolean;
  /** Son compte était fermé : l'invitation à revenir, envoyée d'office. */
  invitation: InvitationAuPassage | null;
  changements: ChangementRattachement[];
  aRevoir: AnomalieHierarchie[];
}

export interface EmployeeBatchResult {
  done: number;
  skipped: { id: string; name: string; reason: string }[];
  /** Les équipes reprises au passage. */
  changements?: ChangementRattachement[];
  /**
   * Les rattachements que le lot a rendus faux — un dossier rouvert dont le
   * n+1 est parti, par exemple. À revoir, pas bloquant.
   */
  aRevoir?: AnomalieHierarchie[];
  /** Les dossiers rouverts dont le compte était fermé : leur invitation. */
  invitations?: (InvitationAuPassage & { id: string })[];
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
  /**
   * Le MATRICULE du responsable hiérarchique.
   *
   * C'est lui que la liste affiche, et non le nom : un matricule est unique
   * là où deux agents peuvent porter le même nom. Le nom reste en infobulle,
   * pour qu'on sache de qui il s'agit sans quitter la ligne.
   */
  managerNumber: string | null;
  managerName: string | null;
  workEmail: string | null;
  /** Agents ACTIFS dont il est le n+1 : qui part avec une équipe doit la confier. */
  teamSize: number;
  /** Inactif : pourquoi (`null` : dossier désactivé avant qu'on le demande), et depuis quand. */
  inactiviteMotif: MotifInactivite | null;
  archivedAt: string | null;
  /** Saisi il y a moins de 30 jours : une erreur de saisie s'efface encore. */
  effacable: boolean;
}

export interface AssignmentView {
  id: string;
  positionTitle: string;
  orgUnitId: string | null;
  orgUnitName: string | null;
  /**
   * La DIRECTION de rattachement, remontée depuis l'unité d'affectation quel
   * que soit son niveau : un agent du Service Comptabilité relève de la DFC.
   * L'abrégé pour la lire d'un coup d'œil, le nom complet pour l'infobulle —
   * exactement ce que la liste du personnel remonte déjà.
   */
  directionShortName: string | null;
  directionName: string | null;
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
  /** Un contrat qui n'a pas commencé : la place où l'agent prendra son poste ce jour-là. */
  placePrevue: { poste: string; direction: string | null } | null;
}

export interface EmployeeDetail {
  id: string;
  /**
   * Le dossier de l'appelant lui-même : aucune habilitation de gestion ne
   * s'y applique — ses changements passent par ses demandes, comme pour
   * tout agent.
   */
  soi: boolean;
  employeeNumber: string;
  /** Saisi il y a plus de 30 jours : le matricule reste à la personne, il ne change plus. */
  matriculeFige: boolean;
  status: string;
  /** Date d'archivage : quand il est devenu inactif. */
  archivedAt: string | null;
  /** Pourquoi il est inactif ; `null` quand il est actif, ou désactivé avant la règle. */
  inactiviteMotif: MotifInactivite | null;
  /** Inactif : son dernier jour d'activité — fin de contrat ou jour du départ. */
  finActivite: string | null;
  /**
   * Ses départs suivis d'un retour : le dernier jour, puis le premier jour de
   * la reprise. L'ancienneté se compte hors de ces intervalles.
   */
  interruptions: { dernierJour: string; repriseLe: string }[];
  /** Inactif : le jour où reprendrait son activité, réactivé sans autre date. */
  repriseParDefaut: string | null;
  hiredOn: string;
  workEmail: string | null;
  workPhone: string | null;
  managerId: string | null;
  managerName: string | null;
  /** Ses agents directs, actifs — ceux qu'il faudra confier s'il part. */
  team: { id: string; name: string }[];
  /**
   * Ce qu'il pourrait reprendre à son retour, au choix de la RH. Inactif :
   * les unités qu'il dirigeait, restées sans responsable, et son équipe
   * restée où son départ l'avait mise. Actif : les unités qu'il dirige et son
   * équipe, qu'une interruption entre deux contrats lui ferait quitter.
   */
  responsabilites: {
    unites: { id: string; nom: string; directionId: string | null }[];
    equipe: number;
  };
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
    emergencyContactName: string | null;
    emergencyContactPhone: string | null;
  };
  assignments: AssignmentView[];
  contracts: ContractView[];
  portal: {
    /**
     * `coupe` : un compte existe, mais son accès est coupé. `ferme` : son
     * compte a perdu son mot de passe, trente jours après un départ ; une
     * invitation le lui fait choisir à nouveau.
     */
    status: 'none' | 'invited' | 'active' | 'coupe' | 'ferme';
    role: string | null;
    /** Un serveur de courrier est configuré : l'invitation part par courriel. */
    parCourriel: boolean;
    /** L'invitation en cours, quand `status` vaut `invited`. */
    invitation: {
      email: string;
      expiresAt: string;
      /** Le courriel qui l'a portée ; `null` : lien transmis à la main. */
      courriel: 'en_attente' | 'envoye' | 'echec' | null;
      envoyeLe: string | null;
    } | null;
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
