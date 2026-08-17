'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Skeleton } from '@teranga/ui';
import { api } from '../../lib/api';
import { useMe } from '../../lib/hooks';

const NAV = [
  { href: '/employees', label: 'Employés' },
  { href: '/organisation', label: 'Organisation' },
  { href: '/import', label: 'Import' },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();

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

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 flex-col border-r border-line bg-surface px-3 py-5">
        <div className="mb-6 px-2">
          <p className="text-sm font-bold text-ink-strong">Teranga RH</p>
          <p className="truncate text-xs text-ink-muted">{user.organizationName}</p>
        </div>
        <nav className="flex flex-col gap-1">
          {NAV.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={
                  active
                    ? 'rounded-md bg-primary-soft px-2.5 py-1.5 text-sm font-medium text-primary'
                    : 'rounded-md px-2.5 py-1.5 text-sm text-ink-muted transition-colors hover:bg-line-soft hover:text-ink'
                }
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto border-t border-line-soft px-2 pt-4">
          <p className="truncate text-sm font-medium text-ink-strong">
            {user.givenName} {user.familyName}
          </p>
          <p className="text-xs text-ink-muted">{roleLabel(user.role)}</p>
          <button
            type="button"
            className="mt-2 text-xs text-ink-muted hover:text-danger"
            onClick={async () => {
              await api('/auth/logout', { method: 'POST' });
              router.replace('/login');
            }}
          >
            Se déconnecter
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-8 py-8">{children}</main>
    </div>
  );
}

function roleLabel(role: string): string {
  const labels: Record<string, string> = {
    admin: 'Administrateur',
    hr: 'RH',
    payroll: 'Gestionnaire de paie',
    manager: 'Manager',
    employee: 'Employé',
  };
  return labels[role] ?? role;
}
