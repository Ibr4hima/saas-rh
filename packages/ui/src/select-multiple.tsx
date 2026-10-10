'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from './cn';
import { Chevron, positionSous, type Position } from './select';

/**
 * Liste de choix multiples, pour filtrer.
 *
 * La sœur de `Select` : même bouton, même liste flottante, même clavier. La
 * différence tient au geste. Cocher une ligne ne referme pas la liste, on en
 * coche une autre dans la foulée. La première ligne, « Toutes… », vide la
 * sélection et referme : c'est le retour à la liste entière.
 *
 * Aucun `<select multiple>` caché ici, contrairement à `Select` : ce filtre
 * vit dans un état React, jamais dans un formulaire.
 */
export function SelectMultiple({
  valeurs,
  options,
  onChange,
  tout,
  resume,
  className,
  disabled,
  'aria-label': ariaLabel,
}: {
  valeurs: string[];
  options: { value: string; label: string }[];
  onChange: (valeurs: string[]) => void;
  /** La première ligne, et le bouton quand rien n'est coché : « Toutes les unités ». */
  tout: string;
  /** Le bouton à partir de trois choix : « 3 unités ». */
  resume: (n: number) => string;
  className?: string;
  disabled?: boolean;
  'aria-label'?: string;
}) {
  const declencheur = React.useRef<HTMLButtonElement>(null);
  const liste = React.useRef<HTMLDivElement>(null);
  const listeId = `${React.useId()}-liste`;
  const [ouvert, setOuvert] = React.useState(false);
  // 0 est la ligne « Toutes… », les options suivent à partir de 1.
  const [actif, setActif] = React.useState(0);
  const [position, setPosition] = React.useState<Position | null>(null);

  const inactif = disabled || options.length === 0;
  // Dans l'ordre de la liste, pas dans l'ordre des clics.
  const choisis = options.filter((o) => valeurs.includes(o.value));
  const libelle =
    choisis.length === 0
      ? tout
      : choisis.length <= 2
        ? choisis.map((o) => o.label).join(', ')
        : resume(choisis.length);

  const placer = React.useCallback(() => {
    const b = declencheur.current?.getBoundingClientRect();
    if (b) setPosition(positionSous(b));
  }, []);

  const ouvrir = () => {
    if (inactif) return;
    setActif(0);
    placer();
    setOuvert(true);
  };

  const fermer = React.useCallback(() => {
    setOuvert(false);
    declencheur.current?.focus();
  }, []);

  const basculer = (rang: number) => {
    if (rang === 0) {
      onChange([]);
      fermer();
      return;
    }
    const o = options[rang - 1];
    if (!o) return;
    onChange(
      valeurs.includes(o.value) ? valeurs.filter((v) => v !== o.value) : [...valeurs, o.value],
    );
  };

  // Le bouton change de largeur avec son libellé : la liste le suit.
  React.useLayoutEffect(() => {
    if (!ouvert) return;
    placer();
    const suivre = () => placer();
    window.addEventListener('scroll', suivre, true);
    window.addEventListener('resize', suivre);
    return () => {
      window.removeEventListener('scroll', suivre, true);
      window.removeEventListener('resize', suivre);
    };
  }, [ouvert, placer, libelle]);

  React.useEffect(() => {
    if (!ouvert) return;
    const dehors = (e: MouseEvent) => {
      const cible = e.target as Node;
      if (liste.current?.contains(cible) || declencheur.current?.contains(cible)) return;
      setOuvert(false);
    };
    document.addEventListener('mousedown', dehors);
    return () => document.removeEventListener('mousedown', dehors);
  }, [ouvert]);

  React.useEffect(() => {
    if (!ouvert) return;
    liste.current?.querySelector<HTMLElement>(`[data-rang="${actif}"]`)?.scrollIntoView({
      block: 'nearest',
    });
  }, [actif, ouvert]);

  const auClavier = (e: React.KeyboardEvent) => {
    if (inactif) return;
    const n = options.length + 1;
    if (e.key === 'Escape') {
      if (!ouvert) return;
      e.preventDefault();
      // Même règle que `Select` : Échap ne ferme que la couche du dessus.
      e.nativeEvent.stopImmediatePropagation();
      fermer();
      return;
    }
    if (e.key === 'Tab') {
      setOuvert(false);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!ouvert) return ouvrir();
      const pas = e.key === 'ArrowDown' ? 1 : -1;
      setActif((i) => (i + pas + n) % n);
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      if (!ouvert) return;
      e.preventDefault();
      setActif(e.key === 'Home' ? 0 : n - 1);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (ouvert) basculer(actif);
      else ouvrir();
    }
  };

  const lignes = [
    { rang: 0, label: tout, coche: choisis.length === 0 },
    ...options.map((o, i) => ({ rang: i + 1, label: o.label, coche: valeurs.includes(o.value) })),
  ];

  return (
    <div className="relative">
      <button
        type="button"
        ref={declencheur}
        disabled={inactif}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={ouvert}
        aria-controls={ouvert ? listeId : undefined}
        aria-activedescendant={ouvert ? `${listeId}-${actif}` : undefined}
        aria-label={ariaLabel ?? tout}
        onClick={() => (ouvert ? setOuvert(false) : ouvrir())}
        onKeyDown={auClavier}
        className={cn(
          'flex h-10 w-full items-center gap-2 rounded-full border border-line bg-surface px-4 text-left text-sm',
          'transition-colors duration-150 ease-out',
          'hover:border-primary/40 focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary/40',
          'disabled:cursor-not-allowed disabled:opacity-50',
          choisis.length > 0 ? 'border-primary/45 text-primary' : 'text-ink-muted',
          ouvert && 'border-primary',
          className,
        )}
      >
        <span className="min-w-0 flex-1 truncate">{libelle}</span>
        <Chevron ouvert={ouvert} />
      </button>

      {ouvert && position
        ? createPortal(
            <div
              ref={liste}
              id={listeId}
              role="listbox"
              aria-multiselectable
              aria-label={ariaLabel ?? tout}
              className="tg-menu fixed z-[70] overflow-y-auto overscroll-contain rounded-[16px] border border-line bg-surface p-1.5 shadow-lg"
              style={{
                left: position.left,
                minWidth: position.width,
                width: 'max-content',
                maxWidth: position.maxWidth,
                top: position.top,
                bottom: position.bottom,
                maxHeight: position.maxHeight,
              }}
            >
              {lignes.map((l) => (
                <React.Fragment key={l.rang}>
                  <div
                    id={`${listeId}-${l.rang}`}
                    data-rang={l.rang}
                    role="option"
                    aria-selected={l.coche}
                    onMouseEnter={() => setActif(l.rang)}
                    // Le focus reste sur le bouton, comme dans `Select`.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => basculer(l.rang)}
                    className={cn(
                      'flex cursor-pointer items-center gap-2.5 rounded-[11px] px-3 py-[7px] text-[13px] leading-snug',
                      l.rang === actif && 'bg-hover',
                      l.coche ? 'font-semibold text-ink-strong' : 'text-ink',
                    )}
                  >
                    <Case coche={l.coche} />
                    <span className="min-w-0 flex-1 truncate">{l.label}</span>
                  </div>
                  {l.rang === 0 ? <div aria-hidden className="mx-2 my-1 h-px bg-line" /> : null}
                </React.Fragment>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

/** La case d'une ligne : le dessin de `Checkbox`, sans l'`input`, la ligne entière se clique. */
function Case({ coche }: { coche: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'relative inline-flex size-[15px] shrink-0 items-center justify-center rounded-[4px] border transition-colors duration-150',
        coche ? 'border-primary bg-primary' : 'border-line bg-surface',
      )}
    >
      <svg
        viewBox="0 0 12 12"
        fill="none"
        className={cn('size-3 text-primary-ink', coche ? 'opacity-100' : 'opacity-0')}
      >
        <path
          d="M2.5 6.2 4.8 8.5 9.5 3.8"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
