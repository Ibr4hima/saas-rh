'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { AbsenceType, ApprovalChain, Holiday, MembershipRole } from '@teranga/contracts';
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
import { api, ApiError } from '../../../../lib/api';
import { ROLE_LABELS } from '../../../../lib/absences';
import { formatDate, useMe } from '../../../../lib/hooks';

const CHAIN_ROLES: MembershipRole[] = ['manager', 'hr', 'payroll', 'admin'];

export default function AbsenceSettingsPage() {
  const queryClient = useQueryClient();
  const me = useMe();
  const isAdmin = me.data?.role === 'admin';
  const [error, setError] = useState<string | null>(null);

  // --- Types ---
  const types = useQuery({
    queryKey: ['absence-types'],
    queryFn: () => api<AbsenceType[]>('/absence-types'),
  });
  const [typeName, setTypeName] = useState('');
  const [typeDeducts, setTypeDeducts] = useState(true);
  const [typeDays, setTypeDays] = useState('');
  const createType = useMutation({
    mutationFn: () =>
      api('/absence-types', {
        method: 'POST',
        body: {
          name: typeName,
          deductsBalance: typeDeducts,
          defaultAnnualDays: typeDays ? Number(typeDays) : null,
        },
      }),
    onSuccess: () => {
      setTypeName('');
      setTypeDays('');
      void queryClient.invalidateQueries({ queryKey: ['absence-types'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Création impossible.'),
  });

  // --- Jours fériés ---
  const [year, setYear] = useState(new Date().getFullYear());
  const holidays = useQuery({
    queryKey: ['holidays', year],
    queryFn: () => api<Holiday[]>(`/holidays?year=${year}`),
  });
  const [holidayDay, setHolidayDay] = useState('');
  const [holidayLabel, setHolidayLabel] = useState('');
  const createHoliday = useMutation({
    mutationFn: () =>
      api('/holidays', { method: 'POST', body: { day: holidayDay, label: holidayLabel } }),
    onSuccess: () => {
      setHolidayDay('');
      setHolidayLabel('');
      void queryClient.invalidateQueries({ queryKey: ['holidays'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Création impossible.'),
  });
  const deleteHoliday = useMutation({
    mutationFn: (id: string) => api(`/holidays/${id}`, { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['holidays'] }),
  });

  // --- Circuit d'approbation ---
  const chain = useQuery({
    queryKey: ['approval-chain'],
    queryFn: () => api<ApprovalChain>('/approval-chain'),
  });
  const [levels, setLevels] = useState<string[]>([]);
  useEffect(() => {
    if (chain.data) setLevels(chain.data.levels);
  }, [chain.data]);
  const saveChain = useMutation({
    mutationFn: () => api('/approval-chain', { method: 'PUT', body: { levels } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['approval-chain'] }),
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Enregistrement impossible.'),
  });

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <Link href="/absences" className="text-sm text-ink-muted hover:text-ink">
          ← Congés
        </Link>
        <h1 className="mt-1 text-xl font-bold text-ink-strong">Paramètres des congés</h1>
      </div>

      {error ? (
        <p className="mb-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
      ) : null}

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Circuit d&apos;approbation (chaîne de visas)</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-ink-muted">
              Chaque demande est visée niveau par niveau, dans l&apos;ordre. L&apos;administrateur
              peut viser n&apos;importe quel niveau.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {levels.map((role, i) => (
                <div
                  key={i}
                  className="flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-1"
                >
                  <span className="text-xs text-ink-muted">{i + 1}.</span>
                  <Select
                    value={role}
                    disabled={!isAdmin}
                    onChange={(e) =>
                      setLevels(levels.map((l, j) => (j === i ? e.target.value : l)))
                    }
                    className="h-7 w-36 border-0 bg-transparent"
                  >
                    {CHAIN_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </Select>
                  {isAdmin && levels.length > 1 ? (
                    <button
                      type="button"
                      aria-label={`Retirer le niveau ${i + 1}`}
                      className="text-ink-muted hover:text-danger"
                      onClick={() => setLevels(levels.filter((_, j) => j !== i))}
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              ))}
              {isAdmin && levels.length < 5 ? (
                <Button size="sm" variant="secondary" onClick={() => setLevels([...levels, 'hr'])}>
                  + Ajouter un niveau
                </Button>
              ) : null}
            </div>
            {isAdmin ? (
              <div>
                <Button size="sm" onClick={() => saveChain.mutate()} loading={saveChain.isPending}>
                  Enregistrer le circuit
                </Button>
              </div>
            ) : (
              <p className="text-xs text-ink-muted">
                Seul un administrateur peut modifier le circuit.
              </p>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Types d&apos;absences</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {types.isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : (
                <ul className="flex flex-col gap-2">
                  {types.data?.map((t) => (
                    <li key={t.id} className="flex items-center gap-2 text-sm">
                      <span className="font-medium text-ink-strong">{t.name}</span>
                      {t.deductsBalance ? (
                        <Badge tone="primary">
                          Décompté{t.defaultAnnualDays ? ` · ${t.defaultAnnualDays} j/an` : ''}
                        </Badge>
                      ) : (
                        <Badge tone="neutral">Suivi seul</Badge>
                      )}
                      {t.requiresDocument ? <Badge tone="warning">Justificatif</Badge> : null}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-2 flex flex-col gap-2 border-t border-line-soft pt-3">
                <Field label="Nouveau type" htmlFor="typeName">
                  <Input
                    id="typeName"
                    value={typeName}
                    onChange={(e) => setTypeName(e.target.value)}
                    placeholder="Ex : Congé exceptionnel"
                  />
                </Field>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={typeDeducts}
                      onChange={(e) => setTypeDeducts(e.target.checked)}
                    />
                    Décompté du solde
                  </label>
                  {typeDeducts ? (
                    <Input
                      type="number"
                      min={0}
                      value={typeDays}
                      onChange={(e) => setTypeDays(e.target.value)}
                      placeholder="j/an par défaut"
                      className="h-8 w-36"
                    />
                  ) : null}
                </div>
                <Button
                  size="sm"
                  disabled={typeName.trim().length < 2}
                  onClick={() => createType.mutate()}
                  loading={createType.isPending}
                >
                  Ajouter le type
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle>Jours fériés</CardTitle>
              <Select
                value={String(year)}
                onChange={(e) => setYear(Number(e.target.value))}
                className="h-8 w-28"
              >
                {[year - 1, year, year + 1]
                  .filter((v, i, arr) => arr.indexOf(v) === i)
                  .map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
              </Select>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="text-xs text-ink-muted">
                Les fériés à date mobile (Korité, Tabaski…) s&apos;ajoutent ici dès leur annonce —
                ils sont exclus du décompte des demandes.
              </p>
              {holidays.isLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : (holidays.data ?? []).length === 0 ? (
                <p className="text-sm text-ink-muted">Aucun férié enregistré pour {year}.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {holidays.data!.map((h) => (
                    <li key={h.id} className="flex items-center justify-between text-sm">
                      <span>
                        <span className="font-mono text-xs text-ink-muted">
                          {formatDate(h.day)}
                        </span>{' '}
                        <span className="text-ink-strong">{h.label}</span>
                      </span>
                      <button
                        type="button"
                        className="text-xs text-ink-muted hover:text-danger"
                        onClick={() => deleteHoliday.mutate(h.id)}
                      >
                        Supprimer
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-2 flex items-end gap-2 border-t border-line-soft pt-3">
                <Field label="Date" htmlFor="hDay">
                  <Input
                    id="hDay"
                    type="date"
                    value={holidayDay}
                    onChange={(e) => setHolidayDay(e.target.value)}
                    className="h-8"
                  />
                </Field>
                <Field label="Libellé" htmlFor="hLabel">
                  <Input
                    id="hLabel"
                    value={holidayLabel}
                    onChange={(e) => setHolidayLabel(e.target.value)}
                    placeholder="Ex : Tabaski"
                    className="h-8"
                  />
                </Field>
                <Button
                  size="sm"
                  disabled={!holidayDay || holidayLabel.trim().length < 2}
                  onClick={() => createHoliday.mutate()}
                  loading={createHoliday.isPending}
                >
                  Ajouter
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
