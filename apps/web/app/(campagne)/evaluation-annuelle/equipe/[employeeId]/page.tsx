'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { EvaluationDeLAgent } from '@teranga/contracts';
import { Card, EmptyState, Skeleton } from '@teranga/ui';
import {
  CarteDeLAuto,
  IdentiteDeLaCampagne,
  statutDeLAgent,
} from '../../../../../components/campagne/fiche';
import { Icon } from '../../../../../components/icons';
import { api, ApiError } from '../../../../../lib/api';
import { ACCUEIL_DE_LA_CAMPAGNE, CLE_CAMPAGNE } from '../../../../../lib/campagne';

/* ────────────────────────────────────────────────────────────────
   Un agent de l'équipe, ouvert depuis sa carte (ADR-0211) : sa fiche,
   comme sur l'accueil, et son auto-évaluation. L'évaluation par le N+1
   viendra sous elles. Cette page ne s'ouvre qu'à l'évaluateur de l'agent.
   ──────────────────────────────────────────────────────────────── */

export default function AgentDeLEquipePage() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const vue = useQuery({
    queryKey: [...CLE_CAMPAGNE, 'equipe', employeeId],
    queryFn: () => api<EvaluationDeLAgent>(`/campagne/equipe/${employeeId}`),
    retry: false,
  });
  const v = vue.data;

  return (
    <div className="flex flex-col gap-4">
      <Link
        href={ACCUEIL_DE_LA_CAMPAGNE}
        className="-ml-1.5 inline-flex items-center gap-0.5 self-start rounded-controle py-1 pr-2 text-[12.5px] font-semibold text-ink-muted transition-colors duration-200 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
      >
        <Icon name="chevron_backward" size={18} />
        Mon équipe
      </Link>
      {vue.error ? (
        <Card>
          <EmptyState
            className="py-12"
            icon={<Icon name="groups" size={22} />}
            title={
              vue.error instanceof ApiError
                ? vue.error.problem.title
                : 'Impossible d’afficher la fiche de cet agent'
            }
          />
        </Card>
      ) : !v ? (
        <>
          <Skeleton className="mb-4 h-[158px] w-full rounded-bloc" />
          <Skeleton className="h-[86px] w-full rounded-bloc" />
        </>
      ) : (
        <>
          <IdentiteDeLaCampagne agent={v.agent} />
          {v.agent.auto ? (
            <CarteDeLAuto
              titre="Auto-évaluation"
              statut={statutDeLAgent(v.agent.auto)}
              periode={v.periode}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
