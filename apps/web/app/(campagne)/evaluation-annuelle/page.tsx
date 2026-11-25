'use client';

import Link from 'next/link';
import {
  dateEnLettres,
  LIBELLES_DU_PERSONNEL,
  periodeDEvaluationEnLettres,
  type AgentACommenter,
  type AgentAObjectifs,
  type AgentDeLEquipe,
  type ObjectifsDeLAccueil,
  type ObjectifsTransmis,
  type PeriodeDeLaCampagne,
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
  jourCourt,
  statutDeLAgent,
} from '../../../components/campagne/fiche';
import { TableauDesObjectifs } from '../../../components/campagne/objectifs';
import { CarteDeLaPeriode } from '../../../components/campagne/periode';
import { Icon } from '../../../components/icons';
import { ApiError } from '../../../lib/api';
import {
  ACCUEIL_DE_LA_CAMPAGNE,
  ADMINISTRATION_DE_LA_CAMPAGNE,
  ficheDuN2,
  objectifsDeLAgent,
  useAccueilDeLaCampagne,
} from '../../../lib/campagne';

/* ────────────────────────────────────────────────────────────────
   L'accueil de la campagne d'évaluation annuelle (ADR-0211), à la charte
   de l'APIX (ADR-0227).

   En tête, le bandeau de la personne, sur le bleu de la charte : ses
   initiales, son nom et son poste ; à droite, le bouton « M’auto-évaluer »
   tant que l'auto-évaluation est ouverte (ADR-0214), « Continuer mon
   auto-évaluation » une fois commencée (ADR-0280), puis « Valider mon
   évaluation » quand le N+1 l'a transmise (ADR-0217). Un filet orange, bien
   droit, le ferme (ADR-0228) ; dessous, ses repères, comme sur la fiche de
   son dossier : direction, département, service, supérieur hiérarchique,
   statut (ADR-0224).
   Pour un compte d'administration, la tuile de l'administration juste
   dessous (ADR-0222) ; le suivi des évaluations, lui, s'ouvre depuis la
   barre du haut (ADR-0256).
   Puis des sections titrées en Anton : la période d'évaluation annuelle et
   ses deux temps, numérotés, chacun avec sa période, ce qu'il demande, et
   la coche bleue une fois fait (ADR-0220) ; si la personne évalue des
   agents, son équipe, en deux groupes, une carte par agent, comme celles
   des événements de la plateforme de l'APIX (ADR-0234). Chaque carte
   ouvre la page de l'agent : son évaluation par le N+1 une fois
   l'auto-évaluation faite (ADR-0216), son en-tête et ses étapes seulement
   avant (ADR-0257). Ni point ni fiche sur ces cartes : le groupe dit si
   l'auto-évaluation est faite (ADR-0250), et la carte, sa date, à la place
   du statut (ADR-0257). Enfin, pour le
   N+2 d'agents, « Fiches transmises pour commentaire » (ADR-0286, ADR-0287) :
   les fiches que le N+1 a envoyées au N+2 avec l'évaluation, qui s'ouvrent
   pour les commentaires du N+2 (ADR-0218, ADR-0278). Tant qu'aucune n'est
   arrivée chez le N+2, pas de section (ADR-0255).
   Une fois la fixation des objectifs ouverte (ADR-0274), ses sections
   passent devant celles de l'évaluation : « Mes objectifs », ceux que le
   N+1 a transmis, en lecture ; puis, pour qui a une équipe dans
   l'organigramme, une carte par agent, qui ouvre la page où le N+1 fixe
   ses objectifs. Avant, rien ne les annonce.
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

  if (!v.moi) {
    // Un compte sans dossier d'agent, l'administration : la campagne, ses
    // pages ; le suivi des évaluations s'ouvre depuis la barre (ADR-0256).
    if (v.administration || v.dch) {
      return (
        <div className="flex flex-col gap-8 sm:gap-10">
          <Bloc rang={0}>
            <BandeauDeLaCampagne titre={`Évaluation annuelle ${v.annee}`} periode={v.periode} />
          </Bloc>
          {v.administration ? (
            <Bloc rang={1}>
              <Administration periode={v.periode} />
            </Bloc>
          ) : null}
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
  // puis, l'évaluation du N+1 arrivée, celui qui l'ouvre pour la valider, tant
  // que la campagne n'est pas terminée (ADR-0273).
  const aFaire = auto !== null && !transmise && v.phase === 'auto_evaluation';
  const action = aFaire ? (
    <BoutonMAutoEvaluer commencee={auto.etat === 'en_cours'} />
  ) : recue?.etat === 'a_valider' && v.phase !== 'terminee' ? (
    <BoutonValiderMonEvaluation />
  ) : null;
  const objectifs = v.objectifs;
  let rang = 0;
  return (
    <div className="flex flex-col gap-8 sm:gap-10">
      <Bloc rang={rang++}>
        <BandeauDeLAgent agent={v.moi} action={action} />
      </Bloc>
      {v.administration ? (
        <Bloc rang={rang++}>
          <Administration periode={v.periode} />
        </Bloc>
      ) : null}
      {objectifs?.miens ? (
        <Bloc rang={rang++}>
          <MesObjectifs objectifs={objectifs} transmis={objectifs.miens.transmis} />
        </Bloc>
      ) : null}
      {objectifs && objectifs.equipe.length > 0 ? (
        <Bloc rang={rang++}>
          <ObjectifsDeLEquipe objectifs={objectifs} />
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
 * La tuile de l'administration de la campagne, avec ses dates, pour un
 * compte d'administration (ADR-0222). Le suivi des évaluations, lui, n'a
 * plus de tuile : il s'ouvre depuis la barre du haut (ADR-0256).
 */
function Administration({ periode }: { periode: PeriodeDeLaCampagne | null }) {
  return (
    <nav aria-label="Pilotage de la campagne">
      <TuileDePilotage
        href={ADMINISTRATION_DE_LA_CAMPAGNE}
        icone="settings"
        titre="Administration de la campagne"
        texte={periodeEnBref(periode)}
      />
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
  // Chaque carte ouvre la page de l'agent, l'auto-évaluation faite ou non
  // (ADR-0257). Ni point ni fiche sur la carte (ADR-0250) : le titre du
  // groupe dit où en est l'auto-évaluation, son point de couleur devant
  // (ADR-0253). Faite, la carte en dit la date, à la place du statut.
  const carte = (a: AgentDeLEquipe): CarteDUnAgent => ({
    agent: a,
    reperes: [
      a.auto.etat === 'transmise'
        ? { libelle: 'Auto-évaluation', valeur: statutDeLAgent(a.auto).libelle }
        : {
            libelle: 'Statut',
            valeur: a.personnel ? LIBELLES_DU_PERSONNEL[a.personnel] : null,
          },
    ],
    href: `${ACCUEIL_DE_LA_CAMPAGNE}/equipe/${a.employeeId}`,
  });
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
 * Les fiches arrivées chez le N+2 : celles que le N+1 a envoyées au N+2 avec
 * l'évaluation, rangées par N+1, sans groupe (ADR-0255, ADR-0278). Le titre
 * suit leur nombre : « Fiche transmise pour commentaire », puis « Fiches
 * transmises… » (ADR-0286, ADR-0287). Chaque carte dit le N+1 de l'agent
 * (ADR-0218), dans un repère comme l'adresse ; où en est la fiche se lit
 * sur sa page. Une fiche reprise par le N+1 s'ouvre toujours, en lecture
 * (ADR-0278).
 */
function ACommenter({ agents }: { agents: AgentACommenter[] }) {
  const carte = (a: AgentACommenter): CarteDUnAgent => ({
    agent: a,
    reperes: [{ libelle: 'N+1', valeur: `${a.n1.prenom} ${a.n1.nom}` }],
    href: a.commentaires === 'en_attente' ? undefined : ficheDuN2(a.employeeId),
  });
  return (
    <SectionDAgents
      id="fiches-a-commenter"
      titre={
        agents.length > 1
          ? 'Fiches transmises pour commentaire'
          : 'Fiche transmise pour commentaire'
      }
      groupes={[{ cartes: agents.map(carte) }]}
    />
  );
}

/**
 * Ses objectifs de l'année, une fois leur fixation ouverte (ADR-0274), tels
 * que son N+1 les a transmis, en lecture, avec le jour de leur
 * transmission ; avant, une ligne le dit.
 */
function MesObjectifs({
  objectifs: o,
  transmis,
}: {
  objectifs: ObjectifsDeLAccueil;
  transmis: ObjectifsTransmis | null;
}) {
  const par = transmis?.par ? ` par ${transmis.par.prenom} ${transmis.par.nom}` : '';
  return (
    <section aria-labelledby="mes-objectifs" className="flex flex-col gap-4">
      <TitreDeSection
        id="mes-objectifs"
        droite={
          transmis ? (
            <span className="text-[12px] font-semibold text-ink-muted">
              Transmis{par} le {dateEnLettres(transmis.le)}
            </span>
          ) : undefined
        }
      >
        Mes objectifs {o.annee}
      </TitreDeSection>
      <Card>
        {transmis ? (
          <TableauDesObjectifs annee={o.annee} objectifs={transmis.objectifs} />
        ) : (
          <p className="px-5 py-5 text-[13px] text-ink-muted">
            {o.phase === 'ouverte'
              ? 'Vos objectifs ne vous ont pas encore été transmis.'
              : 'Aucun objectif ne vous a été transmis.'}
          </p>
        )}
      </Card>
    </section>
  );
}

/** Où en sont les objectifs d'un agent, sur sa carte. */
function objectifsEnBref(a: AgentAObjectifs): string {
  switch (a.etat) {
    case 'transmis':
      return a.transmisLe ? `Transmis le ${jourCourt(a.transmisLe)}` : 'Transmis';
    case 'en_cours':
      return 'En cours';
    case 'a_fixer':
      return 'À fixer';
  }
}

/**
 * Son équipe dans l'organigramme, pour la fixation des objectifs (ADR-0274) :
 * d'abord les agents dont les objectifs restent à transmettre, puis les
 * agents qui les ont reçus, comme les deux groupes de « Mon équipe ». Chaque
 * carte ouvre la page où le N+1 fixe les objectifs de l'agent.
 */
function ObjectifsDeLEquipe({ objectifs: o }: { objectifs: ObjectifsDeLAccueil }) {
  const carte = (a: AgentAObjectifs): CarteDUnAgent => ({
    agent: a,
    reperes: [{ libelle: 'Objectifs', valeur: objectifsEnBref(a) }],
    href: objectifsDeLAgent(a.employeeId),
  });
  return (
    <SectionDAgents
      id="objectifs-de-mon-equipe"
      titre={`Objectifs ${o.annee} de mon équipe`}
      groupes={[
        {
          titre: o.phase === 'ouverte' ? 'Objectifs à fixer' : 'Objectifs non transmis',
          point: 'non_faite',
          cartes: o.equipe.filter((a) => a.etat !== 'transmis').map(carte),
        },
        {
          titre: 'Objectifs transmis',
          point: 'faite',
          cartes: o.equipe.filter((a) => a.etat === 'transmis').map(carte),
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

/** Un agent sur sa carte : ses repères, et la page qu'elle ouvre s'il y a lieu. */
interface CarteDUnAgent {
  agent: Pick<AgentDeLEquipe, 'employeeId' | 'prenom' | 'nom' | 'poste' | 'email'>;
  /**
   * Les repères qui suivent l'adresse, deux par ligne. Dans « Mon équipe »,
   * l'auto-évaluation faite et sa date, sinon le statut, cadre ou non cadre,
   * même inconnu (ADR-0235, ADR-0257). Pour le N+2, le N+1 de l'agent, puis
   * où en est la fiche (ADR-0255). Pour les objectifs, où ils en sont
   * (ADR-0274).
   */
  reperes: { libelle: string; valeur: string | null }[];
  href?: string;
}

/**
 * Une section d'agents, sous son titre en Anton et leur nombre, en groupes
 * l'un sous l'autre, séparés d'un filet. Un groupe vide ne s'affiche pas ;
 * un groupe sans titre, ses cartes seules.
 * Dans « Mon équipe », le titre d'un groupe porte un point devant lui : vert,
 * auto-évaluation faite ; rouge, non faite (ADR-0253). De même pour les
 * objectifs : vert, transmis ; rouge, pas encore (ADR-0274). Les cartes,
 * elles, n'en ont pas (ADR-0250).
 */
function SectionDAgents({
  id,
  titre,
  groupes,
}: {
  id: string;
  titre: string;
  groupes: readonly {
    titre?: string;
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
          key={g.titre ?? i}
          className={cn('flex flex-col gap-3', i > 0 && 'border-t border-line-soft pt-5')}
        >
          {g.titre ? (
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
          ) : null}
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
function CarteAgent({ carte: { agent: a, reperes, href } }: { carte: CarteDUnAgent }) {
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
      </div>
      {/* L'adresse, puis les autres repères, deux par ligne, comme la date et
          le lieu d'un événement (ADR-0235) : dans « Mon équipe »,
          l'auto-évaluation faite ou le statut (ADR-0257) ; pour le N+2, le
          N+1, puis la fiche (ADR-0255). */}
      <dl
        className={cn(
          'mt-auto grid gap-x-5 gap-y-3 border-t border-line-soft pt-3.5',
          reperes.length > 0 && 'grid-cols-2',
        )}
      >
        <RepereDeLaCarte libelle="Email professionnel" valeur={a.email} surUneLigne />
        {reperes.map((r) => (
          <RepereDeLaCarte key={r.libelle} libelle={r.libelle} valeur={r.valeur} />
        ))}
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
