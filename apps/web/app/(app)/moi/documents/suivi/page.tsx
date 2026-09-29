'use client';

import { useQuery } from '@tanstack/react-query';
import type { DocumentRequestView } from '@teranga/contracts';
import { Card, CardContent, CardHeader, CardTitle, EmptyState, Skeleton } from '@teranga/ui';
import { api } from '../../../../../lib/api';
import { DocumentRequestRow } from '../../../../../components/document-request-list';
import { Icon } from '../../../../../components/icons';
import { Page } from '../../../../../components/gabarit';

/**
 * Suivi de mes demandes de documents : où en est chacune, jusqu'au lieu de
 * retrait.
 */
export default function SuiviDemandesDocumentsPage() {
  const docRequests = useQuery({
    // scope=mine : l'espace personnel reste personnel même pour un membre RH.
    queryKey: ['document-requests', 'me'],
    queryFn: () => api<DocumentRequestView[]>('/document-requests?scope=mine'),
  });
  const demandes = docRequests.data ?? [];
  const aRetirer = demandes.filter((r) => r.status === 'ready').length;

  return (
    <Page>
      {docRequests.isLoading ? (
        <Skeleton className="h-40 w-full rounded-[16px]" />
      ) : demandes.length === 0 ? (
        <Card>
          <EmptyState
            className="py-12"
            icon={<Icon name="folder_managed" size={22} />}
            title="Aucune demande pour le moment"
          />
        </Card>
      ) : (
        <Card>
          <CardHeader className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
            <CardTitle>Suivi de mes demandes</CardTitle>
            {/* La seule ligne de cette carte qui appelle un geste : aller
                chercher le document. Elle se dit dans le titre. */}
            {aRetirer > 0 ? (
              <span className="rounded-full bg-primary/[0.09] px-2 py-px text-[10.5px] font-bold text-primary">
                {aRetirer} à retirer
              </span>
            ) : null}
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col">
              {demandes.map((r) => (
                <DocumentRequestRow key={r.id} request={r} showEmployee={false} />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </Page>
  );
}
