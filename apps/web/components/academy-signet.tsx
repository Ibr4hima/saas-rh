'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CourseDetail, CourseSummary } from '@teranga/contracts';
import { cn } from '@teranga/ui';
import { api } from '../lib/api';
import { Icon } from './icons';

/* ————————————————————————————————————————————————————————————————
   Le signet d'une formation : la garder dans « Ma liste ».

   Le geste répond AVANT le serveur — le signet se remplit au clic, la carte
   quitte « Ma liste » au moment où on l'en retire. S'il refuse, la vraie
   liste est relue et le signet reprend son état.
   ———————————————————————————————————————————————————————————————— */

const CATALOGUE = ['academy', 'catalogue'];
const MA_LISTE = ['academy', 'ma-liste'];

export function useSignet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, garder }: { id: string; garder: boolean }) =>
      api<{ bookmarked: boolean }>(`/academy/courses/${id}/signet`, {
        method: garder ? 'PUT' : 'DELETE',
      }),
    onMutate: async ({ id, garder }) => {
      await Promise.all([
        qc.cancelQueries({ queryKey: CATALOGUE }),
        qc.cancelQueries({ queryKey: MA_LISTE }),
      ]);
      const basculer = (f: CourseSummary) => (f.id === id ? { ...f, bookmarked: garder } : f);
      qc.setQueryData<CourseSummary[]>(CATALOGUE, (l) => l?.map(basculer));
      qc.setQueryData<CourseSummary[]>(MA_LISTE, (l) =>
        garder ? l?.map(basculer) : l?.filter((f) => f.id !== id),
      );
      qc.setQueryData<CourseDetail>(['academy', 'course', id], (d) =>
        d ? { ...d, bookmarked: garder } : d,
      );
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: MA_LISTE });
      void qc.invalidateQueries({ queryKey: CATALOGUE });
    },
  });
}

/** Le bouton, posé sur la couverture d'une carte — en verre, comme la pastille de famille. */
export function BoutonSignet({
  formation,
  className,
}: {
  formation: Pick<CourseSummary, 'id' | 'title' | 'bookmarked'>;
  className?: string;
}) {
  const signet = useSignet();
  const garde = formation.bookmarked;
  const libelle = garde ? 'Retirer de ma liste' : 'Ajouter à ma liste';
  return (
    <button
      type="button"
      aria-pressed={garde}
      aria-label={`${libelle} : ${formation.title}`}
      title={libelle}
      onClick={() => signet.mutate({ id: formation.id, garder: !garde })}
      className={cn(
        'grid size-8 place-items-center rounded-full text-white ring-1 backdrop-blur-sm transition-all duration-150 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none active:scale-90',
        garde
          ? 'bg-white/25 ring-white/40 hover:bg-white/30'
          : 'bg-white/10 ring-white/25 hover:bg-white/20 hover:ring-white/40',
        className,
      )}
    >
      <Icon name="bookmark" size={18} fill={garde} />
    </button>
  );
}
