import * as React from 'react';
import { cn } from './cn';

/**
 * Tableau de données.
 *
 * Trois règles, et rien d'autre.
 *
 * 1. L'en-tête n'est pas une barre grise. Il se pose sur un blanc à peine
 *    creusé et se ferme par un filet net : il oriente le regard une fois,
 *    puis disparaît. Une bande franche, sur trente lignes, se relit trente
 *    fois pour rien.
 * 2. Les lignes sont séparées par un filet, jamais par du vide — mais elles
 *    respirent : 14 px de garde haute et basse, contre 11 auparavant. C'est
 *    la différence entre un relevé bancaire et un écran qu'on tient.
 * 3. La rangée sous le curseur se teinte franchement. Un tableau se lit en
 *    diagonale ; ce qui garde l'œil sur la bonne ligne vaut mieux que ce qui
 *    la décore.
 */
export function Table({
  className,
  pleine,
  ...props
}: React.TableHTMLAttributes<HTMLTableElement> & {
  /**
   * Le tableau EST le panneau qui défile — il prend la hauteur que la carte
   * lui laisse, et ses intitulés de colonne restent en place pendant que les
   * lignes passent dessous. Sans cela, un tableau dans une carte étirée
   * emporte son en-tête hors de vue au troisième tour de molette.
   *
   * Le conteneur doit alors être l'enfant flex DIRECT de la carte : c'est lui
   * qui défile, et `position: sticky` se mesure sur le plus proche ancêtre
   * défilant.
   */
  pleine?: boolean;
}) {
  return (
    <div className={cn(pleine ? 'min-h-0 flex-1 overflow-auto' : 'overflow-x-auto')}>
      <table className={cn('w-full text-[12.5px]', className)} {...props} />
    </div>
  );
}

/**
 * L'en-tête TIENT.
 *
 * Collé en haut du panneau qui défile, et opaque — un en-tête translucide
 * laisse passer les lignes qui glissent dessous. Sur un tableau qui ne
 * défile pas, `sticky` ne change rien : la règle ne coûte donc rien là où
 * elle ne sert pas.
 */
export function THead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('sticky top-0 z-10 bg-surface-raised', className)} {...props} />;
}

export function TBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={className} {...props} />;
}

export function Tr({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        'border-t border-line-soft transition-colors duration-150 hover:bg-hover',
        className,
      )}
      {...props}
    />
  );
}

export function Th({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        'border-b border-line px-4 py-3 text-left text-[9.5px] font-extrabold tracking-[0.12em] whitespace-nowrap text-ink-muted uppercase',
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-4 py-3.5 align-middle text-ink', className)} {...props} />;
}
