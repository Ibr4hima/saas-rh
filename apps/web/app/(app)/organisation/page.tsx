'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  createOrgUnitSchema,
  ORG_UNIT_PARENT_TYPES,
  ORG_UNIT_ROOT_TYPES,
  ORG_UNIT_TYPE_LABELS,
  orgUnitLabel,
  type CreateOrgUnitInput,
  type OrgUnitMember,
  type OrgUnitType,
  type OrgUnitView,
} from '@teranga/contracts';
import {
  Button,
  Card,
  CardContent,
  cn,
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
import { Modal } from '../../../components/modal';
import { Organigramme } from '../../../components/organigramme';

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

/** Tout le sous-arbre d'une unité, elle comprise. */
function sousArbre(units: OrgUnitView[], id: string): Set<string> {
  const dedans = new Set([id]);
  let bouge = true;
  while (bouge) {
    bouge = false;
    for (const u of units) {
      if (u.parentId && dedans.has(u.parentId) && !dedans.has(u.id)) {
        dedans.add(u.id);
        bouge = true;
      }
    }
  }
  return dedans;
}

/**
 * Parents possibles pour un type donné.
 *
 * Depuis qu'une direction peut relever d'une autre, la liste doit écarter le
 * SOUS-ARBRE de l'unité déplacée : se ranger sous sa propre fille ferait une
 * boucle. Le serveur la refuse, mais une option qu'on ne peut pas choisir n'a
 * rien à faire dans un menu.
 */
function parentOptions(units: OrgUnitView[], type: OrgUnitType, excludeId?: string) {
  const allowed = ORG_UNIT_PARENT_TYPES[type];
  const interdits = excludeId ? sousArbre(units, excludeId) : new Set<string>();
  return units.filter((u) => !interdits.has(u.id) && allowed.includes(u.unitType as OrgUnitType));
}

/** Le type le plus naturel pour une unité rattachée à celle-ci. */
function typeEnfantPropose(parent: OrgUnitView): OrgUnitType {
  if (parent.unitType === 'direction') return 'department';
  return 'service';
}

export default function OrganisationPage() {
  const me = useMe();
  const canManage = Boolean(me.data && ['admin', 'hr'].includes(me.data.role));
  const isStaff = Boolean(me.data && ['admin', 'hr', 'payroll'].includes(me.data.role));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Unité en cours de création : le parent visé, ou `racine` depuis l'en-tête. */
  const [creation, setCreation] = useState<{ parent: OrgUnitView | null } | null>(null);

  const units = useQuery({
    queryKey: ['org-units'],
    queryFn: () => api<OrgUnitView[]>('/org-units'),
  });
  const liste = units.data ?? [];
  const selected = liste.find((u) => u.id === selectedId) ?? null;

  return (
    <div className="mx-auto w-full max-w-[1400px]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[10.5px] font-extrabold tracking-[0.14em] text-primary uppercase">
          Organigramme
        </p>
        {canManage ? (
          <Button size="sm" onClick={() => setCreation({ parent: null })}>
            <Icon name="add" size={15} />
            Nouvelle unité
          </Button>
        ) : null}
      </div>

      <Card>
        {units.isLoading ? (
          <CardContent className="py-6">
            <Skeleton className="h-64 w-full" />
          </CardContent>
        ) : liste.length === 0 ? (
          <EmptyState
            className="py-14"
            icon={<Icon name="family_history" size={22} />}
            title="Aucune unité pour le moment"
            description="Commencez par la Direction Générale, puis rattachez-lui les directions métier."
          />
        ) : (
          <Organigramme
            unites={liste}
            selectionId={selectedId}
            actions={{
              onOuvrir: (u) => setSelectedId(u.id),
              ...(canManage ? { onAjouter: (parent: OrgUnitView) => setCreation({ parent }) } : {}),
            }}
          />
        )}
      </Card>

      {selected ? (
        <UnitPanel
          key={selected.id}
          unit={selected}
          units={liste}
          canManage={canManage}
          isStaff={isStaff}
          onClose={() => setSelectedId(null)}
        />
      ) : null}

      {creation ? (
        <FenetreNouvelleUnite
          units={liste}
          parent={creation.parent}
          onClose={() => setCreation(null)}
        />
      ) : null}
    </div>
  );
}

/** La fiche d'une unité : ses faits, son responsable, ses membres. */
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
          parentId: parentId || null,
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

  const direction = unit.unitType === 'direction';
  const parents = parentOptions(units, unitType, unit.id);

  return (
    <Modal
      open
      onClose={onClose}
      avatar={
        <span
          className={cn(
            'flex size-11 items-center justify-center rounded-[14px]',
            direction ? 'bg-primary/[0.10] text-primary' : 'bg-bg text-ink-muted',
          )}
        >
          <Icon name={direction ? 'family_history' : 'group'} size={20} />
        </span>
      }
      title={unit.name}
      subtitle={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-ink-muted">
          <span className="rounded-full bg-bg px-2 py-[3px] font-semibold text-ink">
            {TYPE_LABELS[unit.unitType as OrgUnitType]}
          </span>
          {unit.shortName ? (
            <span className="font-mono font-semibold">{unit.shortName}</span>
          ) : null}
          <span>·</span>
          <span>
            {units.find((u) => u.id === unit.parentId)
              ? `Rattachée à ${orgUnitLabel(units.find((u) => u.id === unit.parentId)!)}`
              : 'Au sommet de l’organigramme'}
          </span>
        </span>
      }
      maxWidth="max-w-2xl"
      footer={
        canManage && !editing && !confirmDelete ? (
          <div className="flex w-full items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => {
                setError(null);
                setConfirmDelete(true);
              }}
              className="text-[12px] font-semibold text-ink-muted transition-colors hover:text-danger"
            >
              Dissoudre l’unité
            </button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setError(null);
                setEditing(true);
              }}
            >
              Modifier
            </Button>
          </div>
        ) : null
      }
    >
      {editing ? (
        <Card>
          <CardContent className="flex flex-col gap-3 py-4">
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
                  // Changer de type invalide le rattachement : un parent
                  // valable pour un service ne l'est pas pour une direction.
                  setParentId('');
                }}
              >
                <option value="direction">Direction</option>
                <option value="department">Département</option>
                <option value="service">Service</option>
              </Select>
            </Field>
            <Field
              label="Rattachée à"
              htmlFor={`edit-parent-${unit.id}`}
              hint={
                ORG_UNIT_ROOT_TYPES.includes(unitType)
                  ? 'Laissez vide pour une unité au sommet de l’organigramme.'
                  : undefined
              }
              required={!ORG_UNIT_ROOT_TYPES.includes(unitType)}
            >
              <Select
                id={`edit-parent-${unit.id}`}
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
              >
                <option value="">
                  {ORG_UNIT_ROOT_TYPES.includes(unitType) ? '— Au sommet' : '— Choisir'}
                </option>
                {parents.map((u) => (
                  <option key={u.id} value={u.id}>
                    {pathLabel(units, u)}
                  </option>
                ))}
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
            ) : null}
            <div className="flex gap-2">
              <Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>
                Enregistrer
              </Button>
              <Button
                size="sm"
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
            </div>
          </CardContent>
        </Card>
      ) : null}

      {confirmDelete ? (
        <Card className="border-danger/30">
          <CardContent className="flex flex-col gap-3 py-4">
            <p className="text-[12.5px] text-danger">
              Dissoudre « {unit.name} » ? L’unité disparaît de l’organigramme, mais l’historique des
              affectations continue de la mentionner.
            </p>
            {unit.attachedEmployees > 0 ? (
              <Field
                label="Réaffecter les membres à"
                htmlFor={`reassign-${unit.id}`}
                hint="Facultatif — suspendus et affectations à venir compris."
              >
                <Select
                  id={`reassign-${unit.id}`}
                  value={reassignTo}
                  onChange={(e) => setReassignTo(e.target.value)}
                >
                  <option value="">— Aucune : les détacher</option>
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
            {/* Détacher n'est pas refusé, mais cela ne doit pas se faire par
                surprise : on dit combien de personnes y perdent leur unité, et
                ce qu'elles gardent. */}
            {unit.attachedEmployees > 0 && !reassignTo ? (
              <p className="rounded-md bg-warning-soft px-3 py-2 text-[12px] text-warning">
                {unit.attachedEmployees === 1
                  ? '1 personne n’aura plus d’unité de rattachement : son poste, son dossier et son historique sont conservés, et vous pourrez la rattacher ailleurs depuis sa fiche.'
                  : `${unit.attachedEmployees} personnes n’auront plus d’unité de rattachement : leur poste, leur dossier et leur historique sont conservés, et vous pourrez les rattacher ailleurs depuis leur fiche.`}
              </p>
            ) : null}
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="danger"
                loading={remove.isPending}
                onClick={() => remove.mutate()}
              >
                Confirmer la dissolution
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setConfirmDelete(false);
                  setError(null);
                }}
              >
                Annuler
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="py-4">
          <DataGrid>
            <DataBlock label="Effectif">
              {unit.headcount} {unit.headcount > 1 ? 'personnes' : 'personne'}
            </DataBlock>
            <DataBlock label="Responsable">
              {unit.managerName ? (
                <>
                  {unit.managerName}
                  {unit.managerPosition ? (
                    <span className="text-ink-muted"> — {unit.managerPosition}</span>
                  ) : null}
                </>
              ) : null}
            </DataBlock>
          </DataGrid>

          {canManage ? (
            <div className="mt-3 border-t border-line-soft pt-3">
              <Field
                label="Désigner un responsable"
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
                    size="sm"
                    variant="secondary"
                    loading={saveManager.isPending}
                    disabled={(unit.managerEmployeeId ?? '') === managerId}
                    onClick={() => saveManager.mutate()}
                  >
                    OK
                  </Button>
                </div>
              </Field>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-4">
          <p className="text-[9.5px] font-extrabold tracking-[0.12em] text-ink-muted uppercase">
            Membres
          </p>
          {members.isLoading ? (
            <Skeleton className="mt-2 h-12 w-full" />
          ) : (members.data ?? []).length === 0 ? (
            <p className="mt-2 text-[12.5px] text-ink-muted/70">
              Aucun membre aujourd’hui. Les affectations se posent depuis la fiche de chaque
              employé, sur la carte « Affectations ».
            </p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {members.data!.map((m) => (
                <li key={m.employeeId} className="flex items-center gap-2.5 text-[12.5px]">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[11px] font-bold text-primary">
                    {m.givenName[0]}
                    {m.familyName[0]}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {isStaff ? (
                      <Link
                        href={`/employees/${m.employeeId}`}
                        className="font-semibold text-ink-strong hover:underline"
                      >
                        {m.givenName} {m.familyName}
                      </Link>
                    ) : (
                      <span className="font-semibold text-ink-strong">
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
        </CardContent>
      </Card>

      {error ? (
        <p className="rounded-md bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</p>
      ) : null}
    </Modal>
  );
}

/**
 * Créer une unité, depuis le « + » d'un bloc ou depuis l'en-tête.
 *
 * Ouverte depuis un bloc, la fenêtre arrive DÉJÀ REMPLIE : le parent est
 * celui qu'on a survolé, et le type est celui qu'on attend en dessous — un
 * département sous une direction, un service sous un département. C'est le
 * geste entier qui compte : on montre où l'on veut accrocher, on tape un nom.
 */
function FenetreNouvelleUnite({
  units,
  parent,
  onClose,
}: {
  units: OrgUnitView[];
  parent: OrgUnitView | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<CreateOrgUnitInput>({
    resolver: zodResolver(createOrgUnitSchema),
    defaultValues: {
      name: '',
      unitType: parent ? typeEnfantPropose(parent) : 'direction',
      parentId: parent?.id,
    },
  });
  const selectedType = (form.watch('unitType') ?? 'direction') as OrgUnitType;
  const allowedParents = parentOptions(units, selectedType);
  const racinePossible = ORG_UNIT_ROOT_TYPES.includes(selectedType);

  // Le champ prend le focus à l'ouverture : la fenêtre n'attend qu'un nom.
  useEffect(() => {
    const t = setTimeout(() => document.getElementById('new-unit-name')?.focus(), 60);
    return () => clearTimeout(t);
  }, []);

  const create = useMutation({
    mutationFn: (input: CreateOrgUnitInput) =>
      api<{ id: string }>('/org-units', { method: 'POST', body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['org-units'] });
      onClose();
    },
    onError: (err) =>
      setServerError(err instanceof ApiError ? err.message : 'Création impossible.'),
  });

  const soumettre = form.handleSubmit((v) => {
    setServerError(null);
    create.mutate({ ...v, parentId: v.parentId || undefined });
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Nouvelle unité"
      subtitle={parent ? `Rattachée à ${orgUnitLabel(parent)}` : undefined}
      maxWidth="max-w-lg"
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button size="sm" loading={create.isPending} onClick={() => void soumettre()}>
            Créer
          </Button>
        </div>
      }
    >
      <Card>
        <CardContent className="py-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void soumettre();
            }}
            className="flex flex-col gap-3.5"
            noValidate
          >
            <Field
              label="Nom"
              htmlFor="new-unit-name"
              error={form.formState.errors.name?.message}
              required
            >
              <Input
                id="new-unit-name"
                placeholder="Ex : Direction des Ressources Humaines"
                {...form.register('name')}
              />
            </Field>
            <Field label="Type" htmlFor="new-unit-type" required>
              <Select
                id="new-unit-type"
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
            <Field
              label="Rattachée à"
              htmlFor="new-unit-parent"
              error={form.formState.errors.parentId?.message}
              hint={
                racinePossible
                  ? 'Laissez vide pour la placer au sommet — la Direction Générale.'
                  : allowedParents.length === 0
                    ? `Créez d’abord ${selectedType === 'department' ? 'une direction' : 'une direction ou un département'}.`
                    : undefined
              }
              required={!racinePossible}
            >
              <Select id="new-unit-parent" {...form.register('parentId')}>
                <option value="">{racinePossible ? '— Au sommet' : '— Choisir'}</option>
                {allowedParents.map((u) => (
                  <option key={u.id} value={u.id}>
                    {pathLabel(units, u)}
                  </option>
                ))}
              </Select>
            </Field>
            {selectedType === 'direction' ? (
              <Field
                label="Abrégé"
                htmlFor="new-unit-short"
                error={form.formState.errors.shortName?.message}
                hint="Facultatif — « DCH » pour Direction du Capital Humain."
              >
                <Input
                  id="new-unit-short"
                  placeholder="DCH"
                  maxLength={12}
                  {...form.register('shortName')}
                  onChange={(e) => form.setValue('shortName', e.target.value.toUpperCase())}
                />
              </Field>
            ) : null}
            {serverError ? (
              <p className="rounded-md bg-danger-soft px-3 py-2 text-[12.5px] text-danger">
                {serverError}
              </p>
            ) : null}
          </form>
        </CardContent>
      </Card>
    </Modal>
  );
}
