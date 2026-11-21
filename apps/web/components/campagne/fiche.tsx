import Link from 'next/link';
import {
  dateEnLettres,
  LIBELLES_DU_PERSONNEL,
  periodeDEvaluationEnLettres,
  type AgentDeLaCampagne,
  type AgentACommenter,
  type AutoDeLAgent,
  type PersonneDeLaCampagne,
  type EtatDeLaTransmission,
  type EtatDeLEvaluation,
  type EtatDesCommentaires,
  type PeriodeDeLaCampagne,
  type RenvoiDeLEvaluation,
} from '@teranga/contracts';
import { Card, CardInteractive, classesDeBouton, cn, type BadgeTone } from '@teranga/ui';
import { ACCUEIL_DE_LA_CAMPAGNE, AUTO_EVALUATION, MON_EVALUATION } from '../../lib/campagne';
import { Courriel } from '../courriel';
import { EnTete, Repere } from '../fiche';
import { Icon, type IconName } from '../icons';
import { Sceau } from '../sceau';

/* ────────────────────────────────────────────────────────────────
   Les pièces de la campagne d'évaluation annuelle (ADR-0211, ADR-0214,
   ADR-0216, ADR-0217), communes à ses pages : l'en-tête qui situe la
   personne, comme celui de son dossier ; les boutons qui ouvrent son
   auto-évaluation et son évaluation à valider ; la carte d'une étape,
   l'auto-évaluation ou l'évaluation du N+1, avec ce qui dit où elle en est ;
   le retour à l'accueil.
   ──────────────────────────────────────────────────────────────── */

/**
 * L'en-tête d'un agent, comme celui de son dossier : le nom, puis le poste ;
 * en repères, ce qui situe l'agent. Le département et le service
 * n'apparaissent que s'il y en a. Le N+1 ne manque qu'au sommet de
 * l'organigramme, hors de la campagne. À droite du nom, le geste de la page.
 */
export function IdentiteDeLaCampagne({
  agent: a,
  action,
}: {
  agent: AgentDeLaCampagne;
  action?: React.ReactNode;
}) {
  const n1 = a.evaluateur;
  // Avec un département ou un service, la direction s'abrège, comme sur la
  // fiche du dossier : « DSID » tient sur une ligne où le nom complet en
  // prenait trois, et reste en infobulle. Sans eux, elle s'écrit en entier,
  // sur autant de lignes qu'il faut (ADR-0224).
  const abregee = Boolean(a.departement || a.service);
  const reperes = [
    <Repere
      key="direction"
      label="Direction"
      valeur={abregee ? (a.directionAbregee ?? a.direction) : (a.direction ?? a.directionAbregee)}
      titre={abregee ? (a.direction ?? undefined) : undefined}
      entier={!abregee}
    />,
    a.departement ? <Repere key="departement" label="Département" valeur={a.departement} /> : null,
    a.service ? <Repere key="service" label="Service" valeur={a.service} /> : null,
    // Sans département ni service, l'adresse professionnelle prend leur place.
    abregee ? null : (
      <Repere
        key="email"
        label="Email professionnel"
        titre={a.email ?? undefined}
        valeur={a.email ? <Courriel adresse={a.email} /> : null}
      />
    ),
    // Le N+1, nommé « Supérieur hiérarchique », sans son poste (ADR-0224).
    n1 || a.auto ? (
      <Repere
        key="n1"
        label={superieurHierarchique(n1)}
        valeur={n1 ? `${n1.prenom} ${n1.nom}` : null}
      />
    ) : null,
    // En toutes lettres, comme sur la fiche : « Cadre » ou « Non-cadre » (ADR-0223).
    <Repere
      key="statut"
      label="Statut"
      valeur={a.personnel ? LIBELLES_DU_PERSONNEL[a.personnel] : null}
    />,
  ].filter(Boolean);
  return (
    <EnTete
      titre={`${a.prenom} ${a.nom}`}
      // Sous le nom, le poste seul, sans le matricule (ADR-0225).
      sousTitre={a.poste ?? undefined}
      action={action}
      colonnes={reperes.length as 2 | 3 | 4 | 5}
      reperes={<>{reperes}</>}
    />
  );
}

/** Le bouton qui ouvre son auto-évaluation, en haut à droite de sa fiche. */
export function BoutonMAutoEvaluer() {
  return (
    <Link href={AUTO_EVALUATION} className={classesDeBouton('primary', 'md')}>
      <Icon name="edit" size={15} />
      M’auto-évaluer
    </Link>
  );
}

/** Le bouton qui ouvre son évaluation à valider, à la place du précédent (ADR-0217). */
export function BoutonValiderMonEvaluation() {
  return (
    <Link href={MON_EVALUATION} className={classesDeBouton('primary', 'md')}>
      <Icon name="task_alt" size={15} />
      Valider mon évaluation
    </Link>
  );
}

/**
 * La coche bleue d'une étape faite : le sceau de la plateforme. Ce qu'elle
 * dit, avec sa date, se lit en infobulle et par les lecteurs d'écran.
 */
function Coche({ texte }: { texte: string }) {
  return (
    <span role="img" aria-label={texte} title={texte} className="inline-flex">
      <Sceau actif />
    </span>
  );
}

/** La coche bleue d'une auto-évaluation faite. */
export function AutoFaite({ le }: { le: string | null }) {
  return (
    <Coche
      texte={le ? `Auto-évaluation transmise le ${dateEnLettres(le)}` : 'Auto-évaluation transmise'}
    />
  );
}

/** La coche bleue d'une évaluation validée par l'agent (ADR-0217). */
export function EvaluationValidee({ le }: { le: string | null }) {
  return <Coche texte={le ? `Évaluation validée le ${dateEnLettres(le)}` : 'Évaluation validée'} />;
}

/**
 * « Supérieur hiérarchique », accordé au sexe inscrit au dossier du N+1 ;
 * sans sexe inscrit, à l'écriture inclusive, comme les libellés de la
 * situation familiale du dossier (« Veuf·ve »). Le prénom n'en dit rien.
 */
export function superieurHierarchique(n1: Pick<PersonneDeLaCampagne, 'genre'> | null): string {
  return n1?.genre === 'female'
    ? 'Supérieure hiérarchique'
    : n1?.genre === 'male'
      ? 'Supérieur hiérarchique'
      : 'Supérieur·e hiérarchique';
}

/** Où en est une étape, en un badge. */
export interface Statut {
  libelle: string;
  ton: BadgeTone;
}

/** « 18 déc. » : le jour d'une transmission, court, pour un badge. */
export const jourCourt = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

/** L'auto-évaluation d'un agent, vue par son évaluateur. */
export function statutDeLAgent(auto: AutoDeLAgent): Statut {
  if (auto.etat === 'transmise') {
    return {
      libelle: auto.transmiseLe ? `Faite le ${jourCourt(auto.transmiseLe)}` : 'Faite',
      ton: 'vert',
    };
  }
  return auto.etat === 'en_cours'
    ? { libelle: 'En cours', ton: 'bleu' }
    : { libelle: 'Non commencée', ton: 'gris' };
}

/**
 * L'évaluation d'un agent par son N+1, sur sa carte d'équipe, une fois
 * l'auto-évaluation faite : en orange, ce qui attend le N+1, jusqu'à la
 * transmission de la fiche à la DCH ; en vert, la fin du parcours, la fiche
 * transmise (ADR-0221).
 */
export function statutDeLEvaluation(a: {
  evaluation: EtatDeLEvaluation;
  dch: EtatDeLaTransmission;
}): Statut {
  if (a.dch === 'transmise') return { libelle: 'Transmise à la DCH', ton: 'vert' };
  if (a.dch === 'a_transmettre') return { libelle: 'À transmettre à la DCH', ton: 'orange' };
  switch (a.evaluation) {
    case 'validee':
      // Validée par l'agent, la fiche n'attend plus que les commentaires du N+2.
      return { libelle: 'Chez le N+2', ton: 'teal' };
    case 'transmise':
      return { libelle: 'Transmise à l’agent', ton: 'teal' };
    case 'renvoyee':
      return { libelle: 'Renvoyée par l’agent', ton: 'orange' };
    case 'en_cours':
      return { libelle: 'Évaluation en cours', ton: 'bleu' };
    case 'a_faire':
      return { libelle: 'À évaluer', ton: 'orange' };
  }
}

/** L'évaluation du N+1, sur sa carte, à la page de l'agent : rien tant qu'elle n'est pas commencée. */
export function statutDeMonEvaluation(
  v: { etatDeLEvaluation: EtatDeLEvaluation } & {
    evaluationTransmiseLe: string | null;
    valideeLe: string | null;
    renvoi: { le: string } | null;
  },
): Statut | null {
  const le = (iso: string | null | undefined) => (iso ? ` le ${jourCourt(iso)}` : '');
  switch (v.etatDeLEvaluation) {
    case 'validee':
      return { libelle: `Validée${le(v.valideeLe)}`, ton: 'vert' };
    case 'transmise':
      return { libelle: `Transmise${le(v.evaluationTransmiseLe)}`, ton: 'teal' };
    case 'renvoyee':
      return { libelle: `Renvoyée${le(v.renvoi?.le)}`, ton: 'orange' };
    case 'en_cours':
      return { libelle: 'En cours', ton: 'bleu' };
    case 'a_faire':
      return null;
  }
}

/**
 * Les commentaires du N+2, sur leur carte, à la page de l'agent : chez le N+1
 * qui les attend, puis reçus, ou la fiche reprise au N+2 ; chez le N+2 qui
 * les écrit, en cours, puis transmis. Rien avant la validation de l'agent.
 */
export function statutDesCommentaires(
  etat: EtatDesCommentaires | null,
  le: string | null,
  vu: 'n1' | 'n2',
): Statut | null {
  const jour = le ? ` le ${jourCourt(le)}` : '';
  switch (etat) {
    case 'transmis':
      return { libelle: `${vu === 'n1' ? 'Reçus' : 'Transmis'}${jour}`, ton: 'vert' };
    case 'reprise':
      return { libelle: vu === 'n1' ? `Reprise${jour}` : 'Reprise par le N+1', ton: 'gris' };
    case 'en_cours':
      return vu === 'n1'
        ? { libelle: 'Chez le N+2', ton: 'teal' }
        : { libelle: 'En cours', ton: 'bleu' };
    case 'a_commenter':
      return vu === 'n1' ? { libelle: 'Chez le N+2', ton: 'teal' } : null;
    default:
      return null;
  }
}

/**
 * Un agent dont la personne connectée est le N+2, sur sa carte : une fois
 * sa fiche validée, ce qui attend le N+2, en orange ; avant, l'étape où en
 * est sa fiche.
 */
export function statutPourLeN2(a: AgentACommenter): Statut {
  switch (a.commentaires) {
    case 'transmis':
      return { libelle: 'Commentaires transmis', ton: 'vert' };
    case 'reprise':
      return { libelle: 'Reprise par le N+1', ton: 'gris' };
    case 'en_cours':
      return { libelle: 'Commentaires en cours', ton: 'bleu' };
    case 'a_commenter':
      return { libelle: 'À commenter', ton: 'orange' };
    case 'en_attente':
      if (a.auto.etat !== 'transmise')
        return { libelle: 'Auto-évaluation en attente', ton: 'gris' };
      return a.evaluation === 'transmise'
        ? { libelle: 'Chez l’agent', ton: 'teal' }
        : { libelle: 'Chez le N+1', ton: 'bleu' };
  }
}

/** « Du 16 novembre au 20 décembre 2026 » : la période de l'auto-évaluation. */
export function periodeDeLAuto(periode: PeriodeDeLaCampagne | null): string {
  if (!periode) return 'Période non fixée';
  const texte = periodeDEvaluationEnLettres({ du: periode.du, au: periode.autoAu ?? periode.au });
  return texte.charAt(0).toLocaleUpperCase('fr') + texte.slice(1);
}

/** « Jusqu'au 31 décembre 2026 » : le temps de l'évaluation du N+1, qui suit l'auto-évaluation. */
export function periodeDeLEvaluation(periode: PeriodeDeLaCampagne | null): string {
  return periode ? `Jusqu’au ${dateEnLettres(periode.au)}` : 'Période non fixée';
}

/**
 * Une étape de la campagne, en une carte : l'auto-évaluation, l'évaluation
 * du N+1. Son titre, et à côté ce qui dit où elle en est ; puis sa période,
 * ou le jour qui compte. Avec `href`, la carte s'ouvre sur l'étape.
 */
export function CarteDEtape({
  icone,
  titre,
  marque,
  periode,
  href,
}: {
  icone: IconName;
  titre: string;
  marque?: React.ReactNode;
  periode: string;
  href?: string;
}) {
  const contenu = (
    <div className="flex items-center gap-4 p-5">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-bloc bg-primary-soft text-primary">
        <Icon name={icone} size={22} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <h2 className="text-[15px] leading-tight font-bold text-ink-strong">{titre}</h2>
          {marque}
        </div>
        <p className="mt-1.5 text-[12.5px] leading-tight text-ink-muted">{periode}</p>
      </div>
      {href ? (
        <Icon
          name="chevron_right"
          size={18}
          className="shrink-0 text-ink-muted/50 transition-transform duration-200 group-hover:translate-x-0.5"
        />
      ) : null}
    </div>
  );
  return href ? (
    <Link
      href={href}
      className="group mb-4 block rounded-bloc focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
    >
      <CardInteractive>{contenu}</CardInteractive>
    </Link>
  ) : (
    <Card className="mb-4">{contenu}</Card>
  );
}

/**
 * Le mot de l'agent qui renvoie son évaluation au N+1 (ADR-0217) : qui le
 * renvoie, à qui, le jour, puis le mot, tel qu'il est écrit.
 */
export function MotDeRenvoi({
  titre,
  renvoi,
}: {
  titre: React.ReactNode;
  renvoi: RenvoiDeLEvaluation;
}) {
  return (
    <Card className="flex items-start gap-4 p-5">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-bloc bg-accent-soft text-accent-text">
        <Icon name="replay" size={22} />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-[15px] leading-tight font-bold text-ink-strong">{titre}</h2>
        <p className="mt-1.5 text-[12.5px] leading-tight text-ink-muted">
          Le {dateEnLettres(renvoi.le)}
        </p>
        <blockquote className="mt-3.5 border-l-2 border-accent/60 pl-3.5 text-[13.5px] leading-relaxed break-words whitespace-pre-line text-ink-strong">
          {renvoi.mot}
        </blockquote>
      </div>
    </Card>
  );
}

/** Les étapes d'une fiche, côte à côte sur un grand écran, l'une sous l'autre ailleurs. */
export function Etapes({ nombre, children }: { nombre: number; children: React.ReactNode }) {
  // Quatre étapes tiennent mieux en deux rangs de deux qu'en un rang de quatre.
  return (
    <div
      className={cn('grid grid-cols-1 gap-x-4', nombre === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-2')}
    >
      {children}
    </div>
  );
}

/** Le retour à l'accueil de la campagne, au-dessus de la page, ou à la page d'où l'on vient. */
export function RetourALAccueil({
  libelle,
  href = ACCUEIL_DE_LA_CAMPAGNE,
}: {
  libelle: string;
  href?: string;
}) {
  return (
    <Link
      href={href}
      className="-ml-1.5 inline-flex items-center gap-0.5 self-start rounded-controle py-1 pr-2 text-[12.5px] font-semibold text-ink-muted transition-colors duration-200 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
    >
      <Icon name="chevron_backward" size={18} />
      {libelle}
    </Link>
  );
}
