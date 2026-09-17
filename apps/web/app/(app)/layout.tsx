'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { cn, Skeleton } from '@teranga/ui';
import { BrandMark } from '../../components/brand-mark';
import { Icon, type IconName } from '../../components/icons';
import { PageTitleProvider, usePageTitleOverride } from '../../components/page-title';
import { MenuCompte } from '../../components/menu-compte';
import { NotificationsBell } from '../../components/notifications-bell';
import { CalendrierModal } from '../../components/calendrier';
import { ANCRE_ONGLETS } from '../../components/onglets-bandeau';
import {
  Palette,
  useNomDuRaccourci,
  useRaccourciPalette,
  type EcranPalette,
} from '../../components/palette';
import { api } from '../../lib/api';
import { useMe } from '../../lib/hooks';

interface DashboardStats {
  activeEmployees: number;
  pendingRequests: number;
  upcomingAbsences: number;
  orgUnits: number;
  pendingDocumentRequests: number;
}

interface NavChild {
  href: string;
  label: string;
  /**
   * Sous-page ÉTEINTE — même règle que pour une entrée de premier rang : elle
   * garde sa place dans la liste, parce que l'ordre du menu est une carte
   * qu'on mémorise et qu'en retirer une ligne la redessine, mais elle ne mène
   * plus nulle part tant que l'écran n'est pas prêt.
   */
  desactive?: boolean;
}

/**
 * Les familles de la navigation, dans l'ordre où on les lit.
 *
 * Elles ne s'écrivent nulle part : un intitulé au-dessus de chaque famille
 * ajouterait cinq lignes à lire avant d'atteindre une destination. C'est le
 * BLANC entre les familles qui les sépare — l'œil range tout seul quatre
 * paquets de deux, là où neuf rangées à pas régulier ne disent rien de leur
 * parenté.
 */
type GroupeNav = 'pilotage' | 'effectif' | 'quotidien' | 'croissance' | 'cadre';

interface NavItem {
  href: string;
  label: string;
  /** La famille à laquelle l'entrée appartient — sépare sans s'écrire. */
  groupe?: GroupeNav;
  /** Libellé de la barre d'onglets mobile, où la place manque. */
  short?: string;
  icon: IconName;
  badge?: 'pending' | 'docs';
  /**
   * Entrée ÉTEINTE : elle reste à sa place dans la liste — l'ordre du menu
   * est une carte qu'on mémorise, et retirer une ligne la redessine — mais
   * elle ne mène plus nulle part tant que l'écran n'existe pas vraiment.
   */
  desactive?: boolean;
  /**
   * Rubrique dépliable. La rangée parente ne navigue plus — elle ouvre et
   * ferme. Un parent qui serait à la fois destination ET interrupteur rend le
   * clic ambigu : on ne sait pas ce qu'on va obtenir.
   */
  children?: NavChild[];
}

/**
 * Navigation à plat, rangée par familles.
 *
 * L'ordre suit le métier plutôt que l'ordre d'écriture des écrans : ce qu'on
 * regarde en arrivant, puis les gens, puis ce qui arrive tous les jours, puis
 * ce qui fait grandir l'effectif, puis le cadre qui s'applique à tout. On ne
 * regroupe toujours pas en rubriques titrées — neuf entrées se parcourent
 * d'un regard — mais le blanc entre les familles fait le travail d'un titre
 * sans en coûter la ligne.
 */
const NAV_ITEMS: NavItem[] = [
  {
    href: '/dashboard',
    label: 'Tableau de bord',
    short: 'Tableau',
    icon: 'dashboard',
    groupe: 'pilotage',
  },
  {
    // Le calendrier a aussi sa fenêtre dans le bandeau, et c'est le geste
    // courant. Il garde une entrée de menu parce que la fenêtre ne se trouve
    // que si l'on sait déjà qu'elle est derrière la date — une destination
    // nommée est le seul endroit où l'on peut la DÉCOUVRIR.
    href: '/calendrier',
    // L'intitulé dit ce qu'on y trouve. « Calendrier » promettait le planning
    // des absences, qui vit dans la fenêtre du bandeau ; la page, elle, ne
    // porte que les fériés de l'année. La barre d'onglets du téléphone garde
    // le mot court : sur cinquante-six pixels, rien d'autre ne tient.
    label: 'Calendrier · Jours fériés',
    short: 'Calendrier',
    icon: 'calendar_month',
    groupe: 'pilotage',
  },
  {
    href: '/employees',
    label: 'Gestion du personnel',
    short: 'Personnel',
    icon: 'group',
    groupe: 'effectif',
  },
  {
    href: '/organisation',
    label: 'Organigramme',
    short: 'Organig.',
    icon: 'family_history',
    groupe: 'effectif',
  },
  {
    href: '/absences',
    label: 'Absences & Congés',
    short: 'Congés',
    icon: 'free_cancellation',
    badge: 'pending',
    groupe: 'quotidien',
    children: [
      { href: '/absences', label: 'Gestion des demandes' },
      { href: '/absences/feries', label: 'Gestion des jours fériés' },
      { href: '/absences/parametres', label: 'Paramètres des congés', desactive: true },
    ],
  },
  {
    href: '/documents',
    label: 'Demandes à traiter',
    short: 'Demandes',
    icon: 'folder_managed',
    badge: 'docs',
    groupe: 'quotidien',
  },
  {
    href: '/recrutement',
    label: 'Recrutement',
    short: 'Recrut.',
    icon: 'person_add',
    groupe: 'croissance',
    children: [
      { href: '/recrutement', label: "Offres d'emploi" },
      { href: '/recrutement/candidatures', label: 'Dossiers de candidature' },
    ],
  },
  {
    href: '/evaluation',
    label: 'Évaluation des objectifs',
    short: 'Évaluation',
    icon: 'rule',
    groupe: 'croissance',
    desactive: true,
  },
  {
    href: '/reglementations',
    label: 'Lois & Règlementations',
    short: 'Lois',
    icon: 'gavel',
    groupe: 'cadre',
    children: [
      { href: '/reglementations/code-du-travail', label: 'Code du travail' },
      { href: '/reglementations/reglement-interieur', label: 'Règlement intérieur' },
    ],
  },
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
  '/absences/feries': 'Jours fériés',
  '/absences/parametres': 'Paramètres des congés',
  '/documents': 'Demandes à traiter',
  '/calendrier': 'Calendrier · Jours fériés',
  '/recrutement': "Offres d'emploi",
  '/recrutement/candidatures': 'Dossiers de candidature',
  '/recrutement/nouvelle': 'Nouvelle offre',
  '/evaluation': 'Évaluation des objectifs',
  '/organisation': 'Organigramme',
  '/reglementations/code-du-travail': 'Code du travail',
  '/reglementations/reglement-interieur': 'Règlement intérieur',
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
  // Une fiche garde le titre de sa SECTION : le dossier nomme déjà la personne
  // en gros caractères, trois centimètres plus bas. Le bandeau, lui, dit où
  // l'on se trouve dans l'application — c'est le seul endroit qui le dise.
  if (pathname.startsWith('/employees/')) {
    return pathname.endsWith('/modifier') ? 'Modifier la fiche' : 'Gestion du personnel';
  }
  if (pathname.startsWith('/recrutement/')) return 'Offre de recrutement';
  if (pathname.endsWith('/deposer')) return 'Dépôt du texte';
  // Un troisième texte — convention collective, accord d'entreprise — entrera
  // sans qu'on ait à revenir ici.
  if (pathname.startsWith('/reglementations/')) return 'Lois & Règlementations';
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
  if (pathname === '/recrutement') {
    return { href: '/recrutement?nouvelle=1', icon: 'add', label: 'Nouvelle offre' };
  }
  if (pathname === '/organisation') {
    return { href: '/organisation?nouvelle=1', icon: 'add', label: 'Nouvelle unité' };
  }
  const parts = pathname.split('/').filter(Boolean);
  // Un texte de référence — /reglementations/<slug> — et non son écran de
  // dépôt, qui a ses propres boutons.
  if (parts.length === 2 && parts[0] === 'reglementations') {
    return { href: `${pathname}/deposer`, icon: 'edit', label: 'Déposer le texte' };
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

/**
 * Espace personnel : navigation réduite, rangée par les mêmes familles.
 *
 * Ce qu'on regarde (mon espace, le calendrier), ce qu'on demande (congés,
 * documents), ce qu'on est (mes informations), le cadre (les textes). Les
 * validations d'un manager tiennent à part : c'est le seul endroit où il
 * décide pour un autre.
 */
function personalNav(role: string): NavItem[] {
  return [
    { href: '/moi', label: 'Mon espace', short: 'Espace', icon: 'dashboard', groupe: 'pilotage' },
    {
      href: '/calendrier',
      label: 'Calendrier · Jours fériés',
      short: 'Calendrier',
      icon: 'calendar_month',
      groupe: 'pilotage',
    },
    {
      href: '/moi/conges',
      label: 'Mes congés',
      short: 'Congés',
      icon: 'free_cancellation',
      groupe: 'quotidien',
    },
    {
      href: '/moi/documents',
      label: 'Mes documents',
      short: 'Documents',
      icon: 'folder_managed',
      groupe: 'quotidien',
    },
    {
      href: '/moi/informations',
      label: 'Mes informations',
      short: 'Infos',
      icon: 'badge',
      groupe: 'quotidien',
    },
    // Le seul endroit où un manager décide pour un autre : il tient sa
    // famille à lui, entre ce qui le concerne et ce qu'il consulte.
    ...(role === 'manager'
      ? [
          {
            href: '/absences',
            label: 'Validations',
            short: 'Visas',
            icon: 'how_to_reg' as const,
            badge: 'pending' as const,
            groupe: 'croissance' as const,
          },
        ]
      : []),
    // L'organigramme rejoint les textes de référence : côté agent, ce n'est
    // pas un outil de travail, c'est quelque chose qu'on CONSULTE — comme le
    // Code du travail ou le règlement intérieur.
    {
      href: '/organisation',
      label: 'Organigramme',
      short: 'Organig.',
      icon: 'family_history',
      groupe: 'cadre',
    },
    {
      href: '/reglementations',
      label: 'Lois & Règlementations',
      short: 'Lois',
      icon: 'gavel',
      groupe: 'cadre',
      children: [
        { href: '/reglementations/code-du-travail', label: 'Code du travail' },
        { href: '/reglementations/reglement-interieur', label: 'Règlement intérieur' },
      ],
    },
  ];
}

/** Une entrée simple de la barre latérale. */
function RangeeNav({
  href,
  label,
  icon,
  active,
  badge,
  desactive,
}: {
  href: string;
  label: string;
  icon?: IconName;
  active: boolean;
  badge?: number;
  desactive?: boolean;
}) {
  const contenu = (
    <>
      {/* Icône pleine sur l'entrée courante : la position dans le menu se lit
          sans dépendre de la seule couleur. */}
      {icon ? <Icon name={icon} size={17} fill={active && !desactive} /> : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge && badge > 0 ? (
        <span className="rounded-full bg-alert-soft px-[6px] py-px text-[10px] font-extrabold text-alert-text">
          {badge}
        </span>
      ) : null}
    </>
  );

  const forme =
    'relative flex items-center gap-2.5 rounded-[10px] py-[8px] pr-2.5 pl-3.5 text-[12.5px] transition-colors duration-150';

  // Éteinte, la rangée n'est plus un lien DU TOUT : la griser sans la
  // désarmer laisserait le clic passer, et le curseur promettrait une
  // destination qui n'existe pas encore.
  if (desactive) {
    return (
      <span
        aria-disabled
        className={cn(forme, 'cursor-not-allowed font-medium text-ink-muted/45 select-none')}
      >
        {contenu}
      </span>
    );
  }

  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        forme,
        active ? 'bg-primary/[0.07] font-bold text-primary' : 'font-medium text-ink hover:bg-hover',
      )}
    >
      {/* Le repère de l'entrée courante. L'aplat pâle et le gras la
          désignaient déjà ; le trait vertical la désigne DE LOIN, avant même
          qu'on lise — c'est lui qu'on suit du regard en revenant à la colonne
          après avoir travaillé à droite. Bleu, comme toute la structure du
          produit : l'orange de la charte est réservé à ce qui attend un
          geste, et une position dans un menu n'attend rien. */}
      {active ? <RepereActif /> : null}
      {contenu}
    </Link>
  );
}

/** Le trait vertical de l'entrée courante — 2,5 px, arrondi, centré. */
function RepereActif() {
  return (
    <span
      aria-hidden
      className="absolute top-1/2 left-[4px] h-[15px] w-[2.5px] -translate-y-1/2 rounded-full bg-primary"
    />
  );
}

/**
 * Rubrique dépliable.
 *
 * Dépliée d'emblée, et repliable à la main. Elle se rouvre d'elle-même quand
 * on arrive à l'intérieur par un lien — voir sa rubrique fermée, c'est perdre
 * où l'on est. La rangée parente n'est pas un lien : elle ouvre. Les sous-pages
 * sont reliées par un filet vertical, qui dit l'appartenance sans réécrire le
 * nom de la rubrique sur chaque ligne.
 */
function Rubrique({
  item,
  contientLaPageCourante,
  badge,
  estActive,
}: {
  item: NavItem;
  contientLaPageCourante: boolean;
  /** Le compteur de la rubrique : il vit sur la rangée parente, ouverte ou non. */
  badge?: number;
  estActive: (href: string) => boolean;
}) {
  // Dépliée d'emblée : le menu montre d'un regard tout ce qu'il contient. Une
  // rubrique fermée cache des destinations que rien n'annonce, et il faut
  // cliquer pour savoir ce qu'on y trouve.
  const [ouverte, setOuverte] = useState(true);
  // Le chemin change (clic ailleurs dans le menu, retour arrière) : la rubrique
  // qui contient la page courante doit s'ouvrir, sans refermer les autres.
  useEffect(() => {
    if (contientLaPageCourante) setOuverte(true);
  }, [contientLaPageCourante]);

  const enfants = item.children ?? [];
  const contientLaPage = enfants.some((c) => estActive(c.href));

  /**
   * Une seule sous-page s'allume : LA PLUS PRÉCISE.
   *
   * « Gestion des demandes » vit à /absences et « Jours fériés » à
   * /absences/feries : la règle par préfixe allumerait les deux, et la
   * première mentirait sur l'endroit où l'on se trouve. On garde donc le
   * chemin correspondant le plus long — ce qui vaut pour toute rubrique dont
   * un enfant est la racine des autres, sans avoir à l'énumérer.
   */
  const enfantActif = enfants
    .filter((c) => estActive(c.href))
    .reduce<string | null>(
      (long, c) => (long && long.length >= c.href.length ? long : c.href),
      null,
    );

  return (
    <div className="flex flex-col gap-px">
      <button
        type="button"
        onClick={() => setOuverte((v) => !v)}
        aria-expanded={ouverte}
        className={cn(
          'relative flex items-center gap-2 rounded-[10px] py-[8px] pr-2.5 pl-3.5 text-left text-[12.5px] transition-colors duration-150',
          // Repliée sur la page courante, la rubrique porte l'état actif ;
          // dépliée, elle le laisse à la sous-page pour ne pas l'allumer deux
          // fois sur la même colonne.
          contientLaPage && !ouverte
            ? 'bg-primary/[0.07] font-bold text-primary'
            : contientLaPage
              ? // Dépliée, la rubrique s'allège : la sous-page porte déjà l'état
                // actif, et deux bleus gras l'un sous l'autre alourdissent la
                // colonne — en plus de faire déborder « Lois & Règlementations ».
                'font-semibold text-primary hover:bg-hover'
              : 'font-medium text-ink hover:bg-hover',
        )}
      >
        {contientLaPage && !ouverte ? <RepereActif /> : null}
        <Icon name={item.icon} size={17} fill={contientLaPage} />
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {/* Le compteur reste sur le parent : replié, c'est le seul endroit où
            il puisse se voir ; déplié, il dit lequel des deux ensembles
            réclame un geste sans qu'on ait à le chercher plus bas. */}
        {badge && badge > 0 ? (
          <span className="rounded-full bg-alert-soft px-[6px] py-px text-[10px] font-extrabold text-alert-text">
            {badge}
          </span>
        ) : null}
        <Icon
          name="chevron_right"
          size={14}
          className={cn(
            'shrink-0 text-ink-muted transition-transform duration-200',
            ouverte && 'rotate-90',
          )}
        />
      </button>

      {ouverte ? (
        <div className="relative ml-[1.4rem] flex flex-col gap-px border-l border-line-soft pl-2.5">
          {enfants.map((c) => {
            const active = c.href === enfantActif;
            const forme = 'relative rounded-[9px] px-2.5 py-[6.5px] text-[12px]';
            // Éteinte, la sous-page n'est plus un lien DU TOUT : la griser sans
            // la désarmer laisserait le clic passer, et le curseur promettrait
            // une destination qui n'est pas prête.
            if (c.desactive) {
              return (
                <span
                  key={c.href}
                  aria-disabled
                  className={cn(
                    forme,
                    'cursor-not-allowed font-medium text-ink-muted/45 select-none',
                  )}
                >
                  {c.label}
                </span>
              );
            }
            return (
              <Link
                key={c.href}
                href={c.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  forme,
                  'transition-colors duration-150',
                  active
                    ? 'bg-primary/[0.07] font-bold text-primary'
                    : 'font-medium text-ink-muted hover:bg-hover hover:text-ink',
                )}
              >
                {c.label}
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * La date du jour, dans le bandeau — et le calendrier derrière.
 *
 * C'est le geste COURANT : on ouvre le planning là où on lit la date, on
 * referme, et on est revenu exactement où l'on était — ce qu'une page ne
 * permet pas. Le menu porte malgré tout une entrée « Calendrier », parce
 * qu'une fenêtre cachée derrière une date ne se trouve que si l'on sait
 * déjà qu'elle est là. Le raccourci sert ceux qui savent ; la destination
 * nommée sert ceux qui apprennent.
 */
function DateDuJour() {
  const [ouvert, setOuvert] = useState(false);
  const brut = new Date().toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const libelle = `${brut.charAt(0).toUpperCase()}${brut.slice(1)}`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOuvert(true)}
        // Plus « des absences » : la fenêtre ne les porte plus.
        title="Calendrier"
        aria-label={`${libelle} — ouvrir le calendrier`}
        className="flex h-9 shrink-0 items-center gap-2 rounded-full border border-white/30 bg-white/10 px-3 text-hero-ink transition-all duration-200 hover:border-white/55 hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none lg:px-3.5"
      >
        <Icon name="calendar_month" size={18} />
        {/* Sous 1024 px, l'icône suffit : la date complète y mangerait la
            place du titre de l'écran. */}
        <span className="hidden text-xs font-semibold whitespace-nowrap lg:inline">{libelle}</span>
      </button>

      <CalendrierModal open={ouvert} onClose={() => setOuvert(false)} />
    </>
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
  const [palette, setPalette] = useState(false);
  const ouvrirPalette = useCallback(() => setPalette(true), []);
  const fermerPalette = useCallback(() => setPalette(false), []);
  useRaccourciPalette(ouvrirPalette);
  const raccourci = useNomDuRaccourci();

  const items = useMemo(() => (isStaff ? staffNav(role) : personalNav(role)), [isStaff, role]);
  // Les écrans que la palette sait ouvrir : le menu, mis à plat, avec le
  // chemin qu'on aurait suivi pour y arriver — c'est ce qu'on tape. Une
  // rubrique n'a pas de page à elle : seules ses sous-pages sont des écrans.
  const ecrans = useMemo<EcranPalette[]>(
    () =>
      items.flatMap((i) =>
        i.desactive
          ? []
          : i.children
            ? // Une sous-page éteinte n'est pas une destination : la palette
              // la proposerait sans que le menu la laisse ouvrir.
              i.children
                .filter((c) => !c.desactive)
                .map((c) => ({
                  href: c.href,
                  label: c.label,
                  icon: i.icon,
                  chemin: i.label,
                }))
            : [{ href: i.href, label: i.label, icon: i.icon }],
      ),
    [items],
  );

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
    // Les textes de référence aussi, et à plus forte raison : un règlement
    // intérieur que seule la RH peut ouvrir ne s'oppose à personne.
    if (path.startsWith('/reglementations')) return true;
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

  // L'écran a le dernier mot quand il connaît son objet (nom d'un employé…).
  const title = titleOverride ?? pageTitle(pathname, user.givenName);
  const action = pageAction(pathname, user.role);
  const isActive = (href: string) =>
    href === '/moi' ? pathname === '/moi' : pathname.startsWith(href);
  /** Une sous-page couvre son chemin et ce qui en descend. */
  const isChildActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    /* Coquille d'application : la page elle-même ne défile pas. Le bandeau et
       la barre latérale restent en place, seul le contenu bouge — comme sur la
       plateforme APIX. */
    <div className="flex h-dvh flex-col overflow-hidden">
      {/* ———— Bandeau de tête, d'un bord à l'autre ———— */}
      <header className="hero-bar z-30 flex h-[58px] shrink-0 items-center gap-3.5 px-4 lg:gap-4 lg:px-7">
        <Link
          href={isStaff ? '/dashboard' : '/moi'}
          aria-label="Accueil"
          className="relative z-10 flex shrink-0 items-center"
        >
          <BrandMark variant="hero" />
        </Link>

        <h1 className="relative z-10 min-w-0 truncate text-[17px] leading-tight font-extrabold tracking-[-0.01em] text-hero-ink sm:text-[18px] lg:text-[19px]">
          {title}
        </h1>

        {/* Emplacement laissé aux écrans qui ont des onglets à poser ici. La
            coquille ne sait pas lesquels : elle réserve la place, la page y
            écrit par un portail (cf. components/onglets-bandeau.tsx). */}
        <div id={ANCRE_ONGLETS} className="relative z-10 hidden shrink-0 md:flex" />

        <div className="relative z-10 ml-auto flex shrink-0 items-center gap-2">
          {action ? <HeaderAction action={action} /> : null}
          <DateDuJour />
          {/* La recherche avait l'air d'un champ sans en être un : c'était un
              bouton déguisé, large de deux cent quarante pixels, qui invitait
              à taper là où rien ne se tape — la frappe se fait dans la
              palette, qui a la place d'afficher ce qu'elle trouve. Réduite à
              son icône, elle rejoint les autres commandes du bandeau et cesse
              de promettre ce qu'elle ne fait pas. Le raccourci n'est plus
              écrit dessus : il reste dans l'infobulle et dans l'intitulé
              accessible, et la palette l'affiche en grand quand on l'ouvre. */}
          <button
            type="button"
            onClick={() => setPalette(true)}
            aria-label={`Rechercher (${raccourci})`}
            title={`Rechercher — ${raccourci}`}
            className="flex size-9 shrink-0 items-center justify-center rounded-full border border-white/30 bg-white/10 text-hero-ink transition-all duration-200 hover:border-white/55 hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
          >
            <Icon name="search" size={20} />
          </button>
          <NotificationsBell />
          {/* Sur téléphone la colonne n'existe pas : sans ce menu, ni le
              thème ni la sortie ne seraient atteignables. */}
          <span className="lg:hidden">
            <MenuCompte variante="bandeau" />
          </span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ———— Le menu, POSÉ sur la page ————

            Une colonne blanche collée au bord de la fenêtre, séparée par un
            filet, se lit comme une pièce du cadre — au même titre qu'une
            barre de défilement. Posée en carte — coins arrondis, filet pâle,
            ombre d'un pixel — elle se lit comme un OBJET, dans la grammaire
            exacte des cartes de contenu à sa droite : l'application cesse
            d'avoir deux vocabulaires selon le côté de l'écran.

            Le blanc de la page passe tout autour, et c'est lui qui fait le
            relief — pas une ombre portée, qui ferait flotter la colonne
            au-dessus du contenu au lieu de la poser à côté. */}
        <aside className="hidden w-[17rem] shrink-0 flex-col gap-3 py-3.5 pl-3.5 lg:flex">
          {/* La carte DESCEND jusqu'en bas.

              Elle épousait ses rangées, pour ne pas laisser sous la dernière
              entrée un panneau blanc de trois cents pixels. L'argument valait
              tant que le contenu à droite s'arrêtait lui aussi à mi-hauteur :
              deux colonnes courtes se répondaient. Le contenu occupe
              désormais l'écran, et c'est la colonne écourtée qui devient le
              seul trou de la page — un blanc encadré, lui, se lit comme la
              réserve d'un tableau qui attend ses lignes, pas comme un oubli.

              Elle défile à l'intérieur si la liste dépasse. */}
          <nav className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[18px] border border-card-line bg-surface shadow-xs">
            <p className="shrink-0 px-4 pt-4 pb-2 text-[10px] font-bold tracking-[0.12em] text-ink-muted uppercase">
              {isStaff ? 'Navigation' : 'Mon espace'}
            </p>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
              {items.map((item, i) => {
                // Le blanc entre deux familles vaut un intitulé, et ne coûte
                // pas de ligne. Il se calcule sur l'entrée PRÉCÉDENTE RENDUE,
                // pas sur l'ordre d'écriture : la navigation d'un rôle paie
                // est amputée de deux entrées, et une famille réduite à rien
                // ne doit pas laisser un trou derrière elle.
                const changeDeFamille = i > 0 && item.groupe !== items[i - 1]!.groupe;
                return (
                  <div key={item.href} className={cn(changeDeFamille && 'mt-3')}>
                    {item.children ? (
                      <Rubrique
                        item={item}
                        contientLaPageCourante={isActive(item.href)}
                        badge={badgeCount(item.badge)}
                        estActive={isChildActive}
                      />
                    ) : (
                      <RangeeNav
                        href={item.href}
                        label={item.label}
                        icon={item.icon}
                        active={isActive(item.href)}
                        badge={badgeCount(item.badge)}
                        desactive={item.desactive}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </nav>

          {/* Qui je suis, dans sa propre carte : ce n'est pas une destination
              de plus au bas de la liste, c'est l'identité de la session. */}
          <div className="mt-auto flex shrink-0 items-center gap-2.5 rounded-[18px] border border-card-line bg-surface px-3 py-2.5 shadow-xs">
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
            <MenuCompte variante="colonne" />
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
          // Une rubrique n'a pas de page à elle : l'onglet mène à sa première
          // sous-page, sinon il ouvrirait une redirection au lieu d'un écran.
          const cible = item.children?.[0]?.href ?? item.href;
          const forme =
            'relative flex min-w-14 flex-col items-center gap-0.5 rounded-md px-2 py-1 text-[10px] font-medium';
          const contenu = (
            <>
              <Icon name={item.icon} size={22} fill={active && !item.desactive} />
              {badgeCount(item.badge) > 0 ? (
                <span className="absolute top-0 right-2 size-2 rounded-full bg-alert" />
              ) : null}
              <span className="truncate">{item.short ?? item.label}</span>
            </>
          );
          if (item.desactive) {
            return (
              <span
                key={item.href}
                aria-disabled
                className={cn(forme, 'cursor-not-allowed text-ink-muted/40 select-none')}
              >
                {contenu}
              </span>
            );
          }
          return (
            <Link
              key={item.href}
              href={cible}
              aria-current={active ? 'page' : undefined}
              className={cn(forme, active ? 'text-primary' : 'text-ink-muted')}
            >
              {contenu}
            </Link>
          );
        })}
      </nav>

      <Palette
        ouverte={palette}
        onFermer={fermerPalette}
        ecrans={ecrans}
        peutChercherLesAgents={isStaff}
      />
    </div>
  );
}
