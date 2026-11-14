import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Fusion de classes Tailwind sans conflits — l'utilitaire standard du design system. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
