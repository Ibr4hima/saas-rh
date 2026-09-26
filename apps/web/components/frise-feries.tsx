'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { Holiday } from '@teranga/contracts';
import { Badge, cn, Skeleton } from '@teranga/ui';
import { api } from '../lib/api';
import { Icon } from './icons';
import { distance, ecartJours } from '../lib/feries';

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

function majuscule(texte: string): string {
  return texte.charAt(0).toUpperCase() + texte.slice(1);
}

export function FriseFeries() {
  const anneeCourante = new Date().getFullYear();
  // On ne feuillette qu'une année en avant. Au-delà, le calendrier n'est pas
  // connu : les dates civiles se reportent d'elles-mêmes, mais aucune fête
  // mobile n'est datée, et une frise de six cartes sur quatorze donnerait une
  // année fausse plutôt qu'une année vide.
  const [annee, setAnnee] = useState(anneeCourante);
  const suivante = annee === anneeCourante;

  const feries = useQuery({
    queryKey: ['holidays', annee],
    queryFn: () => api<Holiday[]>(`/holidays?year=${annee}`),
  });

  const entete = (
    <EnTete
      affichee={annee}
      cible={suivante ? anneeCourante + 1 : anneeCourante}
      sens={suivante ? 'suivante' : 'precedente'}
      onAller={() => setAnnee(suivante ? anneeCourante + 1 : anneeCourante)}
    />
  );

  if (feries.isLoading) {
    return (
      <section>
        {entete}
        <Skeleton className="mt-5 h-[520px] w-full rounded-[16px]" />
      </section>
    );
  }

  const tous = feries.data ?? [];
  // L'année se lit dans son sens : janvier en haut, décembre en bas. Le
  // prochain férié tombe sur la CHARNIÈRE — la première carte nette après
  // celles qui ont reculé — et c'est là que l'œil s'arrête en descendant.
  const dates = tous
    .filter((h): h is Holiday & { day: string } => Boolean(h.day))
    .sort((a, b) => a.day.localeCompare(b.day));
  // Une fête mobile pas encore datée ne peut pas se poser sur un rail
  // chronologique : elle attend en bas, nommée, plutôt que d'être tue.
  const aDater = tous.filter((h) => !h.day);

  // Le bandeau « prochain » n'a de sens que sur l'année en cours : sur celle
  // d'après, la première date n'est pas le prochain férié — celui-ci tombe
  // encore dans l'année qu'on vient de quitter.
  const indexProchain =
    annee === anneeCourante ? dates.findIndex((h) => ecartJours(h.day) >= 0) : -1;

  if (dates.length === 0 && aDater.length === 0) {
    return (
      <section>
        {entete}
        <p className="mt-5 rounded-[16px] border border-dashed border-line bg-surface-raised px-5 py-8 text-center text-[12.5px] text-ink-muted">
          Aucun jour férié n&apos;est encore posé pour {annee}.
        </p>
      </section>
    );
  }

  return (
    <section>
      {entete}

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
              etat={i === indexProchain ? 'prochain' : ecartJours(h.day) >= 0 ? 'avenir' : 'passe'}
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

/**
 * Le titre, et la porte vers l'autre année.
 *
 * Le décompte qui vivait ici — « 11 dates · 2 à venir » — ne servait personne :
 * la frise les montre toutes, et ce qui vient se lit sur les cartes. La place
 * revient au seul geste que l'écran peut offrir, feuilleter d'une année.
 */
function EnTete({
  affichee,
  cible,
  sens,
  onAller,
}: {
  /** L'année que la frise montre. */
  affichee: number;
  /** L'année vers laquelle le bouton emmène — l'autre. */
  cible: number;
  sens: 'suivante' | 'precedente';
  onAller: () => void;
}) {
  const enAvant = sens === 'suivante';
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <h2
        className="text-[10.5px] font-extrabold tracking-[0.14em] text-primary uppercase"
        style={TABULAIRE}
      >
        Jours fériés {affichee}
      </h2>
      <button
        type="button"
        onClick={onAller}
        aria-label={`Voir les jours fériés de ${cible}`}
        className={cn(
          // Le chevron avance d'un cheveu au survol : le bouton dit alors dans
          // quel sens il emmène, sans qu'on ait à lire son intitulé.
          'group inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface py-[6px] text-[12.5px] font-bold text-ink shadow-xs transition-colors duration-150 hover:border-primary/40 hover:bg-primary/[0.04] hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary/40',
          enAvant ? 'pr-2.5 pl-4' : 'pr-4 pl-2.5',
        )}
        style={TABULAIRE}
      >
        {enAvant ? null : (
          <Icon
            name="chevron_left"
            size={16}
            className="shrink-0 text-ink-muted transition-transform duration-150 group-hover:-translate-x-0.5 group-hover:text-primary"
          />
        )}
        {cible}
        {enAvant ? (
          <Icon
            name="chevron_right"
            size={16}
            className="shrink-0 text-ink-muted transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-primary"
          />
        ) : null}
      </button>
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
                {ferie.fixed ? 'Date fixe' : 'Date variable'}
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
