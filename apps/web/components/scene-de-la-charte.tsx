'use client';

import * as React from 'react';
import { BrandMark } from './brand-mark';
import { useThemeClair } from './preferences';

/* ── Les motifs de la charte ─────────────────────────────────────────
   La courbe du bas et les ondulations, tracées comme sur le certificat
   d'APIX Academy et au bas des courriels (ADR-0185, ADR-0186) : le même
   bord de courbe que le papier à en-tête, en points de l'A4. */
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

/** La bande, en unités de son cadre : étirée sur la largeur de l'écran. */
const BANDE_L = 1440;
const BANDE_H = 120;
const n = (v: number) => Number(v.toFixed(1));
const enX = (x: number) => (x * BANDE_L) / 595.28;
/**
 * La courbe part à 52 du haut, à gauche, et monte à 4, à droite. Sous son
 * creux, le pied garde de l'air, même quand la bande s'abaisse.
 */
const enY = (y: number) => 4 + ((y - 705.59) * 48) / (769.7 - 705.59);
const ARCS_BANDE = ARCS.map((arc) => arc.map(([x, y]) => [enX(x), enY(y)] as const));

/** Le bord de la courbe, échantillonné de gauche à droite. */
const BORD = ARCS_BANDE.flatMap((arc, i) =>
  Array.from({ length: 33 }, (_, k) => k / 32)
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

const TRACE_BANDE =
  `M${n(ARCS_BANDE[0]![0]![0])} ${n(ARCS_BANDE[0]![0]![1])}` +
  ARCS_BANDE.map(
    ([, p1, p2, p3]) =>
      `C${n(p1![0])} ${n(p1![1])} ${n(p2![0])} ${n(p2![1])} ${n(p3![0])} ${n(p3![1])}`,
  ).join('') +
  `L${BANDE_L} ${BANDE_H}L0 ${BANDE_H}Z`;

/** Les ondulations de la bande : des lignes qui suivent la courbe. */
const ONDES_BANDE = Array.from({ length: 12 }, (_, i) => {
  const points: string[] = [];
  for (let x = 0; x <= BANDE_L; x += 12) {
    const y =
      bordA(x) + 8 + i * 7.5 + 2.4 * Math.sin((2 * Math.PI * x) / 260 + i * 0.4) * (1 - i / 14);
    points.push(`${n(x)},${n(y)}`);
  }
  return points.join(' ');
});

/** Les ondulations du coin, qui montent vers la droite comme la courbe. */
const ONDES_COIN = Array.from({ length: 20 }, (_, k) => {
  const points: string[] = [];
  for (let x = 0; x <= 640; x += 10) {
    const y = 26 + k * 15 - 0.42 * x + 11 * Math.sin((2 * Math.PI * x) / 380 + k * 0.25);
    points.push(`${n(x)},${n(y)}`);
  }
  return points.join(' ');
});

/**
 * La courbe bleue de la charte, soulignée d'orange, au bas de l'écran. Le
 * cadre s'étire en largeur ; les ondulations gardent leur trait d'un pixel.
 */
function CourbeDeLaCharte() {
  const id = React.useId().replace(/:/g, '');
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${BANDE_L} ${BANDE_H}`}
      preserveAspectRatio="none"
      className="block h-[136px] w-full sm:h-[120px] sm:court:h-[92px]"
    >
      <defs>
        <linearGradient id={`${id}-fond`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#004f91" />
          <stop offset="1" stopColor="#003a6c" />
        </linearGradient>
        <clipPath id={`${id}-bande`}>
          <path d={TRACE_BANDE} />
        </clipPath>
      </defs>
      <path d={TRACE_BANDE} transform="translate(0 -4)" fill="#ca631f" />
      <path d={TRACE_BANDE} fill={`url(#${id}-fond)`} />
      <g clipPath={`url(#${id}-bande)`} fill="none" stroke="#ffffff" strokeOpacity="0.09">
        {ONDES_BANDE.map((points, i) => (
          <polyline key={i} points={points} vectorEffect="non-scaling-stroke" />
        ))}
      </g>
    </svg>
  );
}

/** Les ondulations du coin, à peine visibles, qui s'effacent vers le centre. */
function OndulationsDuCoin() {
  const id = React.useId().replace(/:/g, '');
  return (
    <svg
      aria-hidden
      viewBox="0 0 640 420"
      className="pointer-events-none absolute top-0 right-0 -z-10 hidden h-[420px] w-[640px] max-w-[90vw] text-primary/15 sm:block"
    >
      <defs>
        <linearGradient id={`${id}-fondu`} x1="1" y1="0" x2="0.15" y2="0.85">
          <stop offset="0" stopColor="#fff" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id={`${id}-masque`}>
          <rect width="640" height="420" fill={`url(#${id}-fondu)`} />
        </mask>
      </defs>
      <g mask={`url(#${id}-masque)`} fill="none" stroke="currentColor" strokeWidth="1">
        {ONDES_COIN.map((points, i) => (
          <polyline key={i} points={points} />
        ))}
      </g>
    </svg>
  );
}

/**
 * La scène à la charte de l'APIX : la marque et sa signature en tête, le
 * contenu au milieu, la courbe de la charte au bas de l'écran avec le pied
 * en blanc, les ondulations dans le coin. Toujours en clair.
 *
 * Les écrans d'avant le compte (ADR-0187) et la vérification d'un
 * certificat (ADR-0188) la partagent : une seule scène, pour que ces pages
 * ne divergent jamais. Sur un écran bas, les marges se resserrent et la
 * courbe s'abaisse : le contenu tient sans défilement.
 */
export function SceneDeLaCharte({
  signature,
  repli,
  droite,
  children,
}: {
  /** La ligne en capitales sous le logo. */
  signature: string;
  /** Ce qui s'affiche à défaut de fichier de logo. */
  repli?: React.ReactNode;
  /** À droite du pied, en face des droits. */
  droite?: React.ReactNode;
  children: React.ReactNode;
}) {
  useThemeClair();
  return (
    <main className="relative isolate flex min-h-dvh flex-col overflow-hidden bg-bg">
      <OndulationsDuCoin />

      <div className="flex flex-1 flex-col items-center justify-center px-5 pt-7 pb-6 sm:pt-12 sm:pb-10 court:pt-5 court:pb-5">
        <div className="login-monte flex flex-col items-center">
          <BrandMark variant="connexion" repli={repli} />
          <div className="mt-4 flex items-center gap-3.5 court:mt-3">
            <span className="hidden h-px w-11 bg-linear-to-r from-transparent to-primary/30 sm:block" />
            <p className="text-center text-[10.5px] font-bold tracking-[0.16em] text-primary uppercase">
              {signature}
            </p>
            <span className="hidden h-px w-11 bg-linear-to-r from-primary/30 to-transparent sm:block" />
          </div>
        </div>

        {children}
      </div>

      {/* Le pied, en blanc sur la courbe de la charte. */}
      <footer className="relative shrink-0">
        <CourbeDeLaCharte />
        <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-0.5 px-6 pb-4 text-[11.5px] text-white/85 sm:flex-row sm:justify-between sm:px-10 sm:pb-5 sm:court:pb-3.5">
          <span>© {new Date().getFullYear()} APIX S.A · DCH. Tous droits réservés.</span>
          {droite ? <span>{droite}</span> : null}
        </div>
      </footer>
    </main>
  );
}
