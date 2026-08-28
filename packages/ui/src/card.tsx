import * as React from 'react';
import { cn } from './cn';

/**
 * Carte de contenu — matière reprise de la plateforme APIX.
 *
 * Un filet d'un pixel, AUCUNE ombre au repos. C'est le point de bascule du
 * style : une ombre permanente fait flotter chaque bloc et, quand tout flotte,
 * plus rien ne ressort. Le filet pose la carte sans la soulever ; la
 * profondeur est gardée pour le survol, où elle signifie « cliquable ».
 */
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-[14px] border border-card-line bg-surface', className)}
      {...props}
    />
  );
}

/** Carte cliquable : elle se soulève de 2 px et son filet passe à la marque. */
export function CardInteractive({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-[14px] border border-card-line bg-surface transition-all duration-200',
        'hover:-translate-y-0.5 hover:border-card-line-hover hover:shadow-sm',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-[18px] pt-4 pb-3', className)} {...props} />;
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
  return <div className={cn('px-[18px] pt-0 pb-[18px]', className)} {...props} />;
}
