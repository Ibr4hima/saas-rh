'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { CourseAdminSummary } from '@teranga/contracts';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  EmptyState,
  Skeleton,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@teranga/ui';
import { FormationModal } from '../../../../components/academy-formation-modal';
import { RetourAcademy } from '../../../../components/academy-carte';
import { Page } from '../../../../components/gabarit';
import { Icon } from '../../../../components/icons';
import { LoadFailure } from '../../../../components/load-failure';
import { dureeLisible, FAMILLES, FOND_COUVERTURE } from '../../../../lib/academy';
import { api } from '../../../../lib/api';
import { formatDate } from '../../../../lib/hooks';
import { compte } from '../../../../lib/mots';

/* ————————————————————————————————————————————————————————————————
   Gérer le catalogue — l'atelier de la RH.

   Toutes les formations, brouillons compris, les plus récemment touchées en
   tête : c'est sur elles qu'on revient. L'état dit ce qu'il reste à faire.
   « À compléter » est en ORANGE — la formation attend quelque chose de la
   RH ; « Brouillon » prêt à publier reste neutre, « Publiée » est verte.
   ———————————————————————————————————————————————————————————————— */

function Etat({ f }: { f: CourseAdminSummary }) {
  if (f.published) return <Badge tone="success">Publiée</Badge>;
  if (f.obstacleCount > 0) {
    return (
      <Badge
        tone="warning"
        title={`${compte(f.obstacleCount, 'point')} à régler avant publication`}
      >
        À compléter
      </Badge>
    );
  }
  return <Badge tone="neutral">Prête à publier</Badge>;
}

export default function GererCataloguePage() {
  const router = useRouter();
  const params = useSearchParams();
  const creation = params.get('nouvelle') === '1';
  const liste = useQuery({
    queryKey: ['academy', 'gestion'],
    queryFn: () => api<CourseAdminSummary[]>('/academy/gestion/courses'),
  });

  const modale = (
    <FormationModal
      open={creation}
      onClose={() => router.replace('/academy/gerer')}
      onCree={(id) => router.push(`/academy/gerer/${id}`)}
    />
  );

  if (liste.isPending) {
    return (
      <Page>
        <Skeleton className="h-5 w-40 rounded-full" />
        <Skeleton className="h-[320px] w-full rounded-[16px]" />
      </Page>
    );
  }
  if (liste.isError) {
    return (
      <Page>
        <LoadFailure error={liste.error} onRetry={() => void liste.refetch()} />
      </Page>
    );
  }

  const formations = liste.data;
  return (
    <Page>
      <RetourAcademy href="/academy" label="APIX Academy" />
      <Card className="pb-1">
        {/* L'action « Nouvelle formation » vit dans le bandeau, comme l'action
            unique de chaque écran — la répéter ici en ferait deux. */}
        <CardHeader>
          <CardTitle>Formations</CardTitle>
        </CardHeader>
        {formations.length === 0 ? (
          <EmptyState
            icon={<Icon name="school" size={22} />}
            title="Aucune formation pour l’instant"
            description="Une formation se range en modules, un module en leçons de 12 minutes au plus. Commencez par lui donner un titre."
            action={
              <Link href="/academy/gerer?nouvelle=1">
                <Button>
                  <Icon name="add" size={16} />
                  Nouvelle formation
                </Button>
              </Link>
            }
          />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Formation</Th>
                <Th className="hidden md:table-cell">Contenu</Th>
                <Th className="hidden sm:table-cell">Durée</Th>
                <Th>État</Th>
                <Th className="hidden lg:table-cell">Modifiée le</Th>
              </Tr>
            </THead>
            <TBody>
              {formations.map((f) => (
                <Tr
                  key={f.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/academy/gerer/${f.id}`)}
                >
                  <Td>
                    <Link
                      href={`/academy/gerer/${f.id}`}
                      className="flex items-center gap-3 focus-visible:outline-none"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span
                        className="grid size-9 shrink-0 place-items-center rounded-[10px] text-white"
                        style={{ background: FOND_COUVERTURE }}
                      >
                        <Icon name={FAMILLES[f.category].icone} size={18} />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-bold text-ink-strong">{f.title}</span>
                        <span className="block text-[11.5px] text-ink-muted">
                          {FAMILLES[f.category].label}
                        </span>
                      </span>
                    </Link>
                  </Td>
                  <Td className="hidden text-ink-muted md:table-cell">
                    {compte(f.moduleCount, 'module')} · {compte(f.lessonCount, 'leçon')}
                  </Td>
                  <Td className="hidden text-ink-muted sm:table-cell">
                    {f.totalSeconds > 0 ? dureeLisible(f.totalSeconds) : '—'}
                  </Td>
                  <Td>
                    <Etat f={f} />
                  </Td>
                  <Td className="hidden text-ink-muted lg:table-cell">{formatDate(f.updatedAt)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      {modale}
    </Page>
  );
}
