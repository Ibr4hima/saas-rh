'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@teranga/ui';

/**
 * Emplacement réservé dans l'en-tête de l'écran, que la page vient remplir.
 *
 * Les onglets appartiennent à l'écran, pas à la coquille : c'est la page qui
 * connaît ses effectifs et ce qu'un onglet doit faire. Mais ils se posent DANS
 * l'en-tête, à côté du titre. Un portail règle les deux : la coquille laisse
 * la place, la page y écrit, et rien ne remonte de l'une à l'autre.
 */
export const ANCRE_ONGLETS = 'entete-onglets';

export interface Onglet {
  cle: string;
  label: string;
  compte?: number;
}

/**
 * Le contrôle lui-même, sans son emplacement.
 *
 * Il sert deux fois : dans l'en-tête sur écran large, et dans la page quand
 * l'en-tête n'a plus la place. Les mêmes coins aux deux endroits, ceux des
 * contrôles (ADR-0108) : 10 px pour le cadre, 7 px pour un onglet, et son
 * nombre en clair, sans pastille.
 */
export function Onglets({
  onglets,
  courant,
  onChange,
  className,
  label = 'Filtrer le personnel',
}: {
  onglets: Onglet[];
  courant: string;
  onChange: (cle: string) => void;
  className?: string;
  /** Ce que filtrent les onglets, pour les lecteurs d'écran. */
  label?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        'flex items-center gap-1 rounded-groupe border border-line-soft bg-bg p-1',
        className,
      )}
    >
      {onglets.map((o) => {
        const actif = o.cle === courant;
        return (
          <button
            key={o.cle}
            type="button"
            role="tab"
            aria-selected={actif}
            onClick={() => onChange(o.cle)}
            className={cn(
              'flex items-center gap-2 rounded-controle-sm px-3.5 py-1.5 text-[12.5px] font-bold whitespace-nowrap transition-colors duration-150',
              'focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none',
              actif ? 'bg-surface text-primary shadow-sm' : 'text-ink-muted hover:text-ink',
            )}
          >
            {o.label}
            {o.compte !== undefined ? (
              <span
                className={cn(
                  'text-[11px] font-semibold',
                  actif ? 'text-primary' : 'text-ink-muted',
                )}
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {o.compte}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function OngletsDeLEntete({
  onglets,
  courant,
  onChange,
}: {
  onglets: Onglet[];
  courant: string;
  onChange: (cle: string) => void;
}) {
  // Le portail ne peut viser sa cible qu'après le premier rendu du client :
  // au rendu serveur, l'élément n'existe pas encore.
  const [cible, setCible] = React.useState<HTMLElement | null>(null);
  React.useEffect(() => setCible(document.getElementById(ANCRE_ONGLETS)), []);
  if (!cible) return null;

  return createPortal(
    // Posé sur le fond, le cadre prend le voile d'encre des rangées du menu :
    // le gris de la page ne le dessinerait pas sur le gris de la page.
    <Onglets
      onglets={onglets}
      courant={courant}
      onChange={onChange}
      className="border-transparent bg-menu-survol"
    />,
    cible,
  );
}
