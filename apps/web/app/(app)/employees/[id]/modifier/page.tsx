'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Skeleton } from '@teranga/ui';

/**
 * La modification s'ouvre désormais EN FENÊTRE sur la fiche
 * (/employees/<id>?modifier). Cette route reste pour les liens et signets déjà
 * en circulation : elle mène au même endroit.
 */
export default function EditEmployeeRedirect() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  useEffect(() => {
    router.replace(`/employees/${id}?modifier=1`);
  }, [id, router]);
  return (
    <div className="mx-auto max-w-4xl">
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
