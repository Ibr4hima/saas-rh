'use client';

import { useEffect, useRef, useState } from 'react';
import type { AttemptView } from '@teranga/contracts';
import { Button, Card, cn } from '@teranga/ui';
import { horloge } from '../lib/academy';
import { compte } from '../lib/mots';
import { Icon, type IconName } from './icons';
import { Modal } from './modal';

/* ————————————————————————————————————————————————————————————————
   La copie de l'évaluation finale : une question à la fois, la minuterie
   toujours en vue, le plan des questions pour y revenir.

   Partagée entre l'épreuve de l'agent et l'ESSAI de la RH : la RH doit voir
   exactement ce que l'agent verra — un écran recopié finirait par diverger.
   ———————————————————————————————————————————————————————————————— */

/** Pour chaque question, les choix cochés. */
export type Reponses = Record<string, string[]>;

/** Coche un choix : il remplace le précédent, ou s'y ajoute quand plusieurs sont justes. */
export function cocher(
  avant: Reponses,
  questionId: string,
  optionId: string,
  multiple: boolean,
): Reponses {
  const deja = avant[questionId] ?? [];
  const suite = multiple
    ? deja.includes(optionId)
      ? deja.filter((o) => o !== optionId)
      : [...deja, optionId]
    : [optionId];
  return { ...avant, [questionId]: suite };
}

/** Les règles de l'épreuve, dites avant de commencer — à l'agent comme à la RH qui l'essaie. */
export function reglesEpreuve(
  questionCount: number,
  minutes: number,
  seuil: number,
): Array<[IconName, string]> {
  return [
    ['quiz', `${compte(questionCount, 'question')}, tirées au hasard pour chaque tentative.`],
    [
      'timer',
      `${minutes} minutes, décomptées dès que vous commencez. À zéro, la copie part d’elle-même.`,
    ],
    [
      'check_circle',
      `${Math.round(seuil * 100)} % de bonnes réponses pour réussir. Quand plusieurs réponses sont justes, il faut les cocher toutes.`,
    ],
  ];
}

/** Les questions restées sans réponse. */
export function sansReponse(copie: AttemptView, reponses: Reponses): number {
  return copie.questions.filter((q) => !(reponses[q.id]?.length ?? 0)).length;
}

export function Minuterie({ expiresAt, onZero }: { expiresAt: string; onZero: () => void }) {
  const fin = new Date(expiresAt).getTime();
  const [reste, setReste] = useState(() => Math.max(0, (fin - Date.now()) / 1000));
  const parti = useRef(false);
  useEffect(() => {
    const t = setInterval(() => {
      const r = Math.max(0, (fin - Date.now()) / 1000);
      setReste(r);
      if (r <= 0 && !parti.current) {
        parti.current = true;
        onZero();
      }
    }, 500);
    return () => clearInterval(t);
  }, [fin, onZero]);
  const urgent = reste <= 60;
  return (
    <span
      role="timer"
      aria-live={urgent ? 'polite' : 'off'}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-bold ring-1',
        urgent
          ? 'bg-danger-soft text-danger ring-danger/30'
          : 'bg-primary-soft/70 text-primary ring-primary/20',
      )}
      style={{ fontVariantNumeric: 'tabular-nums' }}
    >
      <Icon name="timer" size={16} />
      {horloge(reste)}
    </span>
  );
}

export function Copie({
  copie,
  reponses,
  index,
  onIndex,
  onRepondre,
  onRendre,
  onTempsEcoule,
  envoi,
  erreur,
  libelle = 'Évaluation finale',
}: {
  copie: AttemptView;
  reponses: Reponses;
  index: number;
  onIndex: (i: number) => void;
  onRepondre: (q: string, o: string, multiple: boolean) => void;
  onRendre: () => void;
  onTempsEcoule: () => void;
  envoi: boolean;
  erreur: string | null;
  /** Ce qui précède le titre de la formation, en tête de copie. */
  libelle?: string;
}) {
  const q = copie.questions[index]!;
  const multiple = q.kind === 'multiple';
  const cochees = reponses[q.id] ?? [];
  const derniere = index === copie.questions.length - 1;
  const repondues = copie.questions.filter((x) => (reponses[x.id]?.length ?? 0) > 0).length;

  return (
    <Card className="mx-auto w-full max-w-3xl">
      <div className="flex flex-col gap-4 border-b border-line-soft px-5 py-4 sm:px-7">
        <div className="flex items-center gap-3">
          <p className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ink-muted">
            {libelle} · {copie.courseTitle}
          </p>
          <Minuterie expiresAt={copie.expiresAt} onZero={onTempsEcoule} />
        </div>
        {/* Le plan des questions : on voit ce qui reste, on revient où l'on veut. */}
        <nav aria-label="Questions" className="flex flex-wrap gap-1.5">
          {copie.questions.map((x, i) => {
            const faite = (reponses[x.id]?.length ?? 0) > 0;
            return (
              <button
                key={x.id}
                type="button"
                aria-label={`Question ${i + 1}${faite ? ', répondue' : ''}`}
                aria-current={i === index ? 'step' : undefined}
                onClick={() => onIndex(i)}
                className={cn(
                  'grid size-8 place-items-center rounded-full text-[12px] font-bold transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none',
                  i === index
                    ? 'bg-primary text-primary-ink'
                    : faite
                      ? 'bg-primary-soft text-primary'
                      : 'bg-line-soft/70 text-ink-muted hover:bg-hover',
                )}
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {i + 1}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="flex flex-col gap-5 px-5 py-6 sm:px-7">
        <div>
          <p className="text-[10.5px] font-extrabold tracking-[0.14em] text-primary uppercase">
            Question {index + 1} sur {copie.questions.length}
          </p>
          <h2 className="mt-2 text-[18px] leading-snug font-bold whitespace-pre-line text-ink-strong">
            {q.prompt}
          </h2>
          <p className="mt-1.5 text-[12px] font-semibold text-ink-muted">
            {multiple ? 'Plusieurs réponses possibles — cochez-les toutes.' : 'Une seule réponse.'}
          </p>
        </div>

        <div
          role={multiple ? 'group' : 'radiogroup'}
          aria-label="Réponses"
          className="flex flex-col gap-2"
        >
          {q.options.map((o) => {
            const choisie = cochees.includes(o.id);
            return (
              <button
                key={o.id}
                type="button"
                role={multiple ? 'checkbox' : 'radio'}
                aria-checked={choisie}
                onClick={() => onRepondre(q.id, o.id, multiple)}
                className={cn(
                  'flex items-center gap-3 rounded-[12px] border px-4 py-3 text-left text-[13.5px] leading-snug transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none',
                  choisie
                    ? 'border-primary bg-primary-soft/60 font-semibold text-ink-strong'
                    : 'border-line-soft text-ink hover:border-line hover:bg-hover',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'grid size-5 shrink-0 place-items-center border-2 transition-colors',
                    multiple ? 'rounded-[5px]' : 'rounded-full',
                    choisie ? 'border-primary bg-primary text-primary-ink' : 'border-line',
                  )}
                >
                  {choisie ? (
                    multiple ? (
                      <Icon name="check" size={13} />
                    ) : (
                      <span className="size-2 rounded-full bg-primary-ink" />
                    )
                  ) : null}
                </span>
                {o.text}
              </button>
            );
          })}
        </div>

        {erreur ? (
          <p
            role="alert"
            className="rounded-[10px] bg-danger-soft px-3 py-2 text-[12.5px] font-semibold text-danger"
          >
            {erreur}
          </p>
        ) : null}
      </div>

      <div className="flex items-center gap-2 border-t border-line-soft px-5 py-4 sm:px-7">
        <span className="min-w-0 flex-1 text-[12px] whitespace-nowrap text-ink-muted">
          {repondues} / {copie.questions.length} répondues
        </span>
        <Button
          variant="secondary"
          size="sm"
          disabled={index === 0}
          onClick={() => onIndex(index - 1)}
          aria-label="Question précédente"
        >
          <Icon name="chevron_left" size={16} />
          <span className="hidden sm:inline">Précédente</span>
        </Button>
        {derniere ? (
          <Button size="sm" loading={envoi} onClick={onRendre}>
            Rendre ma copie
          </Button>
        ) : (
          <Button size="sm" onClick={() => onIndex(index + 1)}>
            Suivante
            <Icon name="chevron_right" size={16} />
          </Button>
        )}
      </div>
    </Card>
  );
}

/** Rendre une copie incomplète se confirme : les questions sans réponse comptent fausses. */
export function FenetreRendre({
  manquantes,
  envoi,
  onContinuer,
  onRendre,
}: {
  manquantes: number;
  envoi: boolean;
  onContinuer: () => void;
  onRendre: () => void;
}) {
  const n = manquantes;
  return (
    <Modal
      open
      onClose={onContinuer}
      title="Rendre la copie ?"
      maxWidth="max-w-md"
      footer={
        <>
          <Button variant="secondary" onClick={onContinuer}>
            Continuer
          </Button>
          <Button loading={envoi} onClick={onRendre}>
            Rendre quand même
          </Button>
        </>
      }
    >
      <p className="text-[13px] leading-relaxed text-ink">
        {`${compte(n, 'question')} ${n > 1 ? 'restent' : 'reste'} sans réponse : ${n > 1 ? 'elles compteront' : 'elle comptera'} comme fausse${n > 1 ? 's' : ''}.`}
      </p>
    </Modal>
  );
}
