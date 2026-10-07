'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { DocumentRequestView } from '@teranga/contracts';
import {
  DOC_REQUEST_STATUS_LABELS,
  DOC_REQUEST_STATUS_TONES,
  REQUESTABLE_DOC_LABELS,
} from '@teranga/contracts';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Skeleton,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@teranga/ui';
import { api, ApiError } from '../../../../../lib/api';
import { formatDate } from '../../../../../lib/hooks';
import { timeAgo } from '../../../../../components/document-request-list';
import { Icon } from '../../../../../components/icons';
import { Page } from '../../../../../components/gabarit';
import { Pagination, usePagination } from '../../../../../components/pagination';

/**
 * Suivi de mes demandes de documents : où en est chacune, jusqu'au lieu de
 * retrait.
 *
 * Même facture que l'historique des congés, sa voisine dans l'espace
 * personnel : un tableau aux colonnes fixes, quinze lignes par page, le
 * statut en badge. Ce qui appelle un geste (aller chercher un document prêt)
 * se lit dans la colonne « Retrait ».
 */
export default function SuiviDemandesDocumentsPage() {
  const queryClient = useQueryClient();
  const [erreur, setErreur] = useState<string | null>(null);
  const docRequests = useQuery({
    // scope=mine : l'espace personnel reste personnel même pour un membre RH.
    queryKey: ['document-requests', 'me'],
    queryFn: () => api<DocumentRequestView[]>('/document-requests?scope=mine'),
  });
  // Tant que le document n'est pas prêt, la demande s'annule d'un clic.
  const annuler = useMutation({
    mutationFn: (id: string) => api(`/document-requests/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => {
      setErreur(null);
      void queryClient.invalidateQueries({ queryKey: ['document-requests'] });
    },
    onError: (err) => setErreur(err instanceof ApiError ? err.message : 'Annulation impossible.'),
  });
  // La plus récente en tête : on revient ici pour ce qui vient d'arriver.
  const demandes = [...(docRequests.data ?? [])].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  const { tranche, barre } = usePagination(demandes);

  return (
    <Page>
      {erreur ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-[12px] bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger ring-1 ring-current/15 ring-inset"
        >
          <Icon name="error" size={15} className="mt-px shrink-0" />
          {erreur}
        </p>
      ) : null}

      {docRequests.isLoading ? (
        <Skeleton className="h-48 w-full rounded-[16px]" />
      ) : demandes.length === 0 ? (
        <Card>
          <EmptyState
            className="py-12"
            icon={<Icon name="folder_managed" size={22} />}
            title="Aucune demande pour le moment"
          />
        </Card>
      ) : (
        <>
          {/* Sans titre au-dessus, l'en-tête du tableau touche les coins
              arrondis de la carte : elle le rogne. */}
          <Card className="overflow-hidden">
            {/* Des colonnes de largeur fixe : d'une page à l'autre, les dates
                et les statuts tombent au même endroit. */}
            <Table className="sm:table-fixed">
              {/* Sur téléphone, une seule colonne : l'en-tête n'y apprend rien. */}
              <THead className="hidden sm:table-header-group">
                <tr>
                  <Th className="sm:w-[32%]">Document</Th>
                  <Th className="sm:w-[15%]">Demandée le</Th>
                  <Th className="sm:w-[29%]">Retrait</Th>
                  <Th className="sm:w-[14%]">Statut</Th>
                  <Th className="sm:w-[10%]">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </THead>
              <TBody>
                {tranche.map((r) => (
                  <Ligne
                    key={r.id}
                    demande={r}
                    onAnnuler={() => annuler.mutate(r.id)}
                    enCours={annuler.isPending && annuler.variables === r.id}
                  />
                ))}
              </TBody>
            </Table>
          </Card>
          <Pagination {...barre} />
        </>
      )}
    </Page>
  );
}

/**
 * Une demande, sur une ligne. Sur téléphone, la date, le retrait, le statut
 * et le geste se rangent sous le document : cinq colonnes n'y tiennent pas.
 */
function Ligne({
  demande: r,
  onAnnuler,
  enCours,
}: {
  demande: DocumentRequestView;
  onAnnuler: () => void;
  enCours: boolean;
}) {
  const documents = r.docTypes.map((d) => REQUESTABLE_DOC_LABELS[d] ?? d).join(' · ');
  const demandee = formatDate(r.createdAt.slice(0, 10));
  const statut = (
    <Badge tone={DOC_REQUEST_STATUS_TONES[r.status]}>{DOC_REQUEST_STATUS_LABELS[r.status]}</Badge>
  );
  const retrait = <Retrait demande={r} />;
  const geste = r.canCancel ? (
    <Button size="sm" variant="ghost" onClick={onAnnuler} loading={enCours}>
      Annuler
    </Button>
  ) : null;
  return (
    <Tr>
      <Td>
        <p className="truncate font-semibold text-ink-strong" title={documents}>
          {documents}
        </p>
        {r.note ? (
          <p className="mt-0.5 truncate text-[11.5px] text-ink-muted italic" title={r.note}>
            « {r.note} »
          </p>
        ) : null}
        {r.status === 'rejected' && r.hrMessage ? (
          <p className="mt-0.5 text-[11.5px] font-semibold text-danger">Motif : {r.hrMessage}</p>
        ) : null}
        <p className="mt-1 text-[11.5px] text-ink-muted tabular-nums sm:hidden">
          Demandée le {demandee}
        </p>
        {r.status === 'ready' || r.status === 'delivered' ? (
          <div className="mt-2 text-[12.5px] sm:hidden">{retrait}</div>
        ) : null}
        <div className="mt-2.5 flex items-center gap-3 sm:hidden">
          {statut}
          <span className="ml-auto">{geste}</span>
        </div>
      </Td>
      <Td className="hidden tabular-nums sm:table-cell" title={timeAgo(r.createdAt)}>
        {demandee}
      </Td>
      <Td className="hidden sm:table-cell">{retrait}</Td>
      <Td className="hidden sm:table-cell">{statut}</Td>
      <Td className="hidden text-right sm:table-cell">{geste}</Td>
    </Tr>
  );
}

/**
 * Où en est le document, côté retrait : auprès de qui le chercher une fois
 * prêt, depuis quand il attend ; le jour où il a été remis. Tant que la
 * demande est en cours, la cellule reste vide.
 */
function Retrait({ demande: r }: { demande: DocumentRequestView }) {
  if (r.status === 'ready' && r.pickupContact) {
    return (
      <div className="min-w-0">
        <p className="truncate font-semibold text-primary" title={r.pickupContact}>
          Auprès de {r.pickupContact}
        </p>
        {/* L'ancienneté rend visible un document prêt que personne n'est
            venu chercher : l'agent est le seul à pouvoir y remédier. */}
        <p className="mt-0.5 text-[11.5px] text-ink-muted">
          {r.readyAt ? `Prête ${timeAgo(r.readyAt)}` : null}
          {r.readyAt && r.hrMessage ? ' · ' : null}
          {r.hrMessage}
        </p>
      </div>
    );
  }
  if (r.status === 'delivered' && r.deliveredAt) {
    return (
      <span className="text-ink-muted">Remise le {formatDate(r.deliveredAt.slice(0, 10))}</span>
    );
  }
  return null;
}
