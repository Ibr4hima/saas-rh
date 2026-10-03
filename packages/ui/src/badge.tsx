import * as React from 'react';
import { cn } from './cn';

/**
 * Les six tons de badge de la plateforme, et il n'y en a pas d'autre.
 *
 *   bleu   le bleu APIX : l'information, ce qui est prêt
 *   orange l'attente : ce qui réclame un geste (cf. la charte, tokens.css)
 *   teal   ce qui a abouti : approuvé, publié, valide
 *   rouge  ce qui a été refusé, révoqué, ce qui est échu
 *   prune  une catégorie, quand le sens n'est pas un état
 *   gris   ce qui est clos sans suite : annulé, brouillon, archivé
 */
export type BadgeTone = 'bleu' | 'orange' | 'teal' | 'rouge' | 'prune' | 'gris';

/**
 * Fond blanc (la carte, la nuit), le mot dans sa couleur, et un liseré de la
 * même couleur en plus clair. Le mot porte le sens ; la couleur n'est jamais
 * seule à le dire. Couleurs mesurées de jour et de nuit dans tokens.css.
 */
const tones: Record<BadgeTone, string> = {
  bleu: 'border-badge-bleu-line text-badge-bleu-ink',
  orange: 'border-badge-orange-line text-badge-orange-ink',
  teal: 'border-badge-teal-line text-badge-teal-ink',
  rouge: 'border-badge-rouge-line text-badge-rouge-ink',
  prune: 'border-badge-prune-line text-badge-prune-ink',
  gris: 'border-badge-gris-line text-badge-gris-ink',
};

/**
 * Deux tailles : la courante, pour une colonne de statuts ou un en-tête ; la
 * petite, posée dans une ligne de texte (« Sensible » après une phrase).
 * La hauteur est fixe, pour qu'une colonne de badges s'aligne au pixel quel
 * que soit le mot, avec ou sans icône.
 */
const tailles = {
  md: 'h-[22px] gap-1 px-2.5 text-[11.5px]',
  sm: 'h-[18px] gap-0.5 px-1.5 text-[10px]',
} as const;

export function Badge({
  tone = 'gris',
  size = 'md',
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone; size?: keyof typeof tailles }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border bg-surface leading-none font-semibold tracking-[0.01em] whitespace-nowrap',
        tailles[size],
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
