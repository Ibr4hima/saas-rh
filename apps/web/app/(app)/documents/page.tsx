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

/**
 * Demandes encore à la charge de la RH. « Prête à retirer » n'en fait pas
 * partie : le travail est fait, la balle est dans le camp de l'employé.
 */
const OPEN = ['received', 'processing'];

/**
 * File d'attente RH des demandes de documents (ADR-0012) : les documents
 * officiels sont générés, cachetés, signés puis retirés en main propre.
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
  // « Prête » a sa propre section, JAMAIS tronquée et triée du plus ancien au
  // plus récent. C'est la contrepartie du retrait de « remise » : puisque
  // personne ne vient clore la demande, un document annoncé et jamais retiré
  // doit remonter tout seul. Noyé dans un historique plafonné, il disparaissait.
  const ready = items
    .filter((r) => r.status === 'ready')
    .sort((a, b) => (a.readyAt ?? '').localeCompare(b.readyAt ?? ''));
  const closed = items.filter((r) => !OPEN.includes(r.status) && r.status !== 'ready');
  // La liste réellement rendue : c'est ELLE qui décide de l'état vide, pas le
  // total. Depuis que « prête » sort de la file, « tout est traité » est le cas
  // NORMAL — un cadre blanc muet y serait la vue la plus fréquente de la page.
  const shown = status ? items : open;

  return (
    <div className="mx-auto max-w-4xl">
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
            <option value="rejected">Refusées</option>
          </Select>
        </CardHeader>
        <CardContent>
          {requests.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : shown.length === 0 ? (
            <EmptyState
              title={
                items.length === 0
                  ? 'Aucune demande'
                  : status
                    ? 'Aucune demande dans ce statut'
                    : 'Tout est traité'
              }
              description={
                items.length === 0
                  ? "Les demandes des employés apparaîtront ici dès qu'ils en formuleront une."
                  : status
                    ? 'Changez de filtre pour voir les autres demandes.'
                    : 'Aucune demande en attente de votre part. Les autres sont plus bas.'
              }
            />
          ) : (
            <ul className="flex flex-col">
              {shown.map((r) => (
                <DocumentRequestRow key={r.id} request={r} showEmployee />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {!status && ready.length > 0 ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Prêtes à retirer</CardTitle>
            <p className="text-sm text-ink-muted">
              L&apos;employé a été prévenu — les plus anciennes d&apos;abord. Relancez-le si un
              document attend depuis trop longtemps.
            </p>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col">
              {ready.map((r) => (
                <DocumentRequestRow key={r.id} request={r} showEmployee />
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {!status && closed.length > 0 ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Traitées</CardTitle>
            <p className="text-sm text-ink-muted">Demandes closes — rien à faire de votre côté.</p>
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
