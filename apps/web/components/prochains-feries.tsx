'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type { Holiday } from '@teranga/contracts';
import { Card, CardHeader, CardTitle, Skeleton } from '@teranga/ui';
import { api } from '../lib/api';
import { distance, ecartJours } from '../lib/feries';
import { Icon } from './icons';

/* ————————————————————————————————————————————————————————————————
   Les fériés qui viennent, dans l'espace de l'agent.

   Ce n'est pas un ornement pour combler une colonne : c'est la donnée qui
   manquait à l'écran où l'on pose ses congés. Personne ne choisit ses dates
   sans savoir où tombe la Tabaski — et jusqu'ici il fallait quitter la page
   pour le vérifier.

   Quatre dates, pas treize : l'année entière se lit dans la frise, à laquelle
   le pied renvoie. Ici on répond à « qu'est-ce qui vient ? ».
   ———————————————————————————————————————————————————————————————— */

const COMBIEN = 4;

export function ProchainsFeries() {
  const annee = new Date().getFullYear();
  const feries = useQuery({
    queryKey: ['holidays', annee],
    queryFn: () => api<Holiday[]>(`/holidays?year=${annee}`),
  });

  // Les fêtes sans date (une lune à confirmer) n'ont rien à dire d'un délai :
  // elles sont dans la frise, qui les porte en appendice.
  const avenir = (feries.data ?? [])
    .filter((h): h is Holiday & { day: string } => Boolean(h.day) && ecartJours(h.day!) >= 0)
    .sort((a, b) => a.day.localeCompare(b.day))
    .slice(0, COMBIEN);

  if (!feries.isLoading && avenir.length === 0) return null;

  return (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <CardHeader className="shrink-0">
        <CardTitle>Jours fériés à venir</CardTitle>
      </CardHeader>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
        {feries.isLoading ? (
          <div className="flex flex-col gap-2 px-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-3 w-36" />
            ))}
          </div>
        ) : (
          <ul className="flex flex-col">
            {avenir.map((h, i) => (
              <li
                key={h.id}
                className="flex items-center gap-3 rounded-[9px] px-2.5 py-2.5 not-first:border-t not-first:border-line-soft"
              >
                {/* La pastille de date : le jour en gros, le mois en petit —
                    le même cartouche que la frise, pour que les deux écrans
                    se reconnaissent. */}
                <span className="flex size-9 shrink-0 flex-col items-center justify-center rounded-[10px] bg-primary/[0.07] leading-none">
                  <span className="text-[12.5px] font-extrabold text-primary tabular-nums">
                    {Number(h.day.slice(8, 10))}
                  </span>
                  <span className="mt-px text-[7.5px] font-bold tracking-[0.06em] text-primary/70 uppercase">
                    {new Date(`${h.day}T12:00:00`)
                      .toLocaleDateString('fr-FR', { month: 'short' })
                      .replace('.', '')}
                  </span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold text-ink-strong">
                    {h.label}
                  </span>
                  <span className="block truncate text-[11.5px] text-ink-muted">
                    {new Date(`${h.day}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long' })}
                  </span>
                </span>
                <span
                  className={
                    i === 0
                      ? 'shrink-0 text-[11.5px] font-bold text-primary tabular-nums'
                      : 'shrink-0 text-[11.5px] text-ink-muted tabular-nums'
                  }
                >
                  {distance(h.day)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="shrink-0 border-t border-line-soft px-5 py-2.5">
        <Link
          href="/calendrier"
          className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-primary hover:underline"
        >
          Voir l&apos;année entière
          <Icon name="chevron_right" size={14} />
        </Link>
      </div>
    </Card>
  );
}
