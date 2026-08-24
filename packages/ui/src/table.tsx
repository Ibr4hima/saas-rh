import * as React from 'react';
import { cn } from './cn';

/**
 * Tableau de données. Les choix qui le rendent lisible :
 * — en-têtes en 11px espacés, presque effacés : ils orientent sans crier ;
 * — filets uniquement horizontaux, très clairs : l'œil suit la ligne ;
 * — chiffres tabulaires à poser par cellule (font-mono) pour les colonnes
 *   numériques ;
 * — survol de ligne à peine teinté : on sait où l'on est sans clignotement.
 */
export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto">
      <table className={cn('w-full text-sm', className)} {...props} />
    </div>
  );
}

export function THead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('border-b border-line-soft', className)} {...props} />;
}

export function TBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('divide-y divide-line-soft', className)} {...props} />;
}

export function Tr({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={cn('transition-colors duration-150 hover:bg-bg/70', className)} {...props} />
  );
}

export function Th({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        'px-5 py-3 text-left text-[11px] font-semibold tracking-[0.08em] text-ink-muted/80 uppercase',
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-5 py-3.5 text-ink', className)} {...props} />;
}
