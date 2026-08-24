import * as React from 'react';
import { cn } from './cn';

/**
 * Surface de base du produit. Le relief vient d'une ombre en couches très
 * douce + un liseré à peine visible — jamais d'un bord épais. Coins 12px :
 * assez ronds pour être doux, assez droits pour rester sérieux.
 */
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-xl border border-line-soft bg-surface shadow-sm', className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('border-b border-line-soft px-5 py-4', className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn('text-[15px] font-semibold tracking-[-0.01em] text-ink-strong', className)}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 py-4', className)} {...props} />;
}
