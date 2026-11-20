'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { peut } from '@teranga/contracts';
import { Skeleton } from '@teranga/ui';
import { ACCUEIL_DE_LA_CAMPAGNE } from '../lib/campagne';
import { useMe } from '../lib/hooks';

export default function HomePage() {
  const router = useRouter();
  const me = useMe();

  useEffect(() => {
    // En campagne (ADR-0211), tout le monde arrive sur l'évaluation annuelle,
    // l'administration comprise, qui y trouve ses pages (ADR-0222). Sinon, qui
    // pilote arrive sur le tableau de bord ; un agent, sur son espace.
    if (me.data) {
      router.replace(
        me.data.campagne
          ? ACCUEIL_DE_LA_CAMPAGNE
          : peut(me.data, 'pilotage')
            ? '/dashboard'
            : '/moi',
      );
    } else if (me.isError) router.replace('/login');
  }, [me.data, me.isError, router]);

  return (
    <main className="mx-auto max-w-md px-6 py-24">
      <Skeleton className="mb-4 h-8 w-48" />
      <Skeleton className="h-4 w-full" />
    </main>
  );
}
