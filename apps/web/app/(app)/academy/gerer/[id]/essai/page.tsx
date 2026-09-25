'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import type { AttemptView, CourseAdminView, TrialResult } from '@teranga/contracts';
import { SECONDES_PAR_QUESTION, SEUIL_REUSSITE } from '@teranga/contracts';
import { Button, Card, cn, EmptyState, Skeleton } from '@teranga/ui';
import { RetourAcademy } from '../../../../../../components/academy-carte';
import {
  cocher,
  Copie,
  FenetreRendre,
  reglesEpreuve,
  sansReponse,
  type Reponses,
} from '../../../../../../components/academy-copie';
import { FenetreDocument } from '../../../../../../components/fenetre-document';
import { Page } from '../../../../../../components/gabarit';
import { Icon } from '../../../../../../components/icons';
import { LoadFailure } from '../../../../../../components/load-failure';
import { pourcent } from '../../../../../../lib/academy';
import { api, ApiError, apiUrl } from '../../../../../../lib/api';
import { compte } from '../../../../../../lib/mots';

/* ————————————————————————————————————————————————————————————————
   L'essai de l'évaluation, pour la RH.

   La RH passe l'épreuve EXACTEMENT comme un agent la passera — même tirage,
   même minuterie, même copie, même correction — pour relire ses questions
   dans ces conditions-là. Rien n'est enregistré : ni tentative, ni
   certificat. À la fin, et c'est la seule différence, elle voit les bonnes
   réponses ; et si l'essai est réussi, le certificat qu'un agent recevrait,
   barré « SPÉCIMEN ».
   ———————————————————————————————————————————————————————————————— */

export default function EssaiPage() {
  const { id } = useParams<{ id: string }>();
  const formation = useQuery({
    queryKey: ['academy', 'gestion', id],
    queryFn: () => api<CourseAdminView>(`/academy/gestion/courses/${id}`),
  });
  const [copie, setCopie] = useState<AttemptView | null>(null);
  const [reponses, setReponses] = useState<Reponses>({});
  const [index, setIndex] = useState(0);
  const [resultat, setResultat] = useState<TrialResult | null>(null);
  const [confirmer, setConfirmer] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const demarrer = useMutation({
    mutationFn: () => api<AttemptView>(`/academy/courses/${id}/essai`, { method: 'POST' }),
    onSuccess: (c) => {
      setCopie(c);
      setReponses({});
      setIndex(0);
      setResultat(null);
      setErreur(null);
    },
    onError: (err) => setErreur(err instanceof ApiError ? err.message : 'Impossible de commencer.'),
  });

  const rendre = useMutation({
    mutationFn: (r: Reponses) =>
      api<TrialResult>(`/academy/courses/${id}/essai/correction`, {
        method: 'POST',
        body: { questionIds: copie!.questions.map((q) => q.id), answers: r },
      }),
    onSuccess: (res) => {
      setResultat(res);
      setCopie(null);
      setConfirmer(false);
    },
    onError: (err) =>
      setErreur(err instanceof ApiError ? err.message : 'La copie n’a pas pu partir.'),
  });

  const repondre = useCallback(
    (questionId: string, optionId: string, multiple: boolean) =>
      setReponses((avant) => cocher(avant, questionId, optionId, multiple)),
    [],
  );

  if (formation.isPending) {
    return (
      <Page>
        <Skeleton className="h-5 w-48 rounded-full" />
        <Skeleton className="h-[320px] w-full rounded-[16px]" />
      </Page>
    );
  }
  if (formation.isError) {
    return (
      <Page>
        <RetourAcademy href="/academy/gerer" label="Gérer le catalogue" />
        <LoadFailure error={formation.error} onRetry={() => void formation.refetch()} />
      </Page>
    );
  }

  const f = formation.data;

  if (copie) {
    return (
      <Page>
        <Copie
          copie={copie}
          reponses={reponses}
          index={index}
          onIndex={setIndex}
          onRepondre={repondre}
          onRendre={() => {
            if (sansReponse(copie, reponses) > 0) setConfirmer(true);
            else rendre.mutate(reponses);
          }}
          onTempsEcoule={() => rendre.mutate(reponses)}
          envoi={rendre.isPending}
          erreur={erreur}
          libelle="Essai"
        />
        {confirmer ? (
          <FenetreRendre
            manquantes={sansReponse(copie, reponses)}
            envoi={rendre.isPending}
            onContinuer={() => setConfirmer(false)}
            onRendre={() => rendre.mutate(reponses)}
          />
        ) : null}
      </Page>
    );
  }

  return (
    <Page>
      <RetourAcademy href={`/academy/gerer/${id}`} label={f.title} />
      {resultat ? (
        <Resultat
          resultat={resultat}
          formation={f}
          onRecommencer={() => demarrer.mutate()}
          recommence={demarrer.isPending}
          erreur={erreur}
        />
      ) : f.quiz.questions.length === 0 ? (
        <Card className="flex flex-1 items-center justify-center">
          <EmptyState
            icon={<Icon name="quiz" size={22} />}
            title="Pas encore de questions"
            description="Ajoutez des questions à l’évaluation finale pour pouvoir l’essayer."
          />
        </Card>
      ) : (
        <Accueil
          formation={f}
          onCommencer={() => demarrer.mutate()}
          commence={demarrer.isPending}
          erreur={erreur}
        />
      )}
    </Page>
  );
}

function Erreur({ texte }: { texte: string | null }) {
  if (!texte) return null;
  return (
    <p
      role="alert"
      className="rounded-[10px] bg-danger-soft px-3 py-2 text-[12.5px] font-semibold text-danger"
    >
      {texte}
    </p>
  );
}

// ———————————————————————————— l'accueil

function Accueil({
  formation: f,
  onCommencer,
  commence,
  erreur,
}: {
  formation: CourseAdminView;
  onCommencer: () => void;
  commence: boolean;
  erreur: string | null;
}) {
  // Ce que l'agent verra : le réglage, borné par la taille de la banque.
  const n = Math.min(f.quiz.questionCount, f.quiz.questions.length);
  const minutes = Math.ceil((n * SECONDES_PAR_QUESTION) / 60);
  return (
    <Card className="mx-auto w-full max-w-2xl">
      <div className="flex flex-col gap-5 p-6 sm:p-8">
        <div>
          <p className="text-[10.5px] font-extrabold tracking-[0.14em] text-primary uppercase">
            Essai de l’évaluation finale
          </p>
          <h1 className="mt-1.5 text-[21px] leading-tight font-bold tracking-[-0.02em] text-ink-strong">
            {f.title}
          </h1>
          <p className="mt-1 text-[12.5px] font-semibold text-ink-muted">
            {compte(n, 'question')} · {minutes} min · {Math.round(SEUIL_REUSSITE * 100)} % pour
            réussir
          </p>
        </div>
        <p className="flex gap-3 rounded-[12px] bg-primary-soft/60 px-4 py-3 text-[12.5px] leading-relaxed text-ink">
          <Icon name="visibility" size={18} className="mt-px shrink-0 text-primary" />
          <span>
            Vous passez l’épreuve comme un agent la passera. Rien n’est enregistré et aucun
            certificat n’est délivré ; à la fin, vous voyez les bonnes réponses.
          </span>
        </p>
        <ul className="flex flex-col gap-3">
          {reglesEpreuve(n, minutes, SEUIL_REUSSITE).map(([icone, texte]) => (
            <li key={texte} className="flex gap-3 text-[13px] leading-relaxed text-ink">
              <Icon name={icone} size={18} className="mt-0.5 shrink-0 text-primary" />
              {texte}
            </li>
          ))}
        </ul>
        <Erreur texte={erreur} />
        <div className="flex justify-end border-t border-line-soft pt-5">
          <Button loading={commence} onClick={onCommencer}>
            <Icon name="play_arrow" size={17} fill />
            Commencer l’essai
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ———————————————————————————— le résultat, avec les bonnes réponses

function Resultat({
  resultat: r,
  formation: f,
  onRecommencer,
  recommence,
  erreur,
}: {
  resultat: TrialResult;
  formation: CourseAdminView;
  onRecommencer: () => void;
  recommence: boolean;
  erreur: string | null;
}) {
  const [specimen, setSpecimen] = useState(false);
  const exigees = Math.ceil(r.seuil * r.total - 1e-9);
  const pdf = `/academy/courses/${f.id}/certificat-specimen?score=${r.score}`;
  return (
    <Card className="mx-auto w-full max-w-3xl">
      <div className="flex flex-col items-center gap-3 px-6 pt-8 pb-6 text-center">
        <span
          className={cn(
            'grid size-14 place-items-center rounded-full',
            r.passed ? 'bg-success-soft text-success' : 'bg-line-soft text-ink-muted',
          )}
        >
          <Icon name={r.passed ? 'workspace_premium' : 'replay'} size={28} />
        </span>
        <p
          className={cn(
            'text-[44px] leading-none font-bold',
            r.passed ? 'text-success' : 'text-ink-strong',
          )}
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {pourcent(r.score)}
        </p>
        <h1 className="text-[18px] font-bold text-ink-strong">
          {r.passed ? 'Essai réussi' : 'Essai non réussi'}
        </h1>
        <p className="max-w-md text-[12.5px] leading-relaxed text-ink-muted">
          {compte(r.correctCount, 'bonne réponse', 'bonnes réponses')} sur {r.total} — il en fallait{' '}
          {exigees}. Rien n’a été enregistré.
        </p>
        {r.passed ? (
          <div className="mt-2 flex w-full flex-col items-center gap-3 rounded-[14px] border border-success/25 bg-success-soft/50 px-5 py-4">
            <p className="text-[13px] leading-relaxed text-ink">
              Un agent recevrait ce certificat. L’aperçu est barré « spécimen » : il n’a pas de
              numéro et ne se vérifie pas.
            </p>
            <Button onClick={() => setSpecimen(true)}>
              <Icon name="workspace_premium" size={16} />
              Voir le certificat spécimen
            </Button>
          </div>
        ) : null}
        <Erreur texte={erreur} />
      </div>

      <div className="border-t border-line-soft px-6 py-5 sm:px-7">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[10.5px] font-extrabold tracking-[0.14em] text-primary uppercase">
            La correction
          </h2>
          <p className="flex items-center gap-3 text-[11.5px] text-ink-muted">
            <span className="inline-flex items-center gap-1.5">
              <Repere juste /> bonne réponse
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Repere faux /> choix erroné
            </span>
          </p>
        </div>
        <ol className="mt-3 flex flex-col gap-5">
          {r.questions.map((q, i) => (
            <li key={q.id} className="flex flex-col gap-2">
              <p className="flex items-start gap-2.5 text-[13px] leading-snug font-semibold text-ink-strong">
                <Icon
                  name={q.correct ? 'check_circle' : 'error'}
                  size={18}
                  fill={q.correct}
                  className={cn('mt-px shrink-0', q.correct ? 'text-success' : 'text-danger')}
                />
                <span>
                  <span className="mr-1.5 text-ink-muted">{i + 1}.</span>
                  {q.prompt}
                </span>
              </p>
              <ul className="flex flex-col gap-1.5 pl-7">
                {q.options.map((o) => (
                  <li key={o.id} className="flex items-center gap-2.5 text-[12.5px] leading-snug">
                    <Repere juste={o.correct} faux={o.chosen && !o.correct} />
                    <span
                      className={o.correct ? 'font-semibold text-ink-strong' : 'text-ink-muted'}
                    >
                      {o.text}
                      {o.correct ? <span className="sr-only"> (bonne réponse)</span> : null}
                    </span>
                    {o.chosen ? (
                      <span className="shrink-0 rounded-full bg-line-soft px-2 py-0.5 text-[10.5px] font-bold text-ink-muted">
                        Votre choix
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </div>

      <div className="flex flex-wrap justify-center gap-2 border-t border-line-soft px-6 py-4">
        <Link href={`/academy/gerer/${f.id}`}>
          <Button variant="secondary">Retour à l’atelier</Button>
        </Link>
        <Button loading={recommence} onClick={onRecommencer}>
          <Icon name="replay" size={16} />
          Nouvel essai
        </Button>
      </div>
      {specimen ? (
        <FenetreDocument
          doc={{
            url: apiUrl(`${pdf}&disposition=inline`),
            filename: 'Certificat specimen.pdf',
            contentType: 'application/pdf',
            titre: `Certificat spécimen — ${f.title}`,
          }}
          sousTitre="Aperçu : ce document n’est pas un certificat"
          telechargement={apiUrl(pdf)}
          onClose={() => setSpecimen(false)}
        />
      ) : null}
    </Card>
  );
}

/** Le repère d'un choix : coché vert s'il est juste, croix rouge s'il a été choisi à tort. */
function Repere({ juste = false, faux = false }: { juste?: boolean; faux?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-[18px] shrink-0 place-items-center rounded-full',
        juste
          ? 'bg-success-soft text-success'
          : faux
            ? 'bg-danger-soft text-danger'
            : 'border border-line',
      )}
    >
      {juste ? <Icon name="check" size={12} /> : faux ? <Icon name="close" size={12} /> : null}
    </span>
  );
}
