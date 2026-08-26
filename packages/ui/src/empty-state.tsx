import * as React from 'react';
import { cn } from './cn';

interface EmptyStateProps {
  /** Icône du domaine — la même que dans la navigation, pour que l'écran vide
      dise de QUOI il est vide. */
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

/**
 * État vide — le premier écran que verra l'organisation le jour du démarrage,
 * et celui qu'elle reverra chaque fois qu'un filtre ne ramène rien.
 *
 * Une phrase grise centrée ressemble à une panne. Une icône de domaine dans un
 * cartouche, un titre qui NOMME ce qui manque et une phrase qui dit le geste à
 * faire transforment le cul-de-sac en point de départ (ch. 05).
 */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}
    >
      {icon ? (
        <span className="mb-3.5 flex size-11 items-center justify-center rounded-2xl bg-primary/[0.07] text-primary/70">
          {icon}
        </span>
      ) : null}
      <p className="text-[13px] font-semibold text-ink-strong">{title}</p>
      {description ? (
        <p className="mt-1 max-w-xs text-[12px] leading-relaxed text-ink-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
