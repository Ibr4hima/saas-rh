'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ProfileChangeRequestView } from '@teranga/contracts';
import { PROFILE_CHANGE_STATUS_LABELS, PROFILE_CHANGE_STATUS_TONES } from '@teranga/contracts';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input } from '@teranga/ui';
import { api, ApiError } from '../lib/api';
import { timeAgo } from './document-request-list';

/**
 * Les corrections signalées par l'employé, côté RH.
 *
 * Affichée sur sa fiche : c'est là que la RH regarde quand la notification lui
 * dit « X signale un changement ». Confirmer applique les valeurs au dossier
 * dans la foulée — d'où l'affichage « avant → après », qui permet de repérer
 * qu'un champ a bougé entre-temps.
 */
export function ProfileChangeCard({ employeeId }: { employeeId: string }) {
  const queryClient = useQueryClient();
  const [rejectOpen, setRejectOpen] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const requests = useQuery({
    queryKey: ['profile-changes', employeeId],
    queryFn: () => api<ProfileChangeRequestView[]>(`/profile-changes?employeeId=${employeeId}`),
  });

  const decide = useMutation({
    mutationFn: (input: { id: string; decision: 'approve' | 'reject'; message?: string }) =>
      api(`/profile-changes/${input.id}/decide`, {
        method: 'POST',
        body: { decision: input.decision, message: input.message },
      }),
    onSuccess: () => {
      setRejectOpen(null);
      setReason('');
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['profile-changes'] });
      // Le dossier vient peut-être de changer : on le relit.
      void queryClient.invalidateQueries({ queryKey: ['employee', employeeId] });
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Action impossible.'),
  });

  const items = requests.data ?? [];
  if (items.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Changements signalés</CardTitle>
        <p className="text-sm text-ink-muted">
          Déclarés par l&apos;employé. Confirmer met le dossier à jour immédiatement.
        </p>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col">
          {items.map((r) => (
            <li
              key={r.id}
              className="flex flex-col gap-2 border-b border-line-soft py-3 last:border-b-0"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs text-ink-muted">
                  Signalé {timeAgo(r.createdAt)}
                  {r.handledByName ? ` · traité par ${r.handledByName}` : ''}
                </p>
                <Badge tone={PROFILE_CHANGE_STATUS_TONES[r.status]}>
                  {PROFILE_CHANGE_STATUS_LABELS[r.status]}
                </Badge>
              </div>

              <ul className="flex flex-col gap-1">
                {r.fields.map((f) => (
                  <li key={f.field} className="text-sm">
                    <span className="text-ink-muted">{f.label} : </span>
                    <span className="text-ink-muted line-through">{f.previous ?? '—'}</span>
                    <span className="mx-1.5 text-ink-muted">→</span>
                    <span className="font-medium text-ink-strong">{f.next ?? '—'}</span>
                  </li>
                ))}
              </ul>

              {r.note ? <p className="text-xs text-ink-muted italic">« {r.note} »</p> : null}
              {r.status === 'rejected' && r.hrMessage ? (
                <p className="text-xs text-danger">Motif : {r.hrMessage}</p>
              ) : null}

              {r.canDecide ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    loading={decide.isPending}
                    onClick={() => decide.mutate({ id: r.id, decision: 'approve' })}
                  >
                    Confirmer et mettre à jour
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setRejectOpen(rejectOpen === r.id ? null : r.id)}
                  >
                    Refuser
                  </Button>
                </div>
              ) : null}

              {rejectOpen === r.id ? (
                <div className="flex flex-col gap-2 rounded-md bg-bg p-3 sm:flex-row sm:items-end">
                  <div className="flex-1">
                    <label className="mb-1 block text-xs text-ink-muted" htmlFor={`why-${r.id}`}>
                      Motif du refus (obligatoire, transmis à l&apos;employé)
                    </label>
                    <Input
                      id={`why-${r.id}`}
                      placeholder="Ex : merci de passer présenter votre acte de mariage."
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      className="h-9"
                    />
                  </div>
                  <Button
                    variant="danger"
                    className="sm:shrink-0"
                    disabled={!reason.trim()}
                    loading={decide.isPending}
                    onClick={() =>
                      decide.mutate({ id: r.id, decision: 'reject', message: reason.trim() })
                    }
                  >
                    Confirmer le refus
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        {error ? (
          <p className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
