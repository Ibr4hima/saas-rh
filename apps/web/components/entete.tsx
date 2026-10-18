'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './icons';

/*
   L'en-tête de l'écran, posé sur le fond de la page (ADR-0115).

   Ses commandes sont des ronds blancs cerclés d'un filet, comme les blocs
   qu'elles surplombent : la date quand elle se réduit à son icône, les
   raccourcis de l'Academy, et sur téléphone la cloche et le compte. Ronds,
   comme tout bouton d'icône ; un bouton qui porte un mot, la date avec son
   libellé comprise, prend les coins des contrôles (ADR-0108). L'action de
   l'écran, elle, est pleine : c'est le geste qu'on vient faire.
*/

/** Une commande d'icône de l'en-tête, au repos. */
export const COMMANDE =
  'relative flex size-9 shrink-0 items-center justify-center rounded-full border border-card-line bg-surface text-ink-muted shadow-bouton-borde transition-colors duration-150 hover:border-line hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/** La même, ouverte ou sur sa page : elle prend le bleu des positions. */
export const COMMANDE_ACTIVE =
  'border-primary/30 bg-primary-soft text-primary hover:border-primary/40 hover:text-primary';

/**
 * L'action de l'écran : un bouton plein, l'icône et le mot. Sur téléphone,
 * l'icône seule, dans un rond ; le mot reste aux lecteurs d'écran.
 */
export const ACTION =
  'inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-controle border border-transparent bg-primary px-3.5 text-[13px] font-semibold whitespace-nowrap text-primary-ink shadow-bouton transition-[background-color,box-shadow] duration-150 ease-out hover:bg-primary-hover active:shadow-bouton-enfonce focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary max-sm:w-9 max-sm:rounded-full max-sm:px-0';

/**
 * Un geste de la page dans l'en-tête : « Télécharger » le document qu'elle
 * montre. Comme pour les onglets (cf. onglets.tsx), la coquille réserve la
 * place et la page y écrit par un portail : rien ne remonte de l'une à
 * l'autre.
 */
export const ANCRE_ACTIONS = 'entete-actions';

export function ActionDeLEntete({
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
    <button type="button" onClick={onClick} title={label} className={ACTION}>
      <Icon name={icon} size={18} />
      <span className="max-sm:sr-only">{label}</span>
    </button>,
    cible,
  );
}
