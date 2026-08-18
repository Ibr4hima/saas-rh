'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  createOrgUnitSchema,
  type CreateOrgUnitInput,
  type EmployeeListItem,
  type CursorPage,
  type OrgUnitMember,
  type OrgUnitView,
} from '@teranga/contracts';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Field,
  Input,
  Select,
  Skeleton,
} from '@teranga/ui';
import { api, ApiError } from '../../../lib/api';
import { useMe } from '../../../lib/hooks';

const TYPE_LABELS: Record<string, string> = {
  direction: 'Direction',
  department: 'Département',
  service: 'Service',
};

export default function OrganisationPage() {
  const me = useMe();
  const canManage = Boolean(me.data && ['admin', 'hr'].includes(me.data.role));
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const units = useQuery({
    queryKey: ['org-units'],
    queryFn: () => api<OrgUnitView[]>('/org-units'),
  });

  const byParent = new Map<string | null, OrgUnitView[]>();
  for (const u of units.data ?? []) {
    const list = byParent.get(u.parentId) ?? [];
    list.push(u);
    byParent.set(u.parentId, list);
  }
  const selected = (units.data ?? []).find((u) => u.id === selectedId) ?? null;

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-1 text-xl font-bold text-ink-strong">Organisation</h1>
      <p className="mb-6 text-sm text-ink-muted">
        L&apos;organigramme de votre structure : qui fait quoi, et à qui se référer.
      </p>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Organigramme</CardTitle>
          </CardHeader>
          <CardContent>
            {units.isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : (units.data ?? []).length === 0 ? (
              <EmptyState
                title="Aucune unité pour le moment"
                description="Commencez par créer vos directions, puis leurs départements et services."
              />
            ) : (
              <UnitTree
                byParent={byParent}
                parentId={null}
                selectedId={selectedId}
                onSelect={(id) => setSelectedId(id === selectedId ? null : id)}
              />
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          {selected ? (
            <UnitPanel
              key={selected.id}
              unit={selected}
              canManage={canManage}
              isStaff={Boolean(me.data && ['admin', 'hr', 'payroll'].includes(me.data.role))}
              onClose={() => setSelectedId(null)}
            />
          ) : null}
          {canManage ? <CreateUnitCard units={units.data ?? []} parentHint={selected} /> : null}
        </div>
      </div>
    </div>
  );
}

function UnitTree({
  byParent,
  parentId,
  selectedId,
  onSelect,
}: {
  byParent: Map<string | null, OrgUnitView[]>;
  parentId: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const children = byParent.get(parentId) ?? [];
  if (children.length === 0) return null;
  return (
    <div
      className={
        parentId ? 'ml-4 flex flex-col gap-2 border-l border-line pl-4' : 'flex flex-col gap-2'
      }
    >
      {children.map((u) => (
        <div key={u.id} className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => onSelect(u.id)}
            className={`w-full rounded-lg border px-4 py-3 text-left transition-colors ${
              selectedId === u.id
                ? 'border-primary bg-primary-soft'
                : 'border-line bg-surface hover:border-ink-muted/40'
            }`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-ink-strong">{u.name}</span>
              <Badge tone={u.unitType === 'direction' ? 'primary' : 'neutral'}>
                {TYPE_LABELS[u.unitType]}
              </Badge>
              <span className="ml-auto shrink-0 rounded-full bg-bg px-2 py-0.5 text-xs font-medium text-ink-muted">
                {u.headcount} {u.headcount > 1 ? 'personnes' : 'personne'}
              </span>
            </div>
            <p className="mt-1 text-xs text-ink-muted">
              {u.managerName ? (
                <>
                  Responsable : <span className="font-medium text-ink">{u.managerName}</span>
                  {u.managerPosition ? ` — ${u.managerPosition}` : ''}
                </>
              ) : (
                'Aucun responsable désigné'
              )}
            </p>
          </button>
          <UnitTree
            byParent={byParent}
            parentId={u.id}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        </div>
      ))}
    </div>
  );
}

function UnitPanel({
  unit,
  canManage,
  isStaff,
  onClose,
}: {
  unit: OrgUnitView;
  canManage: boolean;
  isStaff: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [managerId, setManagerId] = useState(unit.managerEmployeeId ?? '');
  const [error, setError] = useState<string | null>(null);

  const members = useQuery({
    queryKey: ['org-unit-members', unit.id],
    queryFn: () => api<OrgUnitMember[]>(`/org-units/${unit.id}/members`),
  });
  const employees = useQuery({
    queryKey: ['employees', 'for-manager-select'],
    queryFn: () => api<CursorPage<EmployeeListItem>>('/employees?limit=100'),
    enabled: canManage,
  });

  const saveManager = useMutation({
    mutationFn: () =>
      api(`/org-units/${unit.id}`, {
        method: 'PATCH',
        body: { managerEmployeeId: managerId || null },
      }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['org-units'] });
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Enregistrement impossible.'),
  });

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>{unit.name}</CardTitle>
        <button
          type="button"
          onClick={onClose}
          className="text-sm text-ink-muted hover:text-ink"
          aria-label="Fermer"
        >
          ✕
        </button>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <Badge tone={unit.unitType === 'direction' ? 'primary' : 'neutral'}>
            {TYPE_LABELS[unit.unitType]}
          </Badge>
          <span>
            {unit.headcount} {unit.headcount > 1 ? 'personnes' : 'personne'}
          </span>
        </div>

        {canManage ? (
          <div>
            <Field label="Responsable" htmlFor="unit-manager">
              <div className="flex gap-2">
                <Select
                  id="unit-manager"
                  value={managerId}
                  onChange={(ev) => setManagerId(ev.target.value)}
                >
                  <option value="">— Aucun</option>
                  {employees.data?.items.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.givenName} {e.familyName}
                      {e.positionTitle ? ` — ${e.positionTitle}` : ''}
                    </option>
                  ))}
                </Select>
                <Button
                  variant="secondary"
                  loading={saveManager.isPending}
                  disabled={(unit.managerEmployeeId ?? '') === managerId}
                  onClick={() => saveManager.mutate()}
                >
                  OK
                </Button>
              </div>
            </Field>
            {error ? (
              <p className="mt-2 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
                {error}
              </p>
            ) : null}
          </div>
        ) : unit.managerName ? (
          <p className="text-sm">
            <span className="text-ink-muted">Responsable :</span>{' '}
            <span className="font-medium text-ink-strong">{unit.managerName}</span>
            {unit.managerPosition ? (
              <span className="text-ink-muted"> — {unit.managerPosition}</span>
            ) : null}
          </p>
        ) : null}

        <div>
          <p className="mb-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">
            Membres
          </p>
          {members.isLoading ? (
            <Skeleton className="h-12 w-full" />
          ) : (members.data ?? []).length === 0 ? (
            <p className="text-sm text-ink-muted">
              Personne n&apos;est affecté à cette unité aujourd&apos;hui.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {members.data!.map((m) => (
                <li key={m.employeeId} className="flex items-center gap-2.5 text-sm">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[11px] font-bold text-primary">
                    {m.givenName[0]}
                    {m.familyName[0]}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {isStaff ? (
                      <Link
                        href={`/employees/${m.employeeId}`}
                        className="font-medium text-ink-strong hover:underline"
                      >
                        {m.givenName} {m.familyName}
                      </Link>
                    ) : (
                      <span className="font-medium text-ink-strong">
                        {m.givenName} {m.familyName}
                      </span>
                    )}
                    {m.positionTitle ? (
                      <span className="text-ink-muted"> · {m.positionTitle}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function CreateUnitCard({
  units,
  parentHint,
}: {
  units: OrgUnitView[];
  parentHint: OrgUnitView | null;
}) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<CreateOrgUnitInput>({
    resolver: zodResolver(createOrgUnitSchema),
    defaultValues: { unitType: 'direction' },
  });

  const create = useMutation({
    mutationFn: (input: CreateOrgUnitInput) =>
      api<{ id: string }>('/org-units', { method: 'POST', body: input }),
    onSuccess: () => {
      form.reset({ name: '', unitType: form.getValues('unitType'), parentId: undefined });
      void queryClient.invalidateQueries({ queryKey: ['org-units'] });
    },
    onError: (err) =>
      setServerError(err instanceof ApiError ? err.message : 'Création impossible.'),
  });

  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle>Nouvelle unité</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={form.handleSubmit((v) => {
            setServerError(null);
            create.mutate({ ...v, parentId: v.parentId || undefined });
          })}
          className="flex flex-col gap-4"
          noValidate
        >
          <Field label="Nom" htmlFor="name" error={form.formState.errors.name?.message} required>
            <Input
              id="name"
              placeholder="Ex : Direction des Ressources Humaines"
              {...form.register('name')}
            />
          </Field>
          <Field label="Type" htmlFor="unitType" required>
            <Select id="unitType" {...form.register('unitType')}>
              <option value="direction">Direction</option>
              <option value="department">Département</option>
              <option value="service">Service</option>
            </Select>
          </Field>
          <Field
            label="Rattachée à"
            htmlFor="parentId"
            error={form.formState.errors.parentId?.message}
          >
            <Select id="parentId" {...form.register('parentId')}>
              <option value="">— Aucune (unité racine)</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
          {parentHint ? (
            <button
              type="button"
              className="self-start text-xs text-primary hover:underline"
              onClick={() => form.setValue('parentId', parentHint.id)}
            >
              Rattacher à « {parentHint.name} »
            </button>
          ) : null}
          {serverError ? (
            <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{serverError}</p>
          ) : null}
          <Button type="submit" loading={create.isPending}>
            Créer
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
