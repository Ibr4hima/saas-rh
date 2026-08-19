'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type { AbsenceRequestView, MyEmployeeView } from '@teranga/contracts';
import { Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@teranga/ui';
import { api, ApiError, apiUrl } from '../../../../lib/api';
import { formatDate } from '../../../../lib/hooks';

export default function MyDocumentsPage() {
  const myEmployee = useQuery({
    queryKey: ['me-employee'],
    queryFn: () => api<MyEmployeeView>('/me/employee'),
    retry: false,
  });
  const employeeId = myEmployee.data?.employeeId;

  const requests = useQuery({
    queryKey: ['my-requests', employeeId],
    queryFn: () =>
      api<AbsenceRequestView[]>(`/absence-requests?employeeId=${employeeId}&limit=100`),
    enabled: Boolean(employeeId),
  });

  if (myEmployee.isLoading) {
    return (
      <div className="mx-auto max-w-2xl">
        <Skeleton className="mb-4 h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (myEmployee.isError || !myEmployee.data) {
    const message =
      myEmployee.error instanceof ApiError ? myEmployee.error.message : 'Chargement impossible.';
    return <p className="text-sm text-danger">{message}</p>;
  }

  const emp = myEmployee.data;
  const withDocument = (requests.data ?? []).filter((r) => r.documentName);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <Link href="/moi" className="text-sm text-ink-muted hover:text-ink">
          ← Mon espace
        </Link>
        <h1 className="mt-1 text-xl font-bold text-ink-strong">Mes documents</h1>
        <p className="text-sm text-ink-muted">
          Vos documents RH, disponibles à tout moment — sans passer par le bureau RH.
        </p>
      </div>

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Attestations</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-ink-strong">Attestation de travail</p>
              <p className="text-sm text-ink-muted">
                {emp.status === 'active'
                  ? 'PDF officiel généré à l’instant, à votre nom.'
                  : 'Disponible uniquement pour les employés en activité.'}
              </p>
            </div>
            {emp.status === 'active' ? (
              <a href={apiUrl('/me/attestation')} className="sm:shrink-0">
                <Button variant="secondary" className="w-full sm:w-auto">
                  Télécharger
                </Button>
              </a>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Mes justificatifs d&apos;absence</CardTitle>
          </CardHeader>
          <CardContent>
            {requests.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : withDocument.length === 0 ? (
              <p className="text-sm text-ink-muted">
                Aucun justificatif pour le moment — ils apparaissent ici quand vous joignez un PDF à
                une demande (maladie, mission…).
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {withDocument.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-ink-strong">{r.documentName}</p>
                      <p className="text-xs text-ink-muted">
                        {r.absenceTypeName} · {formatDate(r.startDate)} → {formatDate(r.endDate)}
                      </p>
                    </div>
                    <a href={apiUrl(`/absence-requests/${r.id}/document`)} className="shrink-0">
                      <Button size="sm" variant="secondary">
                        Télécharger
                      </Button>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-xs text-ink-muted">
          Bulletins de paie et contrats signés arriveront ici avec les prochains modules.
        </p>
      </div>
    </div>
  );
}
