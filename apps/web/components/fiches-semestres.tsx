'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Semestre } from '@teranga/contracts';
import { Button, cn } from '@teranga/ui';
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

/** Les repères du temps parlent d'une seule voix : « ANNÉE 2026 », « OBJECTIFS DU 1ER SEMESTRE DE 2026 » — en capitales bleues. */
const REPERE = 'font-extrabold text-primary uppercase';

/** « ANNÉE 2026 ——————— » et, au bout du filet, le geste de l'année s'il y en a un. */
export function SeparateurAnnee({ annee, children }: { annee: number; children?: ReactNode }) {
  return (
    <div className="flex min-h-[30px] items-center gap-4">
      <h2 className={cn('shrink-0 text-[11px] tracking-[0.14em]', REPERE)}>Année {annee}</h2>
      <span aria-hidden className="h-px min-w-6 flex-1 bg-line" />
      {children}
    </div>
  );
}

/**
 * Le titre d'une fiche, centré au-dessus d'elle, dans la voix de l'année et
 * bien plus grand qu'elle (18 px, la taille d'un titre) — c'est lui qu'on lit :
 * « OBJECTIFS DU 1ER SEMESTRE DE 2026 ». `note` : qui l'a rédigée, et quand.
 */
export function TitreFiche({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1 px-4 text-center">
      <h3
        className={cn(
          'text-[16px] leading-snug tracking-[0.06em] text-balance sm:text-[18px]',
          REPERE,
          // À 18 px, l'extra-gras des petites capitales devient massif.
          'font-bold',
        )}
      >
        {children}
      </h3>
      {note ? <p className="text-[11px] text-ink-muted">{note}</p> : null}
    </div>
  );
}

/**
 * « Fixer des objectifs » : deux semestres au choix. Une coche marque ceux
 * qui ont déjà leur fiche — les choisir y ramène, sans en créer une seconde.
 */
export function ChoixSemestre({
  fixes,
  onChoisir,
}: {
  /** Les semestres de l'année qui ont déjà une fiche. */
  fixes: Semestre[];
  onChoisir: (semestre: Semestre) => void;
}) {
  const [ouvert, setOuvert] = useState(false);
  const racine = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  // Ouvert, le menu prend le focus ; les flèches passent d'un semestre à
  // l'autre ; Échap et un clic ailleurs le referment.
  useEffect(() => {
    if (!ouvert) return;
    const entrees = () => [...(menu.current?.querySelectorAll('button') ?? [])];
    entrees()[0]?.focus();
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

  return (
    <div ref={racine} className="relative shrink-0">
      <Button
        variant="secondary"
        size="sm"
        aria-haspopup="menu"
        aria-expanded={ouvert}
        onClick={() => setOuvert((v) => !v)}
        className={cn(ouvert && 'border-primary/40 bg-hover')}
      >
        <Icon name="flag" size={15} />
        Fixer des objectifs
        <Icon
          name="chevron_right"
          size={16}
          className={cn(
            '-mr-1 text-ink-muted transition-transform duration-150',
            ouvert ? '-rotate-90' : 'rotate-90',
          )}
        />
      </Button>
      {ouvert ? (
        <div
          ref={menu}
          role="menu"
          aria-label="Semestre"
          className="tg-menu absolute top-full right-0 z-30 mt-1.5 w-full min-w-40 rounded-[14px] border border-card-line bg-surface p-1.5 shadow-lg"
        >
          {([1, 2] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="menuitem"
              onClick={() => {
                setOuvert(false);
                onChoisir(s);
              }}
              className="flex w-full items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-left text-[12.5px] font-medium text-ink transition-colors duration-150 outline-none hover:bg-hover hover:text-ink-strong focus-visible:bg-hover focus-visible:text-ink-strong"
            >
              <span className="flex-1">Semestre {s}</span>
              {fixes.includes(s) ? (
                <>
                  <Icon name="check" size={16} className="text-primary" />
                  <span className="sr-only">déjà fixés</span>
                </>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
