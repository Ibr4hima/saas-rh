'use client';

import * as React from 'react';
import { useState } from 'react';
import { cn } from '@teranga/ui';

/**
 * Fichiers de logo essayés dans l'ordre. Le SVG passe en premier : c'est le
 * seul format qui reste net à toutes les tailles ET qui porte une vraie
 * transparence, donc le seul qui se pose sur le fond sans plaque blanche
 * derrière lui. Le PNG reste accepté pour ne pas casser une installation
 * existante ; sans aucun des deux, on retombe sur l'aplat de marque.
 */
const LOGO_SOURCES = ['/logo-apix.svg', '/logo-apix.png'];

/**
 * Marque de l'organisation, partagée par la barre latérale, l'en-tête mobile
 * et l'écran de connexion — un seul endroit pour que les trois ne divergent
 * jamais. Le logo tient toute la largeur qu'on lui donne : c'est la signature
 * de l'employeur, pas une vignette. Cf. apps/web/public/README.md.
 */
export function BrandMark({
  variant,
  repli,
}: {
  variant: 'full' | 'hero' | 'compact' | 'candidature';
  /**
   * Ce qui s'affiche à défaut de fichier de logo. « CH » convient à
   * l'application, qui est le portail ; pas à la page publique d'une offre,
   * où c'est l'employeur que le candidat doit reconnaître.
   */
  repli?: React.ReactNode;
}) {
  // Index dans LOGO_SOURCES ; au-delà de la liste, plus de fichier à tenter.
  const [candidate, setCandidate] = useState(0);
  const src = LOGO_SOURCES[candidate];

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt="Logo de l'organisation"
        className={cn(
          // La plaque est TRANSPARENTE en clair : le logo se pose directement
          // sur la barre. Elle réapparaît en sombre, faute de quoi un logo à
          // encre foncée — le cas courant — disparaîtrait dans le fond.
          // Largeur imposée, hauteur libre plafonnée : un logo large occupe
          // toute la place offerte, un logo haut reste à sa mesure.
          'bg-[var(--tg-brand-plate)] object-contain',
          variant === 'full' && 'max-h-14 w-full rounded-lg px-1 py-0.5',
          // Sur le bandeau, le logo se pose en blanc pur : la plaque n'a plus
          // lieu d'être, et ses encres foncées disparaîtraient dans le bleu.
          variant === 'hero' && 'hero-logo h-8 w-auto max-w-32 shrink-0 bg-transparent',
          variant === 'compact' && 'h-8 w-auto max-w-28 shrink-0 rounded-md px-0.5',
          // Page publique : le logo est la première chose que voit le
          // candidat, il a droit à sa pleine mesure.
          variant === 'candidature' && 'h-14 w-auto max-w-[200px] rounded-lg bg-transparent',
        )}
        onError={() => setCandidate((i) => i + 1)}
      />
    );
  }
  return (
    <div
      className={cn(
        'flex items-center justify-center font-bold',
        variant === 'full' &&
          'h-14 w-full rounded-lg bg-primary text-lg tracking-[0.12em] text-primary-ink',
        // Sur le bandeau, pas d'aplat : l'encre blanche suffit.
        variant === 'hero' && 'h-8 shrink-0 px-1 text-base tracking-[0.14em] text-hero-ink',
        variant === 'compact' && 'size-8 rounded-md bg-primary text-xs text-primary-ink',
        variant === 'candidature' &&
          'size-14 rounded-[18px] bg-primary text-[22px] text-primary-ink',
      )}
    >
      {repli ?? 'CH'}
    </div>
  );
}

/** Le nom du portail, tel qu'il s'affiche sous le logo partout. */
export function BrandWordmark({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    // Capitales espacées : la mention se lit comme une signature, pas comme
    // une première entrée de menu.
    <p
      className={cn(
        'text-center text-[10px] leading-none font-semibold tracking-[0.2em] text-ink-muted uppercase',
        className,
      )}
      {...props}
    >
      Capital Humain
    </p>
  );
}
