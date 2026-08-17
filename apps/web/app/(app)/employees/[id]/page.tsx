'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { EmployeeDetail, EmployeeHistoryEntry } from '@teranga/contracts';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@teranga/ui';
import { api, ApiError } from '../../../../lib/api';
import { formatDate, useMe } from '../../../../lib/hooks';

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
const MARITAL_LABELS: Record<string, string> = {
  single: 'Célibataire',
  married: 'Marié·e',
  divorced: 'Divorcé·e',
  widowed: 'Veuf·ve',
};
const TABLE_LABELS: Record<string, string> = {
  employees: 'Dossier employé',
  persons: 'État civil',
  assignments: 'Affectation',
  contracts: 'Contrat',
};

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
      <div className="mb-6">
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

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>État civil et contact</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
              <Info
                label="Genre"
                value={
                  e.person.gender === 'female'
                    ? 'Femme'
                    : e.person.gender === 'male'
                      ? 'Homme'
                      : null
                }
              />
              <Info
                label="Naissance"
                value={
                  e.person.birthDate
                    ? `${formatDate(e.person.birthDate)}${e.person.birthPlace ? ` à ${e.person.birthPlace}` : ''}`
                    : null
                }
              />
              <Info
                label="Situation familiale"
                value={e.person.maritalStatus ? MARITAL_LABELS[e.person.maritalStatus] : null}
              />
              <Info label="Nationalité" value={e.person.nationality} />
              <Info
                label="N° CNI"
                value={
                  e.person.nationalId ? (
                    <span className="font-mono">{e.person.nationalId}</span>
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

        <Card>
          <CardHeader>
            <CardTitle>Affectations</CardTitle>
          </CardHeader>
          {e.assignments.length === 0 ? (
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
                {e.assignments.map((a) => (
                  <Tr key={a.id}>
                    <Td className="font-medium text-ink-strong">{a.positionTitle}</Td>
                    <Td>{a.orgUnitName ?? '—'}</Td>
                    <Td className="whitespace-nowrap">{formatDate(a.validFrom)}</Td>
                    <Td className="whitespace-nowrap">
                      {a.validTo ? formatDate(a.validTo) : "aujourd'hui"}
                    </Td>
                    <Td>{a.current ? <Badge tone="primary">En cours</Badge> : null}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>

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
