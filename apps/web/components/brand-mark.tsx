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
export function BrandMark({ variant }: { variant: 'full' | 'compact' }) {
  // Index dans LOGO_SOURCES ; au-delà de la liste, plus de fichier à tenter.
  const [candidate, setCandidate] = useState(0);
  const full = variant === 'full';
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
          'bg-[var(--tg-brand-plate)] object-contain',
          full
            ? // Largeur imposée, hauteur libre plafonnée : un logo large occupe
              // toute la barre, un logo haut reste à sa place.
              'max-h-14 w-full rounded-lg px-1 py-0.5'
            : 'h-8 w-auto max-w-28 shrink-0 rounded-md px-0.5',
        )}
        onError={() => setCandidate((i) => i + 1)}
      />
    );
  }
  return (
    <div
      className={cn(
        'flex items-center justify-center bg-primary font-bold text-primary-ink',
        full ? 'h-14 w-full rounded-lg text-lg tracking-[0.12em]' : 'size-8 rounded-md text-xs',
      )}
    >
      CH
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
        'text-center text-[13px] leading-none font-semibold tracking-[0.14em] text-ink-strong uppercase',
        className,
      )}
      {...props}
    >
      Capital Humain
    </p>
  );
}
