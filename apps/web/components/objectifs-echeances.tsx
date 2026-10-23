'use client';

import { useState } from 'react';
import { dateEnLettres } from '@teranga/contracts';
import { cn } from '@teranga/ui';
import { Icon } from './icons';

/*
   L'échéance d'un objectif (ADR-0075) : facultative, elle se choisit dans
   l'année de la fiche, d'aujourd'hui au jour de l'évaluation. Sans elle,
   l'objectif vaut pour l'année.
*/

/** « 20 mars », avec l'année quand ce n'est pas celle de la fiche (toujours, sans fiche). */
const enLettres = (date: string, annee?: number) =>
  dateEnLettres(date, annee === undefined || Number(date.slice(0, 4)) !== annee);

/** Une date ISO complète, dans ses bornes. */
const dansLesBornes = (date: string, min: string, max: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= min && date <= max;

/**
 * L'échéance d'un objectif : « 20 mars », avec l'année quand ce n'est pas
 * celle de sa fiche.
 */
export function Echeance({
  date,
  annee,
  className,
}: {
  date: string;
  /** L'année de la fiche ; sans elle, l'année se lit toujours. */
  annee?: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 text-[11.5px] leading-[18.75px] font-semibold whitespace-nowrap text-ink-muted',
        className,
      )}
    >
      <Icon name="event" size={14} className="opacity-75" />
      <span className="sr-only">Échéance :</span>
      {enLettres(date, annee)}
    </span>
  );
}

/** La puce d'une échéance, comme dans une fiche ouverte : bordée, l'icône, la date. */
const PUCE =
  'inline-flex shrink-0 items-center gap-1 rounded-full border bg-surface py-[3px] pr-2.5 pl-2 text-[11.5px] font-semibold whitespace-nowrap';

/**
 * L'échéance, à choisir : la puce, et dessous le calendrier du navigateur,
 * qui s'ouvre d'un clic. Une date complète, dans ses bornes, vaut aussitôt.
 * Une date à moitié tapée, ou hors des bornes, s'efface quand on quitte la
 * puce. Le calendrier l'efface aussi (« Effacer ») : l'objectif n'a plus
 * d'échéance. `onQuitter` suit la puce qu'on quitte, ou Entrée.
 */
export function ChoixEcheance({
  id,
  date,
  annee,
  min,
  max,
  onChoix,
  onQuitter,
  label,
}: {
  id?: string;
  /** `null` : pas d'échéance. */
  date: string | null;
  annee: number;
  min: string;
  max: string;
  /** `null` : l'échéance est retirée. */
  onChoix: (date: string | null) => void;
  onQuitter?: () => void;
  label: string;
}) {
  // Ce qu'on tape et qui ne vaut pas encore : un jour incomplet, ou hors des bornes.
  const [saisie, setSaisie] = useState<string | null>(null);
  const montree = saisie ?? date;

  return (
    <span
      className={cn(
        PUCE,
        'relative transition-colors duration-150 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/30 hover:border-primary/45 hover:text-primary',
        montree ? 'border-line text-ink' : 'border-dashed border-line text-ink-muted',
      )}
    >
      <Icon name="event" size={14} className="opacity-75" />
      {montree ? enLettres(montree, annee) : 'Échéance'}
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
          onQuitter?.();
        }}
        onChange={(e) => {
          const v = e.target.value;
          // Vidée tout entière (« Effacer », ou chaque partie effacée) : plus
          // d'échéance. Une date à moitié tapée est vide elle aussi, mais le
          // navigateur la dit incomplète : elle attend la suite.
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
          onQuitter?.();
        }}
        className="absolute inset-0 size-full cursor-pointer opacity-0"
      />
    </span>
  );
}
