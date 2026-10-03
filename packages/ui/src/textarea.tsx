import * as React from 'react';
import { cn } from './cn';

/**
 * Zone de texte. Le rayon suit celui des champs en pilule sans aller
 * jusqu'au demi-cercle : sur un pavé de plusieurs lignes, un bord entièrement
 * rond rognerait les premiers et derniers caractères de chaque côté.
 */
export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'min-h-24 w-full rounded-[18px] border border-line bg-surface px-4 py-2.5 text-sm text-ink',
        'placeholder:text-ink-muted/70',
        'transition-colors duration-150 ease-out',
        'focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary/40',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
