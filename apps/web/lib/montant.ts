'use client';

import { useLayoutEffect, useRef, useState, type ChangeEvent } from 'react';
import { enChiffres } from '@teranga/contracts';

/**
 * Un montant en francs CFA, saisi en chiffres : les milliers se séparent à
 * la frappe, et le curseur garde sa place parmi les chiffres, une espace
 * ajoutée ne le fait pas sauter. Rend ce qu'il faut poser sur le champ.
 */
export function useMontantEnChiffres(
  montant: number | null,
  onSaisir: (montant: number | null) => void,
) {
  const champ = useRef<HTMLInputElement>(null);
  const curseur = useRef<number | null>(null);
  const [texte, setTexte] = useState(montant ? enChiffres(montant) : '');

  // Après le regroupement, le curseur revient derrière autant de chiffres qu'avant.
  useLayoutEffect(() => {
    const chiffres = curseur.current;
    if (chiffres === null || !champ.current) return;
    curseur.current = null;
    let i = 0;
    for (let vus = 0; i < texte.length && vus < chiffres; i++) {
      if (/\d/.test(texte[i]!)) vus++;
    }
    champ.current.setSelectionRange(i, i);
  }, [texte]);

  return {
    ref: champ,
    value: texte,
    inputMode: 'numeric' as const,
    // « 999 999 999 » : neuf chiffres et leurs deux espaces.
    maxLength: 11,
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      const brut = e.target.value;
      const avant = brut
        .slice(0, e.target.selectionStart ?? brut.length)
        .replace(/\D/g, '').length;
      const chiffres = brut.replace(/\D/g, '').replace(/^0+/, '').slice(0, 9);
      curseur.current = Math.min(avant, chiffres.length);
      setTexte(chiffres ? enChiffres(Number(chiffres)) : '');
      onSaisir(chiffres ? Number(chiffres) : null);
    },
  };
}
