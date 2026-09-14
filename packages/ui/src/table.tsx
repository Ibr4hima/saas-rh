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
export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto">
      <table className={cn('w-full text-[12.5px]', className)} {...props} />
    </div>
  );
}

export function THead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('bg-surface-raised', className)} {...props} />;
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
