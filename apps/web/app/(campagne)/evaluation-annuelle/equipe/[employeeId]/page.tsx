'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { EvaluationDeLAgent } from '@teranga/contracts';
import { Badge, Card, EmptyState, Skeleton } from '@teranga/ui';
import { AutoEvaluationEnLecture } from '../../../../../components/campagne/auto-evaluation';
import {
  CarteDeLAuto,
  IdentiteDeLaCampagne,
  RetourALAccueil,
  statutDeLAgent,
} from '../../../../../components/campagne/fiche';
import { Icon } from '../../../../../components/icons';
import { api, ApiError } from '../../../../../lib/api';
import { CLE_CAMPAGNE } from '../../../../../lib/campagne';

/* ────────────────────────────────────────────────────────────────
   Un agent de l'équipe, ouvert depuis sa carte (ADR-0211) : sa fiche,
   comme sur l'accueil, et son auto-évaluation, qui se lit en entier une
   fois transmise (ADR-0215). L'évaluation par le N+1 viendra dessous.
   Cette page ne s'ouvre qu'à l'évaluateur de l'agent.
   ──────────────────────────────────────────────────────────────── */

export default function AgentDeLEquipePage() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const vue = useQuery({
    queryKey: [...CLE_CAMPAGNE, 'equipe', employeeId],
    queryFn: () => api<EvaluationDeLAgent>(`/campagne/equipe/${employeeId}`),
    retry: false,
  });
  const v = vue.data;
  const statut = v?.agent.auto ? statutDeLAgent(v.agent.auto) : null;

  return (
    <div className="flex flex-col gap-4">
      <RetourALAccueil libelle="Mon équipe" />
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
          {statut ? (
            <CarteDeLAuto
              titre="Auto-évaluation"
              marque={<Badge tone={statut.ton}>{statut.libelle}</Badge>}
              periode={v.periode}
            />
          ) : null}
          {v.autoEvaluation ? (
            <AutoEvaluationEnLecture
              annee={v.annee}
              objectifs={v.objectifs}
              auto={v.autoEvaluation}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
