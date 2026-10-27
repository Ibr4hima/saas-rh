import { z } from 'zod';
import type { TraitementView } from './acces';
import { CODES_DES_BANQUES } from './banques';
import {
  aujourdhuiIso,
  avantAujourdhuiSchema,
  CNI_EXPIREE,
  cniDelivreeAuPlusTot,
  dateDeNaissanceSchema,
  delivranceDeLaCniSchema,
  estUnJour,
  finDeLaDuree,
  jusquAujourdhuiSchema,
} from './dates';
import { SALAIRE_MAX } from './montants';
import { NATIONALITY_LABELS } from './nationalities';

/**
 * Demandes de documents administratifs (ADR-0012).
 * Circuit : reçue → en traitement → prête à retirer (ou refusée avec motif).
 * Les documents sont remis EN MAIN PROPRE, cachetés et signés.
 *
 * « Prête » est l'état FINAL : la RH annonce auprès de qui retirer, mais elle
 * ne peut pas savoir quand l'employé est effectivement passé chez cette
 * personne. Le statut « Remise » reste défini pour les demandes déjà closes
 * en base, sans pouvoir être posé à nouveau.
 */

/**
 * La liste de la DCH, dans son ordre (ADR-0084) : ce qu'elle génère, et ce
 * qu'un agent demande, hors ce qu'elle établit d'elle-même (ADR-0114).
 */
export const requestableDocSchema = z.enum([
  'contrat_cdd',
  'contrat_cdi',
  'contrat_stage',
  'attestation_conge',
  'attestation_travail',
  'attestation_reprise_service',
  'attestation_reprise_disponibilite',
  'attestation_depart_retraite',
  'attestation_stage',
  'attestation_cessation',
  'attestation_revenu',
  'domiciliation_bancaire',
  'decision_disponibilite',
  'decision_renouvellement_disponibilite',
  'declaration_mouvement',
  'certificat_travail',
]);

/**
 * Ce qui ne se demande plus (ADR-0045, ADR-0084) : ces documents ne se
 * lisent que sur les demandes anciennes, qui se traitent comme avant.
 */
export const DOCUMENTS_RETIRES = [
  'contrat_travail',
  'bulletin_salaire',
  'attestation_salaire',
  'autre',
] as const;

/** Un document demandé : un de la liste, ou un document retiré sur une demande ancienne. */
export type RequestableDoc =
  z.infer<typeof requestableDocSchema> | (typeof DOCUMENTS_RETIRES)[number];

export const REQUESTABLE_DOC_LABELS: Record<RequestableDoc, string> = {
  contrat_cdd: 'Contrat de travail à durée déterminée',
  contrat_cdi: 'Contrat de travail à durée indéterminée',
  contrat_stage: 'Contrat de stage',
  attestation_conge: 'Attestation de congé',
  attestation_travail: 'Attestation de travail',
  attestation_reprise_service: 'Attestation de reprise de service',
  attestation_reprise_disponibilite: 'Attestation de reprise après disponibilité',
  attestation_depart_retraite: 'Attestation de départ à la retraite',
  attestation_stage: 'Attestation de stage',
  attestation_cessation: 'Attestation de cessation de paiement et d’activités',
  attestation_revenu: 'Attestation de revenu',
  domiciliation_bancaire: 'Domiciliation bancaire',
  decision_disponibilite: 'Décision de mise en disponibilité',
  decision_renouvellement_disponibilite: 'Décision de renouvellement de disponibilité',
  declaration_mouvement: 'Déclaration de mouvement du travailleur',
  certificat_travail: 'Certificat de travail',
  contrat_travail: 'Contrat de travail',
  bulletin_salaire: 'Bulletin de salaire',
  attestation_salaire: 'Attestation de salaire',
  autre: 'Autre document',
};

/** Un document de la liste de la DCH, celui qu'un agent demande aujourd'hui. */
export type DocumentDeLaListe = z.infer<typeof requestableDocSchema>;

/**
 * Ce que l'application sait générer elle-même : les documents dont le modèle
 * est configuré (ADR-0085). Les autres, la DCH les prépare hors de l'outil.
 */
export const GENERATED_DOCS = [
  'contrat_cdd',
  'contrat_cdi',
  'contrat_stage',
  'attestation_conge',
  'attestation_reprise_service',
  'attestation_reprise_disponibilite',
  'attestation_cessation',
  'attestation_depart_retraite',
  'attestation_travail',
  'attestation_revenu',
  'decision_disponibilite',
  'decision_renouvellement_disponibilite',
  'domiciliation_bancaire',
  'declaration_mouvement',
  'attestation_stage',
  'certificat_travail',
] as const satisfies readonly DocumentDeLaListe[];

/** Un document dont le modèle est configuré. */
export type DocumentGenere = (typeof GENERATED_DOCS)[number];

export const estGenere = (doc: string): doc is DocumentGenere =>
  (GENERATED_DOCS as readonly string[]).includes(doc);

/**
 * Ce que la DCH établit d'elle-même, selon la situation de la personne : les
 * contrats. Un agent ne les demande pas ; leur génération se délègue, contrat
 * par contrat (ADR-0114).
 */
export const DOCUMENTS_DE_LA_DCH = [
  'contrat_cdd',
  'contrat_cdi',
  'contrat_stage',
] as const satisfies readonly DocumentGenere[];
export type DocumentDeLaDch = (typeof DOCUMENTS_DE_LA_DCH)[number];

export const estDocumentDeLaDch = (doc: string): doc is DocumentDeLaDch =>
  (DOCUMENTS_DE_LA_DCH as readonly string[]).includes(doc);

/** Ce qu'un agent demande : la liste, hors ce que la DCH établit d'elle-même. */
export const documentDemandableSchema = requestableDocSchema.exclude([...DOCUMENTS_DE_LA_DCH]);
export const DOCUMENTS_DEMANDABLES = documentDemandableSchema.options;
export type DocumentDemandable = (typeof DOCUMENTS_DEMANDABLES)[number];

/** Ce que la DCH saisit avant de générer un document : le dossier ne le porte pas. */
export type Saisie = 'salaire' | 'categorie' | 'debut' | 'fin' | 'depart' | 'reprise';

/**
 * Les saisies des documents qui en demandent, dans l'ordre où la page les
 * pose : le salaire net mensuel de l'attestation de revenu (ADR-0087), que la
 * paie connaît ; la catégorie du poste du certificat de travail (ADR-0091),
 * que la convention collective fixe ; le premier et le dernier jour du congé
 * de l'attestation de congé (ADR-0092) ; le jour du départ à la retraite
 * (ADR-0093) ; le premier et le dernier jour de la disponibilité, puis le
 * jour de la reprise de service, de l'attestation de reprise après
 * disponibilité (ADR-0104) ; le premier jour du congé de maternité de
 * l'attestation de cessation de paiement, le jour de la reprise de
 * l'attestation de reprise de service (ADR-0105).
 */
const SAISIES_DES_DOCUMENTS: Partial<Record<DocumentGenere, readonly Saisie[]>> = {
  attestation_conge: ['debut', 'fin'],
  attestation_cessation: ['debut'],
  attestation_reprise_service: ['reprise'],
  attestation_reprise_disponibilite: ['debut', 'fin', 'reprise'],
  attestation_depart_retraite: ['depart'],
  attestation_revenu: ['salaire'],
  certificat_travail: ['categorie'],
};

export const saisiesDe = (doc: string): readonly Saisie[] =>
  (estGenere(doc) && SAISIES_DES_DOCUMENTS[doc]) || [];

/** Une disponibilité dure trois ans au plus, sa prorogation aussi (ADR-0135, ADR-0136). */
export const DISPONIBILITE_ANS_MAX = 3;

/** Ce que dit une disponibilité, ou une prorogation, de plus de trois ans. */
export const DISPONIBILITE_TROP_LONGUE = 'La disponibilité ne peut pas dépasser trois ans';

/**
 * Le dernier jour, au plus tard, d'une disponibilité qui commence le
 * `debut` : la veille du même jour, trois ans plus tard. Du 2 janvier 2026
 * au 1er janvier 2029.
 */
export function finDeDisponibiliteAuPlusTard(debut: string): string {
  return finDeLaDuree(debut, 12 * DISPONIBILITE_ANS_MAX);
}

/**
 * La date limite de reprise la plus tardive d'une disponibilité, ou d'une
 * prorogation, qui prend effet le `effet` : le même jour, trois ans plus
 * tard. Prise d'effet le 10 octobre 2026 : reprise le 10 octobre 2029 au
 * plus tard.
 */
export function repriseAuPlusTard(effet: string): string {
  return lendemain(finDeDisponibiliteAuPlusTard(effet));
}

/**
 * Ce que les dates saisies d'un document enfreignent, saisie par saisie
 * (ADR-0133, ADR-0136) ; vide, rien. Le dernier jour d'un congé ou d'une
 * disponibilité suit le premier ; une disponibilité dure trois ans au plus ;
 * la reprise de service ne précède pas son dernier jour.
 */
export function datesEnfreintes(
  doc: string,
  s: Partial<Record<Saisie, unknown>>,
): Partial<Record<Saisie, string>> {
  const jour = (v: unknown) => (typeof v === 'string' && estUnJour(v) ? v : null);
  const [debut, fin, reprise] = [jour(s.debut), jour(s.fin), jour(s.reprise)];
  const erreurs: Partial<Record<Saisie, string>> = {};
  const deuxJours = doc === 'attestation_conge' || doc === 'attestation_reprise_disponibilite';
  if (deuxJours && debut && fin && fin <= debut) {
    erreurs.fin = 'Doit être après le premier jour';
  } else if (
    doc === 'attestation_reprise_disponibilite' &&
    debut &&
    fin &&
    fin > finDeDisponibiliteAuPlusTard(debut)
  ) {
    erreurs.fin = DISPONIBILITE_TROP_LONGUE;
  }
  if (doc === 'attestation_reprise_disponibilite' && fin && reprise && reprise < fin) {
    erreurs.reprise = 'Pas avant le dernier jour de la disponibilité';
  }
  return erreurs;
}

/** Une catégorie de la convention collective : « 7B », « M2 ». */
export const CATEGORIE_MAX = 40;

/**
 * Ce que la DCH saisit pour générer un document. Il part dans le corps d'un
 * POST, jamais dans l'adresse : les journaux des serveurs gardent les
 * adresses, et un salaire n'a rien à y faire.
 */
export const saisiesDuDocumentSchema = z
  .object({
    /** Le salaire net mensuel, en francs CFA. */
    salaire: z.number().int().min(1).max(SALAIRE_MAX).optional(),
    /** La catégorie du poste dans la convention collective. */
    categorie: z.string().trim().min(1).max(CATEGORIE_MAX).optional(),
    /** Le premier jour du congé, de maternité ou non, ou de la disponibilité. */
    debut: z.iso.date().optional(),
    /** Son dernier jour, inclus. */
    fin: z.iso.date().optional(),
    /** Le jour du départ à la retraite. */
    depart: z.iso.date().optional(),
    /** Le jour de la reprise de service, après une disponibilité ou un congé de maternité. */
    reprise: z.iso.date().optional(),
    /** Le premier jour du stage que l'attestation cite, parmi ceux du dossier (ADR-0132). */
    stage: z.iso.date().optional(),
  })
  .strict();
export type SaisiesDuDocument = z.infer<typeof saisiesDuDocumentSchema>;

/** Un stage du dossier, tel que l'attestation de stage le cite (ADR-0132). */
export interface StageAuDossier {
  /** Son premier jour, qui le désigne : la saisie `stage`. */
  debut: string;
  /** Son dernier jour ; null : pas encore fixé. */
  fin: string | null;
  poste: string | null;
}

/**
 * Le nom du fichier d'un document généré : « attestation-travail-M0012.pdf ».
 * Un nom se répète, un matricule non. L'API le donne au PDF, le site à ce
 * qu'il enregistre : les deux tiennent la même règle d'ici. Sans agent, le
 * nom de la personne tient lieu de matricule, ses accents ôtés.
 */
export function nomDuDocumentGenere(doc: DocumentGenere, matricule: string): string {
  const sans = matricule.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return `${doc.replace(/_/g, '-')}-${sans.replace(/[^A-Za-z0-9-]/g, '_')}.pdf`;
}

/**
 * Ceux qui se génèrent sans agent : la DCH renseigne la personne, qui n'est
 * pas encore dans l'application ou que le document nomme seulement (ADR-0094,
 * ADR-0098, ADR-0100, ADR-0102, ADR-0106).
 */
export const DOCS_SANS_AGENT = [
  'contrat_cdd',
  'contrat_cdi',
  'contrat_stage',
  'decision_disponibilite',
  'decision_renouvellement_disponibilite',
  'domiciliation_bancaire',
  'declaration_mouvement',
] as const satisfies readonly DocumentGenere[];
export type DocumentSansAgent = (typeof DOCS_SANS_AGENT)[number];

export const sansAgent = (doc: string): doc is DocumentSansAgent =>
  (DOCS_SANS_AGENT as readonly string[]).includes(doc);

/** Un stage dure au plus deux ans. */
export const DUREE_DE_STAGE_MAX = 24;

/**
 * Un prénom, un nom, un lieu ou une adresse, la première lettre de chaque mot
 * en capitale, le reste tel que saisi : « mouhamadou moustapha lamine » donne
 * « Mouhamadou Moustapha Lamine », « dos santos » « Dos Santos », « n'diaye »
 * « N'Diaye ». Un mot commence après une espace, un trait d'union, une
 * apostrophe, une virgule ou une parenthèse.
 */
export function majusculesInitiales(texte: string): string {
  return texte.replace(
    /(^|[\s'’(,-])(\p{Ll})/gu,
    (_, avant: string, lettre: string) => avant + lettre.toLocaleUpperCase('fr-FR'),
  );
}

/** Les petits mots d'un lieu ou d'une adresse, qui gardent leur minuscule après le premier mot. */
const PETITS_MOTS = new Set([
  'à',
  'au',
  'aux',
  'd',
  'de',
  'des',
  'du',
  'en',
  'et',
  'l',
  'la',
  'le',
  'les',
  'sous',
  'sur',
]);

/** Les débuts des petits mots : « e » peut encore devenir « et », « s », « sur ». */
const DEBUTS_DES_PETITS_MOTS = new Set(
  [...PETITS_MOTS].flatMap((mot) => [...mot].map((_, i) => mot.slice(0, i + 1))),
);

/**
 * Un lieu ou une adresse : une capitale à chaque mot, comme un nom, sauf aux
 * petits mots qui suivent le premier : « patte d’oie cité impôt et domaines »
 * donne « Patte d’Oie Cité Impôt et Domaines », « saint-louis du sénégal »
 * « Saint-Louis du Sénégal ». En cours de frappe (`enCours`), un mot qui peut
 * encore devenir un petit mot attend sa lettre suivante : « e » n'est pas
 * encore « E », il sera peut-être « et ».
 */
export function majusculesDesLieux(texte: string, { enCours = false } = {}): string {
  const petits = enCours ? DEBUTS_DES_PETITS_MOTS : PETITS_MOTS;
  return texte.replace(
    /(^|[\s'’(,-])(\p{L}+)/gu,
    (tout: string, avant: string, mot: string, position: number) =>
      position > 0 && petits.has(mot.toLocaleLowerCase('fr-FR'))
        ? tout
        : avant + mot[0]!.toLocaleUpperCase('fr-FR') + mot.slice(1),
  );
}

/**
 * Une formation, un poste : la première lettre seule en capitale, le reste tel
 * que saisi. « assistante archiviste » donne « Assistante archiviste ».
 */
export function premiereMajuscule(texte: string): string {
  return texte.replace(
    /^(\s*)(\p{Ll})/u,
    (_, avant: string, lettre: string) => avant + lettre.toLocaleUpperCase('fr-FR'),
  );
}

/** Les groupes de chiffres du numéro d'une CNI, comme sur la carte : « 1 234 0000 12345 ». */
const GROUPES_DE_LA_CNI = [1, 3, 4, 5] as const;

/** Le numéro d'une CNI en groupes, ou ce qui en est saisi : « 2751 » donne « 2 751 ». */
export function cniGroupee(chiffres: string, espace = ' '): string {
  const groupes: string[] = [];
  let debut = 0;
  for (const taille of GROUPES_DE_LA_CNI) {
    if (debut >= chiffres.length) break;
    groupes.push(chiffres.slice(debut, debut + taille));
    debut += taille;
  }
  return groupes.join(espace);
}

/**
 * Les règles croisées des dates d'une fiche (ADR-0133), relevées par une
 * fonction que l'écran appelle aussi : Zod les tait tant qu'une liste de la
 * fiche n'est pas choisie, l'écran les dit dès que les deux dates sont là.
 */
export type ReglesDesDates = Record<string, string>;

/** Une date complète d'une fiche ; null : vide, ou à moitié saisie. */
const jourDe = (v: unknown): string | null => (typeof v === 'string' && estUnJour(v) ? v : null);

/** Les règles relevées, posées comme des problèmes de la fiche. */
function poser(ctx: z.RefinementCtx, regles: ReglesDesDates): void {
  for (const [chemin, message] of Object.entries(regles)) {
    ctx.addIssue({ code: 'custom', path: chemin.split('.'), message });
  }
}

/** Un prénom, un nom : chaque mot prend sa capitale. */
const nomPropre = (max: number) => z.string().trim().min(1).max(max).transform(majusculesInitiales);
/** Un lieu, une adresse : chaque mot prend sa capitale, sauf les petits mots. */
const lieu = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .transform((texte) => majusculesDesLieux(texte));
/** Une formation, un poste : la première lettre prend sa capitale. */
const intitule = (max: number) => z.string().trim().min(1).max(max).transform(premiereMajuscule);

/**
 * Ce que la DCH renseigne pour un contrat de stage (ADR-0094, ADR-0096) : la
 * personne, qui n'est pas encore dans l'application, et le stage. Tout est
 * obligatoire.
 */
export const ficheStagiaireSchema = z
  .object({
    civilite: z.enum(['madame', 'monsieur']),
    prenom: nomPropre(80),
    nom: nomPropre(80),
    naissanceLe: dateDeNaissanceSchema,
    naissanceA: lieu(120),
    /** Le numéro de la carte nationale d'identité : treize chiffres. */
    cni: z.string().regex(/^\d{13}$/, 'Treize chiffres attendus'),
    /**
     * La CNI est à jour : délivrée il y a moins de dix ans. Le contrat n'en
     * écrit pas la date (ADR-0134).
     */
    cniDelivreeLe: delivranceDeLaCniSchema,
    perePrenom: nomPropre(80),
    merePrenom: nomPropre(80),
    mereNom: nomPropre(80),
    adresse: lieu(200),
    /** Ce que la personne prépare : « Licence en Science de l'Information Documentaire ». */
    formation: intitule(200),
    /** Le poste du stage : « Assistante Archiviste ». */
    poste: intitule(120),
    /** La durée du stage, en mois. */
    duree: z.number().int().min(1).max(DUREE_DE_STAGE_MAX),
    debut: z.iso.date(),
    /** La catégorie de la grille salariale de l'APIX. */
    categorie: z.string().trim().min(1).max(CATEGORIE_MAX),
    /** L'allocation mensuelle, en francs CFA, toutes taxes comprises. */
    allocation: z.number().int().min(1).max(SALAIRE_MAX),
  })
  .strict();
export type FicheStagiaire = z.infer<typeof ficheStagiaireSchema>;

/** Le dernier jour d'un stage de `mois` mois : la règle de toute durée en mois. */
export const finDuStage = finDeLaDuree;

/** Le dernier jour d'un contrat à durée déterminée : la règle du stage (ADR-0098). */
export const finDuContrat = finDuStage;

/** Un contrat à durée déterminée dure au plus deux ans. */
export const DUREE_DE_CDD_MAX = 24;

/**
 * Ce que la DCH renseigne pour un contrat de travail (ADR-0098) : la
 * personne, qui n'est pas encore dans l'application, son emploi et sa
 * rémunération. Tout est obligatoire ; le contrat à durée déterminée y
 * ajoute sa durée.
 */
const ficheDuContratDeTravail = z.object({
  civilite: z.enum(['madame', 'monsieur']),
  prenom: nomPropre(80),
  nom: nomPropre(80),
  naissanceLe: dateDeNaissanceSchema,
  naissanceA: lieu(120),
  /** Le numéro de la carte nationale d'identité : treize chiffres. */
  cni: z.string().regex(/^\d{13}$/, 'Treize chiffres attendus'),
  /** La CNI est à jour : délivrée il y a moins de dix ans (ADR-0133). */
  cniDelivreeLe: delivranceDeLaCniSchema,
  cniDelivreeA: lieu(120),
  /** Le pays, par son code ISO 3166-1 : le contrat en écrit le gentilé. */
  nationalite: z.string().refine((code) => code in NATIONALITY_LABELS, 'Pays inconnu'),
  adresse: lieu(200),
  poste: intitule(120),
  /** L'unité de l'organigramme où la personne est affectée. */
  affectation: z.uuid(),
  debut: z.iso.date(),
  /** La catégorie du poste dans la convention collective. */
  categorie: z.string().trim().min(1).max(CATEGORIE_MAX),
  /** Les trois parts du salaire brut mensuel, en francs CFA. */
  salaireDeBase: z.number().int().min(1).max(SALAIRE_MAX),
  sursalaire: z.number().int().min(0).max(SALAIRE_MAX),
  primeDeTransport: z.number().int().min(0).max(SALAIRE_MAX),
  /** Un treizième mois en fin d'année, ou non. */
  treiziemeMois: z.boolean(),
});
export const ficheCdiSchema = ficheDuContratDeTravail.strict();
export const ficheCddSchema = ficheDuContratDeTravail
  .extend({
    /** La durée du contrat, en mois. */
    duree: z.number().int().min(1).max(DUREE_DE_CDD_MAX),
  })
  .strict();
export type FicheCdi = z.infer<typeof ficheCdiSchema>;
export type FicheCdd = z.infer<typeof ficheCddSchema>;

/** Le schéma de la fiche d'un contrat de travail, selon sa durée. */
export const ficheDuContratSchema = (doc: 'contrat_cdd' | 'contrat_cdi') =>
  doc === 'contrat_cdd' ? ficheCddSchema : ficheCdiSchema;

/** Le salaire brut mensuel : la base, le sursalaire et la prime de transport. */
export const salaireBrut = (f: {
  salaireDeBase: number;
  sursalaire: number;
  primeDeTransport: number;
}) => f.salaireDeBase + f.sursalaire + f.primeDeTransport;

/**
 * Ce que la DCH renseigne pour une décision de disponibilité (ADR-0100) : qui
 * la demande et quand, et les sessions du conseil d'administration qui ont
 * nommé à la direction générale et à la direction générale adjointe. Tout est
 * obligatoire.
 */
const ficheDeLaDecision = z.object({
  civilite: z.enum(['madame', 'monsieur']),
  prenom: nomPropre(80),
  nom: nomPropre(80),
  poste: intitule(120),
  /** La date de la lettre de demande. */
  demandeLe: jusquAujourdhuiSchema,
  pvDirectionGeneraleLe: jusquAujourdhuiSchema,
  pvDirectionGeneraleAdjointeLe: jusquAujourdhuiSchema,
  /** Le jour où le service doit reprendre : sans reprise, la démission est constatée. */
  repriseLe: z.iso.date(),
});

/**
 * Les dates croisées d'une mise en disponibilité (ADR-0133, ADR-0136) : la
 * prise d'effet pas avant la demande, la reprise après la prise d'effet et
 * au plus trois ans après.
 */
export function datesDeLaDisponibilite(f: Record<string, unknown>): ReglesDesDates {
  const [demande, effet, reprise] = [jourDe(f.demandeLe), jourDe(f.effetLe), jourDe(f.repriseLe)];
  const regles: ReglesDesDates = {};
  if (demande && effet && effet < demande) regles.effetLe = 'Pas avant la demande';
  if (effet && reprise && reprise <= effet) {
    regles.repriseLe = 'Doit être après la date de prise d’effet';
  } else if (effet && reprise && reprise > repriseAuPlusTard(effet)) {
    regles.repriseLe = DISPONIBILITE_TROP_LONGUE;
  }
  return regles;
}

export const ficheDisponibiliteSchema = ficheDeLaDecision
  .extend({
    /** La mise en disponibilité : son premier jour. */
    effetLe: z.iso.date(),
  })
  .strict()
  .superRefine((f, ctx) => poser(ctx, datesDeLaDisponibilite(f)));
export type FicheDisponibilite = z.infer<typeof ficheDisponibiliteSchema>;

/** Une disponibilité se proroge de trois ans au plus, comme elle se renouvelle (ADR-0135). */
export const DUREE_DE_PROROGATION_MAX = 12 * DISPONIBILITE_ANS_MAX;

/**
 * Les dates croisées d'un renouvellement (ADR-0133, ADR-0134, ADR-0136) : la
 * période initiale dans l'ordre, la reprise après elle et au plus trois ans
 * après la prise d'effet de la prorogation, le lendemain de la période
 * initiale. La demande n'a que la borne de son champ : pas après
 * aujourd'hui.
 */
export function datesDuRenouvellement(f: Record<string, unknown>): ReglesDesDates {
  const [du, au, reprise] = [
    jourDe(f.initialementDu),
    jourDe(f.initialementAu),
    jourDe(f.repriseLe),
  ];
  const regles: ReglesDesDates = {};
  if (du && au && au < du) regles.initialementAu = 'Doit être après le début';
  if (au && reprise && reprise <= au) {
    regles.repriseLe = 'Doit être après la fin de la période initiale';
  } else if (au && reprise && reprise > repriseAuPlusTard(lendemain(au))) {
    regles.repriseLe = 'La prorogation ne peut pas dépasser trois ans';
  }
  return regles;
}

/**
 * Le renouvellement d'une disponibilité : l'unité d'affectation, la période
 * fixée d'abord, et la durée de sa prorogation.
 */
export const ficheRenouvellementSchema = ficheDeLaDecision
  .extend({
    /** L'unité de l'organigramme où la personne est affectée. */
    affectation: z.uuid(),
    /** Le premier jour de la période initiale. */
    initialementDu: z.iso.date(),
    /** Son dernier jour, inclus. */
    initialementAu: z.iso.date(),
    /** La durée de la prorogation, en mois. */
    duree: z.number().int().min(1).max(DUREE_DE_PROROGATION_MAX),
  })
  .strict()
  .superRefine((f, ctx) => poser(ctx, datesDuRenouvellement(f)));
export type FicheRenouvellement = z.infer<typeof ficheRenouvellementSchema>;

export type DecisionDeDisponibilite =
  'decision_disponibilite' | 'decision_renouvellement_disponibilite';

/** Le schéma de la fiche d'une décision de disponibilité, selon qu'elle l'accorde ou la renouvelle. */
export const ficheDeLaDecisionSchema = (doc: DecisionDeDisponibilite) =>
  doc === 'decision_disponibilite' ? ficheDisponibiliteSchema : ficheRenouvellementSchema;

/**
 * Ce que l'organisation sait d'avance de la fiche d'une décision : les
 * sessions du conseil d'administration qui ont nommé la direction générale et
 * la direction générale adjointe en place. La page les pose dans les champs
 * encore vides ; la DCH les corrige (ADR-0123).
 */
export type PreremplissageDeLaDecision = Pick<
  FicheDisponibilite,
  'pvDirectionGeneraleLe' | 'pvDirectionGeneraleAdjointeLe'
>;

/** Le jour qui suit, au format AAAA-MM-JJ. */
function lendemain(jour: string): string {
  const d = new Date(`${jour}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Le jour où le service reprend après la prorogation de `mois` mois d'une
 * disponibilité dont la période initiale finissait le `initialementAu` : la
 * prorogation commence le lendemain, et finit selon la règle du stage. Fixée
 * du 2 janvier au 1er juillet, prorogée de six mois : reprise le 2 janvier.
 */
export function repriseApresProrogation(initialementAu: string, mois: number): string {
  return lendemain(finDuStage(lendemain(initialementAu), mois));
}

/**
 * Les dates croisées d'une domiciliation (ADR-0133) : l'ordre de virement
 * vient du personnel, pas avant le début du contrat.
 */
export function datesDeLaDomiciliation(f: Record<string, unknown>): ReglesDesDates {
  const [debut, demande] = [jourDe(f.debut), jourDe(f.demandeLe)];
  return debut && demande && demande < debut ? { demandeLe: 'Pas avant le début du contrat' } : {};
}

/**
 * Ce que la DCH renseigne pour une domiciliation bancaire (ADR-0102) : la
 * personne, sa fonction, son contrat et le jour où il a commencé, le jour de
 * sa demande, sa banque et le genre de qui la dirige, son RIB, son salaire
 * mensuel net. Tout est obligatoire.
 */
export const ficheDomiciliationSchema = z
  .object({
    civilite: z.enum(['madame', 'monsieur']),
    prenom: nomPropre(80),
    nom: nomPropre(80),
    poste: intitule(120),
    /** Le premier jour du contrat : la personne fait déjà partie du personnel. */
    debut: jusquAujourdhuiSchema,
    contrat: z.enum(['cdd', 'cdi']),
    /** Le jour où la personne a donné l'ordre de virement. */
    demandeLe: jusquAujourdhuiSchema,
    banque: z.enum(CODES_DES_BANQUES),
    /** À qui la lettre s'adresse : qui dirige la banque. */
    destinataire: z.enum(['directeur_general', 'directrice_generale']),
    /** Le RIB : « SN », puis vingt-deux chiffres. */
    rib: z.string().regex(/^SN\d{22}$/, 'Vingt-quatre caractères attendus, SN compris'),
    /** Le salaire mensuel net, en francs CFA. */
    salaire: z.number().int().min(1).max(SALAIRE_MAX),
  })
  .strict()
  .superRefine((f, ctx) => poser(ctx, datesDeLaDomiciliation(f)));
export type FicheDomiciliation = z.infer<typeof ficheDomiciliationSchema>;

/**
 * Un RIB tel qu'il s'imprime : « SN012 01001 036123456789 54 », le code de la
 * banque, celui du guichet, le numéro du compte et la clé. Commencé, il se
 * groupe déjà.
 */
export function ribGroupe(rib: string): string {
  const c = rib.replace(/\s/g, '');
  return [c.slice(0, 5), c.slice(5, 10), c.slice(10, 22), c.slice(22, 24)]
    .filter(Boolean)
    .join(' ');
}

/*
   La déclaration de mouvement du travailleur (ADR-0106, ADR-0107) :
   l'embauche, le départ et les changements dans la situation du travailleur
   se déclarent à l'inspection du travail et de la sécurité sociale (article
   L.222 du Code du travail), sur le formulaire de l'arrêté n° 7301 du 17 mai
   1963.
*/

/** Ce qu'une déclaration de mouvement déclare, dans l'ordre du formulaire. */
export const MOUVEMENTS_DU_TRAVAILLEUR = {
  embauchage: 'Embauchage',
  licenciement: 'Licenciement',
  expiration_du_contrat: 'Expiration normale du contrat',
  demission: 'Démission',
  mutation: 'Mutation',
  changement_de_categorie: 'Changement de catégorie professionnelle',
  modification_du_contrat: 'Modification du contrat de travail',
  changement_de_situation_de_famille: 'Changement de situation de famille',
  changement_de_residence: 'Changement de résidence habituelle',
  changement_d_emploi: 'Changement d’emploi',
  deces: 'Décès',
} as const;
export type MouvementDuTravailleur = keyof typeof MOUVEMENTS_DU_TRAVAILLEUR;
const CODES_DES_MOUVEMENTS = Object.keys(MOUVEMENTS_DU_TRAVAILLEUR) as [
  MouvementDuTravailleur,
  ...MouvementDuTravailleur[],
];

/** Les départs de l'établissement : chacun se déclare seul, avec la date du départ. */
export const DEPARTS_DU_TRAVAILLEUR = [
  'licenciement',
  'expiration_du_contrat',
  'demission',
  'deces',
] as const satisfies readonly MouvementDuTravailleur[];

/** Les changements dans la situation du travailleur : plusieurs se déclarent ensemble. */
export const CHANGEMENTS_DU_TRAVAILLEUR = [
  'mutation',
  'changement_de_categorie',
  'changement_d_emploi',
  'modification_du_contrat',
  'changement_de_situation_de_famille',
  'changement_de_residence',
] as const satisfies readonly MouvementDuTravailleur[];

export type NatureDuMouvement = 'embauche' | 'depart' | 'changement';

/**
 * Ce que déclarent les mouvements cochés : une embauche, un départ ou des
 * changements ; null pour un mélange, qui ne se déclare pas d'un coup.
 */
export function natureDuMouvement(
  mouvements: readonly MouvementDuTravailleur[],
): NatureDuMouvement | null {
  const parmi = (liste: readonly string[]) => mouvements.every((m) => liste.includes(m));
  if (mouvements.length === 1 && mouvements[0] === 'embauchage') return 'embauche';
  if (mouvements.length === 1 && parmi(DEPARTS_DU_TRAVAILLEUR)) return 'depart';
  if (mouvements.length > 0 && parmi(CHANGEMENTS_DU_TRAVAILLEUR)) return 'changement';
  return null;
}

export const SITUATIONS_DE_FAMILLE = ['celibataire', 'marie', 'divorce', 'veuf'] as const;
export type SituationDeFamille = (typeof SITUATIONS_DE_FAMILLE)[number];

/** Les horaires de travail hebdomadaires du formulaire, en heures. */
export const HORAIRES_HEBDOMADAIRES = [40, 42, 44, 48] as const;

/** Un homme marié déclare ses épouses, quatre au plus ; une femme mariée, son époux. */
export const EPOUSES_MAX = 4;
export const ENFANTS_MAX = 20;
/** Les dispositions particulières 2 à 5 du formulaire : la première fixe le salaire. */
export const DISPOSITIONS_MAX = 4;
export const DISPOSITION_MAX = 300;

/** Le numéro au fichier central de la main-d'œuvre : dix chiffres, une case chacun. */
export const CHIFFRES_DE_L_IMMATRICULATION = 10;
/** Les catégories d'enregistrement du travailleur au fichier central, sous sa grille. */
export const CATEGORIES_D_ENREGISTREMENT = ['A', 'B', 'C', 'D', 'E', 'F'] as const;

/** Le numéro et la date d'une pièce : une déclaration, un visa, un enregistrement, déjà faits. */
const numeroEtDate = z
  .object({ numero: z.string().trim().min(1).max(30), le: jusquAujourdhuiSchema })
  .strict();

/** Un pays, par son code ISO 3166-1. */
const pays = z.string().refine((code) => code in NATIONALITY_LABELS, 'Pays inconnu');

/** Une valeur facultative : sans elle, le formulaire laisse des pointillés. */
const facultatif = (max: number) => z.string().trim().min(1).max(max).optional();

/**
 * Les dates croisées d'une déclaration de mouvement (ADR-0133, ADR-0134) :
 * le mouvement suit l'entrée dans l'établissement, qui suit la naissance ;
 * une CNI sénégalaise est à jour, une carte étrangère délivrée après la
 * naissance ; la fin d'un CDD suit son début ; un visa approuve ou enregistre
 * un contrat déjà daté ; on entre au Sénégal après sa naissance et avant
 * d'entrer dans l'établissement ; la classe de recrutement n'est ni avant
 * l'année de naissance, ni dans l'avenir.
 */
export function datesDeLaDeclaration(f: Record<string, unknown>): ReglesDesDates {
  const piece = (p: unknown) =>
    p !== null && typeof p === 'object' ? jourDe((p as { le?: unknown }).le) : null;
  const naissance = jourDe(f.naissanceLe);
  const delivrance = jourDe(f.cniDelivreeLe);
  const etrangere = typeof f.nationalite === 'string' && f.nationalite !== 'SN';
  const entree = jourDe(f.entreeLe);
  const effet = jourDe(f.effetLe);
  const [cddDu, cddAu] = [jourDe(f.cddDu), jourDe(f.cddAu)];
  const contrat = jourDe(f.contratLe);
  const [visa, enregistrement] = [piece(f.visa), piece(f.enregistrement)];
  const auSenegal = jourDe(f.entreeAuSenegalLe);
  const classe =
    typeof f.classeDeRecrutement === 'string' && /^\d{4}$/.test(f.classeDeRecrutement)
      ? f.classeDeRecrutement
      : null;
  const regles: ReglesDesDates = {};
  if (effet && entree && effet < entree) {
    regles.effetLe = 'Doit être après l’entrée dans l’établissement';
  }
  if (entree && naissance && entree <= naissance)
    regles.entreeLe = 'Doit être après la date de naissance';
  if (delivrance && !etrangere && delivrance < cniDelivreeAuPlusTot()) {
    regles.cniDelivreeLe = CNI_EXPIREE;
  } else if (delivrance && naissance && delivrance <= naissance) {
    regles.cniDelivreeLe = 'Doit être après la date de naissance';
  }
  if (cddDu && cddAu && cddAu < cddDu) regles.cddAu = 'Doit être après le début';
  if (contrat && visa && visa < contrat) regles['visa.le'] = 'Pas avant la date du contrat';
  if (contrat && enregistrement && enregistrement < contrat) {
    regles['enregistrement.le'] = 'Pas avant la date du contrat';
  }
  if (auSenegal && entree && auSenegal > entree) {
    regles.entreeAuSenegalLe = 'Pas après l’entrée dans l’établissement';
  } else if (auSenegal && naissance && auSenegal <= naissance) {
    regles.entreeAuSenegalLe = 'Doit être après la date de naissance';
  }
  if (classe && classe > aujourdhuiIso().slice(0, 4)) {
    regles.classeDeRecrutement = 'Pas après cette année';
  } else if (classe && naissance && classe < naissance.slice(0, 4)) {
    regles.classeDeRecrutement = 'Pas avant l’année de naissance';
  }
  return regles;
}

/**
 * Ce que la DCH renseigne pour une déclaration de mouvement (ADR-0106) : le
 * mouvement, la personne, son emploi, son statut militaire et les
 * dispositions particulières de son engagement. Ce qui ne s'applique qu'à
 * certains mouvements ou à certaines personnes se renseigne pour eux seuls ;
 * ce qui peut ne pas être connu, les numéros à la CSS et à l'IPRES par
 * exemple, est facultatif.
 */
export const ficheDeclarationMouvementSchema = z
  .object({
    mouvements: z.array(z.enum(CODES_DES_MOUVEMENTS)).min(1).max(CHANGEMENTS_DU_TRAVAILLEUR.length),
    /** La date d'un départ ou d'un changement ; celle d'une embauche est l'entrée. */
    effetLe: z.iso.date().optional(),
    /** Le numéro au fichier central de la main-d'œuvre ; sans lui, l'immatriculation se demande. */
    immatriculation: z
      .string()
      .regex(new RegExp(`^\\d{${CHIFFRES_DE_L_IMMATRICULATION}}$`), 'Dix chiffres attendus')
      .optional(),
    /** La catégorie d'enregistrement du travailleur, que le formulaire encadre ; facultative. */
    categorieDEnregistrement: z.enum(CATEGORIES_D_ENREGISTREMENT).optional(),
    civilite: z.enum(['madame', 'monsieur']),
    prenom: nomPropre(120),
    nom: nomPropre(80),
    naissanceLe: dateDeNaissanceSchema,
    naissanceA: lieu(120),
    naissancePays: pays,
    /** Le pays, par son code : le formulaire en écrit le gentilé. */
    nationalite: pays,
    perePrenom: nomPropre(80),
    merePrenom: nomPropre(80),
    mereNom: nomPropre(80),
    adresse: lieu(200),
    /** La carte d'identité : treize chiffres pour une CNI sénégalaise. */
    cni: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{5,20}$/, 'De 5 à 20 lettres ou chiffres'),
    /**
     * La délivrance de la carte, que le formulaire n'écrit pas : une CNI
     * sénégalaise vaut dix ans et doit être à jour (ADR-0134).
     */
    cniDelivreeLe: jusquAujourdhuiSchema,
    cniDelivreeA: lieu(120),
    /** Qui a délivré la carte : « Directeur Général de la Sûreté Nationale ». */
    cniDelivreePar: intitule(120),
    css: facultatif(30),
    ipres: facultatif(30),
    situationDeFamille: z.enum(SITUATIONS_DE_FAMILLE),
    /** Les épouses d'un homme marié, l'époux d'une femme mariée : prénom et nom. */
    conjoints: z.array(nomPropre(120)).max(EPOUSES_MAX),
    /** Les enfants à charge : prénom et nom. */
    enfants: z.array(nomPropre(120)).max(ENFANTS_MAX),
    /** L'entrée dans l'établissement, avant aujourd'hui (ADR-0133). */
    entreeLe: avantAujourdhuiSchema,
    /** La déclaration faite à l'embauche, pour un départ ou un changement. */
    declarationDEmbauche: numeroEtDate.optional(),
    profession: intitule(120),
    emploi: intitule(120),
    /** La catégorie du barème salarial. */
    categorie: z.string().trim().min(1).max(CATEGORIE_MAX),
    /** Un contrat à durée déterminée, indéterminée, ou de chantier. */
    contrat: z.enum(['cdd', 'cdi', 'chantier']),
    cddDu: z.iso.date().optional(),
    cddAu: z.iso.date().optional(),
    /** L'ouvrage d'un contrat de chantier, tel qu'il suit « chantier de » : « l’autoroute Ila Touba ». */
    chantier: facultatif(120),
    /** La date du contrat, avant aujourd'hui (ADR-0133). */
    contratLe: avantAujourdhuiSchema.optional(),
    /** Le visa d'approbation du contrat par l'inspecteur du travail et de la sécurité sociale. */
    visa: numeroEtDate.optional(),
    /** Le visa d'enregistrement du contrat à la section locale du service de la main-d'œuvre. */
    enregistrement: numeroEtDate.optional(),
    /** Le nom et l'adresse du précédent employeur ; sans lui, « Néant ». */
    precedentEmployeur: facultatif(200),
    residence: lieu(120),
    /** Pour un travailleur étranger. */
    entreeAuSenegalLe: jusquAujourdhuiSchema.optional(),
    serviceMilitaire: z.boolean(),
    /** L'année de la classe de recrutement. */
    classeDeRecrutement: z
      .string()
      .regex(/^\d{4}$/, 'Une année sur quatre chiffres')
      .optional(),
    armee: z.enum(['terre', 'air', 'mer']).optional(),
    grade: z.enum(['officier', 'sous_officier', 'troupe']).optional(),
    horaire: z.literal(HORAIRES_HEBDOMADAIRES),
    /** Le salaire mensuel de la catégorie, en francs CFA. */
    salaire: z.number().int().min(1).max(SALAIRE_MAX),
    /** Les dispositions particulières 2 à 5, dans l'ordre. */
    dispositions: z.array(z.string().trim().min(1).max(DISPOSITION_MAX)).max(DISPOSITIONS_MAX),
  })
  .strict()
  .superRefine((f, ctx) => {
    const signaler = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    /** Ce qui ne se renseigne que dans un cas : exigé dans ce cas, absent sinon. */
    const seulementSi = (cas: boolean, champs: readonly (keyof typeof f)[], message: string) => {
      for (const champ of champs) {
        if (cas && f[champ] === undefined) signaler(champ, message);
        if (!cas && f[champ] !== undefined) signaler(champ, 'Sans objet ici');
      }
    };

    const nature = natureDuMouvement(f.mouvements);
    if (new Set(f.mouvements).size !== f.mouvements.length) {
      signaler('mouvements', 'Ce mouvement est sélectionné deux fois');
    } else if (nature === null) {
      signaler('mouvements', 'Choisissez une embauche, un départ ou des changements');
    }
    seulementSi(nature !== 'embauche', ['effetLe'], 'Date à saisir');
    // La présente déclaration est celle de l'embauche.
    if (nature === 'embauche' && f.declarationDEmbauche !== undefined) {
      signaler('declarationDEmbauche', 'Sans objet ici');
    }

    if (f.nationalite === 'SN' && !/^\d{13}$/.test(f.cni))
      signaler('cni', 'Treize chiffres attendus');
    seulementSi(f.nationalite !== 'SN', ['entreeAuSenegalLe'], 'Date à saisir');

    const conjoints = f.civilite === 'madame' ? 1 : EPOUSES_MAX;
    if (f.situationDeFamille === 'marie' && f.conjoints.length === 0) {
      signaler('conjoints', 'À renseigner');
    } else if (f.situationDeFamille === 'marie' && f.conjoints.length > conjoints) {
      signaler('conjoints', 'Un seul époux');
    } else if (f.situationDeFamille !== 'marie' && f.conjoints.length > 0) {
      signaler('conjoints', 'Sans objet ici');
    }

    seulementSi(f.contrat === 'cdd', ['cddDu', 'cddAu'], 'Date à saisir');
    seulementSi(f.contrat === 'chantier', ['chantier'], 'À renseigner');

    seulementSi(f.serviceMilitaire, ['classeDeRecrutement', 'armee', 'grade'], 'À renseigner');

    poser(ctx, datesDeLaDeclaration(f));
  });
export type FicheDeclarationMouvement = z.infer<typeof ficheDeclarationMouvementSchema>;

/** `delivered` : statut historique, conservé en lecture (voir en-tête). */
export const documentRequestStatusSchema = z.enum([
  'received',
  'processing',
  'ready',
  'delivered',
  'rejected',
  'cancelled',
]);
export type DocumentRequestStatus = z.infer<typeof documentRequestStatusSchema>;

export const DOC_REQUEST_STATUS_LABELS: Record<DocumentRequestStatus, string> = {
  received: 'Reçue',
  processing: 'En traitement',
  ready: 'Prête à retirer',
  delivered: 'Remise',
  rejected: 'Refusée',
  cancelled: 'Annulée',
};

export const DOC_REQUEST_STATUS_TONES: Record<
  DocumentRequestStatus,
  'gris' | 'orange' | 'bleu' | 'teal' | 'rouge'
> = {
  received: 'gris',
  processing: 'orange',
  ready: 'bleu',
  delivered: 'teal',
  rejected: 'rouge',
  cancelled: 'gris',
};

/**
 * Le statut tel qu'il se lit : prête, une demande dont le document est
 * déposé en ligne est « Disponible », plus « à retirer ».
 */
export function statutDeLaDemande(r: {
  status: DocumentRequestStatus;
  fichiers: readonly unknown[];
}): string {
  return r.status === 'ready' && r.fichiers.length > 0
    ? 'Disponible'
    : DOC_REQUEST_STATUS_LABELS[r.status];
}

/**
 * Statuts d'une demande encore OUVERTE — « prête » n'en fait pas partie :
 * c'est l'état final depuis que la remise en main propre n'est plus
 * enregistrée, et la compter bloquerait l'agent à vie.
 */
export const OPEN_DOCUMENT_REQUEST_STATUSES: DocumentRequestStatus[] = ['received', 'processing'];

/**
 * Le garde-fou contre les doublons de file : un document déjà demandé ne se
 * redemande pas tant que la demande est ouverte. Chaque document demandé
 * est une demande à part — il va à qui traite ce type de document —, si bien
 * qu'un plafond sur le NOMBRE de demandes empêcherait de demander, d'un coup,
 * les quatre pièces d'un dossier de visa.
 *
 * La règle vit ici : le portail l'annonce (le document en cours est grisé)
 * avant de se faire refuser à l'envoi.
 */
export const documentsEnCours = (
  demandes: ReadonlyArray<{ status: string; docTypes: readonly string[] }>,
): Set<string> =>
  new Set(
    demandes
      .filter((d) => (OPEN_DOCUMENT_REQUEST_STATUSES as string[]).includes(d.status))
      .flatMap((d) => d.docTypes),
  );

/*
   Le bulletin de salaire se demandait pour une période (ADR-0039) : un mois,
   les N derniers mois, ou de tel mois à tel mois. Il ne se demande plus
   (ADR-0084) ; une demande ancienne se lit toujours avec ses mois.
*/

export const MOIS_DE_L_ANNEE = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
] as const;

/** Les mois d'un bulletin demandé : « 2026-09 », les N derniers, ou de « 2026-07 » à « 2026-09 ». */
export type PeriodeDuBulletin =
  | { type: 'mois'; mois: string }
  | { type: 'derniers'; nombre: number }
  | { type: 'periode'; du: string; au: string };

/** « septembre 2026 ». */
export function moisEnLettres(mois: string): string {
  const [annee, m] = mois.split('-');
  return `${MOIS_DE_L_ANNEE[Number(m) - 1]} ${annee}`;
}

/**
 * « septembre 2026 », « 3 derniers mois », « janvier à juin 2026 »,
 * « novembre 2025 à février 2026 ».
 */
export function periodeEnLettres(p: PeriodeDuBulletin): string {
  if (p.type === 'mois') return moisEnLettres(p.mois);
  if (p.type === 'derniers') return `${p.nombre} derniers mois`;
  const memeAnnee = p.du.slice(0, 4) === p.au.slice(0, 4);
  const debut = memeAnnee ? MOIS_DE_L_ANNEE[Number(p.du.slice(5)) - 1] : moisEnLettres(p.du);
  return `${debut} à ${moisEnLettres(p.au)}`;
}

/** Le document tel qu'il se lit dans une file : « Bulletin de salaire · 3 derniers mois ». */
export function documentDemande(doc: RequestableDoc, bulletin: PeriodeDuBulletin | null): string {
  const libelle = REQUESTABLE_DOC_LABELS[doc] ?? doc;
  return doc === 'bulletin_salaire' && bulletin
    ? `${libelle} · ${periodeEnLettres(bulletin)}`
    : libelle;
}

export const createDocumentRequestSchema = z.object({
  /** Un ou plusieurs documents : chacun devient une demande, qui va à qui le traite. */
  docTypes: z.array(documentDemandableSchema).min(1).max(documentDemandableSchema.options.length),
  /** Le motif (banque, visa…) : facultatif mais utile à la RH. */
  note: z
    .string()
    .trim()
    .max(500)
    .transform((v) => (v === '' ? undefined : v))
    .optional(),
});
export type CreateDocumentRequestInput = z.infer<typeof createDocumentRequestSchema>;

/** Une demande par document demandé. */
export interface CreateDocumentRequestResult {
  ids: string[];
}

/*
   La remise en ligne (ADR-0040, ADR-0041) : qui traite la demande y dépose
   le document, et l'agent le télécharge depuis son espace une fois la
   demande prête. Plus besoin de passer au bureau, en télétravail ou en
   déplacement. Un PDF, 5 Mo au plus par fichier, douze fichiers au plus.
*/
export const TYPES_DE_FICHIER_REMIS = ['application/pdf'] as const;
export const MAX_FICHIER_REMIS_BYTES = 5 * 1024 * 1024;
export const FICHIERS_REMIS_MAX = 12;

export const deposerFichierSchema = z.object({
  filename: z.string().trim().min(1).max(200),
  contentType: z.enum(TYPES_DE_FICHIER_REMIS),
  contentBase64: z
    .string()
    .min(1)
    .max(Math.ceil((MAX_FICHIER_REMIS_BYTES * 4) / 3) + 4),
});
export type DeposerFichierInput = z.infer<typeof deposerFichierSchema>;

/** Le nom d'un document remis se corrige : c'est celui que l'agent enregistre. */
export const renommerFichierSchema = z.object({
  filename: z.string().trim().min(1).max(200),
});
export type RenommerFichierInput = z.infer<typeof renommerFichierSchema>;

/** Un document remis en ligne, sans son contenu : seul le téléchargement le lit. */
export interface FichierRemisView {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}

/** Transitions pilotées par la RH — « prête » clôt le circuit. */
export const advanceDocumentRequestSchema = z.object({
  status: z.enum(['processing', 'ready', 'rejected']),
  /**
   * Pour « prête » : à qui s'adresser. Sans précision, à qui la traite ; à
   * personne si le document est déposé en ligne.
   */
  pickupContact: z.string().trim().max(120).optional(),
  /** Message libre (obligatoire en cas de refus : le motif). */
  message: z.string().trim().max(500).optional(),
});
export type AdvanceDocumentRequestInput = z.infer<typeof advanceDocumentRequestSchema>;

/**
 * Même geste, sur plusieurs demandes à la fois.
 *
 * La RH ne traite pas les demandes une par une : elle sort le parapheur du
 * jour, génère la pile, la fait signer, puis annonce tout d'un coup. Boucler
 * côté navigateur sur l'appel unitaire laisserait la file à moitié avancée au
 * premier échec ; le lot est donc appliqué en une seule transaction.
 */
export const batchAdvanceDocumentRequestSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(50),
  /** « processing » n'a pas de sens en lot : on valide ou on décline. */
  status: z.enum(['ready', 'rejected']),
  pickupContact: z.string().trim().max(120).optional(),
  message: z.string().trim().max(500).optional(),
});
export type BatchAdvanceDocumentRequestInput = z.infer<typeof batchAdvanceDocumentRequestSchema>;

/**
 * Les demandes nouvellement traitées que l'agent vient de voir sur son
 * suivi : leurs avis passent pour lus (ADR-0048).
 */
export const demandesVuesSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(100),
});
export type DemandesVuesInput = z.infer<typeof demandesVuesSchema>;

/**
 * Ce que le lot a réellement fait. Une demande déjà traitée par un collègue
 * pendant que l'écran était ouvert n'annule pas les autres : elle est
 * ÉCARTÉE et nommée, pour que la RH sache exactement ce qui est parti.
 */
export interface BatchAdvanceResult {
  advanced: number;
  skipped: { id: string; employeeName: string; reason: string }[];
}

export interface DocumentRequestView {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeNumber: string;
  /** Statut du dossier : conditionne la génération d'attestation. */
  employeeStatus: string;
  docTypes: RequestableDoc[];
  /** Les mois d'un bulletin de salaire demandé avant l'ADR-0084 ; `null` sinon. */
  bulletin: PeriodeDuBulletin | null;
  note: string | null;
  status: DocumentRequestStatus;
  pickupContact: string | null;
  /**
   * Les documents remis en ligne. L'agent les voit une fois la demande
   * prête ; qui la traite, dès leur dépôt.
   */
  fichiers: FichierRemisView[];
  hrMessage: string | null;
  handledByName: string | null;
  createdAt: string;
  processingAt: string | null;
  readyAt: string | null;
  deliveredAt: string | null;
  /**
   * Date de clôture — mise à disposition, remise, ou refus. `null` tant que la
   * demande est ouverte. C'est elle qui donne la durée de traitement : une
   * correction du point de retrait ne la déplace pas.
   */
  handledAt: string | null;
  /**
   * Les heures ouvrées de traitement (ADR-0128) : de la demande à sa clôture,
   * ou jusqu'à maintenant tant qu'elle est ouverte. Les week-ends et les
   * jours fériés ne comptent pas. Null : annulée.
   */
  heuresOuvrees: number | null;
  /**
   * Traitée, et l'avis qui l'annonce n'est pas encore lu : l'agent ne l'a
   * pas encore vue (ADR-0048). Dans son propre suivi seulement
   * (`scope=mine`) ; ailleurs, toujours faux.
   */
  nouvelle: boolean;
  /** true si l'utilisateur courant peut la faire avancer : il la traite pour la DCH. */
  canAdvance: boolean;
  /** true si c'est la sienne, et qu'elle n'est pas encore prête : il peut l'annuler. */
  canCancel: boolean;
  /**
   * true quand la session y dépose, retire et télécharge les documents
   * remis : ouverte, si elle la traite ; prête, si elle traite ce type de
   * document pour la DCH.
   */
  canHandleFiles: boolean;
  /** Qui la traite, tant qu'elle est ouverte (sinon null). */
  traitement: TraitementView | null;
}
