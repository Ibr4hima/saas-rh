'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { heureEnLettres } from '@teranga/contracts';
import { Button, Card } from '@teranga/ui';
import { api, ApiError } from '../../lib/api';
import { useMe } from '../../lib/hooks';
import { messageDe, useGardeDeSaisie } from '../grille-evaluation';
import { Icon } from '../icons';

/* ────────────────────────────────────────────────────────────────
   L'enregistrement automatique des saisies de la campagne : l'auto-
   évaluation de l'agent (ADR-0215), l'évaluation du N+1 (ADR-0216), les
   commentaires du N+2 (ADR-0218), les objectifs (ADR-0274).

   Ce qui est saisi ne se perd pas (ADR-0280) :
   · chaque modification part au serveur un peu après la dernière frappe,
     et au plus tard quelques secondes après la première, même sans pause ;
   · un envoi qui échoue repart seul, de plus en plus espacé, et dès que le
     réseau revient ;
   · l'onglet caché ou fermé, ce qui reste part quand même ;
   · chaque frappe garde aussi une copie dans le navigateur, propre au
     compte et à la page. Au retour, après une coupure (ordinateur éteint,
     réseau tombé), la saisie reprend cette copie si le serveur n'a pas
     bougé depuis, et l'enregistre ; enregistrée, la copie s'efface.
   Une barre, au bas de la page, dit où en est l'enregistrement et porte
   la transmission (ADR-0241, ADR-0254).
   ──────────────────────────────────────────────────────────────── */

/** Le temps, après la dernière frappe, avant d'enregistrer. */
const DELAI = 800;
/** Le plus long temps sans envoi pendant une frappe continue. */
const DELAI_MAX = 4000;
/** Le temps avant la relance qui suit le n-ième échec : 2 s, 4 s, 8 s… 30 s au plus. */
const relance = (echecs: number) => Math.min(30_000, 2000 * 2 ** Math.max(0, echecs - 1));
/** Une copie du navigateur plus vieille que cela s'efface sans être reprise. */
const DUREE_DES_COPIES = 30 * 24 * 3600 * 1000;
const PREFIXE = 'teranga:brouillon:';

export type EtatDeLEnregistrement =
  | { etat: 'au_repos' }
  | { etat: 'a_enregistrer' }
  | { etat: 'en_cours' }
  | { etat: 'enregistre'; heure: string }
  | { etat: 'erreur'; message: string };

/** Une modification de la saisie : à partir du dernier état, une à la fois. */
export type Changement<T> = (maj: (valeur: T) => T) => void;

const maintenant = () => {
  const d = new Date();
  const deux = (n: number) => String(n).padStart(2, '0');
  return heureEnLettres(`${deux(d.getHours())}:${deux(d.getMinutes())}`);
};

/**
 * L'empreinte d'une valeur : la même pour le même contenu, quel que soit
 * l'ordre de ses clés.
 */
export function empreinte(valeur: unknown): string {
  return JSON.stringify(valeur ?? null, (_cle, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : v,
  );
}

/** La copie d'une saisie, dans le navigateur. */
interface Copie<T> {
  contenu: T;
  /** L'empreinte de ce que le serveur gardait quand cette saisie a commencé. */
  base: string;
  /** Le moment de la dernière frappe, en millisecondes. */
  le: number;
}

// Le stockage du navigateur peut manquer, être plein ou refusé : la saisie
// continue sans copie.
function lireCopie<T>(cle: string): Copie<T> | null {
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

function ecrireCopie<T>(cle: string, copie: Copie<T>): void {
  try {
    window.localStorage.setItem(cle, JSON.stringify(copie));
  } catch {
    // Rien à faire : l'envoi au serveur suit.
  }
}

function effacerCopie(cle: string): void {
  try {
    window.localStorage.removeItem(cle);
  } catch {
    // Rien à faire.
  }
}

/** Les copies trop vieilles, ou illisibles, s'effacent. */
function purgerLesCopies(): void {
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
 * Un échec qui vaut une relance : le réseau, le serveur, la session. Un
 * refus (une évaluation fermée, transmise…) ne se relance pas.
 */
const aRelancer = (e: unknown) => {
  if (!(e instanceof ApiError)) return true;
  const s = e.problem.status;
  return s >= 500 || s === 401 || s === 408 || s === 429;
};

/**
 * L'enregistrement automatique d'une saisie, par `PUT` sur `chemin`, avec
 * le corps que `corps` tire de la saisie ; `lire` retrouve la saisie dans
 * la réponse du serveur. Une modification faite pendant un envoi part juste
 * après. `vider` enregistre sans attendre ce qui ne l'est pas encore, avant
 * la transmission ; en quittant la page, ce qui reste part aussi, et le
 * navigateur prévient avant de fermer une page qui n'a pas tout enregistré.
 * `chemin`, `corps` et `lire` ne changent pas d'un rendu à l'autre ;
 * `initial` est la saisie telle que le serveur vient de la rendre.
 */
export function useEnregistrementAuto<T>(
  chemin: string,
  initial: T,
  corps: (valeur: T) => unknown,
  options: {
    lire: (reponse: unknown) => T;
    /** Après chaque enregistrement réussi. */
    apresEnregistrement?: () => void;
  },
) {
  const [valeur, setValeur] = useState(initial);
  const [etat, setEtat] = useState<EtatDeLEnregistrement>({ etat: 'au_repos' });
  const dernier = useRef(initial);
  const enregistre = useRef(initial);
  /** L'empreinte de la saisie telle que le serveur la garde. */
  const base = useRef<string | null>(null);
  if (base.current === null) base.current = empreinte(initial);
  const minuterie = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** Le moment de la première modification pas encore partie. */
  const premiere = useRef<number | null>(null);
  const echecs = useRef(0);
  const enVol = useRef<Promise<unknown> | null>(null);
  const lire = useRef(options.lire);
  const apres = useRef(options.apresEnregistrement);
  apres.current = options.apresEnregistrement;
  // La copie du navigateur, propre au compte et à la page.
  const me = useMe();
  const cle = me.data ? `${PREFIXE}${me.data.tenantId}:${me.data.userId}:${chemin}` : null;
  const cleCourante = useRef(cle);
  cleCourante.current = cle;
  useGardeDeSaisie(
    etat.etat === 'a_enregistrer' || etat.etat === 'en_cours' || etat.etat === 'erreur',
  );

  const garderLaCopie = useCallback(() => {
    const k = cleCourante.current;
    if (k) ecrireCopie(k, { contenu: dernier.current, base: base.current ?? '', le: Date.now() });
  }, []);

  const vider = useCallback(
    async (keepalive = false): Promise<void> => {
      clearTimeout(minuterie.current);
      while (enVol.current) await enVol.current;
      const contenu = dernier.current;
      if (contenu === enregistre.current) return;
      premiere.current = null;
      setEtat({ etat: 'en_cours' });
      const envoi = api(chemin, { method: 'PUT', body: corps(contenu), keepalive });
      enVol.current = envoi.catch(() => undefined);
      try {
        const reponse = await envoi;
        enregistre.current = contenu;
        base.current = empreinte(reponse === undefined ? contenu : lire.current(reponse));
        echecs.current = 0;
        if (dernier.current === contenu) {
          const k = cleCourante.current;
          if (k) effacerCopie(k);
          setEtat({ etat: 'enregistre', heure: maintenant() });
        } else {
          garderLaCopie();
          setEtat({ etat: 'a_enregistrer' });
        }
        apres.current?.();
      } catch (e) {
        if (aRelancer(e)) {
          // La saisie reste à envoyer : nouvel essai, de plus en plus espacé.
          echecs.current += 1;
          clearTimeout(minuterie.current);
          minuterie.current = setTimeout(
            () => void viderRef.current().catch(() => undefined),
            relance(echecs.current),
          );
          setEtat({
            etat: 'erreur',
            message: 'Enregistrement impossible pour l’instant, nouvel essai automatique.',
          });
        } else {
          setEtat({ etat: 'erreur', message: messageDe(e, 'Enregistrement impossible.') });
        }
        throw e;
      } finally {
        enVol.current = null;
      }
    },
    [chemin, corps, garderLaCopie],
  );
  const viderRef = useRef(vider);
  viderRef.current = vider;

  const changer: Changement<T> = useCallback(
    (maj) => {
      const suivant = maj(dernier.current);
      dernier.current = suivant;
      setValeur(suivant);
      // La copie d'abord : si tout s'arrête maintenant, la frappe est gardée.
      garderLaCopie();
      setEtat({ etat: 'a_enregistrer' });
      const depuis = premiere.current ?? Date.now();
      premiere.current = depuis;
      const attente = Math.max(0, Math.min(DELAI, DELAI_MAX - (Date.now() - depuis)));
      clearTimeout(minuterie.current);
      minuterie.current = setTimeout(() => void viderRef.current().catch(() => undefined), attente);
    },
    [garderLaCopie],
  );

  // Au retour, la copie laissée par une coupure reprend la saisie, si le
  // serveur n'a pas bougé depuis ; sinon, le serveur fait foi.
  const reprise = useRef(false);
  useEffect(() => {
    if (!cle || reprise.current) return;
    reprise.current = true;
    purgerLesCopies();
    const copie = lireCopie<T>(cle);
    if (!copie || dernier.current !== enregistre.current) return;
    const serveur = base.current ?? '';
    if (empreinte(copie.contenu) === serveur || copie.base !== serveur) {
      effacerCopie(cle);
      return;
    }
    dernier.current = copie.contenu;
    setValeur(copie.contenu);
    setEtat({ etat: 'a_enregistrer' });
    void viderRef.current().catch(() => undefined);
  }, [cle]);

  // Le réseau revenu, ce qui attend repart ; l'onglet caché ou fermé aussi.
  useEffect(() => {
    const enAttente = () => dernier.current !== enregistre.current;
    const enLigne = () => {
      if (enAttente()) void viderRef.current().catch(() => undefined);
    };
    const cache = () => {
      if (document.visibilityState === 'hidden' && enAttente()) {
        void viderRef.current(true).catch(() => undefined);
      }
    };
    const fermee = () => {
      if (enAttente()) void viderRef.current(true).catch(() => undefined);
    };
    window.addEventListener('online', enLigne);
    document.addEventListener('visibilitychange', cache);
    window.addEventListener('pagehide', fermee);
    return () => {
      window.removeEventListener('online', enLigne);
      document.removeEventListener('visibilitychange', cache);
      window.removeEventListener('pagehide', fermee);
    };
  }, []);

  // En quittant la page par un lien, ce qui n'est pas encore parti part ;
  // arrivé, sa copie s'efface.
  useEffect(
    () => () => {
      clearTimeout(minuterie.current);
      if (dernier.current === enregistre.current) return;
      const contenu = dernier.current;
      const k = cleCourante.current;
      void api(chemin, { method: 'PUT', body: corps(contenu), keepalive: true })
        .then(() => {
          const copie = k ? lireCopie(k) : null;
          if (k && copie && empreinte(copie.contenu) === empreinte(contenu)) effacerCopie(k);
        })
        .catch(() => undefined);
    },
    [chemin, corps],
  );

  /** Enregistrer tout de suite ce qui ne l'est pas encore : avant une transmission. */
  const viderMaintenant = useCallback(() => vider(), [vider]);
  return { valeur, etat, changer, vider: viderMaintenant, contenu: () => dernier.current };
}

/**
 * La barre au bas de la page, après la saisie : elle ne se voit qu'au bout
 * du défilement (ADR-0241). Où en est l'enregistrement, et le bouton qui
 * transmet, actif une fois tout l'obligatoire rempli ; elle ne dresse pas la
 * liste de ce qui manque (ADR-0254). À sa gauche, s'il y a lieu, un autre
 * geste (`avant`) : « Valider », « Modifier ».
 */
export function BarreDeTransmission({
  etat,
  manque,
  libelle,
  enCours,
  onTransmettre,
  avant,
}: {
  etat: EtatDeLEnregistrement;
  manque: readonly string[];
  libelle: string;
  enCours: boolean;
  onTransmettre: () => void;
  avant?: ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center sm:gap-5">
      <div className="min-w-0 flex-1 text-[12px] leading-relaxed">
        <EtatEcrit etat={etat} />
      </div>
      {/* Sur un téléphone, les gestes l'un sous l'autre, sur toute la largeur. */}
      <div className="flex flex-col gap-2 *:w-full sm:flex-row sm:items-center sm:*:w-auto">
        {avant}
        <Button
          className="h-9 shrink-0 px-5"
          disabled={manque.length > 0 || enCours}
          onClick={onTransmettre}
        >
          {libelle}
        </Button>
      </div>
    </Card>
  );
}

/** Où en est l'enregistrement de la saisie. */
function EtatEcrit({ etat }: { etat: EtatDeLEnregistrement }) {
  switch (etat.etat) {
    case 'au_repos':
      return null;
    case 'a_enregistrer':
    case 'en_cours':
      return <p className="text-ink-muted">Enregistrement…</p>;
    case 'enregistre':
      return (
        <p className="flex items-center gap-1.5 font-semibold text-ink-muted">
          <Icon name="check" size={14} />
          Brouillon enregistré à {etat.heure}
        </p>
      );
    case 'erreur':
      return (
        <p role="alert" className="text-danger">
          {etat.message}
        </p>
      );
  }
}
