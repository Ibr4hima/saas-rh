import { z } from 'zod';

/**
 * Textes de référence : le Code du travail, le règlement intérieur.
 *
 * Deux natures sous une même forme, et il faut les distinguer pour ne pas se
 * tromper d'écran. Le CODE DU TRAVAIL est une loi nationale : la même pour
 * toutes les organisations, personne ne l'« adopte », on constate la version
 * en vigueur. Le RÈGLEMENT INTÉRIEUR est le texte de l'organisation
 * elle-même : elle le rédige, le date, et il ne s'oppose à un employé qu'une
 * fois porté à sa connaissance.
 *
 * Même structure, donc, mais pas le même propriétaire — et c'est pourquoi le
 * `slug` n'est pas contraint à ces deux valeurs : une convention collective,
 * un accord d'entreprise s'y rangeront sans migration.
 */

export const REFERENCE_TEXT_SLUGS = ['code-du-travail', 'reglement-interieur'] as const;
export type ReferenceTextSlug = (typeof REFERENCE_TEXT_SLUGS)[number];

export const REFERENCE_TEXT_TITLES: Record<ReferenceTextSlug, string> = {
  'code-du-travail': 'Code du travail',
  'reglement-interieur': 'Règlement intérieur',
};

export interface ReferenceArticleView {
  id: string;
  /** Le numéro tel qu'il s'écrit : « premier » pour 1, sinon le nombre. */
  numero: string;
  number: number;
  sectionId: string | null;
  title: string | null;
  body: string;
}

export interface ReferenceSectionView {
  id: string;
  numero: string;
  title: string;
  body: string | null;
}

export interface ReferenceChapterView {
  id: string;
  /** « Chapitre premier », « Chapitre II »… */
  numero: string;
  title: string;
  body: string | null;
  sections: ReferenceSectionView[];
  articles: ReferenceArticleView[];
}

export interface ReferenceTextView {
  id: string;
  slug: string;
  title: string;
  reference: string | null;
  effectiveOn: string | null;
  published: boolean;
  /** Le PDF officiel, celui qui fait foi. Absent tant qu'il n'est pas déposé. */
  pdf: { filename: string; size: number } | null;
  chapters: ReferenceChapterView[];
  articleCount: number;
}

/** Un article trouvé par la recherche, avec de quoi le rejoindre. */
export interface ReferenceSearchHit {
  id: string;
  numero: string;
  title: string | null;
  chapterId: string;
  chapterNumero: string;
  chapterTitle: string;
  /** Les mots autour de la trouvaille, pas l'article entier. */
  extract: string;
}

export const referenceSearchSchema = z.object({
  q: z.string().trim().min(2).max(120),
});
export type ReferenceSearchInput = z.infer<typeof referenceSearchSchema>;

// ---------- Numérotation ----------

const ROMAINS: [number, string][] = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

/** 4 → « IV ». Les chapitres d'un texte de loi se numérotent en romain. */
export function enRomain(n: number): string {
  let reste = n;
  let sortie = '';
  for (const [valeur, signe] of ROMAINS) {
    while (reste >= valeur) {
      sortie += signe;
      reste -= valeur;
    }
  }
  return sortie;
}

/**
 * L'usage juridique français : le premier de rang s'écrit « premier », les
 * suivants en chiffres. « Article premier », puis « Article 2 ». Écrire
 * « Article 1 » se remarque immédiatement dans un texte de loi.
 */
export const numeroChapitre = (n: number): string =>
  n === 1 ? 'Chapitre premier' : `Chapitre ${enRomain(n)}`;
export const numeroSection = (n: number): string => `Section ${enRomain(n)}`;
export const numeroArticle = (n: number, label?: string | null): string =>
  label ?? (n === 1 ? 'premier' : String(n));

// ---------- Mise en forme du corps ----------

export type BlocTexte = { type: 'paragraphe'; texte: string } | { type: 'liste'; items: string[] };

/**
 * Le corps d'un article est du TEXTE BRUT — jamais du HTML.
 *
 * Stocker du balisage obligerait à le réafficher tel quel, et une session RH
 * compromise injecterait du script dans l'écran de chaque employé. La mise en
 * forme se déduit donc de la frappe, et le rendu nous appartient : une ligne
 * vide sépare deux paragraphes, une ligne ouverte par « - », « — » ou « • »
 * est un élément de liste. C'est tout ce dont un texte de loi a besoin.
 */
export function decouperTexte(corps: string): BlocTexte[] {
  const blocs: BlocTexte[] = [];
  for (const bloc of corps.split(/\n\s*\n/)) {
    const lignes = bloc
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lignes.length === 0) continue;
    const puce = /^[-—•]\s+/;
    if (lignes.every((l) => puce.test(l))) {
      blocs.push({ type: 'liste', items: lignes.map((l) => l.replace(puce, '')) });
    } else {
      blocs.push({ type: 'paragraphe', texte: lignes.join(' ') });
    }
  }
  return blocs;
}

// ---------- Dépôt et rédaction (RH) ----------

const isoDate = z.iso.date();

export const MAX_REFERENCE_PDF_BYTES = 15 * 1024 * 1024;

const corpsSchema = z.string().max(40_000);

export const referenceArticleInputSchema = z.object({
  number: z.number().int().positive().max(9999),
  /** Une numérotation que l'entier ne dit pas : « L.34 », « 12 bis ». */
  label: z.string().trim().max(40).nullish(),
  title: z.string().trim().max(500).nullish(),
  body: corpsSchema,
  /** Le rang de la section dans le chapitre, si l'article en relève. */
  sectionNumber: z.number().int().positive().max(999).nullish(),
});

export const referenceSectionInputSchema = z.object({
  number: z.number().int().positive().max(999),
  title: z.string().trim().min(1).max(500),
  body: corpsSchema.nullish(),
});

export const referenceChapterInputSchema = z.object({
  number: z.number().int().positive().max(999),
  title: z.string().trim().min(1).max(500),
  body: corpsSchema.nullish(),
  sections: z.array(referenceSectionInputSchema).max(100).default([]),
  articles: z.array(referenceArticleInputSchema).max(2000).default([]),
});

/**
 * Le texte s'enregistre EN ENTIER, jamais article par article.
 *
 * Un texte de loi ne se corrige pas à la virgule : il est remplacé par sa
 * version suivante, et c'est cette version-là qui s'oppose. Un envoi complet
 * dit exactement cela, tient dans une transaction, et rend l'import par
 * collage possible — le seul moyen réaliste de saisir trois cents articles.
 */
export const saveReferenceTextSchema = z.object({
  title: z.string().trim().min(2).max(300),
  reference: z.string().trim().max(300).nullish(),
  effectiveOn: isoDate.nullish(),
  published: z.boolean(),
  chapters: z.array(referenceChapterInputSchema).max(200),
});
export type SaveReferenceTextInput = z.infer<typeof saveReferenceTextSchema>;

export const uploadReferencePdfSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  contentBase64: z.string().min(1),
});
export type UploadReferencePdfInput = z.infer<typeof uploadReferencePdfSchema>;

// ---------- Lire un texte collé ----------

export interface AnalyseTexte {
  chapters: Array<{
    number: number;
    title: string;
    body: string | null;
    sections: Array<{ number: number; title: string; body: string | null }>;
    articles: Array<{
      number: number;
      label: string | null;
      title: string | null;
      body: string;
      sectionNumber: number | null;
    }>;
  }>;
  /** Ce que l'analyse n'a pas su placer, dit en clair à qui colle le texte. */
  problemes: string[];
  articleCount: number;
}

/** Un en-tête tient sur une ligne courte ; au-delà, c'est de la prose. */
const LIGNE_ENTETE_MAX = 140;
const SEPARATEUR = String.raw`(?:\s+[—–\-:]\s+|\s*[—–]\s*)`;
const ENTETE_CHAPITRE = new RegExp(
  String.raw`^chapitre\s+(premier|première|[IVXLCDM]+|\d+)\s*\.?${SEPARATEUR}?(.*)$`,
  'i',
);
const ENTETE_SECTION = new RegExp(
  String.raw`^section\s+(premier|première|[IVXLCDM]+|\d+)\s*\.?${SEPARATEUR}?(.*)$`,
  'i',
);
const ENTETE_ARTICLE = new RegExp(String.raw`^art(?:icle|\.)\s+(.+?)(?:${SEPARATEUR}(.*))?$`, 'i');

/** « IV » → 4. Rend 0 sur ce qui n'est pas un chiffre romain. */
export function depuisRomain(s: string): number {
  const valeurs: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  const lettres = s.toUpperCase().split('');
  if (lettres.some((l) => !(l in valeurs))) return 0;
  let total = 0;
  for (let i = 0; i < lettres.length; i += 1) {
    const v = valeurs[lettres[i]!]!;
    const suivant = i + 1 < lettres.length ? valeurs[lettres[i + 1]!]! : 0;
    total += v < suivant ? -v : v;
  }
  return total;
}

/**
 * Lire un texte de loi COLLÉ TEL QUEL.
 *
 * Saisir trois cents articles dans un formulaire n'arrivera jamais ; coller le
 * texte, si. On y cherche donc les trois marques qu'un texte juridique porte
 * toujours — « Chapitre », « Section », « Article » — et tout le reste est le
 * corps de ce qui précède.
 *
 * Le NUMÉRO d'un article est son RANG dans le texte, jamais le nombre écrit :
 * c'est ce qui garantit qu'« Article 47 » désigne un seul article, même quand
 * la numérotation repart à un à chaque chapitre. Le nombre écrit est conservé
 * à part, en `label`, et c'est lui qui s'affiche — la fidélité au texte d'un
 * côté, l'unicité du renvoi de l'autre.
 */
export function analyserTexte(brut: string): AnalyseTexte {
  const chapitres: AnalyseTexte['chapters'] = [];
  const problemes: string[] = [];
  let rangArticle = 0;
  /** Où vont les lignes qui ne sont pas un en-tête. */
  let cible: { corps: string[] } | null = null;

  const chapitreCourant = () => chapitres[chapitres.length - 1];
  const ouvrirChapitreImplicite = () => {
    problemes.push(
      'Des articles apparaissent avant tout chapitre : ils ont été rangés sous « Sans chapitre ».',
    );
    chapitres.push({ number: 1, title: 'Sans chapitre', body: null, sections: [], articles: [] });
    return chapitres[chapitres.length - 1]!;
  };

  for (const ligne of brut.split('\n')) {
    const l = ligne.trim();
    if (l === '') {
      cible?.corps.push('');
      continue;
    }

    const court = l.length <= LIGNE_ENTETE_MAX;
    const mChap = court ? ENTETE_CHAPITRE.exec(l) : null;
    if (mChap) {
      const titre = (mChap[2] ?? '').trim();
      chapitres.push({
        number: chapitres.length + 1,
        title: titre || `Chapitre ${chapitres.length + 1}`,
        body: null,
        sections: [],
        articles: [],
      });
      if (!titre) problemes.push(`Le chapitre ${chapitres.length} n'a pas de titre.`);
      const c = chapitreCourant()!;
      cible = { corps: [] };
      Object.defineProperty(c, '__corps', { value: cible.corps, enumerable: false });
      continue;
    }

    const mSec = court ? ENTETE_SECTION.exec(l) : null;
    if (mSec) {
      const c = chapitreCourant() ?? ouvrirChapitreImplicite();
      const titre = (mSec[2] ?? '').trim();
      c.sections.push({
        number: c.sections.length + 1,
        title: titre || `Section ${c.sections.length + 1}`,
        body: null,
      });
      if (!titre) problemes.push(`Une section du chapitre ${c.number} n'a pas de titre.`);
      cible = { corps: [] };
      Object.defineProperty(c.sections[c.sections.length - 1]!, '__corps', {
        value: cible.corps,
        enumerable: false,
      });
      continue;
    }

    const mArt = court ? ENTETE_ARTICLE.exec(l) : null;
    if (mArt) {
      const c = chapitreCourant() ?? ouvrirChapitreImplicite();
      rangArticle += 1;
      const ecrit = (mArt[1] ?? '').trim().replace(/[.:]+$/, '');
      const titre = (mArt[2] ?? '').trim();
      // Le nombre écrit n'est gardé que s'il DIFFÈRE du rang : « Article 12 »
      // en douzième position n'apprend rien de plus que sa place.
      const memeQueLeRang =
        ecrit === String(rangArticle) || (rangArticle === 1 && /^premi[eè]re?$/i.test(ecrit));
      c.articles.push({
        number: rangArticle,
        label: memeQueLeRang ? null : ecrit || null,
        title: titre || null,
        body: '',
        sectionNumber: c.sections.length > 0 ? c.sections.length : null,
      });
      cible = { corps: [] };
      Object.defineProperty(c.articles[c.articles.length - 1]!, '__corps', {
        value: cible.corps,
        enumerable: false,
      });
      continue;
    }

    if (!cible) {
      // Une ligne avant tout en-tête : c'est le chapeau du texte, pas du contenu.
      continue;
    }
    cible.corps.push(l);
  }

  // Les corps accumulés rejoignent leur élément, débarrassés des lignes vides
  // de tête et de queue.
  const recoller = (o: object): string => {
    const lignes = (o as { __corps?: string[] }).__corps ?? [];
    return lignes
      .join('\n')
      .replace(/^\n+|\n+$/g, '')
      .trim();
  };
  for (const c of chapitres) {
    c.body = recoller(c) || null;
    for (const s of c.sections) s.body = recoller(s) || null;
    for (const a of c.articles) a.body = recoller(a);
  }

  const vides = chapitres.flatMap((c) => c.articles.filter((a) => a.body === ''));
  if (vides.length > 0) {
    problemes.push(`${vides.length} article(s) sans contenu : leur corps est resté vide.`);
  }
  if (chapitres.length === 0) {
    problemes.push('Aucun chapitre reconnu — un chapitre s’annonce par « CHAPITRE I — Titre ».');
  }

  return {
    chapters: chapitres,
    problemes,
    articleCount: chapitres.reduce((n, c) => n + c.articles.length, 0),
  };
}

/**
 * L'inverse : rendre le texte tel qu'on le collerait.
 *
 * C'est ce qui permet de REPRENDRE un texte déjà déposé au lieu de le ressaisir
 * — et c'est aussi la garantie que les deux fonctions parlent la même langue :
 * analyser puis composer doit rendre le point de départ.
 */
export function composerTexte(chapitres: AnalyseTexte['chapters']): string {
  const morceaux: string[] = [];
  for (const c of chapitres) {
    morceaux.push(`${numeroChapitre(c.number).toUpperCase()} — ${c.title}`);
    if (c.body) morceaux.push(c.body);
    const parSection = new Map<number | null, typeof c.articles>();
    for (const a of c.articles) {
      const l = parSection.get(a.sectionNumber) ?? [];
      l.push(a);
      parSection.set(a.sectionNumber, l);
    }
    const ecrire = (articles: typeof c.articles) => {
      for (const a of articles) {
        const numero = a.label ?? (a.number === 1 ? 'premier' : String(a.number));
        morceaux.push(a.title ? `Article ${numero} — ${a.title}` : `Article ${numero}`);
        if (a.body) morceaux.push(a.body);
      }
    };
    ecrire(parSection.get(null) ?? []);
    for (const s of c.sections) {
      morceaux.push(`${numeroSection(s.number)} — ${s.title}`);
      if (s.body) morceaux.push(s.body);
      ecrire(parSection.get(s.number) ?? []);
    }
  }
  return morceaux.join('\n\n');
}
