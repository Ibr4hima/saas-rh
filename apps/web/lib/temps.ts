import * as React from 'react';
import { compte } from './mots';

/* ————————————————————————————————————————————————————————————————
   L'ancienneté : le temps écoulé depuis un instant.

   Deux fonctions la calculaient, avec deux échelles : le tableau des offres
   disait « aujourd'hui » puis « hier », puis des jours, des mois, des ans ;
   la fiche disait « moins d'un jour », puis des jours, des SEMAINES, des
   mois. La même offre s'appelait donc « aujourd'hui » dans la liste et
   « moins d'un jour » sur sa fiche, et à cinq semaines l'une comptait 34
   jours quand l'autre en comptait 5 semaines.

   Une seule échelle désormais, et elle descend jusqu'à la minute : une offre
   publiée à l'instant se lit « il y a 3 minutes », pas « aujourd'hui » — un
   mot qui couvre les vingt-trois heures précédentes et ne dit pas si le lien
   est déjà parti aux candidats.
   ———————————————————————————————————————————————————————————————— */

const MINUTE = 60_000;
const HEURE = 60 * MINUTE;
const JOUR = 24 * HEURE;
/** Jours moyens d'un mois et d'une année grégoriens : c'est avec eux qu'on
    COMPTE les mois et les ans, pour ne pas dériver de cinq jours par an. */
const MOIS = 30.436_875 * JOUR;
const AN = 365.2425 * JOUR;
/** La frontière où l'on CESSE de compter en jours.
    Trente et un jours pleins, et non le mois moyen (30 j 10 h 29 min) : une
    frontière ronde s'explique, et c'est déjà celle de la frise des fériés.
    Sinon une offre de trente jours et demi passait à « 1 mois » quand celle de
    trente jours affichait encore ses jours, sans que rien ne le laisse voir. */
const FIN_DES_JOURS = 31 * JOUR;

/**
 * « 3 minutes », « 23 heures », « 1 jour », « 21 jours », « 4 mois ».
 *
 * Une durée NUE : l'intitulé qui la précède porte déjà « publiée il y a ».
 *
 * L'arrondi va toujours vers le BAS, et c'est ce qui rend la lecture exacte :
 * à 23 h 59 on lit « 23 heures », à 24 h pile « 1 jour », à 47 h 59 encore
 * « 1 jour ». Un arrondi au plus proche annoncerait « 1 jour » dès la
 * treizième heure — une offre publiée ce matin paraîtrait publiée hier.
 *
 * Les paliers suivent ce qu'on cherche à savoir : sous la journée, combien
 * d'heures ; au-delà, combien de jours — jusqu'à un mois, où le nombre de
 * jours cesse de se représenter.
 */
export function anciennete(iso: string): string {
  const ecart = Date.now() - new Date(iso).getTime();

  // Horloge du poste en avance sur celle du serveur : une durée négative ne
  // s'affiche pas, et « il y a -2 minutes » ferait douter du reste de l'écran.
  if (ecart < 0) return 'à l’instant';
  if (ecart < MINUTE) return 'moins d’une minute';
  if (ecart < HEURE) return compte(Math.floor(ecart / MINUTE), 'minute');
  if (ecart < JOUR) return compte(Math.floor(ecart / HEURE), 'heure');
  if (ecart < FIN_DES_JOURS) return compte(Math.floor(ecart / JOUR), 'jour');
  if (ecart < AN) return compte(Math.floor(ecart / MOIS), 'mois', 'mois');
  return compte(Math.floor(ecart / AN), 'an');
}

/**
 * Faire avancer les durées affichées, une fois par minute.
 *
 * Sans elle, la précision est un mensonge : « 3 minutes » resterait écrit
 * trois quarts d'heure plus tard, puisque rien ne redemande à React de
 * peindre. La minute suffit à tous les paliers — celui qui change le plus
 * vite tient soixante secondes.
 */
export function useHorlogeMinute(): void {
  const [, battre] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => battre((n) => n + 1), MINUTE);
    return () => clearInterval(id);
  }, []);
}
