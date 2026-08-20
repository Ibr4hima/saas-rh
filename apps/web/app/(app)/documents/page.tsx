'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { DocumentRequestView } from '@teranga/contracts';
import { DOC_REQUEST_STATUS_LABELS } from '@teranga/contracts';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Select,
  Skeleton,
} from '@teranga/ui';
import { DocumentRequestRow } from '../../../components/document-request-list';
import { api, ApiError } from '../../../lib/api';

const OPEN = ['received', 'processing', 'ready'];

/**
 * File d'attente RH des demandes de documents (ADR-0012) : les documents
 * officiels sont générés, cachetés, signés puis remis en main propre.
 */
export default function DocumentRequestsPage() {
  const [status, setStatus] = useState('');

  const requests = useQuery({
    queryKey: ['document-requests', status],
    queryFn: () =>
      api<DocumentRequestView[]>(`/document-requests${status ? `?status=${status}` : ''}`),
  });

  if (requests.isError) {
    const message =
      requests.error instanceof ApiError ? requests.error.message : 'Chargement impossible.';
    return <p className="text-sm text-danger">{message}</p>;
  }

  const items = requests.data ?? [];
  const open = items.filter((r) => OPEN.includes(r.status));
  const closed = items.filter((r) => !OPEN.includes(r.status));

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-ink-strong">Demandes de documents</h1>
        <p className="text-sm text-ink-muted">
          Les employés demandent leurs documents ici. Générez-les, imprimez, cachetez et signez,
          puis indiquez où les retirer.
        </p>
      </div>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>{status ? DOC_REQUEST_STATUS_LABELS[status as never] : 'À traiter'}</CardTitle>
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-8 w-44"
            aria-label="Filtrer par statut"
          >
            <option value="">Toutes</option>
            <option value="received">Reçues</option>
            <option value="processing">En traitement</option>
            <option value="ready">Prêtes à retirer</option>
            <option value="delivered">Remises</option>
            <option value="rejected">Refusées</option>
          </Select>
        </CardHeader>
        <CardContent>
          {requests.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : items.length === 0 ? (
            <EmptyState
              title="Aucune demande"
              description="Les demandes des employés apparaîtront ici dès qu'ils en formuleront une."
            />
          ) : (
            <ul className="flex flex-col">
              {(status ? items : open).map((r) => (
                <DocumentRequestRow key={r.id} request={r} showEmployee />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {!status && closed.length > 0 ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Historique</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col">
              {closed.slice(0, 20).map((r) => (
                <DocumentRequestRow key={r.id} request={r} showEmployee />
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
