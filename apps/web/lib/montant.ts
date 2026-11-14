import { enChiffres } from '@teranga/contracts';
import { champDeChiffres } from './chiffres';

/**
 * Un montant en francs CFA, saisi en chiffres : les milliers se séparent à
 * la frappe (« 999 999 999 » au plus), sans zéro en tête. Un montant qui peut
 * être nul (`zeroPermis`) garde son zéro seul. Rend ce qu'il faut poser sur
 * le champ.
 */
export function champDuMontant(
  montant: number | null,
  onSaisir: (montant: number | null) => void,
  { zeroPermis = false }: { zeroPermis?: boolean } = {},
) {
  return champDeChiffres({
    chiffres: montant === null ? '' : String(montant),
    max: 9,
    grouper: (c) => (c ? enChiffres(Number(c)) : ''),
    normaliser: (c) => c.replace(zeroPermis ? /^0+(?=\d)/ : /^0+/, ''),
    onSaisir: (c) => onSaisir(c ? Number(c) : null),
  });
}
