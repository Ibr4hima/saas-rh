import Link from 'next/link';
import {
  dateEnLettres,
  LIBELLES_DU_PERSONNEL,
  periodeDEvaluationEnLettres,
  type AgentDeLaCampagne,
  type AgentACommenter,
  type AutoDeLAgent,
  type PersonneDeLaCampagne,
  type EtatDeLEvaluation,
  type EtatDesCommentaires,
  type PeriodeDeLaCampagne,
} from '@teranga/contracts';
import { Card, cn, type BadgeTone } from '@teranga/ui';
import { ACCUEIL_DE_LA_CAMPAGNE, AUTO_EVALUATION, MON_EVALUATION } from '../../lib/campagne';
import { sansLeType } from '../../lib/mots';
import { Courriel } from '../courriel';
import { Repere } from '../fiche';
import { Icon } from '../icons';
import { Sceau } from '../sceau';

/* ────────────────────────────────────────────────────────────────
   Les pièces de la campagne d'évaluation annuelle (ADR-0211, ADR-0214,
   ADR-0216, ADR-0217), communes à ses pages : les repères qui situent la
   personne, comme sur son dossier ; les boutons qui ouvrent son
   auto-évaluation et son évaluation à valider ; les étapes d'une fiche,
   numérotées, avec ce qui dit où chacune en est (ADR-0233) ; le retour à
   l'accueil.
   ──────────────────────────────────────────────────────────────── */

/**
 * Les repères d'un agent : sa direction, son département et son service
 * s'il y en a, sinon son adresse professionnelle, son supérieur
 * hiérarchique et son statut, sous le bandeau de l'agent, à l'accueil comme
 * sur les pages de ses fiches (ADR-0227, ADR-0233).
 */
export function reperesDeLAgent(a: AgentDeLaCampagne): React.ReactElement[] {
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
    // L'intitulé dit déjà « Département » ou « Service » : le nom ne le
    // répète pas (ADR-0264).
    a.departement ? (
      <Repere
        key="departement"
        label="Département"
        valeur={sansLeType(a.departement, 'Département')}
      />
    ) : null,
    a.service ? (
      <Repere key="service" label="Service" valeur={sansLeType(a.service, 'Service')} />
    ) : null,
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
  ];
  return reperes.filter((r): r is React.ReactElement => r !== null);
}

/**
 * Le geste du bandeau de l'accueil (ADR-0227) : un bouton blanc, le mot en
 * bleu de la charte, de jour comme de nuit, posé sur le bleu. Sur un
 * téléphone, il prend la largeur du bandeau.
 */
export const BOUTON_DU_BANDEAU =
  'inline-flex h-11 w-full items-center justify-center gap-2 rounded-controle bg-white px-5 text-[13.5px] font-bold whitespace-nowrap text-[#004f91] shadow-[0_10px_24px_-12px_rgb(0_0_0/0.55)] transition-[background-color,transform] duration-150 hover:bg-[#eaf3fd] active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:w-auto';

/** Le bouton qui ouvre son auto-évaluation, dans le bandeau de l'accueil. */
export function BoutonMAutoEvaluer() {
  return (
    <Link href={AUTO_EVALUATION} className={BOUTON_DU_BANDEAU}>
      <Icon name="edit" size={17} />
      M’auto-évaluer
    </Link>
  );
}

/** Le bouton qui ouvre son évaluation à valider, à la place du précédent (ADR-0217). */
export function BoutonValiderMonEvaluation() {
  return (
    <Link href={MON_EVALUATION} className={BOUTON_DU_BANDEAU}>
      <Icon name="task_alt" size={17} />
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

/**
 * « Monsieur Moussa Sarr » ou « Madame Awa Diop », selon le sexe inscrit au
 * dossier ; sans sexe inscrit, le nom seul (ADR-0248). Le prénom n'en dit
 * rien. La civilité ne reste pas seule en bout de ligne.
 */
export function nomAvecCivilite(p: Pick<PersonneDeLaCampagne, 'genre' | 'prenom' | 'nom'>): string {
  const civilite = p.genre === 'female' ? 'Madame' : p.genre === 'male' ? 'Monsieur' : null;
  const nom = `${p.prenom} ${p.nom}`.trim();
  return civilite ? `${civilite} ${nom}` : nom;
}

/** Où en est une étape, en un badge. */
export interface Statut {
  libelle: string;
  ton: BadgeTone;
}

/** « 18 déc. » : le jour d'une transmission, court, pour un badge. */
export const jourCourt = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

/**
 * L'auto-évaluation d'un agent, vue par son N+1 ou son N+2 : faite, en vert,
 * ou non faite, en rouge. Un brouillon commencé n'est pas une auto-évaluation
 * faite (ADR-0226).
 */
export function statutDeLAgent(auto: AutoDeLAgent): Statut {
  if (auto.etat !== 'transmise') return { libelle: 'Non faite', ton: 'rouge' };
  return {
    libelle: auto.transmiseLe ? `Faite le ${jourCourt(auto.transmiseLe)}` : 'Faite',
    ton: 'vert',
  };
}

/** L'évaluation du N+1, sur sa carte, à la page de l'agent : rien tant qu'elle n'est pas commencée. */
export function statutDeMonEvaluation(
  v: { etatDeLEvaluation: EtatDeLEvaluation } & {
    evaluationTransmiseLe: string | null;
    valideeLe: string | null;
  },
): Statut | null {
  const le = (iso: string | null | undefined) => (iso ? ` le ${jourCourt(iso)}` : '');
  switch (v.etatDeLEvaluation) {
    case 'validee':
      return { libelle: `Validée${le(v.valideeLe)}`, ton: 'vert' };
    case 'transmise':
      return { libelle: `Transmise${le(v.evaluationTransmiseLe)}`, ton: 'teal' };
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
 * Un agent dont la personne connectée est le N+2, sur sa carte : où en sont
 * les commentaires sur sa fiche, validée par l'agent ; « À commenter » en
 * orange. Une fiche pas encore validée n'arrive pas chez le N+2 (ADR-0255).
 */
export function statutPourLeN2(a: AgentACommenter): Statut | null {
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
      // Pas encore validée par l'agent : la fiche n'est pas chez le N+2 (ADR-0255).
      return null;
  }
}

/** « Du 16 novembre au 20 décembre 2026 » : la période de l'auto-évaluation. */
export function periodeDeLAuto(periode: PeriodeDeLaCampagne | null): string {
  if (!periode) return 'Période non fixée';
  const texte = periodeDEvaluationEnLettres({ du: periode.du, au: periode.autoAu ?? periode.au });
  return texte.charAt(0).toLocaleUpperCase('fr') + texte.slice(1);
}

/** Le lendemain d'un jour, AAAA-MM-JJ. */
function lendemain(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * « Du 21 au 30 décembre 2026 » : le temps de l'évaluation, du lendemain de
 * la fin de l'auto-évaluation à la fin de la période. Sans fin propre à
 * l'auto-évaluation, la période entière.
 */
export function periodeDeLEvaluationDuN1(periode: PeriodeDeLaCampagne | null): string {
  if (!periode) return 'Période non fixée';
  const du = periode.autoAu && periode.autoAu < periode.au ? lendemain(periode.autoAu) : periode.du;
  const texte = periodeDEvaluationEnLettres({ du, au: periode.au });
  return texte.charAt(0).toLocaleUpperCase('fr') + texte.slice(1);
}

/** « Jusqu'au 31 décembre 2026 » : le temps de l'évaluation du N+1, qui suit l'auto-évaluation. */
export function periodeDeLEvaluation(periode: PeriodeDeLaCampagne | null): string {
  return periode ? `Jusqu’au ${dateEnLettres(periode.au)}` : 'Période non fixée';
}

/**
 * Une étape de la fiche, dans la carte des étapes : son numéro en orange,
 * « 01 », « 02 »…, comme les temps de la période (ADR-0233) ; son titre ;
 * dessous, où elle en est, en bleu, sans pastille (ADR-0252) ; puis sa
 * période, ou qui la tient.
 */
export function CarteDEtape({
  titre,
  etat,
  periode,
}: {
  titre: string;
  /** « Faite le 22 nov. », « En cours »… ; rien tant que l'étape n'a pas commencé. */
  etat?: string | null;
  periode: string;
}) {
  return (
    <li className="flex items-start gap-4 bg-surface p-5 [counter-increment:etape]">
      <span
        aria-hidden
        className="w-11 shrink-0 font-titre text-[36px] leading-[0.9] text-accent before:content-[counter(etape,decimal-leading-zero)]"
      />
      <div className="min-w-0 pt-0.5">
        <h2 className="text-[15px] leading-tight font-bold text-ink-strong">{titre}</h2>
        {etat ? (
          <p className="mt-1.5 text-[13px] leading-tight font-semibold text-primary">{etat}</p>
        ) : null}
        <p className="mt-1.5 text-[12.5px] leading-tight text-ink-muted">{periode}</p>
      </div>
    </li>
  );
}

/**
 * Les étapes d'une fiche, dans une seule carte, séparées d'un filet :
 * côte à côte sur un grand écran, deux par deux ou l'une sous l'autre
 * ailleurs, sans case vide. Le numéro de chacune suit son rang.
 */
export function Etapes({ nombre, children }: { nombre: number; children: React.ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <ol
        className={cn(
          'grid grid-cols-1 gap-px bg-line-soft [counter-reset:etape]',
          nombre === 2 && 'sm:grid-cols-2',
          nombre === 3 && 'md:grid-cols-3',
          nombre >= 4 && 'sm:grid-cols-2 lg:grid-cols-4',
        )}
      >
        {children}
      </ol>
    </Card>
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
