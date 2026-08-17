'use client';

import { useQueries, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { AbsenceRequestView, Holiday } from '@teranga/contracts';
import { Badge, Button, Card, Skeleton } from '@teranga/ui';
import { api } from '../../../lib/api';

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

export default function CalendarPage() {
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

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-ink-strong">Calendrier</h1>
          <p className="text-sm text-ink-muted">
            Absences approuvées et en attente, jours fériés inclus.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate(-1)}
            aria-label="Mois précédent"
          >
            ←
          </Button>
          <span className="w-40 text-center text-sm font-semibold text-ink-strong capitalize">
            {monthLabel}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate(1)}
            aria-label="Mois suivant"
          >
            →
          </Button>
        </div>
      </div>

      <div className="mb-3 flex items-center gap-4 text-xs text-ink-muted">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-primary" /> Approuvée
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-warning" /> En attente
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-success" /> Jour férié
        </span>
      </div>

      {loading ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <Card className="overflow-hidden">
          <div className="grid grid-cols-7 border-b border-line">
            {WEEKDAYS.map((d) => (
              <div
                key={d}
                className="px-2 py-2 text-center text-xs font-semibold tracking-wide text-ink-muted uppercase"
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
                    className={
                      'min-h-24 border-r border-line-soft p-1.5 align-top last:border-r-0 ' +
                      (!inMonth
                        ? 'bg-bg opacity-40 '
                        : weekend || holiday
                          ? 'bg-bg '
                          : 'bg-surface ')
                    }
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <span
                        className={
                          isToday
                            ? 'flex size-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-ink'
                            : 'px-1 text-xs font-medium text-ink-muted'
                        }
                        style={{ fontVariantNumeric: 'tabular-nums' }}
                      >
                        {Number(day.slice(8, 10))}
                      </span>
                    </div>
                    {holiday && inMonth ? (
                      <Badge tone="success" className="mb-1 block truncate text-[10px]">
                        {holiday}
                      </Badge>
                    ) : null}
                    <div className="flex flex-col gap-0.5">
                      {dayAbsences.slice(0, 3).map((a) => (
                        <span
                          key={a.id}
                          title={`${a.employeeName} — ${a.absenceTypeName} (${a.status === 'pending' ? 'en attente' : 'approuvée'})`}
                          className={
                            'truncate rounded px-1.5 py-0.5 text-[11px] font-medium ' +
                            (a.status === 'pending'
                              ? 'bg-warning-soft text-warning'
                              : 'bg-primary-soft text-primary')
                          }
                        >
                          {a.employeeName.split(' ')[0]} · {a.absenceTypeName}
                        </span>
                      ))}
                      {dayAbsences.length > 3 ? (
                        <span className="px-1 text-[10px] text-ink-muted">
                          +{dayAbsences.length - 3} autre(s)
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
