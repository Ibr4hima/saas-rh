'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { titreDuSemestre, type Semestre } from '@teranga/contracts';
import { Card, cn } from '@teranga/ui';
import { Icon } from './icons';

/* ————————————————————————————————————————————————————————————————
   Les fiches d'objectifs, rangées dans le temps : une année, un filet, puis
   ses semestres — le plus récent d'abord. Les pièces communes à la fiche
   d'un direct (le n+1 rédige) et à « Mes objectifs » (l'agent lit).
   ———————————————————————————————————————————————————————————————— */

interface Periode {
  annee: number;
  semestre: Semestre;
}

export const cleDe = (p: Periode) => `${p.annee}-${p.semestre}`;

/**
 * Les fiches, par année — la plus récente d'abord, et dans l'année le 2nd
 * semestre avant le 1er. `toujours` : une année qui a sa place même sans
 * fiche (l'année en cours, où le n+1 fixe les objectifs).
 */
export function parAnnee<T extends Periode>(
  fiches: T[],
  toujours?: number,
): { annee: number; fiches: T[] }[] {
  const annees = new Set(fiches.map((f) => f.annee));
  if (toujours !== undefined) annees.add(toujours);
  return [...annees]
    .sort((a, b) => b - a)
    .map((annee) => ({
      annee,
      fiches: fiches.filter((f) => f.annee === annee).sort((a, b) => b.semestre - a.semestre),
    }));
}

/** « ANNÉE 2026 ——————— » et, au bout du filet, le geste de l'année s'il y en a un. */
export function SeparateurAnnee({
  annee,
  children,
  choix,
}: {
  annee: number;
  children?: ReactNode;
  /** Les années où aller : le titre se déroule. */
  choix?: { annees: number[]; enAttente?: number[]; onChoisir: (annee: number) => void };
}) {
  return (
    <div className="flex min-h-[30px] items-center gap-4">
      {choix ? (
        <ChoixAnnee annee={annee} {...choix} />
      ) : (
        <h2 className="shrink-0 text-[11px] font-extrabold tracking-[0.14em] text-primary uppercase">
          Année {annee}
        </h2>
      )}
      <span aria-hidden className="h-px min-w-6 flex-1 bg-line" />
      {children}
    </div>
  );
}

/**
 * « ANNÉE 2026 », qui se déroule : l'année suivante, l'année en cours, puis
 * les années passées qui ont des fiches. Une pastille orange marque celles où
 * une évaluation attend.
 */
function ChoixAnnee({
  annee,
  annees,
  enAttente = [],
  onChoisir,
}: {
  annee: number;
  annees: number[];
  enAttente?: number[];
  onChoisir: (annee: number) => void;
}) {
  const { ouvert, setOuvert, racine, menu } = useDeroulant();

  // Le texte reste où était le titre : le fond du bouton déborde à gauche.
  return (
    <div ref={racine} className="relative -ml-3 shrink-0 max-sm:-ml-2">
      <h2>
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={ouvert}
          onClick={() => setOuvert((v) => !v)}
          className={cn(
            'flex h-[30px] items-center gap-0.5 rounded-full pr-1.5 pl-3 text-[11px] max-sm:pl-2 font-extrabold tracking-[0.14em] text-primary uppercase transition-colors duration-150 outline-none hover:bg-primary-soft focus-visible:ring-2 focus-visible:ring-primary/35',
            ouvert && 'bg-primary-soft',
          )}
        >
          Année {annee}
          <Icon
            name="chevron_right"
            size={16}
            className={cn('transition-transform duration-150', ouvert ? '-rotate-90' : 'rotate-90')}
          />
        </button>
      </h2>
      {ouvert ? (
        <div
          ref={menu}
          role="menu"
          aria-label="Année"
          className="tg-menu absolute top-full left-0 z-30 mt-1.5 min-w-36 rounded-[14px] border border-card-line bg-surface p-1.5 shadow-lg"
        >
          {annees.map((a) => (
            <button
              key={a}
              type="button"
              role="menuitemradio"
              aria-checked={a === annee}
              onClick={() => {
                setOuvert(false);
                if (a !== annee) onChoisir(a);
              }}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-left text-[12.5px] font-semibold tabular-nums transition-colors duration-150 outline-none hover:bg-hover focus-visible:bg-hover',
                a === annee
                  ? 'text-primary'
                  : 'text-ink hover:text-ink-strong focus-visible:text-ink-strong',
              )}
            >
              <span className="flex-1">{a}</span>
              {enAttente.includes(a) ? (
                <>
                  <span aria-hidden className="size-1.5 rounded-full bg-accent" />
                  <span className="sr-only">évaluation en attente</span>
                </>
              ) : null}
              {a === annee ? <Icon name="check" size={16} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Un menu déroulant. Ouvert, il prend le focus, sur l'entrée cochée s'il y en
 * a une ; les flèches passent d'une entrée à l'autre ; Échap et un clic
 * ailleurs le referment.
 */
function useDeroulant() {
  const [ouvert, setOuvert] = useState(false);
  const racine = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ouvert) return;
    const entrees = () => [...(menu.current?.querySelectorAll('button') ?? [])];
    (entrees().find((b) => b.getAttribute('aria-checked') === 'true') ?? entrees()[0])?.focus();
    const auClic = (e: PointerEvent) => {
      if (!racine.current?.contains(e.target as Node)) setOuvert(false);
    };
    const auClavier = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOuvert(false);
        racine.current?.querySelector('button')?.focus();
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const liste = entrees();
      const i = liste.indexOf(document.activeElement as HTMLButtonElement);
      const pas = e.key === 'ArrowDown' ? 1 : -1;
      liste[(i + pas + liste.length) % liste.length]?.focus();
    };
    document.addEventListener('pointerdown', auClic);
    document.addEventListener('keydown', auClavier);
    return () => {
      document.removeEventListener('pointerdown', auClic);
      document.removeEventListener('keydown', auClavier);
    };
  }, [ouvert]);

  return { ouvert, setOuvert, racine, menu };
}

/**
 * Une fiche de semestre : sa carte, et son titre sur une pastille bleue posée
 * à cheval sur le bord haut, au centre — comme la légende d'un encadré, en
 * petites capitales, la voix de l'année. Le titre appartient à SA carte :
 * entre deux fiches, on ne se demande plus à laquelle il se rapporte.
 * `note` : qui l'a rédigée, et quand.
 */
export function FicheSemestre({
  annee,
  semestre,
  note,
  id,
  children,
  titre,
  action,
  enEdition = false,
}: Periode & {
  note?: ReactNode;
  id?: string;
  children: ReactNode;
  /** À la place de « Objectifs du 1er semestre de 2026 » — l'évaluation, par exemple. */
  titre?: string;
  /** Un bouton rond sur le bord haut, à droite, à la hauteur du titre. */
  action?: ReactNode;
  /** La fiche s'écrit : son filet passe à la marque. */
  enEdition?: boolean;
}) {
  // Trois rangées : le titre occupe les deux premières, qui se partagent sa
  // hauteur ; le fond de la carte part de la deuxième. Le bord haut passe donc
  // toujours au milieu du titre — sur une ligne comme sur deux (petit écran).
  // Avec un bouton, deux marges égales encadrent le titre : il reste au centre.
  return (
    <div id={id} className="grid scroll-mt-24">
      <Card
        aria-hidden
        className={cn(
          'col-start-1 row-span-2 row-start-2 transition-colors duration-150',
          enEdition && 'border-primary/45',
        )}
      />
      <div
        className={cn(
          'relative z-10 col-start-1 row-span-2 row-start-1 px-2',
          action
            ? 'grid grid-cols-[minmax(3rem,1fr)_auto_minmax(3rem,1fr)] items-center'
            : 'flex justify-center',
        )}
      >
        <h3
          className={cn(
            'rounded-full bg-primary py-[7px] pr-[14.5px] pl-4 text-center text-[11px] leading-4 font-extrabold tracking-[0.14em] text-balance text-primary-ink uppercase shadow-[0_4px_12px_-4px_rgb(0_79_145/0.5)] max-sm:pr-[11px] max-sm:pl-3 max-sm:text-[10px] max-sm:tracking-[0.08em] sm:whitespace-nowrap',
            action && 'col-start-2',
          )}
        >
          {titre ?? titreDuSemestre(semestre, annee)}
        </h3>
        {action ? <div className="col-start-3 flex justify-end pr-3">{action}</div> : null}
      </div>
      <div className="relative col-start-1 row-start-3 mx-px mb-px min-w-0">
        {note ? <p className="px-5 pt-3 text-center text-[11px] text-ink-muted">{note}</p> : null}
        {children}
      </div>
    </div>
  );
}
