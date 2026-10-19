'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import {
  CAPACITES_DOCUMENTS,
  CAPACITES_PIECES,
  genereQuelqueChose,
  gereQuelqueChose,
  nomCourt,
  peut,
  type CompteursValidations,
  type SessionUser,
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
  ACTION,
  ANCRE_ACTIONS,
  ANCRE_RETOUR,
  ANCRE_RETOUR_TELEPHONE,
  COMMANDE,
  COMMANDE_ACTIVE,
} from '../../components/entete';
import { ANCRE_ONGLETS } from '../../components/onglets';
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
    href: '/organisation',
    label: 'Organigramme',
    short: 'Organig.',
    icon: 'family_history',
    groupe: 'effectif',
  },
  // « Demandes à traiter » s'insère ici, selon ce que l'agent traite pour la
  // DCH ; « Déléguer des tâches », sous le tableau de bord (cf. navigationGestion). Les demandes de
  // congé se traitent sous « Demandes à traiter › Absences & Congés » ; leurs
  // réglages ont leur page.
  {
    href: '/absences/parametres',
    label: 'Paramètres des absences',
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
      { href: '/recrutement/non-retenues', label: 'Candidatures non retenues' },
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
 * Titre de la page, tel qu'il s'affiche en tête de l'écran. Il est DÉDUIT de
 * l'URL plutôt que remonté par chaque page : le titre appartient au chrome
 * de l'application, et un écran ne peut pas oublier de le déclarer.
 * Les fiches (employé, offre) portent un intitulé générique — leur contenu
 * nomme déjà la personne ou le poste, le répéter en tête n'apprend rien.
 */
const PAGE_TITLES: Record<string, string> = {
  '/employees': 'Gestion du personnel',
  '/employees/new': 'Nouvel employé',
  '/absences': 'Absences & Congés',
  '/absences/feries': 'Gestion des jours fériés',
  '/absences/parametres': 'Paramètres des absences',
  '/documents': 'Demandes de documents',
  '/demandes/informations': 'Mise à jour d’infos',
  '/demandes/pieces': 'Vérification des documents',
  '/moi/delegations': 'Déléguer des tâches',
  '/generer': 'Générer des documents',
  '/acces': 'Gestion des accès',
  '/calendrier': 'Calendrier des jours fériés',
  '/recrutement': "Offres d'emploi",
  '/recrutement/candidatures': 'Dossiers de candidature',
  '/recrutement/non-retenues': 'Candidatures non retenues',
  '/recrutement/nouvelle': 'Nouvelle offre',
  '/academy': 'APIX Academy',
  '/academy/gerer': 'Gérer le catalogue',
  '/academy/certificats': 'Mes certificats',
  '/notifications': 'Notifications',
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

/**
 * Les accueils, le tableau de bord et « Mes infos personnelles », saluent :
 * c'est là qu'on arrive.
 */
function salue(pathname: string): boolean {
  return pathname === '/dashboard' || pathname === '/moi/tableau-de-bord' || pathname === '/moi';
}

function pageTitle(pathname: string, givenName: string): string {
  if (salue(pathname)) return `${greeting()}, ${givenName}`;
  const exact = PAGE_TITLES[pathname];
  if (exact) return exact;
  // Une fiche garde le titre de sa SECTION : le dossier nomme déjà la personne
  // en gros caractères, trois centimètres plus bas. L'en-tête, lui, dit où
  // l'on se trouve dans l'application — c'est le seul endroit qui le dise.
  if (pathname.startsWith('/employees/')) {
    return pathname.endsWith('/modifier') ? 'Modifier la fiche' : 'Gestion du personnel';
  }
  if (pathname.startsWith('/recrutement/')) return 'Offre de recrutement';
  if (pathname.startsWith('/academy/gerer/')) return 'Gérer le catalogue';
  if (pathname.startsWith('/moi/equipe/suivi/')) return 'Suivi & Évaluation';
  if (pathname.startsWith('/academy/')) return 'APIX Academy';
  if (pathname.endsWith('/deposer')) return 'Dépôt du texte';
  // Un troisième texte — convention collective, accord d'entreprise — entrera
  // sans qu'on ait à revenir ici.
  if (pathname.startsWith('/reglementations/')) return 'Lois & Règlementations';
  return 'Capital Humain';
}

/**
 * L'action principale de l'écran, en tête de page. Une page n'en a qu'UNE :
 * si deux boutons se disputaient la tête de page, c'est que l'un des deux
 * n'était pas principal.
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
 * L'action de l'écran, dans l'en-tête : un bouton plein, l'icône et le mot.
 * Le bandeau bleu la réduisait à une icône ; sur le fond, elle a la place de
 * dire ce qu'elle fait. Sur téléphone, l'icône seule.
 */
function ActionDeLEcran({ action }: { action: ChromeAction }) {
  return (
    <Link href={action.href} title={action.label} className={ACTION}>
      <Icon name={action.icon} size={18} />
      <span className="max-sm:sr-only">{action.label}</span>
    </Link>
  );
}

/**
 * L'espace APIX Academy, côté apprenant : le catalogue, les formations, les
 * leçons, l'évaluation, « Ma liste », « Mes certificats ». On y vient pour
 * apprendre, et l'en-tête y porte la recherche et le signet de « Ma liste » ;
 * sur téléphone, la cloche leur laisse sa place. L'atelier de la DCH
 * (/academy/gerer) reste un écran de gestion, avec l'en-tête de gestion.
 */
function espaceAcademy(pathname: string): boolean {
  return (
    pathname === '/academy' ||
    (pathname.startsWith('/academy/') && !pathname.startsWith('/academy/gerer'))
  );
}

/**
 * Un raccourci rond de l'en-tête de l'Academy : « Mes certificats », « Ma
 * liste ». Bleu quand on est sur sa page : on voit où l'on est.
 */
function LienDeLEntete({
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
      className={cn(COMMANDE, actif && COMMANDE_ACTIVE)}
    >
      <Icon name={icone} size={19} fill={actif} />
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
 * Les files qu'il voit : celles qui lui sont déléguées, et celles où une
 * demande l'attend. Rien d'autre n'y mène : gérer les dossiers du personnel
 * n'ouvre pas la file des congés. L'administrateur lit celle des congés.
 */
function filesDe(user: SessionUser, aTraiter: ATraiter | undefined) {
  return FILES.filter(
    (f) =>
      f.capacites.some((c) => peut(user, c)) ||
      (aTraiter?.[f.type] ?? 0) > 0 ||
      (f.type === 'conges' && user.role === 'admin'),
  );
}

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
function navigationGestion(
  user: SessionUser,
  aTraiter: ATraiter | undefined,
  /** L'entrée « Candidatures non retenues » : à partir d'une, ou tant qu'on est sur leur page. */
  avecNonRetenues: boolean,
): NavItem[] {
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
  // Le directeur les modifie ; l'administrateur y lit qui peut quoi. En tête,
  // avec le tableau de bord : c'est là que se décide qui fait quoi.
  const delegations: NavItem[] =
    user.dirigeLaDCH || user.role === 'admin'
      ? [
          {
            href: '/moi/delegations',
            label: 'Déléguer des tâches',
            short: 'Déléguer',
            icon: 'arrow_split',
            groupe: 'pilotage',
          },
        ]
      : [];
  const items: NavItem[] = [];
  for (const i of NAV_ITEMS) {
    switch (i.href) {
      case '/dashboard':
        if (peut(user, 'pilotage')) items.push(i);
        items.push(...delegations);
        break;
      case '/employees':
        if (peut(user, 'personnel.consulter')) items.push(i);
        // Qui est entré au portail, qui attend son invitation : au directeur,
        // et à qui il le confie.
        if (peut(user, 'acces')) {
          items.push({
            href: '/acces',
            label: 'Gestion des accès',
            short: 'Accès',
            icon: 'security',
            groupe: i.groupe,
          });
        }
        break;
      case '/organisation':
        // Tout le monde le consulte dans son espace ; ici, qui le gère.
        if (peut(user, 'organigramme')) items.push(i);
        break;
      case '/absences/parametres':
        // Traiter ; les réglages des congés ensuite, à qui les gère
        // seulement : traiter les congés n'y donne pas accès.
        items.push(...demandes);
        // Générer, à sa guise, les documents de la liste (ADR-0085) ; un
        // membre, les contrats qu'on lui délègue (ADR-0114).
        if (genereQuelqueChose(user)) {
          items.push({
            href: '/generer',
            label: 'Générer des documents',
            short: 'Générer',
            icon: 'description',
            groupe: 'quotidien',
          });
        }
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
          '/recrutement/non-retenues': peut(user, 'recrutement.candidatures') && avecNonRetenues,
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
    // Le DG a le tableau de bord de l'APIX, en tête de son espace.
    ...(estDG
      ? [
          {
            href: '/moi/tableau-de-bord',
            label: 'Tableau de bord',
            short: 'Tableau',
            icon: 'dashboard' as const,
            groupe: 'pilotage' as const,
          },
        ]
      : []),
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
      // Le DG ne demande pas de congé : l'entrée reste, grisée. Son
      // historique garde ce qu'il a posé avant de le devenir.
      children: [
        { href: '/moi/conges', label: 'Poser une demande', ...(estDG ? { desactive: true } : {}) },
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

/**
 * Ce qui se ferme à qui n'est plus en activité, pendant le mois où son
 * portail reste ouvert : visible dans le menu, grisé. « Poser une demande »
 * est la page même des congés ; l'historique, lui, reste ouvert. De
 * l'Academy, il garde « Mes certificats » : il les emporte.
 */
const FERMEES_AUX_INACTIFS = [
  '/moi/objectifs',
  '/moi/objectifs-apix',
  '/moi/equipe',
  '/academy',
  '/organisation',
];
const fermeeAuxInactifs = (chemin: string) =>
  chemin === '/moi/conges' ||
  (FERMEES_AUX_INACTIFS.some((p) => chemin === p || chemin.startsWith(`${p}/`)) &&
    !chemin.startsWith('/academy/certificats'));

/** Le menu de Mon espace d'un agent qui n'est plus en activité : les mêmes entrées, certaines grisées. */
function restreindre(items: NavItem[]): NavItem[] {
  return items.map((i) => {
    if (!i.children) return fermeeAuxInactifs(i.href) ? { ...i, desactive: true } : i;
    const children = i.children.map((c) =>
      fermeeAuxInactifs(c.href) ? { ...c, desactive: true } : c,
    );
    return { ...i, children, desactive: children.every((c) => c.desactive) };
  });
}

/**
 * Les rangées du menu, posées sur le fond (ADR-0115). Au survol, un voile
 * d'encre. L'entrée courante, comme sur PayFit : un bleu très clair, sans
 * filet ni ombre, le mot en bleu, et son icône dans un rond plein
 * (ADR-0118). Ce rond se repère DE LOIN, avant même qu'on lise : c'est lui
 * qu'on suit du regard en revenant au menu après avoir travaillé à droite.
 * Bleu, comme toute la structure du produit : l'orange de la charte est
 * réservé à ce qui attend un geste, et une position dans un menu n'attend
 * rien.
 */
const RANGEE_ACTIVE = 'bg-menu-actif font-semibold text-primary';
const RANGEE_REPOS = 'font-medium text-ink hover:bg-menu-survol';
/** La forme commune des rangées de premier rang, simples ou dépliables. */
const FORME_RANGEE =
  'group relative flex items-center gap-2 rounded-controle-sm py-[5px] pr-2.5 pl-2.5 text-[13px] transition-colors duration-150';

/**
 * L'icône d'une rangée, dans une case de 24 px : sur l'entrée courante, elle
 * passe dans un rond plein sans décaler le libellé. Au repos, elle se tient
 * un ton sous le mot.
 */
function IconeDeRangee({
  icon,
  actif,
  eteinte = false,
}: {
  icon: IconName;
  actif: boolean;
  eteinte?: boolean;
}) {
  return (
    <span
      className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded-full transition-colors duration-150',
        actif ? 'bg-primary text-primary-ink' : !eteinte && 'text-ink-muted group-hover:text-ink',
      )}
    >
      <Icon name={icon} size={actif ? 14 : 17} fill={actif} />
    </span>
  );
}

/** Une entrée simple du menu. */
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
      {/* Le rond plein de l'entrée courante : la position dans le menu se lit
          sans dépendre de la seule couleur du fond. */}
      {icon ? <IconeDeRangee icon={icon} actif={active && !desactive} eteinte={desactive} /> : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge && badge > 0 ? (
        <span className="rounded-full bg-alert-soft px-[6px] py-px text-[10px] font-extrabold text-alert-text">
          {badge}
        </span>
      ) : null}
    </>
  );
  // La forme des rubriques dépliables juste en dessous : les deux sortes de
  // rangées s'écartaient de deux pixels, ce qui ne se voyait pas, jusqu'à ce
  // qu'un libellé long, en gras sur la page courante, manque exactement ces
  // deux pixels et se coupe.
  const forme = FORME_RANGEE;

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
      className={cn(forme, active ? RANGEE_ACTIVE : RANGEE_REPOS)}
    >
      {contenu}
    </Link>
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

  return (
    <div className="flex flex-col gap-px">
      <button
        type="button"
        onClick={() => setOuverte((v) => !v)}
        aria-expanded={ouverte}
        className={cn(
          FORME_RANGEE,
          'text-left',
          // Repliée sur la page courante, la rubrique porte l'état actif ;
          // dépliée, elle le laisse à la sous-page pour ne pas l'allumer deux
          // fois sur la même colonne.
          contientLaPage && !ouverte
            ? RANGEE_ACTIVE
            : contientLaPage
              ? // Dépliée, la rubrique garde son rond et son bleu, sans le
                // fond : la sous-page porte déjà le bleu clair, et deux fonds
                // l'un sous l'autre alourdissent la colonne.
                'font-semibold text-primary hover:bg-menu-survol'
              : RANGEE_REPOS,
        )}
      >
        <IconeDeRangee icon={item.icon} actif={contientLaPage} />
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
        <div className="relative ml-[22px] flex flex-col gap-px border-l border-line pl-2.5">
          {enfants.map((c) => {
            const active = c.href === enfantActif;
            const forme = 'relative rounded-controle-sm px-2.5 py-[6px] text-[12.5px]';
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
                    ? RANGEE_ACTIVE
                    : 'font-medium text-ink-muted hover:bg-menu-survol hover:text-ink',
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
 * La date du jour, en haut à droite de chaque écran, comme sur l'ancienne
 * bande bleue, et derrière elle le « Calendrier des jours fériés » : le menu
 * n'y mène plus, c'est la date qui y conduit (ADR-0117). Allumée quand on y
 * est, comme une entrée de menu. Avec son libellé, elle prend les coins des
 * autres boutons ; sous 1152 px, l'icône seule, dans un rond comme les
 * commandes voisines, pour laisser la place au titre et aux onglets.
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
    <Link
      href="/calendrier"
      title="Calendrier des jours fériés"
      aria-label={`${libelle}, calendrier des jours fériés`}
      aria-current={ici ? 'page' : undefined}
      className={cn(
        COMMANDE,
        'min-[72rem]:w-auto min-[72rem]:gap-2 min-[72rem]:rounded-controle min-[72rem]:px-3',
        ici ? COMMANDE_ACTIVE : 'min-[72rem]:text-ink',
      )}
    >
      <Icon name="calendar_month" size={18} />
      <span className="hidden text-[12.5px] font-semibold whitespace-nowrap min-[72rem]:inline">
        {libelle}
      </span>
    </Link>
  );
}

/**
 * Le titre de l'écran ; aux accueils, le salut, un cran plus grand. Il se
 * tient dans l'en-tête sur écran large ; sur téléphone, en tête de la page,
 * où il a toute la largeur au lieu de se couper entre le logo et les
 * commandes.
 */
function TitreDeLEcran({
  titre,
  salut,
  className,
}: {
  titre: string;
  salut: boolean;
  className?: string;
}) {
  return (
    <h1
      className={cn(
        'min-w-0 leading-tight font-extrabold tracking-[-0.02em] text-ink-strong lg:truncate',
        salut ? 'text-[22px] lg:text-[25px]' : 'text-[20px] lg:text-[22px]',
        className,
      )}
    >
      {titre}
    </h1>
  );
}

/**
 * Sous le nom : l'espace où l'on travaille ; pour l'administrateur, sa
 * fonction. Deux places ont le leur : le directeur du Capital Humain dans sa
 * gestion, le directeur général dans son espace.
 */
function qualite(user: SessionUser, espace: Espace): string {
  if (user.role === 'admin') return 'Administration';
  if (espace === 'gestion') return user.dirigeLaDCH ? 'Espace DCH' : 'Espace RH';
  return user.estDG ? 'Espace DG' : 'Espace personnel';
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <PageTitleProvider>
      <AppShell>{children}</AppShell>
    </PageTitleProvider>
  );
}

/**
 * Vrai à partir de 1024 px, là où le menu existe : la cloche s'y tient, au
 * bout du logo ; en dessous, dans l'en-tête. Mesuré par `matchMedia` et non
 * par une classe : deux cloches dont l'une serait masquée en CSS
 * interrogeraient deux fois le serveur (cf. pagination.tsx).
 */
function useEcranLarge(): boolean {
  const [large, setLarge] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 64rem)');
    const maj = () => setLarge(mq.matches);
    maj();
    mq.addEventListener('change', maj);
    return () => mq.removeEventListener('change', maj);
  }, []);
  return large;
}

function AppShell({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const large = useEcranLarge();
  const titleOverride = usePageTitleOverride();

  // Ce que l'agent a devant lui : son équipe (l'entrée n'existe que pour qui
  // encadre), ce qui attend son visa, ce qu'il traite pour la DCH (badges).
  const validations = useQuery({
    queryKey: ['validations-compteurs'],
    queryFn: () =>
      api<CompteursValidations>('/absences/validations/compteurs', { arrierePlan: true }),
    enabled: Boolean(me.data),
    refetchInterval: 60_000,
  });
  const aUneEquipe = (validations.data?.equipe ?? 0) > 0;
  // « Candidatures non retenues » n'entre au menu qu'à partir d'une.
  const nonRetenues = useQuery({
    queryKey: ['candidatures-non-retenues', 'compte'],
    queryFn: () => api<{ count: number }>('/applications/rejected/count', { arrierePlan: true }),
    enabled: peut(me.data, 'recrutement.candidatures'),
  });
  // La page vidée sous les yeux (tout reconsidéré ou supprimé) garde son
  // entrée jusqu'à ce qu'on la quitte : le menu ne désigne pas une autre page.
  const avecNonRetenues =
    (nonRetenues.data?.count ?? 0) > 0 || pathname.startsWith('/recrutement/non-retenues');
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
  const restreint = Boolean(me.data?.finDAcces);
  const navAgent = useMemo(() => {
    const nav = personalNav(aUneEquipe, estDG);
    return restreint ? restreindre(nav) : nav;
  }, [aUneEquipe, estDG, restreint]);
  const navGestion = useMemo(
    () => (me.data && gestion ? navigationGestion(me.data, aTraiter, avecNonRetenues) : []),
    [me.data, gestion, aTraiter, avecNonRetenues],
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

  // Garde de routes : chacun reste dans ce que ses habilitations ouvrent. Le
  // serveur refuse de toute façon ; la garde évite d'ouvrir un écran vide.
  const autorise = (path: string): boolean => {
    const u = me.data;
    if (!u) return true;
    const commence = (p: string) => path === p || path.startsWith(`${p}/`);
    if (u.finDAcces && fermeeAuxInactifs(path)) return false;
    if (path === '/moi/conges') return !u.estDG;
    // Ce que traite la DCH : attendre les compteurs, qui disent si une
    // demande a été confiée à l'agent.
    const file = FILES.find((f) => commence(f.href));
    if (file) {
      return (
        !validations.data ||
        file.capacites.some((c) => peut(u, c)) ||
        (aTraiter?.[file.type] ?? 0) > 0 ||
        (file.type === 'conges' && u.role === 'admin')
      );
    }
    if (commence('/moi/delegations')) return u.dirigeLaDCH || u.role === 'admin';
    if (commence('/generer')) return genereQuelqueChose(u);
    // Les objectifs : chacun les siens, le DG ceux de l'APIX, qui encadre son équipe.
    if (commence('/moi/objectifs-apix') || commence('/moi/tableau-de-bord')) return u.estDG;
    if (commence('/moi/objectifs')) return u.estAgent && !u.estDG;
    if (commence('/moi/equipe/suivi')) return !validations.data || (aUneEquipe && !u.estDG);
    if (commence('/moi') || commence('/calendrier') || commence('/notifications')) return true;
    // L'organigramme est un annuaire interne ; les textes de référence, le
    // cadre de tous ; l'Academy est faite pour les agents.
    if (commence('/organisation')) return true;
    if (path.endsWith('/deposer')) return peut(u, 'textes');
    if (commence('/reglementations')) return true;
    if (commence('/academy/gerer')) return peut(u, 'academy');
    // Ce qu'on garde de ses formations est à l'agent : l'administrateur, qui
    // ne l'est pas, n'ouvre du côté apprenant que l'aperçu de l'atelier.
    // Ses certificats restent aussi à qui n'est plus en activité.
    if (commence('/academy/certificats')) return u.estAgent || Boolean(u.finDAcces);
    if (commence('/academy/ma-liste')) return u.estAgent;
    if (commence('/academy')) return true;
    if (commence('/dashboard') || commence('/evaluation')) {
      return peut(u, 'pilotage');
    }
    if (commence('/employees/new') || path.endsWith('/modifier')) {
      return peut(u, 'personnel.gerer');
    }
    if (commence('/employees')) return peut(u, 'personnel.consulter');
    if (commence('/acces')) return peut(u, 'acces');
    if (commence('/absences/feries')) return peut(u, 'feries');
    if (commence('/absences/parametres')) return peut(u, 'conges.parametres');
    if (commence('/absences')) return peut(u, 'demandes.conges') || u.role === 'admin';
    if (commence('/recrutement/candidatures') || commence('/recrutement/non-retenues')) {
      return peut(u, 'recrutement.candidatures');
    }
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

  // Le lien d'un courriel mène à une page précise : la connexion y ramène.
  useEffect(() => {
    if (me.isError) {
      const suite = `${window.location.pathname}${window.location.search}`;
      router.replace(`/login?suite=${encodeURIComponent(suite)}`);
    }
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
  const salut = !titleOverride && salue(pathname);
  const action = pageAction(pathname, user, espace);
  // Qui n'est plus en activité garde ses certificats, une page de son
  // espace ; les raccourcis de l'Academy, eux, se ferment.
  const academy = espaceAcademy(pathname) && !restreint;
  // L'organigramme prend toute la largeur (cf. Page canevas) : son titre la
  // suit, au lieu de se centrer sur la largeur des autres pages.
  const canevas = pathname === '/organisation';
  const cheminMenu = pathname;
  const isActive = (href: string) =>
    href === '/moi' ? cheminMenu === '/moi' : cheminMenu.startsWith(href);
  /** Une sous-page couvre son chemin et ce qui en descend. */
  const isChildActive = (href: string) => cheminMenu === href || cheminMenu.startsWith(`${href}/`);
  // Sur téléphone, l'onglet d'une rubrique mène à sa première sous-page : les
  // autres se choisissent en tête de page — sans quoi « Historique » ou
  // « Joindre un document » n'auraient aucun chemin. La plus précise
  // s'allume, comme dans le menu.
  const rubrique = items.find((i) => i.children?.some((c) => isChildActive(c.href)));
  const sousPageActive = (rubrique?.children ?? [])
    .filter((c) => isChildActive(c.href))
    .reduce<string | null>(
      (long, c) => (long && long.length >= c.href.length ? long : c.href),
      null,
    );
  const basculeDEspace = deuxEspaces
    ? { vers: autre, alerte: alertes[autre], onBasculer: () => allerA(autre) }
    : undefined;

  return (
    /* Coquille d'application : la page elle-même ne défile pas. Le menu et
       l'en-tête restent en place, seul le contenu bouge.

       Tout se pose sur le fond de la page (ADR-0115) : ni bandeau bleu, ni
       colonne blanche. Le menu, le titre, les commandes sont écrits à même
       le fond ; seuls les blocs et les tableaux sont blancs. Le blanc
       désigne ainsi ce qu'on lit et ce qu'on remplit, et rien d'autre. */
    <div className="flex h-dvh overflow-hidden">
      {/* Le menu, à même le fond */}
      <aside className="hidden w-[16.5rem] shrink-0 flex-col lg:flex">
        {/* La marque en tête du menu, en ses couleurs, à la hauteur de
            l'en-tête : le logo et le titre de l'écran se lisent sur la même
            ligne. La cloche se tient au bout : comme le menu, elle suit la
            personne d'une page à l'autre. */}
        <div className="flex h-[76px] shrink-0 items-center gap-2 pr-3 pl-[26px]">
          <Link
            href={accueil}
            aria-label="Accueil"
            className="flex min-w-0 items-center rounded-controle-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
          >
            <BrandMark variant="menu" />
          </Link>
          {large ? (
            <span className="ml-auto flex">
              <NotificationsBell variante="menu" espace={deuxEspaces ? espace : undefined} />
            </span>
          ) : null}
        </div>

        {/* La liste défile à l'intérieur si elle dépasse : la marque et la
            personne restent en place. */}
        <nav aria-label="Menu" className="min-h-0 flex-1 overflow-y-auto px-3 pt-1 pb-3">
          {items.map((item, i) => {
            // Le blanc entre deux familles vaut un intitulé, et ne coûte
            // pas de ligne. Il se calcule sur l'entrée PRÉCÉDENTE RENDUE,
            // pas sur l'ordre d'écriture : la navigation d'un rôle peut
            // être amputée de deux entrées, et une famille réduite à rien
            // ne doit pas laisser un trou derrière elle.
            const changeDeFamille = i > 0 && item.groupe !== items[i - 1]!.groupe;
            return (
              <div key={item.href} className={cn('flex flex-col', changeDeFamille && 'mt-4')}>
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
        </nav>

        {/* Qui je suis, au pied du menu, sous un filet : ce n'est pas une
            destination de plus, c'est l'identité de la session. Tout le bloc
            ouvre le menu du compte. */}
        <div className="shrink-0 px-3 pb-3">
          <div className="border-t border-line-soft pt-3">
            <MenuCompte
              variante="colonne"
              certificats={espace === 'agent'}
              bascule={basculeDEspace}
              identite={{
                // Plusieurs prénoms : le premier, l'initiale du deuxième, le
                // nom (« Mouhamadou M. Ba ») ; le nom entier au survol.
                nom: nomCourt(user.givenName, user.familyName),
                nomComplet: `${user.givenName} ${user.familyName}`,
                qualite: qualite(user, espace),
              }}
            />
          </div>
        </div>
      </aside>

      {/* L'écran */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* L'en-tête et la page ne font qu'un seul fond, même quand le
            contenu défile : aucun filet ne les sépare (ADR-0122). */}
        <header className="relative z-10 flex h-14 shrink-0 items-center px-4 lg:h-[76px] lg:px-7">
          <div
            className={cn(
              'mx-auto flex w-full min-w-0 items-center gap-3 lg:gap-4',
              canevas ? 'max-w-none' : 'max-w-page',
            )}
          >
            {/* Sur téléphone, le menu n'existe pas : la marque se pose ici,
                et le titre descend en tête de la page. */}
            <Link
              href={accueil}
              aria-label="Accueil"
              className="flex shrink-0 items-center rounded-controle-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary lg:hidden"
            >
              <BrandMark variant="barre" />
            </Link>
            {/* À gauche du titre, le retour que la page y pose, s'il y en a un
                (cf. components/entete.tsx). */}
            <div className="hidden min-w-0 items-center gap-3 lg:flex">
              <div id={ANCRE_RETOUR} className="flex shrink-0 empty:hidden" />
              <TitreDeLEcran titre={title} salut={salut} />
            </div>

            {/* Emplacement laissé aux écrans qui ont des onglets à poser ici.
                La coquille ne sait pas lesquels : elle réserve la place, la
                page y écrit par un portail (cf. components/onglets.tsx). */}
            <div id={ANCRE_ONGLETS} className="hidden shrink-0 lg:flex" />

            <div className="ml-auto flex shrink-0 items-center gap-2">
              {/* La recherche du catalogue : elle lit et écrit l'adresse
                  (?q=), d'où la frontière Suspense qu'exige Next. */}
              {academy ? (
                <Suspense fallback={null}>
                  <RechercheAcademy />
                </Suspense>
              ) : null}
              {/* Les gestes que la page y pose, par un portail : « Télécharger »
                  le document qu'elle montre (cf. components/entete.tsx). */}
              <div id={ANCRE_ACTIONS} className="flex shrink-0 items-center gap-2 empty:hidden" />
              {action ? <ActionDeLEcran action={action} /> : null}
              {/* Les raccourcis de qui apprend, dans l'Academy ; le compte
                  d'administration, qui n'y vient que pour l'aperçu de
                  l'atelier, n'en a pas. */}
              {academy && espace === 'agent' ? (
                <>
                  <LienDeLEntete
                    href="/academy/certificats"
                    icone="workspace_premium"
                    libelle="Mes certificats"
                    actif={pathname === '/academy/certificats'}
                  />
                  <LienDeLEntete
                    href="/academy/ma-liste"
                    icone="bookmark"
                    libelle="Ma liste"
                    actif={pathname === '/academy/ma-liste'}
                  />
                </>
              ) : null}
              <DateDuJour />
              {/* Sur téléphone, le menu n'existe pas : la cloche revient ici,
                  sauf dans l'Academy, où elle laisse la place à la recherche. */}
              {large || academy ? null : (
                <NotificationsBell variante="entete" espace={deuxEspaces ? espace : undefined} />
              )}
              {/* Sur téléphone le menu n'existe pas : sans ce bouton, ni le
                  thème ni la sortie ne seraient atteignables. */}
              <span className="lg:hidden">
                <MenuCompte
                  variante="entete"
                  certificats={espace === 'agent'}
                  bascule={basculeDEspace}
                />
              </span>
            </div>
          </div>
        </header>

        {/* Le seul panneau qui défile. `data-scroll-root` le signale aux
            fenêtres modales, qui doivent le geler comme elles gèlent la page. */}
        <main
          data-scroll-root
          className="min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-2 pb-24 lg:px-7 lg:pt-1 lg:pb-10"
        >
          <div className="mb-4 flex min-w-0 items-center gap-3 lg:hidden">
            <div id={ANCRE_RETOUR_TELEPHONE} className="flex shrink-0 empty:hidden" />
            <TitreDeLEcran titre={title} salut={salut} />
          </div>
          {rubrique && (rubrique.children?.length ?? 0) > 1 ? (
            <nav
              aria-label={rubrique.label}
              className="mb-4 flex gap-1.5 overflow-x-auto lg:hidden"
            >
              {rubrique.children!.map((c) =>
                // Éteinte, comme dans le menu : à sa place, grisée, sans lien.
                c.desactive ? (
                  <span
                    key={c.href}
                    aria-disabled
                    className="shrink-0 cursor-not-allowed rounded-controle border border-line-soft px-3 py-1.5 text-[12px] font-medium whitespace-nowrap text-ink-muted/45 select-none"
                  >
                    {c.label}
                  </span>
                ) : (
                  <Link
                    key={c.href}
                    href={c.href}
                    aria-current={c.href === sousPageActive ? 'page' : undefined}
                    className={cn(
                      'shrink-0 rounded-controle border px-3 py-1.5 text-[12px] font-medium whitespace-nowrap transition-colors duration-150',
                      c.href === sousPageActive
                        ? 'border-primary bg-primary-soft font-semibold text-primary'
                        : 'border-line bg-surface text-ink-muted hover:bg-hover',
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

      {/* Barre d'onglets mobile */}
      <nav
        aria-label="Menu"
        className="fixed inset-x-0 bottom-0 z-20 flex justify-around gap-1 overflow-x-auto border-t border-line-soft bg-surface px-2 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] lg:hidden"
      >
        {items.map((item) => {
          const active = isActive(item.href);
          // Une rubrique n'a pas de page à elle : l'onglet mène à sa première
          // sous-page ouverte, sinon il ouvrirait une redirection au lieu d'un écran.
          const cible = item.children?.find((c) => !c.desactive)?.href ?? item.href;
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
