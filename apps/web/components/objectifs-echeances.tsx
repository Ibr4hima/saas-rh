'use client';

import { useId, useState } from 'react';
import {
  dateDEvaluation,
  dateEnLettres,
  echeancesDuSemestre,
  joursAvantLEvaluation,
  periodeDeLEcheance,
  periodeSuivante,
  type JoursEvaluation,
} from '@teranga/contracts';
import { Button, Card, CardContent, cn, Field, Input } from '@teranga/ui';
import { aujourdhui } from '../lib/temps';
import { Icon } from './icons';
import { Modal } from './modal';

/*
   Les objectifs ponctuels, chacun avec son échéance (ADR-0055, ADR-0056,
   ADR-0057). Le n+1 fixe les objectifs d'un semestre, et l'échéance de
   chacun dans la période de ce semestre. À l'enregistrement, une échéance
   trop près de l'évaluation se confirme, ou l'objectif se reporte à
   l'évaluation suivante.
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
 * navigateur, qui s'ouvre d'un clic. Une date complète, dans ses bornes,
 * vaut aussitôt ; rien ne s'ouvre pour autant, même quand le calendrier la
 * change en passant d'un mois à l'autre. Une date à moitié tapée, ou hors des
 * bornes, s'efface quand on quitte la puce. `onQuitter` suit la puce qu'on
 * quitte, ou Entrée. Sans échéance, la puce attend la sienne ; `manque` la
 * signale, une fois l'enregistrement refusé.
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
  onQuitter?: () => void;
  label: string;
  manque?: boolean;
  /** L'échéance compte pour un autre semestre : « S2 ». */
  reportee?: string;
}) {
  // Ce qu'on tape et qui ne vaut pas encore : un jour incomplet, ou hors des bornes.
  const [saisie, setSaisie] = useState<string | null>(null);
  const montree = saisie ?? date;

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

/**
 * Une échéance à 30 jours ou moins de l'évaluation où elle compte, à
 * l'enregistrement : le n+1 la confirme, ou reporte l'objectif à
 * l'évaluation suivante, avec une nouvelle échéance prise dans la période de
 * celle-ci. Fermer la fenêtre arrête l'enregistrement.
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
