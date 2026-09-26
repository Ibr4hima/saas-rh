'use client';

import Link from 'next/link';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@teranga/ui';

/* ————————————————————————————————————————————————————————————————
   La colonne de navigation, repliée en rail d'icônes.

   Repliée, elle rend à la page les deux cents pixels qu'elle occupe — un
   tableau large, une vidéo, un organigramme y gagnent. Les icônes restent
   exactement à leur place : on ne réapprend rien, on perd seulement les
   mots. Ils reviennent au survol, dans une bulle ; une rubrique ouvre ses
   sous-pages dans un petit menu flottant.

   Le choix se garde d'une visite à l'autre, dans ce navigateur : c'est une
   façon de regarder, pas une donnée.
   ———————————————————————————————————————————————————————————————— */

const CLE = 'teranga-menu-replie';

export function useMenuReplie(): [boolean, () => void] {
  const [replie, setReplie] = useState(() => {
    try {
      return localStorage.getItem(CLE) === '1';
    } catch {
      return false;
    }
  });
  const basculer = useCallback(() => {
    setReplie((avant) => {
      const suivant = !avant;
      try {
        localStorage.setItem(CLE, suivant ? '1' : '0');
      } catch {
        // Stockage refusé : le choix tient pour la session.
      }
      return suivant;
    });
  }, []);
  return [replie, basculer];
}

/** Ce qui s'affiche au survol d'une icône du rail. */
export interface Bulle {
  texte: string;
  x: number;
  y: number;
}

/** Les gestionnaires qui font paraître la bulle — au pointeur comme au clavier. */
export function survolAvecBulle(texte: string, onBulle: (b: Bulle | null) => void) {
  const montrer = (e: React.SyntheticEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onBulle({ texte, x: r.right + 10, y: r.top + r.height / 2 });
  };
  const cacher = () => onBulle(null);
  return { onMouseEnter: montrer, onFocus: montrer, onMouseLeave: cacher, onBlur: cacher };
}

/** La bulle, posée à droite de l'icône — hors de la colonne, qui la rognerait. */
export function InfoBulle({ bulle }: { bulle: Bulle | null }) {
  if (!bulle || typeof document === 'undefined') return null;
  return createPortal(
    <div
      role="tooltip"
      className="pointer-events-none fixed z-[70] -translate-y-1/2 rounded-[8px] bg-ink-strong px-2.5 py-1.5 text-[11.5px] font-semibold whitespace-nowrap text-surface shadow-md"
      style={{ left: bulle.x, top: bulle.y }}
    >
      {bulle.texte}
    </div>,
    document.body,
  );
}

export interface LienFlottant {
  href: string;
  label: string;
  actif: boolean;
  desactive?: boolean;
}

/**
 * Les sous-pages d'une rubrique, quand la colonne est repliée : un menu
 * posé à droite de l'icône, qui se referme au choix d'une page, à Échap, ou
 * au clic ailleurs.
 */
export function SousMenuFlottant({
  ancre,
  titre,
  liens,
  onFermer,
}: {
  ancre: React.RefObject<HTMLElement | null>;
  titre: string;
  liens: LienFlottant[];
  onFermer: () => void;
}) {
  const panneau = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Avant peinture : sans cela le menu apparaîtrait un instant en haut à gauche.
  useLayoutEffect(() => {
    const r = ancre.current?.getBoundingClientRect();
    if (!r) return;
    const hauteur = panneau.current?.offsetHeight ?? 0;
    setPos({
      left: r.right + 10,
      top: Math.max(12, Math.min(r.top - 6, window.innerHeight - hauteur - 12)),
    });
  }, [ancre]);

  useEffect(() => {
    const auClic = (e: PointerEvent) => {
      const cible = e.target as Node;
      if (ancre.current?.contains(cible) || panneau.current?.contains(cible)) return;
      onFermer();
    };
    const auClavier = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      onFermer();
      ancre.current?.focus();
    };
    document.addEventListener('pointerdown', auClic);
    document.addEventListener('keydown', auClavier);
    return () => {
      document.removeEventListener('pointerdown', auClic);
      document.removeEventListener('keydown', auClavier);
    };
  }, [ancre, onFermer]);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={panneau}
      role="menu"
      aria-label={titre}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? 0 }}
      className="tg-menu fixed z-[60] min-w-[13rem] rounded-[14px] border border-card-line bg-surface p-1.5 shadow-lg"
    >
      <p className="px-2.5 pt-1.5 pb-1 text-[10px] font-bold tracking-[0.12em] text-ink-muted uppercase">
        {titre}
      </p>
      {liens.map((l) =>
        l.desactive ? (
          <span
            key={l.href}
            aria-disabled
            className="block cursor-not-allowed rounded-[9px] px-2.5 py-2 text-[12.5px] font-medium text-ink-muted/45 select-none"
          >
            {l.label}
          </span>
        ) : (
          <Link
            key={l.href}
            href={l.href}
            role="menuitem"
            aria-current={l.actif ? 'page' : undefined}
            onClick={onFermer}
            className={cn(
              'block rounded-[9px] px-2.5 py-2 text-[12.5px] transition-colors duration-150',
              l.actif
                ? 'bg-primary/[0.07] font-bold text-primary'
                : 'font-medium text-ink hover:bg-hover hover:text-ink-strong',
            )}
          >
            {l.label}
          </Link>
        ),
      )}
    </div>,
    document.body,
  );
}
