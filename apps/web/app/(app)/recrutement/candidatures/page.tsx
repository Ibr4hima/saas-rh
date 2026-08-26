'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { JobPostingView } from '@teranga/contracts';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  EmptyState,
  Input,
  Skeleton,
  TBody,
  Td,
  Th,
  THead,
  Table,
  Tr,
} from '@teranga/ui';
import { api } from '../../../../lib/api';
import { Icon } from '../../../../components/icons';
import { LoadFailure } from '../../../../components/load-failure';
import { CONTRACT_LABELS } from '../../../../lib/recruitment';

/** Le nombre de dossiers reçus, toutes étapes confondues — refus compris. */
function postulants(offre: JobPostingView): number {
  return Object.values(offre.applicationCounts).reduce((n, v) => n + v, 0);
}

/**
 * Les dossiers de candidature, rangés par offre.
 *
 * Une candidature ne se lit pas seule : « Mariama Ba » ne dit rien tant qu'on
 * ignore à quoi elle postule. L'entrée se fait donc par la campagne, et la
 * ligne mène au pipeline où les dossiers vivent.
 */
export default function CandidaturesPage() {
  const router = useRouter();
  const [q, setQ] = useState('');

  const jobs = useQuery({ queryKey: ['jobs'], queryFn: () => api<JobPostingView[]>('/jobs') });

  const lignes = useMemo(() => {
    const terme = q.trim().toLowerCase();
    const tout = jobs.data ?? [];
    if (!terme) return tout;
    return tout.filter((o) => `${o.reference} ${o.title}`.toLowerCase().includes(terme));
  }, [jobs.data, q]);

  if (jobs.isError) {
    return <LoadFailure error={jobs.error} onRetry={() => void jobs.refetch()} />;
  }

  const total = lignes.reduce((n, o) => n + postulants(o), 0);

  return (
    <div className="mx-auto w-full max-w-6xl">
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <CardTitle>Dossiers de candidature</CardTitle>
            {total > 0 ? (
              <span
                className="rounded-full bg-primary/[0.09] px-2 py-px text-[10.5px] font-extrabold text-primary"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {total}
              </span>
            ) : null}
          </div>
          <Input
            placeholder="Rechercher une offre…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-8 w-52"
            aria-label="Rechercher une offre"
          />
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {jobs.isLoading ? (
            <Skeleton className="mx-[18px] mb-[18px] h-24" />
          ) : lignes.length === 0 ? (
            <EmptyState
              icon={<Icon name="person_add" size={22} />}
              title={(jobs.data ?? []).length === 0 ? 'Aucune offre' : 'Aucune offre ne correspond'}
              description={
                (jobs.data ?? []).length === 0
                  ? 'Publiez une offre et partagez son lien : les dossiers déposés se rangeront ici, campagne par campagne.'
                  : 'Changez de recherche pour voir les autres offres.'
              }
            />
          ) : (
            <Table>
              <THead>
                <tr>
                  <Th>Référence</Th>
                  <Th>Poste</Th>
                  <Th>Type contrat</Th>
                  <Th className="text-right">Postulants</Th>
                  <Th className="w-8" />
                </tr>
              </THead>
              <TBody>
                {lignes.map((o) => {
                  const n = postulants(o);
                  return (
                    // La ligne entière ouvre le pipeline : c'est le seul geste
                    // de cet écran, il n'a pas à se chercher dans une cellule.
                    <Tr
                      key={o.id}
                      onClick={() => router.push(`/recrutement/${o.id}`)}
                      tabIndex={0}
                      role="link"
                      aria-label={`Voir les dossiers de ${o.title}`}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          router.push(`/recrutement/${o.id}`);
                        }
                      }}
                      className="cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
                    >
                      <Td className="font-mono text-[11.5px] whitespace-nowrap text-ink-muted">
                        {o.reference}
                      </Td>
                      <Td className="font-bold text-ink-strong">{o.title}</Td>
                      <Td className="whitespace-nowrap">
                        {CONTRACT_LABELS[o.contractType] ?? o.contractType}
                      </Td>
                      <Td
                        className={cn(
                          'text-right font-bold',
                          n === 0 ? 'text-ink-muted' : 'text-primary',
                        )}
                        style={{ fontVariantNumeric: 'tabular-nums' }}
                      >
                        {n}
                      </Td>
                      <Td className="pl-0 text-right">
                        <Icon name="chevron_right" size={15} className="text-ink-muted/60" />
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
