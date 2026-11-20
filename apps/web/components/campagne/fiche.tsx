import Link from 'next/link';
import {
  dateEnLettres,
  periodeDEvaluationEnLettres,
  type AgentDeLaCampagne,
  type AutoDeLAgent,
  type EtatDeLEvaluation,
  type EvaluationRecue,
  type PeriodeDeLaCampagne,
  type PersonnelDeLaFiche,
  type RenvoiDeLEvaluation,
} from '@teranga/contracts';
import { Card, CardInteractive, classesDeBouton, type BadgeTone } from '@teranga/ui';
import { ACCUEIL_DE_LA_CAMPAGNE, AUTO_EVALUATION, MON_EVALUATION } from '../../lib/campagne';
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

/** Le statut, en un mot. */
const STATUTS: Record<PersonnelDeLaFiche, string> = { cadre: 'Cadre', non_cadre: 'NC' };

/**
 * L'en-tête d'un agent, comme celui de son dossier : le nom, puis le
 * matricule et le poste ; en repères, ce qui situe l'agent. Le département et le
 * service n'apparaissent que s'il y en a. Le N+1 ne manque qu'au sommet de
 * l'organigramme, qui n'est pas évalué. À droite du nom, le geste de la page.
 */
export function IdentiteDeLaCampagne({
  agent: a,
  action,
}: {
  agent: AgentDeLaCampagne;
  action?: React.ReactNode;
}) {
  const n1 = a.evaluateur;
  const reperes = [
    // L'abrégé, comme sur la fiche du dossier : « DSID » tient sur une ligne
    // où le nom complet en prenait trois. Le nom complet reste en infobulle.
    <Repere
      key="direction"
      label="Direction"
      valeur={a.directionAbregee ?? a.direction}
      titre={a.direction ?? undefined}
    />,
    a.departement ? <Repere key="departement" label="Département" valeur={a.departement} /> : null,
    a.service ? <Repere key="service" label="Service" valeur={a.service} /> : null,
    n1 || a.auto ? (
      <Repere key="n1" label="N+1" valeur={n1 ? `${n1.prenom} ${n1.nom}` : null}>
        {n1?.poste}
      </Repere>
    ) : null,
    <Repere key="statut" label="Statut" valeur={a.personnel ? STATUTS[a.personnel] : null} />,
  ].filter(Boolean);
  return (
    <EnTete
      titre={`${a.prenom} ${a.nom}`}
      sousTitre={
        <>
          <span className="font-mono tracking-tight">{a.matricule}</span>
          {a.poste ? <> · {a.poste}</> : null}
        </>
      }
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

/** Où en est une étape, en un badge. */
export interface Statut {
  libelle: string;
  ton: BadgeTone;
}

/** « 18 déc. » : le jour d'une transmission, court, pour un badge. */
const jourCourt = (iso: string) =>
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
 * l'auto-évaluation faite : en orange, ce qui attend le N+1 ; en vert, la
 * fin du parcours, l'évaluation validée par l'agent.
 */
export function statutDeLEvaluation(etat: EtatDeLEvaluation): Statut {
  switch (etat) {
    case 'validee':
      return { libelle: 'Validée par l’agent', ton: 'vert' };
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
 * Son évaluation par le N+1, sous le titre de sa carte, à l'accueil de
 * l'agent : jusqu'à quand le N+1 l'écrit, puis le jour où elle est arrivée,
 * renvoyée ou validée.
 */
export function ouEnEstMonEvaluation(
  recue: EvaluationRecue,
  periode: PeriodeDeLaCampagne | null,
): string {
  switch (recue.etat) {
    case 'validee':
      return recue.valideeLe ? `Validée le ${dateEnLettres(recue.valideeLe)}` : 'Validée';
    case 'a_valider':
      return recue.transmiseLe ? `Reçue le ${dateEnLettres(recue.transmiseLe)}` : 'Reçue';
    case 'renvoyee':
      return recue.renvoyeeLe
        ? `Renvoyée à votre N+1 le ${dateEnLettres(recue.renvoyeeLe)}`
        : 'Renvoyée à votre N+1';
    case 'en_attente':
      return periodeDeLEvaluation(periode);
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

/** Le retour à l'accueil de la campagne, au-dessus de la page. */
export function RetourALAccueil({ libelle }: { libelle: string }) {
  return (
    <Link
      href={ACCUEIL_DE_LA_CAMPAGNE}
      className="-ml-1.5 inline-flex items-center gap-0.5 self-start rounded-controle py-1 pr-2 text-[12.5px] font-semibold text-ink-muted transition-colors duration-200 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
    >
      <Icon name="chevron_backward" size={18} />
      {libelle}
    </Link>
  );
}
