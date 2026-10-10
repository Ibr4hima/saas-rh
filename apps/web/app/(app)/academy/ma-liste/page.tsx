'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type { CourseSummary } from '@teranga/contracts';
import { Button, Card, EmptyState, Skeleton } from '@teranga/ui';
import { CarteFormation, RetourAcademy } from '../../../../components/academy-carte';
import { Page } from '../../../../components/gabarit';
import { Icon } from '../../../../components/icons';
import { LoadFailure } from '../../../../components/load-failure';
import { api } from '../../../../lib/api';
import { compte } from '../../../../lib/mots';

/* ————————————————————————————————————————————————————————————————
   « Ma liste » : les formations gardées de côté, d'un signet.

   La dernière gardée en tête — c'est la plus probable à ouvrir. Retirer le
   signet d'une carte la fait quitter la liste sur-le-champ.
   ———————————————————————————————————————————————————————————————— */

export default function MaListePage() {
  const liste = useQuery({
    queryKey: ['academy', 'ma-liste'],
    queryFn: () => api<CourseSummary[]>('/academy/ma-liste'),
  });

  return (
    <Page>
      <RetourAcademy href="/academy" label="APIX Academy" />
      <div className="flex items-baseline gap-3">
        <h2 className="text-[10.5px] font-extrabold tracking-[0.14em] text-primary uppercase">
          Ma liste
        </h2>
        {liste.data && liste.data.length > 0 ? (
          <span className="text-[12px] font-semibold text-ink-muted">
            {compte(liste.data.length, 'formation')}
          </span>
        ) : null}
      </div>

      {liste.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[260px] rounded-[16px]" />
          ))}
        </div>
      ) : liste.isError ? (
        <LoadFailure error={liste.error} onRetry={() => void liste.refetch()} />
      ) : liste.data.length === 0 ? (
        <Card className="flex flex-1 items-center justify-center">
          <EmptyState
            icon={<Icon name="bookmark" size={22} />}
            title="Votre liste est vide"
            description="Touchez le signet d’une formation pour la garder ici, et la retrouver en un clic."
            action={
              <Link href="/academy">
                <Button variant="secondary">Parcourir le catalogue</Button>
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 pb-2 sm:grid-cols-2 lg:grid-cols-3">
          {liste.data.map((f) => (
            <CarteFormation key={f.id} formation={f} />
          ))}
        </div>
      )}
    </Page>
  );
}
