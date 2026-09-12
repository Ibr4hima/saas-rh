'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type {
  AbsenceRequestView,
  DashboardHoliday,
  DashboardView,
  ExpiringContractView,
} from '@teranga/contracts';
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

/* ———— Pièces communes ———— */

/** Le geste d'une carte, à droite de son titre : « Voir le calendrier → ». */
function LienCarte({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="group/lien inline-flex shrink-0 items-center gap-1 rounded-md text-[11.5px] font-semibold text-primary transition-colors hover:text-primary-hover focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
    >
      {children}
      <Icon
        name="arrow_forward"
        size={14}
        className="transition-transform duration-150 group-hover/lien:translate-x-0.5"
      />
    </Link>
  );
}

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
  alert,
}: {
  icon: IconName;
  label: string;
  /** L'étiquette d'un téléphone, où deux tuiles se partagent 360 px. */
  short: string;
  value: number | undefined;
  context?: string;
  href: string;
  /** true = ce chiffre attend une action : la pastille passe à l'orange de charte. */
  alert?: boolean;
}) {
  return (
    /* L'étiquette passe AVANT le chiffre : on lit « ce que c'est » puis
       « combien », l'ordre dans lequel la question se pose. L'icône tient
       dans une pastille, à droite : c'est elle qui dit si la tuile ATTEND
       quelque chose (orange) ou informe seulement (bleu). La flèche n'apparaît
       qu'au survol — la tuile est une porte, on ne le voit qu'en s'approchant. */
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
          <span
            className={cn(
              'flex size-7 shrink-0 items-center justify-center rounded-[8px] transition-colors duration-200',
              alert
                ? 'bg-accent-soft text-accent-text'
                : 'bg-primary/[0.07] text-primary group-hover:bg-primary/[0.12]',
            )}
          >
            <Icon name={icon} size={17} />
          </span>
        </div>
        {value === undefined ? (
          <Skeleton className="mt-3 h-[30px] w-14" />
        ) : (
          <p
            className="mt-2.5 text-[30px] leading-none font-bold tracking-[-0.025em] text-ink-strong"
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

/* ———— Les fériés en frise : le temps de gauche à droite ———— */

/**
 * Une frise, pas une liste. Trois dates posées sur un rail, à intervalles
 * égaux — l'espacement dit l'ORDRE, la mention « dans 50 j » dit la distance ;
 * espacer proportionnellement aurait collé les deux premières pastilles l'une
 * contre l'autre dès que le premier férié tombe cette semaine.
 *
 * Le prochain porte seul la couleur : c'est la seule date sur laquelle on ait
 * quelque chose à décider cette semaine-là.
 */
function Frise({ jours }: { jours: DashboardHoliday[] }) {
  // Le rail court d'un centre de pastille à l'autre, pas d'un bord à l'autre
  // de la carte : un trait qui dépasse de la première date ne mène à rien.
  const garde = `${50 / jours.length}%`;
  return (
    <ol className="relative flex pt-2">
      <span
        aria-hidden
        className="absolute top-[25px] h-px bg-line"
        style={{ left: garde, right: garde }}
      />
      {jours.map((h, i) => (
        <NoeudFerie key={h.day} day={h.day} label={h.label} prochain={i === 0} />
      ))}
    </ol>
  );
}

function NoeudFerie({ day, label, prochain }: { day: string; label: string; prochain: boolean }) {
  const date = new Date(`${day}T00:00:00`);
  return (
    <li className="relative flex min-w-0 flex-1 flex-col items-center px-1.5 text-center sm:px-3">
      {/* L'anneau à la couleur de la carte découpe le rail autour de la
          pastille : le trait s'arrête net au lieu de la traverser. */}
      <span
        className={cn(
          'flex size-[46px] shrink-0 flex-col items-center justify-center rounded-full border ring-4 ring-surface',
          prochain ? 'border-primary/30 bg-primary-soft' : 'border-line bg-surface',
        )}
      >
        <span
          className={cn(
            'text-[15px] leading-none font-bold',
            prochain ? 'text-primary' : 'text-ink-strong',
          )}
          style={TABULAIRE}
        >
          {Number(day.slice(8, 10))}
        </span>
        <span
          className={cn(
            'mt-0.5 text-[9px] leading-none font-semibold uppercase',
            prochain ? 'text-primary/80' : 'text-ink-muted',
          )}
        >
          {date.toLocaleDateString('fr-FR', { month: 'short' })}
        </span>
      </span>
      <span className="mt-2.5 line-clamp-2 text-[12.5px] leading-tight font-semibold text-ink-strong">
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
  const expiring = useQuery({
    queryKey: ['contracts-expiring'],
    queryFn: () => api<ExpiringContractView[]>('/contracts/expiring'),
    enabled: seesContracts,
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
          alert={(d?.pendingRequests ?? 0) > 0}
        />
        <StatTile
          icon="event_busy"
          label="Absents aujourd'hui"
          short="Absents"
          value={d?.absentToday}
          context={d ? `${d.upcomingAbsences} à venir sous 30 j` : undefined}
          href="/calendrier"
        />
        {seesContracts ? (
          <StatTile
            icon="schedule"
            label="Contrats à suivre"
            short="Contrats"
            value={expiring.data?.length}
            context="échéance sous 30 jours"
            href="/employees"
            alert={(expiring.data?.length ?? 0) > 0}
          />
        ) : (
          <StatTile
            icon="family_history"
            label="Unités d'organisation"
            short="Unités"
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
            <CardHeader className="flex items-center justify-between gap-3">
              <CardTitle>Calendrier des absences</CardTitle>
              <LienCarte href="/calendrier">Voir le calendrier</LienCarte>
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
                  {d && d.women + d.men > 0 ? (
                    <p className="mt-3.5 border-t border-line-soft pt-3 text-xs text-ink-muted">
                      Parité : {plural(d.women, 'femme')} · {plural(d.men, 'homme')}
                    </p>
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ———— Les fériés, en frise ———— */}
      <Card className="mt-4">
        <CardHeader className="flex items-center justify-between gap-3">
          <CardTitle>Prochains jours fériés</CardTitle>
          {canManage ? <LienCarte href="/absences/feries">Gérer</LienCarte> : null}
        </CardHeader>
        <CardContent className="pt-1">
          {stats.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (d?.upcomingHolidays ?? []).length === 0 ? (
            <p className="py-3 text-sm text-ink-muted">
              Aucun férié à venir — la liste se gère dans les paramètres des congés.
            </p>
          ) : (
            <Frise jours={d!.upcomingHolidays} />
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
                        <Td>
                          <Badge className="uppercase">{c.contractType}</Badge>
                        </Td>
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
