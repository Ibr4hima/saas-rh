'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { AcademyCategory, CourseSummary } from '@teranga/contracts';
import { ACADEMY_CATEGORIES } from '@teranga/contracts';
import { Button, Card, cn, EmptyState, Skeleton } from '@teranga/ui';
import { CarteFormation } from '../../../components/academy-carte';
import { Page } from '../../../components/gabarit';
import { Icon } from '../../../components/icons';
import { LoadFailure } from '../../../components/load-failure';
import { FAMILLES } from '../../../lib/academy';
import { api } from '../../../lib/api';
import { useMe } from '../../../lib/hooks';
import { compte } from '../../../lib/mots';

/* ————————————————————————————————————————————————————————————————
   APIX Academy — le catalogue.

   Deux questions, dans cet ordre. « Où en étais-je ? » : les formations
   commencées, en tête, pour reprendre en un clic. « Qu'est-ce que je pourrais
   apprendre ? » : le catalogue, par famille, avec une recherche.

   La recherche vit dans la bande bleue (components/recherche-academy.tsx) ;
   le mot cherché arrive ici par l'adresse, ?q=.

   Les certificats n'y sont plus : ils ont leur page, « Mes certificats »,
   ouverte depuis le menu du compte — où qu'on se trouve dans l'application.
   Les formations gardées ont la leur, « Ma liste », derrière le signet du
   bandeau.

   Une formation terminée ne disparaît pas : on y revient pour réviser. Elle
   se reconnaît à sa pastille, elle ne s'impose plus en tête.
   ———————————————————————————————————————————————————————————————— */

type Filtre = AcademyCategory | 'toutes';

function Intitule({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[10.5px] font-extrabold tracking-[0.14em] text-primary uppercase">
      {children}
    </h2>
  );
}

export default function AcademyPage() {
  const me = useMe();
  const gere = me.data?.role === 'admin' || me.data?.role === 'hr';
  const catalogue = useQuery({
    queryKey: ['academy', 'catalogue'],
    queryFn: () => api<CourseSummary[]>('/academy/courses'),
  });
  const [filtre, setFiltre] = useState<Filtre>('toutes');
  const recherche = useSearchParams().get('q') ?? '';

  const formations = useMemo(() => catalogue.data ?? [], [catalogue.data]);
  const enCours = useMemo(
    () =>
      formations
        .filter((f) => f.lastActivityAt !== null && f.completedLessons < f.lessonCount)
        .sort((a, b) => (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? '')),
    [formations],
  );
  const familles = ACADEMY_CATEGORIES.filter((c) => formations.some((f) => f.category === c));
  const visibles = useMemo(() => {
    const q = recherche.trim().toLocaleLowerCase('fr');
    return formations.filter(
      (f) =>
        (filtre === 'toutes' || f.category === filtre) &&
        (!q ||
          f.title.toLocaleLowerCase('fr').includes(q) ||
          (f.summary ?? '').toLocaleLowerCase('fr').includes(q)),
    );
  }, [formations, filtre, recherche]);

  if (catalogue.isPending) {
    return (
      <Page>
        <Skeleton className="h-8 w-full shrink-0 rounded-full" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[260px] rounded-[16px]" />
          ))}
        </div>
      </Page>
    );
  }
  if (catalogue.isError) {
    return (
      <Page>
        <LoadFailure error={catalogue.error} onRetry={() => void catalogue.refetch()} />
      </Page>
    );
  }

  return (
    <Page>
      {formations.length === 0 ? (
        <Card className="flex flex-1 items-center justify-center">
          <EmptyState
            icon={<Icon name="school" size={22} />}
            title="Le catalogue est encore vide"
            description={
              gere
                ? 'Créez une première formation : un module, quelques leçons en vidéo, et publiez.'
                : 'Les premières formations arrivent bientôt. Elles apparaîtront ici dès leur publication.'
            }
            action={
              gere ? (
                <Link href="/academy/gerer">
                  <Button>
                    <Icon name="settings" size={16} />
                    Gérer le catalogue
                  </Button>
                </Link>
              ) : null
            }
          />
        </Card>
      ) : (
        <>
          {/* « Reprendre » n'a de sens que si le catalogue ne tient plus d'un
              regard : à trois formations ou moins, elles sont toutes sous les
              yeux avec leur progression, et la rangée ne ferait que les
              répéter. */}
          {enCours.length > 0 && formations.length > 3 && !recherche.trim() ? (
            <section className="flex flex-col gap-3">
              <Intitule>Reprendre là où vous en étiez</Intitule>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {enCours.slice(0, 3).map((f) => (
                  <CarteFormation key={f.id} formation={f} />
                ))}
              </div>
            </section>
          ) : null}

          <section className="flex flex-col gap-3 pb-2">
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <Intitule>Catalogue</Intitule>
              <div
                role="tablist"
                aria-label="Familles de formations"
                className="flex flex-1 flex-wrap gap-1.5"
              >
                {(['toutes', ...familles] as Filtre[]).map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="tab"
                    aria-selected={filtre === c}
                    onClick={() => setFiltre(c)}
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none',
                      filtre === c
                        ? 'border-primary bg-primary text-primary-ink'
                        : 'border-line-soft bg-surface text-ink-muted hover:border-line hover:text-ink',
                    )}
                  >
                    {c === 'toutes' ? 'Toutes' : FAMILLES[c].label}
                  </button>
                ))}
              </div>
            </div>

            {/* Le champ est dans le bandeau, loin des cartes : on redit ici
                ce qui filtre, et comment l'enlever. */}
            {recherche.trim() ? (
              <p className="flex flex-wrap items-center gap-x-2 text-[12.5px] text-ink-muted">
                <span>
                  {visibles.length === 0 ? 'Aucun résultat' : compte(visibles.length, 'résultat')}{' '}
                  pour <b className="font-bold text-ink-strong">« {recherche.trim()} »</b>
                </span>
                <button
                  type="button"
                  onClick={() => window.history.replaceState(null, '', '/academy')}
                  className="font-semibold text-primary hover:underline focus-visible:underline focus-visible:outline-none"
                >
                  Effacer
                </button>
              </p>
            ) : null}

            {visibles.length === 0 ? (
              <Card>
                <EmptyState
                  icon={<Icon name="search" size={22} />}
                  title="Aucune formation ne correspond"
                  description="Essayez un autre mot, ou une autre famille."
                />
              </Card>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {visibles.map((f) => (
                  <CarteFormation key={f.id} formation={f} />
                ))}
              </div>
            )}
            <p className="sr-only" aria-live="polite">
              {compte(visibles.length, 'formation')}
            </p>
          </section>
        </>
      )}
    </Page>
  );
}
