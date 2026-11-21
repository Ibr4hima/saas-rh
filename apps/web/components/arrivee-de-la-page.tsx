'use client';

import { usePathname } from 'next/navigation';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@teranga/ui';

/*
   La page qui arrive se montre d'un bloc (ADR-0170). En production, ses
   données arrivent en 50 à 100 ms : juste assez pour que le squelette de
   chargement s'affiche, puis cède la place à une page d'une autre forme, plus
   haute ou plus basse. L'œil le lit comme un saut. La page qui arrive reste
   donc invisible tant qu'elle montre un squelette, 300 ms au plus, puis paraît
   d'un fondu bref, dans sa forme finale. Une page dont les données sont déjà
   là paraît aussitôt, avant d'être peinte. Au-delà de 300 ms, le squelette
   se montre : il dit qu'on attend.
*/

const ATTENTE_MAX = 300;

/** Un squelette de chargement (`Skeleton`, `animate-pulse`) dans la page. */
const enChargement = (el: HTMLElement) => el.querySelector('.animate-pulse') !== null;

export function ArriveeDeLaPage({ children }: { children: ReactNode }) {
  const chemin = usePathname();
  const boite = useRef<HTMLDivElement>(null);
  // Le chemin dont la page est montrée. Au premier affichage, tout de suite.
  const [montre, setMontre] = useState(chemin);
  const attend = montre !== chemin;

  useLayoutEffect(() => {
    if (!attend) return;
    const el = boite.current;
    const montrer = () => setMontre(chemin);
    if (!el || !enChargement(el)) {
      montrer();
      return;
    }
    const guet = new MutationObserver(() => {
      if (!enChargement(el)) montrer();
    });
    guet.observe(el, { childList: true, subtree: true });
    const delai = window.setTimeout(montrer, ATTENTE_MAX);
    return () => {
      guet.disconnect();
      window.clearTimeout(delai);
    };
  }, [attend, chemin]);

  return (
    <div
      ref={boite}
      className={cn(
        'flex min-h-full flex-col',
        attend
          ? 'opacity-0'
          : 'opacity-100 transition-opacity duration-150 ease-out motion-reduce:transition-none',
      )}
    >
      {children}
    </div>
  );
}
