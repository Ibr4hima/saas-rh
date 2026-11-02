import {
  banqueDe,
  employeeFieldsSchema,
  LIBELLES_LIEN_DE_PARENTE,
  LIBELLES_REGION,
  MAX_EPOUSES,
  personFieldsSchema,
  remunerationSchema,
  ribGroupe,
  type AvertissementImport,
  type CodeDeBanque,
  type CorrectionImport,
  type Gender,
  type LienDeParente,
  type MaritalStatus,
  type Personnel,
  type Region,
} from '@teranga/contracts';
import type { z } from 'zod';
import type { CelluleXlsx } from '../../common/xlsx';
import {
  accorderAuGenre,
  adresse,
  ancienneteDe,
  dateLisible,
  distance,
  entreeDepuisAnciennete,
  intitule,
  lireAnciennete,
  lireBanque,
  lireCni,
  lireContrat,
  lireCourriel,
  lireCourrielPro,
  lireDate,
  lireEntier,
  lireFiliation,
  lireLien,
  lireMontant,
  lireParts,
  lirePays,
  lireRegion,
  lireRib,
  lireSexe,
  lireSituation,
  lireStatut,
  lireTelephone,
  nomDePersonne,
  nomDeVille,
  sansObjet,
  squelette,
  texte,
  type Lecture,
} from './import-valeurs';

/* ────────────────────────────────────────────────────────────────
   Du fichier du personnel de la DCH à la fiche (ADR-0159).

   Le fichier compte soixante colonnes. Ce module dit où se trouve chacune,
   puis lit une ligne : il la rend prête pour la fiche, ou il la refuse en
   disant pourquoi. Aucune écriture, aucune base : il se teste ligne par
   ligne.

   Une ligne n'est refusée que si le matricule, le prénom, le nom ou la date
   d'entrée manquent ou ne se lisent pas. Ailleurs, une valeur fausse est
   écartée et signalée, et le reste de la ligne est importé.
   ──────────────────────────────────────────────────────────────── */

export type Champ =
  | 'matricule'
  | 'prenom'
  | 'nom'
  | 'sexe'
  | 'naissance'
  | 'lieuNaissance'
  | 'pays'
  | 'filiation'
  | 'cni'
  | 'situation'
  | 'epouse1'
  | 'epouse2'
  | 'epouse3'
  | 'epouse4'
  | 'nbEpouses'
  | 'enfants'
  | 'emailPerso'
  | 'emailPro'
  | 'tel'
  | 'telPro'
  | 'adresse'
  | 'ville'
  | 'region'
  | 'urgenceNom'
  | 'urgenceTel'
  | 'lien'
  | 'poste'
  | 'n1'
  | 'fonctionnel'
  | 'statut'
  | 'direction'
  | 'departement'
  | 'lieuTravail'
  | 'projet'
  | 'contrat'
  | 'entree'
  | 'finCdd'
  | 'sortie'
  | 'motifSortie'
  | 'anciennete'
  | 'categorie'
  | Montant
  | 'autresAvantages'
  | 'nombreDeParts'
  | 'banque'
  | 'rib'
  | 'domiciliation'
  | 'numeroIpres';

/** Les montants de la rémunération, en francs CFA, dans l'ordre de la fiche. */
export const MONTANTS = [
  'salaireDeBase',
  'sursalaire',
  'primeAnciennete',
  'brutSocial',
  'primeTransport',
  'salaireBrut',
  'carburant',
  'forfaitTelephone',
  'indemniteSujetion',
] as const;
type Montant = (typeof MONTANTS)[number];

/**
 * La rémunération, la banque et l'IPRES : réservées à l'accès aux données
 * sensibles (ADR-0158).
 */
export const CHAMPS_DE_LA_REMUNERATION: Champ[] = [
  ...MONTANTS,
  'autresAvantages',
  'nombreDeParts',
  'banque',
  'rib',
  'domiciliation',
  'numeroIpres',
];

/**
 * Les intitulés du fichier de la DCH, et les autres façons de les écrire.
 * Ils se comparent sans accents, sans casse ni ponctuation : « Region » vaut
 * « Région », et l'ordre des colonnes ne compte pas.
 */
const INTITULES: Record<Champ, string[]> = {
  matricule: ['Matricule', 'N° matricule'],
  prenom: ['Prénom', 'Prénoms'],
  nom: ['Nom', 'Nom de famille'],
  sexe: ['Sexe', 'Genre'],
  naissance: ['Date de naissance', 'Né(e) le'],
  lieuNaissance: ['Lieu de naissance', 'Ville de naissance'],
  pays: ['Pays', 'Pays de naissance'],
  filiation: ['Fils/Fille', 'Fils ou fille de', 'Filiation'],
  cni: ['Numéro CNI', 'N° CNI', 'CNI'],
  situation: ['Situation matrimoniale', 'Situation familiale'],
  epouse1: ['Nom de l’épouse 1', 'Épouse 1'],
  epouse2: ['Nom de l’épouse 2', 'Épouse 2'],
  epouse3: ['Nom de l’épouse 3', 'Épouse 3'],
  epouse4: ['Nom de l’épouse 4', 'Épouse 4'],
  nbEpouses: ['Nombre d’épouses', 'Nombre d’épouse', 'Nombre épouses'],
  enfants: ['Nombre d’enfants', 'Nombre enfants'],
  emailPerso: [
    'Adresse mail personnelle',
    'Adresse mail personnel',
    'Email personnel',
    'Adresse email personnelle',
  ],
  emailPro: [
    'Adresse mail professionnelle',
    'Adresse mail professionnel',
    'Email professionnel',
    'Adresse email professionnelle',
  ],
  tel: [
    'Numéro de tel personnel',
    'Numéro de téléphone personnel',
    'Téléphone personnel',
    'Téléphone',
  ],
  telPro: [
    'Numéro de tel professionnel',
    'Numéro de téléphone professionnel',
    'Téléphone professionnel',
  ],
  adresse: ['Adresse physique', 'Adresse'],
  ville: ['Ville'],
  region: ['Région'],
  urgenceNom: ['Personne à contacter en cas d’urgence', 'Contact d’urgence'],
  urgenceTel: [
    'Numéro Tel de la personne à contacter en cas d’urgence',
    'Téléphone du contact d’urgence',
  ],
  lien: ['Lien de parenté avec le contact', 'Lien de parenté'],
  poste: ['Poste occupé', 'Poste', 'Fonction'],
  n1: ['Responsable hiérarchique (N+1)', 'Responsable hiérarchique', 'N+1'],
  fonctionnel: ['Responsable fonctionnel'],
  statut: ['Statut', 'Cadre ou non cadre'],
  direction: ['Direction'],
  departement: ['Département'],
  lieuTravail: ['Lieu de travail'],
  projet: ['Projet'],
  contrat: ['Type de contrat', 'Contrat'],
  entree: ['Date d’entrée', 'Date d’embauche'],
  finCdd: ['Date de fin (si CDD)', 'Date de fin', 'Date de fin du contrat'],
  sortie: ['Date de sortie'],
  motifSortie: ['Motif de sortie'],
  anciennete: ['Ancienneté (années)', 'Ancienneté'],
  categorie: ['Catégorie socio-professionnelle', 'Catégorie'],
  salaireDeBase: ['Salaire de base'],
  sursalaire: ['Sursalaire'],
  primeAnciennete: ['Prime d’ancienneté'],
  brutSocial: ['Brut social'],
  primeTransport: ['Prime de transport'],
  salaireBrut: ['Salaire brut'],
  carburant: ['Carburant', 'Indemnité de carburant'],
  forfaitTelephone: ['Forfait téléphone', 'Forfait téléphonique'],
  indemniteSujetion: ['Indemnité de sujétion', 'Indemnités de sujétion'],
  autresAvantages: ['Autres avantages'],
  nombreDeParts: [
    'Nombre de parts',
    'Nombre de part',
    'Nombre de part sociale',
    'Nombre de parts sociales',
    'Nombre de parts fiscales',
  ],
  banque: ['Banque'],
  rib: ['Relevé d’identité bancaire', 'RIB'],
  domiciliation: ['Domiciliation', 'Domiciliation bancaire'],
  numeroIpres: ['Numéro IPRES', 'N° IPRES', 'IPRES'],
};

/** Lues sans être reprises : elles se calculent (âge, ancienneté) ou se déduisent. */
const SANS_OBJET = ['N°', 'No', 'Nom complet', 'Âge', 'Nationalité'];

/** Sans ces colonnes, aucune ligne ne peut s'importer. */
const OBLIGATOIRES: Champ[] = ['matricule', 'prenom', 'nom', 'entree'];

export interface Correspondance {
  colonnes: Partial<Record<Champ, number>>;
  /** L'intitulé tel que le fichier l'écrit : c'est lui qu'on cite. */
  intitules: Partial<Record<Champ, string>>;
  inconnues: string[];
  manquantes: string[];
}

/** Les intitulés des colonnes que le fichier remplit, parmi ces champs. */
export function colonnesRemplies(
  corr: Correspondance,
  donnees: CelluleXlsx[][],
  champs: Champ[],
): string[] {
  return champs
    .filter((c) => {
      const i = corr.colonnes[c];
      return i !== undefined && donnees.some((l) => texte(l[i]) !== undefined && !sansObjet(l[i]));
    })
    .map((c) => corr.intitules[c]!);
}

/** Où se trouve chaque champ : on cherche les intitulés, on ne se fie pas à l'ordre. */
export function correspondre(entetes: CelluleXlsx[]): Correspondance {
  const index = new Map<string, Champ>();
  for (const [champ, variantes] of Object.entries(INTITULES) as [Champ, string[]][]) {
    for (const v of variantes) index.set(squelette(v), champ);
  }
  const sansObjet = new Set(SANS_OBJET.map(squelette));

  const r: Correspondance = {
    colonnes: {},
    intitules: {},
    inconnues: [],
    manquantes: [],
  };
  entetes.forEach((brut, i) => {
    const t = texte(brut);
    if (!t) return;
    const s = squelette(t);
    const champ = index.get(s);
    if (champ) {
      if (r.colonnes[champ] === undefined) {
        r.colonnes[champ] = i;
        r.intitules[champ] = t;
      }
      return;
    }
    if (sansObjet.has(s)) return;
    r.inconnues.push(t);
  });
  r.manquantes = OBLIGATOIRES.filter((c) => r.colonnes[c] === undefined)
    // Sans la date d'entrée, l'ancienneté la remplace : la colonne suffit.
    .filter((c) => !(c === 'entree' && r.colonnes.anciennete !== undefined))
    .map((c) => INTITULES[c][0]!);
  return r;
}

/* ───────────────────────── Le poste ───────────────────────── */

/** Ce que dit un intitulé de poste de la place de l'agent dans l'organigramme. */
export type NaturePoste =
  | { nature: 'dg' }
  | { nature: 'dga' }
  | { nature: 'sg' }
  /** « Directeur financier et comptable » : la suite doit nommer la direction. */
  | { nature: 'directeur'; precision: string | null }
  /** « Chef de département Digitalisation » : le nom de l'unité, s'il est donné. */
  | { nature: 'chef'; type: 'department' | 'service'; nom: string | null }
  | { nature: 'agent' };

const MOTS_VIDES = new Set([
  'de',
  'du',
  'des',
  'la',
  'le',
  'les',
  'l',
  'd',
  'et',
  'a',
  'au',
  'aux',
  // « ET ES PLATEFORMES » : un « des » écorné.
  'es',
]);

/**
 * Ce qui suit le nom de l'unité dans un poste sans en faire partie : un
 * second rôle (« Chef du département Aménagement et chef de projet ZES
 * Diass »), un intérim.
 */
const SECOND_ROLE =
  / et (?:chef|cheffe|responsable|coordonnateur|coordonnatrice|coordinateur|coordinatrice|directeur|directrice|charge|chargee|point focal|gestionnaire|conseiller|conseillere|assistant|assistante|secretaire|manager|administrateur|administratrice|superviseur|superviseure)(?: .*)?$/;
const INTERIM = / (?:par interim|interim|ai|a i|pi|p i)$/;

/** Les mots du squelette d'un texte, chacun avec sa place dans le texte d'origine. */
function motsEtPlaces(brut: string): { mot: string; debut: number; fin: number }[] {
  const r: { mot: string; debut: number; fin: number }[] = [];
  for (const m of brut.matchAll(/[\p{L}\p{M}\p{N}]+/gu)) {
    for (const mot of squelette(m[0]).split(' ').filter(Boolean)) {
      r.push({ mot, debut: m.index, fin: m.index + m[0].length });
    }
  }
  return r;
}

/**
 * Le nom de l'unité que nomme la fin d'un poste, tel que le fichier l'écrit,
 * virgules et apostrophes comprises : « COURRIER, DOCUMENTATION ET
 * ARCHIVAGE ». `reste` en est le squelette, mot à mot.
 */
function nomDansLePoste(brut: string, s: string, reste: string[]): string | null {
  const tous = s.split(' ').filter(Boolean);
  let garde = reste.join(' ').replace(SECOND_ROLE, '').replace(INTERIM, '').split(' ');
  while (garde.length > 0 && MOTS_VIDES.has(garde[garde.length - 1]!)) garde = garde.slice(0, -1);
  garde = garde.filter(Boolean);
  if (garde.length === 0) return null;
  const places = motsEtPlaces(brut);
  // Les mots corrigés (« DPARTEMENT ») gardent leur place : seul leur nombre compte.
  if (places.length !== tous.length) return garde.join(' ');
  const premier = places[tous.length - reste.length]!;
  const dernier = places[tous.length - reste.length + garde.length - 1]!;
  let nom = brut.slice(premier.debut, dernier.fin).trim();
  // « QUALITE (DQSE » : une parenthèse que la coupe a laissée ouverte.
  if ((nom.match(/\(/g)?.length ?? 0) !== (nom.match(/\)/g)?.length ?? 0)) {
    nom = nom
      .replace(/\s*\([^)]*$/, '')
      .replace(/[()]/g, '')
      .trim();
  }
  return nom || null;
}

/** Les mots qui disent la nature d'un poste : une faute de frappe ne doit pas la cacher. */
const MOTS_DU_POSTE = [
  'adjoint',
  'adjointe',
  'departement',
  'directeur',
  'directrice',
  'general',
  'generale',
  'responsable',
  'secretaire',
  'service',
];

/**
 * Un mot du poste, sa faute de frappe corrigée : « DPARTEMENT » est
 * département, « DEPART. » aussi. Une lettre près, jamais dans les deux
 * dernières (« services » reste services).
 */
function motDuPoste(m: string): string {
  if (m === 'depart') return 'departement';
  if (m.length < 6 || MOTS_DU_POSTE.includes(m)) return m;
  const proches = MOTS_DU_POSTE.filter((k) => k.slice(-2) === m.slice(-2) && distance(k, m) === 1);
  return proches.length === 1 ? proches[0]! : m;
}

export function natureDuPoste(brut: string): NaturePoste {
  const s = squelette(brut).split(' ').map(motDuPoste).join(' ');
  const mots = s.split(' ');
  if (/^(directeur|directrice) generale? adjointe?$/.test(s) || s === 'dga') {
    return { nature: 'dga' };
  }
  // Un adjoint ne dirige pas l'unité : « Chef de service adjoint ».
  if (mots.includes('adjoint') || mots.includes('adjointe')) return { nature: 'agent' };
  if (/^(directeur|directrice) generale?$/.test(s) || s === 'dg') return { nature: 'dg' };
  if (/^secretaire generale?$/.test(s) || s === 'sg') return { nature: 'sg' };
  const chef =
    /^(?:chef|cheffe|responsable)(?: (?:de la|de|du|des|d))? (departement|dept|dpt|service)(?: (.*))?$/.exec(
      s,
    );
  if (chef) {
    const reste = (chef[2] ?? '').split(' ').filter(Boolean);
    while (reste.length > 0 && MOTS_VIDES.has(reste[0]!)) reste.shift();
    return {
      nature: 'chef',
      type: chef[1] === 'service' ? 'service' : 'department',
      nom: reste.length > 0 ? nomDansLePoste(brut, s, reste) : null,
    };
  }
  const dir = /^(?:directeur|directrice)(?: (.*))?$/.exec(s);
  if (dir) {
    const reste = (dir[1] ?? '').split(' ').filter((m) => m && !MOTS_VIDES.has(m));
    return { nature: 'directeur', precision: reste.length > 0 ? reste.join(' ') : null };
  }
  return { nature: 'agent' };
}

/** Les racines des mots d'un nom : « financier » et « Financière » ont la même. */
function racines(t: string): string[] {
  return squelette(t)
    .split(' ')
    .filter((m) => m && !MOTS_VIDES.has(m) && m !== 'direction')
    .map((m) => m.slice(0, 5));
}

/**
 * La suite d'un « Directeur… » désigne-t-elle cette direction ? « financier
 * et comptable » désigne la Direction Financière et Comptable, « de la DFC »
 * aussi ; « de projet » ne désigne aucune direction.
 */
export function designeLaDirection(
  precision: string | null,
  direction: { nom: string; sigle: string | null },
): boolean {
  if (!precision) return true;
  if (direction.sigle && squelette(precision) === squelette(direction.sigle)) return true;
  const lues = racines(precision);
  const siennes = new Set(racines(direction.nom));
  return lues.length > 0 && lues.every((r) => siennes.has(r));
}

/** La clé d'un nom d'unité : « Département Études » et « ETUDES » ont la même. */
export function cleDUnite(nom: string): string {
  return squelette(nom)
    .split(' ')
    .filter(
      (m) =>
        m &&
        !MOTS_VIDES.has(m) &&
        !['departement', 'dept', 'dpt', 'service', 'direction'].includes(m),
    )
    .join(' ');
}

/**
 * Le nom d'une unité à créer : « Département Digitalisation », « Service
 * Qualité », « Service BCE ».
 */
export function nomDUnite(
  type: 'department' | 'service',
  nom: string,
  sigles: ReadonlySet<string> = new Set(),
): string {
  const propre = intitule(nom.toUpperCase(), sigles);
  return `${type === 'department' ? 'Département' : 'Service'} ${propre}`.slice(0, 120);
}

/* ───────────────────────── Une ligne ───────────────────────── */

export interface PersonneLue {
  gender?: Gender;
  birthDate?: string;
  birthPlace?: string;
  lieuDeNaissance?: string;
  nationalId?: string;
  idDocumentType?: 'cni';
  maritalStatus?: MaritalStatus;
  epouses?: string[];
  nombreEnfants?: number;
  personalEmail?: string;
  phone?: string;
  addressLine?: string;
  ville?: string;
  region?: Region;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  lienContactUrgence?: LienDeParente;
  prenomDuPere?: string;
  prenomDeLaMere?: string;
  nomDeLaMere?: string;
}

export interface EmploiLu {
  workEmail?: string;
  workPhone?: string;
  personnel?: Personnel;
  lieuDeTravail?: string;
  projet?: string;
  categorie?: string;
}

/** La rémunération, la banque et l'IPRES, tels que le fichier les donne (ADR-0163). */
export type RemunerationLue = Partial<Record<Montant | 'nombreDeParts', number>> & {
  autresAvantages?: string;
  banque?: CodeDeBanque;
  rib?: string;
  domiciliation?: string;
  numeroIpres?: string;
};

export interface LigneLue {
  ligne: number;
  matricule: string;
  prenom: string;
  nom: string;
  personne: PersonneLue;
  emploi: EmploiLu;
  remuneration: RemunerationLue;
  /** La date d'entrée, au jour près ou au mois. */
  entree: { iso: string; auMois: boolean };
  poste: { intitule: string; nature: NaturePoste } | null;
  /** Le sigle ou le nom de la direction, tel que le fichier l'écrit. */
  direction: string | null;
  departement: string | null;
  contrat: { type: 'cdi' | 'cdd'; fin: string | null } | null;
  /** Les noms du N+1 et du responsable fonctionnel, tels que le fichier les écrit. */
  n1: string | null;
  fonctionnel: string | null;
  corrections: CorrectionImport[];
  avertissements: AvertissementImport[];
  /** L'intitulé d'une colonne, tel que le fichier l'écrit. */
  colonne: (champ: Champ) => string;
}

export interface LigneRefusee {
  ligne: number;
  matricule: string | null;
  nom: string | null;
  motif: string;
  colonne: string | null;
}

export interface ContexteDeLecture {
  /** Le jour de l'import, pour l'ancienneté. */
  aujourdhui: string;
  /** Les sigles des directions : ils restent en capitales dans les intitulés. */
  sigles: ReadonlySet<string>;
}

const enAnnees = (n: number) =>
  `${n.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} an${n >= 2 ? 's' : ''}`;
const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`;

const SITUATION_LISIBLE: Record<MaritalStatus, string> = {
  single: 'Célibataire',
  married: 'Marié(e)',
  divorced: 'Divorcé(e)',
  widowed: 'Veuf ou veuve',
};

/** La colonne d'où vient chaque champ de la fiche, pour les messages du schéma. */
const COLONNE_DU_CHAMP: Record<string, Champ> = {
  gender: 'sexe',
  birthDate: 'naissance',
  birthPlace: 'pays',
  lieuDeNaissance: 'lieuNaissance',
  nationalId: 'cni',
  idDocumentType: 'cni',
  maritalStatus: 'situation',
  epouses: 'nbEpouses',
  nombreEnfants: 'enfants',
  personalEmail: 'emailPerso',
  phone: 'tel',
  addressLine: 'adresse',
  ville: 'ville',
  region: 'region',
  emergencyContactName: 'urgenceNom',
  emergencyContactPhone: 'urgenceTel',
  lienContactUrgence: 'lien',
  prenomDuPere: 'filiation',
  prenomDeLaMere: 'filiation',
  nomDeLaMere: 'filiation',
  workEmail: 'emailPro',
  workPhone: 'telPro',
  personnel: 'statut',
  lieuDeTravail: 'lieuTravail',
  projet: 'projet',
  categorie: 'categorie',
  ...Object.fromEntries(CHAMPS_DE_LA_REMUNERATION.map((c) => [c, c])),
};

/**
 * Les règles de la fiche, les mêmes qu'à la saisie (une date de naissance
 * de moins de quinze ans, un texte trop long) : ce qu'elles refusent est
 * écarté et signalé, le reste passe.
 */
function selonLaFiche<T extends object>(
  schema: z.ZodType,
  valeurs: T,
  fixes: Record<string, unknown>,
  colonne: (c: Champ) => string,
  avertissements: AvertissementImport[],
): T {
  const v: Record<string, unknown> = { ...(valeurs as Record<string, unknown>) };
  for (let essai = 0; essai < 20; essai++) {
    const r = schema.safeParse({ ...fixes, ...v });
    if (r.success) {
      const propre = r.data as Record<string, unknown>;
      return Object.fromEntries(Object.keys(v).map((k) => [k, propre[k]])) as T;
    }
    const issue = r.error.issues[0];
    const champ = String(issue?.path[0] ?? '');
    if (!(champ in v)) break;
    delete v[champ];
    if (champ === 'nationalId' || champ === 'idDocumentType') {
      delete v.nationalId;
      delete v.idDocumentType;
    }
    const c = COLONNE_DU_CHAMP[champ];
    avertissements.push({
      colonne: c ? colonne(c) : champ,
      texte: `${issue?.message ?? 'Valeur refusée'} : non importé`,
    });
  }
  return v as T;
}

/** Les champs restés vides ne partent pas : une case vide n'efface rien. */
function sansVides<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

/**
 * Une ligne du fichier, prête pour la fiche, ou refusée en disant pourquoi.
 * Les refus et les valeurs écartées nomment la colonne : la DCH corrige dans
 * son tableur.
 */
export function lireLigne(
  numero: number,
  valeurs: CelluleXlsx[],
  corr: Correspondance,
  ctx: ContexteDeLecture,
): { ok: LigneLue } | { refus: LigneRefusee } {
  const lire = (c: Champ): CelluleXlsx => {
    const i = corr.colonnes[c];
    const v = i === undefined ? null : (valeurs[i] ?? null);
    return sansObjet(v, c === 'enfants' || c === 'nbEpouses') ? null : v;
  };
  const colonne = (c: Champ) => corr.intitules[c] ?? INTITULES[c][0]!;
  const corrections: CorrectionImport[] = [];
  const avertissements: AvertissementImport[] = [];
  const ecarter = (c: Champ, motif: string) =>
    avertissements.push({ colonne: colonne(c), texte: `${motif} : non importé` });
  /** La valeur lue ; la correction notée, l'erreur écartée. */
  function prendre<T>(c: Champ, l: Lecture<T>, lisible: (v: T) => string = String): T | undefined {
    if (!l) return undefined;
    if ('erreur' in l) {
      ecarter(c, l.erreur);
      return undefined;
    }
    if (l.corrige) {
      corrections.push({
        colonne: colonne(c),
        lu: texte(lire(c)) ?? '',
        retenu: lisible(l.valeur),
      });
    }
    return l.valeur;
  }

  const matricule = texte(lire('matricule'))?.toUpperCase();
  const prenomBrut = texte(lire('prenom'));
  const nomBrut = texte(lire('nom'));
  const prenom = prenomBrut ? nomDePersonne(prenomBrut) : undefined;
  const nom = nomBrut ? nomDePersonne(nomBrut) : undefined;
  const refus = (motif: string, c: Champ | null) => ({
    refus: {
      ligne: numero,
      matricule: matricule ?? null,
      nom: [prenom, nom].filter(Boolean).join(' ') || null,
      motif,
      colonne: c && colonne(c),
    },
  });
  if (!matricule) return refus('Le matricule manque', 'matricule');
  if (!prenom) return refus('Le prénom manque', 'prenom');
  if (!nom) return refus('Le nom manque', 'nom');

  // ─── La date d'entrée : la date, sinon l'ancienneté, au mois près.
  const entreeLue = lireDate(lire('entree'), ctx.aujourdhui);
  const anciennete = lireAnciennete(lire('anciennete'));
  const annees = anciennete && !('erreur' in anciennete) ? anciennete.valeur : null;
  let entree: { iso: string; auMois: boolean };
  if (entreeLue && !('erreur' in entreeLue)) {
    entree = { iso: entreeLue.valeur.iso, auMois: entreeLue.valeur.auMois };
    if (entreeLue.corrige) {
      corrections.push({
        colonne: colonne('entree'),
        lu: texte(lire('entree')) ?? '',
        retenu: dateLisible(entree.iso, entree.auMois),
      });
    }
    if (annees !== null && !entree.auMois) {
      const calculee = Math.round(ancienneteDe(entree.iso, ctx.aujourdhui) * 10) / 10;
      if (Math.abs(calculee - annees) > 1) {
        avertissements.push({
          colonne: colonne('anciennete'),
          texte: `${enAnnees(annees)} dans le fichier, ${enAnnees(calculee)} d’après la date d’entrée : la date d’entrée est retenue`,
        });
      }
    }
  } else if (annees !== null) {
    const iso = entreeDepuisAnciennete(annees, ctx.aujourdhui);
    entree = { iso, auMois: true };
    corrections.push({
      colonne: colonne('entree'),
      lu: texte(lire('entree')) ?? '',
      retenu: `${dateLisible(iso, true)}, d’après l’ancienneté (${enAnnees(annees)})`,
    });
  } else {
    return refus(
      entreeLue && 'erreur' in entreeLue
        ? entreeLue.erreur
        : 'La date d’entrée manque, et l’ancienneté aussi',
      'entree',
    );
  }

  // ─── La personne.
  const personne: PersonneLue = {};
  personne.gender = prendre('sexe', lireSexe(lire('sexe')), (g) => (g === 'male' ? 'M' : 'F'));
  const naissance = lireDate(lire('naissance'), ctx.aujourdhui);
  if (naissance && !('erreur' in naissance) && naissance.valeur.auMois) {
    ecarter('naissance', 'Le mois et l’année ne suffisent pas');
  } else {
    personne.birthDate = prendre('naissance', naissance, (d) => dateLisible(d.iso))?.iso;
  }
  personne.birthPlace = prendre('pays', lirePays(lire('pays')));
  const filiation = prendre('filiation', lireFiliation(lire('filiation'), nom));
  if (filiation) Object.assign(personne, filiation);
  const lieu = texte(lire('lieuNaissance'));
  if (lieu) {
    const ville = nomDeVille(lieu);
    if (ville.corrige) {
      corrections.push({ colonne: colonne('lieuNaissance'), lu: lieu, retenu: ville.valeur });
    }
    personne.lieuDeNaissance = ville.valeur;
  }
  personne.nationalId = prendre('cni', lireCni(lire('cni')));
  if (personne.nationalId) personne.idDocumentType = 'cni';
  personne.maritalStatus = prendre(
    'situation',
    lireSituation(lire('situation')),
    (s) => SITUATION_LISIBLE[s],
  );

  // Les épouses, pour un homme marié seulement : autant de noms qu'annoncé.
  const noms = (['epouse1', 'epouse2', 'epouse3', 'epouse4'] as const)
    .map((c) => texte(lire(c)))
    .filter((n): n is string => Boolean(n))
    .map(nomDePersonne);
  const annoncees = prendre('nbEpouses', lireEntier(lire('nbEpouses'), 10));
  if (noms.length > 0 || (annoncees ?? 0) > 0) {
    const nombre = annoncees ?? noms.length;
    const probleme =
      personne.gender === 'female'
        ? 'Épouses renseignées pour une femme'
        : personne.gender !== 'male'
          ? 'Épouses renseignées sans le sexe'
          : !personne.maritalStatus
            ? 'Épouses renseignées sans la situation matrimoniale'
            : personne.maritalStatus !== 'married'
              ? 'Épouses renseignées pour un homme qui n’est pas marié'
              : nombre > MAX_EPOUSES
                ? 'Quatre épouses au plus'
                : nombre !== noms.length
                  ? `${pluriel(nombre, 'épouse')} annoncée${nombre > 1 ? 's' : ''}, ${pluriel(noms.length, 'nom')}`
                  : null;
    if (probleme) {
      avertissements.push({
        colonne: colonne('nbEpouses'),
        texte: `${probleme} : épouses non importées`,
      });
    } else {
      personne.epouses = noms;
    }
  }
  personne.nombreEnfants = prendre('enfants', lireEntier(lire('enfants'), 30));
  personne.personalEmail = prendre('emailPerso', lireCourriel(lire('emailPerso')));
  personne.phone = prendre('tel', lireTelephone(lire('tel')));
  const adresseBrute = texte(lire('adresse'));
  if (adresseBrute) personne.addressLine = adresse(adresseBrute);
  const villeBrute = texte(lire('ville'));
  if (villeBrute) {
    const ville = nomDeVille(villeBrute);
    if (ville.corrige) {
      corrections.push({ colonne: colonne('ville'), lu: villeBrute, retenu: ville.valeur });
    }
    personne.ville = ville.valeur;
  }
  personne.region = prendre('region', lireRegion(lire('region')), (r) => LIBELLES_REGION[r]);
  const urgence = texte(lire('urgenceNom'));
  if (urgence) personne.emergencyContactName = nomDePersonne(urgence);
  personne.emergencyContactPhone = prendre('urgenceTel', lireTelephone(lire('urgenceTel')));
  personne.lienContactUrgence = prendre(
    'lien',
    lireLien(lire('lien')),
    (l) => LIBELLES_LIEN_DE_PARENTE[l],
  );

  // ─── L'emploi.
  const emploi: EmploiLu = {};
  emploi.workEmail = prendre('emailPro', lireCourrielPro(lire('emailPro')));
  emploi.workPhone = prendre('telPro', lireTelephone(lire('telPro')));
  emploi.personnel = prendre('statut', lireStatut(lire('statut')), (p) =>
    p === 'cadre' ? 'Cadre' : 'Non cadre',
  );
  emploi.lieuDeTravail = texte(lire('lieuTravail'));
  emploi.projet = texte(lire('projet'));
  emploi.categorie = texte(lire('categorie'));

  // ─── La rémunération, la banque et l'IPRES.
  const remuneration: RemunerationLue = {};
  for (const c of MONTANTS) remuneration[c] = prendre(c, lireMontant(lire(c)));
  remuneration.nombreDeParts = prendre('nombreDeParts', lireParts(lire('nombreDeParts')), (n) =>
    n.toLocaleString('fr-FR'),
  );
  remuneration.banque = prendre('banque', lireBanque(lire('banque')), (b) => banqueDe(b).nom);
  remuneration.rib = prendre('rib', lireRib(lire('rib')), ribGroupe);
  remuneration.autresAvantages = texte(lire('autresAvantages'));
  remuneration.domiciliation = texte(lire('domiciliation'));
  remuneration.numeroIpres = texte(lire('numeroIpres'));

  const posteBrut = texte(lire('poste'));
  const poste = posteBrut
    ? {
        intitule: accorderAuGenre(intitule(posteBrut, ctx.sigles), personne.gender),
        nature: natureDuPoste(posteBrut),
      }
    : null;

  // ─── Le contrat : un CDD a sa date de fin, un CDI n'en a pas.
  let contrat: LigneLue['contrat'] = null;
  const type = prendre('contrat', lireContrat(lire('contrat')), (t) => t.toUpperCase());
  const finLue = lireDate(lire('finCdd'), ctx.aujourdhui);
  if (type === 'cdi') {
    contrat = { type, fin: null };
    if (finLue) ecarter('finCdd', 'Un CDI n’a pas de date de fin');
  } else if (type === 'cdd') {
    const fin = finLue && !('erreur' in finLue) && !finLue.valeur.auMois ? finLue.valeur.iso : null;
    if (!fin) {
      ecarter(
        'contrat',
        finLue && 'erreur' in finLue
          ? `CDD dont la date de fin ne se lit pas (${finLue.erreur})`
          : 'CDD sans date de fin',
      );
    } else if (fin < entree.iso) {
      ecarter('contrat', 'CDD qui finit avant la date d’entrée');
    } else {
      contrat = { type, fin };
      if (fin < ctx.aujourdhui) {
        avertissements.push({
          colonne: colonne('finCdd'),
          texte: `CDD terminé le ${dateLisible(fin)} : saisissez son renouvellement sur la fiche`,
        });
      }
    }
  }
  for (const c of ['sortie', 'motifSortie'] as const) {
    if (texte(lire(c))) ecarter(c, 'La sortie se saisit sur la fiche');
  }

  const personneValide = selonLaFiche(
    personFieldsSchema,
    personne,
    { givenName: prenom, familyName: nom },
    colonne,
    avertissements,
  );
  const emploiValide = selonLaFiche(
    employeeFieldsSchema,
    emploi,
    { employeeNumber: matricule, hiredOn: entree.iso },
    colonne,
    avertissements,
  );
  const remunerationValide = selonLaFiche(
    remunerationSchema,
    remuneration,
    {},
    colonne,
    avertissements,
  );

  return {
    ok: {
      ligne: numero,
      matricule,
      prenom,
      nom,
      personne: sansVides(personneValide),
      emploi: sansVides(emploiValide),
      remuneration: sansVides(remunerationValide),
      entree,
      poste,
      direction: texte(lire('direction')) ?? null,
      departement: texte(lire('departement')) ?? null,
      contrat,
      n1: texte(lire('n1')) ?? null,
      fonctionnel: texte(lire('fonctionnel')) ?? null,
      corrections,
      avertissements,
      colonne,
    },
  };
}
