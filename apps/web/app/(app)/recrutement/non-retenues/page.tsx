'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { RejectedApplicationView } from '@teranga/contracts';
import {
  Button,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  TBody,
  Td,
  Th,
  THead,
  Table,
  Tr,
} from '@teranga/ui';
import { api } from '../../../../lib/api';
import { formatDate } from '../../../../lib/hooks';
import { correspond } from '../../../../lib/recherche';
import { FenetreCandidat } from '../../../../components/fenetre-candidat';
import { Icon } from '../../../../components/icons';
import { LoadFailure } from '../../../../components/load-failure';
import { CartePleine, CorpsDefilant, Page } from '../../../../components/gabarit';
import { Pagination, usePagination } from '../../../../components/pagination';
import { SqueletteTableau } from '../../../../components/tableau';

/**
 * Les candidatures non retenues, toutes offres confondues, la plus récente
 * d'abord. Elles ont quitté leur offre : le candidat a reçu la réponse. Le
 * dossier reste consultable, CV et lettre compris.
 */
export default function CandidaturesNonRetenuesPage() {
  const [q, setQ] = useState('');
  const [ouvert, setOuvert] = useState<string | null>(null);

  const nonRetenues = useQuery({
    queryKey: ['candidatures-non-retenues'],
    queryFn: () => api<RejectedApplicationView[]>('/applications/rejected'),
  });

  const lignes = useMemo(
    () =>
      (nonRetenues.data ?? []).filter((a) =>
        correspond(q, `${a.givenName} ${a.familyName}`, a.jobTitle, a.jobReference),
      ),
    [nonRetenues.data, q],
  );
  const { tranche, barre } = usePagination(lignes, q);
  const dossier = (nonRetenues.data ?? []).find((a) => a.id === ouvert) ?? null;

  if (nonRetenues.isError) {
    return <LoadFailure error={nonRetenues.error} onRetry={() => void nonRetenues.refetch()} />;
  }

  return (
    <Page>
      <CartePleine>
        <CardHeader className="flex shrink-0 flex-wrap items-center justify-between gap-3">
          <CardTitle>Candidatures non retenues</CardTitle>
          <Input
            placeholder="Rechercher un candidat…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-8 w-56"
            aria-label="Rechercher une candidature"
          />
        </CardHeader>
        {nonRetenues.isLoading ? (
          <CorpsDefilant>
            <SqueletteTableau />
          </CorpsDefilant>
        ) : lignes.length === 0 ? (
          <CorpsDefilant className="grid place-items-center">
            <EmptyState
              icon={<Icon name="inbox" size={22} />}
              title={
                (nonRetenues.data ?? []).length === 0
                  ? 'Aucune candidature non retenue'
                  : 'Aucune candidature ne correspond'
              }
              description={
                (nonRetenues.data ?? []).length === 0
                  ? undefined
                  : 'Changez de recherche pour voir les autres candidatures.'
              }
            />
          </CorpsDefilant>
        ) : (
          <Table pleine>
            <THead>
              <tr>
                <Th>Nom</Th>
                <Th>Offre postulée</Th>
                <Th>Référence</Th>
                <Th>Publiée le</Th>
                <Th className="text-right">Dossier</Th>
              </tr>
            </THead>
            <TBody>
              {tranche.map((a) => (
                <Tr key={a.id}>
                  <Td className="font-semibold whitespace-nowrap text-ink-strong">
                    {a.givenName} {a.familyName}
                  </Td>
                  <Td>{a.jobTitle}</Td>
                  <Td className="font-mono text-[11.5px] whitespace-nowrap text-ink-muted">
                    {a.jobReference}
                  </Td>
                  <Td className="whitespace-nowrap text-ink-muted">
                    {formatDate(a.jobCreatedAt.slice(0, 10))}
                  </Td>
                  <Td className="text-right">
                    <Button variant="secondary" size="sm" onClick={() => setOuvert(a.id)}>
                      Consulter
                    </Button>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </CartePleine>
      <Pagination {...barre} />
      <FenetreCandidat dossier={dossier} onClose={() => setOuvert(null)} />
    </Page>
  );
}
