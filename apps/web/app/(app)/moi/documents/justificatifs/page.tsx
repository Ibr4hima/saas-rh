'use client';

import { useQuery } from '@tanstack/react-query';
import type { MyEmployeeView } from '@teranga/contracts';
import { Skeleton } from '@teranga/ui';
import { api } from '../../../../../lib/api';
import { EmployeeDocumentsCard } from '../../../../../components/employee-documents-card';
import { LoadFailure } from '../../../../../components/load-failure';
import { Page } from '../../../../../components/gabarit';

/* ————————————————————————————————————————————————————————————————
   « Joindre un justificatif » — ce que l'agent FOURNIT à la Direction du
   Capital Humain : les pièces de son dossier (pièce d'identité, diplômes,
   attestations), qu'elle vérifie avant de les y verser. Le justificatif
   d'une absence, lui, se joint à la demande et se lit dans son historique.
   ———————————————————————————————————————————————————————————————— */

export default function JoindreUnJustificatifPage() {
  const myEmployee = useQuery({
    queryKey: ['me-employee'],
    queryFn: () => api<MyEmployeeView>('/me/employee'),
    retry: false,
  });

  if (myEmployee.isLoading) {
    return (
      <Page>
        <Skeleton className="h-48 w-full rounded-[16px]" />
      </Page>
    );
  }
  if (myEmployee.isError || !myEmployee.data) {
    return <LoadFailure error={myEmployee.error} onRetry={() => void myEmployee.refetch()} />;
  }

  return (
    <Page>
      <EmployeeDocumentsCard employeeId={myEmployee.data.employeeId} depot />
    </Page>
  );
}
