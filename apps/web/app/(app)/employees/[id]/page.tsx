'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import type {
  BalanceView,
  EmployeeDetail,
  EmployeeHistoryEntry,
  InvitableRole,
  InviteResult,
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
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@teranga/ui';
import { api, ApiError, apiUrl } from '../../../../lib/api';
import { ID_DOCUMENT_LABELS, maritalLabels, SEX_LABELS } from '../../../../lib/person';
import { formatDate, useMe } from '../../../../lib/hooks';
import type { OrgUnit } from '@teranga/contracts';

const STATUS_LABELS: Record<string, string> = {
  active: 'Actif',
  suspended: 'Suspendu',
  terminated: 'Sorti',
};
const CONTRACT_LABELS: Record<string, string> = {
  cdi: 'CDI',
  cdd: 'CDD',
  stage: 'Stage',
  consultant: 'Consultant',
  detachement: 'Détachement',
};
const TABLE_LABELS: Record<string, string> = {
  employees: 'Dossier employé',
  persons: 'État civil',
  assignments: 'Affectation',
  contracts: 'Contrat',
};

/** La borne haute d'un daterange est exclusive : le dernier jour est la veille. */
function lastDay(exclusiveEnd: string): string {
  const d = new Date(`${exclusiveEnd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="text-sm text-ink-strong">{value ?? '—'}</dd>
    </div>
  );
}

export default function EmployeePage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const canSeeHistory = me.data && ['admin', 'hr'].includes(me.data.role);

  const detail = useQuery({
    queryKey: ['employee', id],
    queryFn: () => api<EmployeeDetail>(`/employees/${id}`),
  });
  const history = useQuery({
    queryKey: ['employee-history', id],
    queryFn: () => api<EmployeeHistoryEntry[]>(`/employees/${id}/history`),
    enabled: Boolean(canSeeHistory),
  });

  if (detail.isLoading) {
    return (
      <div className="mx-auto max-w-4xl">
        <Skeleton className="mb-4 h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (detail.isError) {
    const message =
      detail.error instanceof ApiError ? detail.error.message : 'Chargement impossible.';
    return <p className="text-sm text-danger">{message}</p>;
  }
  const e = detail.data!;
  const current = e.assignments.find((a) => a.current);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link href="/employees" className="text-sm text-ink-muted hover:text-ink">
            ← Employés
          </Link>
          <div className="mt-1 flex items-center gap-3">
            <h1 className="text-xl font-bold text-ink-strong">
              {e.person.givenName} {e.person.familyName}
            </h1>
            <Badge
              tone={
                e.status === 'active' ? 'success' : e.status === 'suspended' ? 'warning' : 'neutral'
              }
            >
              {STATUS_LABELS[e.status] ?? e.status}
            </Badge>
          </div>
          <p className="text-sm text-ink-muted">
            {current
              ? `${current.positionTitle}${current.orgUnitName ? ` · ${current.orgUnitName}` : ''} · `
              : ''}
            Matricule <span className="font-mono">{e.employeeNumber}</span> · Embauché·e le{' '}
            {formatDate(e.hiredOn)}
          </p>
        </div>
        {canSeeHistory ? (
          <div className="flex shrink-0 gap-2">
            {e.status === 'active' ? (
              <a href={apiUrl(`/employees/${e.id}/attestation`)}>
                <Button variant="secondary">Attestation de travail</Button>
              </a>
            ) : null}
            <Link href={`/employees/${e.id}/modifier`}>
              <Button>Modifier</Button>
            </Link>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>État civil et contact</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
              <Info label="Sexe" value={e.person.gender ? SEX_LABELS[e.person.gender] : null} />
              <Info
                label="Naissance"
                value={
                  e.person.birthDate
                    ? `${formatDate(e.person.birthDate)}${e.person.birthPlace ? ` (${e.person.birthPlace})` : ''}`
                    : null
                }
              />
              <Info
                label="Situation matrimoniale"
                value={
                  e.person.maritalStatus
                    ? maritalLabels(e.person.gender)[e.person.maritalStatus]
                    : null
                }
              />
              <Info label="Nationalité" value={e.person.nationality} />
              <Info
                label="Pièce d'identité"
                value={
                  e.person.nationalId || e.person.idDocumentType ? (
                    <span>
                      {e.person.idDocumentType
                        ? (ID_DOCUMENT_LABELS[e.person.idDocumentType] ?? e.person.idDocumentType)
                        : 'Pièce'}
                      {e.person.nationalId ? (
                        <>
                          {' '}
                          n° <span className="font-mono">{e.person.nationalId}</span>
                        </>
                      ) : null}
                      {e.person.idDocumentExpiresOn
                        ? ` · expire le ${formatDate(e.person.idDocumentExpiresOn)}`
                        : ''}
                    </span>
                  ) : null
                }
              />
              <Info label="Téléphone" value={e.person.phone} />
              <Info label="Email personnel" value={e.person.personalEmail} />
              <Info label="Email professionnel" value={e.workEmail} />
              <Info label="Téléphone professionnel" value={e.workPhone} />
              <Info
                label="Adresse"
                value={
                  e.person.addressLine
                    ? `${e.person.addressLine}${e.person.city ? `, ${e.person.city}` : ''}`
                    : e.person.city
                }
              />
              <Info
                label="Contact d'urgence"
                value={
                  e.person.emergencyContactName
                    ? `${e.person.emergencyContactName}${e.person.emergencyContactPhone ? ` — ${e.person.emergencyContactPhone}` : ''}`
                    : null
                }
              />
            </dl>
          </CardContent>
        </Card>

        <AssignmentsCard
          employeeId={e.id}
          assignments={e.assignments}
          canManage={Boolean(canSeeHistory)}
        />

        <Card>
          <CardHeader>
            <CardTitle>Contrats</CardTitle>
          </CardHeader>
          {e.contracts.length === 0 ? (
            <CardContent>
              <p className="text-sm text-ink-muted">Aucun contrat enregistré.</p>
            </CardContent>
          ) : (
            <Table>
              <THead>
                <tr>
                  <Th>Type</Th>
                  <Th>Début</Th>
                  <Th>Fin</Th>
                  <Th>Fin d&apos;essai</Th>
                </tr>
              </THead>
              <TBody>
                {e.contracts.map((c) => (
                  <Tr key={c.id}>
                    <Td className="font-medium text-ink-strong">
                      {CONTRACT_LABELS[c.contractType] ?? c.contractType}
                    </Td>
                    <Td>{formatDate(c.startDate)}</Td>
                    <Td>{c.endDate ? formatDate(c.endDate) : '—'}</Td>
                    <Td>{c.trialPeriodEnd ? formatDate(c.trialPeriodEnd) : '—'}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>

        {canSeeHistory ? <PortalCard employeeId={e.id} portal={e.portal} /> : null}

        <BalancesCard employeeId={e.id} canEdit={Boolean(canSeeHistory)} />

        {canSeeHistory ? (
          <Card>
            <CardHeader>
              <CardTitle>Historique des modifications</CardTitle>
            </CardHeader>
            <CardContent>
              {history.isLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : !history.data || history.data.length === 0 ? (
                <p className="text-sm text-ink-muted">Aucune modification enregistrée.</p>
              ) : (
                <ol className="flex flex-col gap-3">
                  {history.data.map((h) => (
                    <li key={h.id} className="flex items-baseline gap-3 text-sm">
                      <span className="shrink-0 font-mono text-xs text-ink-muted">
                        {new Date(h.occurredAt).toLocaleString('fr-FR', {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      <span className="text-ink">
                        {h.action === 'INSERT'
                          ? 'Création'
                          : h.action === 'UPDATE'
                            ? 'Modification'
                            : 'Suppression'}{' '}
                        · {TABLE_LABELS[h.tableName] ?? h.tableName}
                        {h.changedFields.length > 0 ? (
                          <span className="text-ink-muted"> ({h.changedFields.join(', ')})</span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function AssignmentsCard({
  employeeId,
  assignments,
  canManage,
}: {
  employeeId: string;
  assignments: EmployeeDetail['assignments'];
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [positionTitle, setPositionTitle] = useState('');
  const [orgUnitId, setOrgUnitId] = useState('');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);

  const orgUnits = useQuery({
    queryKey: ['org-units'],
    queryFn: () => api<OrgUnit[]>('/org-units'),
    enabled: canManage && open,
  });

  const create = useMutation({
    mutationFn: () =>
      api(`/employees/${employeeId}/assignments`, {
        method: 'POST',
        body: { positionTitle, orgUnitId: orgUnitId || undefined, startDate },
      }),
    onSuccess: () => {
      setOpen(false);
      setPositionTitle('');
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['employee', employeeId] });
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Enregistrement impossible.'),
  });

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>Affectations</CardTitle>
        {canManage ? (
          <Button variant="secondary" size="sm" onClick={() => setOpen(!open)}>
            {open ? 'Fermer' : 'Nouvelle affectation'}
          </Button>
        ) : null}
      </CardHeader>
      {open ? (
        <CardContent className="border-b border-line-soft">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Field label="Nouveau poste" htmlFor="asg-title" required>
                <Input
                  id="asg-title"
                  placeholder="Ex : Chef de service études"
                  value={positionTitle}
                  onChange={(ev) => setPositionTitle(ev.target.value)}
                />
              </Field>
            </div>
            <div className="flex-1">
              <Field label="Unité" htmlFor="asg-unit">
                <Select
                  id="asg-unit"
                  value={orgUnitId}
                  onChange={(ev) => setOrgUnitId(ev.target.value)}
                >
                  <option value="">—</option>
                  {orgUnits.data?.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="w-full sm:w-44">
              <Field label="À compter du" htmlFor="asg-start" required>
                <Input
                  id="asg-start"
                  type="date"
                  value={startDate}
                  onChange={(ev) => setStartDate(ev.target.value)}
                />
              </Field>
            </div>
            <Button
              onClick={() => create.mutate()}
              loading={create.isPending}
              disabled={!positionTitle.trim() || !startDate}
            >
              Enregistrer
            </Button>
          </div>
          <p className="mt-2 text-xs text-ink-muted">
            L&apos;affectation en cours sera automatiquement clôturée la veille — l&apos;historique
            reste intact.
          </p>
          {error ? (
            <p className="mt-2 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
          ) : null}
        </CardContent>
      ) : null}
      {assignments.length === 0 ? (
        <CardContent>
          <p className="text-sm text-ink-muted">Aucune affectation enregistrée.</p>
        </CardContent>
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>Poste</Th>
              <Th>Unité</Th>
              <Th>Du</Th>
              <Th>Au</Th>
              <Th />
            </tr>
          </THead>
          <TBody>
            {assignments.map((a) => (
              <Tr key={a.id}>
                <Td className="font-medium text-ink-strong">{a.positionTitle}</Td>
                <Td>{a.orgUnitName ?? '—'}</Td>
                <Td className="whitespace-nowrap">{formatDate(a.validFrom)}</Td>
                <Td className="whitespace-nowrap">
                  {a.validTo ? formatDate(lastDay(a.validTo)) : a.current ? "aujourd'hui" : '—'}
                </Td>
                <Td>
                  {a.current ? (
                    <Badge tone="primary">En cours</Badge>
                  ) : !a.validTo ? (
                    <Badge tone="warning">À venir</Badge>
                  ) : null}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}

function BalancesCard({ employeeId, canEdit }: { employeeId: string; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const year = new Date().getFullYear();
  const [edits, setEdits] = useState<Record<string, string>>({});

  const balances = useQuery({
    queryKey: ['balances', employeeId, String(year)],
    queryFn: () => api<BalanceView[]>(`/employees/${employeeId}/balances?year=${year}`),
  });
  const save = useMutation({
    mutationFn: (b: { absenceTypeId: string; entitledDays: number }) =>
      api('/balances', {
        method: 'PUT',
        body: { employeeId, absenceTypeId: b.absenceTypeId, year, entitledDays: b.entitledDays },
      }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['balances', employeeId, String(year)] }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Congés {year}</CardTitle>
      </CardHeader>
      {balances.isLoading ? (
        <CardContent>
          <Skeleton className="h-16 w-full" />
        </CardContent>
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>Type</Th>
              <Th>Droit (jours)</Th>
              <Th>Pris</Th>
              <Th>En attente</Th>
              <Th>Restant</Th>
              {canEdit ? <Th /> : null}
            </tr>
          </THead>
          <TBody>
            {balances.data?.map((b) => {
              const edited = edits[b.absenceTypeId];
              return (
                <Tr key={b.absenceTypeId}>
                  <Td className="font-medium text-ink-strong">{b.absenceTypeName}</Td>
                  <Td>
                    {b.deductsBalance ? (
                      canEdit ? (
                        <Input
                          type="number"
                          min={0}
                          step="0.5"
                          value={edited ?? String(b.entitledDays)}
                          onChange={(ev) =>
                            setEdits({ ...edits, [b.absenceTypeId]: ev.target.value })
                          }
                          className="h-8 w-24"
                        />
                      ) : (
                        b.entitledDays
                      )
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td className="font-mono">{b.takenDays}</Td>
                  <Td className="font-mono">{b.pendingDays}</Td>
                  <Td className="font-mono font-semibold">
                    {b.deductsBalance ? b.remainingDays : '—'}
                  </Td>
                  {canEdit ? (
                    <Td>
                      {b.deductsBalance &&
                      edited !== undefined &&
                      Number(edited) !== b.entitledDays ? (
                        <Button
                          size="sm"
                          loading={save.isPending}
                          onClick={() =>
                            save.mutate({
                              absenceTypeId: b.absenceTypeId,
                              entitledDays: Number(edited),
                            })
                          }
                        >
                          Enregistrer
                        </Button>
                      ) : null}
                    </Td>
                  ) : null}
                </Tr>
              );
            })}
          </TBody>
        </Table>
      )}
    </Card>
  );
}

const PORTAL_ROLE_LABELS: Record<string, string> = {
  hr: 'RH',
  payroll: 'Gestionnaire de paie',
  manager: 'Manager',
  employee: 'Employé',
  admin: 'Administrateur',
};

function PortalCard({
  employeeId,
  portal,
}: {
  employeeId: string;
  portal: EmployeeDetail['portal'];
}) {
  const queryClient = useQueryClient();
  const [role, setRole] = useState<InvitableRole>('employee');
  const [invite, setInvite] = useState<InviteResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = useMutation({
    mutationFn: () =>
      api<InviteResult>(`/employees/${employeeId}/invite`, { method: 'POST', body: { role } }),
    onSuccess: (r) => {
      setInvite(r);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['employee', employeeId] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Génération impossible.'),
  });

  const inviteUrl = invite ? `${window.location.origin}${invite.invitePath}` : null;

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>Accès au portail</CardTitle>
        {portal.status === 'active' ? (
          <Badge tone="success">
            Compte actif{portal.role ? ` · ${PORTAL_ROLE_LABELS[portal.role] ?? portal.role}` : ''}
          </Badge>
        ) : portal.status === 'invited' ? (
          <Badge tone="warning">Invitation en cours</Badge>
        ) : (
          <Badge tone="neutral">Aucun accès</Badge>
        )}
      </CardHeader>
      {portal.status === 'active' ? (
        <CardContent>
          <p className="text-sm text-ink-muted">
            Cet employé se connecte au portail et gère ses demandes lui-même.
          </p>
        </CardContent>
      ) : (
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-ink-muted">
            Générez un lien d&apos;invitation à lui transmettre (email, WhatsApp…) : il choisira son
            mot de passe et son compte sera relié à ce dossier.
          </p>
          <div className="flex items-end gap-3">
            <div className="w-56">
              <Field label="Rôle" htmlFor="invite-role">
                <Select
                  id="invite-role"
                  value={role}
                  onChange={(ev) => setRole(ev.target.value as InvitableRole)}
                >
                  <option value="employee">Employé</option>
                  <option value="manager">Manager</option>
                  <option value="payroll">Gestionnaire de paie</option>
                  <option value="hr">RH</option>
                </Select>
              </Field>
            </div>
            <Button onClick={() => generate.mutate()} loading={generate.isPending}>
              {portal.status === 'invited' ? 'Régénérer le lien' : "Générer le lien d'invitation"}
            </Button>
          </div>
          {error ? (
            <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
          ) : null}
          {inviteUrl ? (
            <div className="flex items-center gap-2">
              <Input readOnly value={inviteUrl} className="font-mono text-xs" />
              <Button
                variant="secondary"
                onClick={async () => {
                  await navigator.clipboard.writeText(inviteUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? 'Copié ✓' : 'Copier'}
              </Button>
            </div>
          ) : null}
          {invite ? (
            <p className="text-xs text-ink-muted">
              Envoyé à {invite.email} · valable 7 jours · rôle{' '}
              {PORTAL_ROLE_LABELS[invite.role] ?? invite.role}
            </p>
          ) : null}
        </CardContent>
      )}
    </Card>
  );
}
