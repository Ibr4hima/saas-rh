'use client';

import * as React from 'react';
import { useState } from 'react';
import { cn } from '@teranga/ui';

/**
 * Marque de l'organisation, partagée par la barre latérale, l'en-tête mobile
 * et l'écran de connexion — un seul endroit pour que les trois ne divergent
 * jamais. Le logo tient toute la largeur qu'on lui donne : c'est la signature
 * de l'employeur, pas une vignette. Fichier attendu en
 * apps/web/public/logo-apix.png (cf. le README qui s'y trouve) ; sans lui, on
 * retombe sur un aplat de marque — jamais sur un cadre vide.
 */
export function BrandMark({ variant }: { variant: 'full' | 'compact' }) {
  const [imgOk, setImgOk] = useState(true);
  const full = variant === 'full';

  if (imgOk) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src="/logo-apix.png"
        alt="Logo de l'organisation"
        className={
          full
            ? // Largeur imposée, hauteur libre plafonnée : un logo large occupe
              // toute la barre, un logo haut reste à sa place — l'identité se
              // pose, elle n'écrase pas la navigation qui la suit.
              'max-h-14 w-full rounded-lg bg-white object-contain px-2 py-1.5'
            : 'h-8 w-auto max-w-28 shrink-0 rounded-md bg-white object-contain px-1'
        }
        onError={() => setImgOk(false)}
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
