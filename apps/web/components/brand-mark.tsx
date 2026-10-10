'use client';

import * as React from 'react';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { cn } from '@teranga/ui';

/**
 * L'adresse du logo installé, que le serveur a trouvé (cf.
 * lib/logo-installe.ts) ; null sans fichier. Le navigateur n'essaie plus le
 * SVG puis le PNG : une 404 arrivée avant l'hydratation se comptait deux
 * fois, le PNG était sauté et « CH » prenait la place du logo.
 */
export const LogoContext = createContext<string | null>(null);

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
  variant: 'full' | 'hero' | 'compact' | 'candidature' | 'connexion' | 'entete';
  /**
   * Ce qui s'affiche à défaut de fichier de logo. « CH » convient à
   * l'application, qui est le portail ; pas à la page publique d'une offre,
   * où c'est l'employeur que le candidat doit reconnaître.
   */
  repli?: React.ReactNode;
}) {
  const src = useContext(LogoContext);
  // Le fichier existe : il est là dès le HTML, visible sans attendre. Le
  // repli ne vient que s'il ne se charge vraiment pas.
  const [echec, setEchec] = useState(false);
  const img = useRef<HTMLImageElement>(null);

  // Une erreur survenue avant l'hydratation n'arrive plus à `onError` : on
  // relit l'image au montage. `decode()` et non `naturalWidth`, qui vaut 0
  // pour un SVG sans dimensions dans certains navigateurs.
  useEffect(() => {
    const el = img.current;
    if (!el?.complete) return;
    let actif = true;
    el.decode().catch(() => {
      if (actif) setEchec(true);
    });
    return () => {
      actif = false;
    };
  }, [src]);

  if (src && !echec) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        ref={img}
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
          // Écran de connexion : le logo se pose sur le dôme de marque, en
          // blanc pur et à sa pleine mesure — c'est la signature de la maison,
          // pas la vignette d'une barre de navigation.
          variant === 'connexion' && 'hero-logo h-11 w-auto max-w-[190px] bg-transparent',
          variant === 'compact' && 'h-8 w-auto max-w-28 shrink-0 rounded-md px-0.5',
          // Page publique : le logo est la première chose que voit le
          // candidat, il a droit à sa pleine mesure.
          variant === 'candidature' && 'h-14 w-auto max-w-[200px] rounded-lg bg-transparent',
          // En-tête d'une page publique : la signature, à mesure de barre.
          // `self-start` : posé dans une colonne flexible, il s'y étirerait à
          // sa largeur maximale et s'y centrerait, décollé du texte.
          variant === 'entete' && 'h-12 w-auto max-w-[200px] self-start bg-transparent',
        )}
        onError={() => setEchec(true)}
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
        variant === 'connexion' && 'h-11 px-1 text-xl tracking-[0.16em] text-hero-ink',
        variant === 'compact' && 'size-8 rounded-md bg-primary text-xs text-primary-ink',
        variant === 'candidature' &&
          'size-14 rounded-[18px] bg-primary text-[22px] text-primary-ink',
        variant === 'entete' &&
          'size-12 self-start rounded-[14px] bg-primary text-[19px] text-primary-ink',
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
