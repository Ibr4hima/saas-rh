'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import type { AbsenceRequestView } from '@teranga/contracts';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Select,
  Skeleton,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@teranga/ui';
import { api, ApiError } from '../../../lib/api';
import { ABSENCE_STATUS_LABELS, ABSENCE_STATUS_TONES, ROLE_LABELS } from '../../../lib/absences';
import { formatDate, useMe } from '../../../lib/hooks';

export default function AbsencesPage() {
  const queryClient = useQueryClient();
  const me = useMe();
  const [status, setStatus] = useState('pending');
  const [actionError, setActionError] = useState<string | null>(null);

  const requests = useQuery({
    queryKey: ['absence-requests', status],
    queryFn: () =>
      api<AbsenceRequestView[]>(`/absence-requests${status ? `?status=${status}` : ''}`),
  });
  const upcoming = useQuery({
    queryKey: ['absences-upcoming'],
    queryFn: () => api<AbsenceRequestView[]>('/absences/upcoming'),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['absence-requests'] });
    void queryClient.invalidateQueries({ queryKey: ['absences-upcoming'] });
  };

  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approved' | 'rejected' }) =>
      api(`/absence-requests/${id}/decision`, { method: 'POST', body: { decision } }),
    onSuccess: refresh,
    onError: (err) => setActionError(err instanceof ApiError ? err.message : 'Action impossible.'),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api(`/absence-requests/${id}/cancel`, { method: 'POST' }),
    onSuccess: refresh,
    onError: (err) => setActionError(err instanceof ApiError ? err.message : 'Action impossible.'),
  });

  const canManage = me.data && ['admin', 'hr'].includes(me.data.role);
  const items = requests.data ?? [];

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-ink-strong">Congés &amp; absences</h1>
          <p className="text-sm text-ink-muted">
            Demandes, visas et absences à venir de votre organisation.
          </p>
        </div>
        <div className="flex gap-2">
          {canManage ? (
            <Link href="/absences/parametres">
              <Button variant="secondary">Paramètres</Button>
            </Link>
          ) : null}
          {canManage ? (
            <Link href="/absences/new">
              <Button>Nouvelle demande</Button>
            </Link>
          ) : null}
        </div>
      </div>

      {actionError ? (
        <p className="mb-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          {actionError}
        </p>
      ) : null}

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>Demandes</CardTitle>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="h-8 w-40">
              <option value="pending">En attente</option>
              <option value="approved">Approuvées</option>
              <option value="rejected">Refusées</option>
              <option value="cancelled">Annulées</option>
              <option value="">Toutes</option>
            </Select>
          </CardHeader>
          {requests.isLoading ? (
            <CardContent>
              <Skeleton className="h-24 w-full" />
            </CardContent>
          ) : items.length === 0 ? (
            <EmptyState
              title="Aucune demande dans ce statut"
              description={
                canManage
                  ? 'Créez une demande pour un employé — le circuit de visas se charge du reste.'
                  : undefined
              }
              action={
                canManage ? (
                  <Link href="/absences/new">
                    <Button size="sm">Nouvelle demande</Button>
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <Table>
              <THead>
                <tr>
                  <Th>Employé</Th>
                  <Th>Type</Th>
                  <Th>Période</Th>
                  <Th>Jours</Th>
                  <Th>Visas</Th>
                  <Th>Statut</Th>
                  <Th />
                </tr>
              </THead>
              <TBody>
                {items.map((r) => (
                  <Tr key={r.id}>
                    <Td className="font-medium text-ink-strong">
                      {r.employeeName}
                      <span className="block font-mono text-xs font-normal text-ink-muted">
                        {r.employeeNumber}
                      </span>
                    </Td>
                    <Td>{r.absenceTypeName}</Td>
                    <Td className="whitespace-nowrap">
                      {formatDate(r.startDate)} → {formatDate(r.endDate)}
                    </Td>
                    <Td className="font-mono">{r.daysCount}</Td>
                    <Td>
                      <div className="flex items-center gap-1">
                        {r.chainLevels.map((role, i) => {
                          const approval = r.approvals.find(
                            (a) => a.level === i && a.decision === 'approved',
                          );
                          const rejected = r.approvals.find(
                            (a) => a.level === i && a.decision === 'rejected',
                          );
                          return (
                            <span
                              key={i}
                              title={`Niveau ${i + 1} : ${ROLE_LABELS[role] ?? role}${
                                approval ? ` — visé par ${approval.decidedByName}` : ''
                              }${rejected ? ` — refusé par ${rejected.decidedByName}` : ''}`}
                              className={
                                rejected
                                  ? 'size-2.5 rounded-full bg-danger'
                                  : approval
                                    ? 'size-2.5 rounded-full bg-success'
                                    : i === r.currentLevel && r.status === 'pending'
                                      ? 'size-2.5 rounded-full bg-warning'
                                      : 'size-2.5 rounded-full bg-line'
                              }
                            />
                          );
                        })}
                        <span className="ml-1 text-xs text-ink-muted">
                          {Math.min(r.currentLevel, r.chainLevels.length)}/{r.chainLevels.length}
                        </span>
                      </div>
                    </Td>
                    <Td>
                      <Badge tone={ABSENCE_STATUS_TONES[r.status] ?? 'neutral'}>
                        {ABSENCE_STATUS_LABELS[r.status] ?? r.status}
                      </Badge>
                    </Td>
                    <Td>
                      <div className="flex justify-end gap-2">
                        {r.canDecide ? (
                          <>
                            <Button
                              size="sm"
                              onClick={() => decide.mutate({ id: r.id, decision: 'approved' })}
                              loading={decide.isPending}
                            >
                              Approuver
                            </Button>
                            <Button
                              size="sm"
                              variant="danger"
                              onClick={() => decide.mutate({ id: r.id, decision: 'rejected' })}
                              loading={decide.isPending}
                            >
                              Refuser
                            </Button>
                          </>
                        ) : null}
                        {canManage && ['pending', 'approved'].includes(r.status) ? (
                          <Button size="sm" variant="ghost" onClick={() => cancel.mutate(r.id)}>
                            Annuler
                          </Button>
                        ) : null}
                      </div>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Prochaines absences</CardTitle>
          </CardHeader>
          <CardContent>
            {upcoming.isLoading ? (
              <Skeleton className="h-12 w-full" />
            ) : (upcoming.data ?? []).length === 0 ? (
              <p className="text-sm text-ink-muted">Personne d&apos;absent prochainement.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {upcoming.data!.map((r) => (
                  <li key={r.id} className="flex items-baseline gap-3 text-sm">
                    <span className="w-48 shrink-0 font-medium text-ink-strong">
                      {r.employeeName}
                    </span>
                    <span className="text-ink-muted">
                      {r.absenceTypeName} · {formatDate(r.startDate)} → {formatDate(r.endDate)} (
                      {r.daysCount} j)
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
