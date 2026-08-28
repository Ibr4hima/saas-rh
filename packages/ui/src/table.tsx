import * as React from 'react';
import { cn } from './cn';

/**
 * Tableau de données — densité reprise de la plateforme APIX.
 *
 * L'en-tête est posé sur un fond légèrement creusé et écrit très petit, très
 * espacé, en gris : il oriente sans jamais concurrencer les données. Les
 * lignes sont séparées par un filet, pas par du vide : sur trente lignes, la
 * respiration coûte un écran de défilement et n'apporte rien.
 */
export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto">
      <table className={cn('w-full text-[12.5px]', className)} {...props} />
    </div>
  );
}

export function THead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('bg-bg', className)} {...props} />;
}

export function TBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={className} {...props} />;
}

export function Tr({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        'border-t border-line-soft transition-colors duration-150 hover:bg-bg/60',
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
        'border-b border-line-soft px-3.5 py-[11px] text-left text-[9.5px] font-extrabold tracking-[0.12em] whitespace-nowrap text-ink-muted uppercase',
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-3.5 py-[11px] align-middle text-ink', className)} {...props} />;
}
