'use client';

import { useQuery } from '@tanstack/react-query';
import type { Holiday } from '@teranga/contracts';
import { Badge, cn, Skeleton } from '@teranga/ui';
import { api } from '../lib/api';
import { Icon } from './icons';

/* ————————————————————————————————————————————————————————————————
   Les jours fériés de l'année, en frise.

   La grille du mois répond à « suis-je libre le 12 ? ». Elle ne répond pas à
   « quand tombe le prochain férié, et qu'est-ce qui reste avant la fin de
   l'année ? » — pour le savoir il fallait feuilleter douze mois. La frise
   pose les treize dates d'un seul tenant, dans l'ordre, avec ce qui les
   sépare d'aujourd'hui.

   Un rail vertical, des cartes de part et d'autre, une pastille par date. Ce
   qui est passé recule d'un ton, ce qui vient reste net, et le prochain porte
   son bandeau. Le jour de la SEMAINE est écrit à côté de la date, parce que
   c'est lui qui décide si le férié offre un jour de repos ou tombe un samedi.
   ———————————————————————————————————————————————————————————————— */

const TABULAIRE = { fontVariantNumeric: 'tabular-nums' } as const;

type Etat = 'passe' | 'prochain' | 'avenir';

/** Écart en jours entre une date ISO et aujourd'hui, au calendrier local. */
function ecartJours(iso: string): number {
  return Math.round(
    (new Date(`${iso}T00:00:00`).getTime() - new Date().setHours(0, 0, 0, 0)) / 86_400_000,
  );
}

function pluriel(n: number, mot: string, suffixe = 's'): string {
  return `${n} ${mot}${n > 1 ? suffixe : ''}`;
}

/**
 * « Dans 6 mois », « Il y a 21 jours », « Demain ».
 *
 * L'unité suit la distance : à onze mois, « dans 337 jours » ne se
 * représente pas — on compte en mois dès qu'on dépasse le mois.
 */
function distance(iso: string): string {
  const j = ecartJours(iso);
  if (j === 0) return "Aujourd'hui";
  if (j === 1) return 'Demain';
  if (j === -1) return 'Hier';
  const n = Math.abs(j);
  const mots = n < 31 ? pluriel(n, 'jour') : pluriel(Math.max(1, Math.round(n / 30.4)), 'mois', '');
  return j < 0 ? `Il y a ${mots}` : `Dans ${mots}`;
}

function majuscule(texte: string): string {
  return texte.charAt(0).toUpperCase() + texte.slice(1);
}

export function FriseFeries() {
  const annee = new Date().getFullYear();
  const feries = useQuery({
    queryKey: ['holidays', annee],
    queryFn: () => api<Holiday[]>(`/holidays?year=${annee}`),
  });

  if (feries.isLoading) {
    return <Skeleton className="h-[520px] w-full rounded-[16px]" />;
  }

  const tous = feries.data ?? [];
  const dates = tous
    .filter((h): h is Holiday & { day: string } => Boolean(h.day))
    .sort((a, b) => a.day.localeCompare(b.day));
  // Une fête mobile pas encore datée ne peut pas se poser sur un rail
  // chronologique : elle attend en bas, nommée, plutôt que d'être tue.
  const aDater = tous.filter((h) => !h.day);

  const indexProchain = dates.findIndex((h) => ecartJours(h.day) >= 0);
  const restants = indexProchain < 0 ? 0 : dates.length - indexProchain;

  if (dates.length === 0 && aDater.length === 0) {
    return (
      <section>
        <EnTete annee={annee} total={0} restants={0} />
        <p className="mt-4 rounded-[16px] border border-dashed border-line bg-surface-raised px-5 py-8 text-center text-[12.5px] text-ink-muted">
          Aucun jour férié n&apos;est encore posé pour {annee}.
        </p>
      </section>
    );
  }

  return (
    <section>
      <EnTete annee={annee} total={dates.length} restants={restants} />

      <div className="relative mt-5">
        {/* Le rail. Il s'efface par le bas plutôt que de s'arrêter net : un
            trait qui se termine par un bord promet une suite qui n'existe pas. */}
        <span
          aria-hidden
          className="absolute top-3 bottom-0 left-[13px] w-px bg-line-soft md:left-1/2 md:-translate-x-1/2"
          style={{ maskImage: 'linear-gradient(to bottom, #000 90%, transparent)' }}
        />

        {/* L'année, posée sur le rail — le liseré à la couleur du fond de page
            découpe le trait au lieu de le laisser traverser la pastille. */}
        <div className="relative flex justify-start md:justify-center">
          <span
            className="rounded-full bg-primary px-4 py-[6px] text-[12.5px] leading-none font-bold text-primary-ink ring-[5px] ring-bg"
            style={TABULAIRE}
          >
            {annee}
          </span>
        </div>

        <ol className="relative mt-5 flex flex-col gap-4 md:gap-5">
          {dates.map((h, i) => (
            <Entree
              key={h.id}
              ferie={h}
              etat={
                indexProchain < 0 || i < indexProchain
                  ? 'passe'
                  : i === indexProchain
                    ? 'prochain'
                    : 'avenir'
              }
              aGauche={i % 2 === 0}
            />
          ))}
        </ol>
      </div>

      {aDater.length > 0 ? (
        <div className="mt-5 flex flex-col gap-2.5 rounded-[16px] border border-dashed border-line bg-surface-raised px-4 py-3.5 sm:flex-row sm:items-center sm:gap-3.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-primary/[0.07] text-primary">
            <Icon name="schedule" size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-semibold text-ink-strong">
              {aDater.length} fête{aDater.length > 1 ? 's' : ''} mobile
              {aDater.length > 1 ? 's' : ''} encore à dater
            </p>
            <p className="mt-0.5 text-[11.5px] leading-snug text-ink-muted">
              {aDater.map((h) => h.label).join(' · ')} — la date se pose à l&apos;annonce, et la
              frise s&apos;y range d&apos;elle-même.
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function EnTete({ annee, total, restants }: { annee: number; total: number; restants: number }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h2 className="text-[10.5px] font-extrabold tracking-[0.14em] text-primary uppercase">
        Jours fériés {annee}
      </h2>
      {total > 0 ? (
        <p className="text-[11.5px] text-ink-muted" style={TABULAIRE}>
          {pluriel(total, 'date')} · {restants > 0 ? `${restants} à venir` : 'toutes passées'}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Une date sur le rail : la pastille, le tiret qui la relie, et la carte.
 *
 * La grille change de forme selon la place. Sur un téléphone, le rail se
 * range à gauche et toutes les cartes tombent à sa droite — alterner sur
 * trois cents pixels ne produirait que des cartes de cent pixels de large.
 */
function Entree({
  ferie,
  etat,
  aGauche,
}: {
  ferie: Holiday & { day: string };
  etat: Etat;
  aGauche: boolean;
}) {
  const prochain = etat === 'prochain';
  const passe = etat === 'passe';
  const d = new Date(`${ferie.day}T00:00:00`);
  const weekend = d.getDay() === 0 || d.getDay() === 6;

  return (
    <li className="grid grid-cols-[26px_minmax(0,1fr)] items-center md:grid-cols-[minmax(0,1fr)_16px_minmax(0,1fr)]">
      {/* La pastille. Son disque extérieur porte la couleur du FOND de page :
          c'est lui qui interrompt le rail, sans qu'on ait à le découper. */}
      <span className="col-start-1 row-start-1 flex justify-center md:col-start-2">
        <span
          className={cn(
            'flex items-center justify-center rounded-full bg-bg',
            prochain ? 'size-[26px]' : 'size-[20px]',
          )}
        >
          <span
            className={cn(
              'rounded-full',
              prochain
                ? 'size-[12px] bg-primary ring-4 ring-primary/15'
                : passe
                  ? 'size-[9px] bg-line'
                  : 'size-[9px] bg-primary/40',
            )}
          />
        </span>
      </span>

      <div
        className={cn(
          'relative col-start-2 row-start-1',
          aGauche ? 'md:col-start-1 md:pr-5' : 'md:col-start-3 md:pl-5',
        )}
      >
        {/* Le tiret de raccord, seulement quand les cartes alternent. */}
        <span
          aria-hidden
          className={cn(
            // Le trait de raccord porte la teinte PLEINE des filets, pas la
            // pâle du rail : sur vingt pixels, un gris de rail ne se voyait
            // plus, et la carte semblait posée à côté du fil sans y tenir.
            'absolute top-1/2 hidden h-px w-5 bg-line md:block',
            aGauche ? 'right-0' : 'left-0',
          )}
        />

        <article
          className={cn(
            'overflow-hidden rounded-[16px] border transition-shadow duration-200',
            prochain
              ? 'border-primary/40 bg-surface shadow-md'
              : passe
                ? 'border-card-line bg-surface-raised shadow-xs'
                : 'border-card-line bg-surface shadow-xs',
          )}
        >
          {prochain ? (
            <p className="flex items-center gap-1.5 bg-primary px-4 py-[6px] text-[9.5px] font-extrabold tracking-[0.12em] text-primary-ink uppercase">
              <span aria-hidden className="size-[5px] rounded-full bg-primary-ink/80" />
              Prochain jour férié
            </p>
          ) : null}

          <div className="px-4 py-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p
                  className={cn(
                    'truncate text-[14.5px] leading-tight font-bold tracking-[-0.01em]',
                    passe ? 'text-ink' : 'text-ink-strong',
                  )}
                >
                  {ferie.label}
                </p>
                <p className="mt-1 text-[11.5px] leading-tight text-ink-muted">
                  {distance(ferie.day)}
                </p>
              </div>
              {/* Une fête mobile se date à l'annonce — le dire évite de croire
                  qu'une date déjà posée ne bougera plus. */}
              <Badge
                tone={ferie.fixed ? 'neutral' : 'primary'}
                className="shrink-0 whitespace-nowrap"
              >
                {ferie.fixed ? 'Date civile' : 'Fête mobile'}
              </Badge>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-x-4 border-t border-line-soft pt-3">
              <Colonne intitule="Date">
                <span style={TABULAIRE}>
                  {d.toLocaleDateString('fr-FR', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </span>
              </Colonne>
              <Colonne intitule="Jour">
                {majuscule(d.toLocaleDateString('fr-FR', { weekday: 'long' }))}
                {/* Un férié qui tombe un samedi n'offre pas de jour de repos :
                    c'est la première chose qu'on veut savoir en le lisant. */}
                {weekend ? <span className="font-medium text-ink-muted"> · week-end</span> : null}
              </Colonne>
            </div>
          </div>
        </article>
      </div>
    </li>
  );
}

function Colonne({ intitule, children }: { intitule: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] font-extrabold tracking-[0.1em] text-ink-muted uppercase">
        {intitule}
      </p>
      <p className="mt-1 text-[12.5px] leading-snug font-bold text-ink-strong">{children}</p>
    </div>
  );
}
