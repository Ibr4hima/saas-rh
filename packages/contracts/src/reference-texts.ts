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
