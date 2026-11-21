'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { heureEnLettres } from '@teranga/contracts';
import { Button, Card } from '@teranga/ui';
import { api } from '../../lib/api';
import { messageDe, useGardeDeSaisie } from '../grille-evaluation';
import { Icon } from '../icons';

/* ────────────────────────────────────────────────────────────────
   L'enregistrement automatique des saisies de la campagne : l'auto-
   évaluation de l'agent (ADR-0215), l'évaluation du N+1 (ADR-0216).
   Chaque modification part un peu après la dernière frappe, un envoi à la
   fois. Une barre, au bas de la page, dit où en est l'enregistrement, ce
   qui manque encore, et porte la transmission (ADR-0241).
   ──────────────────────────────────────────────────────────────── */

/** Le temps, après la dernière frappe, avant d'enregistrer. */
const DELAI = 1200;

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
 * L'enregistrement automatique d'une saisie, par `PUT` sur `chemin`, avec
 * le corps que `corps` tire de la saisie. Une modification faite pendant un
 * envoi part juste après. `vider` enregistre sans attendre ce qui ne l'est
 * pas encore, avant la transmission ; en quittant la page par un lien, ce
 * qui reste part aussi, et le navigateur prévient avant de fermer une page
 * qui n'a pas tout enregistré. `chemin` et `corps` ne changent pas d'un
 * rendu à l'autre.
 */
export function useEnregistrementAuto<T>(
  chemin: string,
  initial: T,
  corps: (valeur: T) => unknown,
) {
  const [valeur, setValeur] = useState(initial);
  const [etat, setEtat] = useState<EtatDeLEnregistrement>({ etat: 'au_repos' });
  const dernier = useRef(initial);
  const enregistre = useRef(initial);
  const minuterie = useRef<ReturnType<typeof setTimeout>>(undefined);
  const enVol = useRef<Promise<unknown> | null>(null);
  useGardeDeSaisie(
    etat.etat === 'a_enregistrer' || etat.etat === 'en_cours' || etat.etat === 'erreur',
  );

  const vider = useCallback(async (): Promise<void> => {
    clearTimeout(minuterie.current);
    while (enVol.current) await enVol.current;
    const contenu = dernier.current;
    if (contenu === enregistre.current) return;
    setEtat({ etat: 'en_cours' });
    const envoi = api(chemin, { method: 'PUT', body: corps(contenu) });
    enVol.current = envoi.catch(() => undefined);
    try {
      await envoi;
      enregistre.current = contenu;
      setEtat(
        dernier.current === contenu
          ? { etat: 'enregistre', heure: maintenant() }
          : { etat: 'a_enregistrer' },
      );
    } catch (e) {
      setEtat({ etat: 'erreur', message: messageDe(e, 'Enregistrement impossible, réessayez.') });
      throw e;
    } finally {
      enVol.current = null;
    }
  }, [chemin, corps]);

  const changer: Changement<T> = useCallback(
    (maj) => {
      setValeur((v) => {
        const suivant = maj(v);
        dernier.current = suivant;
        return suivant;
      });
      setEtat({ etat: 'a_enregistrer' });
      clearTimeout(minuterie.current);
      minuterie.current = setTimeout(() => void vider().catch(() => undefined), DELAI);
    },
    [vider],
  );

  // En quittant la page par un lien, ce qui n'est pas encore parti part.
  useEffect(
    () => () => {
      clearTimeout(minuterie.current);
      if (dernier.current !== enregistre.current) {
        void api(chemin, { method: 'PUT', body: corps(dernier.current) }).catch(() => undefined);
      }
    },
    [chemin, corps],
  );

  return { valeur, etat, changer, vider, contenu: () => dernier.current };
}

/** « À compléter : le vécu de l'année, les difficultés rencontrées, le niveau de l'objectif 1 et 3 autres. » */
function ceQuiManqueEnBref(manque: readonly string[]): string {
  const vus = manque.slice(0, 3);
  const reste = manque.length - vus.length;
  const liste =
    reste > 0 ? `${vus.join(', ')} et ${reste} autre${reste > 1 ? 's' : ''}` : vus.join(', ');
  return `À compléter : ${liste}.`;
}

/**
 * La barre au bas de la page, après la saisie : elle ne se voit qu'au bout
 * du défilement (ADR-0241). Où en est l'enregistrement, ce qui manque, et le
 * bouton qui transmet, actif une fois tout l'obligatoire rempli ; à sa
 * gauche, s'il y a lieu, un autre geste (`avant`) : « Valider », « Modifier ».
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
        {manque.length > 0 ? <p className="text-ink-muted">{ceQuiManqueEnBref(manque)}</p> : null}
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
