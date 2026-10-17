import * as React from 'react';
import { cn } from './cn';

/**
 * Champ de saisie, en pilule comme les boutons et les listes.
 *
 * Les champs ont longtemps porté un coin doux pour se distinguer des boutons ;
 * la distinction se fait en réalité par le remplissage — un bouton est plein
 * ou bordé de la marque, un champ est blanc bordé de gris — et deux rayons
 * différents sur une même ligne se lisaient comme un défaut d'alignement.
 */
export function Input({
  className,
  autoComplete = 'off',
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      // Pas de propositions du navigateur sous les champs : son historique
      // (« DGUPLI, DMG, DG… ») masque ce qu'on tape et n'aide pas à saisir
      // la fiche d'un autre. La connexion, les mots de passe et le code reçu
      // demandent les leurs explicitement.
      autoComplete={autoComplete}
      className={cn(
        'h-10 w-full rounded-full border border-line bg-surface px-4 text-sm text-ink',
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
