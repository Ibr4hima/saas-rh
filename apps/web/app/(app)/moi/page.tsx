'use client';

import { useQuery } from '@tanstack/react-query';
import type { MyEmployeeView } from '@teranga/contracts';
import { Skeleton } from '@teranga/ui';
import { api } from '../../../lib/api';
import { FicheEmploye } from '../../../components/fiche-employe';
import { LoadFailure } from '../../../components/load-failure';
import { Page } from '../../../components/gabarit';

/**
 * Mes infos personnelles — l'accueil de l'espace personnel : la fiche de
 * l'agent, telle que la Direction du Capital Humain la consulte, avec
 * « Signaler un changement » à la place du stylo.
 */
export default function MesInfosPersonnellesPage() {
  const moi = useQuery({
    queryKey: ['me-employee'],
    queryFn: () => api<MyEmployeeView>('/me/employee'),
    retry: false,
  });

  if (moi.isLoading) {
    return (
      <Page>
        <Skeleton className="h-40 w-full rounded-[16px]" />
        <Skeleton className="h-72 w-full rounded-[16px]" />
      </Page>
    );
  }
  if (!moi.data) return <LoadFailure error={moi.error} onRetry={() => void moi.refetch()} />;
  return <FicheEmploye id={moi.data.employeeId} soi />;
}
