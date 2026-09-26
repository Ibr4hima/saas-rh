'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import type { BeatResult, CourseDetail, LessonPlayback } from '@teranga/contracts';
import { SEUIL_VISIONNAGE } from '@teranga/contracts';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  EmptyState,
  Skeleton,
} from '@teranga/ui';
import { BarreProgression, RetourAcademy } from '../../../../../../components/academy-carte';
import { Programme } from '../../../../../../components/academy-programme';
import { FenetreDocument } from '../../../../../../components/fenetre-document';
import { Page } from '../../../../../../components/gabarit';
import { Icon } from '../../../../../../components/icons';
import { LecteurVideo } from '../../../../../../components/lecteur-video';
import { LoadFailure } from '../../../../../../components/load-failure';
import { pourcent } from '../../../../../../lib/academy';
import { api, ApiError, apiUrl } from '../../../../../../lib/api';
import { compte } from '../../../../../../lib/mots';

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

      {/* Une seule colonne : la vidéo d'abord — c'est elle qu'on regarde —,
          la leçon et le programme dessous. La colonne a la largeur d'une vidéo
          16:9 haute de 62 % de l'écran : la leçon et le programme s'alignent
          sur ses bords, au lieu de déborder de part et d'autre. */}
      <div className="mx-auto flex w-full max-w-[calc(62vh*16/9)] min-w-0 flex-col gap-4">
        <LecteurVideo
          key={l.sessionId ?? `${l.lessonId}-${ouverture}`}
          lecture={l}
          onBattement={surBattement}
          onReprendreIci={() => setOuverture((n) => n + 1)}
          onSuivante={allerSuivante}
        />

        <Card>
          <div className="flex flex-col gap-4 p-5">
            {/* Le titre et, sur sa ligne, tout ce qu'on fait de la leçon : son
                support, puis reculer ou avancer d'une leçon. */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
              <div className="min-w-0">
                {ici ? (
                  <p className="text-[10.5px] font-extrabold tracking-[0.14em] text-primary uppercase">
                    Module {ici.module} · Leçon {rang + 1} sur {toutes.length}
                  </p>
                ) : null}
                <h1 className="mt-1.5 text-[19px] leading-snug font-bold tracking-[-0.015em] text-ink-strong">
                  {l.title}
                </h1>
              </div>

              <div className="flex shrink-0 items-center gap-3">
                {ici?.support ? (
                  // Le support s'ouvre dans l'aperçu du produit, comme toute
                  // pièce : on le lit sans quitter la leçon, et on le
                  // télécharge de là si on veut le garder.
                  <button
                    type="button"
                    onClick={() => setSupportOuvert(true)}
                    title={`${ici.support.filename} — PDF, ${Math.max(1, Math.round(ici.support.size / 1024))} Ko`}
                    className="group inline-flex h-10 items-center gap-2.5 rounded-full border border-line-soft bg-surface pr-4 pl-1.5 text-[12.5px] font-semibold text-ink shadow-xs transition-all duration-150 hover:border-primary/35 hover:bg-primary-soft/40 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
                  >
                    <span className="grid size-7 place-items-center rounded-full bg-primary-soft text-primary transition-colors group-hover:bg-primary group-hover:text-primary-ink">
                      <Icon name="description" size={16} />
                    </span>
                    Support de cours
                  </button>
                ) : null}
                {ici?.support && (l.precedente || l.suivante) ? (
                  <span aria-hidden className="h-6 w-px bg-line" />
                ) : null}
                {l.precedente || l.suivante ? (
                  <div className="flex items-center gap-1.5">
                    <NavLecon
                      sens="precedente"
                      href={l.precedente ? `/academy/${id}/lecon/${l.precedente}` : null}
                    />
                    <NavLecon
                      sens="suivante"
                      href={l.suivante ? `/academy/${id}/lecon/${l.suivante}` : null}
                      verrou={Boolean(l.suivante) && !suivanteOuverte}
                    />
                  </div>
                ) : null}
              </div>
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

            {/* La dernière leçon validée ouvre l'évaluation : c'est le geste
                suivant, et il n'a pas de flèche pour le dire. */}
            {!l.suivante &&
            suivi &&
            (f.evaluation?.etat === 'ouverte' || f.evaluation?.etat === 'en_cours') ? (
              <div className="flex items-center justify-between gap-3 border-t border-line-soft pt-4">
                <p className="text-[12.5px] text-ink-muted">
                  C’était la dernière leçon : l’évaluation finale est ouverte.
                </p>
                <Link href={`/academy/${id}/evaluation`} className="shrink-0">
                  <Button size="sm">
                    <Icon name="quiz" size={16} />
                    Passer l’évaluation
                  </Button>
                </Link>
              </div>
            ) : null}
          </div>
        </Card>

        <Card className="pb-1">
          <CardHeader className="flex items-center justify-between gap-3">
            <CardTitle>Programme</CardTitle>
            {suivi ? (
              <span className="text-[11.5px] font-semibold text-ink-muted">
                {f.completedLessons} / {compte(f.lessonCount, 'leçon')}
              </span>
            ) : null}
          </CardHeader>
          <CardContent>
            <Programme formation={f} courante={lessonId} />
          </CardContent>
        </Card>
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

/**
 * Reculer ou avancer d'une leçon : une flèche ronde, sans libellé — son sens
 * suffit, l'infobulle le dit. Verrouillée tant que la leçon n'est pas validée :
 * elle le montre, et dit pourquoi.
 */
function NavLecon({
  sens,
  href,
  verrou = false,
}: {
  sens: 'precedente' | 'suivante';
  href: string | null;
  verrou?: boolean;
}) {
  const libelle = sens === 'precedente' ? 'Leçon précédente' : 'Leçon suivante';
  const forme =
    'grid size-10 place-items-center rounded-full border transition-all duration-150 focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none';
  const icone = (
    <Icon name={sens === 'precedente' ? 'chevron_backward' : 'chevron_forward'} size={20} />
  );
  if (!href || verrou) {
    return (
      <span
        role="link"
        aria-disabled
        aria-label={verrou ? `${libelle} — validez d’abord celle-ci` : libelle}
        title={verrou ? 'Validez cette leçon pour ouvrir la suivante' : undefined}
        className={cn(forme, 'cursor-not-allowed border-line-soft text-ink-muted/40')}
      >
        {icone}
      </span>
    );
  }
  return (
    <Link
      href={href}
      aria-label={libelle}
      title={libelle}
      className={cn(
        forme,
        sens === 'suivante'
          ? 'border-primary bg-primary text-primary-ink shadow-xs hover:bg-primary/90'
          : 'border-line-soft bg-surface text-ink shadow-xs hover:border-primary/35 hover:text-primary',
      )}
    >
      {icone}
    </Link>
  );
}
