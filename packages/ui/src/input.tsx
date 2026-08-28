import * as React from 'react';
import { cn } from './cn';

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink',
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
