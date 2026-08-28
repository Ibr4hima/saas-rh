'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type { AbsenceRequestView, DashboardView, ExpiringContractView } from '@teranga/contracts';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardInteractive,
  CardTitle,
  Skeleton,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@teranga/ui';
import { Icon } from '../../../components/icons';
import { api } from '../../../lib/api';
import { formatDate, useMe } from '../../../lib/hooks';

/* ————————————————————————————————————————————————————————————————
   L'écran d'accueil répond à trois questions, dans l'ordre :
   1. « Y a-t-il quelque chose qui m'attend ? »  → indicateurs + À traiter
   2. « Qui est là ? »                           → effectifs, parité, absents
   3. « Que se passe-t-il bientôt ? »            → absences, échéances, fériés
   ———————————————————————————————————————————————————————————————— */

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

/**
 * Jour courant au format ISO, dans le calendrier LOCAL de l'utilisateur.
 * `toISOString()` donnerait la date UTC : à Dakar (UTC+0) c'est identique,
 * ailleurs cela ferait basculer « en cours » un jour trop tôt ou trop tard.
 */
function localToday(): string {
  const d = new Date();
  const p = (v: number) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * L'échéance se lit sans calcul mental, et tient sur une ligne : dans une
 * colonne étroite, un libellé qui se replie sur trois lignes coûte plus de
 * lecture qu'il n'en épargne.
 */
function deadlineLabel(daysLeft: number | null): {
  text: string;
  tone: 'danger' | 'warning' | 'neutral';
} {
  if (daysLeft === null) return { text: 'à préciser', tone: 'danger' };
  if (daysLeft < 0) return { text: `échu · ${-daysLeft} j`, tone: 'danger' };
  if (daysLeft === 0) return { text: 'dernier jour', tone: 'danger' };
  return { text: `${daysLeft} j`, tone: daysLeft <= 30 ? 'warning' : 'neutral' };
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
  /** true = ce chiffre attend une action : le chip passe à l'orange de charte. */
  alert?: boolean;
}) {
  return (
    /* L'étiquette passe AVANT le chiffre : on lit « ce que c'est » puis
       « combien », l'ordre dans lequel la question se pose. L'icône descend au
       rang de repère, dans le coin, plutôt que d'ouvrir la tuile. */
    <Link
      href={href}
      className="group rounded-[14px] focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
    >
      <CardInteractive className="h-full px-3.5 py-3">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[10px] font-bold tracking-[0.1em] text-ink-muted uppercase">{label}</p>
          <span className={alert ? 'text-accent' : 'text-primary/45'}>{icon}</span>
        </div>
        {value === undefined ? (
          <Skeleton className="mt-2.5 h-7 w-12" />
        ) : (
          <p
            className="mt-2 text-[26px] leading-none font-bold tracking-[-0.02em] text-ink-strong"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {value}
          </p>
        )}
        {context ? <p className="mt-1.5 text-[11.5px] text-ink-muted">{context}</p> : null}
      </CardInteractive>
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
        className="group flex items-center gap-3 rounded-[7px] px-2.5 py-2.5 transition-colors duration-150 hover:bg-bg"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/[0.07] text-primary">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] font-semibold text-ink-strong">{label}</span>
          <span className="block truncate text-[11.5px] text-ink-muted">{detail}</span>
        </span>
        <span
          className="rounded-full bg-accent px-2 py-px text-[11px] font-bold text-accent-ink"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {count}
        </span>
        <Icon
          name="chevron_right"
          size={18}
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
  const todayIso = localToday();

  const inbox = [
    {
      icon: <Icon name="free_cancellation" size={18} />,
      label: 'Demandes de congés',
      detail: 'À viser — les soldes sont vérifiés, il ne manque que vous.',
      count: d?.pendingRequests ?? 0,
      href: '/absences',
      show: true,
    },
    {
      icon: <Icon name="folder_managed" size={18} />,
      label: 'Demandes de documents',
      detail: 'À générer, cacheter, signer puis annoncer le retrait.',
      count: d?.pendingDocumentRequests ?? 0,
      href: '/documents',
      show: canManage,
    },
    {
      icon: <Icon name="badge" size={18} />,
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
      {/* ———— Indicateurs ———— */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          icon={<Icon name="group" size={19} />}
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
          icon={<Icon name="free_cancellation" size={19} />}
          label="Demandes à valider"
          value={d?.pendingRequests}
          context="congés en attente de visa"
          href="/absences"
          alert={(d?.pendingRequests ?? 0) > 0}
        />
        <StatTile
          icon={<Icon name="event_busy" size={19} />}
          label="Absents aujourd'hui"
          value={d?.absentToday}
          context={d ? `${d.upcomingAbsences} à venir sous 30 j` : undefined}
          href="/calendrier"
        />
        {seesContracts ? (
          <StatTile
            icon={<Icon name="schedule" size={19} />}
            label="Contrats à suivre"
            value={expiring.data?.length}
            context="échéance sous 30 jours"
            href="/employees"
            alert={(expiring.data?.length ?? 0) > 0}
          />
        ) : (
          <StatTile
            icon={<Icon name="family_history" size={19} />}
            label="Unités d'organisation"
            value={d?.orgUnits}
            context="directions, départements, services"
            href="/organisation"
          />
        )}
      </div>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
        {/* ———— Colonne principale ———— */}
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Demandes à traiter</CardTitle>
            </CardHeader>
            <CardContent className="px-2 py-2">
              {stats.isLoading ? (
                <Skeleton className="m-3 h-14" />
              ) : inbox.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-ink-muted">
                  Aucune nouvelle demande.
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
            <CardHeader>
              <CardTitle>Calendrier des absences</CardTitle>
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
                    <Th>Statut</Th>
                  </tr>
                </THead>
                <TBody>
                  {upcoming.data!.slice(0, 6).map((r) => (
                    <Tr key={r.id}>
                      <Td className="font-medium whitespace-nowrap text-ink-strong">
                        {r.employeeName}
                      </Td>
                      <Td className="whitespace-nowrap text-ink-muted">{r.absenceTypeName}</Td>
                      <Td className="whitespace-nowrap">{formatDate(r.startDate)}</Td>
                      <Td className="whitespace-nowrap">{formatDate(r.endDate)}</Td>
                      <Td className="text-right font-mono">{r.daysCount}</Td>
                      <Td>
                        {r.startDate <= todayIso ? (
                          <Badge tone="success" className="whitespace-nowrap">
                            En cours
                          </Badge>
                        ) : (
                          <Badge className="whitespace-nowrap">À venir</Badge>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
        </div>

        {/* ———— Colonne de contexte ———— */}
        <div className="flex min-w-0 flex-col gap-4">
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
                      <Icon name="flag" size={16} className="shrink-0 text-ink-muted/40" />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {seesContracts ? (
        <Card className="mt-6">
          <CardHeader className="flex items-center justify-between">
            <CardTitle>Suivi des contrats</CardTitle>
            <span className="text-xs text-ink-muted">CDD et stages en cours</span>
          </CardHeader>
          {stats.isLoading ? (
            <CardContent>
              <Skeleton className="h-20 w-full" />
            </CardContent>
          ) : (d?.contractFollowUp ?? []).length === 0 ? (
            <CardContent>
              <p className="py-4 text-center text-sm text-ink-muted">
                Aucun contrat à durée limitée en cours.
              </p>
            </CardContent>
          ) : (
            <>
              <Table>
                <THead>
                  <tr>
                    <Th>Matricule</Th>
                    <Th>Nom</Th>
                    <Th>Poste</Th>
                    <Th>Contrat</Th>
                    <Th>Date fin</Th>
                    <Th className="text-right whitespace-nowrap">Jours restants</Th>
                  </tr>
                </THead>
                <TBody>
                  {d!.contractFollowUp.map((c) => {
                    const deadline = deadlineLabel(c.daysLeft);
                    return (
                      <Tr key={c.employeeId}>
                        <Td className="font-mono text-ink-muted">{c.employeeNumber}</Td>
                        <Td className="whitespace-nowrap">
                          <Link
                            href={`/employees/${c.employeeId}`}
                            className="font-medium text-ink-strong hover:underline"
                          >
                            {c.name}
                          </Link>
                        </Td>
                        <Td
                          className="max-w-40 truncate text-ink-muted"
                          title={c.positionTitle ?? undefined}
                        >
                          {c.positionTitle ?? '—'}
                        </Td>
                        <Td className="uppercase">{c.contractType}</Td>
                        <Td className="whitespace-nowrap">
                          {c.endDate ? formatDate(c.endDate) : '—'}
                        </Td>
                        <Td className="text-right">
                          <Badge tone={deadline.tone} className="whitespace-nowrap">
                            {deadline.text}
                          </Badge>
                        </Td>
                      </Tr>
                    );
                  })}
                </TBody>
              </Table>
              {d && d.contractFollowUpTotal > d.contractFollowUp.length ? (
                <CardContent className="border-t border-line-soft py-3">
                  <p className="text-xs text-ink-muted">
                    {d.contractFollowUp.length} des {d.contractFollowUpTotal} contrats suivis — les
                    plus urgents d&apos;abord.
                  </p>
                </CardContent>
              ) : null}
            </>
          )}
        </Card>
      ) : null}
    </div>
  );
}
