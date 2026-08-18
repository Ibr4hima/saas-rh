'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import type { JobPostingView } from '@teranga/contracts';
import { Badge, Button, Card, CardContent, EmptyState, Skeleton } from '@teranga/ui';
import { api, ApiError } from '../../../lib/api';
import { formatDate } from '../../../lib/hooks';
import {
  CONTRACT_LABELS,
  JOB_STATUS_LABELS,
  JOB_STATUS_TONES,
  STAGE_LABELS,
} from '../../../lib/recruitment';

function activeCount(j: JobPostingView): number {
  return Object.entries(j.applicationCounts)
    .filter(([stage]) => stage !== 'rejected')
    .reduce((sum, [, n]) => sum + n, 0);
}

export default function RecruitmentPage() {
  const jobs = useQuery({ queryKey: ['jobs'], queryFn: () => api<JobPostingView[]>('/jobs') });

  if (jobs.isError) {
    const message = jobs.error instanceof ApiError ? jobs.error.message : 'Chargement impossible.';
    return <p className="text-sm text-danger">{message}</p>;
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink-strong">Recrutement</h1>
          <p className="text-sm text-ink-muted">
            Publiez une offre, partagez son lien (LinkedIn, WhatsApp…) : les candidatures arrivent
            directement dans votre pipeline.
          </p>
        </div>
        <Link href="/recrutement/nouvelle" className="shrink-0">
          <Button>Nouvelle offre</Button>
        </Link>
      </div>

      {jobs.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (jobs.data ?? []).length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              title="Aucune offre pour le moment"
              description="Créez votre première offre : vous obtiendrez un lien public de candidature à partager."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {jobs.data!.map((j) => (
            <JobCard key={j.id} job={j} />
          ))}
        </div>
      )}
    </div>
  );
}

function JobCard({ job }: { job: JobPostingView }) {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const publish = useMutation({
    mutationFn: () => api(`/jobs/${job.id}`, { method: 'PATCH', body: { status: 'published' } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['jobs'] }),
  });

  const publicUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/postuler/${job.publicSlug}` : '';
  const candidates = activeCount(job);

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/recrutement/${job.id}`}
            className="text-base font-semibold text-ink-strong hover:underline"
          >
            {job.title}
          </Link>
          <Badge tone={JOB_STATUS_TONES[job.status] ?? 'neutral'}>
            {JOB_STATUS_LABELS[job.status] ?? job.status}
          </Badge>
          <span className="ml-auto text-sm text-ink-muted">
            {candidates} candidature{candidates > 1 ? 's' : ''}
          </span>
        </div>
        <p className="text-sm text-ink-muted">
          {CONTRACT_LABELS[job.contractType] ?? job.contractType}
          {job.location ? ` · ${job.location}` : ''}
          {job.orgUnitName ? ` · ${job.orgUnitName}` : ''}
          {job.deadline ? ` · candidatures jusqu'au ${formatDate(job.deadline)}` : ''}
        </p>
        {candidates > 0 ? (
          <div className="flex flex-wrap gap-2">
            {Object.entries(job.applicationCounts)
              .filter(([, n]) => n > 0)
              .map(([stage, n]) => (
                <span
                  key={stage}
                  className="rounded-full bg-bg px-2.5 py-0.5 text-xs font-medium text-ink-muted"
                >
                  {STAGE_LABELS[stage as keyof typeof STAGE_LABELS] ?? stage} : {n}
                </span>
              ))}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {job.status === 'draft' ? (
            <Button size="sm" onClick={() => publish.mutate()} loading={publish.isPending}>
              Publier
            </Button>
          ) : null}
          {job.status === 'published' ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                await navigator.clipboard.writeText(publicUrl);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? 'Lien copié ✓' : 'Copier le lien public'}
            </Button>
          ) : null}
          <Link href={`/recrutement/${job.id}`}>
            <Button size="sm" variant="secondary">
              Voir le pipeline →
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
