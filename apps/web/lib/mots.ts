/* ————————————————————————————————————————————————————————————————
   Les nombres, dits d'une seule façon.

   « 3 offres », « 1 demande » : trois écrans écrivaient cette ligne avec
   trois fonctions locales identiques, et une quatrième vivait dans le
   gabarit. Un pluriel se dit une fois.
   ———————————————————————————————————————————————————————————————— */

/**
 * « 3 offres », « 1 offre ».
 *
 * Le pluriel régulier est le défaut ; les irréguliers (« un travail, des
 * travaux ») se passent en troisième argument.
 */
export function compte(n: number, singulier: string, pluriel = `${singulier}s`): string {
  return `${n} ${n > 1 ? pluriel : singulier}`;
}

/**
 * L'accord du participe qui suit le décompte : « 2 offres sélectionnées »,
 * « 2 dossiers sélectionnés ».
 *
 * Le français accorde en genre ET en nombre, et une barre d'action qui
 * annonce « 2 offres sélectionné(s) » se voit. Le genre ne se devine pas
 * d'un nom commun : l'appelant le dit.
 */
export function accorde(n: number, participe: string, feminin = false): string {
  return `${participe}${feminin ? 'e' : ''}${n > 1 ? 's' : ''}`;
}
