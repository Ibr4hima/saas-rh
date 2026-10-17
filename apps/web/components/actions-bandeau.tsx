'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './icons';

/**
 * Un geste de la page dans le bandeau de tête : « Télécharger » le document
 * qu'elle montre. Comme pour les onglets (cf. onglets-bandeau.tsx), la
 * coquille réserve la place et la page y écrit par un portail : rien ne
 * remonte de l'une à l'autre.
 */
export const ANCRE_ACTIONS = 'bandeau-actions';

export function ActionDuBandeau({
  icon,
  label,
  onClick,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
}) {
  // Le portail ne peut viser sa cible qu'après le premier rendu du client :
  // au rendu serveur, l'élément n'existe pas encore.
  const [cible, setCible] = React.useState<HTMLElement | null>(null);
  React.useEffect(() => setCible(document.getElementById(ANCRE_ACTIONS)), []);
  if (!cible) return null;

  return createPortal(
    // Le verre de la date du jour, sa voisine : sur le bleu de marque, un
    // aplat de marque ne se détacherait pas. Sur téléphone, l'icône seule.
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-9 shrink-0 items-center gap-2 rounded-full border border-white/30 bg-white/10 px-2.5 text-hero-ink transition-all duration-200 hover:border-white/55 hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none sm:px-3.5"
    >
      <Icon name={icon} size={18} />
      <span className="hidden text-xs font-semibold whitespace-nowrap sm:inline">{label}</span>
    </button>,
    cible,
  );
}
