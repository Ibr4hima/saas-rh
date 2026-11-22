'use client';

import Link from 'next/link';
import {
  LIBELLES_DU_PERSONNEL,
  periodeDEvaluationEnLettres,
  type AccueilDeLaCampagne,
  type AgentACommenter,
  type AgentDeLEquipe,
  type PeriodeDeLaCampagne,
  type PersonnelDeLaFiche,
} from '@teranga/contracts';
import { Card, cn, EmptyState, Skeleton } from '@teranga/ui';
import {
  BandeauDeLAgent,
  BandeauDeLaCampagne,
  TitreDeSection,
  TuileDePilotage,
} from '../../../components/campagne/charte';
import {
  BoutonMAutoEvaluer,
  BoutonValiderMonEvaluation,
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
   évaluation » quand le N+1 l'a transmise (ADR-0217). Un filet orange, bien
   droit, le ferme (ADR-0228) ; dessous, ses repères, comme sur la fiche de
   son dossier : direction, département, service, supérieur hiérarchique,
   statut (ADR-0224).
   Pour qui pilote la campagne, des tuiles juste dessous : le suivi de la
   DCH, avec l'habilitation « Tableau de bord » (ADR-0221), et
   l'administration, pour un compte d'administration (ADR-0222).
   Puis des sections titrées en Anton : la période d'évaluation annuelle et
   ses deux temps, numérotés, chacun avec sa période, ce qu'il demande, et
   la coche bleue une fois fait (ADR-0220) ; si la personne évalue des
   agents, son équipe, en deux groupes, une carte par agent, comme celles
   des événements de la plateforme de l'APIX (ADR-0234). Une
   auto-évaluation faite rend la carte cliquable : le N+1 ouvre alors
   l'évaluation de l'agent (ADR-0216). Ni point ni fiche sur ces cartes :
   le groupe dit si l'auto-évaluation est faite (ADR-0250). Enfin, si la
   personne est le N+2 d'agents, les équipes de ses N+1 : une fiche validée
   par l'agent s'ouvre pour ses commentaires (ADR-0218).
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
 * autres. Chaque groupe prend toute la largeur, trois cartes par ligne sur
 * un grand écran. Un seul groupe quand tous les agents sont dans le même cas.
 */
function Equipe({ equipe }: { equipe: AgentDeLEquipe[] }) {
  // L'auto-évaluation faite, la carte ouvre l'évaluation de l'agent. Ni point
  // ni fiche : le groupe dit où en est l'auto-évaluation (ADR-0250).
  const carte = (a: AgentDeLEquipe): CarteDUnAgent => ({
    agent: a,
    statut: null,
    personnel: a.personnel,
    href:
      a.auto.etat === 'transmise' ? `${ACCUEIL_DE_LA_CAMPAGNE}/equipe/${a.employeeId}` : undefined,
  });
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
          titre: 'Auto-évaluation non faite',
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

/** « Du 15 au 30 décembre 2026 », ou ce qui manque, sur la tuile de l'administration. */
function periodeEnBref(periode: PeriodeDeLaCampagne | null): string {
  if (!periode) return 'Dates de l’évaluation à fixer';
  const texte = periodeDEvaluationEnLettres(periode);
  return texte.charAt(0).toLocaleUpperCase('fr') + texte.slice(1);
}

/** Un agent sur sa carte : où en est sa fiche, et la page qu'elle ouvre s'il y a lieu. */
interface CarteDUnAgent {
  agent: Pick<AgentDeLEquipe, 'employeeId' | 'prenom' | 'nom' | 'poste' | 'email'>;
  /** Où en est sa fiche, pour le N+2 ; `null` : rien à dire, ou une carte de « Mon équipe ». */
  statut: Statut | null;
  /** Une ligne de plus, sous le poste : son N+1. */
  precision?: string;
  /**
   * Son statut, cadre ou non cadre, à droite de l'adresse : sur les cartes de
   * « Mon équipe » seulement, même inconnu (ADR-0235).
   */
  personnel?: PersonnelDeLaFiche | null;
  href?: string;
}

/**
 * Une section d'agents, sous son titre en Anton et leur nombre, en groupes
 * l'un sous l'autre, séparés d'un filet. Un groupe vide ne s'affiche pas.
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

/** Autant de cartes par ligne que la place en laisse, chacune de 20 rem au moins : trois sur un grand écran. */
function Grille({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(20rem,100%),1fr))] gap-3.5">
      {children}
    </div>
  );
}

/**
 * Un repère de la carte : le libellé en petites capitales, la valeur en gras
 * dessous, ou « Non renseigné ». `surUneLigne` : trop longue, la valeur
 * s'arrête sur « … », et le survol la donne en entier.
 */
function RepereDeLaCarte({
  libelle,
  valeur,
  surUneLigne = false,
}: {
  libelle: string;
  valeur: string | null;
  surUneLigne?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] leading-none font-extrabold tracking-[0.12em] text-ink-muted uppercase">
        {libelle}
      </dt>
      <dd
        title={surUneLigne ? (valeur ?? undefined) : undefined}
        className={cn(
          'mt-1.5 text-[12.5px] leading-snug font-bold text-ink-strong',
          surUneLigne && 'truncate',
          !valeur && 'font-medium text-ink-muted',
        )}
      >
        {valeur ?? 'Non renseigné'}
      </dd>
    </div>
  );
}

/**
 * Un agent, en une carte, comme celles des événements de la plateforme de
 * l'APIX (ADR-0234) : son nom en gras, son poste dessous, la précision s'il y
 * en a une. Sous un filet, ses repères : son email professionnel, son statut
 * à droite dans « Mon équipe » (ADR-0235) et, pour le N+2, où en est sa
 * fiche. Sans point de couleur (ADR-0250). Avec `href`, toute la carte
 * s'ouvre et se soulève au survol.
 */
function CarteAgent({
  carte: { agent: a, statut, precision, personnel, href },
}: {
  carte: CarteDUnAgent;
}) {
  const contenu = (
    <>
      <div className="min-w-0">
        <p className="truncate text-[15.5px] leading-[1.35] font-extrabold tracking-[-0.01em] text-ink-strong">
          {a.prenom} {a.nom}
        </p>
        {/* Le poste seul, sans le matricule, sur deux lignes au plus (ADR-0225). */}
        {a.poste ? (
          <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-ink-muted">{a.poste}</p>
        ) : null}
        {precision ? (
          <p className="mt-0.5 truncate text-[12.5px] leading-snug text-ink-muted">{precision}</p>
        ) : null}
      </div>
      {/* Dans « Mon équipe », l'adresse et le statut côte à côte, comme la date
          et le lieu d'un événement (ADR-0235). Pour le N+2, l'adresse et la
          fiche, côte à côte quand la carte est assez large. */}
      <dl
        className={cn(
          'mt-auto grid gap-x-5 gap-y-3 border-t border-line-soft pt-3.5',
          personnel !== undefined
            ? 'grid-cols-2'
            : statut && '@[20rem]:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]',
        )}
      >
        <RepereDeLaCarte libelle="Email professionnel" valeur={a.email} surUneLigne />
        {personnel !== undefined ? (
          <RepereDeLaCarte
            libelle="Statut"
            valeur={personnel ? LIBELLES_DU_PERSONNEL[personnel] : null}
          />
        ) : null}
        {statut ? <RepereDeLaCarte libelle="Fiche" valeur={statut.libelle} /> : null}
      </dl>
    </>
  );
  const forme =
    '@container flex h-full flex-col gap-3.5 rounded-bloc border border-card-line bg-surface px-5 pt-[18px] pb-4 text-left shadow-xs';
  return href ? (
    <Link
      href={href}
      className={cn(
        forme,
        'transition-[box-shadow,transform,border-color] duration-[180ms] hover:-translate-y-0.5 hover:border-card-line-hover hover:shadow-md focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none motion-reduce:transition-none motion-reduce:hover:translate-y-0',
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
        <Skeleton className="h-[140px] w-full rounded-bloc" />
        <Skeleton className="h-[140px] w-full rounded-bloc" />
        <Skeleton className="h-[140px] w-full rounded-bloc" />
      </Grille>
    </div>
  );
}
