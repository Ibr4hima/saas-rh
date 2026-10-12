'use client';

import { useId, useRef, useState } from 'react';
import {
  dateDEvaluation,
  dateEnLettres,
  echeancesDuSemestre,
  joursAvantLEvaluation,
  periodeDeLEcheance,
  periodeSuivante,
  reglesDesEcheances,
  type JoursEvaluation,
} from '@teranga/contracts';
import { Button, Card, CardContent, cn, Field, Input } from '@teranga/ui';
import { aujourdhui } from '../lib/temps';
import { Icon } from './icons';
import { Modal } from './modal';

/*
   Les objectifs ponctuels, chacun avec son échéance (ADR-0055, ADR-0056).
   Le n+1 fixe les objectifs d'un semestre, et l'échéance de chacun dans la
   période de ce semestre. Trop près de l'évaluation, l'échéance se
   confirme, ou l'objectif se reporte à l'évaluation suivante. La règle se
   lit là où l'on fixe une échéance, avec les jours que la DCH a choisis.
*/

/** Le dernier jour où une échéance se fixe : la dernière évaluation de l'année suivante. */
export function horizonDesEcheances(jours: JoursEvaluation): string {
  return dateDEvaluation(Number(aujourdhui().slice(0, 4)) + 1, 2, jours);
}

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

/**
 * L'échéance, à choisir : la même puce, et dessous le calendrier du
 * navigateur, qui s'ouvre d'un clic. Une date prise au calendrier vaut
 * aussitôt ; tapée au clavier, elle vaut quand on quitte la puce, ou sur
 * Entrée : un jour à moitié tapé ne déclenche rien. Sans échéance, la puce
 * attend la sienne ; `manque` la signale, une fois l'enregistrement refusé.
 */
export function ChoixEcheance({
  id,
  date,
  annee,
  min,
  max,
  onChoix,
  label,
  manque = false,
  reportee,
}: {
  id?: string;
  /** `null` : pas encore choisie. */
  date: string | null;
  annee: number;
  min: string;
  max: string;
  onChoix: (date: string) => void;
  label: string;
  manque?: boolean;
  /** L'échéance compte pour un autre semestre : « S2 ». */
  reportee?: string;
}) {
  const [saisie, setSaisie] = useState<string | null>(null);
  // Le calendrier ouvert d'un clic : la date qu'on y prend vaut tout de suite.
  const auCalendrier = useRef(false);
  const montree = saisie ?? date;

  const choisir = (v: string) => {
    setSaisie(null);
    if (v !== date) onChoix(v);
  };

  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center gap-1 rounded-full border bg-surface py-[3px] pr-2.5 pl-2 text-[11.5px] font-semibold whitespace-nowrap transition-colors duration-150 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/30 hover:border-primary/45 hover:text-primary',
        montree
          ? 'border-line text-ink'
          : manque
            ? 'border-dashed border-danger text-danger'
            : 'border-dashed border-line text-ink-muted',
      )}
    >
      <Icon name="event" size={14} className="opacity-75" />
      {montree ? enLettres(montree, annee) : 'Échéance'}
      {reportee && montree ? (
        <span className="ml-0.5 rounded-full bg-primary-soft px-1.5 text-[10px] leading-4 font-extrabold text-primary">
          {reportee}
        </span>
      ) : null}
      <input
        id={id}
        type="date"
        aria-label={label}
        aria-invalid={manque && !date ? true : undefined}
        value={montree ?? ''}
        min={min}
        max={max}
        required
        onClick={(e) => {
          auCalendrier.current = true;
          try {
            e.currentTarget.showPicker();
          } catch {
            // Un navigateur sans calendrier à ouvrir : la saisie au clavier reste.
          }
        }}
        onKeyDown={(e) => {
          auCalendrier.current = false;
          if (e.key === 'Enter' && saisie && dansLesBornes(saisie, min, max)) {
            e.preventDefault();
            choisir(saisie);
          }
        }}
        onChange={(e) => {
          const v = e.target.value;
          if (auCalendrier.current && dansLesBornes(v, min, max)) {
            auCalendrier.current = false;
            choisir(v);
            return;
          }
          setSaisie(v || null);
        }}
        onBlur={() => {
          auCalendrier.current = false;
          if (saisie && dansLesBornes(saisie, min, max)) choisir(saisie);
          else setSaisie(null);
        }}
        className="absolute inset-0 size-full cursor-pointer opacity-0"
      />
    </span>
  );
}

/**
 * La règle, en avertissement, là où l'on fixe une échéance : les jours
 * d'évaluation sont ceux que la DCH a fixés, et changent avec eux.
 */
export function ReglesDesEcheances({
  jours,
  className,
}: {
  jours: JoursEvaluation;
  className?: string;
}) {
  return (
    <div
      role="note"
      className={cn(
        'flex gap-3 rounded-[12px] bg-primary-soft/60 px-4 py-3 text-[12.5px] leading-relaxed text-ink',
        className,
      )}
    >
      <Icon name="info_i" size={18} className="mt-px shrink-0 text-primary" />
      <ul className="flex list-disc flex-col gap-0.5 pl-4 marker:text-primary/60">
        {reglesDesEcheances(jours).map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Une échéance à 30 jours ou moins de l'évaluation où elle compte : le n+1
 * la confirme, ou reporte l'objectif à l'évaluation suivante, avec une
 * nouvelle échéance prise dans la période de celle-ci.
 */
export function ConfirmerEcheance({
  objectif,
  echeance,
  jours,
  onConfirmer,
  onReporter,
  onClose,
}: {
  /** Le texte de l'objectif. */
  objectif: string;
  echeance: string;
  jours: JoursEvaluation;
  onConfirmer: () => void;
  onReporter: (echeance: string) => void;
  onClose: () => void;
}) {
  const [report, setReport] = useState(false);
  const [nouvelle, setNouvelle] = useState('');
  const champ = useId();
  const periode = periodeDeLEcheance(echeance, jours);
  const ecart = joursAvantLEvaluation(echeance, jours);
  // La prochaine évaluation : ses échéances, à partir d'aujourd'hui et
  // jusqu'à la dernière qui se fixe.
  const suivante = periodeSuivante(periode);
  const { du, au } = echeancesDuSemestre(suivante.annee, suivante.semestre, jours);
  const jour = aujourdhui();
  const horizon = horizonDesEcheances(jours);
  const min = du > jour ? du : jour;
  const max = au < horizon ? au : horizon;
  const reportable = min <= max;

  const quand =
    ecart === 0
      ? 'le jour même de l’échéance de cet objectif'
      : `${ecart} jour${ecart > 1 ? 's' : ''} après l’échéance de cet objectif`;

  return (
    <Modal
      open
      onClose={onClose}
      title={report ? 'Reporter l’objectif' : 'Confirmer cette échéance ?'}
      maxWidth="max-w-md"
      footer={
        report ? (
          <>
            <Button variant="secondary" onClick={() => setReport(false)}>
              Retour
            </Button>
            <Button
              disabled={!dansLesBornes(nouvelle, min, max)}
              onClick={() => onReporter(nouvelle)}
            >
              Reporter
            </Button>
          </>
        ) : (
          <>
            {reportable ? (
              <Button variant="secondary" onClick={() => setReport(true)}>
                Reporter à la prochaine évaluation
              </Button>
            ) : (
              <Button variant="secondary" onClick={onClose}>
                Annuler
              </Button>
            )}
            <Button onClick={onConfirmer}>Confirmer</Button>
          </>
        )
      }
    >
      <Card>
        <CardContent className="flex flex-col gap-3 py-4 text-[13.5px] leading-relaxed text-ink">
          {objectif ? (
            <p className="font-semibold break-words text-ink-strong">{objectif}</p>
          ) : null}
          {report ? (
            <Field
              label={`Nouvelle échéance, au semestre ${suivante.semestre} de ${suivante.annee}`}
              htmlFor={champ}
              hint={`Entre le ${dateEnLettres(min)} et le ${dateEnLettres(max)}`}
            >
              <Input
                id={champ}
                type="date"
                min={min}
                max={max}
                value={nouvelle}
                onChange={(e) => setNouvelle(e.target.value)}
                className="tabular-nums"
              />
            </Field>
          ) : (
            <>
              <Echeance date={echeance} className="text-[12.5px]" />
              <p>
                L’évaluation du semestre {periode.semestre} de {periode.annee} se tiendra {quand}.{' '}
                {reportable
                  ? 'Voulez-vous confirmer cette échéance ou reporter l’objectif à la prochaine évaluation ?'
                  : 'Voulez-vous confirmer cette échéance ?'}
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </Modal>
  );
}
