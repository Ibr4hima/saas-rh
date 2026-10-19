'use client';

import Link from 'next/link';
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
 * L'action de l'écran : un bouton plein, l'icône et le mot, aux mesures du
 * bouton de la date (ADR-0124) : 36 px de haut, 12 px de marge, 8 px entre
 * l'icône et le mot, le mot en 12,5 px. Sur téléphone, l'icône seule, dans
 * un rond ; le mot reste aux lecteurs d'écran.
 */
export const ACTION =
  'inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-controle border border-transparent bg-primary px-3 text-[12.5px] font-semibold whitespace-nowrap text-primary-ink shadow-bouton transition-[background-color,box-shadow] duration-150 ease-out hover:bg-primary-hover active:shadow-bouton-enfonce focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary max-sm:w-9 max-sm:rounded-full max-sm:px-0';

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

/**
 * Le retour à la page d'où l'on vient (la liste, le catalogue, la formation),
 * à gauche du titre de l'écran : un rond de l'en-tête, le chevron vers
 * l'arrière. Il remplace le lien « page précédente » qui se tenait en tête de
 * la page, sous le titre. La page le pose par un portail, comme ses gestes ;
 * sur téléphone, où le titre descend en tête de la page, il le suit.
 */
export const ANCRE_RETOUR = 'entete-retour';
export const ANCRE_RETOUR_TELEPHONE = 'entete-retour-telephone';

export function RetourDeLEcran({ href, libelle }: { href: string; libelle: string }) {
  const [cibles, setCibles] = React.useState<HTMLElement[]>([]);
  React.useEffect(
    () =>
      setCibles(
        [ANCRE_RETOUR, ANCRE_RETOUR_TELEPHONE]
          .map((id) => document.getElementById(id))
          .filter((c): c is HTMLElement => c !== null),
      ),
    [],
  );
  return (
    <>
      {cibles.map((cible) =>
        createPortal(
          <Link
            href={href}
            title={`Retour : ${libelle}`}
            aria-label={`Retour : ${libelle}`}
            className={COMMANDE}
          >
            <Icon name="chevron_backward" size={20} />
          </Link>,
          cible,
          cible.id,
        ),
      )}
    </>
  );
}
