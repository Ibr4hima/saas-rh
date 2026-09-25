'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { AcademyCategory, CourseSummary } from '@teranga/contracts';
import { ACADEMY_CATEGORIES } from '@teranga/contracts';
import { Button, Card, cn, EmptyState, Input, Skeleton } from '@teranga/ui';
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
  const [recherche, setRecherche] = useState('');

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
          {enCours.length > 0 && formations.length > 3 ? (
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
                className="flex flex-1 flex-wrap gap-1.5 md:justify-center"
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
              <div className="relative md:w-60">
                <Icon
                  name="search"
                  size={15}
                  className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-muted/70"
                />
                <Input
                  placeholder="Rechercher une formation…"
                  value={recherche}
                  onChange={(e) => setRecherche(e.target.value)}
                  aria-label="Rechercher une formation"
                  className="h-8 w-full rounded-full pl-8 text-[12.5px]"
                />
              </div>
            </div>

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
