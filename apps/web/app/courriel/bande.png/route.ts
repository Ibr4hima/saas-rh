import sharp from 'sharp';

/* ────────────────────────────────────────────────────────────────
   La bande du bas des courriels (ADR-0186) : la courbe bleue de la charte,
   soulignée d'orange, avec les ondulations du dos de la charte, comme au bas
   du certificat d'APIX Academy.

   En PNG, deux fois plus fin que sa taille d'affichage : les messageries ne
   lisent pas le SVG. Le haut est transparent : la carte du courriel passe
   dessous, blanche, ou assombrie par une messagerie en thème sombre. Les
   coins du bas sont arrondis comme ceux de la carte.
   ──────────────────────────────────────────────────────────────── */

export const runtime = 'nodejs';

/** La taille d'affichage, en pixels CSS, et l'arrondi des coins de la carte. */
const LARGEUR = 600;
const HAUTEUR = 64;
const RAYON = 8;

const BLEU = '#004f91';
const BLEU_PROFOND = '#003a6c';
const ORANGE = '#ca631f';

/**
 * Le bord de la courbe du papier à en-tête, en points de l'A4 (cf.
 * apps/api/src/modules/documents/entete.ts) : trois arcs de Bézier.
 */
const ARCS = [
  [
    [0, 769.7],
    [99.12, 787.94],
    [200.97, 780.65],
    [300.25, 767.28],
  ],
  [
    [300.25, 767.28],
    [374.96, 757.09],
    [448.99, 742.17],
    [522.22, 724.29],
  ],
  [
    [522.22, 724.29],
    [546.66, 718.4],
    [571.01, 712.15],
    [595.28, 705.59],
  ],
] as const;

/**
 * Ramenée à la bande : la largeur de la feuille sur celle du courriel ; en
 * hauteur, la courbe part à 30 px du haut, à gauche, et monte à 4 px, à droite.
 */
const enX = (x: number) => (x * LARGEUR) / 595.28;
const enY = (y: number) => 4 + ((y - 705.59) * 26) / (769.7 - 705.59);
const ARCS_BANDE = ARCS.map((arc) => arc.map(([x, y]) => [enX(x), enY(y)] as const));

const n = (v: number) => Number(v.toFixed(2));

/** Le bord de la courbe, échantillonné de gauche à droite. */
const BORD = ARCS_BANDE.flatMap((arc, i) =>
  Array.from({ length: 41 }, (_, k) => k / 40)
    .slice(i === 0 ? 0 : 1)
    .map((t) => {
      const u = 1 - t;
      const c = (k: 0 | 1) =>
        u * u * u * arc[0]![k] +
        3 * u * u * t * arc[1]![k] +
        3 * u * t * t * arc[2]![k] +
        t * t * t * arc[3]![k];
      return [c(0), c(1)] as const;
    }),
);

function bordA(x: number): number {
  for (let i = 1; i < BORD.length; i += 1) {
    const [x1, y1] = BORD[i]!;
    const [x0, y0] = BORD[i - 1]!;
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0 || 1);
  }
  return BORD.at(-1)![1];
}

/** La bande : le bord de la courbe, puis le bas de l'image, aux coins arrondis. */
const BANDE =
  `M${n(ARCS_BANDE[0]![0]![0])} ${n(ARCS_BANDE[0]![0]![1])}` +
  ARCS_BANDE.map(
    ([, p1, p2, p3]) =>
      `C${n(p1![0])} ${n(p1![1])} ${n(p2![0])} ${n(p2![1])} ${n(p3![0])} ${n(p3![1])}`,
  ).join('') +
  `L${LARGEUR} ${HAUTEUR - RAYON}A${RAYON} ${RAYON} 0 0 1 ${LARGEUR - RAYON} ${HAUTEUR}` +
  `L${RAYON} ${HAUTEUR}A${RAYON} ${RAYON} 0 0 1 0 ${HAUTEUR - RAYON}Z`;

/** Les ondulations : des lignes qui suivent la courbe, à peine plus claires que le bleu. */
const ONDULATIONS = Array.from({ length: 12 }, (_, i) => {
  const points: string[] = [];
  for (let x = -4; x <= LARGEUR + 4; x += 4) {
    const y =
      bordA(Math.min(Math.max(x, 0), LARGEUR)) +
      5 +
      i * 4.6 +
      1.6 * Math.sin((2 * Math.PI * x) / 170 + i * 0.42) * (1 - i / 16);
    points.push(`${n(x)},${n(y)}`);
  }
  return `<polyline points="${points.join(' ')}"/>`;
}).join('');

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="${LARGEUR * 2}" height="${HAUTEUR * 2}" viewBox="0 0 ${LARGEUR} ${HAUTEUR}">
<defs>
<linearGradient id="fond" gradientUnits="userSpaceOnUse" x1="0" y1="4" x2="0" y2="${HAUTEUR}">
<stop offset="0" stop-color="${BLEU}"/><stop offset="1" stop-color="${BLEU_PROFOND}"/>
</linearGradient>
<clipPath id="bande"><path d="${BANDE}"/></clipPath>
</defs>
<path d="${BANDE}" transform="translate(0 -3)" fill="${ORANGE}"/>
<path d="${BANDE}" fill="url(#fond)"/>
<g clip-path="url(#bande)" fill="none" stroke="#ffffff" stroke-opacity="0.09" stroke-width="0.55">${ONDULATIONS}</g>
</svg>`;

let prepare: Promise<Buffer> | null = null;

export async function GET(): Promise<Response> {
  prepare ??= sharp(Buffer.from(SVG)).png({ compressionLevel: 9 }).toBuffer();
  const png = await prepare;
  return new Response(new Uint8Array(png), {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' },
  });
}
