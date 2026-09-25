import { SEUIL_VISIONNAGE, type EtatLecon, type Intervalle } from '@teranga/contracts';

/* ————————————————————————————————————————————————————————————————
   Le verrou du visionnage.

   Le lecteur tourne dans le navigateur de l'agent, et tout ce qui tourne là
   se trafique : une console ouverte, une requête fabriquée, un onglet de
   plus. Rien de ce qu'il déclare ne fait donc foi. Il DÉCLARE les passages
   qu'il a joués ; ce module DÉCIDE de ce qui est crédité, sur trois règles :

   1. On ne crédite que des secondes NOUVELLES. Un passage revu ne compte pas
      deux fois ; un passage sauté ne compte pas du tout. « Vue à 90 % » se
      mesure sur la somme des passages réellement crédités, pas sur la
      position atteinte.

   2. Chaque seconde créditée consomme une seconde d'une RÉSERVE qui ne se
      remplit qu'au rythme de l'horloge du serveur, et plafonne à vingt
      secondes. D'où la garantie : sur n'importe quelle période, un agent ne
      peut pas se faire créditer plus que la durée de cette période, plus
      vingt secondes. Multiplier les onglets, les sessions ou les requêtes n'y
      change rien — la réserve est celle de l'AGENT, pas de la session.

   3. En première lecture, un passage qui commence au-delà de ce qui a déjà
      été vu est un SAUT : il n'est pas crédité, et le lecteur est ramené en
      arrière.

   Ce qu'aucune règle ne garantit — personne ne le peut —, c'est que l'agent
   regarde l'écran. Celui qui laisse tourner la vidéo y passe quand même le
   temps réel : il ne gagne rien. Le vrai verrou de la certification sera le
   quiz.

   Fonction PURE, et c'est voulu : c'est elle que les tests éprouvent, triches
   comprises, sans base ni horloge réelle.
   ———————————————————————————————————————————————————————————————— */

/** La réserve plafonne ici : l'avance tolérée sur l'horloge, en secondes. */
export const RESERVE_MAX_S = 20;

/**
 * Au-delà de cet écart avec ce qui a été vu, un passage est un saut. Un peu
 * plus qu'un battement : un battement perdu en route ne doit pas faire
 * prendre l'agent honnête pour un tricheur.
 */
export const TOLERANCE_SAUT_S = 15;

/** Deux passages plus proches que ça se recollent en un seul. */
const JOINT_S = 0.25;

/** La réserve de temps d'un agent : ses jetons, et l'instant du dernier compte. */
export interface Reserve {
  jetons: number;
  /** En millisecondes depuis l'époque, horloge du SERVEUR. */
  a: number;
}

const arrondi = (s: number) => Math.round(s * 10) / 10;

/** La réserve à l'instant `maintenant` : ce qu'elle avait, plus le temps écoulé. */
export function remplir(reserve: Reserve, maintenant: number): number {
  // Une horloge qui reculerait (réglage du serveur) ne doit pas VIDER la
  // réserve : l'écoulé négatif compte pour zéro.
  const ecoule = Math.max(0, (maintenant - reserve.a) / 1000);
  return Math.min(RESERVE_MAX_S, reserve.jetons + ecoule);
}

/** Les passages triés, ceux qui se touchent recollés. */
export function fusionner(intervalles: Intervalle[]): Intervalle[] {
  const tries = intervalles
    .filter(([de, a]) => a > de)
    .map(([de, a]) => [de, a] as Intervalle)
    .sort((x, y) => x[0] - y[0]);
  const out: Intervalle[] = [];
  for (const [de, a] of tries) {
    const dernier = out[out.length - 1];
    if (dernier && de <= dernier[1] + JOINT_S) {
      dernier[1] = Math.max(dernier[1], a);
    } else {
      out.push([de, a]);
    }
  }
  return out;
}

export function totalVu(intervalles: Intervalle[]): number {
  return intervalles.reduce((s, [de, a]) => s + (a - de), 0);
}

/** Le point le plus loin atteint par un passage crédité. */
export function plusLoin(intervalles: Intervalle[]): number {
  return intervalles.reduce((m, [, a]) => Math.max(m, a), 0);
}

/** Ce qui, dans `[de, a]`, n'a PAS encore été crédité — dans l'ordre. */
export function nouveauxMorceaux(de: number, a: number, deja: Intervalle[]): Intervalle[] {
  const morceaux: Intervalle[] = [];
  let curseur = de;
  for (const [x, y] of fusionner(deja)) {
    if (y <= curseur) continue;
    if (x >= a) break;
    if (x > curseur) morceaux.push([curseur, Math.min(x, a)]);
    curseur = Math.max(curseur, y);
    if (curseur >= a) break;
  }
  if (curseur < a) morceaux.push([curseur, a]);
  return morceaux;
}

export interface ResultatCredit {
  intervalles: Intervalle[];
  reserve: Reserve;
  /** Secondes nouvellement créditées par ce battement. */
  credite: number;
  refus: 'saut' | null;
}

/**
 * Crédite un passage déclaré par le lecteur.
 *
 * @param validee La leçon est déjà validée : la lecture est libre, on ne
 *   parle plus de saut (on révise).
 */
export function crediter({
  intervalles,
  reserve,
  segment,
  maintenant,
  duree,
  validee,
}: {
  intervalles: Intervalle[];
  reserve: Reserve;
  segment: { de: number; a: number };
  maintenant: number;
  duree: number;
  validee: boolean;
}): ResultatCredit {
  let jetons = remplir(reserve, maintenant);
  const deja = fusionner(intervalles);
  const de = Math.max(0, Math.min(segment.de, duree));
  const a = Math.max(0, Math.min(segment.a, duree));

  if (a <= de) {
    return { intervalles: deja, reserve: { jetons, a: maintenant }, credite: 0, refus: null };
  }
  if (!validee && de > plusLoin(deja) + TOLERANCE_SAUT_S) {
    return { intervalles: deja, reserve: { jetons, a: maintenant }, credite: 0, refus: 'saut' };
  }

  // Les secondes nouvelles, créditées dans l'ordre tant que la réserve suit.
  // Ce qu'elle ne couvre pas reste un trou : l'agent le reverra.
  const credites: Intervalle[] = [];
  let credite = 0;
  for (const [x, y] of nouveauxMorceaux(de, a, deja)) {
    if (jetons <= 0) break;
    const pris = Math.min(y - x, jetons);
    credites.push([x, x + pris]);
    jetons -= pris;
    credite += pris;
  }

  const fusion = fusionner([...deja, ...credites]).map(
    ([x, y]) => [arrondi(x), arrondi(y)] as Intervalle,
  );
  return {
    intervalles: fusion,
    reserve: { jetons: Math.max(0, jetons), a: maintenant },
    credite,
    refus: null,
  };
}

/** Vue à 90 % ? Mesuré sur les passages crédités, contre la durée du fournisseur. */
export function atteintLeSeuil(intervalles: Intervalle[], duree: number): boolean {
  return duree > 0 && totalVu(intervalles) >= SEUIL_VISIONNAGE * duree;
}

/** La part vue, de 0 à 1, pour l'affichage. */
export function partVue(intervalles: Intervalle[], duree: number): number {
  if (duree <= 0) return 0;
  return Math.min(1, totalVu(intervalles) / duree);
}

/**
 * L'état de chaque leçon d'une formation, dans l'ordre du parcours.
 *
 * L'ordre est imposé : la première leçon non validée est celle qu'on suit,
 * toutes les NON VALIDÉES d'après sont verrouillées. Une leçon déjà validée le
 * reste, et se revoit librement — même si la RH a inséré depuis une leçon
 * devant elle : l'agent l'a vue, le lui reprendre serait faux, et la revoir
 * ne fait rien sauter.
 */
export function etatsDuParcours(
  lecons: Array<{ validee: boolean; commencee: boolean }>,
): EtatLecon[] {
  let courante = false;
  return lecons.map((l) => {
    if (l.validee) return 'validee';
    if (courante) return 'verrouillee';
    courante = true;
    return l.commencee ? 'en_cours' : 'a_suivre';
  });
}
