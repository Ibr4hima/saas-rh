'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { CourseDetail } from '@teranga/contracts';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@teranga/ui';
import { BarreProgression, Couverture, RetourAcademy } from '../../../../components/academy-carte';
import { Programme } from '../../../../components/academy-programme';
import { Page } from '../../../../components/gabarit';
import { Icon } from '../../../../components/icons';
import { LoadFailure } from '../../../../components/load-failure';
import { dureeLisible, FAMILLES } from '../../../../lib/academy';
import { api } from '../../../../lib/api';
import { compte } from '../../../../lib/mots';

/* ————————————————————————————————————————————————————————————————
   Une formation : ce qu'elle promet, combien de temps elle prend, où l'agent
   en est — et UN bouton, qui mène toujours au bon endroit : la première
   leçon pour commencer, la leçon en cours pour reprendre, le début pour
   revoir une formation terminée.
   ———————————————————————————————————————————————————————————————— */

export default function FormationPage() {
  const { id } = useParams<{ id: string }>();
  const formation = useQuery({
    queryKey: ['academy', 'course', id],
    queryFn: () => api<CourseDetail>(`/academy/courses/${id}`),
  });

  if (formation.isPending) {
    return (
      <Page>
        <Skeleton className="h-5 w-40 rounded-full" />
        <Skeleton className="h-[200px] w-full shrink-0 rounded-[16px]" />
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
  const famille = FAMILLES[f.category];
  const suivi = f.mode === 'suivi';
  const terminee = f.lessonCount > 0 && f.completedLessons === f.lessonCount;
  const premiere = f.modules[0]?.lessons[0]?.id ?? null;
  const cible = terminee || !suivi ? premiere : (f.resumeLessonId ?? premiere);
  // Le bouton dit où il mène : la première leçon tant qu'aucune n'est
  // validée, la suivante ensuite, le début une fois tout vu.
  const libelle =
    suivi && terminee
      ? 'Revoir la formation'
      : suivi && f.completedLessons > 0
        ? 'Voir la leçon suivante'
        : 'Voir la première leçon';
  const bouton = cible ? (
    <Link href={`/academy/${f.id}/lecon/${cible}`} className="shrink-0">
      <Button className="w-full sm:w-auto">
        <Icon
          name={suivi && terminee ? 'replay' : 'play_arrow'}
          size={17}
          fill={!(suivi && terminee)}
        />
        {libelle}
      </Button>
    </Link>
  ) : null;

  return (
    <Page>
      <RetourAcademy href="/academy" label="APIX Academy" />

      <Card className="shrink-0 overflow-hidden">
        <div className="grid md:grid-cols-[260px_minmax(0,1fr)]">
          <Couverture category={f.category} className="h-28 md:h-auto md:min-h-[196px]">
            <span className="absolute top-4 left-4 rounded-full bg-white/15 px-2.5 py-[3px] text-[10.5px] font-bold tracking-[0.06em] uppercase ring-1 ring-white/20 backdrop-blur-sm">
              {famille.label}
            </span>
          </Couverture>
          <div className="flex flex-col gap-3 p-5 md:p-6">
            {/* Le brouillon se dit — la RH doit savoir que les agents ne le
                voient pas. Rien d'autre ne s'écrit au-dessus du titre : une
                rangée vide y creusait un blanc de douze pixels. */}
            {!f.published ? (
              <Badge tone="neutral" className="w-fit">
                Brouillon — invisible pour les agents
              </Badge>
            ) : null}
            {/* Le titre et l'unique geste de l'écran, sur la même ligne : on
                lit ce qu'on va suivre, et le bouton est déjà sous le regard. */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
              <h1 className="min-w-0 text-[22px] leading-tight font-bold tracking-[-0.02em] text-ink-strong">
                {f.title}
              </h1>
              {bouton}
            </div>
            {f.summary ? (
              <p className="max-w-[70ch] text-[13px] leading-relaxed whitespace-pre-line text-ink-muted">
                {f.summary}
              </p>
            ) : null}
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] font-semibold text-ink-muted">
              <span className="inline-flex items-center gap-1.5">
                <Icon name="movie" size={15} />
                {compte(f.moduleCount, 'module')} · {compte(f.lessonCount, 'leçon')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Icon name="schedule" size={15} />
                {dureeLisible(f.totalSeconds)} de vidéo
              </span>
            </p>

            {suivi ? (
              <div className="mt-auto flex items-center gap-3 pt-2">
                <BarreProgression
                  part={f.lessonCount ? f.completedLessons / f.lessonCount : 0}
                  className="max-w-72 flex-1"
                />
                <span className="text-[12px] font-semibold whitespace-nowrap text-ink-muted">
                  {terminee ? (
                    <span className="inline-flex items-center gap-1 text-success">
                      <Icon name="check_circle" size={15} fill />
                      Formation terminée
                    </span>
                  ) : (
                    `${compte(f.completedLessons, 'leçon')} ${f.completedLessons > 1 ? 'validées' : 'validée'} sur ${f.lessonCount}`
                  )}
                </span>
              </div>
            ) : null}
          </div>
        </div>
      </Card>

      <Card className="pb-1">
        <CardHeader>
          <CardTitle>Programme</CardTitle>
        </CardHeader>
        <CardContent>
          <Programme formation={f} />
        </CardContent>
      </Card>
    </Page>
  );
}
