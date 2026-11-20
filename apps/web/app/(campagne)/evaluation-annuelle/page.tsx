'use client';

import Link from 'next/link';
import {
  periodeDEvaluationEnLettres,
  type AgentACommenter,
  type AgentDeLEquipe,
  type PeriodeDeLaCampagne,
} from '@teranga/contracts';
import { Badge, Card, cn, EmptyState, Skeleton } from '@teranga/ui';
import {
  BoutonMAutoEvaluer,
  BoutonValiderMonEvaluation,
  CarteDEtape,
  IdentiteDeLaCampagne,
  statutDeLAgent,
  statutDeLEvaluation,
  statutPourLeN2,
  type Statut,
} from '../../../components/campagne/fiche';
import { CarteDeLaPeriode } from '../../../components/campagne/periode';
import { Icon } from '../../../components/icons';
import { ApiError } from '../../../lib/api';
import {
  ACCUEIL_DE_LA_CAMPAGNE,
  ADMINISTRATION_DE_LA_CAMPAGNE,
  ficheDuN2,
  SUIVI_DE_LA_DCH,
  useAccueilDeLaCampagne,
} from '../../../lib/campagne';

/* ────────────────────────────────────────────────────────────────
   L'accueil de la campagne d'évaluation annuelle (ADR-0211).

   Trois blocs, de haut en bas, sur toute la largeur. D'abord la fiche de
   la personne, comme celle de son dossier : son nom, son matricule, son
   poste, et en repères sa direction, son département, son service, son N+1
   et son statut ; à droite du nom, le bouton « M’auto-évaluer » tant que
   l'auto-évaluation est ouverte (ADR-0214), puis « Valider mon évaluation »
   quand le N+1 l'a transmise (ADR-0217). Puis la période d'évaluation
   annuelle et ses deux temps, l'auto-évaluation et l'évaluation, chacun
   avec sa période, ce qu'il demande, et la coche bleue une fois fait
   (ADR-0220).
   Ensuite, si la personne évalue des agents, son équipe : une carte par
   agent, en deux groupes. Une auto-évaluation faite rend la carte
   cliquable : le N+1 ouvre alors l'évaluation de l'agent, et la carte dit
   où elle en est (ADR-0216). Enfin, si la personne est le N+2 d'agents,
   les équipes de ses N+1 : une fiche validée par l'agent s'ouvre pour ses
   commentaires (ADR-0218).
   Avec l'habilitation « Tableau de bord », une carte de plus, sous la
   période, ouvre le suivi de la DCH (ADR-0221) ; pour un compte
   d'administration, une autre ouvre l'administration de la campagne
   (ADR-0222).
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
  const suivi = (
    <>
      {v.administration ? (
        <CarteDEtape
          icone="settings"
          titre="Administration de la campagne"
          periode={periodeEnBref(v.periode)}
          href={ADMINISTRATION_DE_LA_CAMPAGNE}
        />
      ) : null}
      {v.dch ? (
        <CarteDEtape
          icone="folder_managed"
          titre="Suivi de la DCH"
          periode={`Fiches transmises : ${v.dch.transmises} sur ${v.dch.fiches}`}
          href={SUIVI_DE_LA_DCH}
        />
      ) : null}
    </>
  );
  if (!v.moi) {
    // Un compte sans dossier d'agent, l'administration : ses pages, et le suivi.
    if (v.administration || v.dch) return <div className="flex flex-col gap-4">{suivi}</div>;
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
  const recue = v.monEvaluation;
  const transmise = auto?.etat === 'transmise';
  // Le bouton, tant que l'auto-évaluation est ouverte et pas encore transmise ;
  // puis, l'évaluation du N+1 arrivée, celui qui l'ouvre pour la valider.
  const aFaire = auto !== null && !transmise && v.phase === 'auto_evaluation';
  const action = aFaire ? (
    <BoutonMAutoEvaluer />
  ) : recue?.etat === 'a_valider' ? (
    <BoutonValiderMonEvaluation />
  ) : null;
  // L'en-tête et la carte de la période portent leur marge du bas : le même
  // écart sépare les blocs, que cette carte soit là ou non.
  return (
    <div className="flex flex-col gap-4">
      <IdentiteDeLaCampagne agent={v.moi} action={action} />
      {auto ? (
        <CarteDeLaPeriode annee={v.annee} periode={v.periode} auto={auto} recue={recue} />
      ) : null}
      {suivi}
      {v.equipe.length > 0 ? <Equipe equipe={v.equipe} /> : null}
      {v.aCommenter.length > 0 ? <ACommenter agents={v.aCommenter} /> : null}
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
  const carte = (a: AgentDeLEquipe): CarteDUnAgent => {
    const faite = a.auto.etat === 'transmise';
    return {
      agent: a,
      statut: faite ? statutDeLEvaluation(a) : statutDeLAgent(a.auto),
      href: faite ? `${ACCUEIL_DE_LA_CAMPAGNE}/equipe/${a.employeeId}` : undefined,
    };
  };
  return (
    <SectionDAgents
      id="mon-equipe"
      titre="Mon équipe"
      groupes={[
        {
          titre: 'Auto-évaluation faite',
          cartes: equipe.filter((a) => a.auto.etat === 'transmise').map(carte),
        },
        {
          titre: 'Auto-évaluation en attente',
          cartes: equipe.filter((a) => a.auto.etat !== 'transmise').map(carte),
        },
      ]}
    />
  );
}

/**
 * Les agents dont la personne est le N+2, rangés par N+1, en deux groupes :
 * d'abord les fiches validées par l'agent, qui s'ouvrent pour les
 * commentaires du N+2, puis celles qui n'y sont pas encore, avec l'étape où
 * elles en sont. Chaque carte dit le N+1 de l'agent (ADR-0218). Une fiche
 * reprise par le N+1 ne s'ouvre plus (ADR-0221).
 */
function ACommenter({ agents }: { agents: AgentACommenter[] }) {
  const carte = (a: AgentACommenter): CarteDUnAgent => ({
    agent: a,
    statut: statutPourLeN2(a),
    precision: `N+1 : ${a.n1.prenom} ${a.n1.nom}`,
    href:
      a.commentaires === 'en_attente' || a.commentaires === 'reprise'
        ? undefined
        : ficheDuN2(a.employeeId),
  });
  return (
    <SectionDAgents
      id="commentaires-du-n2"
      titre="Commentaires du N+2"
      groupes={[
        {
          titre: 'Évaluation validée par l’agent',
          cartes: agents.filter((a) => a.commentaires !== 'en_attente').map(carte),
        },
        {
          titre: 'Évaluation en cours',
          cartes: agents.filter((a) => a.commentaires === 'en_attente').map(carte),
        },
      ]}
    />
  );
}

/** « Du 15 au 30 décembre 2026 », ou ce qui manque, sous la carte de l'administration. */
function periodeEnBref(periode: PeriodeDeLaCampagne | null): string {
  if (!periode) return 'Dates de l’évaluation à fixer';
  const texte = periodeDEvaluationEnLettres(periode);
  return texte.charAt(0).toLocaleUpperCase('fr') + texte.slice(1);
}

/** Un agent sur sa carte : où en est sa fiche, et la page qu'elle ouvre s'il y a lieu. */
interface CarteDUnAgent {
  agent: Pick<AgentDeLEquipe, 'employeeId' | 'prenom' | 'nom' | 'poste' | 'matricule'>;
  statut: Statut;
  /** Une ligne de plus, sous le poste : son N+1. */
  precision?: string;
  href?: string;
}

/**
 * Une section d'agents, sous son titre et leur nombre, en groupes l'un sous
 * l'autre, séparés d'un filet. Un groupe vide ne s'affiche pas.
 */
function SectionDAgents({
  id,
  titre,
  groupes,
}: {
  id: string;
  titre: string;
  groupes: readonly { titre: string; cartes: CarteDUnAgent[] }[];
}) {
  const pleins = groupes.filter((g) => g.cartes.length > 0);
  const total = pleins.reduce((n, g) => n + g.cartes.length, 0);
  return (
    // Une section qui en suit une autre s'en écarte comme les blocs de la page.
    <section aria-labelledby={id} className="flex flex-col gap-4 [section+&]:mt-4">
      <h2
        id={id}
        className="flex items-center gap-2 text-[10.5px] font-extrabold tracking-[0.14em] text-primary uppercase"
      >
        {titre}
        <span className="text-ink-muted tabular-nums">{total}</span>
      </h2>
      {pleins.map((g, i) => (
        <div
          key={g.titre}
          className={cn('flex flex-col gap-3', i > 0 && 'border-t border-line-soft pt-5')}
        >
          <h3 className="flex items-center gap-2 text-[10.5px] font-bold tracking-[0.12em] text-ink-muted uppercase">
            {g.titre}
            <span className="tabular-nums">{g.cartes.length}</span>
          </h3>
          <Grille>
            {g.cartes.map((c) => (
              <CarteAgent key={c.agent.employeeId} carte={c} />
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
 * Un agent, en une carte : son nom, son poste, son matricule, la précision
 * s'il y en a une, et où en est sa fiche. Avec `href`, la carte s'ouvre.
 */
function CarteAgent({ carte: { agent: a, statut, precision, href } }: { carte: CarteDUnAgent }) {
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
        {precision ? (
          <span className="mt-1 block truncate text-[12px] text-ink-muted">{precision}</span>
        ) : null}
        <Badge tone={statut.ton} size="sm" className="mt-2.5">
          {statut.libelle}
        </Badge>
      </span>
      {href ? (
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
  return href ? (
    <Link
      href={href}
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
