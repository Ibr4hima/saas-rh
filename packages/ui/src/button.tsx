import * as React from 'react';
import { cn } from './cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const variants: Record<Variant, string> = {
  primary:
    'border border-transparent bg-primary text-primary-ink shadow-bouton hover:bg-primary-hover active:shadow-bouton-enfonce',
  secondary:
    'border border-line bg-surface text-ink shadow-bouton-borde hover:bg-hover active:shadow-bouton-enfonce',
  ghost: 'text-ink-muted hover:bg-hover hover:text-ink',
  danger:
    'border border-transparent bg-danger text-white shadow-bouton hover:opacity-90 active:shadow-bouton-enfonce',
};

/**
 * Les boutons d'e-Voting : des rectangles aux coins à peine adoucis, pleins
 * ou bordés, une ombre fine dessous qui passe dedans quand on appuie.
 *
 * Les champs de saisie et les listes de choix ont la même forme. La
 * différence se fait par le remplissage, qui se voit sans qu'on l'apprenne :
 * un bouton est plein ou bordé de la marque, un champ est blanc bordé de
 * gris.
 */
const sizes: Record<Size, string> = {
  sm: 'h-[30px] rounded-controle-sm px-3 text-[12px]',
  md: 'h-[34px] rounded-controle px-3.5 text-[12.5px]',
  // Réservé à l'action unique d'une page — l'appel à candidature d'une offre
  // publique, par exemple. Dans l'application, `md` reste la taille de travail.
  lg: 'h-[42px] rounded-controle px-5 text-[14px]',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export function Button({
  className,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  children,
  type,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type ?? 'button'}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 font-semibold',
        'transition-[background-color,border-color,color,box-shadow,opacity] duration-150 ease-out',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
        'disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading ? (
        <span
          aria-hidden
          className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : null}
      {children}
    </button>
  );
}
