'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
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
  cn,
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
  DataBlock,
  DataGrid,
  Th,
  THead,
  Tr,
} from '@teranga/ui';
import { api, ApiError, apiUrl } from '../../../../lib/api';
import { EmployeeDocumentsCard } from '../../../../components/employee-documents-card';
import { nationalityLabel } from '@teranga/contracts';
import { ProfileChangeCard } from '../../../../components/profile-change-card';
import { DocumentRequestRow } from '../../../../components/document-request-list';
import { EmployeeEditModal } from '../../../../components/employee-edit-modal';
import { usePageTitle } from '../../../../components/page-title';
import { ID_DOCUMENT_LABELS, maritalLabels, SEX_LABELS } from '../../../../lib/person';
import { formatDate, useMe } from '../../../../lib/hooks';
import type { DocumentRequestView, OrgUnit } from '@teranga/contracts';
import { LoadFailure } from '../../../../components/load-failure';

const STATUS_LABELS: Record<string, string> = {
  active: 'Actif',
  archived: 'Archivé',
};
const CONTRACT_LABELS: Record<string, string> = {
  cdi: 'CDI',
  cdd: 'CDD',
  stage: 'Stage',
  consultant: 'Consultant',
  detachement: 'Détachement',
};
const ACTION_LABELS: Record<string, string> = {
  INSERT: 'Création',
  UPDATE: 'Modification',
  DELETE: 'Suppression',
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

const initials = (given: string, family: string) =>
  `${given[0] ?? ''}${family[0] ?? ''}`.toUpperCase();

/** Ancienneté en clair : « 3 ans et 2 mois », pas une date à soustraire. */
function seniority(hiredOn: string): string {
  const start = new Date(`${hiredOn}T12:00:00Z`);
  const months = Math.max(0, (Date.now() - start.getTime()) / (1000 * 60 * 60 * 24 * 30.44));
  const years = Math.floor(months / 12);
  const rest = Math.floor(months % 12);
  if (years === 0) return rest <= 1 ? "moins d'un mois" : `${rest} mois`;
  const y = `${years} an${years > 1 ? 's' : ''}`;
  return rest === 0 ? y : `${y} et ${rest} mois`;
}

/**
 * Une donnée du dossier : intitulé discret, valeur lisible.
 *
 * Pas une pastille. Les pastilles conviennent aux QUELQUES repères qu'on
 * cherche du regard — matricule, direction, ancienneté — et c'est ce que la
 * bande de tête en fait. Ici, treize champs en pastilles donnaient un mur de
 * cadres où plus rien ne ressortait ; un filet et de l'air suffisent, et
 * l'état civil se lit comme ce qu'il est : un registre.
 */
function Donnee({
  label,
  children,
  large,
}: {
  label: string;
  children?: React.ReactNode;
  /** Occupe deux colonnes — une adresse ne se coupe pas en trois. */
  large?: boolean;
}) {
  const vide = children === null || children === undefined || children === '';
  return (
    <div
      className={cn('min-w-0 border-t border-line-soft pt-2.5 pb-0.5', large && 'sm:col-span-2')}
    >
      <dt className="text-[9.5px] font-extrabold tracking-[0.11em] text-ink-muted uppercase">
        {label}
      </dt>
      <dd
        className={cn(
          'mt-1 text-[13.5px] leading-snug font-semibold break-words',
          vide ? 'text-ink-muted/70' : 'text-ink-strong',
        )}
      >
        {vide ? '—' : children}
      </dd>
    </div>
  );
}

/** Un groupe de données, sous son intitulé de marque. */
function Groupe({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[10px] font-extrabold tracking-[0.14em] text-primary uppercase">
        {titre}
      </h3>
      <dl className="grid grid-cols-1 gap-x-7 sm:grid-cols-2">{children}</dl>
    </section>
  );
}

/**
 * Ce qu'il advient d'une pièce d'identité qui arrive à terme.
 *
 * La date seule ne dit rien à qui ne compte pas : « 10 avr. 2030 » se lit
 * comme « c'est bon ». Le rappel n'apparaît que quand il y a lieu de s'en
 * occuper — trois mois avant, puis après.
 */
function Peremption({ date }: { date: string }) {
  const jours = Math.round((new Date(`${date}T12:00:00Z`).getTime() - Date.now()) / 86_400_000);
  if (jours > 90) return null;
  return (
    <span
      className={cn(
        'ml-1.5 text-[11.5px] font-bold',
        jours < 0 ? 'text-danger' : 'text-accent-text',
      )}
    >
      {jours < 0 ? '· expirée' : jours === 0 ? "· expire aujourd'hui" : `· dans ${jours} j`}
    </span>
  );
}

export default function EmployeePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  // Même convention que la création : l'ouverture vit dans l'URL, si bien que
  // le bouton de la barre supérieure reste un lien et que Retour referme.
  const editOpen = useSearchParams().get('modifier') !== null;
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

  // Le bandeau annonce QUI, pas « Fiche employé ». Null tant que le dossier
  // charge : le titre déduit du chemin tient la place sans clignoter.
  const person = detail.data?.person;
  usePageTitle(person ? `${person.givenName} ${person.familyName}` : null);

  if (detail.isLoading) {
    return (
      <div className="mx-auto max-w-4xl">
        <Skeleton className="mb-4 h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (detail.isError) {
    return <LoadFailure error={detail.error} onRetry={() => void detail.refetch()} />;
  }
  const e = detail.data!;
  const current = e.assignments.find((a) => a.current);

  return (
    <div className="mx-auto w-full max-w-6xl">
      <EmployeeEditModal
        open={editOpen}
        employeeId={id}
        onClose={() => router.replace(`/employees/${id}`)}
      />
      <Link
        href="/employees"
        className="mb-3 inline-flex items-center gap-1 text-[11.5px] font-semibold text-ink-muted transition-colors hover:text-primary"
      >
        ← Gestion du personnel
      </Link>

      {/* ———— Bande d'identité ————
          Tout ce qui permet de reconnaître le dossier en une seconde : le
          visage (à défaut, les initiales), le nom, la fonction, et les quatre
          repères qu'on cherche systématiquement. Le reste de la fiche
          approfondit ; cette bande, elle, identifie. */}
      <Card className="mb-4 px-4 py-4 sm:px-[18px]">
        <div className="flex flex-wrap items-start gap-4">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary/[0.09] text-[17px] font-bold text-primary">
            {initials(e.person.givenName, e.person.familyName)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-[20px] leading-tight font-bold tracking-[-0.01em] text-ink-strong">
                {e.person.givenName} {e.person.familyName}
              </h1>
              <Badge tone={e.status === 'active' ? 'success' : 'neutral'}>
                {STATUS_LABELS[e.status] ?? e.status}
              </Badge>
              {/* Un dossier archivé porte sa date : c'est elle qui dit depuis
                  combien de temps on le conserve, et donc quand l'effacer. */}
              {e.archivedAt ? (
                <span className="text-[11.5px] text-ink-muted">
                  depuis le {formatDate(e.archivedAt)}
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 truncate text-[12.5px] text-ink-muted">
              {current?.positionTitle ?? 'Poste à préciser'}
              {current?.orgUnitName ? ` · ${current.orgUnitName}` : ''}
            </p>
          </div>
          {canSeeHistory && e.status === 'active' ? (
            <a href={apiUrl(`/employees/${e.id}/attestation`)} target="_blank" rel="noreferrer">
              <Button variant="secondary">Attestation de travail</Button>
            </a>
          ) : null}
        </div>

        <DataGrid className="mt-4 @[52rem]:grid-cols-4">
          <DataBlock label="Matricule">
            <span className="font-mono">{e.employeeNumber}</span>
          </DataBlock>
          <DataBlock label="Direction">{current?.orgUnitName}</DataBlock>
          <DataBlock label="Ancienneté">
            {seniority(e.hiredOn)}
            <span className="font-normal text-ink-muted"> · depuis {formatDate(e.hiredOn)}</span>
          </DataBlock>
          <DataBlock label="Email professionnel">{e.workEmail}</DataBlock>
        </DataGrid>
      </Card>

      {/* Deux colonnes sur grand écran : à gauche ce qui décrit la personne
          et son emploi, à droite ce qui s'administre — accès, soldes, traces.
          En une colonne, la fiche demandait quatre écrans de défilement. */}
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>État civil et contact</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              <Groupe titre="Identité">
                <Donnee label="Sexe">{e.person.gender ? SEX_LABELS[e.person.gender] : null}</Donnee>
                <Donnee label="Date de naissance">
                  {e.person.birthDate ? formatDate(e.person.birthDate) : null}
                </Donnee>
                <Donnee label="Pays de naissance">{e.person.birthPlace}</Donnee>
                <Donnee label="Nationalité">{nationalityLabel(e.person.nationality)}</Donnee>
                <Donnee label="Situation matrimoniale">
                  {e.person.maritalStatus
                    ? maritalLabels(e.person.gender)[e.person.maritalStatus]
                    : null}
                </Donnee>
              </Groupe>

              <Groupe titre="Pièce d'identité">
                <Donnee label="Type de pièce d'identité">
                  {e.person.idDocumentType
                    ? (ID_DOCUMENT_LABELS[e.person.idDocumentType] ?? e.person.idDocumentType)
                    : null}
                </Donnee>
                <Donnee label="Numéro de la pièce">
                  {e.person.nationalId ? (
                    <span className="font-mono">{e.person.nationalId}</span>
                  ) : null}
                </Donnee>
                <Donnee label="Date de délivrance">
                  {e.person.idDocumentIssuedOn ? formatDate(e.person.idDocumentIssuedOn) : null}
                </Donnee>
                <Donnee label="Date d'expiration">
                  {e.person.idDocumentExpiresOn ? (
                    <>
                      {formatDate(e.person.idDocumentExpiresOn)}
                      <Peremption date={e.person.idDocumentExpiresOn} />
                    </>
                  ) : null}
                </Donnee>
              </Groupe>

              <Groupe titre="Coordonnées">
                <Donnee label="Téléphone">{e.person.phone}</Donnee>
                <Donnee label="Téléphone professionnel">{e.workPhone}</Donnee>
                <Donnee label="Email personnel">{e.person.personalEmail}</Donnee>
                <Donnee label="Adresse" large>
                  {e.person.addressLine
                    ? `${e.person.addressLine}${e.person.city ? `, ${e.person.city}` : ''}`
                    : e.person.city}
                </Donnee>
              </Groupe>
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
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>

          {/* En tête des cartes de gauche : c'est ce qui attend une décision. */}
          {canSeeHistory ? <ProfileChangeCard employeeId={e.id} /> : null}

          {canSeeHistory ? <EmployeeDocumentsCard employeeId={e.id} /> : null}

          {canSeeHistory ? <DocumentRequestsCard employeeId={e.id} /> : null}

          {/* Les soldes sont un TABLEAU : ils appartiennent à la colonne large.
              Serrés dans le tiers de droite, leurs colonnes débordaient. */}
          <BalancesCard employeeId={e.id} canEdit={Boolean(canSeeHistory)} />
        </div>

        {/* ———— Colonne d'administration : accès et traces ———— */}
        <div className="flex min-w-0 flex-col gap-4">
          {canSeeHistory ? <PortalCard employeeId={e.id} portal={e.portal} /> : null}

          {canSeeHistory ? (
            <Card>
              <CardHeader>
                <CardTitle>Historique des modifications</CardTitle>
              </CardHeader>
              <CardContent>
                {history.isLoading ? (
                  <Skeleton className="h-16 w-full" />
                ) : !history.data || history.data.length === 0 ? (
                  <p className="rounded-[11px] border border-dashed border-line bg-surface-raised px-4 py-5 text-center text-[12.5px] text-ink-muted">
                    Aucune modification enregistrée.
                  </p>
                ) : (
                  /* Une frise : le fil vertical relie les événements et fait
                     lire la colonne comme une suite, pas comme un tableau de
                     dates dont chaque ligne repartirait de zéro. */
                  <ol className="relative flex flex-col gap-4 border-l border-line-soft pl-4">
                    {history.data.map((h) => (
                      <li key={h.id} className="relative">
                        <span
                          aria-hidden
                          className="absolute top-[6px] -left-[21px] size-[7px] rounded-full bg-primary/40 ring-[3px] ring-surface"
                        />
                        <p className="text-[12.5px] leading-snug font-semibold text-ink-strong">
                          {ACTION_LABELS[h.action] ?? h.action} ·{' '}
                          {TABLE_LABELS[h.tableName] ?? h.tableName}
                        </p>
                        {h.changedFields.length > 0 ? (
                          <p className="mt-0.5 text-[11.5px] leading-snug text-ink-muted">
                            {h.changedFields.join(', ')}
                          </p>
                        ) : null}
                        <p className="mt-0.5 text-[11px] text-ink-muted/80">
                          {new Date(h.occurredAt).toLocaleString('fr-FR', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>
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
            </tr>
          </THead>
          <TBody>
            {assignments.map((a) => (
              <Tr key={a.id}>
                <Td className="font-medium text-ink-strong">{a.positionTitle}</Td>
                <Td>{a.orgUnitName ?? '—'}</Td>
                <Td className="whitespace-nowrap">{formatDate(a.validFrom)}</Td>
                {/* La colonne « Au » porte seule l'état : « aujourd'hui » dit
                    l'affectation en cours, « à venir » celle qui n'a pas
                    commencé. Un badge à côté répétait ce que la date dit. */}
                <Td className="whitespace-nowrap">
                  {a.validTo ? (
                    formatDate(lastDay(a.validTo))
                  ) : a.current ? (
                    <span className="font-semibold text-primary">aujourd&apos;hui</span>
                  ) : (
                    <span className="text-ink-muted">à venir</span>
                  )}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}

/** Historique des demandes de documents de cet employé (ADR-0012). */
function DocumentRequestsCard({ employeeId }: { employeeId: string }) {
  const requests = useQuery({
    queryKey: ['document-requests', 'employee', employeeId],
    queryFn: () => api<DocumentRequestView[]>(`/document-requests?employeeId=${employeeId}`),
  });

  const liste = requests.data ?? [];

  return (
    <Card>
      <CardHeader className="flex items-center gap-2.5">
        <CardTitle>Demandes de documents</CardTitle>
        {liste.length > 0 ? (
          <span
            className="rounded-full bg-primary/[0.09] px-2 py-px text-[10.5px] font-extrabold text-primary"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {liste.length}
          </span>
        ) : null}
      </CardHeader>
      <CardContent>
        {requests.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : liste.length === 0 ? (
          <p className="rounded-[11px] border border-dashed border-line bg-surface-raised px-4 py-5 text-center text-[12.5px] text-ink-muted">
            Aucune demande à ce jour — attestations et bulletins se demandent depuis le portail.
          </p>
        ) : (
          <ul className="flex flex-col">
            {liste.map((r) => (
              <DocumentRequestRow key={r.id} request={r} showEmployee={false} />
            ))}
          </ul>
        )}
      </CardContent>
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
