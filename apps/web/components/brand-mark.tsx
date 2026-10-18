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
 * Marque de l'organisation, partagée par le menu, l'en-tête du téléphone et
 * l'écran de connexion : un seul endroit, pour que les trois ne divergent
 * jamais. Le logo tient toute la largeur qu'on lui donne : c'est la signature
 * de l'employeur, pas une vignette. Cf. apps/web/public/README.md.
 */
export function BrandMark({
  variant,
  repli,
}: {
  variant: 'full' | 'menu' | 'barre' | 'compact' | 'candidature' | 'connexion' | 'entete';
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
          // En tête du menu, et de l'en-tête du téléphone : posé à même le
          // fond, en ses couleurs ; le blanc pur la nuit (ADR-0115).
          variant === 'menu' && 'logo-coquille h-12 w-auto max-w-[10rem] shrink-0 bg-transparent',
          variant === 'barre' && 'logo-coquille h-9 w-auto max-w-28 shrink-0 bg-transparent',
          // Écran de connexion : le logo à sa pleine mesure, c'est la
          // signature de la maison, pas la vignette d'une barre de navigation.
          // Ses encres sur l'aplat clair, le blanc pur sur le dôme de nuit.
          variant === 'connexion' && 'login-logo h-11 w-auto max-w-[190px] bg-transparent',
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
        // Sur le fond, pas d'aplat : le bleu de la charte suffit.
        variant === 'menu' && 'h-12 shrink-0 px-0.5 text-[17px] tracking-[0.16em] text-primary',
        variant === 'barre' && 'h-9 shrink-0 px-0.5 text-[15px] tracking-[0.16em] text-primary',
        variant === 'connexion' &&
          'h-11 px-1 text-xl tracking-[0.16em] text-[color:var(--login-encre)]',
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
