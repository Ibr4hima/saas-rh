'use client';

import * as React from 'react';
import { Icon } from './icons';

/**
 * L'action unique de ces écrans : pleine largeur, en pilule.
 *
 * La pilule n'est pas un choix esthétique — c'est la règle du produit : la
 * forme dit qu'on actionne, les coins doux disent qu'on remplit. La plateforme
 * de gestion des investissements donne au bouton le rayon des champs, et l'on
 * ne distingue plus les deux d'un coup d'œil.
 */
export function BoutonMarque({
  enCours,
  libelleEnCours,
  disabled,
  children,
}: {
  enCours: boolean;
  libelleEnCours: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={enCours || disabled}
      className="group mt-0.5 inline-flex h-[46px] w-full items-center justify-center gap-2 rounded-full bg-primary text-[14.5px] font-bold text-primary-ink shadow-[0_4px_18px_rgb(0_79_145/0.35)] transition-[background-color,transform,box-shadow] duration-150 hover:-translate-y-px hover:bg-primary-hover hover:shadow-[0_10px_28px_rgb(0_79_145/0.42)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:translate-y-0 disabled:pointer-events-none disabled:opacity-65"
    >
      {enCours ? (
        <>
          <span
            aria-hidden
            className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          />
          {libelleEnCours}
        </>
      ) : (
        <>
          {children}
          <Icon
            name="arrow_forward"
            size={16}
            className="transition-transform duration-150 group-hover:translate-x-1"
          />
        </>
      )}
    </button>
  );
}
