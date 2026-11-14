/**
 * Les montants des documents de la DCH, en chiffres et en lettres :
 * « 250 000 (deux cent cinquante mille) francs CFA » (ADR-0087).
 *
 * En lettres, l'orthographe traditionnelle, celle des actes : un trait
 * d'union sous cent seulement (« quatre-vingt-dix-sept »), « et » devant un
 * et onze (« vingt et un », « soixante et onze »), le pluriel de vingt et de
 * cent quand rien ne les suit (« quatre-vingts », « deux cents »), mille
 * invariable. Les rectifications de 1990, qui lient tout d'un trait
 * d'union, ne sont pas d'usage dans les actes.
 */

/** Un salaire, en francs CFA : sans centimes, sous le milliard. */
export const SALAIRE_MAX = 999_999_999;

const INSECABLE = ' ';

/** « 250 000 » : les milliers séparés d'une espace insécable, que la ligne ne coupe pas. */
export function enChiffres(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, INSECABLE);
}

const UNITES = [
  'zéro',
  'un',
  'deux',
  'trois',
  'quatre',
  'cinq',
  'six',
  'sept',
  'huit',
  'neuf',
  'dix',
  'onze',
  'douze',
  'treize',
  'quatorze',
  'quinze',
  'seize',
] as const;
const DIZAINES = ['', 'dix', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'] as const;

/**
 * De 0 à 99. `final` : rien ne suit dans le nombre, ou un nom (millions,
 * milliards) ; quatre-vingts prend alors son s, qu'il perd devant mille.
 */
function sousCent(n: number, final: boolean): string {
  if (n <= 16) return UNITES[n]!;
  if (n < 20) return `dix-${UNITES[n - 10]}`;
  const dizaine = Math.floor(n / 10);
  const unite = n % 10;
  // Soixante-dix et quatre-vingt-dix comptent de dix à dix-neuf sur la
  // dizaine d'avant : « soixante-douze », « quatre-vingt-onze ».
  if (dizaine === 7) {
    return unite === 1 ? 'soixante et onze' : `soixante-${sousCent(10 + unite, final)}`;
  }
  if (dizaine === 9) return `quatre-vingt-${sousCent(10 + unite, final)}`;
  if (dizaine === 8) {
    if (unite > 0) return `quatre-vingt-${UNITES[unite]}`;
    return final ? 'quatre-vingts' : 'quatre-vingt';
  }
  if (unite === 0) return DIZAINES[dizaine]!;
  return unite === 1 ? `${DIZAINES[dizaine]} et un` : `${DIZAINES[dizaine]}-${UNITES[unite]}`;
}

/** De 0 à 999 ; cent prend son s aux conditions de quatre-vingts. */
function sousMille(n: number, final: boolean): string {
  const centaine = Math.floor(n / 100);
  const reste = n % 100;
  if (centaine === 0) return sousCent(reste, final);
  const cent =
    centaine === 1 ? 'cent' : `${UNITES[centaine]} cent${reste === 0 && final ? 's' : ''}`;
  return reste === 0 ? cent : `${cent} ${sousCent(reste, final)}`;
}

/** Un entier, de zéro à un billion exclu, en toutes lettres : « deux cent cinquante mille ». */
export function enLettres(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0 || n >= 1e12) {
    throw new RangeError(`Nombre hors de portée : ${n}`);
  }
  if (n === 0) return 'zéro';
  const milliards = Math.floor(n / 1e9);
  const millions = Math.floor(n / 1e6) % 1000;
  const milliers = Math.floor(n / 1e3) % 1000;
  const unites = n % 1000;
  const mots: string[] = [];
  // Million et milliard sont des noms : ils prennent le pluriel, et vingt et
  // cent devant eux gardent le leur (« quatre-vingts millions »).
  if (milliards > 0) mots.push(`${sousMille(milliards, true)} milliard${milliards > 1 ? 's' : ''}`);
  if (millions > 0) mots.push(`${sousMille(millions, true)} million${millions > 1 ? 's' : ''}`);
  // Mille est invariable et ne se compte pas : « mille », jamais « un mille ».
  if (milliers > 0) mots.push(milliers === 1 ? 'mille' : `${sousMille(milliers, false)} mille`);
  if (unites > 0) mots.push(sousMille(unites, true));
  return mots.join(' ');
}
