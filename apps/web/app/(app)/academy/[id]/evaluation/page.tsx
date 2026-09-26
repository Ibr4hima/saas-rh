'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AttemptResult, AttemptView, CourseDetail } from '@teranga/contracts';
import { Button, Card, cn, EmptyState, Skeleton } from '@teranga/ui';
import { RetourAcademy } from '../../../../../components/academy-carte';
import { ApercuCertificat } from '../../../../../components/academy-certificat';
import {
  cocher,
  Copie,
  FenetreRendre,
  reglesEpreuve,
  sansReponse,
  type Reponses,
} from '../../../../../components/academy-copie';
import {
  reglesEvaluation,
  tentativesDuJour,
} from '../../../../../components/academy-evaluation-carte';
import { Page } from '../../../../../components/gabarit';
import { Icon, type IconName } from '../../../../../components/icons';
import { LoadFailure } from '../../../../../components/load-failure';
import { pourcent, quandLisible } from '../../../../../lib/academy';
import { api, ApiError } from '../../../../../lib/api';
import { compte } from '../../../../../lib/mots';

/* ————————————————————————————————————————————————————————————————
   L'évaluation finale.

   Trois temps. L'ACCUEIL dit les règles avant qu'on s'engage : combien de
   questions, combien de minutes, quel seuil, combien de tentatives. La COPIE
   pose une question à la fois, avec la minuterie toujours en vue et le
   plan des questions pour y revenir. Le RÉSULTAT dit le score, question par
   question juste ou non — jamais la bonne réponse, que la tentative
   suivante ne doit pas connaître d'avance.

   Tout ce qui compte se décide au serveur : les questions tirées, l'heure
   limite, la correction. La minuterie de l'écran n'est que l'affichage de
   l'heure limite qu'il a fixée ; à zéro, la copie part d'elle-même.
   ———————————————————————————————————————————————————————————————— */

const cle = (attemptId: string) => `academy-copie-${attemptId}`;

function lireBrouillon(attemptId: string): Reponses {
  try {
    const brut = sessionStorage.getItem(cle(attemptId));
    return brut ? (JSON.parse(brut) as Reponses) : {};
  } catch {
    return {};
  }
}

function ecrireBrouillon(attemptId: string, r: Reponses | null): void {
  try {
    if (r) sessionStorage.setItem(cle(attemptId), JSON.stringify(r));
    else sessionStorage.removeItem(cle(attemptId));
  } catch {
    /* navigation privée : la copie vit alors en mémoire seulement */
  }
}

export default function EvaluationPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const formation = useQuery({
    queryKey: ['academy', 'course', id],
    queryFn: () => api<CourseDetail>(`/academy/courses/${id}`),
  });
  const [copie, setCopie] = useState<AttemptView | null>(null);
  const [reponses, setReponses] = useState<Reponses>({});
  const [index, setIndex] = useState(0);
  const [resultat, setResultat] = useState<AttemptResult | null>(null);
  const [confirmer, setConfirmer] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const demarrer = useMutation({
    mutationFn: () => api<AttemptView>(`/academy/courses/${id}/tentatives`, { method: 'POST' }),
    onSuccess: (c) => {
      setCopie(c);
      setReponses(lireBrouillon(c.id));
      setIndex(0);
      setResultat(null);
      setErreur(null);
    },
    onError: (err) => setErreur(err instanceof ApiError ? err.message : 'Impossible de commencer.'),
  });

  const rendre = useMutation({
    mutationFn: (r: Reponses) =>
      api<AttemptResult>(`/academy/tentatives/${copie!.id}/soumission`, {
        method: 'POST',
        body: { answers: r },
      }),
    onSuccess: (res) => {
      ecrireBrouillon(copie!.id, null);
      setResultat(res);
      setCopie(null);
      setConfirmer(false);
      void qc.invalidateQueries({ queryKey: ['academy'] });
    },
    onError: (err) =>
      setErreur(err instanceof ApiError ? err.message : 'La copie n’a pas pu partir.'),
  });

  // Une copie déjà ouverte (rechargement, autre onglet) se reprend d'elle-même.
  const etat = formation.data?.evaluation?.etat;
  const repris = useRef(false);
  useEffect(() => {
    if (etat === 'en_cours' && !copie && !resultat && !repris.current) {
      repris.current = true;
      demarrer.mutate();
    }
  }, [etat, copie, resultat, demarrer]);

  // Quitter la page en pleine copie la laisse filer : on prévient.
  useEffect(() => {
    if (!copie) return;
    const retenir = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', retenir);
    return () => window.removeEventListener('beforeunload', retenir);
  }, [copie]);

  const repondre = useCallback(
    (questionId: string, optionId: string, multiple: boolean) => {
      if (!copie) return;
      setReponses((avant) => {
        const r = cocher(avant, questionId, optionId, multiple);
        ecrireBrouillon(copie.id, r);
        return r;
      });
    },
    [copie],
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
        <RetourAcademy href="/academy" label="APIX Academy" />
        <LoadFailure error={formation.error} onRetry={() => void formation.refetch()} />
      </Page>
    );
  }

  const f = formation.data;
  const ev = f.evaluation;

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
      <RetourAcademy href={`/academy/${id}`} label={f.title} />
      {resultat ? (
        <Resultat
          resultat={resultat}
          formation={f}
          onRecommencer={() => demarrer.mutate()}
          recommence={demarrer.isPending}
          erreur={erreur}
        />
      ) : !ev ? (
        <Card className="flex flex-1 items-center justify-center">
          <EmptyState
            icon={<Icon name="quiz" size={22} />}
            title="Cette formation n’a pas d’évaluation"
            description="Elle ne délivre pas de certificat."
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

// ———————————————————————————— l'accueil

function Accueil({
  formation: f,
  onCommencer,
  commence,
  erreur,
}: {
  formation: CourseDetail;
  onCommencer: () => void;
  commence: boolean;
  erreur: string | null;
}) {
  const ev = f.evaluation!;
  const ouvrable = f.mode === 'suivi' && (ev.etat === 'ouverte' || ev.etat === 'en_cours');
  const regles: Array<[IconName, string]> = [
    ...reglesEpreuve(ev.questionCount, ev.minutes, ev.seuil),
    [
      'replay',
      ev.tentativesParJour
        ? `${ev.tentativesParJour} tentatives par jour.`
        : 'En cas d’échec, vous pouvez la repasser.',
    ],
  ];
  return (
    <Card className="mx-auto w-full max-w-2xl">
      <div className="flex flex-col gap-5 p-6 sm:p-8">
        <div>
          <p className="text-[10.5px] font-extrabold tracking-[0.14em] text-primary uppercase">
            Évaluation finale
          </p>
          <h1 className="mt-1.5 text-[21px] leading-tight font-bold tracking-[-0.02em] text-ink-strong">
            {f.title}
          </h1>
          <p className="mt-1 text-[12.5px] font-semibold text-ink-muted">{reglesEvaluation(ev)}</p>
        </div>
        <ul className="flex flex-col gap-3">
          {regles.map(([icone, texte]) => (
            <li key={texte} className="flex gap-3 text-[13px] leading-relaxed text-ink">
              <Icon name={icone} size={18} className="mt-0.5 shrink-0 text-primary" />
              {texte}
            </li>
          ))}
        </ul>
        {erreur ? (
          <p
            role="alert"
            className="rounded-[10px] bg-danger-soft px-3 py-2 text-[12.5px] font-semibold text-danger"
          >
            {erreur}
          </p>
        ) : null}
        <div className="flex flex-col gap-3 border-t border-line-soft pt-5 sm:flex-row sm:items-center">
          <p className="flex-1 text-[12.5px] text-ink-muted">
            {f.mode !== 'suivi'
              ? 'L’évaluation se passe depuis un compte d’agent.'
              : ev.etat === 'verrouillee'
                ? 'Validez d’abord toutes les leçons de la formation.'
                : ev.etat === 'attente'
                  ? `Vos tentatives du jour sont passées. La prochaine s’ouvre ${ev.prochaineTentative ? quandLisible(ev.prochaineTentative) : 'bientôt'}.`
                  : ev.etat === 'reussie'
                    ? 'Vous avez déjà réussi cette évaluation.'
                    : ev.etat === 'en_cours'
                      ? 'Votre copie est ouverte : le temps court encore.'
                      : tentativesDuJour(ev)}
          </p>
          <Button disabled={!ouvrable} loading={commence} onClick={onCommencer}>
            <Icon name="play_arrow" size={17} fill />
            {ev.etat === 'en_cours' ? 'Reprendre' : 'Commencer'}
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ———————————————————————————— le résultat

function Resultat({
  resultat: r,
  formation: f,
  onRecommencer,
  recommence,
  erreur,
}: {
  resultat: AttemptResult;
  formation: CourseDetail;
  onRecommencer: () => void;
  recommence: boolean;
  erreur: string | null;
}) {
  const [apercu, setApercu] = useState(false);
  const ev = r.evaluation;
  const exigees = Math.ceil(ev.seuil * r.total - 1e-9);
  return (
    <Card className="mx-auto w-full max-w-2xl">
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
          {r.passed ? 'Évaluation réussie' : 'Évaluation non réussie'}
        </h1>
        <p className="max-w-md text-[12.5px] leading-relaxed text-ink-muted">
          {r.expired
            ? 'Le temps était écoulé quand la copie est arrivée : elle compte pour zéro.'
            : `${compte(r.correctCount, 'bonne réponse', 'bonnes réponses')} sur ${r.total} — il en fallait ${exigees}.`}
          {!r.passed
            ? ev.etat === 'attente'
              ? ` Vos tentatives du jour sont passées : la prochaine s’ouvre ${ev.prochaineTentative ? quandLisible(ev.prochaineTentative) : 'bientôt'}.`
              : tentativesDuJour(ev)
                ? ` ${tentativesDuJour(ev)}`
                : ''
            : ''}
        </p>

        {r.passed && r.certificat ? (
          <div className="mt-2 flex w-full flex-col items-center gap-3 rounded-[14px] border border-success/25 bg-success-soft/50 px-5 py-4">
            <p className="text-[13px] leading-relaxed text-ink">
              Votre certificat{' '}
              <b className="font-mono font-bold tracking-tight">{r.certificat.number}</b> est prêt.
              Il se vérifie en ligne par son QR code.
            </p>
            <Button onClick={() => setApercu(true)}>
              <Icon name="workspace_premium" size={16} />
              Voir le certificat
            </Button>
          </div>
        ) : null}
        {erreur ? (
          <p
            role="alert"
            className="rounded-[10px] bg-danger-soft px-3 py-2 text-[12.5px] font-semibold text-danger"
          >
            {erreur}
          </p>
        ) : null}
      </div>

      {!r.expired ? (
        <ol className="flex flex-col border-t border-line-soft px-6 py-4">
          {r.questions.map((q, i) => (
            <li key={q.id} className="flex items-start gap-3 py-2 text-[12.5px] leading-snug">
              <Icon
                name={q.correct ? 'check_circle' : 'error'}
                size={17}
                fill={q.correct}
                className={cn('mt-px shrink-0', q.correct ? 'text-success' : 'text-danger')}
              />
              <span className="text-ink">
                <span className="mr-1.5 font-semibold text-ink-muted">{i + 1}.</span>
                {q.prompt}
              </span>
            </li>
          ))}
        </ol>
      ) : null}

      <div className="flex flex-wrap justify-center gap-2 border-t border-line-soft px-6 py-4">
        <Link href={`/academy/${f.id}`}>
          <Button variant="secondary">Revenir à la formation</Button>
        </Link>
        {!r.passed && ev.etat === 'ouverte' ? (
          <Button loading={recommence} onClick={onRecommencer}>
            <Icon name="replay" size={16} />
            Nouvelle tentative
          </Button>
        ) : null}
      </div>
      {apercu && r.certificat ? (
        <ApercuCertificat certificat={r.certificat} onClose={() => setApercu(false)} />
      ) : null}
    </Card>
  );
}
