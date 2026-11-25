import { z } from 'zod';

/* ────────────────────────────────────────────────────────────────
   Un texte mis en forme, tel que l'écrivent les champs de la grille
   d'évaluation (ADR-0150) : des paragraphes, des puces, des numéros, et
   dans chacun du texte en gras ou en italique. Rien d'autre : ni titre, ni
   lien, ni couleur.

   C'est ce format, et non celui de l'éditeur (BlockNote), que la base garde
   et que le PDF imprime : l'éditeur peut changer, la grille déjà remplie
   se relit à l'identique.
   ──────────────────────────────────────────────────────────────── */

export const TYPES_DE_BLOC = ['paragraphe', 'puce', 'numero'] as const;
export type TypeDeBloc = (typeof TYPES_DE_BLOC)[number];

/** Une liste dans une liste, deux fois au plus : au-delà, le PDF n'a plus la place. */
export const NIVEAU_MAX = 2;

export const segmentSchema = z.object({
  texte: z.string().max(5000),
  gras: z.boolean().optional(),
  italique: z.boolean().optional(),
});
export type Segment = z.infer<typeof segmentSchema>;

export const blocDeTexteSchema = z.object({
  type: z.enum(TYPES_DE_BLOC),
  niveau: z.number().int().min(0).max(NIVEAU_MAX).default(0),
  /** Le premier numéro d'une liste qui ne commence pas à 1 (« 3. » tapé en tête). */
  debut: z.number().int().min(2).max(999).optional(),
  segments: z.array(segmentSchema).max(500),
});
export type BlocDeTexte = z.infer<typeof blocDeTexteSchema>;
type BlocDeTexteEnEntree = z.input<typeof blocDeTexteSchema>;
export type TexteRiche = BlocDeTexte[];

/** Le texte nu : chaque bloc sur sa ligne, sans puce ni numéro. */
export function texteBrut(t: readonly BlocDeTexte[]): string {
  return t.map((b) => b.segments.map((s) => s.texte).join('')).join('\n');
}

/** Rien d'écrit, espaces mis à part. */
export const texteRicheVide = (t: readonly BlocDeTexte[]) => texteBrut(t).trim() === '';

/** Un texte simple, un paragraphe par ligne : ce que gardaient les grilles d'avant. */
export function texteRicheDe(texte: string): TexteRiche {
  return normaliserTexteRiche(
    texte.split(/\r?\n/).map((ligne) => ({
      type: 'paragraphe' as const,
      niveau: 0,
      segments: [{ texte: ligne }],
    })),
  );
}

/**
 * Le texte rangé : les segments vides retirés, ceux de même style fondus,
 * les blocs vides de la fin ôtés. Deux textes qui se lisent pareil
 * s'enregistrent pareil.
 */
export function normaliserTexteRiche(t: readonly BlocDeTexteEnEntree[]): TexteRiche {
  const blocs = t.map((b): BlocDeTexte => {
    const segments: Segment[] = [];
    for (const s of b.segments) {
      // Un retour à la ligne dans un bloc ne s'imprime pas : un espace le remplace.
      const texte = s.texte.replace(/\r?\n/g, ' ');
      if (!texte) continue;
      const avant = segments[segments.length - 1];
      if (avant && !avant.gras === !s.gras && !avant.italique === !s.italique) {
        avant.texte += texte;
      } else {
        segments.push({
          texte,
          ...(s.gras ? { gras: true } : {}),
          ...(s.italique ? { italique: true } : {}),
        });
      }
    }
    return {
      type: b.type,
      niveau: b.type === 'paragraphe' ? 0 : Math.min(b.niveau ?? 0, NIVEAU_MAX),
      ...(b.type === 'numero' && b.debut && b.debut > 1 ? { debut: b.debut } : {}),
      segments,
    };
  });
  while (blocs.length > 0 && blocs[blocs.length - 1]!.segments.every((s) => !s.texte.trim())) {
    blocs.pop();
  }
  return blocs;
}

/**
 * Ce qu'un champ admet : du texte seul, en paragraphes ; des paragraphes,
 * des puces et des numéros ; ou des puces seulement, chaque ligne la sienne.
 */
export type FormeDuChamp = 'texte' | 'listes' | 'puces';

/** Chaque ligne en puce, à son niveau : un paragraphe passe au premier. */
const enPuces = (t: TexteRiche): TexteRiche =>
  t.map((b) => ({ type: 'puce', niveau: b.niveau, segments: b.segments }));

/**
 * Le schéma d'un champ : `max` caractères de texte au plus, ce que sa place
 * sur le PDF peut tenir, dans la forme du champ. Un texte simple, d'avant le
 * texte riche, se lit encore ; dans un champ en puces, chacune de ses lignes
 * devient une puce.
 */
export function texteRicheSchema(max: number, forme: FormeDuChamp) {
  return z
    .preprocess(
      (v) => (typeof v === 'string' ? texteRicheDe(v) : (v ?? [])),
      z.array(blocDeTexteSchema).max(300),
    )
    .transform(normaliserTexteRiche)
    .transform((t) => (forme === 'puces' ? enPuces(t) : t))
    .refine((t) => texteBrut(t).length <= max, { message: `${max} caractères maximum` })
    .refine((t) => forme !== 'texte' || t.every((b) => b.type === 'paragraphe'), {
      message: 'Ce champ n’accepte ni puces ni listes numérotées',
    });
}

/**
 * Le numéro de chaque bloc numéroté, comme l'éditeur le compte : 1, 2, 3…
 * à chaque niveau, repris au début après un bloc d'une autre sorte. `null`
 * pour les autres blocs.
 */
export function numerosDesBlocs(t: readonly BlocDeTexte[]): (number | null)[] {
  const compteurs: number[] = [];
  return t.map((b) => {
    if (b.type !== 'numero') {
      // Un paragraphe interrompt les listes ; une puce, celles de son niveau et en dessous.
      compteurs.length = b.type === 'paragraphe' ? 0 : Math.min(compteurs.length, b.niveau);
      if (b.type === 'puce') compteurs[b.niveau] = 0;
      return null;
    }
    compteurs.length = Math.min(compteurs.length, b.niveau + 1);
    const avant = compteurs[b.niveau];
    compteurs[b.niveau] = avant ? avant + 1 : (b.debut ?? 1);
    return compteurs[b.niveau]!;
  });
}
