'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import type { CourseAdminView, QuestionAdminView, TypeQuestion } from '@teranga/contracts';
import {
  OPTIONS_MAX,
  OPTIONS_MIN,
  questionSchema,
  SECONDES_PAR_QUESTION,
  VALIDITES_CERTIFICAT,
} from '@teranga/contracts';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  cn,
  Field,
  Input,
  Select,
  Textarea,
} from '@teranga/ui';
import { api, ApiError } from '../lib/api';
import { compte } from '../lib/mots';
import { Icon } from './icons';
import { Modal, ModalSection } from './modal';
import { FenetreSuppression } from './reglages-absences';

/* ————————————————————————————————————————————————————————————————
   L'évaluation finale, dans l'atelier de la RH.

   Une BANQUE de questions plutôt qu'un questionnaire figé : chaque tentative
   en tire un nombre choisi, au hasard, dans un ordre et avec des choix
   mélangés. Plus la banque est large au regard des questions posées, moins
   une tentative ressemble à la précédente.

   Sans question, la formation ne délivre pas de certificat : c'est dit ici,
   pas découvert par un agent le jour où il finit.
   ———————————————————————————————————————————————————————————————— */

const NOMBRES = [5, 10, 15, 20, 30];

export function SectionEvaluation({ formation: f }: { formation: CourseAdminView }) {
  const qc = useQueryClient();
  const [edition, setEdition] = useState<QuestionAdminView | 'nouvelle' | null>(null);
  const [suppression, setSuppression] = useState<QuestionAdminView | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const quiz = f.quiz;
  const banque = quiz.questions.length;
  const posees = Math.min(quiz.questionCount, banque);

  const rafraichir = () => qc.invalidateQueries({ queryKey: ['academy'] });
  const action = useMutation({
    mutationFn: ({
      chemin,
      methode,
      corps,
    }: {
      chemin: string;
      methode: string;
      corps?: unknown;
    }) => api(chemin, { method: methode, body: corps }),
    onSuccess: () => rafraichir(),
    onError: (err) => setErreur(err instanceof ApiError ? err.message : 'Action impossible.'),
  });
  const regler = (questionCount: number, certificateValidityMonths: number | null) => {
    setErreur(null);
    action.mutate({
      chemin: `/academy/courses/${f.id}/evaluation`,
      methode: 'PUT',
      corps: { questionCount, certificateValidityMonths },
    });
  };

  return (
    <Card className="shrink-0">
      <CardHeader className="flex flex-wrap items-center gap-3 border-b border-line-soft pb-3.5">
        <CardTitle className="flex-1">Évaluation finale</CardTitle>
        {/* L'essai : l'épreuve telle qu'un agent la passera, sans rien enregistrer. */}
        {f.quiz.questions.length > 0 ? (
          <Link href={`/academy/gerer/${f.id}/essai`}>
            <Button size="sm" variant="ghost">
              <Icon name="play_arrow" size={16} fill />
              Essayer l’évaluation
            </Button>
          </Link>
        ) : null}
        <Button size="sm" variant="secondary" onClick={() => setEdition('nouvelle')}>
          <Icon name="add" size={16} />
          Ajouter une question
        </Button>
      </CardHeader>

      <div className="flex flex-col gap-4 px-5 py-4">
        {banque === 0 ? (
          <p className="flex items-start gap-2.5 rounded-[12px] bg-bg px-4 py-3 text-[12.5px] leading-relaxed text-ink-muted">
            <Icon name="quiz" size={17} className="mt-px shrink-0 text-primary" />
            Pas encore de question. Sans évaluation, la formation se suit mais ne délivre pas de
            certificat. Une banque plus large que le nombre de questions posées rend chaque
            tentative différente.
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Questions par tentative"
            htmlFor="nombre"
            hint={
              banque > 0
                ? `Tirées au hasard parmi ${compte(banque, 'question')} · ${Math.ceil((posees * SECONDES_PAR_QUESTION) / 60)} min pour répondre`
                : 'Deux minutes par question'
            }
          >
            <Select
              id="nombre"
              value={String(quiz.questionCount)}
              onChange={(e) => regler(Number(e.target.value), quiz.certificateValidityMonths)}
            >
              {[...new Set([...NOMBRES, quiz.questionCount])]
                .sort((a, b) => a - b)
                .map((n) => (
                  <option key={n} value={n}>
                    {n} questions
                  </option>
                ))}
            </Select>
          </Field>
          <Field
            label="Validité du certificat"
            htmlFor="validite"
            hint="Une formation réglementaire se renouvelle."
          >
            <Select
              id="validite"
              value={
                quiz.certificateValidityMonths === null
                  ? ''
                  : String(quiz.certificateValidityMonths)
              }
              onChange={(e) =>
                regler(quiz.questionCount, e.target.value === '' ? null : Number(e.target.value))
              }
            >
              {VALIDITES_CERTIFICAT.map((m) => (
                <option key={m ?? 'jamais'} value={m ?? ''}>
                  {m === null ? 'Sans limite de validité' : `${m} mois`}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {erreur ? (
          <p
            role="alert"
            className="rounded-[10px] bg-danger-soft px-3 py-2 text-[12.5px] font-semibold text-danger"
          >
            {erreur}
          </p>
        ) : null}

        {banque > 0 ? (
          <ol className="flex flex-col">
            {quiz.questions.map((q, i) => {
              const bonnes = q.options.filter((o) => o.correct).length;
              return (
                <li
                  key={q.id}
                  className="flex flex-col gap-2 border-t border-line-soft py-3 md:flex-row md:items-center md:gap-4"
                >
                  <button
                    type="button"
                    onClick={() => setEdition(q)}
                    className="flex min-w-0 flex-1 items-start gap-3 rounded-md text-left focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
                  >
                    <span
                      className="w-5 shrink-0 pt-px text-right text-[12px] font-semibold text-ink-muted"
                      style={{ fontVariantNumeric: 'tabular-nums' }}
                    >
                      {i + 1}.
                    </span>
                    <span className="min-w-0">
                      <span className="line-clamp-2 text-[12.5px] leading-snug font-semibold text-ink hover:text-primary">
                        {q.prompt}
                      </span>
                      <span className="mt-0.5 block text-[11.5px] text-ink-muted">
                        {compte(q.options.length, 'choix', 'choix')} ·{' '}
                        {compte(bonnes, 'bonne réponse', 'bonnes réponses')}
                      </span>
                    </span>
                  </button>
                  <div className="flex items-center gap-1.5 pl-8 md:pl-0">
                    <Badge tone="neutral">
                      {q.kind === 'multiple' ? 'Choix multiple' : 'Choix unique'}
                    </Badge>
                    <BoutonIcone
                      icone="arrow_upward"
                      label="Monter la question"
                      disabled={i === 0}
                      onClick={() =>
                        action.mutate({
                          chemin: `/academy/questions/${q.id}/deplacer`,
                          methode: 'POST',
                          corps: { sens: 'haut' },
                        })
                      }
                    />
                    <BoutonIcone
                      icone="arrow_downward"
                      label="Descendre la question"
                      disabled={i === banque - 1}
                      onClick={() =>
                        action.mutate({
                          chemin: `/academy/questions/${q.id}/deplacer`,
                          methode: 'POST',
                          corps: { sens: 'bas' },
                        })
                      }
                    />
                    <BoutonIcone
                      icone="edit"
                      label="Modifier la question"
                      onClick={() => setEdition(q)}
                    />
                    <BoutonIcone
                      icone="delete"
                      label="Supprimer la question"
                      danger
                      onClick={() => setSuppression(q)}
                    />
                  </div>
                </li>
              );
            })}
          </ol>
        ) : null}
      </div>

      {edition ? (
        <FenetreQuestion
          courseId={f.id}
          question={edition === 'nouvelle' ? null : edition}
          onClose={() => setEdition(null)}
        />
      ) : null}
      {suppression ? (
        <FenetreSuppression
          titre="Supprimer la question"
          nom={suppression.prompt}
          bouton="Supprimer la question"
          chemin={`/academy/questions/${suppression.id}`}
          onClose={() => setSuppression(null)}
          onSupprime={() => {
            setSuppression(null);
            void rafraichir();
          }}
        >
          <p className="text-[12.5px] leading-relaxed text-ink">
            Elle ne sera plus posée. Les copies déjà rendues, et les certificats obtenus, ne
            changent pas.
          </p>
        </FenetreSuppression>
      ) : null}
    </Card>
  );
}

function BoutonIcone({
  icone,
  label,
  onClick,
  disabled,
  danger,
}: {
  icone: 'arrow_upward' | 'arrow_downward' | 'delete' | 'edit';
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex size-7 items-center justify-center rounded-md text-ink-muted transition-colors duration-150 disabled:pointer-events-none disabled:opacity-30',
        danger
          ? 'hover:bg-danger-soft hover:text-danger'
          : 'hover:bg-primary-soft hover:text-primary',
      )}
    >
      <Icon name={icone} size={16} />
    </button>
  );
}

/**
 * Écrire une question : son énoncé, son type, ses choix — et lesquels sont
 * justes. Une case à gauche de chaque choix le marque juste : ronde pour un
 * choix unique, carrée pour plusieurs, comme l'agent la verra.
 */
function FenetreQuestion({
  courseId,
  question,
  onClose,
}: {
  courseId: string;
  question: QuestionAdminView | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [enonce, setEnonce] = useState(question?.prompt ?? '');
  const [type, setType] = useState<TypeQuestion>(question?.kind ?? 'unique');
  const [choix, setChoix] = useState<Array<{ text: string; correct: boolean }>>(
    question?.options.map((o) => ({ text: o.text, correct: o.correct })) ?? [
      { text: '', correct: true },
      { text: '', correct: false },
      { text: '', correct: false },
    ],
  );
  const [erreur, setErreur] = useState<string | null>(null);

  const changerType = (t: TypeQuestion) => {
    setType(t);
    // Revenir au choix unique garde la PREMIÈRE bonne réponse, et elle seule.
    if (t === 'unique') {
      const premiere = choix.findIndex((c) => c.correct);
      setChoix(choix.map((c, i) => ({ ...c, correct: i === (premiere < 0 ? 0 : premiere) })));
    }
  };
  const marquer = (i: number) =>
    setChoix(
      choix.map((c, j) =>
        type === 'unique'
          ? { ...c, correct: j === i }
          : j === i
            ? { ...c, correct: !c.correct }
            : c,
      ),
    );

  const enregistrer = useMutation({
    mutationFn: async () => {
      const corps = { prompt: enonce, kind: type, options: choix };
      const verif = questionSchema.safeParse(corps);
      if (!verif.success) throw new Error(verif.error.issues[0]?.message ?? 'Question incomplète.');
      if (question)
        await api(`/academy/questions/${question.id}`, { method: 'PUT', body: verif.data });
      else
        await api(`/academy/courses/${courseId}/questions`, { method: 'POST', body: verif.data });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['academy'] });
      onClose();
    },
    onError: (err) => setErreur(err instanceof Error ? err.message : 'Enregistrement impossible.'),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={question ? 'Modifier la question' : 'Nouvelle question'}
      subtitle="Cochez à gauche la ou les bonnes réponses."
      maxWidth="max-w-2xl"
      footer={
        <>
          {erreur ? (
            <p
              role="alert"
              className="min-w-0 flex-1 rounded-lg bg-danger-soft px-3 py-2 text-xs font-semibold text-danger"
            >
              {erreur}
            </p>
          ) : null}
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button
            loading={enregistrer.isPending}
            onClick={() => {
              setErreur(null);
              enregistrer.mutate();
            }}
          >
            {question ? 'Enregistrer' : 'Ajouter la question'}
          </Button>
        </>
      }
    >
      <ModalSection title="La question">
        <div className="flex flex-col gap-3.5">
          <Field label="Énoncé" htmlFor="enonce" required>
            <Textarea
              id="enonce"
              rows={3}
              maxLength={1000}
              value={enonce}
              placeholder="Ex : Que mesure le produit intérieur brut ?"
              onChange={(e) => setEnonce(e.target.value)}
            />
          </Field>
          <div
            role="radiogroup"
            aria-label="Type de question"
            className="flex gap-1 rounded-full border border-line-soft bg-bg p-1 sm:w-fit"
          >
            {(['unique', 'multiple'] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={type === t}
                onClick={() => changerType(t)}
                className={cn(
                  'flex-1 rounded-full px-3.5 py-1.5 text-[12.5px] font-bold transition-colors sm:flex-none',
                  type === t
                    ? 'bg-surface text-primary shadow-sm'
                    : 'text-ink-muted hover:text-ink',
                )}
              >
                {t === 'unique' ? 'Une seule bonne réponse' : 'Plusieurs bonnes réponses'}
              </button>
            ))}
          </div>
        </div>
      </ModalSection>

      <ModalSection title="Les choix">
        <ul className="flex flex-col gap-2">
          {choix.map((c, i) => (
            <li key={i} className="flex items-center gap-2.5">
              <button
                type="button"
                role={type === 'unique' ? 'radio' : 'checkbox'}
                aria-checked={c.correct}
                aria-label={`Marquer le choix ${i + 1} comme bonne réponse`}
                title={c.correct ? 'Bonne réponse' : 'Marquer comme bonne réponse'}
                onClick={() => marquer(i)}
                className={cn(
                  'grid size-6 shrink-0 place-items-center border-2 transition-colors',
                  type === 'unique' ? 'rounded-full' : 'rounded-[6px]',
                  c.correct
                    ? 'border-success bg-success text-white'
                    : 'border-line hover:border-success/60',
                )}
              >
                {c.correct ? <Icon name="check" size={14} /> : null}
              </button>
              <Input
                value={c.text}
                maxLength={300}
                aria-label={`Choix ${i + 1}`}
                placeholder={`Choix ${i + 1}`}
                onChange={(e) =>
                  setChoix(choix.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))
                }
                className="h-9 flex-1"
              />
              <button
                type="button"
                aria-label={`Retirer le choix ${i + 1}`}
                disabled={choix.length <= OPTIONS_MIN}
                onClick={() => setChoix(choix.filter((_, j) => j !== i))}
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-ink-muted hover:bg-danger-soft hover:text-danger disabled:pointer-events-none disabled:opacity-30"
              >
                <Icon name="close" size={16} />
              </button>
            </li>
          ))}
        </ul>
        {choix.length < OPTIONS_MAX ? (
          <Button
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={() => setChoix([...choix, { text: '', correct: false }])}
          >
            <Icon name="add" size={15} />
            Ajouter un choix
          </Button>
        ) : null}
      </ModalSection>
    </Modal>
  );
}
