'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { premierDuMois } from '@teranga/contracts';
import { cn, Skeleton } from '@teranga/ui';
import { ACCUEIL_DE_LA_CAMPAGNE, useAccueilDeLaCampagne } from '../../lib/campagne';
import { useMe } from '../../lib/hooks';
import { majuscule } from '../../lib/mots';
import { BrandMark } from '../brand-mark';
import { Icon } from '../icons';
import { MenuCompte } from '../menu-compte';

/* ────────────────────────────────────────────────────────────────
   La coque de la campagne d'évaluation annuelle (ADR-0211, ADR-0212).

   Ni menu ni espace : la plateforme ne montre que l'évaluation. En haut,
   posée sur le fond comme celle de la plateforme, une barre avec le logo,
   « Évaluation annuelle 2026 » en grand, à la taille du salut des accueils,
   la date du jour et le menu du compte (le thème, la sortie). Sur
   téléphone, le titre descend en tête de la page. Dessous, la page,
   plafonnée à la largeur des pages de la plateforme, la barre alignée sur
   elle.
   ──────────────────────────────────────────────────────────────── */

/** Le titre de la campagne, à la taille du salut des accueils de la plateforme. */
const TITRE = 'leading-tight font-extrabold tracking-[-0.02em] text-ink-strong';

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

  // Le filet sous la barre ne paraît que quand la page passe dessous.
  const [defile, setDefile] = useState(false);
  useEffect(() => {
    const suivre = () => setDefile(window.scrollY > 0);
    suivre();
    window.addEventListener('scroll', suivre, { passive: true });
    return () => window.removeEventListener('scroll', suivre);
  }, []);

  const annee = accueil.data?.annee ?? me.data?.campagne ?? null;
  const titre = `Évaluation annuelle${annee ? ` ${annee}` : ''}`;

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header
        className={cn(
          'sticky top-0 z-30 border-b bg-bg transition-colors duration-200',
          defile ? 'border-line-soft' : 'border-transparent',
        )}
      >
        <div className="mx-auto flex h-14 w-full max-w-page items-center gap-4 px-4 sm:h-[76px] sm:px-6">
          <Link
            href={ACCUEIL_DE_LA_CAMPAGNE}
            className="flex min-w-0 items-center gap-4 rounded-controle focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
          >
            <BrandMark variant="barre" />
            <span aria-hidden className="hidden h-8 w-px shrink-0 bg-line sm:block" />
            <span className={cn(TITRE, 'hidden truncate text-[22px] sm:block lg:text-[25px]')}>
              {titre}
            </span>
          </Link>
          {me.data ? (
            <div className="ml-auto flex shrink-0 items-center gap-4">
              <DateDuJour />
              <MenuCompte variante="entete" certificats={false} notifications={false} />
            </div>
          ) : null}
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-page flex-1 flex-col px-4 pt-2 pb-16 sm:px-6 sm:pt-4 sm:pb-12">
        <p className={cn(TITRE, 'mb-4 text-[22px] sm:hidden')}>{titre}</p>
        {me.data ? children : <Skeleton className="h-64 w-full rounded-bloc" />}
      </main>
    </div>
  );
}

/**
 * La date du jour, à gauche du compte, comme dans la barre de la plateforme,
 * mais sans le calendrier des jours fériés derrière elle : en campagne, rien
 * d'autre que l'évaluation ne s'ouvre, et la date se lit sans se cliquer
 * (ADR-0219). Sur un téléphone, en court.
 */
function DateDuJour() {
  const jour = new Date();
  const enLettres = (o: Intl.DateTimeFormatOptions) =>
    premierDuMois(jour.toLocaleDateString('fr-FR', o));
  const deux = (n: number) => String(n).padStart(2, '0');
  return (
    <time
      dateTime={`${jour.getFullYear()}-${deux(jour.getMonth() + 1)}-${deux(jour.getDate())}`}
      className="flex items-center gap-2 text-[12.5px] font-semibold whitespace-nowrap text-ink"
    >
      <Icon name="calendar_month" size={18} className="text-ink-muted" />
      <span className="sm:hidden">
        {enLettres({ day: 'numeric', month: 'short', year: 'numeric' })}
      </span>
      <span className="hidden sm:inline">
        {majuscule(enLettres({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}
      </span>
    </time>
  );
}
