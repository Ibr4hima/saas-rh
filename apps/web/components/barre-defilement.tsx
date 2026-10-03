'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { cn } from '@teranga/ui';

/**
 * Une barre de défilement dessinée, pour un panneau dont la barre native est
 * masquée.
 *
 * La barre du système se place au bord du panneau, avec sa largeur et ses
 * couleurs. Celle-ci se pose où l'on veut (sur la couture entre deux volets,
 * par exemple) et suit la charte : une capsule fine qui s'élargit au survol.
 *
 * Le défilement lui-même reste natif : molette, pavé tactile, clavier et
 * doigt passent par le panneau. La barre ne fait que le montrer, et se laisse
 * saisir ou cliquer pour sauter plus loin.
 */
export function BarreDefilement({
  cible,
  className,
}: {
  cible: RefObject<HTMLElement | null>;
  className?: string;
}) {
  const piste = useRef<HTMLDivElement>(null);
  const prise = useRef<{ y: number; depart: number } | null>(null);
  const [curseur, setCurseur] = useState<{ haut: number; taille: number } | null>(null);
  const [enMouvement, setEnMouvement] = useState(false);
  const [saisi, setSaisi] = useState(false);

  const mesurer = useCallback(() => {
    const el = cible.current;
    const p = piste.current;
    if (!el || !p) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    // Rien à faire défiler : pas de barre du tout.
    if (scrollHeight <= clientHeight + 1) {
      setCurseur(null);
      return;
    }
    const h = p.clientHeight;
    const taille = Math.max(48, (clientHeight / scrollHeight) * h);
    const haut = (scrollTop / (scrollHeight - clientHeight)) * (h - taille);
    setCurseur({ haut, taille });
  }, [cible]);

  useEffect(() => {
    const el = cible.current;
    if (!el) return;
    mesurer();
    let minuteur: number | undefined;
    const surDefilement = () => {
      mesurer();
      setEnMouvement(true);
      window.clearTimeout(minuteur);
      minuteur = window.setTimeout(() => setEnMouvement(false), 700);
    };
    el.addEventListener('scroll', surDefilement, { passive: true });
    // Le contenu change de hauteur (une image qui arrive, un bloc qui
    // s'ouvre) sans que le panneau défile : on observe les deux.
    const observateur = new ResizeObserver(mesurer);
    observateur.observe(el);
    for (const enfant of Array.from(el.children)) observateur.observe(enfant);
    return () => {
      el.removeEventListener('scroll', surDefilement);
      observateur.disconnect();
      window.clearTimeout(minuteur);
    };
  }, [cible, mesurer]);

  /** Le rapport entre un pixel de piste et un pixel de contenu. */
  const rapport = () => {
    const el = cible.current;
    const p = piste.current;
    if (!el || !p || !curseur) return 0;
    return (el.scrollHeight - el.clientHeight) / (p.clientHeight - curseur.taille);
  };

  const saisir = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = cible.current;
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    prise.current = { y: e.clientY, depart: el.scrollTop };
    setSaisi(true);
  };

  const glisser = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = cible.current;
    if (!prise.current || !el) return;
    el.scrollTop = prise.current.depart + (e.clientY - prise.current.y) * rapport();
  };

  const lacher = () => {
    prise.current = null;
    setSaisi(false);
  };

  /** Un clic sur la piste : le curseur vient se centrer sous le pointeur. */
  const sauter = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = cible.current;
    const p = piste.current;
    if (!el || !p || !curseur) return;
    const y = e.clientY - p.getBoundingClientRect().top - curseur.taille / 2;
    el.scrollTo({ top: y * rapport(), behavior: 'smooth' });
  };

  return (
    <div
      ref={piste}
      aria-hidden
      onPointerDown={sauter}
      className={cn('group', curseur ? null : 'pointer-events-none', className)}
    >
      {curseur ? (
        <div
          onPointerDown={saisir}
          onPointerMove={glisser}
          onPointerUp={lacher}
          onPointerCancel={lacher}
          className="absolute inset-x-0 flex cursor-grab touch-none justify-center active:cursor-grabbing"
          style={{ top: curseur.haut, height: curseur.taille }}
        >
          <span
            className={cn(
              'h-full rounded-full ring-[3px] ring-surface transition-[width,background-color] duration-200 ease-out',
              saisi
                ? 'w-2 bg-primary'
                : enMouvement
                  ? 'w-1.5 bg-primary/55 group-hover:w-2 group-hover:bg-primary/70'
                  : 'w-1.5 bg-primary/30 group-hover:w-2 group-hover:bg-primary/60',
            )}
          />
        </div>
      ) : null}
    </div>
  );
}
