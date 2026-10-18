import { z } from 'zod';
import type { TraitementView } from './acces';
import { CODES_DES_BANQUES } from './banques';
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

/** Ce qu'un agent demande : la liste de la DCH, dans son ordre (ADR-0084). */
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
  'attestation_stage',
  'certificat_travail',
] as const satisfies readonly DocumentDeLaListe[];

/** Un document dont le modèle est configuré. */
export type DocumentGenere = (typeof GENERATED_DOCS)[number];

export const estGenere = (doc: string): doc is DocumentGenere =>
  (GENERATED_DOCS as readonly string[]).includes(doc);

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
  })
  .strict();
export type SaisiesDuDocument = z.infer<typeof saisiesDuDocumentSchema>;

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
 * ADR-0098, ADR-0100, ADR-0102).
 */
export const DOCS_SANS_AGENT = [
  'contrat_cdd',
  'contrat_cdi',
  'contrat_stage',
  'decision_disponibilite',
  'decision_renouvellement_disponibilite',
  'domiciliation_bancaire',
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
    naissanceLe: z.iso.date(),
    naissanceA: lieu(120),
    /** Le numéro de la carte nationale d'identité : treize chiffres. */
    cni: z.string().regex(/^\d{13}$/, 'Treize chiffres attendus'),
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

/**
 * Le dernier jour d'un stage de `mois` mois qui commence le `debut` : la
 * veille du même quantième, `mois` mois plus tard (du 19 août au 18
 * novembre) ; si ce quantième n'existe pas, le dernier jour du mois (du 31
 * janvier au 28 février).
 */
export function finDuStage(debut: string, mois: number): string {
  const [a, m, j] = debut.split('-').map(Number) as [number, number, number];
  const cible = new Date(Date.UTC(a, m - 1 + mois, 1));
  const joursDuMois = new Date(
    Date.UTC(cible.getUTCFullYear(), cible.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const fin =
    j > joursDuMois
      ? new Date(Date.UTC(cible.getUTCFullYear(), cible.getUTCMonth(), joursDuMois))
      : new Date(Date.UTC(cible.getUTCFullYear(), cible.getUTCMonth(), j - 1));
  return fin.toISOString().slice(0, 10);
}

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
  naissanceLe: z.iso.date(),
  naissanceA: lieu(120),
  /** Le numéro de la carte nationale d'identité : treize chiffres. */
  cni: z.string().regex(/^\d{13}$/, 'Treize chiffres attendus'),
  cniDelivreeLe: z.iso.date(),
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
  demandeLe: z.iso.date(),
  pvDirectionGeneraleLe: z.iso.date(),
  pvDirectionGeneraleAdjointeLe: z.iso.date(),
  /** Le jour où le service doit reprendre : sans reprise, la démission est constatée. */
  repriseLe: z.iso.date(),
});

/** La mise en disponibilité : son premier jour. */
export const ficheDisponibiliteSchema = ficheDeLaDecision
  .extend({ effetLe: z.iso.date() })
  .strict()
  .refine((f) => f.repriseLe > f.effetLe, {
    message: 'La reprise suit la prise d’effet',
    path: ['repriseLe'],
  });
export type FicheDisponibilite = z.infer<typeof ficheDisponibiliteSchema>;

/** Une disponibilité se proroge de deux ans au plus. */
export const DUREE_DE_PROROGATION_MAX = 24;

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
  .refine((f) => f.initialementAu >= f.initialementDu, {
    message: 'La fin suit le début',
    path: ['initialementAu'],
  })
  .refine((f) => f.repriseLe > f.initialementAu, {
    message: 'La reprise suit la période initiale',
    path: ['repriseLe'],
  });
export type FicheRenouvellement = z.infer<typeof ficheRenouvellementSchema>;

export type DecisionDeDisponibilite =
  'decision_disponibilite' | 'decision_renouvellement_disponibilite';

/** Le schéma de la fiche d'une décision de disponibilité, selon qu'elle l'accorde ou la renouvelle. */
export const ficheDeLaDecisionSchema = (doc: DecisionDeDisponibilite) =>
  doc === 'decision_disponibilite' ? ficheDisponibiliteSchema : ficheRenouvellementSchema;

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
    /** Le premier jour du contrat. */
    debut: z.iso.date(),
    contrat: z.enum(['cdd', 'cdi']),
    /** Le jour où la personne a donné l'ordre de virement. */
    demandeLe: z.iso.date(),
    banque: z.enum(CODES_DES_BANQUES),
    /** À qui la lettre s'adresse : qui dirige la banque. */
    destinataire: z.enum(['directeur_general', 'directrice_generale']),
    /** Le RIB : « SN », puis vingt-deux chiffres. */
    rib: z.string().regex(/^SN\d{22}$/, 'Vingt-quatre caractères attendus, SN compris'),
    /** Le salaire mensuel net, en francs CFA. */
    salaire: z.number().int().min(1).max(SALAIRE_MAX),
  })
  .strict();
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
  docTypes: z.array(requestableDocSchema).min(1).max(requestableDocSchema.options.length),
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
