'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { createOrgUnitSchema, type CreateOrgUnitInput, type OrgUnit } from '@teranga/contracts';
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

const TYPE_LABELS: Record<string, string> = {
  direction: 'Direction',
  department: 'Département',
  service: 'Service',
};

export default function OrganisationPage() {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const units = useQuery({ queryKey: ['org-units'], queryFn: () => api<OrgUnit[]>('/org-units') });

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

  const byParent = new Map<string | null, OrgUnit[]>();
  for (const u of units.data ?? []) {
    const list = byParent.get(u.parentId) ?? [];
    list.push(u);
    byParent.set(u.parentId, list);
  }

  const renderTree = (parentId: string | null, depth: number): React.ReactNode =>
    (byParent.get(parentId) ?? []).map((u) => (
      <div key={u.id}>
        <div
          className="flex items-center gap-2 border-b border-line-soft py-2"
          style={{ paddingLeft: depth * 24 }}
        >
          <span className="text-sm font-medium text-ink-strong">{u.name}</span>
          <Badge tone={u.unitType === 'direction' ? 'primary' : 'neutral'}>
            {TYPE_LABELS[u.unitType]}
          </Badge>
        </div>
        {renderTree(u.id, depth + 1)}
      </div>
    ));

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-1 text-xl font-bold text-ink-strong">Organisation</h1>
      <p className="mb-6 text-sm text-ink-muted">
        Directions, départements et services — l&apos;organigramme se déduit de cette structure.
      </p>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader>
            <CardTitle>Structure</CardTitle>
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
              <div>{renderTree(null, 0)}</div>
            )}
          </CardContent>
        </Card>

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
              <Field
                label="Nom"
                htmlFor="name"
                error={form.formState.errors.name?.message}
                required
              >
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
              <Field label="Rattachée à" htmlFor="parentId">
                <Select id="parentId" {...form.register('parentId')}>
                  <option value="">— (racine)</option>
                  {units.data?.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </Select>
              </Field>
              {serverError ? (
                <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
                  {serverError}
                </p>
              ) : null}
              <Button type="submit" loading={create.isPending}>
                Créer
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
