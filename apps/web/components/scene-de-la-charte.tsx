'use client';

import * as React from 'react';
import { BrandMark } from './brand-mark';
import { useThemeClair } from './preferences';

/* ── Les motifs de la charte ─────────────────────────────────────────
   Les ondulations du coin, comme sur la page de garde de la charte. Le bas
   de l'écran n'a plus la courbe du papier à en-tête (ADR-0229). */
const n = (v: number) => Number(v.toFixed(1));

/** Les ondulations du coin, qui montent vers la droite. */
const ONDES_COIN = Array.from({ length: 20 }, (_, k) => {
  const points: string[] = [];
  for (let x = 0; x <= 640; x += 10) {
    const y = 26 + k * 15 - 0.42 * x + 11 * Math.sin((2 * Math.PI * x) / 380 + k * 0.25);
    points.push(`${n(x)},${n(y)}`);
  }
  return points.join(' ');
});

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
 * contenu au milieu, les ondulations dans le coin. Au bas de l'écran, un
 * pied droit et discret : un filet, les droits et la mention de droite en
 * gris, puis le liseré de la charte, de l'orange au bleu comme sur sa
 * couverture (ADR-0229). Toujours en clair.
 *
 * Les écrans d'avant le compte (ADR-0187) et la vérification d'un
 * certificat (ADR-0188) la partagent : une seule scène, pour que ces pages
 * ne divergent jamais. Sur un écran bas, les marges se resserrent : le
 * contenu tient sans défilement.
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

      {/* Le pied, droit : les mentions sur le fond, sous un filet, puis le
          liseré de la charte tout en bas. */}
      <footer className="shrink-0 border-t border-line-soft">
        <div className="flex flex-col items-center gap-0.5 px-6 py-4 text-[11.5px] text-ink-muted sm:flex-row sm:justify-between sm:px-10 sm:py-5 court:py-3">
          <span>© {new Date().getFullYear()} APIX S.A · DCH. Tous droits réservés.</span>
          {droite ? <span>{droite}</span> : null}
        </div>
        <div aria-hidden className="h-1 bg-linear-to-r from-[#ca631f] to-[#004f91]" />
      </footer>
    </main>
  );
}
