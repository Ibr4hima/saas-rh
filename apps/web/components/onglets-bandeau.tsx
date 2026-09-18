'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@teranga/ui';

/**
 * Emplacement réservé dans la bande de tête, que la page vient remplir.
 *
 * Les onglets appartiennent à l'écran, pas à la coquille : c'est la page qui
 * connaît ses effectifs et ce qu'un onglet doit faire. Mais ils se posent DANS
 * le bandeau, à côté du titre. Un portail règle les deux : la coquille laisse
 * la place, la page y écrit, et rien ne remonte de l'une à l'autre.
 */
export const ANCRE_ONGLETS = 'bandeau-onglets';

export interface Onglet {
  cle: string;
  label: string;
  compte?: number;
}

/**
 * Le contrôle lui-même, sans son emplacement.
 *
 * Il sert deux fois : dans le bandeau sur écran large, et dans la carte quand
 * le bandeau n'a plus la place. `sombre` dit lequel des deux fonds il habille
 * — sur le bleu de marque, les encres s'inversent.
 */
export function Onglets({
  onglets,
  courant,
  onChange,
  sombre = false,
  className,
}: {
  onglets: Onglet[];
  courant: string;
  onChange: (cle: string) => void;
  sombre?: boolean;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label="Filtrer le personnel"
      className={cn(
        'flex items-center gap-1 rounded-full border p-1',
        sombre ? 'border-white/20 bg-white/10' : 'border-line-soft bg-bg',
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
              'flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[12.5px] font-bold whitespace-nowrap transition-colors duration-150',
              'focus-visible:outline-none',
              sombre
                ? 'focus-visible:ring-2 focus-visible:ring-white/70'
                : 'focus-visible:ring-2 focus-visible:ring-primary/40',
              actif
                ? 'bg-surface text-primary shadow-sm'
                : sombre
                  ? 'text-hero-ink/75 hover:bg-white/10 hover:text-hero-ink'
                  : 'text-ink-muted hover:text-ink',
            )}
          >
            {o.label}
            {o.compte !== undefined ? (
              <span
                className={cn(
                  'rounded-full px-1.5 py-px text-[10.5px] font-extrabold',
                  actif
                    ? 'bg-primary/[0.12] text-primary'
                    : sombre
                      ? 'bg-white/15 text-hero-ink'
                      : 'bg-line-soft text-ink-muted',
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

export function OngletsBandeau({
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
    <Onglets onglets={onglets} courant={courant} onChange={onChange} sombre />,
    cible,
  );
}
