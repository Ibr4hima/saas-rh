'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Skeleton } from '@teranga/ui';

/**
 * La création s'ouvre désormais EN FENÊTRE sur la liste (/employees?nouveau).
 * Cette route reste pour les liens et signets déjà en circulation : elle mène
 * au même endroit, la liste avec la fenêtre ouverte.
 */
export default function NewEmployeeRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/employees?nouveau=1');
  }, [router]);
  return (
    <div className="mx-auto w-full max-w-6xl">
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
