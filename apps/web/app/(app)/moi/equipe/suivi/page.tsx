'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { MembreSuivi, SuiviEquipe } from '@teranga/contracts';
import { Card, CardHeader, CardTitle, cn, EmptyState, Skeleton } from '@teranga/ui';
import { api } from '../../../../../lib/api';
import { Initiales } from '../../../../../components/academy-equipe';
import { Page } from '../../../../../components/gabarit';
import { Icon } from '../../../../../components/icons';
import { CLE_OBJECTIFS } from '../../../../../components/objectifs';

/**
 * Suivi & Évaluation : les directs du n+1, et où en sont leurs objectifs de
 * l'année. Un clic ouvre la fiche, où il les fixe et les évalue.
 */
export default function SuiviEquipePage() {
  const suivi = useQuery({
    queryKey: [...CLE_OBJECTIFS, 'equipe'],
    queryFn: () => api<SuiviEquipe>('/objectifs/equipe'),
  });

  return (
    <Page>
      <Card>
        <CardHeader>
          <CardTitle>Mon équipe</CardTitle>
        </CardHeader>
        {suivi.isLoading ? (
          <div className="flex flex-col gap-2 px-5 pb-5">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : !suivi.data?.membres.length ? (
          <EmptyState
            className="py-12"
            icon={<Icon name="groups" size={22} />}
            title="Personne ne vous rend compte"
          />
        ) : (
          <ul className="flex flex-col px-2 pb-2">
            {suivi.data.membres.map((m) => (
              <Membre key={m.employeeId} membre={m} />
            ))}
          </ul>
        )}
      </Card>
    </Page>
  );
}

function Membre({ membre: m }: { membre: MembreSuivi }) {
  return (
    <li>
      <Link
        href={`/moi/equipe/suivi/${m.employeeId}`}
        className="flex items-center gap-3 rounded-[11px] px-3 py-3 transition-colors duration-150 hover:bg-hover"
      >
        <Initiales prenom={m.givenName} nom={m.familyName} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-semibold text-ink-strong">
            {m.givenName} {m.familyName}
          </span>
          <span className="block truncate text-[12px] text-ink-muted">
            {[m.positionTitle, m.unitName].filter(Boolean).join(' · ') || m.number}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-0.5 text-[12px] tabular-nums">
          {m.total === 0 ? (
            <span className="text-ink-muted">Aucun objectif</span>
          ) : (
            <span className={cn('font-semibold text-ink')}>
              {m.atteints}/{m.total} atteint{m.atteints > 1 ? 's' : ''}
            </span>
          )}
          {m.enRetard > 0 ? (
            <span className="font-semibold text-danger">{m.enRetard} en retard</span>
          ) : null}
        </span>
        <Icon name="chevron_right" size={18} className="shrink-0 text-ink-muted" />
      </Link>
    </li>
  );
}
