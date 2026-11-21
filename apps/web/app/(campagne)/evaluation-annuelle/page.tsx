'use client';

import Link from 'next/link';
import {
  periodeDEvaluationEnLettres,
  type AccueilDeLaCampagne,
  type AgentACommenter,
  type AgentDeLEquipe,
  type PeriodeDeLaCampagne,
} from '@teranga/contracts';
import { Badge, Card, cn, EmptyState, Skeleton } from '@teranga/ui';
import {
  BandeauDeLAgent,
  BandeauDeLaCampagne,
  Initiales,
  TitreDeSection,
  TuileDePilotage,
} from '../../../components/campagne/accueil';
import {
  BoutonMAutoEvaluer,
  BoutonValiderMonEvaluation,
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
   L'accueil de la campagne d'évaluation annuelle (ADR-0211), à la charte
   de l'APIX (ADR-0227).

   En tête, le bandeau de la personne, sur le bleu de la charte : ses
   initiales, son nom et son poste ; à droite, le bouton « M’auto-évaluer »
   tant que l'auto-évaluation est ouverte (ADR-0214), puis « Valider mon
   évaluation » quand le N+1 l'a transmise (ADR-0217). La courbe du papier à
   en-tête, soulignée d'orange, le ferme ; dessous, ses repères, comme sur la
   fiche de son dossier : direction, département, service, supérieur
   hiérarchique, statut (ADR-0224).
   Pour qui pilote la campagne, des tuiles juste dessous : le suivi de la
   DCH, avec l'habilitation « Tableau de bord » (ADR-0221), et
   l'administration, pour un compte d'administration (ADR-0222).
   Puis des sections titrées en Anton : la période d'évaluation annuelle et
   ses deux temps, numérotés, chacun avec sa période, ce qu'il demande, et
   la coche bleue une fois fait (ADR-0220) ; si la personne évalue des
   agents, son équipe, une carte par agent, en deux groupes. Une
   auto-évaluation faite rend la carte cliquable : le N+1 ouvre alors
   l'évaluation de l'agent, et la carte dit où elle en est (ADR-0216). En
   haut à droite de chaque carte, un point dit l'auto-évaluation : vert,
   faite ; rouge, non faite (ADR-0226). Enfin, si la personne est le N+2
   d'agents, les équipes de ses N+1 : une fiche validée par l'agent s'ouvre
   pour ses commentaires (ADR-0218).
   Les blocs montent l'un après l'autre à l'arrivée sur la page.
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

  const pilotage = v.administration || v.dch;
  if (!v.moi) {
    // Un compte sans dossier d'agent, l'administration : la campagne, ses pages.
    if (pilotage) {
      return (
        <div className="flex flex-col gap-8 sm:gap-10">
          <Bloc rang={0}>
            <BandeauDeLaCampagne titre={`Évaluation annuelle ${v.annee}`} periode={v.periode} />
          </Bloc>
          <Bloc rang={1}>
            <Pilotage accueil={v} />
          </Bloc>
        </div>
      );
    }
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
  let rang = 0;
  return (
    <div className="flex flex-col gap-8 sm:gap-10">
      <Bloc rang={rang++}>
        <BandeauDeLAgent agent={v.moi} action={action} />
      </Bloc>
      {pilotage ? (
        <Bloc rang={rang++}>
          <Pilotage accueil={v} />
        </Bloc>
      ) : null}
      {auto ? (
        <Bloc rang={rang++}>
          <CarteDeLaPeriode annee={v.annee} periode={v.periode} auto={auto} recue={recue} />
        </Bloc>
      ) : null}
      {v.equipe.length > 0 ? (
        <Bloc rang={rang++}>
          <Equipe equipe={v.equipe} />
        </Bloc>
      ) : null}
      {v.aCommenter.length > 0 ? (
        <Bloc rang={rang++}>
          <ACommenter agents={v.aCommenter} />
        </Bloc>
      ) : null}
    </div>
  );
}

/** Un bloc de l'accueil, qui monte à son tour : 60 ms après le précédent. */
function Bloc({ rang, children }: { rang: number; children: React.ReactNode }) {
  return (
    <div className="bloc-monte" style={{ '--retard': `${rang * 0.06}s` } as React.CSSProperties}>
      {children}
    </div>
  );
}

/**
 * Les tuiles de qui pilote la campagne : l'administration, avec ses dates,
 * et le suivi de la DCH, avec la jauge des fiches transmises. Elles se
 * partagent la largeur : seule, une tuile la prend toute.
 */
function Pilotage({ accueil: v }: { accueil: AccueilDeLaCampagne }) {
  return (
    <nav
      aria-label="Pilotage de la campagne"
      className="grid grid-cols-[repeat(auto-fit,minmax(min(19rem,100%),1fr))] gap-4"
    >
      {v.administration ? (
        <TuileDePilotage
          href={ADMINISTRATION_DE_LA_CAMPAGNE}
          icone="settings"
          titre="Administration de la campagne"
          texte={periodeEnBref(v.periode)}
        />
      ) : null}
      {v.dch ? (
        <TuileDePilotage
          href={SUIVI_DE_LA_DCH}
          icone="folder_managed"
          titre="Suivi de la DCH"
          texte={`Fiches transmises : ${v.dch.transmises} sur ${v.dch.fiches}`}
          jauge={{ fait: v.dch.transmises, total: v.dch.fiches }}
        />
      ) : null}
    </nav>
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
      // L'auto-évaluation est faite ou ne l'est pas : le point le dit. Le
      // badge, une fois faite, suit l'évaluation du N+1 (ADR-0226).
      autoFaite: faite,
      statut: faite ? statutDeLEvaluation(a) : null,
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
          point: 'faite',
          cartes: equipe.filter((a) => a.auto.etat === 'transmise').map(carte),
        },
        {
          titre: 'Auto-évaluation non faite',
          point: 'non_faite',
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
    autoFaite: a.auto.etat === 'transmise',
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

/** « Du 15 au 30 décembre 2026 », ou ce qui manque, sur la tuile de l'administration. */
function periodeEnBref(periode: PeriodeDeLaCampagne | null): string {
  if (!periode) return 'Dates de l’évaluation à fixer';
  const texte = periodeDEvaluationEnLettres(periode);
  return texte.charAt(0).toLocaleUpperCase('fr') + texte.slice(1);
}

/** Un agent sur sa carte : où en est sa fiche, et la page qu'elle ouvre s'il y a lieu. */
interface CarteDUnAgent {
  agent: Pick<AgentDeLEquipe, 'employeeId' | 'prenom' | 'nom' | 'poste'>;
  /** L'auto-évaluation de l'agent : faite, ou pas. */
  autoFaite: boolean;
  /** Où en est la suite de sa fiche ; `null` tant que l'auto-évaluation n'est pas faite. */
  statut: Statut | null;
  /** Une ligne de plus, sous le poste : son N+1. */
  precision?: string;
  href?: string;
}

/**
 * Une section d'agents, sous son titre en Anton et leur nombre, en groupes
 * l'un sous l'autre, séparés d'un filet. Un groupe vide ne s'affiche pas.
 * Le titre d'un groupe de « Mon équipe » porte la couleur de son point : il
 * sert de légende aux points des cartes.
 */
function SectionDAgents({
  id,
  titre,
  groupes,
}: {
  id: string;
  titre: string;
  groupes: readonly {
    titre: string;
    point?: 'faite' | 'non_faite';
    cartes: CarteDUnAgent[];
  }[];
}) {
  const pleins = groupes.filter((g) => g.cartes.length > 0);
  const total = pleins.reduce((n, g) => n + g.cartes.length, 0);
  return (
    <section aria-labelledby={id} className="flex flex-col gap-5">
      <TitreDeSection id={id} nombre={total}>
        {titre}
      </TitreDeSection>
      {pleins.map((g, i) => (
        <div
          key={g.titre}
          className={cn('flex flex-col gap-3', i > 0 && 'border-t border-line-soft pt-5')}
        >
          <h3 className="flex items-center gap-2 text-[11px] font-bold tracking-[0.12em] text-ink-muted uppercase">
            {g.point ? (
              <span
                aria-hidden
                className={cn(
                  'size-2 shrink-0 rounded-full',
                  g.point === 'faite' ? 'bg-success' : 'bg-danger',
                )}
              />
            ) : null}
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
 * Un agent, en une carte : ses initiales, son nom, son poste, la précision
 * s'il y en a une, et où en est sa fiche ; en haut à droite, le point de son
 * auto-évaluation. Avec `href`, la carte s'ouvre.
 */
function CarteAgent({
  carte: { agent: a, autoFaite, statut, precision, href },
}: {
  carte: CarteDUnAgent;
}) {
  const auto = autoFaite ? 'Auto-évaluation faite' : 'Auto-évaluation non faite';
  const contenu = (
    <>
      {/* L'auto-évaluation en un point, en haut à droite, à hauteur du nom :
          vert, faite ; rouge, non faite. */}
      <span
        role="img"
        aria-label={auto}
        title={auto}
        className={cn(
          'absolute top-5 right-4 size-2.5 rounded-full',
          autoFaite ? 'bg-success' : 'bg-danger',
        )}
      />
      <Initiales prenom={a.prenom} nom={a.nom} taille="carte" />
      <span className="min-w-0 flex-1">
        {/* Le nom s'arrête avant le point. */}
        <span className="block truncate pr-4 text-[14.5px] leading-tight font-bold text-ink-strong">
          {a.prenom} {a.nom}
        </span>
        {/* Le poste seul, sans le matricule, sur deux lignes au plus (ADR-0225). */}
        {a.poste ? (
          <span className="mt-1 line-clamp-2 text-[12.5px] leading-snug text-ink-muted">
            {a.poste}
          </span>
        ) : null}
        {precision ? (
          <span className="mt-1 block truncate text-[12px] text-ink-muted">{precision}</span>
        ) : null}
        {statut ? (
          <Badge tone={statut.ton} size="sm" className="mt-3">
            {statut.libelle}
          </Badge>
        ) : null}
      </span>
      {/* La flèche descend au milieu : le coin haut appartient au point. */}
      {href ? (
        <Icon
          name="chevron_right"
          size={18}
          className="shrink-0 self-center text-ink-muted/50 transition-[color,transform] duration-200 group-hover:translate-x-0.5 group-hover:text-primary"
        />
      ) : null}
    </>
  );
  const forme =
    'relative flex w-full items-start gap-3.5 rounded-bloc border border-card-line bg-surface p-4 text-left shadow-xs';
  return href ? (
    <Link
      href={href}
      className={cn(
        forme,
        'group transition-all duration-200 hover:-translate-y-0.5 hover:border-card-line-hover hover:shadow-md focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none',
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
    <div className="flex flex-col gap-8 sm:gap-10">
      <Skeleton className="h-[236px] w-full rounded-barre" />
      <div className="flex flex-col gap-4">
        <Skeleton className="h-7 w-full max-w-80 rounded-controle" />
        <Skeleton className="h-[264px] w-full rounded-bloc" />
      </div>
      <Grille>
        <Skeleton className="h-[112px] w-full rounded-bloc" />
        <Skeleton className="h-[112px] w-full rounded-bloc" />
        <Skeleton className="h-[112px] w-full rounded-bloc" />
      </Grille>
    </div>
  );
}
