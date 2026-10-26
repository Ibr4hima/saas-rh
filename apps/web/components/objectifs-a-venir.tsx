'use client';

import {
  memo,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import {
  dateEnLettres,
  LIMITES_DE_LA_GRILLE,
  OBJECTIFS_A_VENIR,
  parEcheance,
  type ObjectifAVenir,
} from '@teranga/contracts';
import { cn } from '@teranga/ui';
import { aujourdhui } from '../lib/temps';
import { BoutonAjouter } from './bouton-ajouter';
import { Icon } from './icons';

/*
   Les objectifs de travail pour la période à venir, dans la grille
   d'évaluation : une liste de choses à faire, chacune derrière sa case
   (le PDF les imprime en puces, ADR-0153). Chaque objectif tient sur une
   ligne et a son échéance, facultative, choisie d'aujourd'hui à la fin de
   l'année qui suit celle de la grille. La liste se range par échéance, la
   plus proche en tête, celles sans échéance en bas. Quatre objectifs au
   plus : les quatre lignes du modèle.
*/

/**
 * La case d'un objectif à venir, devant son texte, à l'écran. Elle ne se
 * coche pas : elle dit une chose à faire.
 */
export function CaseAVenir({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'block size-[14px] shrink-0 rounded-[4px] border-[1.5px] border-ink-muted/45 bg-surface',
        className,
      )}
    />
  );
}

/** L'échéance d'un objectif, en lecture : « 31 mars 2027 ». */
export function Echeance({ date, className }: { date: string; className?: string }) {
  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center gap-1 text-[11.5px] leading-[18.75px] font-semibold whitespace-nowrap text-ink-muted',
        className,
      )}
    >
      <Icon name="event" size={14} className="opacity-75" />
      <span className="sr-only">Échéance :</span>
      {dateEnLettres(date)}
    </span>
  );
}

/** Une date ISO complète, dans ses bornes. */
const dansLesBornes = (date: string, min: string, max: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= min && date <= max;

/**
 * L'échéance, à choisir : une puce, et dessous le calendrier du navigateur,
 * qui s'ouvre d'un clic. Une date complète, dans ses bornes, vaut aussitôt ;
 * une date à moitié tapée, ou hors des bornes, s'efface quand on quitte la
 * puce. « Effacer » retire l'échéance. `onQuitter` suit la puce qu'on
 * quitte, ou Entrée.
 */
function ChoixEcheance({
  id,
  date,
  min,
  max,
  onChoix,
  onQuitter,
  label,
}: {
  id: string;
  date: string | null;
  min: string;
  max: string;
  onChoix: (date: string | null) => void;
  onQuitter: () => void;
  label: string;
}) {
  // Ce qu'on tape et qui ne vaut pas encore : un jour incomplet, ou hors des bornes.
  const [saisie, setSaisie] = useState<string | null>(null);
  const montree = saisie ?? date;
  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center gap-1 rounded-full border bg-surface py-[3px] pr-2.5 pl-2 text-[11.5px] font-semibold whitespace-nowrap',
        'transition-colors duration-150 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/30 hover:border-primary/45 hover:text-primary',
        montree && dansLesBornes(montree, min, max)
          ? 'border-line text-ink'
          : 'border-dashed border-line text-ink-muted',
      )}
    >
      <Icon name="event" size={14} className="opacity-75" />
      {montree && dansLesBornes(montree, min, max) ? dateEnLettres(montree) : 'Échéance'}
      <input
        id={id}
        type="date"
        aria-label={label}
        value={montree ?? ''}
        min={min}
        max={max}
        onClick={(e) => {
          try {
            e.currentTarget.showPicker();
          } catch {
            // Un navigateur sans calendrier à ouvrir : la saisie au clavier reste.
          }
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          onQuitter();
        }}
        onChange={(e) => {
          const v = e.target.value;
          // Vidée tout entière (« Effacer ») : plus d'échéance. Une date à
          // moitié tapée est vide elle aussi, mais le navigateur la dit
          // incomplète : elle attend la suite.
          if (v === '' && !e.target.validity.badInput) {
            setSaisie(null);
            if (date !== null) onChoix(null);
            return;
          }
          if (!dansLesBornes(v, min, max)) {
            setSaisie(v);
            return;
          }
          setSaisie(null);
          if (v !== date) onChoix(v);
        }}
        onBlur={() => {
          setSaisie(null);
          onQuitter();
        }}
        className="absolute inset-0 size-full cursor-pointer opacity-0"
      />
    </span>
  );
}

/** Le texte d'un objectif : une ligne, qui s'allonge avec ce qu'on y écrit. */
function TexteDeLObjectif({
  id,
  valeur,
  label,
  onChange,
  onKeyDown,
}: {
  id: string;
  valeur: string;
  label: string;
  onChange: (texte: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  const champ = useRef<HTMLTextAreaElement>(null);
  const ajuster = () => {
    const el = champ.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };
  useLayoutEffect(ajuster, [valeur]);
  // La ligne rétrécit (la puce voisine prend sa date, l'écran tourne) : le
  // texte passe à la ligne, la hauteur suit, à l'image suivante.
  useEffect(() => {
    const el = champ.current;
    if (!el) return;
    let largeur = el.clientWidth;
    let image = 0;
    const observation = new ResizeObserver(() => {
      if (el.clientWidth === largeur) return;
      largeur = el.clientWidth;
      cancelAnimationFrame(image);
      image = requestAnimationFrame(ajuster);
    });
    observation.observe(el);
    return () => {
      observation.disconnect();
      cancelAnimationFrame(image);
    };
  }, []);
  return (
    <textarea
      ref={champ}
      id={id}
      rows={1}
      aria-label={label}
      value={valeur}
      maxLength={LIMITES_DE_LA_GRILLE.objectifAVenir}
      // Un texte collé sur plusieurs lignes se met sur une seule.
      onChange={(e) => onChange(e.target.value.replace(/\s*\n\s*/g, ' '))}
      onKeyDown={onKeyDown}
      className="-mx-1.5 min-w-0 flex-1 resize-none overflow-hidden rounded-[8px] bg-transparent px-1.5 py-[3px] text-[12.5px] leading-[1.5] text-ink-strong transition-colors duration-150 outline-none hover:bg-hover/70 focus:bg-hover"
    />
  );
}

interface Ligne extends ObjectifAVenir {
  id: string;
}

/**
 * Les objectifs à venir, à rédiger. Entrée ouvre un nouvel objectif ;
 * Retour arrière sur un objectif vide le retire ; les flèches passent de
 * l'un à l'autre. Les objectifs se rangent par échéance quand on quitte la
 * puce de l'échéance : rien ne bouge pendant qu'on la choisit.
 */
export const EditeurObjectifsAVenir = memo(function EditeurObjectifsAVenir({
  initial,
  annee,
  onChange,
}: {
  initial: ObjectifAVenir[];
  /** L'année de la grille : les échéances vont jusqu'à la fin de la suivante. */
  annee: number;
  onChange: (objectifs: ObjectifAVenir[]) => void;
}) {
  const [lignes, setLignes] = useState<Ligne[]>(() =>
    initial.map((o) => ({ ...o, id: crypto.randomUUID() })),
  );
  const uid = useId();
  const idDe = (id: string) => `${uid}-${id}`;
  const idEcheance = (id: string) => `${uid}-${id}-echeance`;
  const min = aujourdhui();
  const max = `${annee + 1}-12-31`;
  const complete = lignes.length >= OBJECTIFS_A_VENIR;

  // Où va le curseur : un objectif (au début ou à la fin de son texte), ou
  // une échéance. Il s'y pose une fois la liste affichée : une ligne qu'on
  // vient d'ajouter n'existe qu'après le rendu.
  const aViser = useRef<{ id: string; ou: 'debut' | 'fin' | 'echeance' } | null>(null);
  const poserLeCurseur = () => {
    const cible = aViser.current;
    if (!cible) return;
    const champ = document.getElementById(
      cible.ou === 'echeance' ? idEcheance(cible.id) : idDe(cible.id),
    );
    if (!(champ instanceof HTMLTextAreaElement || champ instanceof HTMLInputElement)) return;
    aViser.current = null;
    champ.focus();
    if (champ instanceof HTMLTextAreaElement) {
      const position = cible.ou === 'fin' ? champ.value.length : 0;
      champ.setSelectionRange(position, position);
    }
  };
  useEffect(poserLeCurseur);
  const viser = (id: string, ou: 'debut' | 'fin' = 'fin') => {
    aViser.current = { id, ou };
    poserLeCurseur();
  };

  const publier = (suivantes: Ligne[]) => {
    setLignes(suivantes);
    onChange(suivantes.map(({ texte, echeance }) => ({ texte, echeance })));
  };
  const changer = (id: string, quoi: Partial<ObjectifAVenir>) =>
    publier(lignes.map((l) => (l.id === id ? { ...l, ...quoi } : l)));

  /** Les objectifs par échéance ; le curseur reste sur la puce qui l'avait. */
  const ranger = () => {
    const rangees = parEcheance(lignes);
    if (rangees.every((l, i) => l === lignes[i])) return;
    const ici = lignes.find((l) => document.activeElement?.id === idEcheance(l.id));
    if (ici) aViser.current = { id: ici.id, ou: 'echeance' };
    publier(rangees);
  };

  const ajouter = () => {
    if (complete) return;
    const neuf: Ligne = { id: crypto.randomUUID(), texte: '', echeance: null };
    publier([...lignes, neuf]);
    viser(neuf.id);
  };

  const retirer = (l: Ligne) => {
    const i = lignes.findIndex((x) => x.id === l.id);
    const voisine = lignes[i - 1] ?? lignes[i + 1];
    publier(lignes.filter((x) => x.id !== l.id));
    if (voisine) viser(voisine.id);
  };

  const auClavier = (e: KeyboardEvent<HTMLTextAreaElement>, l: Ligne) => {
    const champ = e.currentTarget;
    const i = lignes.findIndex((x) => x.id === l.id);
    if (e.key === 'Enter') {
      // Un objectif tient sur une ligne : Entrée en ouvre un autre.
      e.preventDefault();
      if (!e.shiftKey && l.texte.trim()) ajouter();
      return;
    }
    if (e.key === 'Backspace' && !l.texte) {
      e.preventDefault();
      retirer(l);
      return;
    }
    const auDebut = champ.selectionStart === 0 && champ.selectionEnd === 0;
    const aLaFin = champ.selectionStart === champ.value.length;
    if (e.key === 'ArrowUp' && auDebut && lignes[i - 1]) {
      e.preventDefault();
      viser(lignes[i - 1]!.id);
    } else if (e.key === 'ArrowDown' && aLaFin && lignes[i + 1]) {
      e.preventDefault();
      viser(lignes[i + 1]!.id, 'debut');
    }
  };

  return (
    <div className="flex flex-col">
      {lignes.length > 0 ? (
        <ul className="flex flex-col">
          {lignes.map((l, i) => (
            <li key={l.id} className="flex items-start gap-[11px] py-1">
              <CaseAVenir className="mt-[6px]" />
              <TexteDeLObjectif
                id={idDe(l.id)}
                valeur={l.texte}
                label={`Objectif à venir ${i + 1}`}
                onChange={(texte) => changer(l.id, { texte })}
                onKeyDown={(e) => auClavier(e, l)}
              />
              <ChoixEcheance
                id={idEcheance(l.id)}
                date={l.echeance}
                min={min}
                max={max}
                label={`Échéance de l’objectif à venir ${i + 1}`}
                onChoix={(echeance) => changer(l.id, { echeance })}
                onQuitter={ranger}
              />
              <button
                type="button"
                aria-label={`Retirer l’objectif à venir ${i + 1}`}
                title="Retirer"
                onClick={() => retirer(l)}
                className="grid size-6 shrink-0 place-items-center rounded-full text-ink-muted/70 transition-colors duration-150 outline-none hover:bg-hover hover:text-danger focus-visible:ring-2 focus-visible:ring-primary/35"
              >
                <Icon name="close" size={16} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {complete ? null : (
        <BoutonAjouter libelle="Ajouter un objectif" onClick={ajouter} className="mt-2" />
      )}
    </div>
  );
});
