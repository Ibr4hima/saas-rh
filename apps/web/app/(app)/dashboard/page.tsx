'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type {
  AbsenceRequestView,
  DashboardDirectionHeadcount,
  DashboardHoliday,
  DashboardView,
} from '@teranga/contracts';
import { peut } from '@teranga/contracts';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardInteractive,
  CardTitle,
  cn,
  DataBlock,
  DataGrid,
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
import { Modal } from '../../../components/modal';
import { api } from '../../../lib/api';
import { formatDate, useMe } from '../../../lib/hooks';
import { Page } from '../../../components/gabarit';
import { Pagination, usePagination } from '../../../components/pagination';
import { compte } from '../../../lib/mots';
import { deadlineLabel } from '../../../lib/contrats';
import { SqueletteTableau } from '../../../components/tableau';

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
/**
 * « 2 hommes · 4 femmes » sous l'effectif.
 *
 * Remplace le « dont N recrutés en 90 j » qui n'apparaissait qu'en période de
 * recrutement : la carte changeait de sujet sans prévenir, et la répartition
 * — qu'on cite dans tout rapport d'activité — ne se voyait qu'une fois les
 * arrivées passées.
 *
 * Le SEXE NON RENSEIGNÉ se dit quand il y en a. L'API compte par genre et
 * range les dossiers vides à part : sans cette mention, « 2 hommes · 3
 * femmes » s'écrirait sous un effectif de 6 et l'addition serait fausse à
 * l'œil de qui la fait.
 */
function repartition(d: DashboardView): string {
  const parts = [compte(d.men, 'homme'), compte(d.women, 'femme')];
  const sansSexe = d.activeEmployees - d.men - d.women;
  if (sansSexe > 0) parts.push(`${sansSexe} non précisé${sansSexe > 1 ? 's' : ''}`);
  return parts.join(' · ');
}

function inDays(iso: string): string {
  const days = ecartJours(iso);
  if (days === 0) return "aujourd'hui";
  if (days === 1) return 'demain';
  if (days === -1) return 'hier';
  // « dans 45 jours », pas « dans 45 j » : l'abréviation se lisait comme une
  // unité de mesure dans une phrase qui, elle, est écrite en français.
  return days < 0 ? `il y a ${compte(-days, 'jour')}` : `dans ${compte(days, 'jour')}`;
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

/* ———— Pièces communes ———— */

/** L'âge moyen, en années : le nombre en grand, l'unité en retrait. */
function AgeMoyen({ d }: { d: DashboardView }) {
  if (d.averageAge === null) {
    return <span className="text-[15px] font-semibold text-ink-muted">Non renseignée</span>;
  }
  return (
    <>
      {d.averageAge.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}
      <span className="ml-1 text-[15px] font-semibold tracking-normal text-ink-muted">ans</span>
    </>
  );
}

/**
 * Sous l'âge moyen : l'écart entre le plus jeune et le plus âgé, ou, s'il
 * manque des dates de naissance, sur combien d'agents la moyenne porte.
 */
function contexteDesAges(d: DashboardView): string | undefined {
  if (d.agesKnown === 0) return undefined;
  if (d.agesKnown < d.activeEmployees) {
    const s = d.agesKnown > 1 ? 's' : '';
    return `${d.agesKnown} âge${s} connu${s} sur ${d.activeEmployees}`;
  }
  if (d.youngestAge === d.oldestAge) return undefined;
  return `de ${d.youngestAge} à ${d.oldestAge} ans`;
}

/** « an » jusqu'à deux, « ans » ensuite : 1,5 an, 2 ans. */
const ans = (n: number) => (n < 2 ? 'an' : 'ans');

/** Une durée en mois révolus, comme on la dit : « 8 mois », « 7 ans ». */
function duree(mois: number): string {
  if (mois < 1) return "moins d'un mois";
  if (mois < 12) return `${mois} mois`;
  const a = Math.floor(mois / 12);
  return `${a} ${ans(a)}`;
}

/** L'ancienneté moyenne, en années ; en mois sous un an. */
function AncienneteMoyenne({ d }: { d: DashboardView }) {
  const v = d.averageSeniority;
  if (v === null) {
    return <span className="text-[15px] font-semibold text-ink-muted">Aucune</span>;
  }
  const [nombre, unite] =
    v < 1
      ? [String(Math.max(1, Math.round(v * 12))), 'mois']
      : [v.toLocaleString('fr-FR', { maximumFractionDigits: 1 }), ans(v)];
  return (
    <>
      {nombre}
      <span className="ml-1 text-[15px] font-semibold tracking-normal text-ink-muted">{unite}</span>
    </>
  );
}

/** Sous l'ancienneté moyenne : de la plus courte à la plus longue. */
function contexteDesAnciennetes(d: DashboardView): string | undefined {
  const courte = d.shortestSeniorityMonths;
  const longue = d.longestSeniorityMonths;
  if (courte === null || longue === null || duree(courte) === duree(longue)) return undefined;
  if (courte >= 12) return `de ${Math.floor(courte / 12)} à ${duree(longue)}`;
  if (longue < 12) return `de ${courte} à ${longue} mois`;
  return `de ${duree(courte)} à ${duree(longue)}`;
}

/** Le total d'une carte, à droite de son titre : « 3 agents ». */
function TotalCarte({ children }: { children: React.ReactNode }) {
  return (
    <span className="shrink-0 text-[11.5px] text-ink-muted" style={TABULAIRE}>
      {children}
    </span>
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
  /** L'étiquette d'une tuile étroite : un téléphone, ou quatre tuiles à côté du menu. */
  short: string;
  /** Un nombre le plus souvent, une date pour le prochain férié. */
  value: React.ReactNode;
  context?: string;
  /** Absent : la page derrière n'est pas ouverte à qui regarde. */
  href?: string;
}) {
  const corps = (
    /* L'étiquette passe AVANT le chiffre : on lit « ce que c'est » puis
       « combien », l'ordre dans lequel la question se pose. L'icône tient
       dans une pastille bleue, à droite — la même pour les quatre tuiles :
       une pastille orange sur l'une d'elles la faisait lire comme une alerte
       permanente, alors qu'elle ne fait qu'ouvrir un écran. La flèche
       n'apparaît qu'au survol : la tuile est une porte, on ne le voit qu'en
       s'approchant. */
    <CardInteractive className="@container relative h-full px-4 pt-3.5 pb-4">
      <div className="flex items-center justify-between gap-3">
        {/* L'étiquette courte dès que la TUILE est étroite, pas l'écran : à
            1024 px, quatre tuiles et le menu ne laissent pas la place. */}
        <p className="truncate text-[10px] font-bold tracking-[0.1em] text-ink-muted uppercase">
          <span className="@[10rem]:hidden">{short}</span>
          <span className="hidden @[10rem]:inline">{label}</span>
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
      {/* `title` parce que la ligne est TRONQUÉE sur grand écran : sans lui,
            ce qui dépasse de la carte est simplement perdu. */}
      {context ? (
        <p title={context} className="mt-2 text-[11.5px] text-ink-muted sm:truncate sm:pr-5">
          {context}
        </p>
      ) : null}
      {href ? (
        <Icon
          name="arrow_forward"
          size={16}
          className="absolute right-3.5 bottom-3.5 hidden -translate-x-1 text-primary opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100 sm:block"
        />
      ) : null}
    </CardInteractive>
  );
  return href ? (
    <Link
      href={href}
      className="group block rounded-[14px] focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
    >
      {corps}
    </Link>
  ) : (
    <div className="h-full">{corps}</div>
  );
}

/* ———— Barres d'effectifs (une teinte, étiquettes en encre de texte) ———— */

function DirectionBar({
  onOpen,
  label,
  title,
  value,
  max,
  total,
}: {
  /** Ouvre la fiche de la direction ; absent, rien à ouvrir. */
  onOpen?: () => void;
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
    <li title={`${title} · ${compte(value, 'agent')} · ${part} %`}>
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className={cn(
            forme,
            'w-[calc(100%+1rem)] text-left transition-colors duration-150 hover:bg-hover focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none',
          )}
        >
          {contenu}
        </button>
      ) : (
        <span className={forme}>{contenu}</span>
      )}
    </li>
  );
}

/**
 * La fiche d'une direction, ouverte depuis sa barre : qui la dirige, combien
 * elle compte, leur âge moyen, sa parité. Agents actifs de la direction et
 * des unités en dessous, comme la barre.
 */
function FicheDirection({
  direction: x,
  total,
  versLePersonnel,
  onClose,
}: {
  direction: DashboardDirectionHeadcount;
  total: number;
  /** La liste du personnel filtrée sur elle ; absente, elle n'est pas ouverte à qui regarde. */
  versLePersonnel: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const part = total > 0 ? Math.round((x.headcount / total) * 100) : 0;
  return (
    <Modal
      open
      onClose={onClose}
      title={x.name}
      subtitle={x.shortName ?? undefined}
      maxWidth="max-w-lg"
      footer={
        <div className="flex w-full justify-end gap-2">
          {versLePersonnel && x.headcount > 0 ? (
            <Button variant="secondary" onClick={() => router.push(versLePersonnel)}>
              Voir les agents
            </Button>
          ) : null}
          <Button onClick={onClose}>Fermer</Button>
        </div>
      }
    >
      <DataGrid>
        <DataBlock label="Responsable" full>
          {x.responsable ?? <span className="text-ink-muted">Non désigné</span>}
        </DataBlock>
        <DataBlock label="Effectif">
          {compte(x.headcount, 'agent')}
          <span className="font-medium text-ink-muted"> · {part} %</span>
        </DataBlock>
        <DataBlock label="Moyenne d'âge">
          {x.averageAge === null ? (
            <span className="text-ink-muted">Non renseignée</span>
          ) : (
            <>
              {x.averageAge.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} ans
              {x.agesKnown < x.headcount ? (
                <span className="block text-[11.5px] font-medium text-ink-muted">
                  {x.agesKnown} âge{x.agesKnown > 1 ? 's' : ''} connu{x.agesKnown > 1 ? 's' : ''}{' '}
                  sur {x.headcount}
                </span>
              ) : null}
            </>
          )}
        </DataBlock>
      </DataGrid>
      <Parite femmes={x.women} hommes={x.men} />
    </Modal>
  );
}

/* ———— La frise des fériés ———— */

/**
 * Le calendrier des fériés : le dernier passé, puis les trois qui viennent.
 *
 * Les dates sont à intervalles ÉGAUX : l'espacement dit l'ordre, la mention
 * « dans 49 j » dit la distance. Rien n'est écrit au-dessus des pastilles —
 * le prochain férié se reconnaît à son aplat bleu et à son double anneau, et
 * le passé à son gris ; un intitulé par-dessus ne faisait que répéter ce que
 * la couleur montrait déjà.
 */
function Frise({ jours }: { jours: DashboardHoliday[] }) {
  const passes = jours.filter((h) => ecartJours(h.day) < 0).length;
  // Le rail court d'un centre de date à l'autre, jamais d'un bord à l'autre de
  // la carte : un trait qui dépasse ne mène à rien.
  const garde = `${50 / jours.length}%`;
  return (
    <div className="relative">
      <span
        aria-hidden
        className="absolute top-[33px] h-[2px] rounded-full bg-line-soft"
        style={{ left: garde, right: garde }}
      />
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
    <li className="relative flex min-w-0 flex-1 flex-col items-center px-1 pt-2 text-center sm:px-3">
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
            prochain ? 'text-primary-ink/75' : 'text-ink-muted',
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
            {compte(x.n, x.mot)}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function DashboardPage() {
  const me = useMe();
  const canManage = peut(me.data, 'personnel.consulter');
  const seesContracts = peut(me.data, 'pilotage') || canManage;
  // Une tuile n'ouvre que la page que qui regarde peut ouvrir.
  const voitLesConges = peut(me.data, 'demandes.conges') || me.data?.role === 'admin';

  // La direction dont la fiche est ouverte.
  const [direction, setDirection] = useState<DashboardDirectionHeadcount | null>(null);

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
  const contrats = usePagination(d?.contractFollowUp ?? []);

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
    <Page>
      {/* ———— Indicateurs ———— */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatTile
          icon="group"
          label="Effectif actif"
          short="Effectif"
          value={d?.activeEmployees}
          context={d ? repartition(d) : undefined}
          href={canManage ? '/employees' : undefined}
        />
        <StatTile
          icon="cake"
          label="Moyenne d'âge"
          short="Âge moyen"
          value={d ? <AgeMoyen d={d} /> : undefined}
          context={d ? contexteDesAges(d) : undefined}
          href={canManage ? '/employees' : undefined}
        />
        <StatTile
          icon="work_history"
          label="Ancienneté moy."
          short="Ancienneté"
          value={d ? <AncienneteMoyenne d={d} /> : undefined}
          context={d ? contexteDesAnciennetes(d) : undefined}
          href={canManage ? '/employees' : undefined}
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
          href={peut(me.data, 'feries') ? '/absences/feries' : undefined}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* ———— Colonne principale : le calendrier s'étire à la hauteur de
            la colonne de contexte, sans vide dessous. ———— */}
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-2">
          <Card className="flex flex-1 flex-col">
            <CardHeader>
              <CardTitle>Calendrier des absences</CardTitle>
            </CardHeader>
            {upcoming.isLoading ? (
              <SqueletteTableau lignes={3} />
            ) : absences.length === 0 ? (
              <EmptyState
                className="flex-1 py-7"
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
                            <Badge tone="teal">En cours</Badge>
                          ) : (
                            // Bleu, comme sur l'écran des demandes : les deux
                            // tableaux montrent le même état, ils ne peuvent pas
                            // le dire de deux couleurs.
                            <Badge tone="bleu">À venir</Badge>
                          )}
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
                {absencesEnPlus > 0 ? (
                  <CardContent className="border-t border-line-soft py-3">
                    {voitLesConges ? (
                      <Link
                        href="/moi/dch"
                        className="text-xs font-semibold text-primary hover:underline"
                      >
                        {compte(absencesEnPlus, 'autre')} sous 30 jours
                      </Link>
                    ) : (
                      <p className="text-xs text-ink-muted">
                        {compte(absencesEnPlus, 'autre')} sous 30 jours
                      </p>
                    )}
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
                        onOpen={() => setDirection(x)}
                        label={x.shortName ?? x.name}
                        title={x.name}
                        value={x.headcount}
                        max={maxHeadcount}
                        total={d!.activeEmployees}
                      />
                    ))}
                    {unassigned > 0 ? (
                      <DirectionBar
                        label="Aucune"
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
          {direction && d ? (
            <FicheDirection
              direction={direction}
              total={d.activeEmployees}
              // La liste du personnel, filtrée sur la direction : elle
              // compte les mêmes agents que la barre.
              versLePersonnel={
                canManage
                  ? `/employees?unite=${encodeURIComponent(direction.shortName ?? direction.name)}`
                  : null
              }
              onClose={() => setDirection(null)}
            />
          ) : null}
        </div>
      </div>

      {/* ———— Les fériés, en frise ———— */}
      <Card>
        <CardHeader>
          <CardTitle>Calendrier des jours fériés</CardTitle>
        </CardHeader>
        <CardContent className="pt-1 pb-6">
          {stats.isLoading ? (
            <Skeleton className="h-28 w-full" />
          ) : fenetreFeries.length === 0 ? (
            <p className="py-3 text-sm text-ink-muted">
              Aucun férié enregistré. La liste se gère dans « Gestion des jours fériés ».
            </p>
          ) : (
            <Frise jours={fenetreFeries} />
          )}
        </CardContent>
      </Card>

      {seesContracts ? (
        <Card>
          <CardHeader className="flex items-center justify-between gap-3">
            <CardTitle>Suivi des contrats</CardTitle>
            <TotalCarte>CDD et stages en cours</TotalCarte>
          </CardHeader>
          {stats.isLoading ? (
            <SqueletteTableau lignes={3} />
          ) : (d?.contractFollowUp ?? []).length === 0 ? (
            <EmptyState
              className="py-7"
              icon={<Icon name="description" size={22} />}
              title="Aucun contrat à durée limitée"
              description={
                <>
                  Aucun CDD ou stage en cours.
                  {/* Le lien ne s'offre qu'à qui ouvre la liste du personnel. */}
                  {peut(me.data, 'personnel.consulter') ? (
                    <>
                      {' '}
                      Vous pouvez consulter la liste du personnel inactif{' '}
                      <Link
                        href="/employees?onglet=inactifs"
                        className="font-semibold text-primary underline-offset-2 hover:underline"
                      >
                        ici
                      </Link>
                      .
                    </>
                  ) : null}
                </>
              }
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
                  {contrats.tranche.map((c) => {
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
                          {c.positionTitle}
                        </Td>
                        <Td className="uppercase">{c.contractType}</Td>
                        <Td className="whitespace-nowrap">
                          {c.endDate ? formatDate(c.endDate) : null}
                        </Td>
                        <Td className="text-right">
                          <Badge tone={deadline.tone}>{deadline.text}</Badge>
                        </Td>
                      </Tr>
                    );
                  })}
                </TBody>
              </Table>
              <Pagination {...contrats.barre} className="py-4" />
            </>
          )}
        </Card>
      ) : null}
    </Page>
  );
}
