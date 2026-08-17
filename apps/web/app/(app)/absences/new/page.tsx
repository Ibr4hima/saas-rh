'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type {
  AbsencePreview,
  AbsenceType,
  BalanceView,
  CursorPage,
  EmployeeListItem,
} from '@teranga/contracts';
import { Badge, Button, Card, CardContent, Field, Input, Select } from '@teranga/ui';
import { api, ApiError } from '../../../../lib/api';
import { formatDate } from '../../../../lib/hooks';

const today = () => new Date().toISOString().slice(0, 10);

export default function NewAbsencePage() {
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState('');
  const [typeId, setTypeId] = useState('');
  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState(today());
  const [reason, setReason] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);

  const employees = useQuery({
    queryKey: ['employees-for-select'],
    queryFn: () => api<CursorPage<EmployeeListItem>>('/employees?limit=100&status=active'),
  });
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

  useEffect(() => {
    if (!typeId && types.data && types.data.length > 0) setTypeId(types.data[0]!.id);
  }, [types.data, typeId]);

  const selectedType = types.data?.find((t) => t.id === typeId);
  const balance = balances.data?.find((b) => b.absenceTypeId === typeId);
  const days = preview.data?.workingDays ?? 0;
  const insufficient =
    Boolean(selectedType?.deductsBalance) && balance !== undefined && days > balance.remainingDays;

  const submit = useMutation({
    mutationFn: () =>
      api<{ id: string }>('/absence-requests', {
        method: 'POST',
        body: {
          employeeId,
          absenceTypeId: typeId,
          startDate,
          endDate,
          reason: reason.trim() || undefined,
        },
      }),
    onSuccess: () => router.replace('/absences'),
    onError: (err) =>
      setServerError(err instanceof ApiError ? err.message : 'Enregistrement impossible.'),
  });

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <Link href="/absences" className="text-sm text-ink-muted hover:text-ink">
          ← Congés
        </Link>
        <h1 className="mt-1 text-xl font-bold text-ink-strong">Nouvelle demande d&apos;absence</h1>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4">
          <Field label="Employé" htmlFor="employee" required>
            <Select
              id="employee"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
            >
              <option value="">— Choisir —</option>
              {employees.data?.items.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.givenName} {e.familyName} ({e.employeeNumber})
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Type d'absence" htmlFor="type" required>
            <Select id="type" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
              {types.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.deductsBalance ? ' (décompté du solde)' : ''}
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
            <Input
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex : congés annuels famille"
            />
          </Field>

          {/* Aperçu du décompte — la confiance avant la soumission */}
          <div className="rounded-md border border-line bg-bg px-4 py-3 text-sm">
            {endDate < startDate ? (
              <p className="text-danger">La date de fin précède la date de début.</p>
            ) : preview.data ? (
              <div className="flex flex-col gap-1">
                <p className="text-ink">
                  <strong className="text-ink-strong">{days} jour(s) ouvré(s)</strong> seront
                  décomptés (week-ends exclus
                  {preview.data.holidaysSkipped.length > 0
                    ? `, ${preview.data.holidaysSkipped.length} férié(s) exclu(s)`
                    : ''}
                  ).
                </p>
                {preview.data.holidaysSkipped.map((h) => (
                  <p key={h.day} className="text-xs text-ink-muted">
                    · {formatDate(h.day)} — {h.label}
                  </p>
                ))}
                {selectedType?.deductsBalance && balance ? (
                  <p className={insufficient ? 'text-danger' : 'text-ink-muted'}>
                    Solde {balance.absenceTypeName} {balance.year} : {balance.remainingDays} j
                    restant(s) sur {balance.entitledDays}
                    {balance.pendingDays > 0 ? ` (${balance.pendingDays} j déjà en attente)` : ''}.
                    {insufficient ? ' Solde insuffisant pour cette demande.' : ''}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-ink-muted">Choisissez une période pour voir le décompte.</p>
            )}
          </div>

          {serverError ? (
            <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{serverError}</p>
          ) : null}

          <div className="flex justify-end gap-3">
            <Link href="/absences">
              <Button variant="secondary">Annuler</Button>
            </Link>
            <Button
              onClick={() => {
                setServerError(null);
                submit.mutate();
              }}
              disabled={!employeeId || !typeId || days === 0 || endDate < startDate || insufficient}
              loading={submit.isPending}
            >
              Soumettre la demande
            </Button>
          </div>
          {days === 0 && preview.data ? (
            <p className="text-right text-xs text-warning">
              Aucun jour ouvré sur la période choisie.
            </p>
          ) : null}
          {insufficient ? (
            <p className="text-right text-xs text-danger">
              Ajustez la période ou le solde de l&apos;employé (fiche employé → Congés).
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
