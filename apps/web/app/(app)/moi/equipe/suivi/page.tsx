'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { MembreSuivi, SuiviEquipe } from '@teranga/contracts';
import { Card, EmptyState, Skeleton } from '@teranga/ui';
import { api } from '../../../../../lib/api';
import { Page } from '../../../../../components/gabarit';
import { Icon, type IconName } from '../../../../../components/icons';
import { CLE_OBJECTIFS } from '../../../../../components/objectifs';

/**
 * Suivi & Évaluation : les directs du n+1, une carte chacun — le nom, le
 * matricule, l'email professionnel. Un clic ouvre sa fiche, où il fixe et
 * évalue ses objectifs.
 */
export default function SuiviEquipePage() {
  const suivi = useQuery({
    queryKey: [...CLE_OBJECTIFS, 'equipe'],
    queryFn: () => api<SuiviEquipe>('/objectifs/equipe'),
  });
  const membres = suivi.data?.membres ?? [];

  return (
    <Page>
      <section className="flex flex-col gap-3">
        <h2 className="text-[10.5px] font-extrabold tracking-[0.14em] text-primary uppercase">
          Mon équipe
        </h2>
        {suivi.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-[84px] w-full rounded-[14px]" />
            <Skeleton className="h-[84px] w-full rounded-[14px]" />
            <Skeleton className="h-[84px] w-full rounded-[14px]" />
          </div>
        ) : membres.length === 0 ? (
          <Card>
            <EmptyState
              className="py-12"
              icon={<Icon name="groups" size={22} />}
              title="Personne ne vous rend compte"
            />
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {membres.map((m) => (
              <CarteMembre key={m.employeeId} membre={m} />
            ))}
          </div>
        )}
      </section>
    </Page>
  );
}

/** Un direct, en une carte : le nom, le matricule, l'email professionnel. */
function CarteMembre({ membre: m }: { membre: MembreSuivi }) {
  return (
    <Link
      href={`/moi/equipe/suivi/${m.employeeId}`}
      className="group flex w-full items-start gap-3 rounded-[14px] border border-card-line bg-surface px-3.5 py-3 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-card-line-hover hover:shadow-sm focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[11.5px] font-bold text-primary uppercase">
        {m.givenName[0]}
        {m.familyName[0]}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-bold text-ink-strong">
          {m.givenName} {m.familyName}
        </span>
        <span className="mt-1 flex flex-col gap-[3px]">
          <Ligne icon="badge">
            <span className="font-mono tracking-tight">{m.number}</span>
          </Ligne>
          <Ligne icon="mail">{m.workEmail ?? '—'}</Ligne>
        </span>
      </span>
      <Icon
        name="chevron_right"
        size={15}
        className="mt-1 shrink-0 text-ink-muted/50 transition-transform duration-200 group-hover:translate-x-0.5"
      />
    </Link>
  );
}

function Ligne({ icon, children }: { icon: IconName; children: React.ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-ink-muted">
      <Icon name={icon} size={13} className="shrink-0 text-ink-muted/70" />
      <span className="truncate">{children}</span>
    </span>
  );
}
