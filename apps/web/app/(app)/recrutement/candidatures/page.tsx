'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { ApplicationListItem } from '@teranga/contracts';
import { APPLICATION_STAGES } from '@teranga/contracts';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  EmptyState,
  Input,
  Select,
  Skeleton,
  TBody,
  Td,
  Th,
  THead,
  Table,
  Tr,
} from '@teranga/ui';
import { api } from '../../../../lib/api';
import { formatDate } from '../../../../lib/hooks';
import { Icon } from '../../../../components/icons';
import { LoadFailure } from '../../../../components/load-failure';
import { STAGE_LABELS, STAGE_TONES } from '../../../../lib/recruitment';

/**
 * Toutes les candidatures, offres confondues.
 *
 * Le pipeline d'une offre répond à « où en est ce recrutement ». Cet écran-ci
 * répond à l'autre question, celle du lundi matin : qui a postulé, à quoi, et
 * depuis combien de temps personne ne l'a regardé.
 */
export default function CandidaturesPage() {
  const [stage, setStage] = useState('');
  const [q, setQ] = useState('');

  const apps = useQuery({
    queryKey: ['applications', stage],
    queryFn: () => api<ApplicationListItem[]>(`/applications${stage ? `?stage=${stage}` : ''}`),
  });

  const lignes = useMemo(() => {
    const terme = q.trim().toLowerCase();
    const tout = apps.data ?? [];
    if (!terme) return tout;
    return tout.filter((a) =>
      `${a.givenName} ${a.familyName} ${a.email} ${a.jobTitle}`.toLowerCase().includes(terme),
    );
  }, [apps.data, q]);

  if (apps.isError) {
    return <LoadFailure error={apps.error} onRetry={() => void apps.refetch()} />;
  }

  return (
    <div className="mx-auto w-full max-w-6xl">
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <CardTitle>Dossiers de candidature</CardTitle>
            {lignes.length > 0 ? (
              <span
                className="rounded-full bg-primary/[0.09] px-2 py-px text-[10.5px] font-extrabold text-primary"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {lignes.length}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Rechercher…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-8 w-44"
              aria-label="Rechercher"
            />
            <Select
              value={stage}
              onChange={(e) => setStage(e.target.value)}
              className="h-8 w-44"
              aria-label="Filtrer par étape"
            >
              <option value="">Toutes les étapes</option>
              {APPLICATION_STAGES.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABELS[s]}
                </option>
              ))}
            </Select>
          </div>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {apps.isLoading ? (
            <Skeleton className="mx-[18px] mb-[18px] h-24" />
          ) : lignes.length === 0 ? (
            <EmptyState
              icon={<Icon name="person_add" size={22} />}
              title={
                (apps.data ?? []).length === 0
                  ? 'Aucune candidature'
                  : 'Aucun dossier ne correspond'
              }
              description={
                (apps.data ?? []).length === 0
                  ? 'Publiez une offre et partagez son lien : les dossiers déposés arriveront ici.'
                  : 'Changez de recherche ou d’étape pour voir les autres dossiers.'
              }
            />
          ) : (
            <Table>
              <THead>
                <tr>
                  <Th>Candidat</Th>
                  <Th>Offre</Th>
                  <Th>Étape</Th>
                  <Th>Pièces</Th>
                  <Th>Déposé le</Th>
                  <Th className="w-8" />
                </tr>
              </THead>
              <TBody>
                {lignes.map((a) => (
                  <Tr key={a.id}>
                    <Td>
                      <span className="block font-bold text-ink-strong">
                        {a.givenName} {a.familyName}
                      </span>
                      <span className="block text-[11px] text-ink-muted">{a.email}</span>
                    </Td>
                    <Td>
                      <Link
                        href={`/recrutement/${a.jobPostingId}`}
                        className="font-semibold text-primary hover:underline"
                      >
                        {a.jobTitle}
                      </Link>
                    </Td>
                    <Td>
                      <Badge tone={STAGE_TONES[a.stage] ?? 'neutral'}>
                        {STAGE_LABELS[a.stage] ?? a.stage}
                      </Badge>
                    </Td>
                    <Td
                      className={cn(
                        'font-semibold',
                        a.documents.length === 0 ? 'text-ink-muted' : 'text-ink',
                      )}
                      style={{ fontVariantNumeric: 'tabular-nums' }}
                    >
                      {a.documents.length}
                    </Td>
                    <Td className="whitespace-nowrap text-ink-muted">
                      {formatDate(a.createdAt.slice(0, 10))}
                    </Td>
                    <Td className="pl-0 text-right">
                      {/* Le dossier se traite dans le pipeline de son offre :
                          c'est là que vivent les étapes et les pièces. */}
                      <Link
                        href={`/recrutement/${a.jobPostingId}`}
                        title="Ouvrir le pipeline de l’offre"
                        aria-label={`Ouvrir le pipeline — ${a.jobTitle}`}
                        className="inline-flex rounded-[7px] p-1.5 text-ink-muted transition-colors hover:bg-primary/[0.07] hover:text-primary"
                      >
                        <Icon name="chevron_right" size={15} />
                      </Link>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
