'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type { AbsenceRequestView, BalanceView, MyEmployeeView } from '@teranga/contracts';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@teranga/ui';
import { api, ApiError } from '../../../lib/api';
import { ABSENCE_STATUS_LABELS, ABSENCE_STATUS_TONES } from '../../../lib/absences';
import { formatDate, useMe } from '../../../lib/hooks';

export default function MySpacePage() {
  const me = useMe();
  const myEmployee = useQuery({
    queryKey: ['me-employee'],
    queryFn: () => api<MyEmployeeView>('/me/employee'),
    retry: false,
  });
  const employeeId = myEmployee.data?.employeeId;
  const year = new Date().getFullYear();

  const balances = useQuery({
    queryKey: ['balances', employeeId, String(year)],
    queryFn: () => api<BalanceView[]>(`/employees/${employeeId}/balances?year=${year}`),
    enabled: Boolean(employeeId),
  });
  const requests = useQuery({
    queryKey: ['my-requests', employeeId],
    queryFn: () => api<AbsenceRequestView[]>(`/absence-requests?employeeId=${employeeId}&limit=50`),
    enabled: Boolean(employeeId),
  });

  if (myEmployee.isLoading) {
    return (
      <div className="mx-auto max-w-3xl">
        <Skeleton className="mb-4 h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (myEmployee.isError) {
    const message =
      myEmployee.error instanceof ApiError ? myEmployee.error.message : 'Chargement impossible.';
    return (
      <div className="mx-auto max-w-3xl">
        <Card>
          <CardContent className="py-8 text-sm text-ink-muted">{message}</CardContent>
        </Card>
      </div>
    );
  }

  const emp = myEmployee.data!;
  const myRequests = (requests.data ?? []).filter((r) => r.employeeId === emp.employeeId);
  const deductible = (balances.data ?? []).filter((b) => b.deductsBalance);

  return (
    <div className="mx-auto max-w-3xl">
      {/* Identité */}
      <Card className="mb-6">
        <CardContent className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-4">
            <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary-soft text-lg font-bold text-primary">
              {emp.givenName[0]}
              {emp.familyName[0]}
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-bold text-ink-strong">
                {me.data ? greeting() : 'Bonjour'}, {emp.givenName} 👋
              </h1>
              <p className="truncate text-sm text-ink-muted">
                {emp.positionTitle ?? 'Poste non renseigné'}
                {emp.orgUnitName ? ` · ${emp.orgUnitName}` : ''}
              </p>
              <p className="text-xs text-ink-muted">
                Matricule <span className="font-mono">{emp.employeeNumber}</span> · Depuis le{' '}
                {formatDate(emp.hiredOn)}
              </p>
            </div>
          </div>
          <Link href="/moi/conges" className="sm:shrink-0">
            <Button className="w-full sm:w-auto">Poser une demande</Button>
          </Link>
        </CardContent>
      </Card>

      {/* Soldes */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {balances.isLoading ? (
          <Skeleton className="h-28 w-full" />
        ) : (
          deductible.map((b) => (
            <Card key={b.absenceTypeId}>
              <CardContent className="py-4">
                <p
                  className="text-3xl font-bold text-ink-strong"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {b.remainingDays}
                  <span className="text-base font-medium text-ink-muted"> j restants</span>
                </p>
                <p className="text-sm text-ink-muted">
                  {b.absenceTypeName} {b.year} — {b.entitledDays} j de droits, {b.takenDays} pris
                  {b.pendingDays > 0 ? `, ${b.pendingDays} en attente` : ''}
                </p>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Mes demandes */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Mes demandes</CardTitle>
          <Link href="/moi/conges" className="text-xs font-medium text-primary hover:underline">
            Poser une demande →
          </Link>
        </CardHeader>
        <CardContent>
          {requests.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : myRequests.length === 0 ? (
            <p className="text-sm text-ink-muted">
              Aucune demande pour le moment. Votre première demande de congé se pose en 30 secondes.
              🌴
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {myRequests.slice(0, 6).map((r) => (
                <li key={r.id} className="flex items-center gap-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink-strong">{r.absenceTypeName}</p>
                    <p className="text-xs text-ink-muted">
                      {formatDate(r.startDate)} → {formatDate(r.endDate)} · {r.daysCount} j
                    </p>
                  </div>
                  <Badge tone={ABSENCE_STATUS_TONES[r.status] ?? 'neutral'}>
                    {ABSENCE_STATUS_LABELS[r.status] ?? r.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Bonjour';
  if (h < 18) return 'Bon après-midi';
  return 'Bonsoir';
}
