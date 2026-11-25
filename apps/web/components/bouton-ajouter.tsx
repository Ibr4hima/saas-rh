'use client';

import { cn } from '@teranga/ui';
import { Icon } from './icons';

/**
 * Ajouter une ligne à une liste qu'on remplit : « Ajouter un objectif »,
 * « Ajouter un besoin ». Un cadre en pointillés sur toute la largeur, le
 * texte gris précédé d'un « + », qui passe au bleu au survol : le bouton
 * d'ajout de plateforme-apix (ADR-0153).
 */
export function BoutonAjouter({
  libelle,
  onClick,
  className,
}: {
  libelle: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-1.5 rounded-[9px] border-2 border-dashed border-line bg-bg/50 px-3.5 py-[9px] text-left text-[12px] text-ink-muted',
        'transition-colors duration-150 outline-none hover:border-primary hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/35',
        className,
      )}
    >
      <Icon name="add" size={14} />
      {libelle}
    </button>
  );
}
