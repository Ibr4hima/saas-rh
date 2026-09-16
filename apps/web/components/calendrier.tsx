'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { Holiday } from '@teranga/contracts';
import { cn, Skeleton } from '@teranga/ui';
import { api } from '../lib/api';
import { Icon } from './icons';
import { LoadFailure } from './load-failure';
import { Modal } from './modal';

/* ————————————————————————————————————————————————————————————————
   Un calendrier, et rien d'autre.

   Il portait les absences de tout le monde. Un congé de maternité couvrait
   trente cases du même libellé, et le mois n'était plus un calendrier mais
   une colonne de répétitions — on ne pouvait plus y lire ce pour quoi on
   l'ouvrait : quel jour on est, et quand tombe le prochain férié.

   Le planning des absences n'a pas disparu ; il vit là où on le cherche, et
   où il se lit par période plutôt que par jour : « Calendrier des absences »
   sur la page des demandes. Ici, on consulte.

   Restent les jours fériés : ils n'appartiennent à personne, ils sont une
   propriété du calendrier lui-même — un calendrier sénégalais qui tairait
   la Tabaski serait un calendrier incomplet, pas un calendrier sobre.
   ———————————————————————————————————————————————————————————————— */

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
 * L'état du calendrier, séparé de son rendu : la fenêtre fait monter ses
 * commandes dans l'en-tête, à côté du titre, et doit donc connaître le mois
 * affiché sans l'enfermer dans la grille.
 */
function useCalendrier() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0-11

  // Une seule requête, et elle sert à quelque chose. Les deux appels aux
  // demandes d'absence partaient à CHAQUE page — la fenêtre est montée dans
  // le bandeau, donc toujours présente — pour alimenter un affichage qui
  // n'existe plus.
  const holidays = useQuery({
    queryKey: ['holidays', year],
    queryFn: () => api<Holiday[]>(`/holidays?year=${year}`),
  });

  const monthLabel = new Date(year, month, 1).toLocaleDateString('fr-FR', {
    month: 'long',
    year: 'numeric',
  });

  const naviguer = (delta: number) => {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  };

  return {
    year,
    month,
    monthLabel,
    naviguer,
    // Le mois courant : la seule destination qu'on veut toujours pouvoir
    // rejoindre sans compter les clics dans un sens ou dans l'autre.
    surLeMoisCourant: year === now.getFullYear() && month === now.getMonth(),
    revenirAujourdhui: () => {
      setYear(now.getFullYear());
      setMonth(now.getMonth());
    },
    weeks: monthGrid(year, month),
    todayIso: iso(now),
    holidayByDay: new Map((holidays.data ?? []).map((h) => [h.day, h.label])),
    loading: holidays.isLoading,
    failed: holidays.isError ? holidays : null,
  };
}

type Cal = ReturnType<typeof useCalendrier>;

/** Navigation entre les mois — même cible tactile des deux côtés. */
function CommandesMois({ cal }: { cal: Cal }) {
  return (
    <div className="flex items-center gap-1">
      <FlecheMois direction="précédent" onClick={() => cal.naviguer(-1)} />
      <span className="w-[9.5rem] text-center text-[13px] font-bold text-ink-strong capitalize">
        {cal.monthLabel}
      </span>
      <FlecheMois direction="suivant" onClick={() => cal.naviguer(1)} />
      {cal.surLeMoisCourant ? null : (
        <button
          type="button"
          onClick={cal.revenirAujourdhui}
          className="ml-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold text-primary transition-colors hover:bg-primary/[0.07]"
        >
          Aujourd&apos;hui
        </button>
      )}
    </div>
  );
}

function FlecheMois({
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
 * La grille du mois.
 *
 * Le mois tient dans une hauteur DONNÉE plutôt que de la réclamer : les
 * rangées se partagent la place. C'est ce qu'exige une fenêtre — un mois de
 * cinq semaines et un mois de six ne doivent pas la faire sauter d'un cran à
 * chaque flèche.
 *
 * Les cases n'ont plus de liste à contenir : le chiffre respire au centre, et
 * le nom du férié se pose dessous. Elles n'ont donc plus rien à faire défiler.
 */
function Grille({ cal }: { cal: Cal }) {
  if (cal.loading) return <Skeleton className="h-full" />;
  return (
    <div className="flex h-full flex-col">
      <div className="grid shrink-0 grid-cols-7 border-y border-line-soft bg-bg">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="px-2 py-2 text-center text-[9.5px] font-extrabold tracking-[0.12em] text-ink-muted uppercase"
          >
            {d}
          </div>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {cal.weeks.map((week, wi) => (
          <div
            key={wi}
            className="grid min-h-0 flex-1 grid-cols-7 border-b border-line-soft last:border-b-0"
          >
            {week.map((day) => {
              const inMonth = new Date(`${day}T00:00:00Z`).getUTCMonth() === cal.month;
              const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
              const weekend = dow === 0 || dow === 6;
              const holiday = inMonth ? cal.holidayByDay.get(day) : undefined;
              const isToday = day === cal.todayIso;
              return (
                <div
                  key={day}
                  className={cn(
                    'flex min-h-0 flex-col items-center justify-center gap-1 overflow-hidden border-r border-line-soft p-1.5 last:border-r-0',
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
                      'flex size-[30px] shrink-0 items-center justify-center rounded-full text-[14px]',
                      isToday
                        ? 'bg-primary font-bold text-primary-ink'
                        : holiday
                          ? 'font-bold text-success'
                          : 'font-semibold text-ink',
                    )}
                    style={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {Number(day.slice(8, 10))}
                  </span>
                  {holiday ? (
                    <p
                      title={holiday}
                      className="max-w-full truncate px-1 text-center text-[10.5px] font-bold text-success"
                    >
                      {holiday}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Le calendrier en fenêtre, depuis la date du bandeau.
 *
 * La navigation monte dans l'en-tête, à côté du titre : gardée dans le corps,
 * elle mangeait une bande de soixante pixels que le mois réclamait. Le pied a
 * disparu avec la légende qu'il portait — trois pastilles pour deux états qui
 * n'existent plus, et un troisième dont le nom est écrit dans la case.
 */
export function CalendrierModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const cal = useCalendrier();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Calendrier"
      maxWidth="max-w-5xl"
      corpsFixe
      enTete={cal.failed ? null : <CommandesMois cal={cal} />}
    >
      {cal.failed ? (
        <LoadFailure error={cal.failed.error} onRetry={() => void cal.failed!.refetch()} />
      ) : (
        // Hauteur DONNÉE, pas réclamée : cinq semaines ou six, la fenêtre garde
        // la même taille. Sans cela elle sautait d'un cran à chaque flèche.
        //
        // Le plafond suit l'écran — en-tête et marges déduits — pour que la
        // fenêtre n'ait JAMAIS à défiler : un calendrier qu'on fait défiler ne
        // montre plus le mois, ce qui est tout son objet.
        // Sur téléphone la fenêtre occupe tout l'écran : le mois y prend la
        // place qui reste, au lieu de tenir dans 448 px et de laisser sept
        // cents pixels de vide sous lui.
        <div className="min-h-0 flex-1 overflow-hidden rounded-[14px] border border-line-soft bg-surface sm:h-[min(28rem,92vh_-_9rem)] sm:flex-none">
          <Grille cal={cal} />
        </div>
      )}
    </Modal>
  );
}
