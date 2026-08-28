'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import type { ApplicationStage, ApplicationView, JobPostingView } from '@teranga/contracts';
import { APPLICATION_STAGES } from '@teranga/contracts';
import { Badge, Button, Card, CardContent, cn, Select, Skeleton } from '@teranga/ui';
import { api, ApiError, apiUrl } from '../../../../lib/api';
import { DocViewer, type ViewableDoc } from '../../../../components/doc-viewer';
import { formatDate } from '../../../../lib/hooks';
import {
  CONTRACT_LABELS,
  JOB_STATUS_LABELS,
  JOB_STATUS_TONES,
  STAGE_LABELS,
  STAGE_TONES,
} from '../../../../lib/recruitment';
import { LoadFailure } from '../../../../components/load-failure';
import { Icon } from '../../../../components/icons';
import { usePageTitle } from '../../../../components/page-title';

export default function JobPipelinePage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const job = useQuery({
    queryKey: ['job', id],
    queryFn: () => api<JobPostingView>(`/jobs/${id}`),
  });
  const applications = useQuery({
    queryKey: ['job-applications', id],
    queryFn: () => api<ApplicationView[]>(`/jobs/${id}/applications`),
  });

  // Le bandeau dit l'offre, comme il dit le nom sur une fiche employé : ici
  // « Dossiers de candidature » ne dirait pas DE QUELLE offre il s'agit.
  usePageTitle(job.data?.title ?? null);

  if (job.isLoading) {
    return (
      <div>
        <Skeleton className="mb-4 h-8 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (job.isError || !job.data) {
    return <LoadFailure error={job.error} onRetry={() => void job.refetch()} />;
  }
  const j = job.data;
  const apps = applications.data ?? [];
  const selected = apps.find((a) => a.id === selectedId) ?? null;
  const publicUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/postuler/${j.publicSlug}` : '';

  return (
    <div>
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <Link
            href="/recrutement"
            className="text-[12.5px] font-semibold text-ink-muted transition-colors hover:text-primary"
          >
            ← Dossiers de candidature
          </Link>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Badge tone={JOB_STATUS_TONES[j.status] ?? 'neutral'}>
              {JOB_STATUS_LABELS[j.status] ?? j.status}
            </Badge>
            <p className="text-[12.5px] text-ink-muted">
              {CONTRACT_LABELS[j.contractType] ?? j.contractType}
              {j.location ? ` · ${j.location}` : ''}
              {j.deadline ? ` · jusqu'au ${formatDate(j.deadline)}` : ''}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {j.status === 'draft' ? (
            <PublishButton jobId={j.id} />
          ) : j.status === 'published' ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                await navigator.clipboard.writeText(publicUrl);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              <Icon name={copied ? 'check' : 'content_copy'} size={15} />
              {copied ? 'Lien copié' : 'Copier le lien public'}
            </Button>
          ) : null}
        </div>
      </div>

      {selected ? (
        <CandidatePanel application={selected} onClose={() => setSelectedId(null)} jobId={j.id} />
      ) : null}

      {applications.isError ? (
        <Card className="mb-6">
          <CardContent className="flex items-center justify-between gap-3 py-4">
            <p className="flex items-center gap-2 text-[12.5px] font-semibold text-danger">
              <Icon name="error" size={17} className="shrink-0" />
              Impossible de charger les candidatures — le pipeline ci-dessous est incomplet.
            </p>
            <Button variant="secondary" size="sm" onClick={() => void applications.refetch()}>
              Réessayer
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {/* Pipeline. Six étapes ne tiennent pas côte à côte sous 1500 px : en
          défilement horizontal, la dernière — « Refusée » — était coupée par
          le bord sans que rien ne le signale. La grille se replie plutôt en
          deux rangées de trois, puis en deux colonnes sur mobile : tout le
          circuit reste visible d'un coup d'œil, sans jamais faire défiler. */}
      <div className="pb-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
          {APPLICATION_STAGES.map((stage) => {
            const column = apps.filter((a) => a.stage === stage);
            return (
              <div key={stage} className="min-w-0">
                <div className="mb-2 flex items-center gap-2 px-1">
                  <span className="text-[9.5px] font-extrabold tracking-[0.12em] text-ink-muted uppercase">
                    {STAGE_LABELS[stage]}
                  </span>
                  <span
                    className="rounded-full bg-primary/[0.09] px-1.5 py-px text-[10.5px] font-extrabold text-primary"
                    style={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {column.length}
                  </span>
                </div>
                <div className="flex min-h-28 flex-col gap-2 rounded-xl border border-line-soft bg-bg p-2">
                  {applications.isLoading ? (
                    <Skeleton className="h-16 w-full" />
                  ) : column.length === 0 ? (
                    // Une colonne vide dit ce qu'elle attend : « — » ne disait
                    // pas si c'était normal ou si le chargement avait échoué.
                    <p className="px-2 py-6 text-center text-[11px] font-semibold text-ink-muted/70">
                      Aucun dossier
                    </p>
                  ) : (
                    column.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => setSelectedId(a.id === selectedId ? null : a.id)}
                        className={cn(
                          'rounded-[10px] border bg-surface px-3 py-2.5 text-left transition-all duration-200',
                          selectedId === a.id
                            ? 'border-primary ring-1 ring-primary/25'
                            : 'border-card-line hover:-translate-y-0.5 hover:border-card-line-hover hover:shadow-sm',
                        )}
                      >
                        <p className="truncate text-[12.5px] font-bold text-ink-strong">
                          {a.givenName} {a.familyName}
                        </p>
                        <p className="truncate text-[11px] text-ink-muted">{a.email}</p>
                        <p className="mt-1 text-[11px] font-semibold text-ink-muted">
                          {formatDate(a.createdAt.slice(0, 10))} · {a.documents.length} doc
                          {a.documents.length > 1 ? 's' : ''}
                        </p>
                      </button>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PublishButton({ jobId }: { jobId: string }) {
  const queryClient = useQueryClient();
  const publish = useMutation({
    mutationFn: () => api(`/jobs/${jobId}`, { method: 'PATCH', body: { status: 'published' } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['job', jobId] }),
  });
  return (
    <Button onClick={() => publish.mutate()} loading={publish.isPending}>
      Publier l&apos;offre
    </Button>
  );
}

function CandidatePanel({
  application: a,
  jobId,
  onClose,
}: {
  application: ApplicationView;
  jobId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [viewedDoc, setViewedDoc] = useState<ViewableDoc | null>(null);

  const move = useMutation({
    mutationFn: (stage: ApplicationStage) =>
      api(`/applications/${a.id}`, { method: 'PATCH', body: { stage } }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['job-applications', jobId] });
      void queryClient.invalidateQueries({ queryKey: ['job', jobId] });
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Changement impossible.'),
  });

  const remove = useMutation({
    mutationFn: () => api(`/applications/${a.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      onClose();
      void queryClient.invalidateQueries({ queryKey: ['job-applications', jobId] });
      void queryClient.invalidateQueries({ queryKey: ['job', jobId] });
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Suppression impossible.'),
  });

  return (
    <Card className="mb-6">
      <CardContent className="flex flex-col gap-3 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-primary-soft text-sm font-bold text-primary">
            {a.givenName[0]}
            {a.familyName[0]}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-ink-strong">
              {a.givenName} {a.familyName}
            </p>
            <p className="text-sm text-ink-muted">
              {a.email}
              {a.phone ? ` · ${a.phone}` : ''} · candidature du{' '}
              {formatDate(a.createdAt.slice(0, 10))}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={STAGE_TONES[a.stage]}>{STAGE_LABELS[a.stage]}</Badge>
            <Select
              value={a.stage}
              onChange={(e) => move.mutate(e.target.value as ApplicationStage)}
              className="h-9 w-44"
              disabled={move.isPending}
            >
              {APPLICATION_STAGES.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABELS[s]}
                </option>
              ))}
            </Select>
            <button
              type="button"
              onClick={onClose}
              className="text-sm text-ink-muted hover:text-ink"
              aria-label="Fermer"
            >
              ✕
            </button>
          </div>
        </div>
        {a.message ? (
          <p className="rounded-md bg-bg px-3 py-2 text-sm whitespace-pre-wrap text-ink">
            {a.message}
          </p>
        ) : null}
        {a.documents.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {a.documents.map((d) => (
              <Button
                key={d.id}
                size="sm"
                variant="secondary"
                onClick={() =>
                  setViewedDoc({
                    url: apiUrl(`/application-documents/${d.id}`),
                    filename: d.filename,
                    contentType: d.contentType,
                  })
                }
              >
                👁 {d.label} — {d.filename} ({Math.round(d.sizeBytes / 1024)} Ko)
              </Button>
            ))}
          </div>
        ) : null}
        {error ? (
          <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
        ) : null}
        <div className="flex justify-end">
          <button
            type="button"
            className="text-xs text-ink-muted hover:text-danger hover:underline"
            onClick={() => {
              if (
                window.confirm(
                  `Supprimer définitivement la candidature de ${a.givenName} ${a.familyName} ? ` +
                    'Son email pourra de nouveau postuler à cette offre.',
                )
              ) {
                remove.mutate();
              }
            }}
          >
            Supprimer la candidature
          </button>
        </div>
      </CardContent>

      <DocViewer doc={viewedDoc} onClose={() => setViewedDoc(null)} />
    </Card>
  );
}
