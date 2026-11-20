'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Skeleton } from '@teranga/ui';
import { ACCUEIL_DE_LA_CAMPAGNE, useAccueilDeLaCampagne } from '../../lib/campagne';
import { useMe } from '../../lib/hooks';
import { BrandMark } from '../brand-mark';
import { MenuCompte } from '../menu-compte';

/* ────────────────────────────────────────────────────────────────
   La coque de la campagne d'évaluation annuelle (ADR-0211).

   Ni menu ni espace : la plateforme ne montre que l'évaluation. En haut,
   une barre avec le logo, « Évaluation annuelle 2026 » et le compte de la
   personne (son nom, le thème, la sortie). Dessous, la page, plafonnée à la
   largeur des pages de la plateforme, la barre alignée sur elle.
   ──────────────────────────────────────────────────────────────── */

export function CoqueDeLaCampagne({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const me = useMe();
  const accueil = useAccueilDeLaCampagne();

  // Sans session, la connexion ramène ici.
  useEffect(() => {
    if (me.isError) {
      const suite = `${window.location.pathname}${window.location.search}`;
      router.replace(`/login?suite=${encodeURIComponent(suite)}`);
    }
  }, [me.isError, router]);

  const annee = accueil.data?.annee ?? me.data?.campagne ?? null;

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="sticky top-0 z-30 border-b border-line-soft bg-surface">
        <div className="mx-auto flex h-16 w-full max-w-page items-center gap-3 px-4 sm:px-6">
          <Link
            href={ACCUEIL_DE_LA_CAMPAGNE}
            className="flex min-w-0 items-center gap-3 rounded-controle focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
          >
            <BrandMark variant="barre" />
            <span aria-hidden className="h-7 w-px shrink-0 bg-line" />
            <span className="truncate text-[11px] font-bold tracking-[0.16em] text-primary uppercase">
              Évaluation annuelle{annee ? ` ${annee}` : ''}
            </span>
          </Link>
          {me.data ? (
            <div className="ml-auto flex shrink-0 items-center gap-2.5">
              <span className="hidden max-w-56 truncate text-[12.5px] font-semibold text-ink-strong sm:block">
                {me.data.givenName} {me.data.familyName}
              </span>
              <MenuCompte variante="entete" certificats={false} notifications={false} />
            </div>
          ) : null}
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-page flex-1 flex-col px-4 py-6 sm:px-6 sm:py-8">
        {me.data ? children : <Skeleton className="h-64 w-full rounded-bloc" />}
      </main>
    </div>
  );
}
