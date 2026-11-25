'use client';

/* ────────────────────────────────────────────────────────────────
   Les copies des saisies dans le navigateur (ADR-0280) : chaque frappe
   d'une saisie de la campagne en garde une, propre au compte et à la page,
   pour qu'une coupure ne perde rien.

   Elles ne restent pas plus que nécessaire (ADR-0291) : trente jours au
   plus, effacées au démarrage ; celles du compte s'effacent à sa
   déconnexion, celles des autres comptes dès qu'un compte se connecte dans
   ce navigateur.
   ──────────────────────────────────────────────────────────────── */

/** Une copie du navigateur plus vieille que cela s'efface sans être reprise. */
const DUREE_DES_COPIES = 30 * 24 * 3600 * 1000;
export const PREFIXE = 'teranga:brouillon:';

/** La copie d'une saisie, dans le navigateur. */
export interface Copie<T> {
  contenu: T;
  /** L'empreinte de ce que le serveur gardait quand cette saisie a commencé. */
  base: string;
  /** Le moment de la dernière frappe, en millisecondes. */
  le: number;
}

// Le stockage du navigateur peut manquer, être plein ou refusé : la saisie
// continue sans copie.
export function lireCopie<T>(cle: string): Copie<T> | null {
  try {
    const brut = window.localStorage.getItem(cle);
    if (!brut) return null;
    const copie = JSON.parse(brut) as Partial<Copie<T>>;
    return typeof copie.base === 'string' && typeof copie.le === 'number' && 'contenu' in copie
      ? (copie as Copie<T>)
      : null;
  } catch {
    return null;
  }
}

export function ecrireCopie<T>(cle: string, copie: Copie<T>): void {
  try {
    window.localStorage.setItem(cle, JSON.stringify(copie));
  } catch {
    // Rien à faire : l'envoi au serveur suit.
  }
}

export function effacerCopie(cle: string): void {
  try {
    window.localStorage.removeItem(cle);
  } catch {
    // Rien à faire.
  }
}

/** Les copies trop vieilles, ou illisibles, s'effacent : au démarrage, et à chaque saisie. */
export function purgerLesCopies(): void {
  try {
    const limite = Date.now() - DUREE_DES_COPIES;
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const cle = window.localStorage.key(i);
      if (!cle?.startsWith(PREFIXE)) continue;
      const copie = lireCopie(cle);
      if (!copie || copie.le < limite) window.localStorage.removeItem(cle);
    }
  } catch {
    // Rien à faire.
  }
}

/**
 * Les copies d'un compte, ou celles de tous les autres : à la déconnexion,
 * rien du compte ne reste dans le navigateur ; à la connexion, rien d'un
 * autre compte (ADR-0291).
 */
export function effacerLesCopies(compte: string, lesAutres = false): void {
  try {
    const sienne = `${PREFIXE}${compte}:`;
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const cle = window.localStorage.key(i);
      if (!cle?.startsWith(PREFIXE)) continue;
      if (cle.startsWith(sienne) !== lesAutres) window.localStorage.removeItem(cle);
    }
  } catch {
    // Rien à faire.
  }
}

/** Le compte d'une session, tel que les copies le nomment. */
export const compteDe = (u: { tenantId: string; userId: string }) => `${u.tenantId}:${u.userId}`;
