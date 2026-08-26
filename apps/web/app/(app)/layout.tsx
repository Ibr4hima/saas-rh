'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { cn, Skeleton } from '@teranga/ui';
import { BrandMark, BrandWordmark } from '../../components/brand-mark';
import { Icon, type IconName } from '../../components/icons';
import { PageTitleProvider, usePageTitleOverride } from '../../components/page-title';
import { NotificationsBell } from '../../components/notifications-bell';
import { api } from '../../lib/api';
import { useMe } from '../../lib/hooks';

interface DashboardStats {
  activeEmployees: number;
  pendingRequests: number;
  upcomingAbsences: number;
  orgUnits: number;
  pendingDocumentRequests: number;
}

interface NavItem {
  href: string;
  label: string;
  /** Libellé de la barre d'onglets mobile, où la place manque. */
  short?: string;
  icon: IconName;
  badge?: 'pending' | 'docs';
}

/**
 * Navigation à plat : neuf entrées se parcourent d'un regard. Les regroupions
 * en rubriques ajoutait trois lignes de titre à lire avant d'atteindre la
 * première destination — du bruit pour une liste de cette taille.
 */
const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Tableau de bord', short: 'Tableau', icon: 'dashboard' },
  { href: '/employees', label: 'Gestion du personnel', short: 'Personnel', icon: 'group' },
  {
    href: '/absences',
    label: 'Absences & Congés',
    short: 'Congés',
    icon: 'free_cancellation',
    badge: 'pending',
  },
  {
    href: '/documents',
    label: 'Demandes à traiter',
    short: 'Demandes',
    icon: 'folder_managed',
    badge: 'docs',
  },
  { href: '/calendrier', label: 'Calendrier', icon: 'event' },
  {
    href: '/recrutement',
    label: 'Dossiers de candidature',
    short: 'Candidatures',
    icon: 'person_add',
  },
  { href: '/evaluation', label: 'Évaluation des objectifs', short: 'Évaluation', icon: 'rule' },
  { href: '/organisation', label: 'Organigramme', short: 'Organig.', icon: 'family_history' },
  { href: '/reglementations', label: 'Lois & Règlementations', short: 'Lois', icon: 'gavel' },
];

/**
 * Titre de la page, tel qu'il s'affiche dans la barre supérieure. Il est
 * DÉDUIT de l'URL plutôt que remonté par chaque page : le titre appartient au
 * chrome de l'application, et un écran ne peut pas oublier de le déclarer.
 * Les fiches (employé, offre) portent un intitulé générique — leur contenu
 * nomme déjà la personne ou le poste, le répéter en tête n'apprend rien.
 */
const PAGE_TITLES: Record<string, string> = {
  '/employees': 'Gestion du personnel',
  '/employees/new': 'Nouvel employé',
  '/absences': 'Absences & Congés',
  '/absences/parametres': 'Paramètres des congés',
  '/documents': 'Demandes à traiter',
  '/calendrier': 'Calendrier',
  '/recrutement': 'Dossiers de candidature',
  '/recrutement/nouvelle': 'Nouvelle offre',
  '/evaluation': 'Évaluation des objectifs',
  '/organisation': 'Organigramme',
  '/reglementations': 'Lois & Règlementations',
  '/moi': 'Mon espace',
  '/moi/conges': 'Mes congés',
  '/moi/documents': 'Mes documents',
  '/moi/informations': 'Mes informations',
};

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Bonjour';
  if (h < 18) return 'Bon après-midi';
  return 'Bonsoir';
}

function pageTitle(pathname: string, givenName: string): string {
  if (pathname === '/dashboard') return `${greeting()}, ${givenName}`;
  const exact = PAGE_TITLES[pathname];
  if (exact) return exact;
  if (pathname.startsWith('/employees/')) {
    return pathname.endsWith('/modifier') ? 'Modifier la fiche' : 'Fiche employé';
  }
  if (pathname.startsWith('/recrutement/')) return 'Offre de recrutement';
  return 'Capital Humain';
}

/**
 * L'action principale de l'écran, réduite à une icône dans la barre. Une page
 * n'en a qu'UNE : si deux boutons se disputaient la tête de page, c'est que
 * l'un des deux n'était pas principal.
 */
interface ChromeAction {
  href: string;
  icon: IconName;
  label: string;
}

function pageAction(pathname: string, role: string): ChromeAction | null {
  const canManage = role === 'admin' || role === 'hr';
  if (!canManage) return null;
  if (pathname === '/employees') {
    return { href: '/employees?nouveau=1', icon: 'add', label: 'Nouvel employé' };
  }
  if (pathname === '/absences') {
    return { href: '/absences/parametres', icon: 'settings', label: 'Paramètres des congés' };
  }
  if (pathname === '/recrutement') {
    return { href: '/recrutement/nouvelle', icon: 'add', label: 'Nouvelle offre' };
  }
  // Fiche employé — et elle seule : /employees/<id>, jamais /employees/<id>/…
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 2 && parts[0] === 'employees' && parts[1] !== 'new') {
    return { href: `${pathname}?modifier=1`, icon: 'edit', label: 'Modifier la fiche' };
  }
  return null;
}

/**
 * Bouton d'action du bandeau : l'unique geste de l'écran. Verre translucide
 * plutôt qu'aplat — sur un fond de marque, un second aplat de marque ne se
 * détacherait pas.
 */
function HeaderAction({ action }: { action: ChromeAction }) {
  return (
    <Link
      href={action.href}
      title={action.label}
      aria-label={action.label}
      className="flex size-9 shrink-0 items-center justify-center rounded-full border border-white/30 bg-white/10 text-hero-ink transition-all duration-200 hover:border-white/55 hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
    >
      <Icon name={action.icon} size={20} />
    </Link>
  );
}

const STAFF_ROLES = ['admin', 'hr', 'payroll'];
/** Sections réservées admin/RH : cachées aux autres rôles staff (payroll). */
const MANAGE_ONLY_PATHS = ['/recrutement', '/documents'];

function staffNav(role: string): NavItem[] {
  if (role !== 'payroll') return NAV_ITEMS;
  return NAV_ITEMS.filter((i) => !MANAGE_ONLY_PATHS.some((p) => i.href.startsWith(p)));
}

/** Espace personnel : navigation réduite pour employés et managers. */
function personalNav(role: string): NavItem[] {
  return [
    { href: '/moi', label: 'Mon espace', short: 'Espace', icon: 'dashboard' },
    { href: '/moi/conges', label: 'Mes congés', short: 'Congés', icon: 'free_cancellation' },
    {
      href: '/moi/documents',
      label: 'Mes documents',
      short: 'Documents',
      icon: 'folder_managed',
    },
    { href: '/moi/informations', label: 'Mes informations', short: 'Infos', icon: 'badge' },
    ...(role === 'manager'
      ? [
          {
            href: '/absences',
            label: 'Validations',
            icon: 'how_to_reg' as const,
            badge: 'pending' as const,
          },
        ]
      : []),
    { href: '/calendrier', label: 'Calendrier', icon: 'event' },
    { href: '/organisation', label: 'Organigramme', short: 'Organig.', icon: 'family_history' },
  ];
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrateur',
  hr: 'RH',
  payroll: 'Gestionnaire de paie',
  manager: 'Manager',
  employee: 'Employé',
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <PageTitleProvider>
      <AppShell>{children}</AppShell>
    </PageTitleProvider>
  );
}

function AppShell({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const titleOverride = usePageTitleOverride();

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
  const pendingDocs = stats.data?.pendingDocumentRequests ?? 0;
  const badgeCount = (badge?: 'pending' | 'docs') =>
    badge === 'pending' ? pending : badge === 'docs' ? pendingDocs : 0;
  const items = isStaff ? staffNav(user.role) : personalNav(user.role);
  // L'écran a le dernier mot quand il connaît son objet (nom d'un employé…).
  const title = titleOverride ?? pageTitle(pathname, user.givenName);
  const action = pageAction(pathname, user.role);
  // La date ne vit que sur l'accueil : ailleurs elle n'informe de rien.
  const todayRaw = new Date().toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const todayLabel = `${todayRaw.charAt(0).toUpperCase()}${todayRaw.slice(1)}`;
  const subtitle = pathname === '/dashboard' ? todayLabel : null;
  const isActive = (href: string) =>
    href === '/moi' ? pathname === '/moi' : pathname.startsWith(href);

  return (
    /* Coquille d'application : la page elle-même ne défile pas. Le bandeau et
       la barre latérale restent en place, seul le contenu bouge — comme sur la
       plateforme APIX. */
    <div className="flex h-dvh flex-col overflow-hidden">
      {/* ———— Bandeau de tête, d'un bord à l'autre ———— */}
      <header className="hero-bar z-30 flex h-[58px] shrink-0 items-center gap-3.5 px-4 lg:gap-4 lg:px-7">
        <span aria-hidden className="pointer-events-none absolute inset-0 opacity-50">
          <span className="absolute -top-[140%] -right-[6%] size-[580px] rounded-full bg-[radial-gradient(circle,var(--tg-halo-clair)_0%,transparent_60%)]" />
          <span className="absolute -bottom-[160%] -left-[8%] size-[460px] rounded-full bg-[radial-gradient(circle,var(--tg-halo-bleu)_0%,transparent_65%)]" />
        </span>
        <Link
          href={isStaff ? '/dashboard' : '/moi'}
          aria-label="Accueil"
          className="relative z-10 flex shrink-0 items-center"
        >
          <BrandMark variant="hero" />
        </Link>

        <h1 className="relative z-10 min-w-0 truncate text-[18px] leading-tight font-extrabold tracking-[-0.01em] text-hero-ink lg:text-[19px]">
          {title}
        </h1>

        {subtitle ? (
          <span className="relative z-10 hidden shrink-0 rounded-full border border-white/25 bg-white/10 px-3.5 py-1.5 text-xs font-semibold text-hero-ink lg:inline-flex">
            {subtitle}
          </span>
        ) : null}

        <div className="relative z-10 ml-auto flex shrink-0 items-center gap-2">
          {action ? <HeaderAction action={action} /> : null}
          <NotificationsBell />
          <button
            type="button"
            title="Se déconnecter"
            aria-label="Se déconnecter"
            className="flex size-9 items-center justify-center rounded-full border border-white/30 bg-white/10 text-hero-ink transition-all duration-200 hover:border-white/55 hover:bg-white/20 lg:hidden"
            onClick={async () => {
              await api('/auth/logout', { method: 'POST' });
              router.replace('/login');
            }}
          >
            <Icon name="logout" size={18} />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Barre latérale — grammaire de la plateforme APIX : un intitulé de
            rubrique en très petites capitales grises, des rangées serrées, et
            l'entrée courante teintée à peine plutôt que peinte. La navigation
            est un instrument, pas une affiche. */}
        <aside className="flex w-[15.5rem] shrink-0 flex-col border-r border-line bg-surface max-lg:hidden">
          <div className="border-b border-line-soft px-4 pt-3.5 pb-2.5">
            <span className="text-[10px] font-bold tracking-[0.12em] text-ink-muted uppercase">
              {isStaff ? 'Navigation' : 'Mon espace'}
            </span>
          </div>

          <nav className="flex-1 overflow-y-auto px-2.5 py-3">
            <div className="flex flex-col gap-px">
              {items.map((item) => {
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-2.5 rounded-[7px] px-2.5 py-[7px] text-[12.5px] transition-colors duration-150',
                      active
                        ? 'bg-primary/[0.07] font-bold text-primary'
                        : 'font-medium text-ink hover:bg-bg',
                    )}
                  >
                    {/* Icône pleine sur l'entrée courante : la position dans le
                        menu se lit sans dépendre de la seule couleur. */}
                    <Icon name={item.icon} size={17} fill={active} />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {badgeCount(item.badge) > 0 ? (
                      <span className="rounded-full bg-accent px-[6px] py-px text-[10px] font-bold text-accent-ink">
                        {badgeCount(item.badge)}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          </nav>

          <div className="flex items-center gap-2.5 border-t border-line-soft px-4 py-3">
            <span className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-primary/[0.09] text-[10.5px] font-bold text-primary">
              {initials}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] leading-tight font-semibold text-ink-strong">
                {user.givenName} {user.familyName}
              </span>
              <span className="block truncate text-[10.5px] leading-tight text-ink-muted">
                {ROLE_LABELS[user.role] ?? user.role}
              </span>
            </span>
            <button
              type="button"
              title="Se déconnecter"
              aria-label="Se déconnecter"
              className="rounded-[7px] p-1.5 text-ink-muted transition-colors hover:bg-danger-soft hover:text-danger"
              onClick={async () => {
                await api('/auth/logout', { method: 'POST' });
                router.replace('/login');
              }}
            >
              <Icon name="logout" size={17} />
            </button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Le seul panneau qui défile. `data-scroll-root` le signale aux
              fenêtres modales, qui doivent le geler comme elles gèlent la page. */}
          <main
            data-scroll-root
            className="min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 pb-24 lg:px-7 lg:py-6 lg:pb-10"
          >
            {children}
          </main>
        </div>
      </div>

      {/* Barre d'onglets mobile */}
      <nav className="fixed inset-x-0 bottom-0 z-20 flex justify-around gap-1 overflow-x-auto border-t border-line-soft bg-surface px-2 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] lg:hidden">
        {items.map((item) => {
          const active = isActive(item.href);
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
              <Icon name={item.icon} size={22} fill={active} />
              {badgeCount(item.badge) > 0 ? (
                <span className="absolute top-0 right-2 size-2 rounded-full bg-accent" />
              ) : null}
              <span className="truncate">{item.short ?? item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
