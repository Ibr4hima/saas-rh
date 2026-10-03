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
 */
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-[16px] border border-card-line bg-surface shadow-xs', className)}
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

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 pt-0 pb-5', className)} {...props} />;
}
