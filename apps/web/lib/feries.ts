/* ————————————————————————————————————————————————————————————————
   Ce qu'on dit d'un jour férié : sa distance à aujourd'hui.

   La frise de l'année et le rappel de l'espace agent comptent la même chose,
   et un « Dans 6 mois » calculé deux fois finirait par se dire de deux
   façons. Les deux écrans lisent donc ici.
   ———————————————————————————————————————————————————————————————— */

/** Écart en jours entre une date ISO et aujourd'hui, au calendrier local. */
export function ecartJours(iso: string): number {
  return Math.round(
    (new Date(`${iso}T00:00:00`).getTime() - new Date().setHours(0, 0, 0, 0)) / 86_400_000,
  );
}

function pluriel(n: number, mot: string, suffixe = 's'): string {
  return `${n} ${mot}${n > 1 ? suffixe : ''}`;
}

/**
 * « Dans 6 mois », « Il y a 21 jours », « Demain ».
 *
 * L'unité suit la distance : à onze mois, « dans 337 jours » ne se
 * représente pas — on compte en mois dès qu'on dépasse le mois.
 */
export function distance(iso: string): string {
  const j = ecartJours(iso);
  if (j === 0) return "Aujourd'hui";
  if (j === 1) return 'Demain';
  if (j === -1) return 'Hier';
  const n = Math.abs(j);
  const mots = n < 31 ? pluriel(n, 'jour') : pluriel(Math.max(1, Math.round(n / 30.4)), 'mois', '');
  return j < 0 ? `Il y a ${mots}` : `Dans ${mots}`;
}
