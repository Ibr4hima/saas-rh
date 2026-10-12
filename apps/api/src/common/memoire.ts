import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Une mémoire le temps d'un calcul (ADR-0067).
 *
 * Le circuit des demandes se lit demande par demande : qui dirige la DCH,
 * qui détient une habilitation, le N+1 de chacun, ses absences. Sur une file
 * de cent demandes, les mêmes réponses étaient relues des centaines de fois,
 * une requête chacune. Dans une portée ouverte par `avecMemoire`, chaque
 * lecture marquée par `memoriser` n'est faite qu'une fois.
 *
 * La portée ne s'ouvre qu'autour d'un calcul qui n'écrit rien de ce qu'il
 * mémorise : un compteur, une file, la relecture du circuit une fois les
 * habilitations et les délégations tenues. Hors portée, `memoriser` lit
 * comme avant, à chaque appel.
 */
const portee = new AsyncLocalStorage<Map<string, Promise<unknown>>>();

export function avecMemoire<T>(calcul: () => Promise<T>): Promise<T> {
  // Déjà dans une portée : elle sert encore, ce qui y a été lu aussi.
  if (portee.getStore()) return calcul();
  return portee.run(new Map(), calcul);
}

/** Est-on dans une portée ? Pour lire tout d'un coup ce qui y servira plusieurs fois. */
export function enPortee(): boolean {
  return portee.getStore() !== undefined;
}

export function memoriser<T>(cle: string, lire: () => Promise<T>): Promise<T> {
  const memoire = portee.getStore();
  if (!memoire) return lire();
  let promesse = memoire.get(cle) as Promise<T> | undefined;
  if (!promesse) {
    promesse = lire();
    memoire.set(cle, promesse);
  }
  return promesse;
}
