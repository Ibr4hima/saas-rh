import * as React from 'react';
import { cn } from './cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const variants: Record<Variant, string> = {
  primary: 'bg-primary text-primary-ink hover:bg-primary-hover',
  secondary: 'border border-line bg-surface text-ink hover:bg-bg',
  ghost: 'text-ink-muted hover:bg-bg hover:text-ink',
  danger: 'bg-danger text-white hover:opacity-90',
};

/**
 * Boutons en pilule, comme sur la plateforme APIX. Le coin arrondi les
 * détache des champs de saisie, qui restent à angle doux : à l'écran, on
 * distingue d'un coup d'œil ce qui se remplit de ce qui s'actionne.
 */
const sizes: Record<Size, string> = {
  sm: 'h-[30px] px-3.5 text-[12px]',
  md: 'h-[34px] px-4 text-[12.5px]',
  // Réservé à l'action unique d'une page — l'appel à candidature d'une offre
  // publique, par exemple. Dans l'application, `md` reste la taille de travail.
  lg: 'h-[42px] px-6 text-[14px]',
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
        'inline-flex items-center justify-center gap-2 rounded-full font-semibold',
        'transition-colors duration-150 ease-out',
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
