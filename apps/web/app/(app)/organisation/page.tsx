'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  createOrgUnitSchema,
  ORG_UNIT_PARENT_TYPES,
  ORG_UNIT_TYPE_LABELS,
  orgUnitLabel,
  type CreateOrgUnitInput,
  type OrgUnitMember,
  type OrgUnitType,
  type OrgUnitView,
} from '@teranga/contracts';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataBlock,
  DataGrid,
  EmptyState,
  Field,
  Input,
  Select,
  Skeleton,
} from '@teranga/ui';
import { api, ApiError } from '../../../lib/api';
import { useMe } from '../../../lib/hooks';
import { Icon } from '../../../components/icons';

const TYPE_LABELS = ORG_UNIT_TYPE_LABELS;

/**
 * « Direction Financière › Service Comptabilité » : les noms d'unités ne sont
 * uniques QU'ENTRE SŒURS, donc deux « Service Comptabilité » sous deux
 * directions différentes sont légitimes — et indiscernables dans un menu plat.
 */
function pathLabel(units: OrgUnitView[], u: OrgUnitView): string {
  const parent = u.parentId ? units.find((p) => p.id === u.parentId) : null;
  return parent ? `${orgUnitLabel(parent)} › ${orgUnitLabel(u)}` : orgUnitLabel(u);
}

/** Parents possibles pour un type donné : une direction n'en a aucun. */
function parentOptions(units: OrgUnitView[], type: OrgUnitType, excludeId?: string) {
  const allowed = ORG_UNIT_PARENT_TYPES[type];
  return units.filter((u) => u.id !== excludeId && allowed.includes(u.unitType as OrgUnitType));
}

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
    <div className="mx-auto w-full max-w-6xl">
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
                icon={<Icon name="family_history" size={22} />}
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
              units={units.data ?? []}
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
              <span className="text-sm font-semibold text-ink-strong">{orgUnitLabel(u)}</span>
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
  units,
  canManage,
  isStaff,
  onClose,
}: {
  unit: OrgUnitView;
  units: OrgUnitView[];
  canManage: boolean;
  isStaff: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [managerId, setManagerId] = useState(unit.managerEmployeeId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(unit.name);
  const [unitType, setUnitType] = useState<OrgUnitType>(unit.unitType as OrgUnitType);
  const [parentId, setParentId] = useState(unit.parentId ?? '');
  const [shortName, setShortName] = useState(unit.shortName ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reassignTo, setReassignTo] = useState('');

  const save = useMutation({
    mutationFn: () =>
      api(`/org-units/${unit.id}`, {
        method: 'PATCH',
        body: {
          name,
          unitType,
          parentId: unitType === 'direction' ? null : parentId || null,
          shortName: unitType === 'direction' ? shortName.trim() || null : null,
        },
      }),
    onSuccess: () => {
      setError(null);
      setEditing(false);
      void queryClient.invalidateQueries({ queryKey: ['org-units'] });
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Enregistrement impossible.'),
  });

  const remove = useMutation({
    mutationFn: () =>
      api(`/org-units/${unit.id}${reassignTo ? `?reassignTo=${reassignTo}` : ''}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['org-units'] });
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Suppression impossible.'),
  });

  const members = useQuery({
    queryKey: ['org-unit-members', unit.id],
    queryFn: () => api<OrgUnitMember[]>(`/org-units/${unit.id}/members`),
  });
  // Le responsable doit travailler dans l'unité ou en dessous : proposer tout
  // le tenant, c'était offrir 69 noms pour 2 choix légaux — et faire découvrir
  // la règle par un 422. Même principe que pour le rattachement.
  const eligible = useQuery({
    queryKey: ['org-unit-eligible-managers', unit.id],
    queryFn: () => api<OrgUnitMember[]>(`/org-units/${unit.id}/eligible-managers`),
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
        <CardTitle>{orgUnitLabel(unit)}</CardTitle>
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
        {canManage && !editing && !confirmDelete ? (
          <div className="flex">
            <button
              type="button"
              className="ml-auto text-xs font-semibold text-primary hover:underline"
              onClick={() => {
                setError(null);
                setEditing(true);
              }}
            >
              Modifier
            </button>
          </div>
        ) : null}

        {/* Les faits de l'unité, dans le même vocabulaire que la fiche
            employé : on passe d'un écran à l'autre sans réapprendre à lire. */}
        <DataGrid>
          <DataBlock label="Type">{TYPE_LABELS[unit.unitType as OrgUnitType]}</DataBlock>
          <DataBlock label="Abrégé">{unit.shortName}</DataBlock>
          <DataBlock label="Rattachement">
            {units.find((u) => u.id === unit.parentId)?.name ?? 'Aucun — unité racine'}
          </DataBlock>
          <DataBlock label="Effectif">
            {unit.headcount} {unit.headcount > 1 ? 'personnes' : 'personne'}
          </DataBlock>
        </DataGrid>

        {editing ? (
          <div className="flex flex-col gap-3 rounded-md bg-bg p-3">
            <Field label="Nom" htmlFor={`edit-name-${unit.id}`} required>
              <Input
                id={`edit-name-${unit.id}`}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Type" htmlFor={`edit-type-${unit.id}`} required>
              <Select
                id={`edit-type-${unit.id}`}
                value={unitType}
                onChange={(e) => {
                  const next = e.target.value as OrgUnitType;
                  setUnitType(next);
                  // Une direction est racine : on efface le rattachement pour
                  // que le formulaire ne propose jamais un état invalide.
                  if (next === 'direction') setParentId('');
                }}
              >
                <option value="direction">Direction</option>
                <option value="department">Département</option>
                <option value="service">Service</option>
              </Select>
            </Field>
            {unitType === 'direction' ? (
              <Field
                label="Abrégé"
                htmlFor={`edit-short-${unit.id}`}
                hint="Facultatif — « DCH » pour Direction du Capital Humain."
              >
                <Input
                  id={`edit-short-${unit.id}`}
                  value={shortName}
                  maxLength={12}
                  placeholder="DCH"
                  onChange={(e) => setShortName(e.target.value.toUpperCase())}
                />
              </Field>
            ) : (
              <Field label="Rattachée à" htmlFor={`edit-parent-${unit.id}`} required>
                <Select
                  id={`edit-parent-${unit.id}`}
                  value={parentId}
                  onChange={(e) => setParentId(e.target.value)}
                >
                  <option value="">— Choisir</option>
                  {parentOptions(units, unitType, unit.id).map((u) => (
                    <option key={u.id} value={u.id}>
                      {pathLabel(units, u)}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <div className="flex gap-2">
              <Button loading={save.isPending} onClick={() => save.mutate()}>
                Enregistrer
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setEditing(false);
                  setError(null);
                  setName(unit.name);
                  setUnitType(unit.unitType as OrgUnitType);
                  setParentId(unit.parentId ?? '');
                  setShortName(unit.shortName ?? '');
                }}
              >
                Annuler
              </Button>
              <Button
                variant="ghost"
                className="ml-auto text-danger"
                onClick={() => {
                  setEditing(false);
                  setError(null);
                  setConfirmDelete(true);
                }}
              >
                Dissoudre
              </Button>
            </div>
          </div>
        ) : null}

        {confirmDelete ? (
          <div className="flex flex-col gap-3 rounded-md bg-danger-soft p-3">
            <p className="text-sm text-danger">
              Dissoudre « {unit.name} » ? L&apos;unité disparaît de l&apos;organigramme, mais
              l&apos;historique des affectations continue de la mentionner.
            </p>
            {unit.openAssignments > 0 ? (
              <Field
                label="Réaffecter les membres à"
                htmlFor={`reassign-${unit.id}`}
                hint={`${unit.openAssignments} affectation(s) pointent sur cette unité — suspendus et affectations à venir compris.`}
                required
              >
                <Select
                  id={`reassign-${unit.id}`}
                  value={reassignTo}
                  onChange={(e) => setReassignTo(e.target.value)}
                >
                  <option value="">— Choisir</option>
                  {units
                    .filter((u) => u.id !== unit.id)
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {pathLabel(units, u)}
                      </option>
                    ))}
                </Select>
              </Field>
            ) : null}
            <div className="flex gap-2">
              <Button
                variant="danger"
                loading={remove.isPending}
                disabled={unit.openAssignments > 0 && !reassignTo}
                onClick={() => remove.mutate()}
              >
                Confirmer la dissolution
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setConfirmDelete(false);
                  setError(null);
                }}
              >
                Annuler
              </Button>
            </div>
          </div>
        ) : null}

        {canManage ? (
          <div>
            <Field
              label="Responsable"
              htmlFor="unit-manager"
              hint={
                !eligible.isLoading && (eligible.data ?? []).length === 0
                  ? 'Personne n’est encore affecté à cette unité : affectez quelqu’un avant de le nommer responsable.'
                  : 'Parmi les personnes affectées à cette unité ou à une unité en dessous.'
              }
            >
              <div className="flex gap-2">
                <Select
                  id="unit-manager"
                  value={managerId}
                  onChange={(ev) => setManagerId(ev.target.value)}
                >
                  <option value="">— Aucun</option>
                  {(eligible.data ?? []).map((e) => (
                    <option key={e.employeeId} value={e.employeeId}>
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
            <EmptyState
              icon={<Icon name="group" size={22} />}
              title="Aucun membre aujourd'hui"
              description="Les affectations se posent depuis la fiche de chaque employé, sur la carte « Affectations »."
              className="py-8"
            />
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
  const selectedType = (form.watch('unitType') ?? 'direction') as OrgUnitType;
  const allowedParents = parentOptions(units, selectedType);

  const create = useMutation({
    mutationFn: (input: CreateOrgUnitInput) =>
      api<{ id: string }>('/org-units', { method: 'POST', body: input }),
    onSuccess: () => {
      form.reset({
        name: '',
        unitType: form.getValues('unitType'),
        parentId: undefined,
        shortName: undefined,
      });
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
            <Select
              id="unitType"
              {...form.register('unitType', {
                onChange: () => {
                  // Changer de type invalide le rattachement précédent : un
                  // parent valable pour un service ne l'est pas pour une
                  // direction. On repart d'un choix vide plutôt que d'envoyer
                  // une combinaison que le serveur refusera.
                  form.setValue('parentId', undefined);
                  form.setValue('shortName', undefined);
                },
              })}
            >
              <option value="direction">Direction</option>
              <option value="department">Département</option>
              <option value="service">Service</option>
            </Select>
          </Field>

          {selectedType === 'direction' ? (
            <Field
              label="Abrégé"
              htmlFor="shortName"
              error={form.formState.errors.shortName?.message}
              hint="Facultatif — « DCH » pour Direction du Capital Humain."
            >
              <Input
                id="shortName"
                placeholder="DCH"
                maxLength={12}
                {...form.register('shortName')}
                onChange={(e) => form.setValue('shortName', e.target.value.toUpperCase())}
              />
            </Field>
          ) : (
            <>
              <Field
                label="Rattachée à"
                htmlFor="parentId"
                error={form.formState.errors.parentId?.message}
                hint={
                  allowedParents.length === 0
                    ? `Créez d’abord ${selectedType === 'department' ? 'une direction' : 'une direction ou un département'}.`
                    : undefined
                }
                required
              >
                <Select id="parentId" {...form.register('parentId')}>
                  <option value="">— Choisir</option>
                  {allowedParents.map((u) => (
                    <option key={u.id} value={u.id}>
                      {pathLabel(units, u)}
                    </option>
                  ))}
                </Select>
              </Field>
              {parentHint &&
              ORG_UNIT_PARENT_TYPES[selectedType].includes(parentHint.unitType as OrgUnitType) ? (
                <button
                  type="button"
                  className="self-start text-xs text-primary hover:underline"
                  onClick={() => form.setValue('parentId', parentHint.id)}
                >
                  Rattacher à « {orgUnitLabel(parentHint)} »
                </button>
              ) : null}
            </>
          )}
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
