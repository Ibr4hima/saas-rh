'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import type { StatutSuivi, TeamCourseProgress, TeamMemberDetail } from '@teranga/contracts';
import { Card, Skeleton } from '@teranga/ui';
import { RetourAcademy } from '../../../../../components/academy-carte';
import {
  chiffresDe,
  Initiales,
  LigneFormationSuivie,
} from '../../../../../components/academy-equipe';
import { Page } from '../../../../../components/gabarit';
import { LoadFailure } from '../../../../../components/load-failure';
import { api } from '../../../../../lib/api';
import { compte } from '../../../../../lib/mots';
import { anciennete } from '../../../../../lib/temps';

/* ————————————————————————————————————————————————————————————————
   La fiche Academy d'un agent de l'équipe, vue par son n+1.

   Quatre rubriques, dans l'ordre où l'on agit : ce qui l'ATTEND (une
   évaluation à passer ou à repasser), ce qu'il SUIT, ce qu'il a OBTENU, et
   ce qu'il n'a pas encore ouvert. Une rubrique vide ne s'affiche pas.
   ———————————————————————————————————————————————————————————————— */

const RUBRIQUES: Array<{ cle: string; titre: string; statuts: StatutSuivi[] }> = [
  { cle: 'attente', titre: 'À l’évaluation', statuts: ['evaluation_a_passer', 'non_reussie'] },
  { cle: 'en-cours', titre: 'En cours', statuts: ['en_cours'] },
  { cle: 'obtenues', titre: 'Obtenues', statuts: ['certifiee', 'terminee'] },
  { cle: 'a-commencer', titre: 'Pas encore commencées', statuts: ['a_commencer'] },
];

function Rubrique({ titre, formations }: { titre: string; formations: TeamCourseProgress[] }) {
  if (formations.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="px-1 text-[12px] font-bold text-ink-muted">
        {titre}
        <span className="ml-2 font-semibold text-ink-muted/70">{formations.length}</span>
      </h3>
      <Card className="shrink-0 px-5 py-1">
        <ul className="flex flex-col">
          {formations.map((f) => (
            <LigneFormationSuivie key={f.courseId ?? `retiree-${f.title}`} formation={f} />
          ))}
        </ul>
      </Card>
    </section>
  );
}

export default function FicheEquipePage() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const fiche = useQuery({
    queryKey: ['academy', 'equipe', employeeId],
    queryFn: () => api<TeamMemberDetail>(`/academy/equipe/${employeeId}`),
  });

  return (
    <Page>
      <RetourAcademy href="/academy/equipe" label="Mon équipe" />
      {fiche.isPending ? (
        <>
          <Skeleton className="h-[96px] w-full rounded-[16px]" />
          <Skeleton className="h-[220px] w-full rounded-[16px]" />
        </>
      ) : fiche.isError ? (
        <LoadFailure error={fiche.error} onRetry={() => void fiche.refetch()} />
      ) : (
        <Fiche agent={fiche.data} />
      )}
    </Page>
  );
}

function Fiche({ agent }: { agent: TeamMemberDetail }) {
  const c = chiffresDe(agent);
  const poste = [agent.positionTitle, agent.unitName].filter(Boolean).join(' · ');
  // Seul ce qui existe se dit : « 0 évaluation à passer » n'apprend rien.
  const resume = [
    c.enCours > 0 && compte(c.enCours, 'formation en cours', 'formations en cours'),
    c.aEvaluer > 0 && compte(c.aEvaluer, 'évaluation à passer', 'évaluations à passer'),
    c.obtenues > 0 && compte(c.obtenues, 'formation obtenue', 'formations obtenues'),
  ].filter(Boolean);
  return (
    <>
      <Card className="flex shrink-0 flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <Initiales prenom={agent.givenName} nom={agent.familyName} grand />
          <div className="min-w-0">
            <h2 className="truncate text-[19px] font-bold tracking-[-0.01em] text-ink-strong">
              {agent.givenName} {agent.familyName}
            </h2>
            <p className="text-[12.5px] text-ink-muted sm:truncate">
              {[poste, agent.number].filter(Boolean).join(' · ')}
            </p>
            {agent.level > 1 ? (
              <p className="truncate text-[12px] text-ink-muted">
                Rend compte à <b className="font-semibold text-ink">{agent.manager.name}</b>
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col gap-0.5 border-t border-line-soft pt-3 text-[12px] text-ink-muted sm:items-end sm:border-t-0 sm:pt-0 sm:text-right">
          <span>{resume.length ? resume.join(' · ') : 'Aucune formation commencée'}</span>
          <span>
            {agent.lastActivityAt
              ? `Dernière activité il y a ${anciennete(agent.lastActivityAt)}`
              : 'Aucune activité pour l’instant'}
          </span>
        </div>
      </Card>

      {RUBRIQUES.map((r) => (
        <Rubrique
          key={r.cle}
          titre={r.titre}
          formations={agent.courses.filter((f) => r.statuts.includes(f.status))}
        />
      ))}
    </>
  );
}
