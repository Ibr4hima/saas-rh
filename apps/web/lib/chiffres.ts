import type { ChangeEvent } from 'react';

/**
 * Un champ de chiffres groupés à la frappe : un montant (« 1 250 000 »), le
 * numéro d'une CNI (« 1 234 0000 12345 »). Le champ s'écrit groupé dès la
 * touche frappée, et le curseur garde sa place parmi les chiffres : une
 * espace ajoutée ne le fait pas sauter. Rend ce qu'il faut poser sur le champ.
 *
 * @param chiffres Ce qui est saisi, sans espaces.
 * @param max Le nombre de chiffres au plus.
 * @param grouper Les chiffres tels que le champ les montre.
 * @param normaliser Ce que deviennent les chiffres frappés : un montant perd ses zéros de tête.
 */
export function champDeChiffres({
  chiffres,
  max,
  grouper,
  normaliser = (c) => c,
  onSaisir,
}: {
  chiffres: string;
  max: number;
  grouper: (chiffres: string) => string;
  normaliser?: (chiffres: string) => string;
  onSaisir: (chiffres: string) => void;
}) {
  return {
    value: grouper(chiffres),
    inputMode: 'numeric' as const,
    maxLength: grouper('9'.repeat(max)).length,
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      const champ = e.target;
      const brut = champ.value;
      const avant = brut.slice(0, champ.selectionStart ?? brut.length).replace(/\D/g, '').length;
      const nouveaux = normaliser(brut.replace(/\D/g, '')).slice(0, max);
      // Le champ s'écrit groupé tout de suite, le curseur derrière autant de
      // chiffres qu'avant : React, qui retrouve la même valeur, n'y touche plus.
      const texte = grouper(nouveaux);
      let i = 0;
      for (let vus = 0; i < texte.length && vus < Math.min(avant, nouveaux.length); i++) {
        if (/\d/.test(texte[i]!)) vus++;
      }
      champ.value = texte;
      champ.setSelectionRange(i, i);
      onSaisir(nouveaux);
    },
  };
}
