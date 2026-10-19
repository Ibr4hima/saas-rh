'use client';

import { useId } from 'react';

/*
   Le sceau d'un agent, à côté de son nom : la rosette « verified » de
   Material Symbols, pleine, la coche en blanc. Au bleu de l'APIX pour un
   agent actif ; en gris, barrée comme « verified_off », pour un inactif. La
   rosette est celle de la police d'icônes ; ses pointes s'arrondissent d'un
   trait de la même teinte, et la coche, tracée, finit en bouts ronds. Un
   dégradé en diagonale et une ombre douce lui donnent du relief. La barre
   dépasse de la rosette et s'en détache par un vide, qui laisse voir le fond
   quel qu'il soit. Les couleurs sont des jetons (`--tg-sceau-*`), plus
   claires en thème sombre ; la coche reste blanche.
*/

/** La rosette de Material Symbols (FILL 1, wght 400, opsz 20), en unités de la police. */
const ROSETTE =
  'M347 888 272 764 131 732 144 588 48 480 144 372 131 228 272 196 347 72 480 129 613 72 688 196 829 228 816 372 912 480 816 588 829 732 688 764 613 888 480 831Z';

/** La coche, tracée : le milieu de celle de la police. */
const COCHE = 'M344.1 488.8 L429 573 L616 386.9';

/** La barre d'un inactif, du haut à gauche au bas à droite, et le vide de chaque côté. */
const BARRE = 'M130 130 L830 830';
const EPAISSEUR_DE_LA_BARRE = 80;
const VIDE = 52;

export function Sceau({ actif, taille = 18 }: { actif: boolean; taille?: number }) {
  // Un identifiant par sceau : le dégradé d'un sceau ne doit pas servir à l'autre.
  const id = `sceau-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const teinte = actif ? 'bleu' : 'gris';
  const motif = (
    <>
      <path
        d={ROSETTE}
        fill={`url(#${id})`}
        stroke={`url(#${id})`}
        strokeWidth={100}
        strokeLinejoin="round"
      />
      <path
        d={COCHE}
        fill="none"
        stroke="#fff"
        strokeWidth={92}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  );
  return (
    <svg
      aria-hidden
      viewBox="-16 -16 992 992"
      width={taille}
      height={taille}
      className="shrink-0"
      style={{ filter: `drop-shadow(0 1px 1.5px var(--tg-sceau-${teinte}-ombre))` }}
    >
      <defs>
        <linearGradient id={id} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" style={{ stopColor: `var(--tg-sceau-${teinte}-haut)` }} />
          <stop offset="1" style={{ stopColor: `var(--tg-sceau-${teinte}-bas)` }} />
        </linearGradient>
        {actif ? null : (
          <mask
            id={`${id}-barre`}
            maskUnits="userSpaceOnUse"
            x="-16"
            y="-16"
            width="992"
            height="992"
          >
            <rect x="-16" y="-16" width="992" height="992" fill="#fff" />
            <path
              d={BARRE}
              stroke="#000"
              strokeWidth={EPAISSEUR_DE_LA_BARRE + 2 * VIDE}
              strokeLinecap="round"
            />
          </mask>
        )}
      </defs>
      {actif ? (
        motif
      ) : (
        <>
          <g mask={`url(#${id}-barre)`}>{motif}</g>
          <path
            d={BARRE}
            stroke={`url(#${id})`}
            strokeWidth={EPAISSEUR_DE_LA_BARRE}
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  );
}
