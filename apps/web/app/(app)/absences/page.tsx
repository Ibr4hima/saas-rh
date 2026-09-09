'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { AbsenceRequestView } from '@teranga/contracts';
import {
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
import { api, ApiError, apiUrl } from '../../../lib/api';
import { DocViewer, type ViewableDoc } from '../../../components/doc-viewer';
import { ROLE_LABELS } from '../../../lib/absences';
import { StatutAbsence } from '../../../components/statut-absence';
import { formatDate, useMe } from '../../../lib/hooks';
import { Icon } from '../../../components/icons';

/**
 * Le circuit de visa, en toutes lettres, au survol du statut.
 *
 * La colonne de pastilles qui le montrait a disparu : sur huit colonnes, trois
 * points gris ne disaient rien à qui ne connaissait pas le code, et prenaient
 * la place d'une information qu'on lit vraiment. Le détail reste à un survol,
 * et le niveau qui bloque est écrit sous le statut des demandes en attente.
 */
function resumeVisas(r: AbsenceRequestView): string | undefined {
  if (r.chainLevels.length === 0) return undefined;
  return r.chainLevels
    .map((role, i) => {
      const qui = ROLE_LABELS[role] ?? role;
      const visa = r.approvals.find((a) => a.level === i);
      if (visa?.decision === 'approved') return `${qui} — visé par ${visa.decidedByName}`;
      if (visa?.decision === 'rejected') return `${qui} — refusé par ${visa.decidedByName}`;
      return `${qui} — en attente`;
    })
    .join('\n');
}

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
  const canManage = me.data && ['admin', 'hr'].includes(me.data.role);
  const [viewedDoc, setViewedDoc] = useState<ViewableDoc | null>(null);
  const items = requests.data ?? [];

  return (
    <div className="mx-auto w-full max-w-6xl">
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
              icon={<Icon name="free_cancellation" size={22} />}
              title="Aucune demande dans ce statut"
              description="Les employés posent leurs demandes depuis leur portail — elles arrivent ici pour visa."
            />
          ) : (
            <Table>
              <THead>
                <tr>
                  <Th>Employé</Th>
                  <Th>Type</Th>
                  <Th>Début</Th>
                  <Th>Fin</Th>
                  <Th className="text-right">Jours</Th>
                  <Th>Justificatif</Th>
                  <Th>Statut</Th>
                  <Th />
                </tr>
              </THead>
              <TBody>
                {items.map((r) => (
                  <Tr key={r.id}>
                    <Td className="font-semibold text-ink-strong">
                      {r.employeeName}
                      <span className="mt-0.5 block font-mono text-[10.5px] font-normal text-ink-muted">
                        {r.employeeNumber}
                      </span>
                    </Td>
                    <Td className="whitespace-nowrap">{r.absenceTypeName}</Td>
                    <Td className="whitespace-nowrap tabular-nums">{formatDate(r.startDate)}</Td>
                    <Td className="whitespace-nowrap tabular-nums">{formatDate(r.endDate)}</Td>
                    <Td className="text-right font-semibold tabular-nums">{r.daysCount}</Td>
                    <Td>
                      {r.documentName && canManage ? (
                        <button
                          type="button"
                          onClick={() =>
                            setViewedDoc({
                              url: apiUrl(`/absence-requests/${r.id}/document`),
                              filename: r.documentName!,
                              contentType: 'application/pdf',
                            })
                          }
                          title={r.documentName}
                          className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-[3px] text-[11px] font-semibold text-primary transition-colors hover:border-primary/40 hover:bg-primary/[0.07] focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
                        >
                          <Icon name="visibility" size={13} />
                          Prévisualiser
                        </button>
                      ) : (
                        // Un tiret, pas une case vide : « rien à joindre » se dit,
                        // sinon la colonne a l'air de n'avoir pas fini de charger.
                        <span className="text-ink-muted/60">—</span>
                      )}
                    </Td>
                    <Td>
                      <StatutAbsence statut={r.status} titre={resumeVisas(r)} />
                      {r.status === 'pending' && r.chainLevels[r.currentLevel] ? (
                        <span className="mt-1 block text-[10.5px] whitespace-nowrap text-ink-muted">
                          chez{' '}
                          {ROLE_LABELS[r.chainLevels[r.currentLevel]!] ??
                            r.chainLevels[r.currentLevel]}
                        </span>
                      ) : null}
                    </Td>
                    <Td>
                      {r.canDecide ? (
                        <div className="flex justify-end gap-2">
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
                        </div>
                      ) : null}
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
          {upcoming.isLoading ? (
            <CardContent>
              <Skeleton className="h-12 w-full" />
            </CardContent>
          ) : (upcoming.data ?? []).length === 0 ? (
            <CardContent>
              <p className="text-sm text-ink-muted">Personne d&apos;absent prochainement.</p>
            </CardContent>
          ) : (
            <Table>
              <THead>
                <tr>
                  <Th>Nom</Th>
                  <Th>Type</Th>
                  <Th>Début</Th>
                  <Th>Fin</Th>
                  <Th>Jours</Th>
                </tr>
              </THead>
              <TBody>
                {upcoming.data!.map((r) => (
                  <Tr key={r.id}>
                    <Td>
                      <p className="font-medium text-ink-strong">{r.employeeName}</p>
                      {r.workEmail ? <p className="text-xs text-ink-muted">{r.workEmail}</p> : null}
                    </Td>
                    <Td>{r.absenceTypeName}</Td>
                    <Td className="whitespace-nowrap">{formatDate(r.startDate)}</Td>
                    <Td className="whitespace-nowrap">{formatDate(r.endDate)}</Td>
                    <Td className="font-mono">{r.daysCount}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>

      <DocViewer doc={viewedDoc} onClose={() => setViewedDoc(null)} />
    </div>
  );
}
