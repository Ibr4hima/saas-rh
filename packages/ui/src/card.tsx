import * as React from 'react';
import { cn } from './cn';

/**
 * Carte de contenu.
 *
 * Le fond de page est presque blanc : une carte blanche posée dessus ne se
 * distingue plus par sa couleur, elle se distingue par son BORD. D'où un
 * filet d'un pixel très pâle DOUBLÉ d'une ombre d'un pixel — pas une ombre
 * portée, qui ferait flotter chaque bloc, mais le trait de crayon sous le
 * filet qui suffit à décoller la carte du papier. C'est tout ce qu'elle
 * porte au repos ; la vraie profondeur reste réservée au survol de ce qui
 * se clique, où elle veut dire quelque chose.
 *
 * Un tableau posé contre un bord de la carte le touche, quelle que soit la
 * marge que l'écran donne à la carte : elle n'en a pas de ce côté-là. La
 * ligne survolée remplit ainsi la carte jusqu'au filet, coins compris. La
 * règle vit ici, une fois pour toutes, et non écran par écran.
 */
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-[16px] border border-card-line bg-surface shadow-xs',
        '[&:has(>[data-tableau]:first-child)]:pt-0 [&:has(>[data-tableau]:last-child)]:pb-0',
        // Le même tableau, seul dans le bloc du bord (un CardContent).
        '[&:has(>:first-child>[data-tableau]:only-child)]:pt-0',
        '[&:has(>:last-child>[data-tableau]:only-child)]:pb-0',
        className,
      )}
      {...props}
    />
  );
}

/** Carte cliquable : elle se soulève de 2 px et son filet passe à la marque. */
export function CardInteractive({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-[16px] border border-card-line bg-surface shadow-xs transition-all duration-200',
        'hover:-translate-y-0.5 hover:border-card-line-hover hover:shadow-md',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 pt-[17px] pb-3.5', className)} {...props} />;
}

/**
 * Titre de carte en petites capitales de marque : le même signal que les
 * sections des fenêtres de saisie. L'écran gagne une grammaire unique — un
 * intitulé bleu espacé annonce toujours un groupe, qu'il soit dans une carte
 * ou dans un formulaire.
 */
export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn(
        'text-[10.5px] font-extrabold tracking-[0.14em] text-primary uppercase',
        className,
      )}
      {...props}
    />
  );
}

/**
 * Au bord de la carte, le contenu en reprend l'arrondi : un tableau posé
 * dedans le reçoit à son tour, et sa ligne survolée reste dans les coins.
 * Seul dans le contenu, le tableau va jusqu'aux bords de la carte : le
 * contenu perd alors sa marge.
 */
export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'px-5 pt-0 pb-5 first:rounded-t-[inherit] last:rounded-b-[inherit]',
        '[&:has(>[data-tableau]:only-child)]:p-0',
        className,
      )}
      {...props}
    />
  );
}
