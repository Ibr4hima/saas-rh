'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { cn, Skeleton } from '@teranga/ui';
import {
  IconCalendar,
  IconCalendarDays,
  IconDashboard,
  IconLogout,
  IconNetwork,
  IconScale,
  IconTarget,
  IconUserPlus,
  IconUsers,
} from '../../components/icons';
import { api } from '../../lib/api';
import { useMe } from '../../lib/hooks';

interface DashboardStats {
  activeEmployees: number;
  pendingRequests: number;
  upcomingAbsences: number;
  orgUnits: number;
}

const NAV_GROUPS: Array<{
  label: string;
  items: Array<{
    href: string;
    label: string;
    icon: React.ComponentType<{ size?: number }>;
    badge?: 'pending';
  }>;
}> = [
  {
    label: 'Les essentiels',
    items: [
      { href: '/dashboard', label: 'Tableau de bord', icon: IconDashboard },
      { href: '/employees', label: 'Employés', icon: IconUsers },
      { href: '/absences', label: 'Congés', icon: IconCalendar, badge: 'pending' },
      { href: '/calendrier', label: 'Calendrier', icon: IconCalendarDays },
    ],
  },
  {
    label: 'Talents',
    items: [
      { href: '/recrutement', label: 'Recrutement', icon: IconUserPlus },
      { href: '/evaluation', label: 'Évaluation', icon: IconTarget },
    ],
  },
  {
    label: 'Ma structure',
    items: [
      { href: '/organisation', label: 'Organisation', icon: IconNetwork },
      { href: '/reglementations', label: 'Règlementations', icon: IconScale },
    ],
  },
];

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrateur',
  hr: 'RH',
  payroll: 'Gestionnaire de paie',
  manager: 'Manager',
  employee: 'Employé',
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();

  const stats = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<DashboardStats>('/dashboard'),
    enabled: Boolean(me.data),
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (me.isError) router.replace('/login');
  }, [me.isError, router]);

  if (!me.data) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-10">
        <Skeleton className="mb-6 h-8 w-40" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const user = me.data;
  const initials = `${user.givenName[0] ?? ''}${user.familyName[0] ?? ''}`.toUpperCase();
  const pending = stats.data?.pendingRequests ?? 0;

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-60 flex-col border-r border-line bg-surface">
        {/* Marque */}
        <div className="flex items-center gap-2.5 px-4 pt-5 pb-4">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-ink">
            T
          </div>
          <div className="min-w-0">
            <p className="text-sm leading-tight font-bold text-ink-strong">Teranga RH</p>
            <p className="truncate text-xs leading-tight text-ink-muted">{user.organizationName}</p>
          </div>
        </div>

        {/* Navigation groupée */}
        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="mt-4 first:mt-1">
              <p className="px-2.5 pb-1.5 text-[11px] font-semibold tracking-wider text-ink-muted/80 uppercase">
                {group.label}
              </p>
              <div className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const active = pathname.startsWith(item.href);
                  const IconCmp = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors duration-150',
                        active
                          ? 'bg-primary-soft font-medium text-primary'
                          : 'text-ink-muted hover:bg-line-soft hover:text-ink',
                      )}
                    >
                      <IconCmp size={18} />
                      <span className="flex-1">{item.label}</span>
                      {item.badge === 'pending' && pending > 0 ? (
                        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-[11px] font-semibold text-white">
                          {pending}
                        </span>
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Utilisateur */}
        <div className="border-t border-line-soft px-3 py-3">
          <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm leading-tight font-medium text-ink-strong">
                {user.givenName} {user.familyName}
              </p>
              <p className="truncate text-xs leading-tight text-ink-muted">
                {ROLE_LABELS[user.role] ?? user.role}
              </p>
            </div>
            <button
              type="button"
              title="Se déconnecter"
              aria-label="Se déconnecter"
              className="rounded-md p-1.5 text-ink-muted transition-colors hover:bg-danger-soft hover:text-danger"
              onClick={async () => {
                await api('/auth/logout', { method: 'POST' });
                router.replace('/login');
              }}
            >
              <IconLogout size={16} />
            </button>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-8 py-8">{children}</main>
    </div>
  );
}
