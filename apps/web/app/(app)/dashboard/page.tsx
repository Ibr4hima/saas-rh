'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type { AbsenceRequestView, DashboardHoliday, DashboardView } from '@teranga/contracts';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardInteractive,
  CardTitle,
  cn,
  EmptyState,
  Skeleton,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@teranga/ui';
import { Icon, type IconName } from '../../../components/icons';
import { api } from '../../../lib/api';
import { formatDate, useMe } from '../../../lib/hooks';

/* ————————————————————————————————————————————————————————————————
   L'écran d'accueil répond à trois questions, dans l'ordre :
   1. « Y a-t-il quelque chose qui m'attend ? »  → indicateurs + À traiter
   2. « Qui est là ? »                           → effectifs, parité, absents
   3. « Que se passe-t-il bientôt ? »            → absences, échéances, fériés

   Une seule grammaire pour toutes les cartes : un intitulé en petites
   capitales, à droite le geste ou le total, en dessous des RANGÉES — jamais
   un tableau là où six lignes suffisent. Ce qui se clique se soulève ou se
   teinte au survol ; ce qui ne se clique pas reste posé.
   ———————————————————————————————————————————————————————————————— */

const TABULAIRE = { fontVariantNumeric: 'tabular-nums' } as const;

/** Jours d'écart avec aujourd'hui — négatif vers le passé. */
function ecartJours(iso: string): number {
  return Math.round(
    (new Date(`${iso}T00:00:00`).getTime() - new Date().setHours(0, 0, 0, 0)) / 86_400_000,
  );
}

/** « hier », « aujourd'hui », « dans 12 j » — l'écart parle mieux que la date. */
function inDays(iso: string): string {
  const days = ecartJours(iso);
  if (days === 0) return "aujourd'hui";
  if (days === 1) return 'demain';
  if (days === -1) return 'hier';
  return days < 0 ? `il y a ${-days} j` : `dans ${days} j`;
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
 * L'échéance de contrat, écrite comme on la dirait. « 16 j » obligeait à
 * deviner de quel côté de la date on se trouvait ; « Échu · il y a 16 jours »
 * ne se devine pas.
 */
function deadlineLabel(daysLeft: number | null): {
  text: string;
  tone: 'danger' | 'warning' | 'neutral';
} {
  if (daysLeft === null) return { text: 'À préciser', tone: 'danger' };
  if (daysLeft < 0) return { text: `Échu · il y a ${plural(-daysLeft, 'jour')}`, tone: 'danger' };
  if (daysLeft === 0) return { text: "Échoit aujourd'hui", tone: 'danger' };
  if (daysLeft === 1) return { text: 'Échoit demain', tone: 'warning' };
  return { text: `Dans ${plural(daysLeft, 'jour')}`, tone: daysLeft <= 30 ? 'warning' : 'neutral' };
}

/* ———— Pièces communes ———— */

/** Le total d'une carte, à droite de son titre : « 3 agents ». */
function TotalCarte({ children }: { children: React.ReactNode }) {
  return (
    <span className="shrink-0 text-[11.5px] text-ink-muted" style={TABULAIRE}>
      {children}
    </span>
  );
}

/** Rangées en attente : mêmes hauteurs que les vraies, pour que rien ne saute. */
function RangeesEnAttente({ n }: { n: number }) {
  return (
    <ul className="flex flex-col px-2.5">
      {Array.from({ length: n }, (_, i) => (
        <li key={i} className="flex items-center gap-3 py-2">
          <Skeleton className="size-8 rounded-full" />
          <span className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-2.5 w-56 max-w-full" />
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ———— Indicateurs ———— */

function StatTile({
  icon,
  label,
  short,
  value,
  context,
  href,
}: {
  icon: IconName;
  label: string;
  /** L'étiquette d'un téléphone, où deux tuiles se partagent 360 px. */
  short: string;
  /** Un nombre le plus souvent, une date pour le prochain férié. */
  value: React.ReactNode;
  context?: string;
  href: string;
}) {
  return (
    /* L'étiquette passe AVANT le chiffre : on lit « ce que c'est » puis
       « combien », l'ordre dans lequel la question se pose. L'icône tient
       dans une pastille bleue, à droite — la même pour les quatre tuiles :
       une pastille orange sur l'une d'elles la faisait lire comme une alerte
       permanente, alors qu'elle ne fait qu'ouvrir un écran. La flèche
       n'apparaît qu'au survol : la tuile est une porte, on ne le voit qu'en
       s'approchant. */
    <Link
      href={href}
      className="group block rounded-[14px] focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
    >
      <CardInteractive className="relative h-full px-4 pt-3.5 pb-4">
        <div className="flex items-center justify-between gap-3">
          <p className="truncate text-[10px] font-bold tracking-[0.1em] text-ink-muted uppercase">
            <span className="sm:hidden">{short}</span>
            <span className="hidden sm:inline">{label}</span>
          </p>
          <span className="flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-primary/[0.07] text-primary transition-colors duration-200 group-hover:bg-primary/[0.12]">
            <Icon name={icon} size={17} />
          </span>
        </div>
        {value === undefined ? (
          <Skeleton className="mt-3 h-[30px] w-14" />
        ) : (
          <p
            className="mt-2.5 text-[26px] leading-none font-bold tracking-[-0.025em] text-ink-strong sm:text-[30px]"
            style={TABULAIRE}
          >
            {value}
          </p>
        )}
        {context ? (
          <p className="mt-2 text-[11.5px] text-ink-muted sm:truncate sm:pr-5">{context}</p>
        ) : null}
        <Icon
          name="arrow_forward"
          size={16}
          className="absolute right-3.5 bottom-3.5 hidden -translate-x-1 text-primary opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100 sm:block"
        />
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
  icon: IconName;
  label: string;
  detail: string;
  count: number;
  href: string;
}) {
  return (
    <li>
      <Link
        href={href}
        className="group flex items-center gap-3 rounded-[9px] px-2.5 py-2.5 transition-colors duration-150 hover:bg-hover"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-primary/[0.07] text-primary">
          <Icon name={icon} size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] font-semibold text-ink-strong">{label}</span>
          <span className="block truncate text-[11.5px] text-ink-muted">{detail}</span>
        </span>
        <span
          className="rounded-full bg-alert-soft px-2 py-px text-[11px] font-extrabold text-alert-text"
          style={TABULAIRE}
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
  id,
  label,
  title,
  value,
  max,
  total,
}: {
  /** null = les agents sans affectation : pas d'unité à ouvrir. */
  id: string | null;
  label: string;
  title: string;
  value: number;
  max: number;
  total: number;
}) {
  const width = max > 0 ? Math.max((value / max) * 100, value > 0 ? 6 : 0) : 0;
  const part = total > 0 ? Math.round((value / total) * 100) : 0;
  const contenu = (
    <>
      <span
        className={cn(
          'w-12 shrink-0 truncate text-xs font-medium',
          value > 0 ? 'text-ink' : 'text-ink-muted',
        )}
      >
        {label}
      </span>
      <span className="h-1.5 flex-1 overflow-hidden rounded-[4px] bg-chart-track">
        <span
          className="block h-full bg-chart transition-[width] duration-500 ease-out"
          style={{ width: `${width}%`, borderRadius: '0 4px 4px 0' }}
        />
      </span>
      <span
        className={cn(
          'w-6 shrink-0 text-right text-xs font-semibold',
          value > 0 ? 'text-ink-strong' : 'text-ink-muted',
        )}
        style={TABULAIRE}
      >
        {value}
      </span>
    </>
  );
  const forme = '-mx-2 flex items-center gap-3 rounded-[7px] px-2 py-1';
  return (
    <li title={`${title} — ${plural(value, 'agent')} · ${part} %`}>
      {id ? (
        <Link
          href={`/organisation?unite=${id}`}
          className={cn(forme, 'transition-colors duration-150 hover:bg-hover')}
        >
          {contenu}
        </Link>
      ) : (
        <span className={forme}>{contenu}</span>
      )}
    </li>
  );
}

/* ———— La frise des fériés ———— */

/** Position du centre d'une date sur le rail, en % de la largeur. */
const centre = (i: number, n: number) => ((i + 0.5) / n) * 100;

/**
 * Le calendrier des fériés : le dernier passé, puis les trois qui viennent.
 *
 * Le passé n'est pas là pour décorer — c'est lui qui donne à « aujourd'hui »
 * un point d'appui. Sans lui, le repère du jour n'aurait rien devant quoi se
 * placer et la frise commencerait dans le vide.
 *
 * Les dates sont à intervalles ÉGAUX : l'espacement dit l'ordre, la mention
 * « dans 49 j » dit la distance. Le seul élément placé à sa vraie proportion
 * est le repère du jour, entre le férié passé et le prochain — le seul endroit
 * où la position apporte quelque chose qu'aucun mot ne dit aussi vite.
 */
function Frise({ jours }: { jours: DashboardHoliday[] }) {
  const n = jours.length;
  const passes = jours.filter((h) => ecartJours(h.day) < 0).length;
  const garde = `${50 / n}%`;

  // Le repère du jour ne se dessine que s'il est encadré : il lui faut un
  // férié derrière et un devant.
  let repere: number | null = null;
  if (passes > 0 && passes < n) {
    const avant = ecartJours(jours[passes - 1]!.day); // négatif
    const apres = ecartJours(jours[passes]!.day); // positif ou nul
    const brut = -avant / (apres - avant);
    // Bridé au quart central du segment. La proportion vraie peut valoir 0,95
    // — un férié passé il y a dix-huit jours, le suivant demain — et la
    // pastille du repère viendrait alors mordre sur la date voisine.
    const t = Math.min(0.62, Math.max(0.38, brut));
    repere = centre(passes - 1, n) + t * (centre(passes, n) - centre(passes - 1, n));
  }

  return (
    <div className="relative">
      {/* Le rail court d'un centre de date à l'autre, jamais d'un bord à
          l'autre de la carte : un trait qui dépasse ne mène à rien. Il est
          coupé en deux au niveau du jour — ce qui est écoulé porte un gris
          plus dense que ce qui reste à venir. */}
      <span
        aria-hidden
        className="absolute top-[45px] h-[2px] rounded-full bg-line-soft"
        style={{ left: garde, right: garde }}
      />
      {repere !== null ? (
        <>
          <span
            aria-hidden
            className="absolute top-[45px] h-[2px] rounded-full bg-line"
            style={{ left: garde, width: `calc(${repere}% - ${garde})` }}
          />
          <span
            className="absolute top-[38px] hidden -translate-x-1/2 rounded-full border border-line bg-surface px-2 py-[3px] text-[9px] font-bold tracking-[0.08em] text-ink-muted uppercase shadow-xs sm:block"
            style={{ left: `${repere}%` }}
          >
            Aujourd&apos;hui
          </span>
        </>
      ) : null}

      <ol className="relative flex">
        {jours.map((h, i) => (
          <DateFerie
            key={h.day}
            day={h.day}
            label={h.label}
            etat={i < passes ? 'passe' : i === passes ? 'prochain' : 'avenir'}
          />
        ))}
      </ol>
    </div>
  );
}

function DateFerie({
  day,
  label,
  etat,
}: {
  day: string;
  label: string;
  etat: 'passe' | 'prochain' | 'avenir';
}) {
  const date = new Date(`${day}T00:00:00`);
  const prochain = etat === 'prochain';
  const passe = etat === 'passe';
  return (
    <li className="relative flex min-w-0 flex-1 flex-col items-center px-1 pt-5 text-center sm:px-3">
      {prochain ? (
        <span className="absolute top-0 text-[9px] font-extrabold tracking-[0.12em] text-primary uppercase">
          Prochain
        </span>
      ) : null}
      {/* Un carré aux angles très adoucis plutôt qu'un rond : la date y tient
          sur deux lignes sans que le mois vienne toucher le bord. */}
      <span
        className={cn(
          'flex size-[52px] shrink-0 flex-col items-center justify-center rounded-[15px] border transition-colors duration-200',
          prochain
            ? 'ferie-prochain border-transparent bg-primary text-primary-ink'
            : passe
              ? 'ferie-neutre border-line-soft bg-bg text-ink-muted'
              : 'ferie-neutre border-line bg-surface text-ink-strong',
        )}
      >
        <span className="text-[17px] leading-none font-bold" style={TABULAIRE}>
          {Number(day.slice(8, 10))}
        </span>
        <span
          className={cn(
            'mt-1 text-[9px] leading-none font-bold tracking-[0.06em] uppercase',
            prochain ? 'text-primary-ink/75' : passe ? 'text-ink-muted' : 'text-ink-muted',
          )}
        >
          {date.toLocaleDateString('fr-FR', { month: 'short' })}
        </span>
      </span>
      <span
        className={cn(
          'mt-3 line-clamp-2 text-[12.5px] leading-tight font-semibold',
          passe ? 'text-ink-muted' : 'text-ink-strong',
        )}
      >
        {label}
      </span>
      <span className="mt-1 text-[11px] leading-tight text-ink-muted">
        <span className="capitalize">{date.toLocaleDateString('fr-FR', { weekday: 'long' })}</span>
        {' · '}
        <span className={prochain ? 'font-semibold text-primary' : undefined}>{inDays(day)}</span>
      </span>
    </li>
  );
}

/* ———— Parité ———— */

/**
 * Deux segments dans une même barre, et leurs étiquettes juste dessous.
 *
 * La couleur n'est jamais seule à porter l'information : chaque segment a son
 * libellé écrit, ce qui met la lecture à l'abri d'un écran mal réglé comme
 * d'un daltonisme. Les deux teintes se séparent de toute façon largement
 * (cf. --tg-chart-2 dans tokens.css), et un jour de blanc les écarte pour que
 * la barre ne se lise pas comme un seul bloc.
 */
function Parite({ femmes, hommes }: { femmes: number; hommes: number }) {
  const total = femmes + hommes;
  if (total === 0) return null;
  return (
    <div className="mt-4 border-t border-line-soft pt-3.5">
      <p className="text-[10px] font-bold tracking-[0.1em] text-ink-muted uppercase">Parité</p>
      <div className="mt-2.5 flex h-2 gap-[2px]">
        {femmes > 0 ? (
          <span
            className="rounded-full bg-chart-2"
            style={{ width: `${(femmes / total) * 100}%` }}
          />
        ) : null}
        {hommes > 0 ? <span className="flex-1 rounded-full bg-chart" /> : null}
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
        {[
          { n: femmes, mot: 'femme', teinte: 'bg-chart-2' },
          { n: hommes, mot: 'homme', teinte: 'bg-chart' },
        ].map((x) => (
          <li key={x.mot} className="flex items-center gap-1.5 text-xs text-ink-muted">
            <span aria-hidden className={cn('size-2 shrink-0 rounded-full', x.teinte)} />
            {plural(x.n, x.mot)}
          </li>
        ))}
      </ul>
    </div>
  );
}

interface EntreeATraiter {
  icon: IconName;
  label: string;
  detail: string;
  count: number;
  href: string;
  show: boolean;
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
  const d = stats.data;
  const todayIso = localToday();

  const inbox: EntreeATraiter[] = [
    {
      icon: 'free_cancellation',
      label: 'Demandes de congés',
      detail: 'À viser — les soldes sont vérifiés, il ne manque que vous.',
      count: d?.pendingRequests ?? 0,
      href: '/absences',
      show: true,
    },
    {
      icon: 'folder_managed',
      label: 'Demandes de documents',
      detail: 'À générer, cacheter, signer puis annoncer le retrait.',
      count: d?.pendingDocumentRequests ?? 0,
      href: '/documents',
      show: canManage,
    },
    {
      icon: 'badge',
      label: 'Informations personnelles',
      detail: 'Changements déclarés par les agents, à confirmer sur leur fiche.',
      count: d?.pendingProfileChanges ?? 0,
      href: '/employees',
      show: canManage,
    },
  ];
  const aTraiter = inbox.filter((r) => r.show && r.count > 0);

  // La quatrième tuile montre le prochain férié : la fenêtre renvoyée par
  // l'API contient aussi le dernier passé, on prend la première date à venir.
  const fenetreFeries = d?.holidayWindow ?? [];
  const prochainFerie = fenetreFeries.find((h) => ecartJours(h.day) >= 0);

  const absences = upcoming.data ?? [];
  const ABSENCES_VISIBLES = 6;
  const absencesEnPlus = absences.length - ABSENCES_VISIBLES;

  const maxHeadcount = Math.max(...(d?.headcountByDirection.map((x) => x.headcount) ?? [0]), 1);
  const unassigned = d
    ? d.activeEmployees - d.headcountByDirection.reduce((s, x) => s + x.headcount, 0)
    : 0;

  return (
    <div className="mx-auto max-w-[1240px]">
      {/* ———— Indicateurs ———— */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatTile
          icon="group"
          label="Effectif actif"
          short="Effectif"
          value={d?.activeEmployees}
          context={
            d
              ? d.hiredLast90d > 0
                ? `dont ${plural(d.hiredLast90d, 'recruté')} en 90 j`
                : `${plural(d.women, 'femme')} · ${plural(d.men, 'homme')}`
              : undefined
          }
          href="/employees"
        />
        <StatTile
          icon="free_cancellation"
          label="Demandes à valider"
          short="À valider"
          value={d?.pendingRequests}
          context="congés en attente de visa"
          href="/absences"
        />
        <StatTile
          icon="event_busy"
          label="Absents aujourd'hui"
          short="Absents"
          value={d?.absentToday}
          context={d ? `${d.upcomingAbsences} à venir sous 30 j` : undefined}
          href="/calendrier"
        />
        <StatTile
          icon="flag"
          label="Proch. jour férié"
          short="Férié"
          value={
            d
              ? prochainFerie
                ? new Date(`${prochainFerie.day}T00:00:00`).toLocaleDateString('fr-FR', {
                    day: 'numeric',
                    month: 'short',
                  })
                : '—'
              : undefined
          }
          context={
            prochainFerie
              ? `${prochainFerie.label} · ${inDays(prochainFerie.day)}`
              : d
                ? 'aucun férié programmé'
                : undefined
          }
          href="/absences/feries"
        />
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
                <RangeesEnAttente n={2} />
              ) : aTraiter.length === 0 ? (
                <EmptyState
                  className="py-7"
                  icon={<Icon name="task_alt" size={22} />}
                  title="Rien à traiter"
                  description="Les demandes de congés, de documents et les changements d'informations arrivent ici."
                />
              ) : (
                <ul className="flex flex-col">
                  {aTraiter.map((r) => (
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
            ) : absences.length === 0 ? (
              <EmptyState
                className="py-7"
                icon={<Icon name="event_available" size={22} />}
                title="Personne d'absent à l'horizon"
                description="Aucune absence approuvée dans les 30 prochains jours."
              />
            ) : (
              <>
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
                    {absences.slice(0, ABSENCES_VISIBLES).map((r) => (
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
                {absencesEnPlus > 0 ? (
                  <CardContent className="border-t border-line-soft py-3">
                    <p className="text-xs text-ink-muted">
                      {plural(absencesEnPlus, 'autre')} sous 30 jours — le calendrier les montre
                      toutes.
                    </p>
                  </CardContent>
                ) : null}
              </>
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
                <div className="flex flex-col gap-3">
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              ) : (d?.headcountByDirection ?? []).length === 0 ? (
                <p className="text-sm text-ink-muted">
                  Créez vos directions dans l&apos;organigramme.
                </p>
              ) : (
                <>
                  <ul className="flex flex-col gap-1.5">
                    {d!.headcountByDirection.map((x) => (
                      <DirectionBar
                        key={x.id}
                        id={x.id}
                        label={x.shortName ?? x.name}
                        title={x.name}
                        value={x.headcount}
                        max={maxHeadcount}
                        total={d!.activeEmployees}
                      />
                    ))}
                    {unassigned > 0 ? (
                      <DirectionBar
                        id={null}
                        label="—"
                        title="Sans affectation"
                        value={unassigned}
                        max={maxHeadcount}
                        total={d!.activeEmployees}
                      />
                    ) : null}
                  </ul>
                  {d ? <Parite femmes={d.women} hommes={d.men} /> : null}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ———— Les fériés, en frise ———— */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Calendrier des jours fériés</CardTitle>
        </CardHeader>
        <CardContent className="pt-1 pb-6">
          {stats.isLoading ? (
            <Skeleton className="h-28 w-full" />
          ) : fenetreFeries.length === 0 ? (
            <p className="py-3 text-sm text-ink-muted">
              Aucun férié enregistré — la liste se gère dans les paramètres des congés.
            </p>
          ) : (
            <Frise jours={fenetreFeries} />
          )}
        </CardContent>
      </Card>

      {seesContracts ? (
        <Card className="mt-4">
          <CardHeader className="flex items-center justify-between gap-3">
            <CardTitle>Suivi des contrats</CardTitle>
            <TotalCarte>CDD et stages en cours</TotalCarte>
          </CardHeader>
          {stats.isLoading ? (
            <CardContent>
              <Skeleton className="h-20 w-full" />
            </CardContent>
          ) : (d?.contractFollowUp ?? []).length === 0 ? (
            <EmptyState
              className="py-7"
              icon={<Icon name="description" size={22} />}
              title="Aucun contrat à durée limitée"
              description="Les CDD et les stages en cours apparaîtront ici, les plus proches de leur terme d'abord."
            />
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
