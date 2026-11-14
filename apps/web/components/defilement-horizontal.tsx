'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@teranga/ui';
import { Icon } from './icons';

/* ————————————————————————————————————————————————————————————————
   Une rangée plus large que l'écran, qui le dit.

   Coupée net au bord, une rangée d'onglets ressemble à une rangée finie : on
   ne devine pas qu'une famille se cache à droite. Un fondu la montre qui
   continue, et une flèche la fait avancer — à la souris, faire défiler de
   côté n'a rien d'évident. Ni fondu ni flèche quand tout tient.
   ———————————————————————————————————————————————————————————————— */

export function DefilementHorizontal({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const rangee = useRef<HTMLDivElement>(null);
  const [bords, setBords] = useState({ gauche: false, droite: false });

  const mesurer = useCallback(() => {
    const r = rangee.current;
    if (!r) return;
    setBords({
      gauche: r.scrollLeft > 2,
      droite: r.scrollLeft + r.clientWidth < r.scrollWidth - 2,
    });
  }, []);

  useEffect(() => {
    const r = rangee.current;
    if (!r) return;
    mesurer();
    const observateur = new ResizeObserver(mesurer);
    observateur.observe(r);
    if (r.firstElementChild) observateur.observe(r.firstElementChild);
    return () => observateur.disconnect();
  }, [mesurer]);

  const avancer = (sens: 1 | -1) =>
    rangee.current?.scrollBy({ left: sens * rangee.current.clientWidth * 0.6, behavior: 'smooth' });

  const masque = `linear-gradient(to right, ${bords.gauche ? 'transparent 0, #000 48px' : '#000 0'}, ${bords.droite ? '#000 calc(100% - 48px), transparent 100%' : '#000 100%'})`;

  return (
    <div className={cn('relative max-w-full min-w-0', className)}>
      <div
        ref={rangee}
        onScroll={mesurer}
        className="-my-1 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ maskImage: masque, WebkitMaskImage: masque }}
      >
        {children}
      </div>
      {bords.gauche ? <Fleche sens={-1} onClick={() => avancer(-1)} /> : null}
      {bords.droite ? <Fleche sens={1} onClick={() => avancer(1)} /> : null}
    </div>
  );
}

function Fleche({ sens, onClick }: { sens: 1 | -1; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      // Les onglets restent atteignables au clavier par Tab : la flèche ne
      // sert qu'au pointeur, elle ne s'ajoute pas au parcours.
      tabIndex={-1}
      aria-hidden
      className={cn(
        'absolute top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full border border-card-line bg-surface text-ink-muted shadow-sm transition-colors hover:text-ink',
        sens === 1 ? 'right-0' : 'left-0',
      )}
    >
      <Icon name={sens === 1 ? 'chevron_right' : 'chevron_left'} size={18} />
    </button>
  );
}
