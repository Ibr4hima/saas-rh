'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@teranga/ui';
import { Icon, type IconName } from './icons';

/* ————————————————————————————————————————————————————————————————
   Le retour d'un geste.

   Le produit ne disait RIEN. On visait un congé, on cachetait un document,
   on archivait douze dossiers : la fenêtre se fermait, la liste se
   rechargeait, et il fallait relire l'écran pour deviner si l'ordre était
   passé. Une action sans accusé de réception se refait — c'est ainsi qu'on
   approuve deux fois.

   Pourquoi « toast » et pas un mot français : le français n'a pas de terme
   établi pour ce motif, et « notification » est déjà pris — la CLOCHE porte
   les notifications du produit, qui viennent du serveur, s'accumulent et
   survivent à la session. Ce qui suit est l'inverse : local, éphémère, jamais
   consigné. Deux choses différentes ne doivent pas porter le même nom.

   ——— Ce qu'un toast promet

   « Annuler » n'apparaît que là où l'API sait revenir en arrière : archiver un
   dossier, changer le statut d'une offre, ranger une notification. Un visa
   d'absence, lui, ne se défait pas — le serveur répond « déjà traitée » — et
   le toast ne propose donc rien : il confirme, et c'est tout. Un bouton qui
   promet une annulation impossible est pire que pas de bouton.
   ———————————————————————————————————————————————————————————————— */

type Ton = 'succes' | 'erreur' | 'info';

interface Action {
  libelle: string;
  /** Le geste inverse. Le toast se retire dès qu'on l'a lancé. */
  onAction: () => void;
}

interface Options {
  /** Une ligne de plus, en gris : le détail qu'on ne met pas dans le titre. */
  detail?: string;
  action?: Action;
}

interface Toast extends Options {
  id: number;
  ton: Ton;
  titre: string;
}

/** Combien de temps un toast reste, selon ce qu'il demande de faire. */
const DUREES: Record<Ton, number> = {
  // Une confirmation se lit d'un coup d'œil et n'appelle aucun geste.
  succes: 4000,
  // Une erreur se lit en entier, et souvent deux fois.
  erreur: 7000,
  info: 5000,
};
/** Avec une action à cliquer, il faut le temps de lire PUIS de viser. */
const DUREE_AVEC_ACTION = 8000;

/** Trois à la fois : au-delà, la pile masque l'écran qu'elle commente. */
const MAX = 3;

const TONS: Record<Ton, { icone: IconName; couleur: string; fond: string }> = {
  succes: { icone: 'check_circle', couleur: 'text-success', fond: 'bg-success-soft' },
  erreur: { icone: 'error', couleur: 'text-danger', fond: 'bg-danger-soft' },
  info: { icone: 'notifications', couleur: 'text-primary', fond: 'bg-primary-soft' },
};

interface Api {
  succes: (titre: string, options?: Options) => void;
  erreur: (titre: string, options?: Options) => void;
  info: (titre: string, options?: Options) => void;
}

const Contexte = createContext<Api>({ succes: () => {}, erreur: () => {}, info: () => {} });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [liste, setListe] = useState<Toast[]>([]);
  const suivant = useRef(0);

  const retirer = useCallback((id: number) => {
    setListe((l) => l.filter((t) => t.id !== id));
  }, []);

  const ajouter = useCallback((ton: Ton, titre: string, options?: Options) => {
    setListe((l) => [...l, { id: suivant.current++, ton, titre, ...options }].slice(-MAX));
  }, []);

  // L'API est STABLE : elle finit dans des dépendances de `useCallback` et de
  // mutations un peu partout, et une fonction recréée à chaque rendu y
  // relancerait des effets pour rien.
  const api = useMemo<Api>(
    () => ({
      succes: (titre, options) => ajouter('succes', titre, options),
      erreur: (titre, options) => ajouter('erreur', titre, options),
      info: (titre, options) => ajouter('info', titre, options),
    }),
    [ajouter],
  );

  return (
    <Contexte.Provider value={api}>
      {children}
      <Pile liste={liste} onRetirer={retirer} />
    </Contexte.Provider>
  );
}

export function useToast(): Api {
  return useContext(Contexte);
}

/** Marque la pile dans le DOM — voir `dansUnToast`. */
const MARQUE = 'data-toasts';

/**
 * Ce clic vient-il d'un toast ?
 *
 * Les panneaux qui se referment « au clic à l'extérieur » — la cloche, le
 * menu du compte — doivent laisser passer celui-là : viser « Annuler » dans
 * un toast n'est pas quitter le panneau, et refermer la boîte de réception
 * pendant qu'on rétablit une notification fait perdre de vue ce qu'on
 * corrige.
 */
export function dansUnToast(cible: EventTarget | null): boolean {
  return cible instanceof Element && cible.closest(`[${MARQUE}]`) !== null;
}

/**
 * La pile, posée sur la page.
 *
 * En bas à DROITE sur grand écran — le regard y revient après un geste fait
 * dans un tableau, et la colonne de navigation reste dégagée. Sur téléphone
 * elle s'étale en bas, au-dessus de la barre d'onglets : centrée et large,
 * parce qu'un pouce ne vise pas un coin.
 *
 * `aria-live="polite"` fait lire le titre par les lecteurs d'écran sans
 * interrompre ce qu'ils disent ; le focus, lui, ne bouge PAS — on ne vole pas
 * le curseur de quelqu'un qui est en train de remplir un champ.
 */
function Pile({ liste, onRetirer }: { liste: Toast[]; onRetirer: (id: number) => void }) {
  const [monte, setMonte] = useState(false);
  useEffect(() => setMonte(true), []);
  if (!monte) return null;
  return createPortal(
    <div
      {...{ [MARQUE]: '' }}
      role="status"
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 px-4 pb-[calc(env(safe-area-inset-bottom)+4.25rem)] sm:inset-x-auto sm:right-5 sm:bottom-5 sm:items-end sm:px-0 sm:pb-0"
    >
      {liste.map((t) => (
        <Bulle key={t.id} toast={t} onRetirer={() => onRetirer(t.id)} />
      ))}
    </div>,
    document.body,
  );
}

function Bulle({ toast, onRetirer }: { toast: Toast; onRetirer: () => void }) {
  const { icone, couleur, fond } = TONS[toast.ton];
  const duree = toast.action ? DUREE_AVEC_ACTION : DUREES[toast.ton];

  // Le compte à rebours se SUSPEND sous le curseur : un toast qui s'efface
  // pendant qu'on le lit — ou pendant qu'on vise son bouton — rate les deux
  // choses qu'il était venu faire.
  const [suspendu, setSuspendu] = useState(false);
  const [entre, setEntre] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setEntre(true));
    return () => cancelAnimationFrame(id);
  }, []);
  useEffect(() => {
    if (suspendu) return;
    const id = setTimeout(onRetirer, duree);
    return () => clearTimeout(id);
    // `onRetirer` est refait à chaque rendu du parent : le garder en
    // dépendance remettrait le compte à rebours à zéro sans arrêt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suspendu, duree]);

  return (
    <div
      onMouseEnter={() => setSuspendu(true)}
      onMouseLeave={() => setSuspendu(false)}
      onFocus={() => setSuspendu(true)}
      onBlur={() => setSuspendu(false)}
      className={cn(
        'pointer-events-auto flex w-full items-start gap-3 rounded-[14px] border border-card-line bg-surface px-4 py-3 shadow-lg sm:w-auto sm:max-w-[26rem] sm:min-w-[19rem]',
        'transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none',
        entre ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
      )}
    >
      <span
        className={cn(
          'mt-px flex size-6 shrink-0 items-center justify-center rounded-full',
          fond,
          couleur,
        )}
      >
        <Icon name={icone} size={15} />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] leading-snug font-semibold text-ink-strong">
          {toast.titre}
        </span>
        {toast.detail ? (
          <span className="mt-0.5 block text-[11.5px] leading-snug text-ink-muted">
            {toast.detail}
          </span>
        ) : null}
      </span>

      {toast.action ? (
        <button
          type="button"
          onClick={() => {
            toast.action!.onAction();
            onRetirer();
          }}
          className="shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-bold text-primary transition-colors hover:bg-primary/[0.08] focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
        >
          {toast.action.libelle}
        </button>
      ) : null}

      <button
        type="button"
        onClick={onRetirer}
        aria-label="Fermer"
        className="-mr-1 shrink-0 rounded-full p-1 text-ink-muted transition-colors hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
