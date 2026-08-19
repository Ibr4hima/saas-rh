'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type {
  AbsencePreview,
  AbsenceRequestView,
  AbsenceType,
  BalanceView,
  MyEmployeeView,
} from '@teranga/contracts';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Select,
  Skeleton,
} from '@teranga/ui';
import { api, ApiError, apiUrl } from '../../../../lib/api';
import { DocViewer, type ViewableDoc } from '../../../../components/doc-viewer';
import { ABSENCE_STATUS_LABELS, ABSENCE_STATUS_TONES } from '../../../../lib/absences';
import { formatDate } from '../../../../lib/hooks';

const today = () => new Date().toISOString().slice(0, 10);

export default function MyLeavesPage() {
  const queryClient = useQueryClient();
  const [typeId, setTypeId] = useState('');
  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState(today());
  const [reason, setReason] = useState('');
  const [doc, setDoc] = useState<{
    filename: string;
    contentBase64: string;
    sizeBytes: number;
  } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [viewedDoc, setViewedDoc] = useState<ViewableDoc | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const myEmployee = useQuery({
    queryKey: ['me-employee'],
    queryFn: () => api<MyEmployeeView>('/me/employee'),
    retry: false,
  });
  const employeeId = myEmployee.data?.employeeId;

  const types = useQuery({
    queryKey: ['absence-types'],
    queryFn: () => api<AbsenceType[]>('/absence-types'),
  });
  const preview = useQuery({
    queryKey: ['absence-preview', startDate, endDate],
    queryFn: () =>
      api<AbsencePreview>('/absence-preview', { method: 'POST', body: { startDate, endDate } }),
    enabled: Boolean(startDate && endDate && endDate >= startDate),
  });
  const balances = useQuery({
    queryKey: ['balances', employeeId, startDate.slice(0, 4)],
    queryFn: () =>
      api<BalanceView[]>(`/employees/${employeeId}/balances?year=${startDate.slice(0, 4)}`),
    enabled: Boolean(employeeId),
  });
  const requests = useQuery({
    queryKey: ['my-requests', employeeId],
    queryFn: () => api<AbsenceRequestView[]>(`/absence-requests?employeeId=${employeeId}&limit=50`),
    enabled: Boolean(employeeId),
  });

  useEffect(() => {
    if (!typeId && types.data && types.data.length > 0) setTypeId(types.data[0]!.id);
  }, [types.data, typeId]);

  const selectedType = types.data?.find((t) => t.id === typeId);
  const needsDocument = Boolean(selectedType?.requiresDocument);

  const pickDocument = (file: File | null) => {
    setFileError(null);
    setDoc(null); // une sélection invalide ne doit jamais garder l'ancien fichier
    if (!file) return;
    if (file.type !== 'application/pdf') {
      setFileError('Le justificatif doit être un PDF.');
      return;
    }
    if (file.size === 0 || file.size > 5 * 1024 * 1024) {
      setFileError('Le PDF doit faire entre 1 octet et 5 Mo.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = String(reader.result).split(',')[1] ?? '';
      setDoc({ filename: file.name, contentBase64: base64, sizeBytes: file.size });
    };
    reader.onerror = () => setFileError('Impossible de lire ce fichier — réessayez.');
    reader.readAsDataURL(file);
  };
  const balance = balances.data?.find((b) => b.absenceTypeId === typeId);
  const days = preview.data?.workingDays ?? 0;
  const insufficient =
    Boolean(selectedType?.deductsBalance) && balance !== undefined && days > balance.remainingDays;

  const submit = useMutation({
    mutationFn: () =>
      api<{ id: string; daysCount: number }>('/absence-requests', {
        method: 'POST',
        body: {
          employeeId,
          absenceTypeId: typeId,
          startDate,
          endDate,
          reason: reason.trim() || undefined,
          document: doc ? { filename: doc.filename, contentBase64: doc.contentBase64 } : undefined,
        },
      }),
    onSuccess: (r) => {
      setSuccess(
        `Demande envoyée : ${r.daysCount} jour(s) — elle suit maintenant le circuit de validation.`,
      );
      setReason('');
      setDoc(null);
      void queryClient.invalidateQueries({ queryKey: ['my-requests'] });
      void queryClient.invalidateQueries({ queryKey: ['balances'] });
    },
    onError: (err) =>
      setServerError(err instanceof ApiError ? err.message : 'Envoi impossible — réessayez.'),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => api(`/absence-requests/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['my-requests'] });
      void queryClient.invalidateQueries({ queryKey: ['balances'] });
    },
    onError: (err) =>
      setServerError(err instanceof ApiError ? err.message : 'Annulation impossible.'),
  });

  const myRequests = (requests.data ?? []).filter((r) => r.employeeId === employeeId);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <Link href="/moi" className="text-sm text-ink-muted hover:text-ink">
          ← Mon espace
        </Link>
        <h1 className="mt-1 text-xl font-bold text-ink-strong">Mes congés</h1>
      </div>

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Poser une demande</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {types.data && types.data.length === 0 ? (
              <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
                Aucun type d&apos;absence n&apos;est encore configuré — contactez votre service RH.
              </p>
            ) : null}
            <Field label="Type d'absence" htmlFor="type" required>
              <Select id="type" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
                {types.data?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Du" htmlFor="start" required>
                <Input
                  id="start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </Field>
              <Field label="Au (inclus)" htmlFor="end" required>
                <Input
                  id="end"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </Field>
            </div>
            <Field label="Motif (facultatif)" htmlFor="reason">
              <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>

            {needsDocument ? (
              <Field
                label={`Justificatif PDF (${selectedType?.name === 'Mission' ? 'ordre de mission' : 'attestation'})`}
                htmlFor="justificatif"
                required
              >
                <input
                  id="justificatif"
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => pickDocument(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-ink-muted file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-primary-soft file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary hover:file:opacity-90"
                />
                {doc ? (
                  <p className="mt-1 text-xs text-success">
                    ✓ {doc.filename} ({Math.round(doc.sizeBytes / 1024)} Ko)
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-ink-muted">
                    Obligatoire pour « {selectedType?.name} » — PDF, 5 Mo max.
                  </p>
                )}
                {fileError ? <p className="mt-1 text-xs text-danger">{fileError}</p> : null}
              </Field>
            ) : null}

            <div className="rounded-md border border-line bg-bg px-4 py-3 text-sm">
              {endDate < startDate ? (
                <p className="text-danger">La date de fin précède la date de début.</p>
              ) : preview.data ? (
                <div className="flex flex-col gap-1">
                  <p className="text-ink">
                    <strong className="text-ink-strong">{days} jour(s) ouvré(s)</strong> décomptés —
                    week-ends
                    {preview.data.holidaysSkipped.length > 0 ? ' et fériés' : ''} exclus.
                  </p>
                  {selectedType?.deductsBalance && balance ? (
                    <p className={insufficient ? 'text-danger' : 'text-ink-muted'}>
                      Il vous reste {balance.remainingDays} j de {balance.absenceTypeName}.
                      {insufficient ? ' Solde insuffisant pour cette période.' : ''}
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="text-ink-muted">Choisissez une période pour voir le décompte.</p>
              )}
            </div>

            {serverError ? (
              <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
                {serverError}
              </p>
            ) : null}
            {success ? (
              <p className="rounded-md bg-success-soft px-3 py-2 text-sm text-success">{success}</p>
            ) : null}

            <Button
              onClick={() => {
                setServerError(null);
                setSuccess(null);
                submit.mutate();
              }}
              disabled={
                !employeeId ||
                !typeId ||
                days === 0 ||
                endDate < startDate ||
                insufficient ||
                (needsDocument && !doc)
              }
              loading={submit.isPending}
            >
              Envoyer ma demande
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Historique</CardTitle>
          </CardHeader>
          <CardContent>
            {requests.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : myRequests.length === 0 ? (
              <p className="text-sm text-ink-muted">Aucune demande pour le moment.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {myRequests.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-ink-strong">
                        {r.absenceTypeName} · {r.daysCount} j
                      </p>
                      <p className="text-xs text-ink-muted">
                        {formatDate(r.startDate)} → {formatDate(r.endDate)}
                        {r.status === 'pending'
                          ? ` · visa ${Math.min(r.currentLevel + 1, r.chainLevels.length)}/${r.chainLevels.length}`
                          : ''}
                        {r.documentName ? (
                          <>
                            {' · '}
                            <button
                              type="button"
                              onClick={() =>
                                setViewedDoc({
                                  url: apiUrl(`/absence-requests/${r.id}/document`),
                                  filename: r.documentName!,
                                  contentType: 'application/pdf',
                                })
                              }
                              className="text-primary hover:underline"
                            >
                              justificatif
                            </button>
                          </>
                        ) : null}
                      </p>
                    </div>
                    <Badge tone={ABSENCE_STATUS_TONES[r.status] ?? 'neutral'}>
                      {ABSENCE_STATUS_LABELS[r.status] ?? r.status}
                    </Badge>
                    {r.status === 'pending' ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => cancel.mutate(r.id)}
                        loading={cancel.isPending}
                      >
                        Annuler
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <DocViewer doc={viewedDoc} onClose={() => setViewedDoc(null)} />
    </div>
  );
}
