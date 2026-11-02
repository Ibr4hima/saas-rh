import { parsePhoneNumberFromString } from 'libphonenumber-js';
import {
  BANQUES,
  DOMAINE_COURRIEL_PRO,
  LIBELLES_REGION,
  NATIONALITY_LABELS,
  NOMBRES_DE_PARTS,
  REGIONS,
  type CodeDeBanque,
  type Gender,
  type LienDeParente,
  type MaritalStatus,
  type Personnel,
  type Region,
} from '@teranga/contracts';
import type { CelluleXlsx } from '../../common/xlsx';

/* ────────────────────────────────────────────────────────────────
   Lire une valeur du fichier de la DCH (ADR-0159).

   Le fichier est tenu à la main depuis des années : « St Louis » pour
   Saint-Louis, « Ziginchor » pour Ziguinchor, « non cadre » pour Non-cadre,
   des dates gardées comme des nombres par Excel, des téléphones avec ou sans
   +221. Ce module rend la valeur juste, et dit quand il a corrigé, pour que
   l'aperçu montre chaque correction avant l'import.

   La règle : on corrige ce qui ne laisse aucun doute, on écarte le reste.
   Une valeur proche de deux valeurs de la liste n'est pas devinée.
   ──────────────────────────────────────────────────────────────── */

/** Le résultat d'une lecture : la valeur, une erreur, ou une cellule vide (null). */
export type Lecture<T> = { valeur: T; corrige: boolean } | { erreur: string } | null;

export const ok = <T>(valeur: T, corrige = false): Lecture<T> => ({ valeur, corrige });

/** « NA », « N/A », « ND » : la DCH dit qu'il n'y a rien à mettre. */
const SANS_OBJET = new Set([
  'na',
  'n a',
  'nd',
  'n d',
  'sans objet',
  'non applicable',
  'non disponible',
  'non renseigne',
  'non renseignee',
]);

/**
 * Une case qui dit « rien » : « NA » pour l'agent sans adresse
 * professionnelle, « - » ou « néant » pour une case sans réponse. Elle vaut
 * une case vide, sans avertissement. Pour un nombre (enfants, épouses),
 * « néant » et « - » disent 0 : `compte` les laisse à la lecture du nombre.
 */
export function sansObjet(v: CelluleXlsx | undefined, compte = false): boolean {
  if (typeof v !== 'string') return false;
  const s = squelette(v);
  if (SANS_OBJET.has(s)) return true;
  if (compte) return false;
  return ['neant', 'aucun', 'aucune'].includes(s) || /^[\p{P}\p{S}\s]+$/u.test(v);
}

/** Le texte d'une cellule, nettoyé ; undefined pour une cellule vide. */
export function texte(v: CelluleXlsx | undefined): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') return Number.isInteger(v) ? v.toFixed(0) : String(v);
  const t = String(v).replace(/\s+/g, ' ').trim();
  return t === '' ? undefined : t;
}

/**
 * Le squelette d'un texte, pour comparer : minuscules, sans accents, sans
 * ponctuation, espaces réduits. « Saint-Louis » et « SAINT LOUIS » ont le
 * même.
 */
export function squelette(t: string): string {
  return t
    .replace(/œ/gi, 'oe')
    .replace(/æ/gi, 'ae')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * La distance entre deux mots : lettres changées, ajoutées, retirées ou
 * interverties. « ziginchor » est à 1 de « ziguinchor ».
 */
export function distance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cout = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cout);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, d[i - 2]![j - 2]! + 1);
      }
      d[i]![j] = v;
    }
  }
  return d[m]![n]!;
}

/** L'écart toléré pour une faute de frappe : aucun sur un mot court. */
function tolerance(longueur: number): number {
  if (longueur <= 4) return 0;
  if (longueur <= 6) return 1;
  if (longueur <= 12) return 2;
  return 3;
}

/** « st louis » se lit « saint louis » : l'abréviation la plus courante. */
const sansAbreviations = (s: string) => s.replace(/\bste\b/g, 'sainte').replace(/\bst\b/g, 'saint');

export interface Option<T> {
  valeur: T;
  /** Le libellé juste, et les autres façons admises de l'écrire. */
  cles: string[];
  /** Ce qui se comprend, mais que l'aperçu signale comme une correction. */
  alias?: string[];
}

/**
 * La valeur d'une liste que désigne un texte du fichier.
 *
 * Dans l'ordre : l'écriture exacte, aux accents et à la casse près ; la même
 * sans les espaces (« non-cadre », « noncadre ») ; une faute de frappe, si un
 * seul libellé est assez proche ; un début de mot (« divor »), s'il n'en
 * désigne qu'un. `corrige` dit que l'aperçu doit montrer la correction : une
 * faute, une abréviation développée (« St Louis »), un alias.
 */
export function rapprocher<T>(
  brut: string,
  options: Option<T>[],
  { fautes = true, debut = true }: { fautes?: boolean; debut?: boolean } = {},
): { valeur: T; corrige: boolean } | null {
  const lu = squelette(brut);
  const s = sansAbreviations(lu);
  if (!s) return null;
  const compact = s.replace(/ /g, '');
  const cles = options.flatMap((o, rang) =>
    [
      ...o.cles.map((c) => [c, false] as const),
      ...(o.alias ?? []).map((c) => [c, true] as const),
    ].map(([c, alias]) => {
      const k = sansAbreviations(squelette(c));
      return { valeur: o.valeur, rang, k, compact: k.replace(/ /g, ''), alias };
    }),
  );
  const exact = cles.find((c) => c.k === s) ?? cles.find((c) => c.compact === compact);
  if (exact) {
    const tel = exact.k === lu || exact.compact === lu.replace(/ /g, '');
    return { valeur: exact.valeur, corrige: exact.alias || !tel };
  }
  if (fautes) {
    const seuil = tolerance(compact.length);
    if (seuil > 0) {
      const proches = cles
        .map((c) => ({ ...c, d: distance(compact, c.compact) }))
        .filter((c) => c.d <= seuil)
        .sort((a, b) => a.d - b.d);
      const meilleur = proches[0];
      if (meilleur) {
        const rivaux = proches.filter((p) => p.d === meilleur.d && p.rang !== meilleur.rang);
        if (rivaux.length === 0) return { valeur: meilleur.valeur, corrige: true };
      }
    }
  }
  if (debut && compact.length >= 4) {
    const rangs = new Set(cles.filter((c) => c.compact.startsWith(compact)).map((c) => c.rang));
    if (rangs.size === 1) {
      const [rang] = [...rangs];
      return { valeur: options[rang!]!.valeur, corrige: true };
    }
  }
  return null;
}

/* ───────────────────────── Dates ───────────────────────── */

export interface DateLue {
  iso: string;
  /** Connue au mois seulement (« sept. 2021 ») : le jour est le 1er. */
  auMois: boolean;
  /** Ce que le fichier écrivait, quand la lecture a dû l'interpréter. */
  interpretee: boolean;
}

const MOIS: Record<string, number> = {
  janvier: 1,
  janv: 1,
  jan: 1,
  fevrier: 2,
  fevr: 2,
  fev: 2,
  mars: 3,
  avril: 4,
  avr: 4,
  mai: 5,
  juin: 6,
  juillet: 7,
  juil: 7,
  aout: 8,
  septembre: 9,
  sept: 9,
  sep: 9,
  octobre: 10,
  oct: 10,
  novembre: 11,
  nov: 11,
  decembre: 12,
  dec: 12,
  // Un tableur réglé en anglais écrit « 01-Mar-04 ».
  january: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

const pad = (n: number) => String(n).padStart(2, '0');

/** Le jour existe-t-il ? Un 31 avril ne devient pas le 1er mai. */
function jourValide(a: number, m: number, j: number): boolean {
  const d = new Date(Date.UTC(a, m - 1, j));
  return d.getUTCFullYear() === a && d.getUTCMonth() === m - 1 && d.getUTCDate() === j;
}

/** Une année à deux chiffres : « 85 » est 1985, « 21 » est 2021. */
function annee(t: string, aujourdhui: string): number {
  const n = Number(t);
  if (t.length === 4) return n;
  const siecle = Number(aujourdhui.slice(2, 4));
  return n <= siecle + 1 ? 2000 + n : 1900 + n;
}

/**
 * Le numéro de série d'Excel, en date : une cellule au format « Nombre »
 * garde 44452 pour le 13 septembre 2021. L'origine est le 30 décembre 1899.
 */
export function dateDeSerie(serie: number): string {
  const d = new Date(Date.UTC(1899, 11, 30 + Math.floor(serie)));
  return d.toISOString().slice(0, 10);
}

function depuisChiffres(a: number, m: number, j: number): DateLue | { erreur: string } | null {
  if (jourValide(a, m, j))
    return { iso: `${a}-${pad(m)}-${pad(j)}`, auMois: false, interpretee: false };
  // 09/13/2021 : le mois et le jour inversés, à l'américaine.
  if (m > 12 && j <= 12 && jourValide(a, j, m)) {
    return { iso: `${a}-${pad(j)}-${pad(m)}`, auMois: false, interpretee: true };
  }
  return null;
}

/**
 * Une date, quelle que soit la façon dont le tableur l'a gardée : une vraie
 * date, un numéro de série (44452), du texte (13/09/2021, 13 septembre
 * 2021, 13-sept.-21, 2021-09-13), ou un mois seul (09/2021, sept. 2021,
 * sept.-21).
 */
export function lireDate(v: CelluleXlsx | undefined, aujourdhui: string): Lecture<DateLue> {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    return ok({ iso: v.toISOString().slice(0, 10), auMois: false, interpretee: false });
  }
  const t = typeof v === 'number' ? String(v) : String(v).replace(/\s+/g, ' ').trim();
  if (t === '') return null;
  const erreur = { erreur: `« ${t} » n’est pas une date` };

  if (/^\d{1,6}([.,]\d+)?$/.test(t)) {
    const n = Number(t.replace(',', '.'));
    if (Number.isInteger(n) && n >= 1900 && n <= 2100) {
      return { erreur: `« ${t} » : l’année seule ne suffit pas` };
    }
    if (n < 1 || n > 73050) return erreur;
    return ok({ iso: dateDeSerie(n), auMois: false, interpretee: true }, true);
  }

  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/.exec(t);
  if (iso) {
    const d = depuisChiffres(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    return d && !('erreur' in d) ? ok(d, d.interpretee) : erreur;
  }
  const fr = /^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2}|\d{4})$/.exec(t);
  if (fr) {
    const d = depuisChiffres(annee(fr[3]!, aujourdhui), Number(fr[2]), Number(fr[1]));
    return d && !('erreur' in d) ? ok(d, d.interpretee) : erreur;
  }
  const mot = squelette(t);
  // « 01-mars-04 » : le format jj-mmm-aa qu'Excel montre en français.
  const enLettres = /^(\d{1,2})(?: ?er)? ([a-z]+) (\d{2}|\d{4})$/.exec(mot);
  if (enLettres) {
    const m = MOIS[enLettres[2]!];
    const a = annee(enLettres[3]!, aujourdhui);
    if (m && jourValide(a, m, Number(enLettres[1]))) {
      return ok({
        iso: `${a}-${pad(m)}-${pad(Number(enLettres[1]))}`,
        auMois: false,
        interpretee: false,
      });
    }
    return erreur;
  }
  const moisSeul = /^(\d{1,2})[-/. ](\d{4})$/.exec(t) ?? null;
  if (moisSeul) {
    const m = Number(moisSeul[1]);
    if (m < 1 || m > 12) return erreur;
    return ok({ iso: `${moisSeul[2]}-${pad(m)}-01`, auMois: true, interpretee: false });
  }
  const moisEnLettres = /^([a-z]+) (\d{2}|\d{4})$/.exec(mot);
  if (moisEnLettres && MOIS[moisEnLettres[1]!]) {
    const m = MOIS[moisEnLettres[1]!]!;
    const a = annee(moisEnLettres[2]!, aujourdhui);
    return ok({ iso: `${a}-${pad(m)}-01`, auMois: true, interpretee: false });
  }
  return erreur;
}

/** Une date pour l'écran : 13/09/2021, ou « sept. 2021 » quand on ne sait que le mois. */
export function dateLisible(iso: string, auMois = false): string {
  const [a, m, j] = iso.split('-');
  if (!auMois) return `${j}/${m}/${a}`;
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('fr-FR', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** L'ancienneté en années : 5.1, « 5,1 », « 6 mois », « 2 ans ». */
export function lireAnciennete(v: CelluleXlsx | undefined): Lecture<number> {
  if (v === null || v === undefined || v instanceof Date) return null;
  if (typeof v === 'number') {
    return v >= 0 && v <= 60 ? ok(v) : { erreur: `« ${v} » n’est pas une ancienneté` };
  }
  const t = squelette(
    String(v)
      .replace(',', '.')
      .replace(/(\d)\.(\d)/, '$1p$2'),
  );
  if (!t) return null;
  const m = /^(\d+)(?:p(\d+))? ?(ans?|annees?|mois)?$/.exec(t);
  if (!m) return { erreur: `« ${String(v).trim()} » n’est pas une ancienneté` };
  const n = Number(`${m[1]}.${m[2] ?? '0'}`);
  const annees = m[3] === 'mois' ? n / 12 : n;
  return annees <= 60 ? ok(annees) : { erreur: `« ${String(v).trim()} » n’est pas une ancienneté` };
}

/**
 * La date d'entrée qu'une ancienneté laisse deviner, au mois près : 5,1 ans
 * avant novembre 2026 donnent octobre 2021. Le jour est le 1er, marqué « au
 * mois » : rien ne s'imprime au jour près tant que la DCH ne l'a pas précisé.
 */
export function entreeDepuisAnciennete(annees: number, aujourdhui: string): string {
  const [a, m] = aujourdhui.split('-').map(Number) as [number, number];
  const mois = a * 12 + (m - 1) - Math.round(annees * 12);
  return `${Math.floor(mois / 12)}-${pad((mois % 12) + 1)}-01`;
}

/** L'ancienneté, en années, qu'une date d'entrée donne aujourd'hui. */
export function ancienneteDe(iso: string, aujourdhui: string): number {
  const jours = (Date.parse(`${aujourdhui}T00:00:00Z`) - Date.parse(`${iso}T00:00:00Z`)) / 864e5;
  return jours / 365.25;
}

/* ─────────────────── Numéros et adresses ─────────────────── */

const MESSAGE_NUMERO_SN = 'Numéro sénégalais : 9 chiffres, commençant par 7 ou 3';

/**
 * Un téléphone, enregistré avec son indicatif : « 77 123 45 67 »,
 * « 771234567 », « 00221 77… » et « +221 77… » donnent tous +221771234567.
 * Une cellule à deux numéros garde le premier.
 */
export function lireTelephone(v: CelluleXlsx | undefined): Lecture<string> {
  const brut = texte(v);
  if (!brut) return null;
  const [premier, ...autres] = brut.split(/\s*(?:\/|;|,|\bou\b|\bet\b)\s*/i).filter(Boolean);
  if (!premier) return null;
  let n = premier.replace(/[\s.\-()]/g, '');
  if (n.startsWith('00')) n = `+${n.slice(2)}`;
  if (/^221[37]\d{8}$/.test(n)) n = `+${n}`;
  if (/^[37]\d{8}$/.test(n)) n = `+221${n}`;
  if (n.startsWith('+221')) {
    return /^\+221[37]\d{8}$/.test(n) ? ok(n, autres.length > 0) : { erreur: MESSAGE_NUMERO_SN };
  }
  if (n.startsWith('+')) {
    const etranger = parsePhoneNumberFromString(n);
    return etranger?.isValid()
      ? ok(etranger.number, autres.length > 0)
      : { erreur: `« ${premier} » n’est pas un numéro valide` };
  }
  return { erreur: MESSAGE_NUMERO_SN };
}

/** Le numéro de CNI : 13 chiffres, sans les espaces ni les tirets. */
export function lireCni(v: CelluleXlsx | undefined): Lecture<string> {
  const brut = texte(v);
  if (!brut) return null;
  const chiffres = brut.replace(/[\s.\-/]/g, '');
  if (/^\d{13}$/.test(chiffres)) return ok(chiffres);
  const n = chiffres.replace(/\D/g, '').length;
  return {
    erreur: /^\d+$/.test(chiffres)
      ? `Numéro CNI à ${n} chiffre${n > 1 ? 's' : ''} au lieu de 13`
      : `« ${brut} » n’est pas un numéro de CNI (13 chiffres)`,
  };
}

const COURRIEL = /^[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

/** Une adresse électronique, en minuscules, la première si la cellule en porte deux. */
export function lireCourriel(v: CelluleXlsx | undefined): Lecture<string> {
  const brut = texte(v);
  if (!brut) return null;
  const [premiere] = brut
    .toLowerCase()
    .replace(/^mailto:/, '')
    .split(/[\s;,/]+/)
    .filter(Boolean);
  if (!premiere || !COURRIEL.test(premiere)) {
    return { erreur: `« ${brut} » n’est pas une adresse électronique` };
  }
  return ok(premiere);
}

/**
 * L'adresse professionnelle se termine par le domaine de l'organisation. Une
 * faute sur le domaine (« apix.com », « apix.sm ») se corrige : c'est le seul
 * domaine possible.
 */
export function lireCourrielPro(v: CelluleXlsx | undefined): Lecture<string> {
  const lu = lireCourriel(v);
  if (!lu || 'erreur' in lu) return lu;
  const [local, domaine] = lu.valeur.split('@') as [string, string];
  if (domaine === DOMAINE_COURRIEL_PRO) return lu;
  const racine = DOMAINE_COURRIEL_PRO.split('.')[0]!;
  if (domaine.split('.')[0] === racine || distance(domaine, DOMAINE_COURRIEL_PRO) <= 2) {
    return ok(`${local}@${DOMAINE_COURRIEL_PRO}`, true);
  }
  return { erreur: `L’adresse professionnelle doit se terminer par @${DOMAINE_COURRIEL_PRO}` };
}

/**
 * Un montant en francs CFA, tel que la DCH l'écrit : 26000, « 26 000 »,
 * « 26.000 FCFA ». Les séparateurs de milliers et l'unité tombent.
 */
export function lireMontant(v: CelluleXlsx | undefined): Lecture<number> {
  if (v === null || v === undefined || v instanceof Date) return null;
  if (typeof v === 'number') {
    return Number.isFinite(v) && v >= 0 && v <= 1e9
      ? ok(Math.round(v))
      : { erreur: `« ${v} » n’est pas un montant` };
  }
  const brut = String(v).trim();
  if (!brut) return null;
  const chiffres = brut
    .replace(/\s|\u00a0|\u202f/g, '')
    .replace(/(?:f\.?cfa|xof|francs?|f)$/i, '')
    .replace(/[.,](?=\d{3}(?:$|[.,]))/g, '')
    .replace(',', '.');
  const n = Number(chiffres);
  if (!chiffres || !Number.isFinite(n) || n < 0 || n > 1e9) {
    return { erreur: `« ${brut} » n’est pas un montant` };
  }
  return ok(Math.round(n));
}

/** Un montant pour l'écran : 26 000 F CFA. */
export function montantLisible(n: number): string {
  return `${n.toLocaleString('fr-FR').replace(/\u202f|\u00a0/g, ' ')} F CFA`;
}

/** Le nombre de parts : de 1 à 5, par demi-part. « 2,5 » et « 2.5 parts » valent 2,5. */
export function lireParts(v: CelluleXlsx | undefined): Lecture<number> {
  const brut = texte(v);
  if (!brut) return null;
  const n =
    typeof v === 'number'
      ? v
      : Number(
          brut
            .toLowerCase()
            .replace(/\s*parts?$/, '')
            .replace(/\s/g, '')
            .replace(',', '.'),
        );
  return (NOMBRES_DE_PARTS as readonly number[]).includes(n)
    ? ok(n)
    : { erreur: `« ${brut} » n’est pas un nombre de parts (de 1 à 5, par demi-part)` };
}

/**
 * Les autres façons d'écrire une banque de la liste : le sigle, le nom en
 * entier, le groupe, l'ancien nom (la CNCAS est devenue La Banque Agricole).
 */
const AUTRES_NOMS_DES_BANQUES: Partial<Record<CodeDeBanque, string[]>> = {
  bci: ['Banque Commerciale Internationale'],
  bgfibank: ['BGFI'],
  bimao: ['Banque des Institutions Mutualistes d’Afrique de l’Ouest'],
  bnde: ['Banque Nationale pour le Développement Économique'],
  boa: ['Bank of Africa'],
  bsic: ['Banque Sahélo-Saharienne pour l’Investissement et le Commerce'],
  banque_islamique: ['BIS'],
  banque_habitat: ['BHS'],
  cbao: ['Attijariwafa bank', 'CBAO Attijariwafa bank', 'CBAO Groupe Attijariwafa bank'],
  coris_bank: ['Coris Bank International'],
  fbnbank: ['FBN Bank', 'First Bank'],
  banque_agricole: ['LBA', 'CNCAS'],
  banque_outarde: ['LBO'],
  sunu_bank: ['SUNU'],
  uba: ['United Bank for Africa'],
};

const OPTIONS_BANQUES: Option<CodeDeBanque>[] = BANQUES.map((b) => ({
  valeur: b.code,
  // « Banque Islamique du Sénégal » s'écrit aussi « Banque Islamique ».
  cles: [b.nom, b.nom.replace(/^La /, '').replace(/(?: du)? Sénégal$/, '')],
  alias: AUTRES_NOMS_DES_BANQUES[b.code] ?? [],
}));

/**
 * Une banque de la liste de la DCH (ADR-0102), par son nom ou son sigle,
 * fautes de frappe comprises. « Ecobank Sénégal » ou « UBA SA » désignent
 * Ecobank et UBA.
 */
export function lireBanque(v: CelluleXlsx | undefined): Lecture<CodeDeBanque> {
  const brut = texte(v);
  if (!brut) return null;
  const r = rapprocher(brut, OPTIONS_BANQUES);
  if (r) return ok(r.valeur, r.corrige);
  const court = brut
    .replace(/\s+(?:du\s+)?s[ée]n[ée]gal\b/giu, '')
    .replace(/\s+s\.?\s?a\.?$/i, '')
    .trim();
  const sansPays = court && court !== brut ? rapprocher(court, OPTIONS_BANQUES) : null;
  return sansPays
    ? ok(sansPays.valeur, true)
    : { erreur: `« ${brut} » n’est pas une banque de la liste` };
}

/**
 * Le RIB : « SN », puis vingt-deux chiffres, sans les espaces. Le « SN »
 * oublié revient, et un IBAN (SN, deux chiffres de contrôle, puis le RIB)
 * donne son RIB.
 */
export function lireRib(v: CelluleXlsx | undefined): Lecture<string> {
  if (typeof v === 'number') {
    return { erreur: 'Excel garde ce RIB comme un nombre, et en a perdu des chiffres' };
  }
  const brut = texte(v);
  if (!brut) return null;
  const s = brut.toUpperCase().replace(/[\s.\-/]/g, '');
  if (/^SN\d{22}$/.test(s)) return ok(s);
  if (/^\d{22}$/.test(s)) return ok(`SN${s}`, true);
  const iban = /^SN\d{2}(SN\d{22})$/.exec(s);
  if (iban) return ok(iban[1]!, true);
  return { erreur: `« ${brut} » n’est pas un RIB (SN, puis 22 chiffres)` };
}

/** La filiation : le prénom du père, le prénom et le nom de la mère. */
export interface Filiation {
  prenomDuPere: string;
  prenomDeLaMere?: string;
  nomDeLaMere?: string;
}

/**
 * La filiation, comme l'état civil l'écrit : « Fils de Moussa et de Awa
 * Diop », « Moussa Ndiaye et Awa Diop », « Moussa / Awa Diop ». Le père
 * vient d'abord, par son prénom seul : son nom de famille est celui de
 * l'agent. Puis la mère, son prénom et son nom. Un seul nom est celui du
 * père.
 * « Fils » ou « Fille » seul ne dit rien de plus que le sexe : la case
 * compte pour vide.
 */
export function lireFiliation(
  v: CelluleXlsx | undefined,
  nomDeFamille: string,
): Lecture<Filiation> {
  const brut = texte(v);
  if (!brut) return null;
  if (['fils', 'fille', 'fils fille'].includes(squelette(brut))) return null;
  const de = /^(?:de\s+|d['’]\s*)/iu;
  const noms = brut
    .replace(/^(?:fils|fille)(?:\s*\/\s*fille)?\s+/iu, '')
    .replace(de, '')
    .split(/\s+et\s+|\s*[/&;,+]\s*|\s+-\s+/iu)
    .map((n) => nomDePersonne(n.replace(de, '')))
    .filter(Boolean);
  if (noms.length === 0 || noms.length > 2) {
    return {
      erreur: `« ${brut} » ne se lit pas (le père, puis la mère, séparés par « et »)`,
    };
  }
  const [pere, mere] = noms as [string, string | undefined];
  // Le nom de famille du père est celui de l'agent : seul le prénom reste.
  const motsDuPere = pere.split(' ');
  const motsDuNom = nomDeFamille.split(' ');
  const finit =
    motsDuPere.length > motsDuNom.length &&
    squelette(motsDuPere.slice(-motsDuNom.length).join(' ')) === squelette(nomDeFamille);
  const filiation: Filiation = {
    prenomDuPere: finit ? motsDuPere.slice(0, -motsDuNom.length).join(' ') : pere,
  };
  if (mere) {
    const mots = mere.split(' ');
    if (mots.length === 1) {
      filiation.prenomDeLaMere = mere;
    } else {
      filiation.prenomDeLaMere = mots.slice(0, -1).join(' ');
      filiation.nomDeLaMere = mots.at(-1)!;
    }
  }
  return ok(filiation);
}

/** Un nombre entier positif : enfants, épouses. « néant » et « aucun » valent 0. */
export function lireEntier(v: CelluleXlsx | undefined, max: number): Lecture<number> {
  const brut = texte(v);
  if (!brut) return null;
  if (['neant', 'aucun', 'aucune', 'pas', 'non'].includes(squelette(brut)) || brut === '-') {
    return ok(0);
  }
  const n = Number(brut.replace(',', '.'));
  if (!Number.isInteger(n) || n < 0 || n > max) {
    return { erreur: `« ${brut} » n’est pas un nombre entier entre 0 et ${max}` };
  }
  return ok(n);
}

/* ───────────────────── Listes de valeurs ───────────────────── */

const SEXES: Option<Gender>[] = [
  { valeur: 'male', cles: ['M', 'H', 'Homme', 'Masculin', 'Masc', 'Male'] },
  { valeur: 'female', cles: ['F', 'Femme', 'Féminin', 'Fem', 'Female'] },
];
export const LIBELLES_SEXE: Record<Gender, string> = { male: 'Homme', female: 'Femme' };

export function lireSexe(v: CelluleXlsx | undefined): Lecture<Gender> {
  const brut = texte(v);
  if (!brut) return null;
  const r = rapprocher(brut, SEXES, { debut: false });
  return r ? ok(r.valeur, r.corrige) : { erreur: `« ${brut} » n’est ni M ni F` };
}

const SITUATIONS: Option<MaritalStatus>[] = [
  { valeur: 'single', cles: ['Célibataire', 'Célib'] },
  { valeur: 'married', cles: ['Marié(e)', 'Marié', 'Mariée', 'Mariés'] },
  { valeur: 'divorced', cles: ['Divorcé(e)', 'Divorcé', 'Divorcée'] },
  { valeur: 'widowed', cles: ['Veuf ou veuve', 'Veuf', 'Veuve', 'Veuf(ve)', 'Veuf(veuve)'] },
];

export function lireSituation(v: CelluleXlsx | undefined): Lecture<MaritalStatus> {
  const brut = texte(v);
  if (!brut) return null;
  const r = rapprocher(brut, SITUATIONS);
  return r
    ? ok(r.valeur, r.corrige)
    : { erreur: `« ${brut} » : attendu Marié(e), Célibataire, Veuf ou veuve, Divorcé(e)` };
}

const STATUTS: Option<Personnel>[] = [
  { valeur: 'cadre', cles: ['Cadre', 'Cadres'], alias: ['Cadre supérieur', 'Cadre moyen'] },
  {
    valeur: 'non_cadre',
    cles: ['Non-cadre', 'Non cadre', 'Non-cadres'],
    alias: ['NC', 'Agent non cadre'],
  },
];

export function lireStatut(v: CelluleXlsx | undefined): Lecture<Personnel> {
  const brut = texte(v);
  if (!brut) return null;
  const r = rapprocher(brut, STATUTS, { debut: false });
  return r ? ok(r.valeur, r.corrige) : { erreur: `« ${brut} » n’est ni Cadre ni Non cadre` };
}

const CONTRATS: Option<'cdi' | 'cdd' | 'autre'>[] = [
  {
    valeur: 'cdi',
    cles: ['CDI', 'Contrat à durée indéterminée', 'Durée indéterminée', 'Indéterminée'],
  },
  { valeur: 'cdd', cles: ['CDD', 'Contrat à durée déterminée', 'Durée déterminée', 'Déterminée'] },
  {
    valeur: 'autre',
    cles: ['Stage', 'Stagiaire', 'Consultant', 'Prestataire', 'Détachement', 'Détaché', 'Intérim'],
  },
];

export function lireContrat(v: CelluleXlsx | undefined): Lecture<'cdi' | 'cdd'> {
  const brut = texte(v);
  if (!brut) return null;
  const r = rapprocher(brut, CONTRATS, { debut: false });
  if (!r || r.valeur === 'autre') {
    return { erreur: `« ${brut} » : seuls les CDD et les CDI s’importent` };
  }
  return ok(r.valeur, r.corrige);
}

const LIENS: Option<LienDeParente>[] = [
  { valeur: 'pere', cles: ['Père'], alias: ['Papa'] },
  { valeur: 'mere', cles: ['Mère'], alias: ['Maman'] },
  {
    valeur: 'conjoint',
    cles: ['Conjoint(e)', 'Conjoint', 'Conjointe'],
    alias: ['Époux', 'Épouse', 'Mari', 'Femme'],
  },
  { valeur: 'frere', cles: ['Frère'], alias: ['Grand frère', 'Petit frère', 'Frère aîné'] },
  { valeur: 'soeur', cles: ['Sœur'], alias: ['Grande sœur', 'Petite sœur', 'Sœur aînée'] },
  { valeur: 'enfant', cles: ['Enfant'], alias: ['Fils', 'Fille'] },
  { valeur: 'ami', cles: ['Ami(e)', 'Ami', 'Amie'], alias: ['Amis', 'Copain', 'Copine'] },
  {
    valeur: 'autre',
    cles: ['Autre'],
    alias: [
      'Oncle',
      'Tante',
      'Cousin',
      'Cousine',
      'Neveu',
      'Nièce',
      'Grand-père',
      'Grand-mère',
      'Beau-frère',
      'Belle-sœur',
      'Beau-père',
      'Belle-mère',
      'Tuteur',
      'Tutrice',
      'Voisin',
      'Voisine',
      'Collègue',
    ],
  },
];

export function lireLien(v: CelluleXlsx | undefined): Lecture<LienDeParente> {
  const brut = texte(v);
  if (!brut) return null;
  const r = rapprocher(brut, LIENS);
  return r
    ? ok(r.valeur, r.corrige)
    : { erreur: `« ${brut} » n’est pas un lien de parenté de la liste` };
}

/* ─────────────────── Régions, villes, pays ─────────────────── */

/**
 * Les départements du Sénégal et quelques grandes villes, avec leur région :
 * de quoi écrire une ville avec ses accents, et retrouver la région quand le
 * fichier y a mis une ville (« Rufisque » est dans la région de Dakar).
 */
const VILLES: [string, Region][] = [
  ['Dakar', 'dakar'],
  ['Guédiawaye', 'dakar'],
  ['Pikine', 'dakar'],
  ['Rufisque', 'dakar'],
  ['Keur Massar', 'dakar'],
  ['Bargny', 'dakar'],
  ['Diamniadio', 'dakar'],
  ['Sébikotane', 'dakar'],
  ['Yeumbeul', 'dakar'],
  ['Thiaroye', 'dakar'],
  ['Mbao', 'dakar'],
  ['Bambey', 'diourbel'],
  ['Diourbel', 'diourbel'],
  ['Mbacké', 'diourbel'],
  ['Touba', 'diourbel'],
  ['Fatick', 'fatick'],
  ['Foundiougne', 'fatick'],
  ['Gossas', 'fatick'],
  ['Birkelane', 'kaffrine'],
  ['Kaffrine', 'kaffrine'],
  ['Koungheul', 'kaffrine'],
  ['Malem-Hodar', 'kaffrine'],
  ['Guinguinéo', 'kaolack'],
  ['Kaolack', 'kaolack'],
  ['Nioro du Rip', 'kaolack'],
  ['Kédougou', 'kedougou'],
  ['Salémata', 'kedougou'],
  ['Saraya', 'kedougou'],
  ['Kolda', 'kolda'],
  ['Médina Yoro Foulah', 'kolda'],
  ['Vélingara', 'kolda'],
  ['Kébémer', 'louga'],
  ['Linguère', 'louga'],
  ['Louga', 'louga'],
  ['Kanel', 'matam'],
  ['Matam', 'matam'],
  ['Ranérou', 'matam'],
  ['Ourossogui', 'matam'],
  ['Dagana', 'saint_louis'],
  ['Podor', 'saint_louis'],
  ['Saint-Louis', 'saint_louis'],
  ['Richard-Toll', 'saint_louis'],
  ['Bounkiling', 'sedhiou'],
  ['Goudomp', 'sedhiou'],
  ['Sédhiou', 'sedhiou'],
  ['Bakel', 'tambacounda'],
  ['Goudiry', 'tambacounda'],
  ['Koumpentoum', 'tambacounda'],
  ['Tambacounda', 'tambacounda'],
  ['Mbour', 'thies'],
  ['Thiès', 'thies'],
  ['Tivaouane', 'thies'],
  ['Joal-Fadiouth', 'thies'],
  ['Saly', 'thies'],
  ['Diass', 'thies'],
  ['Sandiara', 'thies'],
  ['Bignona', 'ziguinchor'],
  ['Oussouye', 'ziguinchor'],
  ['Ziguinchor', 'ziguinchor'],
];

const OPTIONS_REGIONS: Option<Region>[] = REGIONS.map((r) => ({
  valeur: r,
  cles: [LIBELLES_REGION[r]],
}));

/**
 * La région : l'une des quatorze. « St Louis » donne Saint-Louis,
 * « Ziginchor » Ziguinchor, et une ville la région où elle se trouve.
 */
export function lireRegion(v: CelluleXlsx | undefined): Lecture<Region> {
  const brut = texte(v);
  if (!brut) return null;
  const r = rapprocher(brut, OPTIONS_REGIONS, { debut: false });
  if (r) return ok(r.valeur, r.corrige);
  const ville = rapprocher(
    brut,
    VILLES.map(([nom, region]) => ({ valeur: region, cles: [nom] })),
    { debut: false },
  );
  if (ville) return ok(ville.valeur, true);
  // « Dakar Plateau » : une seule région nommée dans le texte.
  const mots = new Set(sansAbreviations(squelette(brut)).split(' '));
  const nommees = REGIONS.filter((reg) =>
    sansAbreviations(squelette(LIBELLES_REGION[reg]))
      .split(' ')
      .every((m) => mots.has(m)),
  );
  if (nommees.length === 1) return ok(nommees[0]!, true);
  return { erreur: `« ${brut} » n’est pas une région du Sénégal` };
}

/** Les mots qui restent en minuscules au milieu d'un nom de lieu. */
const PETITS_MOTS = new Set([
  'de',
  'du',
  'des',
  'la',
  'le',
  'les',
  'et',
  'en',
  'à',
  'a',
  'au',
  'aux',
  'sur',
  'sous',
  'l',
  'd',
]);

/** Une capitale à chaque mot, et après un trait d'union ou une apostrophe. */
function capitales(t: string, petits = false): string {
  return t
    .toLowerCase()
    .split(' ')
    .map((mot, i) =>
      petits && i > 0 && PETITS_MOTS.has(mot)
        ? mot
        : mot.replace(/(^|[-'’])(\p{L})/gu, (_, sep: string, l: string) => sep + l.toUpperCase()),
    )
    .join(' ');
}

/** Tout en capitales : le fichier ne dit pas comment s'écrit le mot. */
const enCapitales = (t: string) => t === t.toUpperCase() && /\p{Lu}/u.test(t);

/**
 * Un nom de personne : « NDEYE FATOU » devient Ndeye Fatou, « N'DIAYE »
 * N'Diaye. Les accents ne se devinent pas : la DCH les ajoute sur la fiche.
 * Un nom déjà écrit en minuscules et capitales est gardé tel quel.
 */
export function nomDePersonne(brut: string): string {
  const t = brut.replace(/\s+/g, ' ').trim();
  return enCapitales(t) ? capitales(t) : t;
}

/**
 * Une ville : avec ses accents quand on la connaît (« THIES » donne Thiès),
 * sinon une capitale à chaque mot.
 */
export function nomDeVille(brut: string): { valeur: string; corrige: boolean } {
  const t = brut.replace(/\s+/g, ' ').trim();
  const connue = rapprocher(
    t,
    VILLES.map(([nom]) => ({ valeur: nom, cles: [nom] })),
    { debut: false, fautes: squelette(t).length >= 7 },
  );
  if (connue) return connue;
  return { valeur: enCapitales(t) ? accentuer(capitales(t, true)) : t, corrige: false };
}

/** Une adresse : une capitale à chaque mot quand le fichier l'écrit tout en capitales. */
export function adresse(brut: string): string {
  const t = brut.replace(/\s+/g, ' ').trim();
  return enCapitales(t) ? accentuer(capitales(t, true)) : t;
}

/** Les pays de la plateforme, par leur nom français, et la nationalité qui s'y rattache. */
const PAYS: Option<string>[] = (() => {
  const noms = new Intl.DisplayNames(['fr'], { type: 'region' });
  const alias: Record<string, string[]> = {
    CD: ['RDC', 'Congo RDC', 'République démocratique du Congo'],
    CG: ['Congo Brazzaville', 'République du Congo'],
    GN: ['Guinée Conakry'],
    US: ['USA', 'États-Unis d’Amérique'],
    GB: ['Royaume Uni', 'Angleterre', 'Grande-Bretagne'],
    CI: ['Côte d’Ivoire', 'Cote d Ivoire'],
    CV: ['Cap Vert'],
  };
  return Object.keys(NATIONALITY_LABELS)
    .map((code): Option<string> | null => {
      const nom = noms.of(code);
      return nom && nom !== code
        ? { valeur: nom, cles: [nom], alias: [NATIONALITY_LABELS[code]!, ...(alias[code] ?? [])] }
        : null;
    })
    .filter((o): o is Option<string> => o !== null);
})();

/** Le pays de naissance, tel que la fiche l'écrit (« Sénégal »). */
export function lirePays(v: CelluleXlsx | undefined): Lecture<string> {
  const brut = texte(v);
  if (!brut) return null;
  const r = rapprocher(brut, PAYS, { debut: false });
  return r ? ok(r.valeur, r.corrige) : { erreur: `« ${brut} » n’est pas un pays de la liste` };
}

/* ───────────────────────── Postes ───────────────────────── */

/**
 * Les accents des mots qu'on trouve dans un intitulé de poste ou d'unité :
 * le fichier les écrit en capitales, sans accents.
 */
const ACCENTS: Record<string, string> = Object.fromEntries(
  [
    'activité',
    'activités',
    'agrément',
    'agréments',
    'aménagement',
    'aménagements',
    'attaché',
    'attachée',
    'bâtiment',
    'bâtiments',
    'budgétaire',
    'caissière',
    'carrière',
    'carrières',
    'catégorie',
    'catégories',
    'chargé',
    'chargée',
    'chargées',
    'chargés',
    'cité',
    'collectivités',
    'compétence',
    'compétences',
    'compétitivité',
    'comptabilité',
    'conformité',
    'conseillère',
    'contrôle',
    'contrôleur',
    'contrôleurs',
    'contrôleuse',
    'coopération',
    'coursière',
    'création',
    'cuisinière',
    'cybersécurité',
    'délégation',
    'délégué',
    'déléguée',
    'délégués',
    'déontologie',
    'département',
    'développement',
    'développeur',
    'développeurs',
    'développeuse',
    'données',
    'échelle',
    'échelon',
    'économie',
    'économique',
    'économiques',
    'économiste',
    'élaboration',
    'électricien',
    'électricienne',
    'électriciens',
    'électricité',
    'électrique',
    'électronique',
    'électroniques',
    'énergétique',
    'énergie',
    'entité',
    'entités',
    'équipe',
    'équipement',
    'équipements',
    'équipes',
    'étage',
    'État',
    'états',
    'éthique',
    'étude',
    'études',
    'évaluateur',
    'évaluation',
    'évaluatrice',
    'événement',
    'événementiel',
    'événements',
    'exécution',
    'extérieur',
    'extérieure',
    'extérieures',
    'financière',
    'fiscalité',
    'foncière',
    'foncières',
    'formalités',
    'général',
    'générale',
    'généraux',
    'génie',
    'géographie',
    'géographique',
    'géomatique',
    'hiérarchie',
    'hiérarchique',
    'hôtesse',
    'hygiène',
    'immobilière',
    'immobilières',
    'infirmière',
    'ingénierie',
    'ingénieur',
    'ingénieure',
    'ingénieurs',
    'intégrité',
    'intérieur',
    'intérieure',
    'intérimaire',
    'interprète',
    'libération',
    'marché',
    'marchés',
    'matériel',
    'matériels',
    'mécanicien',
    'mécanicienne',
    'mécaniciens',
    'mécanique',
    'médecin',
    'médecins',
    'médias',
    'médical',
    'médicale',
    'médicaux',
    'ménage',
    'ménagère',
    'méthode',
    'méthodes',
    'métier',
    'métiers',
    'mobilité',
    'multimédia',
    'négociation',
    'négociations',
    'numérique',
    'opérateur',
    'opérateurs',
    'opération',
    'opérationnel',
    'opérationnelle',
    'opérations',
    'opératrice',
    'opératrices',
    'pétrole',
    'pôle',
    'président',
    'présidente',
    'prévention',
    'privé',
    'privée',
    'privées',
    'privés',
    'procédés',
    'procédure',
    'procédures',
    'propriété',
    'qualité',
    'réception',
    'réceptionniste',
    'rédacteur',
    'rédactrice',
    'référent',
    'référente',
    'réforme',
    'réformes',
    'région',
    'régional',
    'régionale',
    'régionaux',
    'régions',
    'réglementaire',
    'réglementation',
    'réseau',
    'réseaux',
    'résidence',
    'responsabilité',
    'responsabilités',
    'santé',
    'secrétaire',
    'secrétaires',
    'secrétariat',
    'sécurité',
    'sociétal',
    'sociétale',
    'sociétales',
    'société',
    'spécial',
    'spéciale',
    'spéciales',
    'spécialisé',
    'spécialisée',
    'spécialiste',
    'spécialistes',
    'spéciaux',
    'stratégie',
    'stratégies',
    'stratégique',
    'stratégiques',
    'sûreté',
    'système',
    'systèmes',
    'télécommunication',
    'télécommunications',
    'téléphonie',
    'télévision',
    'trésorerie',
    'trésorier',
    'trésorière',
    'unité',
    'unités',
    'vidéo',
  ].map((mot) => [squelette(mot), mot]),
);

/** Remet les accents des mots connus, mot à mot, en gardant la capitale initiale. */
export function accentuer(t: string): string {
  return t.replace(/\p{L}+/gu, (mot) => {
    const juste = ACCENTS[squelette(mot)];
    if (!juste) return mot;
    return /^\p{Lu}/u.test(mot) ? juste.charAt(0).toUpperCase() + juste.slice(1) : juste;
  });
}

/** Les sigles qui restent en capitales dans un intitulé. */
const SIGLES_COURANTS = [
  'APIX',
  'DG',
  'DGA',
  'SG',
  'RH',
  'DRH',
  'DAF',
  'DSI',
  'SI',
  'IT',
  'TIC',
  'NTIC',
  'PME',
  'PMI',
  'ONG',
  'BTP',
  'ZES',
  'IPRES',
  'CSS',
  'PPP',
  'SIG',
  'ERP',
  'RSE',
  'QHSE',
  'HSE',
  'BI',
  'CRM',
  'IDE',
  'API',
  'PSE',
  'UEMOA',
  'CEDEAO',
  'OHADA',
  'ZFID',
  'ORFA',
];

/**
 * Des mots courants des intitulés qui s'écrivent sans accent : connus, ils
 * ne passent pas pour des fautes, et une faute sur l'un d'eux se corrige
 * (« RECOUVREMMENT »).
 */
const MOTS_SANS_ACCENT = new Set([
  'accompagnement',
  'accueil',
  'achats',
  'administratif',
  'administration',
  'administrative',
  'affaires',
  'agent',
  'agents',
  'analyse',
  'analyste',
  'animation',
  'appui',
  'archivage',
  'archives',
  'archiviste',
  'assistant',
  'assistante',
  'assurance',
  'audiovisuel',
  'audit',
  'auditeur',
  'auditrice',
  'budget',
  'bureau',
  'cabinet',
  'cadre',
  'caisse',
  'caissier',
  'chauffeur',
  'commercial',
  'commerciale',
  'communication',
  'comptable',
  'conception',
  'conducteur',
  'conseil',
  'conseiller',
  'consultant',
  'contentieux',
  'coordination',
  'coordonnateur',
  'coordonnatrice',
  'correspondance',
  'courrier',
  'coursier',
  'croissance',
  'digital',
  'digitale',
  'digitalisation',
  'directeur',
  'direction',
  'directrice',
  'documentaliste',
  'documentation',
  'emploi',
  'entreprise',
  'entreprises',
  'environnement',
  'environnemental',
  'environnementale',
  'exploitation',
  'facilitation',
  'finance',
  'financement',
  'finances',
  'financier',
  'fiscal',
  'fiscale',
  'foncier',
  'formation',
  'formulation',
  'gardien',
  'gestion',
  'gestionnaire',
  'graphiste',
  'guichet',
  'habitat',
  'immobilier',
  'impact',
  'incitations',
  'informaticien',
  'informatique',
  'infrastructure',
  'infrastructures',
  'innovation',
  'institutionnel',
  'institutionnelle',
  'intelligence',
  'interne',
  'investissement',
  'investissements',
  'investisseurs',
  'juridique',
  'juriste',
  'logistique',
  'maintenance',
  'management',
  'marketing',
  'mobilisation',
  'moyens',
  'observatoire',
  'organisation',
  'partenariat',
  'partenariats',
  'patrimoine',
  'performance',
  'personnel',
  'planification',
  'planton',
  'portefeuille',
  'production',
  'programme',
  'programmes',
  'projet',
  'projets',
  'promotion',
  'prospection',
  'prospective',
  'protocole',
  'publique',
  'publiques',
  'recherche',
  'recouvrement',
  'recrutement',
  'relations',
  'reporting',
  'ressources',
  'risques',
  'salaires',
  'service',
  'services',
  'stagiaire',
  'standardiste',
  'statistique',
  'statistiques',
  'suivi',
  'superviseur',
  'support',
  'surface',
  'technicien',
  'technicienne',
  'technique',
  'techniques',
  'territorial',
  'territoriale',
  'tourisme',
  'transport',
  'urbain',
  'urbaine',
  'urbanisme',
  'valorisation',
  'veille',
]);

/** Tous les mots connus des intitulés, avec leur écriture juste. */
const DICTIONNAIRE: [string, string][] = [
  ...Object.entries(ACCENTS),
  ...[...MOTS_SANS_ACCENT].map((m): [string, string] => [m, m]),
];

/**
 * Le mot connu qu'une faute de frappe a déformé : « GENEREAUX » pour
 * généraux, « RECOUVREMMENT » pour recouvrement. Une seule lettre de trop,
 * de moins, changée ou intervertie, jamais dans les deux dernières : c'est
 * là que s'écrivent le pluriel et le féminin (« urbaines » reste urbaines,
 * « financiers » ne devient pas financière). Un mot court, ou proche de deux
 * mots connus, n'est pas corrigé.
 */
function motCorrige(cle: string): string | undefined {
  if (cle.length < 7) return undefined;
  let trouve: string | undefined;
  for (const [k, juste] of DICTIONNAIRE) {
    if (Math.abs(k.length - cle.length) > 1 || k.slice(-2) !== cle.slice(-2)) continue;
    if (distance(k, cle) !== 1) continue;
    if (trouve && trouve !== juste) return undefined;
    trouve = juste;
  }
  return trouve;
}

/** Les villes d'un seul mot, pour leur capitale dans un intitulé (« ZES Diass »). */
const VILLES_D_UN_MOT = new Map(
  VILLES.filter(([nom]) => !/[\s-]/.test(nom)).map(([nom]) => [squelette(nom), nom]),
);

/**
 * Les mots de trois lettres au plus qui ne sont pas des sigles. Dans un nom
 * d'unité, tout autre mot aussi court en est un : « SERVICE BCE ».
 */
const MOTS_COURTS = new Set([
  'a',
  'air',
  'an',
  'ans',
  'art',
  'au',
  'aux',
  'axe',
  'bac',
  'bas',
  'bio',
  'bus',
  'cas',
  'ce',
  'ces',
  'cet',
  'com',
  'd',
  'dev',
  'de',
  'des',
  'du',
  'eau',
  'eco',
  'en',
  'est',
  'et',
  'fer',
  'fin',
  'gaz',
  'ile',
  'job',
  'l',
  'la',
  'lab',
  'le',
  'les',
  'lot',
  'mer',
  'net',
  'nom',
  'ou',
  'par',
  'pas',
  'pro',
  'pub',
  'sa',
  'se',
  'sel',
  'ses',
  'sol',
  'son',
  'sud',
  'sur',
  'tri',
  'un',
  'une',
  'vie',
  'web',
  'y',
]);

/** Un mot d'intitulé écrit en capitales, tel qu'on l'écrit dans une phrase. */
function motDIntitule(m: string, garder: ReadonlySet<string>): string {
  const haut = m.toUpperCase();
  if (garder.has(haut)) return haut;
  // « NIVEAU III » : un chiffre romain reste en capitales.
  if (/^[IVX]{2,4}$/.test(haut)) return haut;
  // « ES » est un « des » écorné.
  if (m === 'ES') return 'des';
  // Aucun mot français ne triple une lettre : « PORTEFEUILLLE ».
  const bas = m.toLowerCase().replace(/(\p{L})\1{2,}/gu, '$1$1');
  const cle = squelette(bas);
  if (MOTS_SANS_ACCENT.has(cle)) return bas;
  const connu = ACCENTS[cle] ?? VILLES_D_UN_MOT.get(cle) ?? motCorrige(cle);
  if (connu) return connu;
  if (cle.length <= 3 && !MOTS_COURTS.has(cle)) return haut;
  return bas;
}

/**
 * Les abréviations d'un intitulé tenu à la main, développées avant la mise
 * en forme : « CHEF DEPART. TECHNIQUE », « CHARGE DES SYST. ELEC DE GESTION
 * DES MARCHES PCS. », « SPV APIX.SA ».
 */
function sansAbreviationsDIntitule(t: string): string {
  return t
    .replace(/(^|\s)(?:DEPART|DEPT|DPT)\.\s*/gi, '$1DÉPARTEMENT ')
    .replace(/(^|\s)(?:DEPT|DPT)(?=\s|$)/gi, '$1DÉPARTEMENT')
    .replace(/(^|\s)(DES|LES)\s+SYST\.?\s+ELEC\.?(?=\s|$)/gi, '$1$2 SYSTÈMES ÉLECTRONIQUES')
    .replace(/(^|\s)SYST\.?\s+ELEC\.?(?=\s|$)/gi, '$1SYSTÈME ÉLECTRONIQUE')
    .replace(/(^|\s)(DES|LES)\s+SYST\.(?=\s|$)/gi, '$1$2 SYSTÈMES')
    .replace(/(^|\s)SYST\.(?=\s|$)/gi, '$1SYSTÈME')
    .replace(/[\s.]+$/, '');
}

/** Les villes de plusieurs mots : « SAINT LOUIS » s'écrit Saint-Louis. */
const VILLES_DE_PLUSIEURS_MOTS = VILLES.filter(([nom]) => /[\s-]/.test(nom)).map(
  ([nom]): [RegExp, string] => [
    new RegExp(`(^|[\\s(])${squelette(nom).split(' ').join('[\\s-]+')}(?=$|[\\s),.;:])`, 'gi'),
    nom,
  ],
);

/** Les villes, pour « bureau régional de Kaolack » : des lettres, des espaces et des tirets. */
const NOMS_DE_VILLES = VILLES.map(([nom]) => nom).join('|');

/**
 * Les expressions d'un intitulé qui s'écrivent d'une seule façon : la
 * passation des marchés, les relations presse, le chauffeur-coursier, le
 * back-office, le chef du bureau régional de Kaolack.
 */
const EXPRESSIONS: [RegExp, string][] = [
  [/\bpassation (?:de |des )?marchés\b/g, 'passation des marchés'],
  [/\brelation presse\b/g, 'relations presse'],
  [/\bchauffeur[\s-]+coursier\b/g, 'chauffeur-coursier'],
  [/\bback office\b/g, 'back-office'],
  [/\bchef (bureau|centre|département|pôle|service)\b/g, 'chef du $1'],
  [new RegExp(`\\b(régionale?) ((?:${NOMS_DE_VILLES}))(?=$|[\\s),.;:])`, 'gu'), '$1 de $2'],
  [/\b(régionale?) de ([AEIOUYÉÈ])/gu, '$1 d’$2'],
];

/**
 * Un intitulé de poste ou d'unité tel qu'on l'écrit : « CHARGE D'ETUDES »
 * devient Chargé d'études. La première lettre en capitale, les sigles en
 * capitales (connus, ou de trois lettres au plus quand ce ne sont pas des
 * mots : « SERVICE BCE », « PROJET TER »), les villes avec la leur, le reste
 * en minuscules avec ses accents. Une faute de frappe sur un mot connu est
 * corrigée, les abréviations sont développées, et l'apostrophe perdue
 * revient (« D ENTREPRISE », d’entreprise). Un intitulé déjà écrit en
 * minuscules et capitales est gardé.
 */
export function intitule(brut: string, sigles: ReadonlySet<string> = new Set()): string {
  const t = brut.replace(/\s+/g, ' ').trim();
  if (!enCapitales(t)) return t;
  const garder = new Set([...SIGLES_COURANTS, ...[...sigles].map((s) => s.toUpperCase())]);
  let rendu = sansAbreviationsDIntitule(t)
    .replace(/\p{L}+/gu, (m) => motDIntitule(m, garder))
    .replace(/(^|[\s(])([dl]) (?=[aeiouyhàâäéèêëîïôöûüœ])/giu, '$1$2’')
    // « CATEGORIE A » garde sa lettre ; ailleurs, « A » a perdu son accent.
    .replace(
      /\b(catégorie|classe|échelle|grade|groupe|hiérarchie|niveau) ([a-z])\b/giu,
      (_, mot: string, lettre: string) => `${mot} ${lettre.toUpperCase()}`,
    )
    .replace(/(^|\s)a(?=\s)/g, '$1à')
    // « APIX.SA » : la forme de la société, derrière son sigle.
    .replace(/\b([A-Z]{2,})[.\s]sa\b/g, '$1 SA')
    // « PLI SUD » : un point cardinal derrière un sigle nomme un lieu.
    .replace(
      /\b([A-Z]{2,}) (sud|nord|est|ouest|centre)\b/g,
      (_, sigle: string, point: string) =>
        `${sigle} ${point.charAt(0).toUpperCase()}${point.slice(1)}`,
    );
  for (const [motif, juste] of VILLES_DE_PLUSIEURS_MOTS) {
    rendu = rendu.replace(motif, (_, avant: string) => `${avant}${juste}`);
  }
  for (const [motif, juste] of EXPRESSIONS) rendu = rendu.replace(motif, juste);
  return rendu.charAt(0).toUpperCase() + rendu.slice(1);
}

/* ─────────────────── L'intitulé, accordé à la personne ─────────────────── */

/**
 * Les métiers et leur féminin : « Assistant RH » devient Assistante RH pour
 * une femme, « Assistante de direction » Assistant de direction pour un
 * homme. « Agent » reste tel quel.
 */
const METIERS: [string, string][] = [
  ['administrateur', 'administratrice'],
  ['assistant', 'assistante'],
  ['attaché', 'attachée'],
  ['auditeur', 'auditrice'],
  ['caissier', 'caissière'],
  ['chauffeur', 'chauffeuse'],
  ['chauffeur-coursier', 'chauffeuse-coursière'],
  ['chef', 'cheffe'],
  ['conseiller', 'conseillère'],
  ['consultant', 'consultante'],
  ['contrôleur', 'contrôleuse'],
  ['coordinateur', 'coordinatrice'],
  ['coordonnateur', 'coordonnatrice'],
  ['coursier', 'coursière'],
  ['cuisinier', 'cuisinière'],
  ['développeur', 'développeuse'],
  ['directeur', 'directrice'],
  ['électricien', 'électricienne'],
  ['gardien', 'gardienne'],
  ['infirmier', 'infirmière'],
  ['informaticien', 'informaticienne'],
  ['ingénieur', 'ingénieure'],
  ['mécanicien', 'mécanicienne'],
  ['monteur', 'monteuse'],
  ['opérateur', 'opératrice'],
  ['président', 'présidente'],
  ['rédacteur', 'rédactrice'],
  ['superviseur', 'superviseure'],
  ['technicien', 'technicienne'],
  ['trésorier', 'trésorière'],
];

/**
 * Les mots qui s'accordent seulement quand ils suivent le métier : « Ingénieur
 * financier », mais « Chef de marché financier ».
 */
const ACCORDS: [string, string][] = [
  ['adjoint', 'adjointe'],
  ['administratif', 'administrative'],
  ['chargé', 'chargée'],
  ['commercial', 'commerciale'],
  ['délégué', 'déléguée'],
  ['évaluateur', 'évaluatrice'],
  ['financier', 'financière'],
  ['général', 'générale'],
  ['principal', 'principale'],
  ['régional', 'régionale'],
  ['spécial', 'spéciale'],
];

/** Les mots qui ne changent pas au féminin : l'accord continue après eux. */
const EPICENES = new Set([
  'analyste',
  'archiviste',
  'comptable',
  'documentaliste',
  'économiste',
  'électrique',
  'gestionnaire',
  'graphiste',
  'informatique',
  'interne',
  'juridique',
  'juriste',
  'logistique',
  'manager',
  'réceptionniste',
  'responsable',
  'sanitaire',
  'secrétaire',
  'sociologue',
  'spécialiste',
  'stagiaire',
  'standardiste',
  'technique',
]);

/** Après eux, le mot qui suit parle d'autre chose : « Assistant du directeur ». */
const MOTS_DE_LIAISON = new Set([
  'à',
  'au',
  'aux',
  'avec',
  'd',
  'de',
  'des',
  'du',
  'en',
  'l',
  'la',
  'le',
  'les',
  'par',
  'pour',
  'sur',
]);

const formes = (paires: [string, string][]) =>
  new Map(
    paires.flatMap(([m, f]): [string, [string, string]][] => [
      [m, [m, f]],
      [f, [m, f]],
    ]),
  );
const FORMES_METIERS = formes(METIERS);
const FORMES_ACCORDS = formes(ACCORDS);

/**
 * L'intitulé accordé au genre de la personne : le métier et les mots qui
 * s'accordent avec ce métier, pas ce qui qualifie autre chose. Sans genre
 * connu, la majorité des mots de l'intitulé décide (« Conseiller spéciale
 * chargée » devient Conseillère spéciale chargée).
 */
export function accorderAuGenre(titre: string, genre?: Gender | null): string {
  const jetons = titre.split(/(\p{L}+(?:-\p{L}+)*)/u);
  // Les mots qui portent un genre, et à quelle place : le genre se décide d'abord.
  const places: { i: number; paire: [string, string]; forme: 'm' | 'f' }[] = [];
  let actif = true;
  let apresLien = false;
  for (let i = 1; i < jetons.length; i += 2) {
    const mot = jetons[i]!.toLowerCase();
    if (MOTS_DE_LIAISON.has(mot)) {
      actif = false;
      apresLien = true;
      continue;
    }
    const metier = FORMES_METIERS.get(mot);
    const accord = FORMES_ACCORDS.get(mot);
    if (metier && !apresLien) {
      places.push({ i, paire: metier, forme: mot === metier[0] ? 'm' : 'f' });
      actif = true;
    } else if (accord && actif) {
      places.push({ i, paire: accord, forme: mot === accord[0] ? 'm' : 'f' });
    } else if (mot !== 'et' && !EPICENES.has(mot) && jetons[i] !== jetons[i]!.toUpperCase()) {
      actif = false;
    }
    if (mot !== 'et') apresLien = false;
  }
  if (places.length === 0) return titre;
  let cible: 'm' | 'f';
  if (genre === 'female') cible = 'f';
  else if (genre === 'male') cible = 'm';
  else {
    const f = places.filter((p) => p.forme === 'f').length;
    const m = places.length - f;
    if (f === m) return titre;
    cible = f > m ? 'f' : 'm';
  }
  for (const p of places) {
    const juste = p.paire[cible === 'm' ? 0 : 1];
    const avant = jetons[p.i]!;
    jetons[p.i] = /^\p{Lu}/u.test(avant) ? juste.charAt(0).toUpperCase() + juste.slice(1) : juste;
  }
  return jetons.join('');
}

/* ───────────────────────── Personnes ───────────────────────── */

/** Un nom, pour reconnaître une personne : sans accents, sans casse, sans espaces en trop. */
export function nomComparable(v: string): string {
  return v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’'`-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Les civilités qu'on écrit devant un nom : elles ne servent pas à le reconnaître. */
const CIVILITES = new Set([
  'm',
  'mr',
  'mme',
  'mlle',
  'monsieur',
  'madame',
  'mademoiselle',
  'dr',
  'pr',
]);

/**
 * La clé d'un nom écrit dans une colonne (le N+1, le responsable fonctionnel) :
 * sans civilité, et dans n'importe quel ordre. « DIOP Awa » et « Mme Awa
 * Diop » désignent la même personne.
 */
export function cleDeNom(nom: string): string {
  return squelette(nom)
    .split(' ')
    .filter((m) => m && !CIVILITES.has(m))
    .sort()
    .join(' ');
}

/** Deux clés de nom assez proches pour une faute de frappe. */
export function nomsProches(a: string, b: string): boolean {
  return distance(a, b) <= tolerance(Math.min(a.length, b.length));
}
