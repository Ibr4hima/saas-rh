import { cesures } from './cesure';

/*
   Les lignes d'un paragraphe justifié, réparties sur tout le paragraphe à la
   fois, comme le fait TeX (Knuth et Plass), et non ligne par ligne. Remplir
   chaque ligne au plus juste laisse à la suivante un mot trop long pour elle,
   et ses blancs s'étirent : ce sont les trous entre les mots. Ici, chaque
   façon de couper le paragraphe se juge sur toutes ses lignes, et la moins
   mauvaise l'emporte :
   - une ligne coûte d'autant plus que ses blancs s'écartent de l'espace
     normal, au cube : un blanc qui double se paie bien plus que deux qui
     s'élargissent un peu ;
   - un blanc peut se resserrer un peu, de 15 % au plus ;
   - une coupure de mot (`cesure.ts`) a son prix, et deux lignes de suite qui
     finissent par un trait d'union un prix de plus ; l'avant-dernière ligne
     n'en finit pas une, sauf à n'avoir pas mieux ;
   - une espace insécable entre deux mots s'étire comme les autres blancs,
     sans quoi « Madame Awa DIOP » paraît collé sur une ligne lâche ; elle ne
     sépare jamais une civilité du nom qui la suit (« Madame Awa »), ni un
     nombre de ce qui le suit (« 15 octobre », « (24) mois ») ; entre deux
     prénoms, entre un prénom et un nom, entre un mois et son année, elle
     cède en dernier recours ;
   - celle d'un nombre (« 650 000 », un RIB) ou d'une ponctuation (« : »,
     « « », « n° ») garde sa chasse et ne cède jamais ;
   - la dernière ligne ne s'étire pas : elle tient à l'espace normal.
*/

/** L'espace insécable : elle ne cède qu'en dernier recours, ou jamais (cf. ci-dessus). */
const INSECABLE = ' ';

/** Ce qu'un blanc peut gagner, en part de l'espace normal, pour un coût de 100. */
const ETIREMENT = 0.5;
/** Ce qu'un blanc peut perdre, au plus. */
const RESSERREMENT = 0.15;
/** Les prix d'une fin de ligne : un mot coupé, une espace insécable qui cède. */
const PRIX_DE_LA_CESURE = 50 ** 2;
const PRIX_DE_L_INSECABLE = 2e5;
/** Deux lignes de suite coupées ; l'avant-dernière ligne coupée. */
const PRIX_DE_DEUX_CESURES = 3000;
const PRIX_DE_LA_CESURE_FINALE = 5000;

/** Un morceau d'un mot : un texte d'un seul style, et sa largeur. */
export interface Morceau {
  texte: string;
  gras: boolean;
  souligne: boolean;
  italique: boolean;
  raye: boolean;
  encadre: boolean;
  largeur: number;
}

/** Un mot : ses morceaux, qui changent de style en son milieu (« BATHILY, »). */
export interface Mot {
  morceaux: Morceau[];
  largeur: number;
  /**
   * Joint au mot qui le précède sur la ligne par une espace insécable : le
   * blanc entre eux s'étire comme les autres, et un soulignement le traverse.
   */
  lie?: boolean;
}

/** Ce que la composition demande à la feuille. */
export interface Outils {
  /** La largeur des lignes. */
  largeurUtile: number;
  /** L'espace normal entre deux mots. */
  espace: number;
  /** Le même morceau sur un autre texte, mesuré. */
  partie: (m: Morceau, texte: string) => Morceau;
}

/**
 * Ce qui suit un segment : la fin d'un mot, une coupure de mot, une espace
 * insécable qui cède en dernier recours, une qui ne cède jamais.
 */
type Fin = 'mot' | 'cesure' | 'insecable' | 'lien';

/** Un bout de mot entre deux places où une ligne peut finir. */
interface Segment {
  morceaux: Morceau[];
  largeur: number;
  /** L'indice du mot dans le paragraphe. */
  mot: number;
  fin: Fin;
}

const largeurDe = (morceaux: readonly Morceau[]) => morceaux.reduce((s, m) => s + m.largeur, 0);

/** Les civilités, qui ne quittent pas le nom qui les suit. */
const CIVILITE = /^(Madame|Monsieur|Mademoiselle|Mesdames|Messieurs|Mme|Mlle|M\.|MM\.)$/u;
/** Un nombre, ordinal compris (« 1er »), qui ne quitte pas ce qui le suit. */
const NOMBRE = /^\d+(er|re|e)?$/u;

/**
 * Ce qu'est l'espace insécable entre ces deux bouts de mot : entre deux mots,
 * elle s'étire, et cède en dernier recours sauf après une civilité ou un
 * nombre ; devant une ponctuation, après « n° », entre des guillemets ou
 * dans un nombre, elle reste un caractère du mot (null).
 */
function jointure(avant: string, apres: string): 'insecable' | 'lien' | null {
  const fin = /[\p{L}\p{N}.]+$/u.exec(avant)?.[0];
  if (fin === undefined || !/^[\p{L}\p{N}]/u.test(apres)) return null;
  if (/\d$/u.test(fin) && /^\d/u.test(apres)) return null;
  return CIVILITE.test(fin) || NOMBRE.test(fin) ? 'lien' : 'insecable';
}

/** Ce qu'est l'espace insécable à la place `g` du texte d'un mot (cf. `jointure`). */
function jointureA(texte: string, g: number): 'insecable' | 'lien' | null {
  const suivante = texte.indexOf(INSECABLE, g + 1);
  const avant = texte.slice(texte.lastIndexOf(INSECABLE, g - 1) + 1, g);
  const apres = texte.slice(g + 1, suivante === -1 ? undefined : suivante);
  return jointure(avant, apres);
}

/** Si une ligne peut finir à l'espace insécable à la place `g` du texte d'un mot. */
export const cedeA = (texte: string, g: number) => jointureA(texte, g) === 'insecable';

/**
 * Un mot coupé en segments : à ses espaces insécables entre deux mots, qui
 * s'étirent, et aux places où une ligne peut finir en son milieu, ses
 * coupures, pour un mot d'un seul morceau qui n'est pas le dernier du
 * paragraphe.
 */
function segmentsDe(
  mot: Mot,
  indice: number,
  cesurable: boolean,
  partie: Outils['partie'],
): Segment[] {
  const points: { i: number; k: number; fin: Exclude<Fin, 'mot'> }[] = [];
  // Le texte du mot d'un tenant, et la place de chacun de ses caractères dans ses morceaux.
  const texte = mot.morceaux.map((m) => m.texte).join('');
  const places = mot.morceaux.flatMap((m, i) =>
    [...Array(m.texte.length).keys()].map((k) => ({ i, k })),
  );
  for (let g = texte.indexOf(INSECABLE); g !== -1; g = texte.indexOf(INSECABLE, g + 1)) {
    const { i, k } = places[g]!;
    if (mot.morceaux[i]!.encadre) continue;
    const fin = jointureA(texte, g);
    if (fin) points.push({ i, k, fin });
  }
  const seul = mot.morceaux[0];
  if (cesurable && mot.morceaux.length === 1 && seul && !seul.encadre) {
    for (const k of cesures(seul.texte)) points.push({ i: 0, k, fin: 'cesure' });
  }
  points.sort((a, b) => a.i - b.i || a.k - b.k);

  const segments: Segment[] = [];
  let [i0, k0] = [0, 0];
  // Les morceaux de (i0, k0) jusqu'à (i1, k1), ce dernier exclu.
  const jusqua = (i1: number, k1: number): Morceau[] => {
    const morceaux: Morceau[] = [];
    for (let i = i0; i <= i1 && i < mot.morceaux.length; i++) {
      const m = mot.morceaux[i]!;
      const debut = i === i0 ? k0 : 0;
      const fin = i === i1 ? k1 : m.texte.length;
      if (fin <= debut) continue;
      morceaux.push(
        debut === 0 && fin === m.texte.length ? m : partie(m, m.texte.slice(debut, fin)),
      );
    }
    return morceaux;
  };
  for (const p of points) {
    const morceaux = jusqua(p.i, p.k);
    if (morceaux.length > 0) {
      segments.push({ morceaux, largeur: largeurDe(morceaux), mot: indice, fin: p.fin });
    }
    // L'espace insécable ne reste pas dans le texte : elle devient un blanc.
    [i0, k0] = [p.i, p.fin === 'cesure' ? p.k : p.k + 1];
  }
  const dernier = mot.morceaux.length - 1;
  const reste = jusqua(dernier, mot.morceaux[dernier]?.texte.length ?? 0);
  segments.push({ morceaux: reste, largeur: largeurDe(reste), mot: indice, fin: 'mot' });
  return segments;
}

/**
 * Un mot seul sur sa ligne, qui ne se justifie pas : il coûte autant qu'une
 * ligne aux blancs de quatre espaces et demie, et ne se garde que faute de
 * mieux.
 */
const PRIX_DU_MOT_SEUL = 1e9;

/**
 * Le coût d'une ligne qui n'est pas la dernière : l'écart de ses blancs à
 * l'espace normal, au cube, la « laideur » de TeX. Elle n'a pas de plafond :
 * une ligne aux blancs de trois espaces reste moins laide qu'une aux blancs
 * de dix, et il faut que le calcul le voie.
 */
function coutDeLaLigne(naturelle: number, espaces: number, { largeurUtile, espace }: Outils) {
  if (espaces === 0) return PRIX_DU_MOT_SEUL;
  const ecart = largeurUtile - naturelle;
  const r =
    ecart >= 0
      ? ecart / (espaces * espace * ETIREMENT)
      : -ecart / (espaces * espace * RESSERREMENT);
  return (10 + 100 * r ** 3) ** 2;
}

/**
 * Les lignes d'un paragraphe justifié, mot par mot ; un mot coupé en fin de
 * ligne y porte son trait d'union. Cf. l'en-tête du fichier.
 */
export function lignesEquilibrees(mots: readonly Mot[], outils: Outils): Mot[][] {
  const { largeurUtile, espace, partie } = outils;
  // Le dernier mot du paragraphe ne se coupe pas : sa fin resterait seule.
  const segments = mots.flatMap((mot, i) => segmentsDe(mot, i, i < mots.length - 1, partie));
  const n = segments.length;
  if (n === 0) return [];
  const largeurDu = (texte: string, m: Morceau) => partie(m, texte).largeur;
  /** Si un blanc sépare ce segment du précédent : entre deux mots, ou à une insécable. */
  const blancApres = (p: Segment, s: Segment) => s.mot !== p.mot || p.fin !== 'cesure';

  // meilleur[b] : le moindre coût d'un paragraphe coupé juste avant le segment b.
  const meilleur = new Array<number>(n + 1).fill(Infinity);
  const depuis = new Array<number>(n + 1).fill(-1);
  meilleur[0] = 0;
  for (let a = 0; a < n; a++) {
    if (meilleur[a] === Infinity) continue;
    const coupeAvant = a > 0 && segments[a - 1]!.fin === 'cesure';
    let largeur = 0;
    let espaces = 0;
    for (let b = a; b < n; b++) {
      const s = segments[b]!;
      if (b > a && blancApres(segments[b - 1]!, s)) espaces += 1;
      largeur += s.largeur;
      const tiret = s.fin === 'cesure' ? largeurDu('-', s.morceaux.at(-1)!) : 0;
      const naturelle = largeur + tiret + espaces * espace;
      const serree = largeur + tiret + espaces * espace * (1 - RESSERREMENT);
      if (b > a && serree > largeurUtile) break;
      // Une ligne ne finit pas à une insécable qui ne cède pas.
      if (s.fin === 'lien') continue;
      const derniere = b === n - 1;
      let cout: number;
      if (derniere) {
        cout = naturelle <= largeurUtile || b === a ? 0 : Infinity;
        if (coupeAvant) cout += PRIX_DE_LA_CESURE_FINALE;
      } else {
        cout =
          coutDeLaLigne(naturelle, espaces, outils) +
          (s.fin === 'cesure' ? PRIX_DE_LA_CESURE : 0) +
          (s.fin === 'insecable' ? PRIX_DE_L_INSECABLE : 0) +
          (coupeAvant && s.fin === 'cesure' ? PRIX_DE_DEUX_CESURES : 0);
      }
      if (meilleur[a]! + cout < meilleur[b + 1]!) {
        meilleur[b + 1] = meilleur[a]! + cout;
        depuis[b + 1] = a;
      }
    }
  }

  // Les coupures, de la fin au début, puis les lignes.
  const coupures: number[] = [];
  for (let b = n; b > 0 && depuis[b]! >= 0; b = depuis[b]!) coupures.unshift(b);
  const lignes: Mot[][] = [];
  let a = 0;
  for (const b of coupures) {
    const ligne: Mot[] = [];
    for (let i = a; i < b; i++) {
      const s = segments[i]!;
      const p = segments[i - 1];
      if (i > a && p && !blancApres(p, s)) {
        // Le même mot, coupé à une place de césure où la ligne ne finit pas : il se recolle.
        const mot = ligne.at(-1)!;
        mot.morceaux.push(...s.morceaux);
        mot.largeur += s.largeur;
      } else {
        const lie = i > a && p !== undefined && p.mot === s.mot;
        ligne.push({ morceaux: [...s.morceaux], largeur: s.largeur, ...(lie && { lie }) });
      }
    }
    if (segments[b - 1]!.fin === 'cesure') {
      const mot = ligne.at(-1)!;
      const m = mot.morceaux.at(-1)!;
      const avecTiret = partie(m, `${m.texte}-`);
      mot.morceaux[mot.morceaux.length - 1] = avecTiret;
      mot.largeur += avecTiret.largeur - m.largeur;
    }
    lignes.push(ligne);
    a = b;
  }
  return lignes;
}
