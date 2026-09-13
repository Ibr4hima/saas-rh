import * as React from 'react';
import { cn } from './cn';

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'primary';

/**
 * Pastille d'état.
 *
 * Trois couches, et c'est ce qui la sort de l'étiquette plate : un aplat très
 * pâle, un liseré INTÉRIEUR de la même teinte — c'est lui qui donne le bord
 * net, là où un aplat seul bave sur le fond — et, au besoin, un point de
 * couleur devant le mot. Le point ne décore pas : il permet de repérer la
 * colonne d'un coup d'œil sans lire, et il fait tenir l'information sur autre
 * chose que la couleur seule, pour qui ne la distingue pas.
 */
const tones: Record<Tone, string> = {
  neutral: 'bg-line-soft text-ink-muted ring-ink-muted/20',
  success: 'bg-success-soft text-success ring-success/25',
  warning: 'bg-warning-soft text-warning ring-warning/25',
  danger: 'bg-danger-soft text-danger ring-danger/25',
  primary: 'bg-primary-soft text-primary ring-primary/25',
};

export function Badge({
  tone = 'neutral',
  dot = false,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  tone?: Tone;
  /** Un point devant le mot : pour les colonnes d'état qu'on parcourt. */
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[11px] font-semibold ring-1 ring-inset',
        tones[tone],
        className,
      )}
      {...props}
    >
      {dot ? <span aria-hidden className="size-[5px] shrink-0 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}
