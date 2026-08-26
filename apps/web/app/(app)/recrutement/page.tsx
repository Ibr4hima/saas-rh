'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import type { JobPostingView } from '@teranga/contracts';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardInteractive,
  EmptyState,
  Skeleton,
} from '@teranga/ui';
import { api } from '../../../lib/api';
import { formatDate } from '../../../lib/hooks';
import { Icon } from '../../../components/icons';
import {
  CONTRACT_LABELS,
  JOB_STATUS_LABELS,
  JOB_STATUS_TONES,
  STAGE_LABELS,
} from '../../../lib/recruitment';
import { LoadFailure } from '../../../components/load-failure';

function activeCount(j: JobPostingView): number {
  return Object.entries(j.applicationCounts)
    .filter(([stage]) => stage !== 'rejected')
    .reduce((sum, [, n]) => sum + n, 0);
}

export default function RecruitmentPage() {
  const jobs = useQuery({ queryKey: ['jobs'], queryFn: () => api<JobPostingView[]>('/jobs') });

  if (jobs.isError) {
    return <LoadFailure error={jobs.error} onRetry={() => void jobs.refetch()} />;
  }

  return (
    <div className="mx-auto w-full max-w-6xl">
      {jobs.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (jobs.data ?? []).length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={<Icon name="person_add" size={22} />}
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
    <CardInteractive>
      <div className="flex flex-col gap-3 px-[18px] py-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[11px] bg-primary/[0.07] text-primary">
            <Icon name="person_add" size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/recrutement/${job.id}`}
                className="text-[14px] font-bold text-ink-strong hover:underline"
              >
                {job.title}
              </Link>
              <Badge tone={JOB_STATUS_TONES[job.status] ?? 'neutral'}>
                {JOB_STATUS_LABELS[job.status] ?? job.status}
              </Badge>
            </div>
            <p className="mt-0.5 text-[12px] text-ink-muted">
              {CONTRACT_LABELS[job.contractType] ?? job.contractType}
              {job.location ? ` · ${job.location}` : ''}
              {job.orgUnitName ? ` · ${job.orgUnitName}` : ''}
              {job.deadline ? ` · candidatures jusqu'au ${formatDate(job.deadline)}` : ''}
            </p>
          </div>
          {/* Le nombre de candidatures est le chiffre qu'on cherche en
              balayant la page : il se lit comme un compteur, pas comme une
              note de bas de ligne. */}
          <div className="shrink-0 text-right">
            <p
              className="text-[19px] leading-none font-extrabold text-primary"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {candidates}
            </p>
            <p className="mt-1 text-[9.5px] font-extrabold tracking-[0.1em] text-ink-muted uppercase">
              candidature{candidates > 1 ? 's' : ''}
            </p>
          </div>
        </div>

        {candidates > 0 ? (
          <div className="flex flex-wrap gap-1.5 sm:pl-12">
            {Object.entries(job.applicationCounts)
              .filter(([, n]) => n > 0)
              .map(([stage, n]) => (
                <span
                  key={stage}
                  className="rounded-full border border-primary/10 bg-primary/[0.05] px-2.5 py-0.5 text-[11px] font-semibold text-primary"
                >
                  {STAGE_LABELS[stage as keyof typeof STAGE_LABELS] ?? stage}
                  <span className="ml-1 font-extrabold">{n}</span>
                </span>
              ))}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 sm:pl-12">
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
              <Icon name={copied ? 'check' : 'content_copy'} size={15} />
              {copied ? 'Lien copié' : 'Copier le lien public'}
            </Button>
          ) : null}
          <Link href={`/recrutement/${job.id}`} className="ml-auto">
            <Button size="sm" variant="ghost">
              Voir le pipeline
              <Icon name="chevron_right" size={15} />
            </Button>
          </Link>
        </div>
      </div>
    </CardInteractive>
  );
}
