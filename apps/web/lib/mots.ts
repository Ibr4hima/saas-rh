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

/** La première lettre en capitale, en tête de phrase : « dans la DCH » devient « Dans la DCH ». */
export const majuscule = (texte: string) => texte.charAt(0).toUpperCase() + texte.slice(1);

/**
 * Les espaces devant « ? », « ! », « : », « ; » et « % », et dans les
 * guillemets, deviennent insécables : la ponctuation ne part pas seule à la
 * ligne, au bout d'un intitulé qui se coupe (ADR-0259, ADR-0262).
 */
export const insecables = (texte: string) =>
  texte.replace(/ ([?!:;%\u00bb])/g, '\u00a0$1').replace(/\u00ab /g, '\u00ab\u00a0');

/**
 * Le nom d'une unité sans son type, quand l'intitulé qui le précède le dit
 * déjà : sous « Département », « Département Développement du personnel »
 * se lit « Développement du personnel », et « Département des Études »,
 * « Études » (ADR-0264). Un nom réduit à son type reste entier.
 */
export function sansLeType(nom: string, type: 'Département' | 'Service'): string {
  const enTete = new RegExp(
    `^\\s*${type}\\s+(?:de la\\s+|de l['’]|des\\s+|du\\s+|de\\s+|d['’])?`,
    'iu',
  );
  const reste = nom.replace(enTete, '').trim();
  return reste ? majuscule(reste) : nom;
}
