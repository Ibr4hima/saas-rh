import { inflateRawSync } from 'node:zlib';

/* ————————————————————————————————————————————————————————————————
   Lire un classeur .xlsx, et rien de plus.

   Pourquoi pas une bibliothèque : `exceljs` — la référence de
   l'écosystème — plante sur le premier fichier réel qu'on lui a donné.
   Le classeur du RH déclare sa feuille de commentaires par un chemin
   ABSOLU (« /xl/comments/comment1.xml ») là où la bibliothèque indexe des
   chemins relatifs : `reconcile` déréférence `undefined` et la lecture
   s'arrête. Le fichier est pourtant valide, et Excel comme LibreOffice
   l'ouvrent. Un import RH reçoit des classeurs de toutes provenances —
   Excel, LibreOffice, un script Python côté DSI : une lecture qui tombe
   sur une relation mal devinée n'est pas une base acceptable, et
   soixante-quatorze paquets transitifs (dont six dépréciés) pour lire un
   tableau de dix lignes ne se justifiaient pas davantage.

   Ce qui suit lit le SOUS-ENSEMBLE dont l'import a besoin : une feuille,
   des chaînes, des nombres, des dates. Pas de formules — leur résultat
   mis en cache suffit —, pas de styles au-delà de ce qui distingue une
   date d'un nombre, pas d'écriture.

   Les garde-fous sont ici, et pas ailleurs : un .xlsx est une archive, et
   une archive vient d'un tiers. On plafonne donc le nombre d'entrées, la
   taille décompressée de chacune et celle du total — sans quoi un fichier
   de quelques kilooctets peut demander des gigaoctets de mémoire.
   ———————————————————————————————————————————————————————————————— */

/** Ce qu'une cellule peut valoir après lecture. */
export type CelluleXlsx = string | number | boolean | Date | null;

export interface FeuilleXlsx {
  nom: string;
  /** Les lignes dans l'ordre, chacune alignée sur les colonnes A, B, C… */
  lignes: CelluleXlsx[][];
}

export class XlsxIllisible extends Error {}

/** Plafonds : un fichier hostile ne doit pas pouvoir épuiser la mémoire. */
const MAX_ENTREES = 512;
const MAX_ENTREE_DECOMPRESSEE = 32 * 1024 * 1024;
const MAX_TOTAL_DECOMPRESSE = 64 * 1024 * 1024;
/** Une feuille d'effectif : cent mille lignes couvrent un ministère entier. */
const MAX_LIGNES = 100_000;
const MAX_COLONNES = 256;

/* ————————————————— L'archive ————————————————— */

interface EntreeZip {
  nom: string;
  methode: number;
  tailleCompressee: number;
  tailleDecompressee: number;
  offsetLocal: number;
}

/**
 * Le catalogue de l'archive, lu par la FIN.
 *
 * Un zip se lit à l'envers : son répertoire central est en queue, précédé
 * d'un marqueur qu'on cherche à reculons. C'est la seule façon correcte —
 * enchaîner les en-têtes locaux depuis le début suppose qu'aucun octet ne
 * traîne entre eux, ce que la spécification ne promet pas.
 */
function catalogue(buf: Buffer): EntreeZip[] {
  const debutEocd = trouverEocd(buf);
  const nombre = buf.readUInt16LE(debutEocd + 10);
  if (nombre > MAX_ENTREES) throw new XlsxIllisible('Archive trop fournie');
  let p = buf.readUInt32LE(debutEocd + 16);
  const entrees: EntreeZip[] = [];
  for (let i = 0; i < nombre; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new XlsxIllisible('Catalogue illisible');
    const longueurNom = buf.readUInt16LE(p + 28);
    const longueurExtra = buf.readUInt16LE(p + 30);
    const longueurCommentaire = buf.readUInt16LE(p + 32);
    entrees.push({
      nom: buf.toString('utf8', p + 46, p + 46 + longueurNom),
      methode: buf.readUInt16LE(p + 10),
      tailleCompressee: buf.readUInt32LE(p + 20),
      tailleDecompressee: buf.readUInt32LE(p + 24),
      offsetLocal: buf.readUInt32LE(p + 42),
    });
    p += 46 + longueurNom + longueurExtra + longueurCommentaire;
  }
  return entrees;
}

function trouverEocd(buf: Buffer): number {
  // Le marqueur est à 22 octets de la fin, sauf commentaire d'archive : on
  // remonte alors, mais pas indéfiniment (65 535 octets au maximum légal).
  const plancher = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= plancher; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new XlsxIllisible('Ce fichier n’est pas un classeur .xlsx');
}

function extraire(buf: Buffer, e: EntreeZip, budget: { reste: number }): Buffer {
  if (e.tailleDecompressee > MAX_ENTREE_DECOMPRESSEE) {
    throw new XlsxIllisible('Une pièce de l’archive est trop volumineuse');
  }
  if (buf.readUInt32LE(e.offsetLocal) !== 0x04034b50) {
    throw new XlsxIllisible('Archive incohérente');
  }
  const longueurNom = buf.readUInt16LE(e.offsetLocal + 26);
  const longueurExtra = buf.readUInt16LE(e.offsetLocal + 28);
  const debut = e.offsetLocal + 30 + longueurNom + longueurExtra;
  const brut = buf.subarray(debut, debut + e.tailleCompressee);
  const sortie = e.methode === 0 ? Buffer.from(brut) : inflateRawSync(brut);
  budget.reste -= sortie.length;
  if (budget.reste < 0) throw new XlsxIllisible('Archive trop volumineuse à l’ouverture');
  return sortie;
}

/* ————————————————— Le XML ————————————————— */

const ENTITES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/** `Mari&#233;` → « Marié ». Les classeurs échappent les accents en numérique. */
function decoder(texte: string): string {
  return texte.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (tout, code: string) => {
    if (code.startsWith('#x') || code.startsWith('#X')) {
      return String.fromCodePoint(parseInt(code.slice(2), 16));
    }
    if (code.startsWith('#')) return String.fromCodePoint(parseInt(code.slice(1), 10));
    return ENTITES[code] ?? tout;
  });
}

/** « BC » → 54 : la colonne d'une référence de cellule, en base 26. */
function indexColonne(ref: string): number {
  let n = 0;
  for (const c of ref) {
    const v = c.charCodeAt(0) - 64;
    if (v < 1 || v > 26) break;
    n = n * 26 + v;
  }
  return n - 1;
}

/**
 * Les formats de nombre qui désignent une DATE.
 *
 * Excel ne stocke pas de dates : il stocke des nombres et leur applique un
 * format. Sans lire les styles, « 32975 » ne se distingue pas d'un salaire.
 * Les identifiants intégrés sont connus ; les formats personnalisés se
 * reconnaissent à leurs lettres de jour, de mois ou d'année — cherchées hors
 * des littéraux entre guillemets et hors des crochets de condition, où « d »
 * peut n'être qu'une lettre de texte.
 */
const NUMFMT_DATE_INTEGRES = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51,
  52, 53, 54, 55, 56, 57, 58,
]);

function formatsDate(stylesXml: string | undefined): Set<number> {
  const dates = new Set<number>();
  if (!stylesXml) return dates;

  const personnalises = new Map<number, string>();
  for (const m of stylesXml.matchAll(/<numFmt[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) {
    personnalises.set(Number(m[1]), decoder(m[2] ?? ''));
  }

  const bloc = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml);
  if (!bloc) return dates;
  let index = 0;
  for (const xf of bloc[1]!.matchAll(/<xf\b[^>]*>/g)) {
    const id = Number(/numFmtId="(\d+)"/.exec(xf[0])?.[1] ?? '0');
    const code = personnalises.get(id);
    const estDate =
      NUMFMT_DATE_INTEGRES.has(id) ||
      (code !== undefined && /[ymdhs]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]/g, '')));
    if (estDate) dates.add(index);
    index++;
  }
  return dates;
}

/**
 * Le numéro de série d'Excel, en date.
 *
 * L'origine est le 30 décembre 1899 — un jour AVANT ce que la
 * documentation annonce, parce que le tableur compte un 29 février 1900 qui
 * n'a jamais existé et qu'on préfère décaler l'origine plutôt que corriger
 * chaque date. La journée est ramenée à midi UTC : une date de naissance
 * lue à minuit recule d'un jour dès qu'on la relit dans un fuseau négatif.
 */
function serieEnDate(serie: number): Date {
  const jours = Math.floor(serie);
  return new Date(Date.UTC(1899, 11, 30 + jours, 12, 0, 0));
}

/* ————————————————— La lecture ————————————————— */

/**
 * La PREMIÈRE feuille du classeur, telle qu'elle se lit.
 *
 * Une seule feuille : le fichier d'effectif en a une, et lire les autres
 * inviterait à importer par erreur un onglet de notes ou de totaux.
 */
export function lirePremiereFeuille(buf: Buffer): FeuilleXlsx {
  if (buf.length < 22) throw new XlsxIllisible('Fichier vide');
  const entrees = catalogue(buf);
  const budget = { reste: MAX_TOTAL_DECOMPRESSE };
  const lire = (nom: string): string | undefined => {
    const e = entrees.find((x) => x.nom === nom);
    return e ? extraire(buf, e, budget).toString('utf8') : undefined;
  };

  const workbook = lire('xl/workbook.xml');
  if (!workbook) throw new XlsxIllisible('Ce fichier n’est pas un classeur .xlsx');

  // Le nom de la feuille se lit dans le classeur ; son FICHIER se retrouve
  // par les relations, dont la cible peut être relative ou absolue — c'est
  // précisément ce qui met en défaut les lecteurs qui n'en prévoient qu'une.
  const premiere = /<sheet\b[^>]*name="([^"]*)"[^>]*r:id="([^"]*)"/.exec(workbook);
  const nomFeuille = decoder(premiere?.[1] ?? 'Feuille 1');
  const idRelation = premiere?.[2];
  const relations = lire('xl/_rels/workbook.xml.rels') ?? '';
  const cible = idRelation
    ? (new RegExp(`<Relationship[^>]*Id="${idRelation}"[^>]*Target="([^"]*)"`).exec(
        relations,
      )?.[1] ?? new RegExp(`Target="([^"]*)"[^>]*Id="${idRelation}"`).exec(relations)?.[1])
    : undefined;
  const cheminFeuille = cible ? cible.replace(/^\/?(xl\/)?/, 'xl/') : 'xl/worksheets/sheet1.xml';
  const feuille = lire(cheminFeuille) ?? lire('xl/worksheets/sheet1.xml');
  if (!feuille) throw new XlsxIllisible('Le classeur ne contient aucune feuille lisible');

  // Le tableau des chaînes partagées n'existe pas toujours : les classeurs
  // écrits par un script posent souvent le texte dans la cellule même.
  const partagees: string[] = [];
  const sharedXml = lire('xl/sharedStrings.xml');
  if (sharedXml) {
    for (const si of sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      // Une chaîne peut être découpée en fragments de mise en forme : on les
      // recolle, sinon « Direction du <b>Capital</b> Humain » perd un mot.
      const morceaux = [...si[1]!.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1] ?? '');
      partagees.push(decoder(morceaux.join('')));
    }
  }

  const dates = formatsDate(lire('xl/styles.xml'));
  const lignes: CelluleXlsx[][] = [];

  for (const row of feuille.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    if (lignes.length >= MAX_LIGNES) throw new XlsxIllisible('Feuille trop longue');
    const cellules: CelluleXlsx[] = [];
    for (const c of row[1]!.matchAll(/<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributs = c[1] ?? '';
      const corps = c[2] ?? '';
      const ref = /r="([A-Z]+)/.exec(attributs)?.[1];
      const colonne = ref ? indexColonne(ref) : cellules.length;
      if (colonne < 0 || colonne >= MAX_COLONNES) continue;
      const type = /t="([a-zA-Z]+)"/.exec(attributs)?.[1] ?? 'n';
      const style = Number(/s="(\d+)"/.exec(attributs)?.[1] ?? '-1');
      const brut = /<v>([\s\S]*?)<\/v>/.exec(corps)?.[1];
      const texteInline = [...corps.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
        .map((m) => m[1] ?? '')
        .join('');

      let valeur: CelluleXlsx = null;
      if (type === 'inlineStr') valeur = decoder(texteInline);
      else if (type === 's') valeur = partagees[Number(brut ?? '-1')] ?? null;
      else if (type === 'str') valeur = decoder(brut ?? '');
      else if (type === 'b') valeur = brut === '1';
      else if (type === 'd') valeur = brut ? new Date(brut) : null;
      else if (brut !== undefined && brut !== '') {
        const nombre = Number(brut);
        valeur = Number.isFinite(nombre) ? (dates.has(style) ? serieEnDate(nombre) : nombre) : null;
      }
      // Les trous restent des trous : une cellule absente n'est pas une
      // colonne décalée.
      while (cellules.length < colonne) cellules.push(null);
      cellules[colonne] = valeur;
    }
    lignes.push(cellules);
  }

  return { nom: nomFeuille, lignes };
}
