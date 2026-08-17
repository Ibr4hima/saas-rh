'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type { AbsenceRequestView } from '@teranga/contracts';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@teranga/ui';
import { IconCalendar, IconNetwork, IconUpload, IconUserPlus } from '../../../components/icons';
import { api } from '../../../lib/api';
import { formatDate, useMe } from '../../../lib/hooks';

interface DashboardStats {
  activeEmployees: number;
  pendingRequests: number;
  upcomingAbsences: number;
  orgUnits: number;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Bonjour';
  if (h < 18) return 'Bon après-midi';
  return 'Bonsoir';
}

function StatTile({
  label,
  value,
  href,
}: {
  label: string;
  value: number | undefined;
  href: string;
}) {
  return (
    <Link href={href} className="group">
      <Card className="transition-shadow duration-150 group-hover:shadow-md">
        <CardContent className="py-4">
          {value === undefined ? (
            <Skeleton className="mb-1 h-8 w-16" />
          ) : (
            <p
              className="text-3xl font-bold text-ink-strong"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {value}
            </p>
          )}
          <p className="text-sm text-ink-muted">{label}</p>
        </CardContent>
      </Card>
    </Link>
  );
}

export default function DashboardPage() {
  const me = useMe();
  const stats = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<DashboardStats>('/dashboard'),
  });
  const pending = useQuery({
    queryKey: ['absence-requests', 'pending'],
    queryFn: () => api<AbsenceRequestView[]>('/absence-requests?status=pending&limit=5'),
  });
  const upcoming = useQuery({
    queryKey: ['absences-upcoming'],
    queryFn: () => api<AbsenceRequestView[]>('/absences/upcoming'),
  });

  const today = new Date().toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-ink-strong">
          {greeting()}
          {me.data ? `, ${me.data.givenName}` : ''} 👋
        </h1>
        <p className="text-sm text-ink-muted">Nous sommes le {today}.</p>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Employés actifs" value={stats.data?.activeEmployees} href="/employees" />
        <StatTile label="Demandes à valider" value={stats.data?.pendingRequests} href="/absences" />
        <StatTile
          label="Absences à venir (30 j)"
          value={stats.data?.upcomingAbsences}
          href="/absences"
        />
        <StatTile label="Unités d'organisation" value={stats.data?.orgUnits} href="/organisation" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>Demandes à valider</CardTitle>
            {(pending.data?.length ?? 0) > 0 ? (
              <Link href="/absences" className="text-xs font-medium text-primary hover:underline">
                Tout voir →
              </Link>
            ) : null}
          </CardHeader>
          <CardContent>
            {pending.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : (pending.data ?? []).length === 0 ? (
              <p className="text-sm text-ink-muted">
                Aucune demande en attente — tout est à jour. ✨
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {pending.data!.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-ink-strong">{r.employeeName}</p>
                      <p className="truncate text-xs text-ink-muted">
                        {r.absenceTypeName} · {formatDate(r.startDate)} → {formatDate(r.endDate)} (
                        {r.daysCount} j)
                      </p>
                    </div>
                    <Badge tone="warning">
                      Visa {Math.min(r.currentLevel + 1, r.chainLevels.length)}/
                      {r.chainLevels.length}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Prochaines absences</CardTitle>
          </CardHeader>
          <CardContent>
            {upcoming.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : (upcoming.data ?? []).length === 0 ? (
              <p className="text-sm text-ink-muted">Personne d&apos;absent prochainement.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {upcoming.data!.slice(0, 5).map((r) => (
                  <li key={r.id} className="flex items-baseline gap-3 text-sm">
                    <span className="w-40 shrink-0 truncate font-medium text-ink-strong">
                      {r.employeeName}
                    </span>
                    <span className="truncate text-ink-muted">
                      {r.absenceTypeName} · {formatDate(r.startDate)} → {formatDate(r.endDate)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-8">
        <p className="mb-3 text-[11px] font-semibold tracking-wider text-ink-muted/80 uppercase">
          Accès rapides
        </p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Link href="/employees/new">
            <Button variant="secondary" className="w-full justify-start gap-2">
              <IconUserPlus size={16} /> Nouvel employé
            </Button>
          </Link>
          <Link href="/absences/new">
            <Button variant="secondary" className="w-full justify-start gap-2">
              <IconCalendar size={16} /> Nouvelle demande
            </Button>
          </Link>
          <Link href="/import">
            <Button variant="secondary" className="w-full justify-start gap-2">
              <IconUpload size={16} /> Importer des employés
            </Button>
          </Link>
          <Link href="/organisation">
            <Button variant="secondary" className="w-full justify-start gap-2">
              <IconNetwork size={16} /> Organisation
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
