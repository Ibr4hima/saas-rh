import * as React from 'react';
import { cn } from './cn';

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn('mb-1.5 block text-sm font-medium text-ink-strong', className)}
      {...props}
    />
  );
}
