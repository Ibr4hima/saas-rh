'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { cn, Skeleton } from '@teranga/ui';
import {
  IconCalendar,
  IconCalendarDays,
  IconDashboard,
  IconFileText,
  IconLogout,
  IconNetwork,
  IconScale,
  IconTarget,
  IconUserPlus,
  IconUsers,
} from '../../components/icons';
import { NotificationsBell } from '../../components/notifications-bell';
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

const STAFF_ROLES = ['admin', 'hr', 'payroll'];
/** Sections réservées admin/RH : cachées aux autres rôles staff (payroll). */
const MANAGE_ONLY_PATHS = ['/recrutement'];

function staffNav(role: string): typeof NAV_GROUPS {
  if (role !== 'payroll') return NAV_GROUPS;
  return NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => !MANAGE_ONLY_PATHS.some((p) => i.href.startsWith(p))),
  })).filter((g) => g.items.length > 0);
}

/** Espace personnel : navigation réduite pour employés et managers. */
function personalNav(role: string): typeof NAV_GROUPS {
  return [
    {
      label: 'Mon espace',
      items: [
        { href: '/moi', label: 'Mon espace', icon: IconDashboard },
        { href: '/moi/conges', label: 'Mes congés', icon: IconCalendar },
        { href: '/moi/documents', label: 'Mes documents', icon: IconFileText },
        ...(role === 'manager'
          ? [
              {
                href: '/absences',
                label: 'Validations',
                icon: IconUsers,
                badge: 'pending' as const,
              },
            ]
          : []),
        { href: '/calendrier', label: 'Calendrier', icon: IconCalendarDays },
        { href: '/organisation', label: 'Organisation', icon: IconNetwork },
      ],
    },
  ];
}

/**
 * Logo de l'organisation : apps/web/public/logo-apix.png s'il existe,
 * sinon repli sur la tuile « T ». (Brandable par tenant plus tard.)
 */
function BrandMark({ size }: { size: 'sm' | 'md' }) {
  const [imgOk, setImgOk] = useState(true);
  const box = size === 'md' ? 'size-8 rounded-lg text-sm' : 'size-7 rounded-md text-xs';
  if (imgOk) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src="/logo-apix.png"
        alt="Logo de l'organisation"
        className={`${size === 'md' ? 'h-8 max-w-32' : 'h-7 max-w-24'} w-auto shrink-0 rounded-md bg-white object-contain px-1`}
        onError={() => setImgOk(false)}
      />
    );
  }
  return (
    <div
      className={`flex ${box} items-center justify-center bg-primary font-bold text-primary-ink`}
    >
      T
    </div>
  );
}

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

  const role = me.data?.role ?? '';
  const isStaff = STAFF_ROLES.includes(role);

  const stats = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<DashboardStats>('/dashboard'),
    // Réservé aux rôles qui y ont droit côté serveur — pas de 403 périodiques.
    enabled: Boolean(me.data) && (isStaff || role === 'manager'),
    refetchInterval: 60_000,
  });

  // Garde de routes : les non-gestionnaires restent dans leur espace.
  const allowedForRole = (path: string): boolean => {
    if (!me.data) return true;
    if (role === 'payroll' && MANAGE_ONLY_PATHS.some((p) => path.startsWith(p))) return false;
    if (isStaff) return true;
    if (path.startsWith('/moi') || path.startsWith('/calendrier')) return true;
    // L'organigramme est un annuaire interne : lisible par tous les rôles.
    if (path.startsWith('/organisation')) return true;
    if (role === 'manager') {
      return path.startsWith('/absences') && !path.startsWith('/absences/parametres');
    }
    return false;
  };
  const allowed = allowedForRole(pathname);

  useEffect(() => {
    if (me.isError) router.replace('/login');
  }, [me.isError, router]);

  useEffect(() => {
    if (me.data && !allowed) router.replace(isStaff ? '/dashboard' : '/moi');
  }, [me.data, allowed, isStaff, router]);

  if (!me.data) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-10">
        <Skeleton className="mb-6 h-8 w-40" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!allowed) {
    // La page interdite n'est jamais montée : l'effet ci-dessus redirige.
    return null;
  }

  const user = me.data;
  const initials = `${user.givenName[0] ?? ''}${user.familyName[0] ?? ''}`.toUpperCase();
  const pending = stats.data?.pendingRequests ?? 0;
  const groups = isStaff ? staffNav(user.role) : personalNav(user.role);

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-60 flex-col border-r border-line bg-surface max-lg:hidden">
        {/* Marque */}
        <div className="flex items-center gap-2.5 px-4 pt-5 pb-4">
          <BrandMark size="md" />
          <div className="min-w-0 flex-1">
            <p className="text-sm leading-tight font-bold text-ink-strong">Teranga RH</p>
            <p className="truncate text-xs leading-tight text-ink-muted">{user.organizationName}</p>
          </div>
          <NotificationsBell />
        </div>

        {/* Navigation groupée */}
        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          {groups.map((group) => (
            <div key={group.label} className="mt-4 first:mt-1">
              <p className="px-2.5 pb-1.5 text-[11px] font-semibold tracking-wider text-ink-muted/80 uppercase">
                {group.label}
              </p>
              <div className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const active =
                    item.href === '/moi' ? pathname === '/moi' : pathname.startsWith(item.href);
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

      <div className="flex min-w-0 flex-1 flex-col">
        {/* En-tête mobile */}
        <header className="sticky top-0 z-20 flex items-center gap-2.5 border-b border-line bg-surface px-4 py-3 lg:hidden">
          <BrandMark size="sm" />
          <div className="min-w-0 flex-1">
            <p className="text-sm leading-tight font-bold text-ink-strong">Teranga RH</p>
            <p className="truncate text-[11px] leading-tight text-ink-muted">
              {user.organizationName}
            </p>
          </div>
          <NotificationsBell />
          <button
            type="button"
            title="Se déconnecter"
            aria-label="Se déconnecter"
            className="rounded-md p-1.5 text-ink-muted"
            onClick={async () => {
              await api('/auth/logout', { method: 'POST' });
              router.replace('/login');
            }}
          >
            <IconLogout size={16} />
          </button>
        </header>

        <main className="min-w-0 flex-1 px-4 py-6 pb-24 lg:px-8 lg:py-8 lg:pb-8">{children}</main>

        {/* Barre d'onglets mobile */}
        <nav className="fixed inset-x-0 bottom-0 z-20 flex justify-around gap-1 overflow-x-auto border-t border-line bg-surface px-2 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] lg:hidden">
          {groups
            .flatMap((g) => g.items)
            .map((item) => {
              const active =
                item.href === '/moi' ? pathname === '/moi' : pathname.startsWith(item.href);
              const IconCmp = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'relative flex min-w-14 flex-col items-center gap-0.5 rounded-md px-2 py-1 text-[10px] font-medium',
                    active ? 'text-primary' : 'text-ink-muted',
                  )}
                >
                  <IconCmp size={20} />
                  {item.badge === 'pending' && pending > 0 ? (
                    <span className="absolute top-0 right-2 size-2 rounded-full bg-danger" />
                  ) : null}
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
        </nav>
      </div>
    </div>
  );
}
