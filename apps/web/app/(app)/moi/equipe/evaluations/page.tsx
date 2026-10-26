'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  periodeDEvaluationEnLettres,
  type EvaluationsDeLEquipe,
  type LigneDEvaluation,
  type OuEnEst,
} from '@teranga/contracts';
import { Card, cn, EmptyState, Skeleton } from '@teranga/ui';
import { api } from '../../../../../lib/api';
import { EnTete, Repere } from '../../../../../components/fiche';
import { Page } from '../../../../../components/gabarit';
import { anneeDeLAdresse, CLE_EVALUATIONS } from '../../../../../components/grille-evaluation';
import { Icon } from '../../../../../components/icons';
import { Onglets, OngletsDeLEntete } from '../../../../../components/onglets';

/*
   Les évaluations de l'équipe (ADR-0149) : une carte par agent dont le
   N+1 remplit la grille, d'un côté ceux qui ne sont pas encore évalués, de
   l'autre ceux qui le sont, leur grille transmise à la DCH ; dessous, les
   grilles qu'un N+1 a envoyées en N+2, rangées de même. L'étape de chaque
   grille se lit en l'ouvrant. L'année se choisit dans l'en-tête quand il y
   en a plusieurs.
*/

export default function EvaluationsDeLEquipePage() {
  const router = useRouter();
  const demandee = anneeDeLAdresse(useSearchParams().get('annee'));
  const equipe = useQuery({
    queryKey: [...CLE_EVALUATIONS, 'equipe', demandee],
    queryFn: () =>
      api<EvaluationsDeLEquipe>(`/evaluations/equipe${demandee ? `?annee=${demandee}` : ''}`),
    // D'une année à l'autre, la page garde la précédente le temps de la suivante.
    placeholderData: (precedente) => precedente,
  });
  const v = equipe.data;
  const annees = v ? [...new Set([v.annee, ...v.annees])].sort((x, y) => y - x) : [];
  const onglets = annees.map((a) => ({ cle: String(a), label: String(a) }));
  const choisir = (cle: string) =>
    router.replace(`/moi/equipe/evaluations?annee=${cle}`, { scroll: false });

  const miennes = v?.lignes.filter((l) => !l.enN2) ?? [];
  const recues = v?.lignes.filter((l) => l.enN2) ?? [];
  const compte = (...etats: OuEnEst[]) => miennes.filter((l) => etats.includes(l.ouEnEst)).length;
  const aTraiter =
    compte('a_remplir', 'en_cours', 'renvoyee', 'validee_agent', 'validee_n2') +
    recues.filter((l) => l.ouEnEst === 'chez_n2').length;

  return (
    <Page>
      {onglets.length > 1 && v ? (
        <>
          <OngletsDeLEntete courant={String(v.annee)} onChange={choisir} onglets={onglets} />
          <Onglets
            courant={String(v.annee)}
            onChange={choisir}
            onglets={onglets}
            label="Choisir l’année"
            className="w-max lg:hidden"
          />
        </>
      ) : null}

      {v ? (
        <EnTete
          titre={`Évaluation annuelle ${v.annee}`}
          sousTitre={
            v.periode
              ? `Période d’évaluation ${periodeDEvaluationEnLettres(v.periode)}`
              : 'Période d’évaluation non fixée'
          }
          reperes={
            <>
              <Repere
                label="À traiter"
                valeur={String(aTraiter)}
                ton={aTraiter > 0 ? 'attente' : undefined}
              />
              <Repere label="Chez l’agent" valeur={String(compte('chez_agent'))} />
              <Repere label="Chez le N+2" valeur={String(compte('chez_n2'))} />
              <Repere label="Transmises à la DCH" valeur={String(compte('terminee'))} />
            </>
          }
        />
      ) : (
        <Skeleton className="h-[158px] w-full rounded-bloc" />
      )}

      {!v ? (
        <Grille>
          <Skeleton className="h-[92px] w-full rounded-bloc" />
          <Skeleton className="h-[92px] w-full rounded-bloc" />
          <Skeleton className="h-[92px] w-full rounded-bloc" />
        </Grille>
      ) : v.lignes.length === 0 ? (
        <Card>
          <EmptyState
            className="py-12"
            icon={<Icon name="groups" size={22} />}
            title="Aucun agent à évaluer"
          />
        </Card>
      ) : (
        <>
          {miennes.length > 0 ? (
            <Groupe titre="Mon équipe" lignes={miennes} annee={v.annee} />
          ) : null}
          {recues.length > 0 ? (
            <Groupe titre="Reçues en tant que N+2" lignes={recues} annee={v.annee} />
          ) : null}
        </>
      )}
    </Page>
  );
}

/**
 * Un groupe de cartes, en deux parts séparées d'un filet : les agents non
 * évalués, puis les évalués, dont la grille est transmise à la DCH. Côte à
 * côte sur un grand écran, l'une sous l'autre sur un petit. Une seule part
 * quand tous les agents sont dans le même cas.
 */
function Groupe({
  titre,
  lignes,
  annee,
}: {
  titre: string;
  lignes: LigneDEvaluation[];
  annee: number;
}) {
  const parts = [
    { titre: 'Non évalués', lignes: lignes.filter((l) => l.ouEnEst !== 'terminee') },
    { titre: 'Évalués', lignes: lignes.filter((l) => l.ouEnEst === 'terminee') },
  ].filter((p) => p.lignes.length > 0);
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[10.5px] font-extrabold tracking-[0.14em] text-primary uppercase">
        {titre}
      </h2>
      <div className={cn(parts.length > 1 && 'grid gap-y-5 lg:grid-cols-2')}>
        {parts.map((p, i) => (
          <div
            key={p.titre}
            className={cn(
              'flex min-w-0 flex-col gap-3',
              // Le filet entre les deux parts : vertical côte à côte,
              // horizontal quand elles passent l'une sous l'autre.
              parts.length > 1 &&
                (i === 0
                  ? 'lg:pr-6'
                  : 'border-t border-line-soft pt-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6'),
            )}
          >
            <h3 className="flex items-center gap-2 text-[10.5px] font-bold tracking-[0.12em] text-ink-muted uppercase">
              {p.titre}
              <span className="tabular-nums">{p.lignes.length}</span>
            </h3>
            <Grille>
              {p.lignes.map((l) => (
                <CarteAgent key={l.employeeId} ligne={l} annee={annee} />
              ))}
            </Grille>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Autant de cartes par ligne que la place en laisse, chacune de 16 rem au moins. */
function Grille({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(16rem,100%),1fr))] gap-3">
      {children}
    </div>
  );
}

/**
 * Un agent, en une carte : son nom, son poste et son matricule. Reçue en
 * N+2, la carte dit de quel N+1 elle vient.
 */
function CarteAgent({ ligne: l, annee }: { ligne: LigneDEvaluation; annee: number }) {
  const mots = l.nom.split(' ');
  return (
    <Link
      href={`/moi/equipe/evaluations/${l.employeeId}?annee=${annee}`}
      className="group flex w-full items-start gap-3 rounded-bloc border border-card-line bg-surface px-3.5 py-3 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-card-line-hover hover:shadow-sm focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[11.5px] font-bold text-primary uppercase">
        {mots[0]?.[0]}
        {mots.length > 1 ? mots[mots.length - 1]?.[0] : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-bold text-ink-strong">{l.nom}</span>
        {l.enN2 && l.n1 ? (
          <span className="mt-0.5 block truncate text-[11.5px] text-ink-muted">N+1 : {l.n1}</span>
        ) : l.poste ? (
          <span className="mt-0.5 block truncate text-[11.5px] text-ink-muted">{l.poste}</span>
        ) : null}
        {l.matricule ? (
          <span className="mt-1 block truncate font-mono text-[11px] tracking-tight text-ink-muted">
            {l.matricule}
          </span>
        ) : null}
      </span>
      <Icon
        name="chevron_right"
        size={15}
        className="mt-1 shrink-0 text-ink-muted/50 transition-transform duration-200 group-hover:translate-x-0.5"
      />
    </Link>
  );
}
