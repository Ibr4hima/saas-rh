'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { peut, type SuiviDesContrats } from '@teranga/contracts';
import {
  Badge,
  CardHeader,
  CardTitle,
  EmptyState,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@teranga/ui';
import { CartePleine, CorpsDefilant, Page } from '../../../components/gabarit';
import { Icon } from '../../../components/icons';
import { LoadFailure } from '../../../components/load-failure';
import { SqueletteTableau } from '../../../components/tableau';
import { api } from '../../../lib/api';
import { deadlineLabel } from '../../../lib/contrats';
import { formatDate, useMe } from '../../../lib/hooks';

/* ————————————————————————————————————————————————————————————————
   Échéances de contrat.

   Tous les CDD et stages en cours, les plus proches de leur terme d'abord —
   les échus en tête. C'est ici que mène l'alerte envoyée trente jours avant
   la fin (dix pour un contrat court) à qui suit les échéances pour la DCH.
   Le tableau de bord n'en montre que les premiers.

   Le nom mène au dossier pour qui peut le consulter ; sinon il se lit, sans
   lien vers une page qui serait refusée.
   ———————————————————————————————————————————————————————————————— */

export default function EcheancesPage() {
  const me = useMe();
  const consulte = peut(me.data, 'personnel.consulter');
  const suivi = useQuery({
    queryKey: ['contrats', 'suivi'],
    queryFn: () => api<SuiviDesContrats>('/contrats/suivi'),
  });
  const contrats = suivi.data?.enCours ?? [];

  return (
    <Page>
      <CartePleine>
        <CardHeader className="shrink-0">
          <CardTitle>CDD et stages en cours</CardTitle>
        </CardHeader>
        {suivi.isError ? (
          <CorpsDefilant className="px-4 pb-4">
            <LoadFailure error={suivi.error} onRetry={() => void suivi.refetch()} />
          </CorpsDefilant>
        ) : suivi.isLoading ? (
          <CorpsDefilant>
            <SqueletteTableau />
          </CorpsDefilant>
        ) : contrats.length === 0 ? (
          <CorpsDefilant className="grid place-items-center">
            <EmptyState
              icon={<Icon name="description" size={22} />}
              title="Aucun contrat à durée limitée"
              description="Les CDD et les stages en cours apparaîtront ici, les plus proches de leur terme d’abord."
            />
          </CorpsDefilant>
        ) : (
          <Table pleine>
            <THead>
              <tr>
                {/* Sur téléphone : le nom, la date, l'échéance — l'essentiel tient sans défiler. */}
                <Th className="hidden sm:table-cell">Matricule</Th>
                <Th>Nom</Th>
                <Th className="hidden md:table-cell">Poste</Th>
                <Th className="hidden sm:table-cell">Contrat</Th>
                <Th>Date de fin</Th>
                <Th className="text-right whitespace-nowrap">Échéance</Th>
              </tr>
            </THead>
            <TBody>
              {contrats.map((c) => {
                const echeance = deadlineLabel(c.daysLeft);
                return (
                  <Tr key={c.employeeId}>
                    <Td className="hidden font-mono text-ink-muted sm:table-cell">
                      {c.employeeNumber}
                    </Td>
                    <Td className="whitespace-nowrap">
                      {consulte ? (
                        <Link
                          href={`/employees/${c.employeeId}`}
                          className="font-medium text-ink-strong hover:underline"
                        >
                          {c.name}
                        </Link>
                      ) : (
                        <span className="font-medium text-ink-strong">{c.name}</span>
                      )}
                    </Td>
                    <Td
                      className="hidden max-w-48 truncate text-ink-muted md:table-cell"
                      title={c.positionTitle ?? undefined}
                    >
                      {c.positionTitle ?? '—'}
                    </Td>
                    <Td className="hidden uppercase sm:table-cell">{c.contractType}</Td>
                    <Td className="whitespace-nowrap">{c.endDate ? formatDate(c.endDate) : '—'}</Td>
                    <Td className="text-right">
                      <Badge tone={echeance.tone} className="whitespace-nowrap">
                        {echeance.text}
                      </Badge>
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        )}
      </CartePleine>
    </Page>
  );
}
