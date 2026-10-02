'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CAPACITES_DOCUMENTS,
  CAPACITES_PIECES,
  gereQuelqueChose,
  nomCourt,
  peut,
  type CompteursValidations,
  type SessionUser,
  type TeamSize,
} from '@teranga/contracts';
import { cn, Skeleton } from '@teranga/ui';
import { BrandMark } from '../../components/brand-mark';
import { Icon, type IconName } from '../../components/icons';
import { PageTitleProvider, usePageTitleOverride } from '../../components/page-title';
import { MenuCompte } from '../../components/menu-compte';
import { NotificationsBell } from '../../components/notifications-bell';
import {
  EspaceProvider,
  espaceDeLaPage,
  useEspaceChoisi,
  type Espace,
} from '../../components/espace';
import {
  InfoBulle,
  SousMenuFlottant,
  survolAvecBulle,
  useMenuReplie,
  type Bulle,
} from '../../components/colonne-repliable';
import { ANCRE_ONGLETS } from '../../components/onglets-bandeau';
import { RechercheAcademy } from '../../components/recherche-academy';
import { api } from '../../lib/api';
import { useMe } from '../../lib/hooks';

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
  badge?: 'visas' | 'traiter';
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
    href: '/employees',
    label: 'Gestion du personnel',
    short: 'Personnel',
    icon: 'group',
    groupe: 'effectif',
  },
  {
    // Les CDD et stages qui arrivent à leur terme : l'alerte y mène.
    href: '/contrats',
    label: 'Échéances de contrat',
    short: 'Contrats',
    icon: 'schedule',
    groupe: 'effectif',
  },
  {
    href: '/organisation',
    label: 'Organigramme',
    short: 'Organig.',
    icon: 'family_history',
    groupe: 'effectif',
  },
  // « Déléguer des tâches » et « Demandes à traiter » s'insèrent ici, selon
  // ce que l'agent traite pour la DCH (cf. navigationGestion). Les demandes de
  // congé se traitent sous « Demandes à traiter › Absences & Congés » ; leurs
  // réglages ont leur page.
  {
    href: '/absences/parametres',
    label: 'Paramètres des congés',
    short: 'Paramètres',
    icon: 'settings',
    groupe: 'quotidien',
  },
  {
    href: '/absences/feries',
    label: 'Gestion des jours fériés',
    short: 'Fériés',
    icon: 'event',
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
  // ——— Ce qui fait grandir l'effectif, dans l'ordre du cycle : on recrute,
  // on forme, on mesure.
  {
    // Les formations de l'agence, en ligne : l'Academy a pris la place de la
    // rubrique « Formations », qui n'annonçait qu'un écran à venir.
    href: '/academy',
    label: 'APIX Academy',
    short: 'Academy',
    icon: 'school',
    groupe: 'croissance',
  },
  {
    href: '/evaluation',
    label: 'Évaluation des objectifs',
    short: 'Évaluation',
    icon: 'rule',
    groupe: 'croissance',
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
  '/contrats': 'Échéances de contrat',
  '/absences': 'Absences & Congés',
  '/absences/feries': 'Gestion des jours fériés',
  '/absences/parametres': 'Paramètres des congés',
  '/documents': 'Demandes de documents',
  '/demandes/informations': 'Mise à jour d’infos',
  '/demandes/pieces': 'Vérification des documents',
  '/moi/delegations': 'Déléguer des tâches',
  '/calendrier': 'Calendrier · Jours fériés',
  '/recrutement': "Offres d'emploi",
  '/recrutement/candidatures': 'Dossiers de candidature',
  '/recrutement/nouvelle': 'Nouvelle offre',
  '/academy': 'APIX Academy',
  '/academy/gerer': 'Gérer le catalogue',
  '/academy/equipe': 'Mon équipe',
  '/evaluation': 'Évaluation des objectifs',
  '/organisation': 'Organigramme',
  '/reglementations/code-du-travail': 'Code du travail',
  '/reglementations/reglement-interieur': 'Règlement intérieur',
  '/moi/conges': 'Poser une demande',
  '/moi/conges/historique': 'Historique',
  '/moi/equipe': 'Demandes à viser',
  '/moi/equipe/suivi': 'Suivi & Évaluation',
  '/moi/objectifs': 'Mes objectifs',
  '/moi/objectifs-apix': 'Objectifs de l’APIX',
  '/moi/dch': 'Absences & Congés',
  '/moi/documents': 'Demander un document',
  '/moi/documents/suivi': 'Suivi de mes demandes',
  '/moi/documents/justificatifs': 'Joindre un document',
};

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Bonjour';
  if (h < 18) return 'Bon après-midi';
  return 'Bonsoir';
}

function pageTitle(pathname: string, givenName: string): string {
  // Les deux accueils — le tableau de bord, et « Mes infos personnelles » —
  // saluent : c'est là qu'on arrive.
  if (pathname === '/dashboard' || pathname === '/moi') return `${greeting()}, ${givenName}`;
  const exact = PAGE_TITLES[pathname];
  if (exact) return exact;
  // Une fiche garde le titre de sa SECTION : le dossier nomme déjà la personne
  // en gros caractères, trois centimètres plus bas. Le bandeau, lui, dit où
  // l'on se trouve dans l'application — c'est le seul endroit qui le dise.
  if (pathname.startsWith('/employees/')) {
    return pathname.endsWith('/modifier') ? 'Modifier la fiche' : 'Gestion du personnel';
  }
  if (pathname.startsWith('/recrutement/')) return 'Offre de recrutement';
  if (pathname.startsWith('/academy/gerer/')) return 'Gérer le catalogue';
  if (pathname.startsWith('/academy/equipe/')) return 'Mon équipe';
  if (pathname.startsWith('/moi/equipe/suivi/')) return 'Suivi & Évaluation';
  if (pathname.startsWith('/academy/')) return 'APIX Academy';
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

function pageAction(pathname: string, user: SessionUser, espace: Espace): ChromeAction | null {
  if (pathname === '/employees' && peut(user, 'personnel.gerer')) {
    return { href: '/employees?nouveau=1', icon: 'add', label: 'Nouvel employé' };
  }
  if (pathname === '/recrutement' && peut(user, 'recrutement.offres')) {
    return { href: '/recrutement?nouvelle=1', icon: 'add', label: 'Nouvelle offre' };
  }
  // Les pages des deux espaces n'offrent leurs gestes de gestion que côté
  // Gestion RH : dans « Mon espace », on est un agent comme les autres.
  if (pathname === '/organisation' && peut(user, 'organigramme') && espace === 'gestion') {
    return { href: '/organisation?nouvelle=1', icon: 'add', label: 'Nouvelle unité' };
  }
  if (pathname === '/academy' && peut(user, 'academy') && espace === 'gestion') {
    return { href: '/academy/gerer', icon: 'settings', label: 'Gérer le catalogue' };
  }
  if (pathname === '/academy/gerer' && peut(user, 'academy')) {
    return { href: '/academy/gerer?nouvelle=1', icon: 'add', label: 'Nouvelle formation' };
  }
  const parts = pathname.split('/').filter(Boolean);
  // Un texte de référence — /reglementations/<slug> — et non son écran de
  // dépôt, qui a ses propres boutons.
  if (
    parts.length === 2 &&
    parts[0] === 'reglementations' &&
    peut(user, 'textes') &&
    espace === 'gestion'
  ) {
    return { href: `${pathname}/deposer`, icon: 'edit', label: 'Déposer le texte' };
  }
  return null;
}

/**
 * Le réglage d'un écran, dans le bandeau, juste avant la recherche : la
 * gestion des jours fériés s'ouvre aussi depuis le calendrier, à qui la
 * gère. Côté Gestion RH seulement, comme tout geste de gestion sur une page
 * des deux espaces.
 */
function pageReglage(pathname: string, user: SessionUser, espace: Espace): ChromeAction | null {
  if (pathname === '/calendrier' && espace === 'gestion' && peut(user, 'feries')) {
    return { href: '/absences/feries', icon: 'settings', label: 'Gestion des jours fériés' };
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

/**
 * L'espace APIX Academy, côté apprenant : le catalogue, les formations, les
 * leçons, l'évaluation, « Ma liste », « Mes certificats ». On y vient pour
 * apprendre — le bandeau s'y allège : ni date, ni recherche, ni cloche, et le
 * signet de « Ma liste » à leur place. L'atelier de la DCH (/academy/gerer)
 * reste un écran de gestion, avec le bandeau de gestion.
 */
function espaceAcademy(pathname: string): boolean {
  return (
    pathname === '/academy' ||
    (pathname.startsWith('/academy/') && !pathname.startsWith('/academy/gerer'))
  );
}

/**
 * Un raccourci rond du bandeau de l'Academy : « Mes certificats », « Ma
 * liste ». Plein quand on est sur sa page — on voit où l'on est.
 */
function LienBandeau({
  href,
  icone,
  libelle,
  actif,
}: {
  href: string;
  icone: IconName;
  libelle: string;
  actif: boolean;
}) {
  return (
    <Link
      href={href}
      title={libelle}
      aria-label={libelle}
      aria-current={actif ? 'page' : undefined}
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-full border text-hero-ink transition-all duration-200 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none',
        actif
          ? 'border-white/60 bg-white/25'
          : 'border-white/30 bg-white/10 hover:border-white/55 hover:bg-white/20',
      )}
    >
      <Icon name={icone} size={20} fill={actif} />
    </Link>
  );
}

/* ————————————————————————————————————————————————————————————————
   Qui voit quoi dans le menu : ce que l'organigramme donne, rien d'autre.

   Pas de rôle « RH » ou « Manager » : tout le monde est agent. Le N+1 voit
   les congés de son équipe ; le directeur du Capital Humain voit tout ; un
   membre de la DCH voit ce qui lui est confié ; l'administrateur, la
   gestion. Le serveur refuse de toute façon ce que le menu ne montre pas —
   le menu ne fait que ne pas promettre ce qui serait refusé.
   ———————————————————————————————————————————————————————————————— */

/** Ce que l'agent a devant lui, par type de demande — les badges et les entrées. */
type ATraiter = CompteursValidations['aTraiter'];

/** Les files de la DCH : qui les traite, ou à qui une demande est confiée. */
const FILES = [
  {
    type: 'conges',
    capacites: ['demandes.conges'],
    href: '/moi/dch',
    label: 'Absences & Congés',
    seul: 'Absences & Congés',
    icone: 'free_cancellation',
  },
  {
    type: 'documents',
    // Une habilitation par type de document : la file est à qui en tient une.
    capacites: CAPACITES_DOCUMENTS,
    href: '/documents',
    label: 'Demandes de documents',
    seul: 'Demandes de documents',
    icone: 'folder_managed',
  },
  {
    type: 'informations',
    capacites: ['demandes.informations'],
    href: '/demandes/informations',
    label: 'Mise à jour d’infos',
    seul: 'Mise à jour d’infos',
    icone: 'badge',
  },
  {
    type: 'pieces',
    capacites: CAPACITES_PIECES,
    href: '/demandes/pieces',
    label: 'Vérification des documents',
    seul: 'Vérification des documents',
    icone: 'verified_user',
  },
] as const;

/**
 * Les files qu'il voit : celles qu'il traite, et celles où une demande
 * l'attend. Les absences et congés, en outre, à qui consulte les dossiers :
 * qui est absent, et pourquoi, fait partie du dossier.
 */
function filesDe(user: SessionUser, aTraiter: ATraiter | undefined) {
  return FILES.filter(
    (f) =>
      f.capacites.some((c) => peut(user, c)) ||
      (aTraiter?.[f.type] ?? 0) > 0 ||
      (f.type === 'conges' && voitLesConges(user)),
  );
}

/** Voit toutes les demandes de congé : qui les traite pour la DCH, ou consulte les dossiers. */
const voitLesConges = (user: SessionUser) =>
  peut(user, 'demandes.conges') || peut(user, 'personnel.consulter');

/** A-t-il un espace de gestion — une habilitation, ou une demande qui l'attend ? */
function gere(user: SessionUser, aTraiter: ATraiter | undefined): boolean {
  return gereQuelqueChose(user) || filesDe(user, aTraiter).length > 0;
}

/**
 * La navigation de « Gestion RH » : les écrans de ses habilitations, rien
 * d'autre. Ni « Mon espace », ni les congés de son équipe, ni l'Academy pour
 * apprendre : cela, il le fait dans son espace d'agent — comme tout le
 * monde. Aucune demande ne se fait d'ici.
 */
function navigationGestion(user: SessionUser, aTraiter: ATraiter | undefined): NavItem[] {
  const files = filesDe(user, aTraiter);
  const demandes: NavItem[] =
    files.length === 0
      ? []
      : [
          files.length === 1
            ? {
                href: files[0]!.href,
                label: files[0]!.seul,
                short: 'À traiter',
                // Seule, la file porte son propre signe : « Absences & Congés »
                // se reconnaît mieux à son calendrier qu'au signe des demandes.
                icon: files[0]!.icone,
                badge: 'traiter',
                groupe: 'quotidien',
              }
            : {
                href: files[0]!.href,
                label: 'Demandes à traiter',
                short: 'Demandes',
                icon: 'how_to_reg',
                badge: 'traiter',
                groupe: 'quotidien',
                children: files.map((f) => ({ href: f.href, label: f.label })),
              },
        ];
  // Le directeur les modifie ; l'administrateur y lit qui peut quoi.
  const delegations: NavItem[] =
    user.dirigeLaDCH || user.role === 'admin'
      ? [
          {
            href: '/moi/delegations',
            label: 'Déléguer des tâches',
            short: 'Déléguer',
            icon: 'arrow_split',
            groupe: 'quotidien',
          },
        ]
      : [];
  const items: NavItem[] = [];
  for (const i of NAV_ITEMS) {
    switch (i.href) {
      case '/dashboard':
        if (peut(user, 'pilotage')) items.push(i);
        break;
      case '/employees':
        if (peut(user, 'personnel.consulter')) items.push(i);
        break;
      case '/contrats':
        if (peut(user, 'contrats.echeances')) items.push(i);
        break;
      case '/absences/parametres':
        // Déléguer, puis traiter ; les réglages des congés ensuite, à qui les
        // gère seulement : traiter les congés n'y donne pas accès.
        items.push(...delegations, ...demandes);
        if (peut(user, 'conges.parametres')) items.push(i);
        break;
      case '/absences/feries':
        // Une délégation à part : ni les congés ni leurs paramètres n'y mènent.
        if (peut(user, 'feries')) items.push(i);
        break;
      case '/recrutement': {
        // Les offres et les dossiers se confient à part.
        const voit: Record<string, boolean> = {
          '/recrutement': peut(user, 'recrutement.offres'),
          '/recrutement/candidatures': peut(user, 'recrutement.candidatures'),
        };
        const children = (i.children ?? []).filter((c) => voit[c.href]);
        if (children.length > 0) items.push({ ...i, children });
        break;
      }
      case '/evaluation':
        if (peut(user, 'pilotage')) items.push(i);
        break;
      case '/academy':
        // Apprendre se fait dans « Mon espace » ; ici, on gère le catalogue.
        if (peut(user, 'academy')) {
          items.push({ ...i, href: '/academy/gerer' });
        }
        break;
      case '/reglementations':
        // Les textes se lisent dans « Mon espace » ; ici, l'administrateur
        // les dépose.
        if (peut(user, 'textes')) items.push(i);
        break;
      default:
        items.push(i);
    }
  }
  return items;
}

/**
 * Où mène « Gestion RH » : le tableau de bord de qui pilote ; sinon les
 * demandes qu'il traite ; sinon le premier écran de gestion.
 */
function accueilDeLaGestion(user: SessionUser, items: NavItem[]): string {
  if (peut(user, 'pilotage')) return '/dashboard';
  const cible = (i: NavItem) => i.children?.[0]?.href ?? i.href;
  const demandes = items.find((i) => i.badge === 'traiter');
  if (demandes) return cible(demandes);
  const ecran = items.find((i) => espaceDeLaPage(cible(i)) === 'gestion');
  return ecran ? cible(ecran) : '/moi';
}

/**
 * Espace personnel : navigation réduite, rangée par les mêmes familles.
 *
 * Ce qu'on est (mes infos personnelles), ce qu'on demande (congés,
 * documents), le cadre (l'organigramme, les fériés, les textes). Les
 * validations d'un manager tiennent à part : c'est le seul endroit où il
 * décide pour un autre.
 *
 * Les objectifs descendent l'organigramme : chacun a « Mes objectifs », sauf
 * le directeur général, qui fixe les « Objectifs de l'APIX ». Qui encadre a
 * « Mon équipe » — les demandes à viser, le suivi de ses directs.
 */
function personalNav(aUneEquipe: boolean, estDG: boolean): NavItem[] {
  return [
    {
      href: '/moi',
      label: 'Mes infos personnelles',
      short: 'Mes infos',
      icon: 'badge',
      groupe: 'pilotage',
    },
    // Ce que chacun doit atteindre cette année : ceux de l'APIX, de sa
    // direction, les siens. Le DG, lui, les fixe.
    ...(estDG
      ? [
          {
            href: '/moi/objectifs-apix',
            label: 'Objectifs de l’APIX',
            short: 'Objectifs',
            icon: 'trending_up' as const,
            groupe: 'pilotage' as const,
          },
        ]
      : [
          {
            href: '/moi/objectifs',
            label: 'Mes objectifs',
            short: 'Objectifs',
            icon: 'flag' as const,
            groupe: 'pilotage' as const,
          },
        ]),
    {
      href: '/moi/conges',
      label: 'Absences & Congés',
      short: 'Congés',
      icon: 'free_cancellation',
      groupe: 'quotidien',
      children: [
        { href: '/moi/conges', label: 'Poser une demande' },
        { href: '/moi/conges/historique', label: 'Historique' },
      ],
    },
    // Deux mouvements contraires : ce qu'on demande à la DCH, ce qu'on lui
    // fournit.
    {
      href: '/moi/documents',
      label: 'Mes documents',
      short: 'Documents',
      icon: 'folder_managed',
      groupe: 'quotidien',
      children: [
        { href: '/moi/documents', label: 'Demander un document' },
        { href: '/moi/documents/justificatifs', label: 'Joindre un document' },
        { href: '/moi/documents/suivi', label: 'Suivi de mes demandes' },
      ],
    },
    // Le seul endroit où un agent décide pour un autre : son équipe — les
    // demandes qu'il vise en premier, les objectifs de ses directs. Le DG ne
    // garde que les demandes à viser : il fixe les objectifs de ses
    // directeurs par ceux de leurs directions.
    ...(aUneEquipe
      ? estDG
        ? [
            {
              href: '/moi/equipe',
              label: 'Demandes à viser',
              short: 'À viser',
              icon: 'how_to_reg' as const,
              badge: 'visas' as const,
              groupe: 'croissance' as const,
            },
          ]
        : [
            {
              href: '/moi/equipe',
              label: 'Mon équipe',
              short: 'Équipe',
              icon: 'groups' as const,
              badge: 'visas' as const,
              groupe: 'croissance' as const,
              children: [
                { href: '/moi/equipe', label: 'Demandes à viser' },
                { href: '/moi/equipe/suivi', label: 'Suivi & Évaluation' },
              ],
            },
          ]
      : []),
    // L'Academy : ce qui fait grandir l'agent. Elle tient la famille de la
    // croissance, juste après les validations d'un manager.
    {
      href: '/academy',
      label: 'APIX Academy',
      short: 'Academy',
      icon: 'school',
      groupe: 'croissance',
    },
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
  replie = false,
  onBulle,
}: {
  href: string;
  label: string;
  icon?: IconName;
  active: boolean;
  badge?: number;
  desactive?: boolean;
  /** Colonne repliée : l'icône seule, le libellé dans une bulle au survol. */
  replie?: boolean;
  onBulle?: (b: Bulle | null) => void;
}) {
  const aBadge = Boolean(badge && badge > 0);
  const contenu = (
    <>
      {/* Icône pleine sur l'entrée courante : la position dans le menu se lit
          sans dépendre de la seule couleur. */}
      {icon ? (
        <span className="relative flex shrink-0">
          <Icon name={icon} size={17} fill={active && !desactive} />
          {/* Repliée, la colonne n'a plus la place du compteur : un point
              dit qu'il y a quelque chose, la bulle dit combien. */}
          {replie && aBadge ? <PointAlerte /> : null}
        </span>
      ) : null}
      <span className={replie ? 'sr-only' : 'min-w-0 flex-1 truncate'}>{label}</span>
      {!replie && aBadge ? (
        <span className="rounded-full bg-alert-soft px-[6px] py-px text-[10px] font-extrabold text-alert-text">
          {badge}
        </span>
      ) : null}
    </>
  );
  const survol =
    replie && onBulle ? survolAvecBulle(aBadge ? `${label} · ${badge}` : label, onBulle) : {};

  // `gap-2` comme les rubriques dépliables juste en dessous : les deux sortes
  // de rangées s'écartaient de deux pixels, ce qui ne se voyait pas — jusqu'à
  // qu'un libellé long, en gras sur la page courante, manque exactement ces
  // deux pixels et se coupe.
  const forme =
    'relative flex items-center gap-2 rounded-[10px] py-[8px] pr-2.5 pl-3.5 text-[12.5px] transition-colors duration-150';

  // Éteinte, la rangée n'est plus un lien DU TOUT : la griser sans la
  // désarmer laisserait le clic passer, et le curseur promettrait une
  // destination qui n'existe pas encore.
  if (desactive) {
    return (
      <span
        aria-disabled
        {...survol}
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
      {...survol}
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

/** Le point d'alerte posé sur l'icône, quand la colonne est repliée. */
function PointAlerte() {
  return (
    <span
      aria-hidden
      className="absolute -top-0.5 -right-1 size-2 rounded-full bg-alert ring-2 ring-surface"
    />
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
  replie = false,
  onBulle,
}: {
  item: NavItem;
  contientLaPageCourante: boolean;
  /** Le compteur de la rubrique : il vit sur la rangée parente, ouverte ou non. */
  badge?: number;
  estActive: (href: string) => boolean;
  /** Colonne repliée : l'icône ouvre les sous-pages dans un menu flottant. */
  replie?: boolean;
  onBulle?: (b: Bulle | null) => void;
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
   * « Demander un document » vit à /moi/documents et « Joindre un document » à
   * /moi/documents/justificatifs : la règle par préfixe allumerait les deux, et la
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

  if (replie) {
    return (
      <RubriqueRepliee
        item={item}
        badge={badge}
        contientLaPage={contientLaPage}
        liens={enfants.map((c) => ({
          href: c.href,
          label: c.label,
          actif: c.href === enfantActif,
          desactive: c.desactive,
        }))}
        onBulle={onBulle}
      />
    );
  }

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
 * Une rubrique, colonne repliée : son icône seule. Un clic ouvre ses
 * sous-pages à côté, dans un menu flottant — la colonne n'a plus la largeur
 * de les dérouler. Tant qu'il est fermé, la bulle du survol dit son nom.
 */
function RubriqueRepliee({
  item,
  badge,
  contientLaPage,
  liens,
  onBulle,
}: {
  item: NavItem;
  badge?: number;
  contientLaPage: boolean;
  liens: { href: string; label: string; actif: boolean; desactive?: boolean }[];
  onBulle?: (b: Bulle | null) => void;
}) {
  const [ouvert, setOuvert] = useState(false);
  const bouton = useRef<HTMLButtonElement>(null);
  const fermer = useCallback(() => setOuvert(false), []);
  const aBadge = Boolean(badge && badge > 0);
  const survol =
    onBulle && !ouvert
      ? survolAvecBulle(aBadge ? `${item.label} · ${badge}` : item.label, onBulle)
      : {};
  return (
    <>
      <button
        ref={bouton}
        type="button"
        onClick={() => {
          onBulle?.(null);
          setOuvert((v) => !v);
        }}
        aria-haspopup="menu"
        aria-expanded={ouvert}
        aria-label={item.label}
        {...survol}
        className={cn(
          'relative flex w-full items-center rounded-[10px] py-[8px] pl-3.5 text-[12.5px] transition-colors duration-150',
          contientLaPage
            ? 'bg-primary/[0.07] text-primary'
            : ouvert
              ? 'bg-hover text-ink'
              : 'text-ink hover:bg-hover',
        )}
      >
        {contientLaPage ? <RepereActif /> : null}
        <span className="relative flex shrink-0">
          <Icon name={item.icon} size={17} fill={contientLaPage} />
          {aBadge ? <PointAlerte /> : null}
        </span>
      </button>
      {ouvert ? (
        <SousMenuFlottant ancre={bouton} titre={item.label} liens={liens} onFermer={fermer} />
      ) : null}
    </>
  );
}

/**
 * La date du jour, dans le bandeau — et derrière elle, « Calendrier · Jours
 * fériés » : le menu n'y mène plus, c'est la date qui y conduit. Allumée
 * quand on y est, comme une entrée de menu.
 *
 * La fenêtre du planning qu'elle ouvrait (CalendrierModal, dans
 * components/calendrier.tsx) reste dans le dépôt, prête à resservir.
 */
function DateDuJour() {
  const pathname = usePathname();
  const ici = pathname.startsWith('/calendrier');
  const brut = new Date().toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const libelle = `${brut.charAt(0).toUpperCase()}${brut.slice(1)}`;

  return (
    <>
      <Link
        href="/calendrier"
        title="Calendrier · Jours fériés"
        aria-label={`${libelle} — calendrier et jours fériés`}
        aria-current={ici ? 'page' : undefined}
        className={cn(
          'flex h-9 shrink-0 items-center gap-2 rounded-full border px-3 text-hero-ink transition-all duration-200 hover:border-white/55 hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none lg:px-3.5',
          ici ? 'border-white/60 bg-white/20' : 'border-white/30 bg-white/10',
        )}
      >
        <Icon name="calendar_month" size={18} />
        {/* Sous 1024 px, l'icône suffit : la date complète y mangerait la
            place du titre de l'écran. */}
        <span className="hidden text-xs font-semibold whitespace-nowrap lg:inline">{libelle}</span>
      </Link>
    </>
  );
}

/** Sous le nom : l'espace où l'on travaille ; pour l'administrateur, sa fonction. */
function qualite(user: SessionUser, espace: Espace): string {
  if (user.role === 'admin') return 'Administration';
  return espace === 'gestion' ? 'Espace RH' : 'Espace personnel';
}

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
  // La colonne repliée en rail d'icônes, et la bulle qui en dit les noms.
  const [replie, basculerMenu] = useMenuReplie();
  const [bulle, setBulle] = useState<Bulle | null>(null);
  useEffect(() => setBulle(null), [pathname, replie]);
  const titleOverride = usePageTitleOverride();

  // Ce que l'agent a devant lui : son équipe (l'entrée n'existe que pour qui
  // encadre), ce qui attend son visa, ce qu'il traite pour la DCH (badges).
  const validations = useQuery({
    queryKey: ['validations-compteurs'],
    queryFn: () => api<CompteursValidations>('/absences/validations/compteurs'),
    enabled: Boolean(me.data),
    refetchInterval: 60_000,
  });
  const aUneEquipe = (validations.data?.equipe ?? 0) > 0;
  const aTraiter = validations.data?.aTraiter;
  const gestion = Boolean(me.data && gere(me.data, aTraiter));

  // Un compte, deux espaces : l'agent qui gère passe de « Mon espace » à
  // « Gestion RH ». L'administrateur, qui n'est pas agent, n'a que la
  // gestion ; l'agent qui ne gère rien, que son espace.
  const deuxEspaces = Boolean(me.data?.estAgent && gestion);
  const [choix, choisir] = useEspaceChoisi();
  const impose = espaceDeLaPage(pathname);
  const espace: Espace = !gestion
    ? 'agent'
    : !me.data?.estAgent
      ? 'gestion'
      : (impose ?? choix ?? 'agent');
  useEffect(() => {
    // Une page d'un seul espace y fait entrer ; celles des deux s'en souviennent.
    if (deuxEspaces && impose && impose !== choix) choisir(impose);
  }, [deuxEspaces, impose, choix, choisir]);

  const estDG = Boolean(me.data?.estDG);
  const navAgent = useMemo(() => personalNav(aUneEquipe, estDG), [aUneEquipe, estDG]);
  const navGestion = useMemo(
    () => (me.data && gestion ? navigationGestion(me.data, aTraiter) : []),
    [me.data, gestion, aTraiter],
  );
  const items = espace === 'gestion' ? navGestion : navAgent;
  const accueilGestion = me.data ? accueilDeLaGestion(me.data, navGestion) : '/moi';
  const accueil = espace === 'gestion' ? accueilGestion : '/moi';
  /**
   * Changer d'espace. Sur une page des deux (organigramme, textes…), on y
   * reste — elle montre ou retire ses gestes de gestion ; ailleurs, on va à
   * l'accueil de l'autre espace.
   */
  const allerA = (e: Espace) => {
    choisir(e);
    if (impose !== null) router.push(e === 'gestion' ? accueilGestion : '/moi');
  };

  // « Mon équipe » ne s'affiche qu'à qui encadre quelqu'un : l'organigramme
  // en décide, pas le rôle — d'où cette question au serveur, dans l'Academy
  // seulement.
  const equipe = useQuery({
    queryKey: ['academy', 'equipe', 'effectif'],
    queryFn: () => api<TeamSize>('/academy/equipe/effectif'),
    enabled: Boolean(me.data) && espaceAcademy(pathname),
    staleTime: 5 * 60_000,
  });

  // Garde de routes : chacun reste dans ce que ses habilitations ouvrent. Le
  // serveur refuse de toute façon ; la garde évite d'ouvrir un écran vide.
  const autorise = (path: string): boolean => {
    const u = me.data;
    if (!u) return true;
    const commence = (p: string) => path === p || path.startsWith(`${p}/`);
    // Ce que traite la DCH : attendre les compteurs, qui disent si une
    // demande a été confiée à l'agent.
    const file = FILES.find((f) => commence(f.href));
    if (file) {
      return (
        !validations.data ||
        file.capacites.some((c) => peut(u, c)) ||
        (aTraiter?.[file.type] ?? 0) > 0 ||
        peut(u, 'personnel.consulter')
      );
    }
    if (commence('/moi/delegations')) return u.dirigeLaDCH || u.role === 'admin';
    // Les objectifs : chacun les siens, le DG ceux de l'APIX, qui encadre son équipe.
    if (commence('/moi/objectifs-apix')) return u.estDG;
    if (commence('/moi/objectifs')) return u.estAgent && !u.estDG;
    if (commence('/moi/equipe/suivi')) return !validations.data || (aUneEquipe && !u.estDG);
    if (commence('/moi') || commence('/calendrier')) return true;
    // L'organigramme est un annuaire interne ; les textes de référence, le
    // cadre de tous ; l'Academy est faite pour les agents.
    if (commence('/organisation')) return true;
    if (path.endsWith('/deposer')) return peut(u, 'textes');
    if (commence('/reglementations')) return true;
    if (commence('/academy/gerer')) return peut(u, 'academy');
    // Ce qu'on garde de ses formations est à l'agent : l'administrateur, qui
    // ne l'est pas, n'ouvre du côté apprenant que l'aperçu de l'atelier.
    if (
      commence('/academy/certificats') ||
      commence('/academy/ma-liste') ||
      commence('/academy/equipe')
    ) {
      return u.estAgent;
    }
    if (commence('/academy')) return true;
    if (commence('/dashboard') || commence('/evaluation')) {
      return peut(u, 'pilotage');
    }
    if (commence('/employees/new') || path.endsWith('/modifier')) {
      return peut(u, 'personnel.gerer');
    }
    if (commence('/employees')) return peut(u, 'personnel.consulter');
    if (commence('/contrats')) return peut(u, 'contrats.echeances') || peut(u, 'pilotage');
    if (commence('/absences/feries')) return peut(u, 'feries');
    if (commence('/absences/parametres')) return peut(u, 'conges.parametres');
    if (commence('/absences')) return voitLesConges(u);
    if (commence('/recrutement/candidatures')) return peut(u, 'recrutement.candidatures');
    if (path === '/recrutement' || commence('/recrutement/nouvelle')) {
      return peut(u, 'recrutement.offres');
    }
    // Une offre : son texte pour qui les rédige, ses dossiers pour qui les lit.
    if (commence('/recrutement')) {
      return peut(u, 'recrutement.offres') || peut(u, 'recrutement.candidatures');
    }
    return false;
  };
  const allowed = autorise(pathname);

  useEffect(() => {
    if (me.isError) router.replace('/login');
  }, [me.isError, router]);

  useEffect(() => {
    if (me.data && !allowed) router.replace(accueil);
  }, [me.data, allowed, accueil, router]);

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
  const aViser = validations.data?.aViser ?? 0;
  const totalATraiter = aTraiter
    ? aTraiter.conges + aTraiter.documents + aTraiter.informations + aTraiter.pieces
    : 0;
  const badgeCount = (badge?: 'visas' | 'traiter') =>
    badge === 'visas' ? aViser : badge === 'traiter' ? totalATraiter : 0;
  // Ce qui attend dans chaque espace : les congés de l'équipe à viser, les
  // demandes à traiter. L'autre espace le dit dans le menu du compte.
  const alertes: Record<Espace, number> = { agent: aViser, gestion: totalATraiter };
  const autre: Espace = espace === 'agent' ? 'gestion' : 'agent';

  // L'écran a le dernier mot quand il connaît son objet (nom d'un employé…).
  const title = titleOverride ?? pageTitle(pathname, user.givenName);
  const action = pageAction(pathname, user, espace);
  const reglage = pageReglage(pathname, user, espace);
  const academy = espaceAcademy(pathname);
  const cheminMenu = pathname;
  const isActive = (href: string) =>
    href === '/moi' ? cheminMenu === '/moi' : cheminMenu.startsWith(href);
  /** Une sous-page couvre son chemin et ce qui en descend. */
  const isChildActive = (href: string) => cheminMenu === href || cheminMenu.startsWith(`${href}/`);
  // Sur téléphone, l'onglet d'une rubrique mène à sa première sous-page : les
  // autres se choisissent en tête de page — sans quoi « Historique » ou
  // « Joindre un document » n'auraient aucun chemin. La plus précise
  // s'allume, comme dans la barre latérale.
  const rubrique = items.find((i) => i.children?.some((c) => isChildActive(c.href)));
  const sousPageActive = (rubrique?.children ?? [])
    .filter((c) => isChildActive(c.href))
    .reduce<string | null>(
      (long, c) => (long && long.length >= c.href.length ? long : c.href),
      null,
    );

  return (
    /* Coquille d'application : la page elle-même ne défile pas. Le bandeau et
       la barre latérale restent en place, seul le contenu bouge — comme sur la
       plateforme APIX. */
    <div className="flex h-dvh flex-col overflow-hidden">
      {/* ———— Bandeau de tête, d'un bord à l'autre ———— */}
      <header className="hero-bar z-30 flex h-[58px] shrink-0 items-center gap-3.5 px-4 lg:gap-4 lg:px-7">
        <Link
          href={accueil}
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
          {/* La recherche du catalogue, dans le bandeau : elle lit et écrit
              l'adresse (?q=), d'où la frontière Suspense qu'exige Next. */}
          {academy ? (
            <Suspense fallback={null}>
              <RechercheAcademy />
            </Suspense>
          ) : null}
          {action ? <HeaderAction action={action} /> : null}
          {academy ? (
            // Les raccourcis de l'apprenant — l'administrateur, qui n'y vient
            // que pour l'aperçu de l'atelier, n'en a pas.
            espace === 'agent' ? (
              <>
                {(equipe.data?.total ?? 0) > 0 ? (
                  <LienBandeau
                    href="/academy/equipe"
                    icone="groups"
                    libelle="Mon équipe"
                    actif={pathname.startsWith('/academy/equipe')}
                  />
                ) : null}
                <LienBandeau
                  href="/academy/certificats"
                  icone="workspace_premium"
                  libelle="Mes certificats"
                  actif={pathname === '/academy/certificats'}
                />
                <LienBandeau
                  href="/academy/ma-liste"
                  icone="bookmark"
                  libelle="Ma liste"
                  actif={pathname === '/academy/ma-liste'}
                />
              </>
            ) : null
          ) : (
            <>
              <DateDuJour />
              {reglage ? <HeaderAction action={reglage} /> : null}
              <NotificationsBell espace={deuxEspaces ? espace : undefined} />
            </>
          )}
          {/* Sur téléphone la colonne n'existe pas : sans ce menu, ni le
              thème ni la sortie ne seraient atteignables. */}
          <span className="lg:hidden">
            <MenuCompte
              variante="bandeau"
              certificats={espace === 'agent'}
              bascule={
                deuxEspaces
                  ? { vers: autre, alerte: alertes[autre], onBasculer: () => allerA(autre) }
                  : undefined
              }
            />
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
        <aside
          className={cn(
            'hidden shrink-0 flex-col gap-3 py-3.5 pl-3.5 transition-[width] duration-200 ease-out lg:flex',
            replie ? 'w-[4.85rem]' : 'w-[17rem]',
          )}
        >
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
            {/* Plier, déplier. Le bouton se tient dans l'axe des icônes : il
                reste sous le pointeur quand la colonne se replie, et un second
                clic la rouvre sans qu'on ait à le chercher. */}
            <div className="flex shrink-0 items-center gap-1 px-2 pt-2.5 pb-1">
              <button
                type="button"
                onClick={() => {
                  setBulle(null);
                  basculerMenu();
                }}
                aria-label={replie ? 'Déplier le menu' : 'Replier le menu'}
                aria-expanded={!replie}
                title={replie ? undefined : 'Replier le menu'}
                {...(replie ? survolAvecBulle('Déplier le menu', setBulle) : {})}
                className="ml-[6.5px] grid size-8 shrink-0 place-items-center rounded-[9px] text-ink-muted transition-colors duration-150 hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
              >
                <Icon name={replie ? 'arrow_menu_open' : 'arrow_menu_close'} size={19} />
              </button>
              {/* L'espace où l'on est se lit sous le nom, dans le bloc du compte. */}
              {replie ? null : (
                <p className="min-w-0 truncate text-[10px] font-bold tracking-[0.12em] text-ink-muted uppercase">
                  Menu
                </p>
              )}
            </div>
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
                        replie={replie}
                        onBulle={setBulle}
                      />
                    ) : (
                      <RangeeNav
                        href={item.href}
                        label={item.label}
                        icon={item.icon}
                        active={isActive(item.href)}
                        badge={badgeCount(item.badge)}
                        desactive={item.desactive}
                        replie={replie}
                        onBulle={setBulle}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </nav>

          {/* Qui je suis, dans sa propre carte : ce n'est pas une destination
              de plus au bas de la liste, c'est l'identité de la session. */}
          <div
            className={cn(
              'mt-auto flex shrink-0 items-center rounded-[18px] border border-card-line bg-surface py-2.5 shadow-xs',
              replie ? 'justify-center' : 'gap-2.5 px-3',
            )}
          >
            {/* Repliée, la carte ne garde que le menu du compte : le thème,
                les certificats et la sortie doivent rester à un clic. */}
            {!replie ? (
              <>
                <span className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-primary/[0.09] text-[10.5px] font-bold text-primary">
                  {initials}
                </span>
                <span className="min-w-0 flex-1">
                  {/* Plusieurs prénoms : le premier, l'initiale du deuxième, le nom
                      (« Mouhamadou M. Ba ») ; le nom entier au survol. */}
                  <span
                    title={`${user.givenName} ${user.familyName}`}
                    className="block truncate text-[12.5px] leading-tight font-semibold text-ink-strong"
                  >
                    {nomCourt(user.givenName, user.familyName)}
                  </span>
                  <span className="block truncate text-[10.5px] leading-tight text-ink-muted">
                    {qualite(user, espace)}
                  </span>
                </span>
              </>
            ) : null}
            <MenuCompte
              variante="colonne"
              certificats={espace === 'agent'}
              bascule={
                deuxEspaces
                  ? { vers: autre, alerte: alertes[autre], onBasculer: () => allerA(autre) }
                  : undefined
              }
            />
          </div>
          {replie ? <InfoBulle bulle={bulle} /> : null}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Le seul panneau qui défile. `data-scroll-root` le signale aux
              fenêtres modales, qui doivent le geler comme elles gèlent la page. */}
          <main
            data-scroll-root
            className="min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 pb-24 lg:px-7 lg:py-6 lg:pb-10"
          >
            {rubrique && (rubrique.children?.length ?? 0) > 1 ? (
              <nav
                aria-label={rubrique.label}
                className="-mt-1 mb-4 flex gap-1.5 overflow-x-auto lg:hidden"
              >
                {rubrique.children!.map((c) =>
                  c.desactive ? null : (
                    <Link
                      key={c.href}
                      href={c.href}
                      aria-current={c.href === sousPageActive ? 'page' : undefined}
                      className={cn(
                        'shrink-0 rounded-full border px-3 py-1.5 text-[12px] font-medium whitespace-nowrap transition-colors duration-150',
                        c.href === sousPageActive
                          ? 'border-primary bg-primary-soft font-semibold text-primary'
                          : 'border-line text-ink-muted hover:bg-hover',
                      )}
                    >
                      {c.label}
                    </Link>
                  ),
                )}
              </nav>
            ) : null}
            <EspaceProvider value={espace}>{children}</EspaceProvider>
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
    </div>
  );
}
