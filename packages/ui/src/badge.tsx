import * as React from 'react';
import { cn } from './cn';

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'primary';

/**
 * Pastille d'état.
 *
 * Deux couches, et c'est ce qui la sort de l'étiquette plate : un aplat très
 * pâle, et un liseré INTÉRIEUR de la même teinte — c'est lui qui donne le
 * bord net, là où un aplat seul bave sur le fond. Le mot porte tout le reste ;
 * il est toujours écrit, donc la couleur n'est jamais seule à renseigner.
 */
/**
 * Les aplats sont servis à 55 % : la teinte douce des tokens, diluée dans la
 * surface qui la porte. À pleine force, une colonne de pastilles pesait plus
 * que les données autour d'elle. Le liseré, lui, garde toute sa densité — c'est
 * lui qui tient la forme, et un aplat pâle sans bord se dissoudrait.
 */
const tones: Record<Tone, string> = {
  neutral: 'bg-line-soft/55 text-ink-muted ring-ink-muted/20',
  success: 'bg-success-soft/55 text-success ring-success/25',
  warning: 'bg-warning-soft/55 text-warning ring-warning/25',
  danger: 'bg-danger-soft/55 text-danger ring-danger/25',
  primary: 'bg-primary-soft/55 text-primary ring-primary/25',
};

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-[3px] text-[11px] font-semibold ring-1 ring-inset',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
