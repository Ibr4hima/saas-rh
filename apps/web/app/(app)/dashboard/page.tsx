'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type { AbsenceRequestView, DashboardView, ExpiringContractView } from '@teranga/contracts';
import {
  Badge,
  Button,
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
import {
  IconCalendar,
  IconCalendarDays,
  IconChevronRight,
  IconClock,
  IconFileText,
  IconFlag,
  IconIdCard,
  IconUserPlus,
  IconUsers,
} from '../../../components/icons';
import { api } from '../../../lib/api';
import { formatDate, useMe } from '../../../lib/hooks';

/* ————————————————————————————————————————————————————————————————
   L'écran d'accueil répond à trois questions, dans l'ordre :
   1. « Y a-t-il quelque chose qui m'attend ? »  → indicateurs + À traiter
   2. « Qui est là ? »                           → effectifs, parité, absents
   3. « Que se passe-t-il bientôt ? »            → absences, échéances, fériés
   ———————————————————————————————————————————————————————————————— */

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Bonjour';
  if (h < 18) return 'Bon après-midi';
  return 'Bonsoir';
}

/** « aujourd'hui », « demain », « dans 12 j » — l'échéance parle mieux que la date. */
function inDays(iso: string): string {
  const days = Math.round(
    (new Date(`${iso}T00:00:00`).getTime() - new Date().setHours(0, 0, 0, 0)) / 86_400_000,
  );
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return 'demain';
  return `dans ${days} j`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n > 1 ? 's' : ''}`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase();
}

/* ———— Indicateurs ———— */

function StatTile({
  icon,
  label,
  value,
  context,
  href,
  alert,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | undefined;
  context?: string;
  href: string;
  /** true = ce chiffre attend une action : le chip passe à l'accent. */
  alert?: boolean;
}) {
  return (
    <Link href={href} className="group focus-visible:outline-none">
      <Card className="h-full transition-all duration-150 group-hover:-translate-y-px group-hover:shadow-md group-focus-visible:ring-2 group-focus-visible:ring-primary/40">
        <CardContent className="flex flex-col gap-3 py-4">
          <div className="flex items-center justify-between">
            <span
              className={`flex size-9 items-center justify-center rounded-[10px] ${
                alert ? 'bg-primary text-primary-ink' : 'bg-primary-soft text-primary'
              }`}
            >
              {icon}
            </span>
            <IconChevronRight
              size={14}
              className="text-ink-muted/0 transition-colors duration-150 group-hover:text-ink-muted/60"
            />
          </div>
          <div>
            {value === undefined ? (
              <Skeleton className="mb-1 h-8 w-14" />
            ) : (
              <p
                className="text-[28px] leading-none font-bold tracking-[-0.02em] text-ink-strong"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {value}
              </p>
            )}
            <p className="mt-1.5 text-[13px] font-medium text-ink">{label}</p>
            {context ? <p className="mt-0.5 text-xs text-ink-muted">{context}</p> : null}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

/* ———— File « À traiter » ———— */

function InboxRow({
  icon,
  label,
  detail,
  count,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  detail: string;
  count: number;
  href: string;
}) {
  return (
    <li>
      <Link
        href={href}
        className="group flex items-center gap-3.5 rounded-lg px-3 py-3 transition-colors duration-150 hover:bg-bg"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-primary-soft text-primary">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-ink-strong">{label}</span>
          <span className="block truncate text-xs text-ink-muted">{detail}</span>
        </span>
        <span
          className="rounded-full bg-primary px-2.5 py-0.5 text-xs font-semibold text-primary-ink"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {count}
        </span>
        <IconChevronRight
          size={16}
          className="shrink-0 text-ink-muted/40 transition-transform duration-150 group-hover:translate-x-0.5"
        />
      </Link>
    </li>
  );
}

/* ———— Barres d'effectifs (une teinte, étiquettes en encre de texte) ———— */

function DirectionBar({
  label,
  title,
  value,
  max,
}: {
  label: string;
  title: string;
  value: number;
  max: number;
}) {
  const width = max > 0 ? Math.max((value / max) * 100, value > 0 ? 6 : 0) : 0;
  return (
    <li className="flex items-center gap-3" title={title}>
      <span className="w-12 shrink-0 truncate text-xs font-medium text-ink">{label}</span>
      <span className="h-1.5 flex-1 overflow-hidden rounded-[4px] bg-chart-track">
        <span
          className="block h-full bg-chart transition-[width] duration-300"
          style={{ width: `${width}%`, borderRadius: '0 4px 4px 0' }}
        />
      </span>
      <span
        className="w-6 shrink-0 text-right text-xs font-semibold text-ink-strong"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </span>
    </li>
  );
}

export default function DashboardPage() {
  const me = useMe();
  const role = me.data?.role;
  const canManage = role === 'admin' || role === 'hr';
  const seesContracts = canManage || role === 'payroll';

  const stats = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<DashboardView>('/dashboard'),
  });
  const upcoming = useQuery({
    queryKey: ['absences-upcoming'],
    queryFn: () => api<AbsenceRequestView[]>('/absences/upcoming'),
  });
  const expiring = useQuery({
    queryKey: ['contracts-expiring'],
    queryFn: () => api<ExpiringContractView[]>('/contracts/expiring'),
    enabled: seesContracts,
  });

  const d = stats.data;
  const today = new Date().toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const inbox = [
    {
      icon: <IconCalendar size={17} />,
      label: 'Demandes de congés',
      detail: 'À viser — les soldes sont vérifiés, il ne manque que vous.',
      count: d?.pendingRequests ?? 0,
      href: '/absences',
      show: true,
    },
    {
      icon: <IconFileText size={17} />,
      label: 'Demandes de documents',
      detail: 'À générer, cacheter, signer puis annoncer le retrait.',
      count: d?.pendingDocumentRequests ?? 0,
      href: '/documents',
      show: canManage,
    },
    {
      icon: <IconIdCard size={17} />,
      label: 'Informations personnelles',
      detail: 'Changements déclarés par les agents, à confirmer sur leur fiche.',
      count: d?.pendingProfileChanges ?? 0,
      href: '/employees',
      show: canManage,
    },
  ].filter((r) => r.show && r.count > 0);

  const maxHeadcount = Math.max(...(d?.headcountByDirection.map((x) => x.headcount) ?? [0]), 1);
  const unassigned = d
    ? d.activeEmployees - d.headcountByDirection.reduce((s, x) => s + x.headcount, 0)
    : 0;

  return (
    <div className="mx-auto max-w-6xl">
      {/* ———— En-tête ———— */}
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-[-0.02em] text-ink-strong">
            {greeting()}
            {me.data ? `, ${me.data.givenName}` : ''} 👋
          </h1>
          <p className="mt-0.5 text-sm text-ink-muted">Nous sommes le {today}.</p>
        </div>
        {canManage ? (
          <Link href="/employees/new">
            <Button className="gap-2">
              <IconUserPlus size={16} /> Nouvel employé
            </Button>
          </Link>
        ) : null}
      </div>

      {/* ———— Indicateurs ———— */}
      <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatTile
          icon={<IconUsers size={17} />}
          label="Effectif actif"
          value={d?.activeEmployees}
          context={
            d
              ? d.hiredLast90d > 0
                ? `dont ${d.hiredLast90d} recruté${d.hiredLast90d > 1 ? 's' : ''} en 90 j`
                : `${plural(d.women, 'femme')} · ${plural(d.men, 'homme')}`
              : undefined
          }
          href="/employees"
        />
        <StatTile
          icon={<IconCalendar size={17} />}
          label="Demandes à valider"
          value={d?.pendingRequests}
          context="congés en attente de visa"
          href="/absences"
          alert={(d?.pendingRequests ?? 0) > 0}
        />
        <StatTile
          icon={<IconCalendarDays size={17} />}
          label="Absents aujourd'hui"
          value={d?.absentToday}
          context={d ? `${d.upcomingAbsences} à venir sous 30 j` : undefined}
          href="/calendrier"
        />
        {seesContracts ? (
          <StatTile
            icon={<IconClock size={17} />}
            label="Contrats à suivre"
            value={expiring.data?.length}
            context="échéance sous 30 jours"
            href="/employees"
            alert={(expiring.data?.length ?? 0) > 0}
          />
        ) : (
          <StatTile
            icon={<IconUsers size={17} />}
            label="Unités d'organisation"
            value={d?.orgUnits}
            context="directions, départements, services"
            href="/organisation"
          />
        )}
      </div>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-3">
        {/* ———— Colonne principale ———— */}
        <div className="flex min-w-0 flex-col gap-6 xl:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>À traiter</CardTitle>
            </CardHeader>
            <CardContent className="px-2 py-2">
              {stats.isLoading ? (
                <Skeleton className="m-3 h-14" />
              ) : inbox.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-ink-muted">
                  Rien en attente — tout est à jour. ✨
                </p>
              ) : (
                <ul className="flex flex-col">
                  {inbox.map((r) => (
                    <InboxRow key={r.label} {...r} />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle>Prochaines absences</CardTitle>
              <Link href="/calendrier" className="text-xs font-medium text-primary hover:underline">
                Calendrier →
              </Link>
            </CardHeader>
            {upcoming.isLoading ? (
              <CardContent>
                <Skeleton className="h-20 w-full" />
              </CardContent>
            ) : (upcoming.data ?? []).length === 0 ? (
              <CardContent>
                <p className="py-4 text-center text-sm text-ink-muted">
                  Personne d&apos;absent dans les 30 prochains jours.
                </p>
              </CardContent>
            ) : (
              <Table>
                <THead>
                  <tr>
                    <Th>Employé</Th>
                    <Th>Type</Th>
                    <Th>Du</Th>
                    <Th>Au</Th>
                    <Th className="text-right">Jours</Th>
                  </tr>
                </THead>
                <TBody>
                  {upcoming.data!.slice(0, 6).map((r) => (
                    <Tr key={r.id}>
                      <Td className="font-medium text-ink-strong">{r.employeeName}</Td>
                      <Td className="text-ink-muted">{r.absenceTypeName}</Td>
                      <Td className="whitespace-nowrap">{formatDate(r.startDate)}</Td>
                      <Td className="whitespace-nowrap">{formatDate(r.endDate)}</Td>
                      <Td className="text-right font-mono">{r.daysCount}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>

          {seesContracts && (expiring.data ?? []).length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Contrats arrivant à échéance</CardTitle>
              </CardHeader>
              <Table>
                <THead>
                  <tr>
                    <Th>Employé</Th>
                    <Th>Contrat</Th>
                    <Th>Fin</Th>
                    <Th className="text-right">Échéance</Th>
                  </tr>
                </THead>
                <TBody>
                  {expiring.data!.map((c) => (
                    <Tr key={c.contractId}>
                      <Td>
                        <Link
                          href={`/employees/${c.employeeId}`}
                          className="font-medium text-ink-strong hover:underline"
                        >
                          {c.employeeName}
                        </Link>
                      </Td>
                      <Td className="text-ink-muted uppercase">{c.contractType}</Td>
                      <Td className="whitespace-nowrap">{formatDate(c.endDate)}</Td>
                      <Td className="text-right">
                        <Badge tone={c.daysLeft <= 10 ? 'danger' : 'warning'}>
                          {c.daysLeft === 0 ? "aujourd'hui" : `J−${c.daysLeft}`}
                        </Badge>
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </Card>
          ) : null}
        </div>

        {/* ———— Colonne de contexte ———— */}
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Effectifs par direction</CardTitle>
            </CardHeader>
            <CardContent>
              {stats.isLoading ? (
                <Skeleton className="h-20 w-full" />
              ) : (d?.headcountByDirection ?? []).length === 0 ? (
                <p className="text-sm text-ink-muted">
                  Créez vos directions dans l&apos;organigramme.
                </p>
              ) : (
                <>
                  <ul className="flex flex-col gap-3">
                    {d!.headcountByDirection.map((x) => (
                      <DirectionBar
                        key={x.name}
                        label={x.shortName ?? x.name}
                        title={x.name}
                        value={x.headcount}
                        max={maxHeadcount}
                      />
                    ))}
                    {unassigned > 0 ? (
                      <DirectionBar
                        label="—"
                        title="Sans affectation"
                        value={unassigned}
                        max={maxHeadcount}
                      />
                    ) : null}
                  </ul>
                  {d && d.women + d.men > 0 ? (
                    <p className="mt-4 border-t border-line-soft pt-3 text-xs text-ink-muted">
                      Parité : {plural(d.women, 'femme')} · {plural(d.men, 'homme')}
                    </p>
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Prochains jours fériés</CardTitle>
            </CardHeader>
            <CardContent>
              {stats.isLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : (d?.upcomingHolidays ?? []).length === 0 ? (
                <p className="text-sm text-ink-muted">
                  Aucun férié à venir — la liste se gère dans les paramètres des congés.
                </p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {d!.upcomingHolidays.map((h) => (
                    <li key={h.day} className="flex items-center gap-3">
                      <span className="flex size-10 shrink-0 flex-col items-center justify-center rounded-[10px] border border-line-soft bg-bg">
                        <span
                          className="text-sm leading-none font-bold text-ink-strong"
                          style={{ fontVariantNumeric: 'tabular-nums' }}
                        >
                          {Number(h.day.slice(8, 10))}
                        </span>
                        <span className="mt-0.5 text-[9px] leading-none text-ink-muted uppercase">
                          {new Date(`${h.day}T00:00:00`).toLocaleDateString('fr-FR', {
                            month: 'short',
                          })}
                        </span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink-strong">
                          {h.label}
                        </span>
                        <span className="block text-xs text-ink-muted">
                          <span className="capitalize">
                            {new Date(`${h.day}T00:00:00`).toLocaleDateString('fr-FR', {
                              weekday: 'long',
                            })}
                          </span>{' '}
                          · {inDays(h.day)}
                        </span>
                      </span>
                      <IconFlag size={14} className="shrink-0 text-ink-muted/40" />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Dernières embauches</CardTitle>
            </CardHeader>
            <CardContent>
              {stats.isLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : (d?.recentHires ?? []).length === 0 ? (
                <p className="text-sm text-ink-muted">Aucun dossier pour le moment.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {d!.recentHires.map((h) => {
                    const inner = (
                      <>
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[11px] font-bold text-primary">
                          {initials(h.name)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-ink-strong">
                            {h.name}
                          </span>
                          <span className="block truncate text-xs text-ink-muted">
                            {h.positionTitle ?? 'Poste à préciser'} · depuis le{' '}
                            {formatDate(h.hiredOn)}
                          </span>
                        </span>
                      </>
                    );
                    return (
                      <li key={h.employeeId}>
                        {canManage ? (
                          <Link
                            href={`/employees/${h.employeeId}`}
                            className="flex items-center gap-3 rounded-lg transition-colors duration-150 hover:bg-bg"
                          >
                            {inner}
                          </Link>
                        ) : (
                          <span className="flex items-center gap-3">{inner}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
