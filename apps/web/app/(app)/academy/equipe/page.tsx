'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type { TeamView } from '@teranga/contracts';
import { Button, Card, EmptyState, Skeleton } from '@teranga/ui';
import { RetourAcademy } from '../../../../components/academy-carte';
import { EnteteColonnes, LigneAgent } from '../../../../components/academy-equipe';
import { Page } from '../../../../components/gabarit';
import { Icon } from '../../../../components/icons';
import { LoadFailure } from '../../../../components/load-failure';
import { api } from '../../../../lib/api';
import { compte } from '../../../../lib/mots';

/* ————————————————————————————————————————————————————————————————
   « Mon équipe » : où en sont, dans l'Academy, ceux qui vous rendent compte.

   Vos DIRECTS, et eux seuls : chacun répond de sa propre équipe à son n+1.
   L'équipe est celle de l'organigramme — le champ n+1 des fiches agents.
   ———————————————————————————————————————————————————————————————— */

export default function MonEquipePage() {
  const equipe = useQuery({
    queryKey: ['academy', 'equipe'],
    queryFn: () => api<TeamView>('/academy/equipe'),
  });
  const membres = equipe.data?.members ?? [];

  return (
    <Page>
      <RetourAcademy href="/academy" label="APIX Academy" />
      <div className="flex items-baseline gap-3">
        <h2 className="text-[10.5px] font-extrabold tracking-[0.14em] text-primary uppercase">
          Mon équipe
        </h2>
        {membres.length > 0 ? (
          <span className="text-[12px] font-semibold text-ink-muted">
            {compte(membres.length, 'agent')}
          </span>
        ) : null}
      </div>

      {equipe.isPending ? (
        <Skeleton className="h-[220px] w-full rounded-[16px]" />
      ) : equipe.isError ? (
        <LoadFailure error={equipe.error} onRetry={() => void equipe.refetch()} />
      ) : membres.length === 0 ? (
        <Card className="flex flex-1 items-center justify-center">
          <EmptyState
            icon={<Icon name="groups" size={22} />}
            title="Personne ne vous rend compte"
            description="Votre équipe se lit dans l’organigramme : les agents dont vous êtes le n+1 apparaîtront ici."
            action={
              <Link href="/academy">
                <Button variant="secondary">Retour au catalogue</Button>
              </Link>
            }
          />
        </Card>
      ) : (
        <Card className="shrink-0 px-2 pt-3 pb-1">
          <EnteteColonnes />
          <ul className="flex flex-col">
            {membres.map((m) => (
              <LigneAgent key={m.employeeId} membre={m} />
            ))}
          </ul>
        </Card>
      )}
    </Page>
  );
}
