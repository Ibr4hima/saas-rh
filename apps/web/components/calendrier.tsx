'use client';

import { useQueries, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { AbsenceRequestView, Holiday } from '@teranga/contracts';
import { Card, CardContent, CardHeader, CardTitle, cn, Skeleton } from '@teranga/ui';
import { api } from '../lib/api';
import { Icon } from './icons';
import { LoadFailure } from './load-failure';

const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Semaines (lundi → dimanche) couvrant le mois affiché. */
function monthGrid(year: number, month: number): string[][] {
  const first = new Date(Date.UTC(year, month, 1));
  const start = new Date(first);
  start.setUTCDate(1 - ((first.getUTCDay() + 6) % 7)); // recule au lundi
  const weeks: string[][] = [];
  const cursor = new Date(start);
  while (cursor.getUTCMonth() === month || weeks.length === 0 || cursor.getUTCDay() !== 1) {
    if (cursor.getUTCDay() === 1) weeks.push([]);
    weeks[weeks.length - 1]!.push(iso(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (weeks.length > 6 && cursor.getUTCDay() === 1) break;
  }
  return weeks.filter((w) => w.some((d) => new Date(`${d}T00:00:00Z`).getUTCMonth() === month));
}

/**
 * Le calendrier des absences, tel quel — utilisé par la page /calendrier ET
 * par la fenêtre qu'ouvre la date du bandeau. Un seul rendu : deux copies
 * auraient divergé au premier ajustement.
 */
export function Calendrier() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0-11

  const absenceQueries = useQueries({
    queries: ['approved', 'pending'].map((status) => ({
      queryKey: ['absence-requests', status],
      queryFn: () => api<AbsenceRequestView[]>(`/absence-requests?status=${status}&limit=100`),
    })),
  });
  const holidays = useQuery({
    queryKey: ['holidays', year],
    queryFn: () => api<Holiday[]>(`/holidays?year=${year}`),
  });

  const loading = absenceQueries.some((q) => q.isLoading) || holidays.isLoading;
  const absences = absenceQueries.flatMap((q) => q.data ?? []);
  const holidayByDay = new Map((holidays.data ?? []).map((h) => [h.day, h.label]));

  const weeks = monthGrid(year, month);
  const todayIso = iso(new Date());
  const monthLabel = new Date(year, month, 1).toLocaleDateString('fr-FR', {
    month: 'long',
    year: 'numeric',
  });

  const navigate = (delta: number) => {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  };

  const absencesOn = (day: string) =>
    absences.filter((a) => a.startDate <= day && day <= a.endDate);

  const failed = absenceQueries.find((q) => q.isError) ?? (holidays.isError ? holidays : null);
  if (failed) {
    return <LoadFailure error={failed.error} onRetry={() => void failed.refetch()} />;
  }

  // Le mois courant : la seule destination qu'on veut toujours pouvoir
  // rejoindre sans compter les clics dans un sens ou dans l'autre.
  const surLeMoisCourant = year === now.getFullYear() && month === now.getMonth();

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <NavMois direction="précédent" onClick={() => navigate(-1)} />
          <span className="w-[9.5rem] text-center text-[13px] font-bold text-ink-strong capitalize">
            {monthLabel}
          </span>
          <NavMois direction="suivant" onClick={() => navigate(1)} />
          {surLeMoisCourant ? null : (
            <button
              type="button"
              onClick={() => {
                setYear(now.getFullYear());
                setMonth(now.getMonth());
              }}
              className="ml-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold text-primary transition-colors hover:bg-primary/[0.07]"
            >
              Aujourd&apos;hui
            </button>
          )}
        </div>
        <Legende />
      </CardHeader>

      <CardContent className="px-0 pb-0">
        {loading ? (
          <Skeleton className="mx-[18px] mb-[18px] h-96" />
        ) : (
          <>
            <div className="grid grid-cols-7 border-y border-line-soft bg-bg">
              {WEEKDAYS.map((d) => (
                <div
                  key={d}
                  className="px-2 py-2 text-center text-[9.5px] font-extrabold tracking-[0.12em] text-ink-muted uppercase"
                >
                  {d}
                </div>
              ))}
            </div>
            {weeks.map((week, wi) => (
              <div key={wi} className="grid grid-cols-7 border-b border-line-soft last:border-b-0">
                {week.map((day) => {
                  const inMonth = new Date(`${day}T00:00:00Z`).getUTCMonth() === month;
                  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
                  const weekend = dow === 0 || dow === 6;
                  const holiday = holidayByDay.get(day);
                  const dayAbsences = inMonth ? absencesOn(day) : [];
                  const isToday = day === todayIso;
                  return (
                    <div
                      key={day}
                      className={cn(
                        'min-h-[6.5rem] border-r border-line-soft p-1.5 align-top last:border-r-0',
                        !inMonth
                          ? 'bg-bg opacity-40'
                          : holiday
                            ? 'bg-success-soft/50'
                            : weekend
                              ? 'bg-line-soft/45'
                              : 'bg-surface',
                      )}
                    >
                      <span
                        className={cn(
                          'mb-1 flex h-[22px] w-[22px] items-center justify-center rounded-full text-[11.5px]',
                          isToday
                            ? 'bg-primary font-bold text-primary-ink'
                            : 'font-semibold text-ink-muted',
                        )}
                        style={{ fontVariantNumeric: 'tabular-nums' }}
                      >
                        {Number(day.slice(8, 10))}
                      </span>
                      {holiday && inMonth ? (
                        <p
                          title={holiday}
                          className="mb-1 flex items-center gap-1 truncate rounded-md bg-success-soft px-1.5 py-0.5 text-[10.5px] font-bold text-success"
                        >
                          <Icon name="flag" size={11} className="shrink-0" />
                          <span className="truncate">{holiday}</span>
                        </p>
                      ) : null}
                      <div className="flex flex-col gap-0.5">
                        {dayAbsences.slice(0, 3).map((a) => (
                          <span
                            key={a.id}
                            title={`${a.employeeName} — ${a.absenceTypeName} (${a.status === 'pending' ? 'en attente' : 'approuvée'})`}
                            className={cn(
                              'truncate rounded-md border-l-2 px-1.5 py-0.5 text-[10.5px] font-semibold',
                              a.status === 'pending'
                                ? 'border-warning bg-warning-soft text-warning'
                                : 'border-primary bg-primary-soft text-primary',
                            )}
                          >
                            {a.employeeName.split(' ')[0]} · {a.absenceTypeName}
                          </span>
                        ))}
                        {dayAbsences.length > 3 ? (
                          <span className="px-1 text-[10px] font-semibold text-ink-muted">
                            +{dayAbsences.length - 3} autre(s)
                          </span>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Flèche de navigation entre les mois — même cible tactile des deux côtés. */
function NavMois({
  direction,
  onClick,
}: {
  direction: 'précédent' | 'suivant';
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Mois ${direction}`}
      className="flex size-7 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-primary/[0.07] hover:text-primary"
    >
      <Icon name={direction === 'précédent' ? 'chevron_left' : 'chevron_right'} size={18} />
    </button>
  );
}

/**
 * Légende des pastilles. Elle vit DANS l'en-tête de la carte : posée au-dessus
 * comme avant, elle flottait sans appartenir à rien.
 */
function Legende() {
  const entrees = [
    { classe: 'bg-primary', texte: 'Approuvée' },
    { classe: 'bg-warning', texte: 'En attente' },
    { classe: 'bg-success', texte: 'Jour férié' },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
      {entrees.map((e) => (
        <span
          key={e.texte}
          className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-muted"
        >
          <span className={cn('size-2 rounded-full', e.classe)} />
          {e.texte}
        </span>
      ))}
    </div>
  );
}
