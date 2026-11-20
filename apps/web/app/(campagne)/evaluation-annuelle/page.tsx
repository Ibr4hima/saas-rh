'use client';

import Link from 'next/link';
import type { AgentDeLEquipe } from '@teranga/contracts';
import { Badge, Card, cn, EmptyState, Skeleton } from '@teranga/ui';
import {
  AutoFaite,
  BoutonMAutoEvaluer,
  CarteDEtape,
  IdentiteDeLaCampagne,
  periodeDeLAuto,
  statutDeLAgent,
  statutDeLEvaluation,
} from '../../../components/campagne/fiche';
import { Icon } from '../../../components/icons';
import { ApiError } from '../../../lib/api';
import { ACCUEIL_DE_LA_CAMPAGNE, useAccueilDeLaCampagne } from '../../../lib/campagne';

/* ────────────────────────────────────────────────────────────────
   L'accueil de la campagne d'évaluation annuelle (ADR-0211).

   Trois blocs, de haut en bas, sur toute la largeur. D'abord la fiche de
   la personne, comme celle de son dossier : son nom, son matricule, son
   poste, et en repères sa direction, son département, son service, son N+1
   et son statut ; à droite du nom, le bouton « M’auto-évaluer » tant que
   l'auto-évaluation est ouverte (ADR-0214). Puis son auto-évaluation : sa
   période, et la coche bleue une fois transmise.
   Enfin, si la personne évalue des agents, son équipe : une carte par
   agent, en deux groupes. Une auto-évaluation faite rend la carte
   cliquable : le N+1 ouvre alors l'évaluation de l'agent, et la carte dit
   où elle en est (ADR-0216).
   ──────────────────────────────────────────────────────────────── */

export default function AccueilDeLaCampagnePage() {
  const accueil = useAccueilDeLaCampagne();
  const v = accueil.data;

  if (accueil.error) {
    return (
      <Card>
        <EmptyState
          className="py-12"
          icon={<Icon name="rate_review" size={22} />}
          title={
            accueil.error instanceof ApiError
              ? accueil.error.problem.title
              : 'Impossible d’afficher l’évaluation annuelle'
          }
        />
      </Card>
    );
  }
  if (!v) return <Squelette />;
  if (!v.moi) {
    return (
      <Card>
        <EmptyState
          className="py-12"
          icon={<Icon name="person" size={22} />}
          title="Aucun dossier d’agent n’est relié à ce compte"
        />
      </Card>
    );
  }
  const auto = v.moi.auto;
  // Le bouton, tant que l'auto-évaluation est ouverte et pas encore transmise.
  const aFaire = auto !== null && auto.etat !== 'transmise' && v.phase === 'auto_evaluation';
  // L'en-tête et la carte de l'auto-évaluation portent leur marge du bas :
  // le même écart sépare les blocs, que cette carte soit là ou non.
  return (
    <div className="flex flex-col gap-4">
      <IdentiteDeLaCampagne agent={v.moi} action={aFaire ? <BoutonMAutoEvaluer /> : null} />
      {auto ? (
        <CarteDEtape
          icone="rate_review"
          titre="Mon auto-évaluation"
          marque={auto.etat === 'transmise' ? <AutoFaite le={auto.transmiseLe} /> : null}
          periode={periodeDeLAuto(v.periode)}
        />
      ) : null}
      {v.equipe.length > 0 ? <Equipe equipe={v.equipe} /> : null}
    </div>
  );
}

/**
 * Les agents qu'évalue la personne, en deux groupes l'un sous l'autre :
 * d'abord les agents dont l'auto-évaluation est faite, à évaluer, puis les
 * autres. Chaque groupe prend toute la largeur, quatre cartes par ligne sur
 * un grand écran. Un seul groupe quand tous les agents sont dans le même cas.
 */
function Equipe({ equipe }: { equipe: AgentDeLEquipe[] }) {
  const parts = [
    {
      titre: 'Auto-évaluation faite',
      agents: equipe.filter((a) => a.auto.etat === 'transmise'),
    },
    {
      titre: 'Auto-évaluation en attente',
      agents: equipe.filter((a) => a.auto.etat !== 'transmise'),
    },
  ].filter((p) => p.agents.length > 0);
  return (
    <section aria-labelledby="mon-equipe" className="flex flex-col gap-4">
      <h2
        id="mon-equipe"
        className="flex items-center gap-2 text-[10.5px] font-extrabold tracking-[0.14em] text-primary uppercase"
      >
        Mon équipe
        <span className="text-ink-muted tabular-nums">{equipe.length}</span>
      </h2>
      {parts.map((p, i) => (
        <div
          key={p.titre}
          className={cn('flex flex-col gap-3', i > 0 && 'border-t border-line-soft pt-5')}
        >
          <h3 className="flex items-center gap-2 text-[10.5px] font-bold tracking-[0.12em] text-ink-muted uppercase">
            {p.titre}
            <span className="tabular-nums">{p.agents.length}</span>
          </h3>
          <Grille>
            {p.agents.map((a) => (
              <CarteAgent key={a.employeeId} agent={a} />
            ))}
          </Grille>
        </div>
      ))}
    </section>
  );
}

/** Autant de cartes par ligne que la place en laisse, chacune de 17 rem au moins. */
function Grille({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(17rem,100%),1fr))] gap-3">
      {children}
    </div>
  );
}

/**
 * Un agent, en une carte : son nom, son poste, son matricule, et où en est
 * son auto-évaluation. Faite, la carte s'ouvre sur son évaluation, et dit
 * où en est l'évaluation.
 */
function CarteAgent({ agent: a }: { agent: AgentDeLEquipe }) {
  const faite = a.auto.etat === 'transmise';
  const statut = faite ? statutDeLEvaluation(a.evaluation) : statutDeLAgent(a.auto);
  const contenu = (
    <>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[12.5px] font-bold text-primary uppercase">
        {a.prenom.charAt(0)}
        {a.nom.charAt(0)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] leading-tight font-bold text-ink-strong">
          {a.prenom} {a.nom}
        </span>
        {a.poste ? (
          <span className="mt-1 block truncate text-[12px] text-ink-muted">{a.poste}</span>
        ) : null}
        <span className="mt-1 block truncate font-mono text-[11.5px] tracking-tight text-ink-muted">
          {a.matricule}
        </span>
        <Badge tone={statut.ton} size="sm" className="mt-2.5">
          {statut.libelle}
        </Badge>
      </span>
      {faite ? (
        <Icon
          name="chevron_right"
          size={16}
          className="mt-0.5 shrink-0 text-ink-muted/50 transition-transform duration-200 group-hover:translate-x-0.5"
        />
      ) : null}
    </>
  );
  const forme =
    'flex w-full items-start gap-3 rounded-bloc border border-card-line bg-surface px-4 py-3.5 text-left';
  return faite ? (
    <Link
      href={`${ACCUEIL_DE_LA_CAMPAGNE}/equipe/${a.employeeId}`}
      className={cn(
        forme,
        'group transition-all duration-200 hover:-translate-y-0.5 hover:border-card-line-hover hover:shadow-sm focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none',
      )}
    >
      {contenu}
    </Link>
  ) : (
    <div className={forme}>{contenu}</div>
  );
}

/** La page en attendant ses données : les mêmes blocs, à leur taille. */
function Squelette() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="mb-4 h-[158px] w-full rounded-bloc" />
      <Skeleton className="mb-4 h-[86px] w-full rounded-bloc" />
      <Grille>
        <Skeleton className="h-[118px] w-full rounded-bloc" />
        <Skeleton className="h-[118px] w-full rounded-bloc" />
        <Skeleton className="h-[118px] w-full rounded-bloc" />
      </Grille>
    </div>
  );
}
