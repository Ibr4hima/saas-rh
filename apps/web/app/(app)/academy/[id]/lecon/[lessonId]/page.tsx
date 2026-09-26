'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import type { BeatResult, CourseDetail, LessonPlayback } from '@teranga/contracts';
import { SEUIL_VISIONNAGE } from '@teranga/contracts';
import { Button, Card, EmptyState, Skeleton } from '@teranga/ui';
import { BarreProgression, RetourAcademy } from '../../../../../../components/academy-carte';
import { Programme } from '../../../../../../components/academy-programme';
import { FenetreDocument } from '../../../../../../components/fenetre-document';
import { Page } from '../../../../../../components/gabarit';
import { Icon } from '../../../../../../components/icons';
import { LecteurVideo } from '../../../../../../components/lecteur-video';
import { LoadFailure } from '../../../../../../components/load-failure';
import { pourcent } from '../../../../../../lib/academy';
import { api, ApiError, apiUrl } from '../../../../../../lib/api';

/* ————————————————————————————————————————————————————————————————
   Une leçon : la vidéo, et tout ce qui dit où l'on en est.

   Le programme reste à côté, toujours visible sur grand écran : on sait
   combien il reste, et quelle leçon s'ouvrira ensuite. Sous la vidéo, la
   seule chose qui compte pour l'agent : combien il en a vu, et ce qu'il faut
   pour valider.

   Ouvrir la leçon ouvre une SESSION DE LECTURE au serveur : ce n'est pas une
   lecture qu'on peut refaire au hasard d'un retour sur l'onglet. La requête
   ne se relance donc que sur demande — « Reprendre ici » —, jamais toute
   seule.
   ———————————————————————————————————————————————————————————————— */

export default function LeconPage() {
  const { id, lessonId } = useParams<{ id: string; lessonId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [ouverture, setOuverture] = useState(0);
  const [supportOuvert, setSupportOuvert] = useState(false);

  const formation = useQuery({
    queryKey: ['academy', 'course', id],
    queryFn: () => api<CourseDetail>(`/academy/courses/${id}`),
  });
  const lecture = useQuery({
    queryKey: ['academy', 'lecture', lessonId, ouverture],
    queryFn: () => api<LessonPlayback>(`/academy/lessons/${lessonId}/lecture`, { method: 'POST' }),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  // Ce que les battements apprennent, sans attendre de recharger la formation.
  const [etat, setEtat] = useState<{ vu: number; validee: boolean } | null>(null);
  const surBattement = useCallback(
    (r: BeatResult) => {
      setEtat({ vu: r.vu, validee: r.validee });
      if (r.vientDeValider) {
        // La leçon suivante vient de s'ouvrir : le programme doit le montrer.
        void qc.invalidateQueries({ queryKey: ['academy', 'course', id] });
        void qc.invalidateQueries({ queryKey: ['academy', 'catalogue'] });
      }
    },
    [qc, id],
  );

  if (lecture.isPending || formation.isPending) {
    return (
      <Page>
        <Skeleton className="h-5 w-48 rounded-full" />
        <Skeleton className="aspect-video w-full rounded-[16px]" />
        <Skeleton className="h-[140px] w-full rounded-[16px]" />
      </Page>
    );
  }

  if (lecture.isError || formation.isError) {
    const err = lecture.error ?? formation.error;
    const code = err instanceof ApiError ? err.problem.code : undefined;
    return (
      <Page>
        <RetourAcademy
          href={formation.data ? `/academy/${id}` : '/academy'}
          label={formation.data?.title ?? 'APIX Academy'}
        />
        {code === 'academy.lesson_locked' || code === 'academy.video_unavailable' ? (
          <Card className="flex flex-1 items-center justify-center">
            <EmptyState
              icon={<Icon name="lock" size={22} />}
              title={
                code === 'academy.lesson_locked'
                  ? 'Cette leçon n’est pas encore ouverte'
                  : 'La vidéo de cette leçon n’est pas prête'
              }
              description={
                code === 'academy.lesson_locked'
                  ? 'Les leçons se suivent dans l’ordre : terminez d’abord celles qui la précèdent.'
                  : 'Elle sera disponible dès que la RH l’aura déposée.'
              }
              action={
                <Link href={`/academy/${id}`}>
                  <Button variant="secondary">Voir le programme</Button>
                </Link>
              }
            />
          </Card>
        ) : (
          <LoadFailure error={err} onRetry={() => setOuverture((n) => n + 1)} />
        )}
      </Page>
    );
  }

  const l = lecture.data;
  const f = formation.data;
  const suivi = l.mode === 'suivi';
  const validee = etat?.validee ?? l.validee;
  const vu = etat?.vu ?? l.vu;

  // Où la leçon se situe : son module, son rang.
  const toutes = f.modules.flatMap((m, i) =>
    m.lessons.map((x) => ({ ...x, module: i + 1, nomModule: m.title })),
  );
  const rang = toutes.findIndex((x) => x.id === lessonId);
  const ici = toutes[rang];
  const suivanteOuverte = Boolean(l.suivante) && (validee || !suivi);
  const allerSuivante = suivanteOuverte
    ? () => router.push(`/academy/${id}/lecon/${l.suivante}`)
    : undefined;

  return (
    <Page>
      <RetourAcademy href={`/academy/${id}`} label={f.title} />

      {/* Une seule colonne : la vidéo prend toute la largeur — c'est elle
          qu'on regarde —, la leçon et le programme viennent dessous. */}
      <div className="flex min-w-0 flex-col gap-4">
        <LecteurVideo
          key={l.sessionId ?? `${l.lessonId}-${ouverture}`}
          lecture={l}
          onBattement={surBattement}
          onReprendreIci={() => setOuverture((n) => n + 1)}
          onSuivante={allerSuivante}
        />

        <Card>
          <div className="flex flex-col gap-4 p-5">
            <div>
              {ici ? (
                <p className="text-[10.5px] font-extrabold tracking-[0.14em] text-primary uppercase">
                  Module {ici.module} · Leçon {rang + 1} sur {toutes.length}
                </p>
              ) : null}
              <h1 className="mt-1.5 text-[19px] leading-snug font-bold tracking-[-0.015em] text-ink-strong">
                {l.title}
              </h1>
            </div>

            {suivi ? (
              validee ? (
                <p className="flex items-center gap-2 text-[12.5px] font-semibold text-success">
                  <Icon name="check_circle" size={17} fill />
                  Leçon validée
                  {l.suivante ? ' — la suivante est ouverte.' : ' — c’était la dernière.'}
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="relative max-w-md">
                    <BarreProgression part={vu} />
                    {/* Le repère des 90 % : on voit la ligne d'arrivée. */}
                    <span
                      aria-hidden
                      className="absolute -top-1 h-3.5 w-0.5 rounded-full bg-ink-strong/60"
                      style={{ left: `${SEUIL_VISIONNAGE * 100}%` }}
                    />
                  </div>
                  <p className="text-[12px] text-ink-muted">
                    Vue à <b className="font-bold text-ink">{pourcent(vu)}</b> —{' '}
                    {Math.round(SEUIL_VISIONNAGE * 100)} % pour valider la leçon et ouvrir la
                    suivante.
                  </p>
                </div>
              )
            ) : null}

            <div className="flex flex-wrap items-center gap-2 border-t border-line-soft pt-4">
              {ici?.support ? (
                // Le support s'ouvre dans l'aperçu du produit, comme toute
                // pièce : on le lit sans quitter la leçon, et on le
                // télécharge de là si on veut le garder.
                <button
                  type="button"
                  onClick={() => setSupportOuvert(true)}
                  className="mr-auto inline-flex items-center gap-2 rounded-full border border-line px-3.5 py-1.5 text-[12px] font-semibold text-ink transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
                >
                  <Icon name="description" size={16} className="text-primary" />
                  Support de la leçon
                  <span className="font-normal text-ink-muted">
                    PDF · {Math.max(1, Math.round(ici.support.size / 1024))} Ko
                  </span>
                </button>
              ) : (
                <span className="mr-auto" />
              )}
              {l.precedente ? (
                <Link href={`/academy/${id}/lecon/${l.precedente}`}>
                  <Button variant="secondary" size="sm">
                    <Icon name="chevron_left" size={16} />
                    Précédente
                  </Button>
                </Link>
              ) : null}
              {/* La dernière leçon validée ouvre l'évaluation : c'est le
                  geste suivant, il prend la place de « Leçon suivante ». */}
              {!l.suivante &&
              suivi &&
              (f.evaluation?.etat === 'ouverte' || f.evaluation?.etat === 'en_cours') ? (
                <Link href={`/academy/${id}/evaluation`}>
                  <Button size="sm">
                    <Icon name="quiz" size={16} />
                    Passer l’évaluation
                  </Button>
                </Link>
              ) : null}
              {l.suivante ? (
                <Button
                  size="sm"
                  disabled={!suivanteOuverte}
                  title={
                    suivanteOuverte ? undefined : 'Validez cette leçon pour ouvrir la suivante'
                  }
                  onClick={allerSuivante}
                >
                  Leçon suivante
                  <Icon name={suivanteOuverte ? 'chevron_right' : 'lock'} size={16} />
                </Button>
              ) : null}
            </div>
          </div>
        </Card>

        <Programme formation={f} courante={lessonId} avancement />
      </div>
      {supportOuvert && ici?.support ? (
        <FenetreDocument
          doc={{
            url: apiUrl(`/academy/lessons/${lessonId}/support?disposition=inline`),
            filename: ici.support.filename,
            contentType: 'application/pdf',
            titre: `Support — ${l.title}`,
          }}
          sousTitre={f.title}
          telechargement={apiUrl(`/academy/lessons/${lessonId}/support`)}
          onClose={() => setSupportOuvert(false)}
        />
      ) : null}
    </Page>
  );
}
