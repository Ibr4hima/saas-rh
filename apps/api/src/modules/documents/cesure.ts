import { MOTIFS_DE_CESURE_FR } from './cesure-fr';

/*
   La césure des documents, à la française. Un paragraphe justifié qui ne
   coupe jamais un mot étire ses blancs quand le mot suivant ne tient plus
   dans la ligne : c'est ce qui laisse des trous entre les mots. La feuille
   coupe donc un mot courant là où le français le permet, selon l'algorithme
   de Franklin Liang, celui de TeX, sur ses motifs français (`cesure-fr.ts`).

   Ce qui se coupe, et ce qui ne se coupe jamais :
   - seulement un mot courant, tout en minuscules, de sept lettres au moins :
     jamais un nom propre ni un titre (une majuscule), un sigle, un nombre,
     un mot composé ;
   - trois lettres au moins de chaque côté de la coupure, la règle des
     typographes les plus soigneux : « consi-dération », pas « co-nsidération » ;
   - jamais juste après une élision : « l’assu-rance », pas « l’-assurance ».
*/

/** Les lettres que garde au moins chaque côté d'une coupure. */
const AVANT = 3;
const APRES = 3;
/** Un mot plus court ne se coupe pas. */
const LONGUEUR_MIN = 7;

/** Les motifs, rangés par leurs lettres : les poids de Liang avant, entre et après elles. */
const MOTIFS: ReadonlyMap<string, readonly number[]> = (() => {
  const motifs = new Map<string, number[]>();
  for (const motif of MOTIFS_DE_CESURE_FR.split(' ')) {
    if (!motif) continue;
    let lettres = '';
    const poids = [0];
    for (const c of motif) {
      if (c >= '0' && c <= '9') poids[poids.length - 1] = Number(c);
      else {
        lettres += c;
        poids.push(0);
      }
    }
    motifs.set(lettres, poids);
  }
  return motifs;
})();

/** La longueur du plus long motif : on n'en cherche pas de plus long dans un mot. */
const LONGUEUR_MAX = Math.max(...[...MOTIFS.keys()].map((m) => m.length));

/**
 * Les places où un mot en minuscules se coupe, selon Liang : pour chaque
 * place, l'indice de la lettre qui commence la suite. Le mot s'encadre de
 * points, les bornes des motifs ; chaque motif trouvé pose ses poids entre
 * les lettres, le plus fort l'emporte, et un poids impair permet la coupure.
 */
function places(mot: string): number[] {
  const w = `.${mot}.`;
  const poids = new Array<number>(w.length + 1).fill(0);
  for (let i = 0; i < w.length; i++) {
    for (let j = i + 1; j <= Math.min(w.length, i + LONGUEUR_MAX); j++) {
      const motif = MOTIFS.get(w.slice(i, j));
      if (!motif) continue;
      motif.forEach((v, k) => {
        if (v > poids[i + k]!) poids[i + k] = v;
      });
    }
  }
  const coupures: number[] = [];
  // Entre mot[q - 1] et mot[q], le poids posé avant w[q + 1] (le point décale d'un cran).
  for (let q = AVANT; q <= mot.length - APRES; q++) {
    if (poids[q + 1]! % 2 === 1) coupures.push(q);
  }
  return coupures;
}

/**
 * Un mot du texte et ce qui l'entoure : une élision devant (« l’ »,
 * « qu’ »), la ponctuation derrière. Les lettres sont celles du français en
 * minuscules : un mot qui porte une majuscule, un chiffre ou un trait
 * d'union n'y répond pas.
 */
const MOT_COURANT =
  /^((?:[cdjlmnst]|qu|jusqu|lorsqu|puisqu|quoiqu)[’'])?([a-zàâäçéèêëîïôöùûüÿœæ]+)([.,;:!?»)]*)$/u;

/**
 * Les places où le texte d'un mot peut se couper en fin de ligne, en indices
 * dans ce texte ; aucune s'il ne se coupe pas (cf. l'en-tête du fichier).
 */
export function cesures(texte: string): number[] {
  const m = MOT_COURANT.exec(texte);
  if (!m) return [];
  const elision = m[1] ?? '';
  const mot = m[2]!;
  if (mot.length < LONGUEUR_MIN) return [];
  return places(mot).map((q) => elision.length + q);
}
