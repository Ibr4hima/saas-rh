import {
  periodeDEvaluationEnLettres,
  type AgentDeLaCampagne,
  type AutoDeLAgent,
  type PeriodeDeLaCampagne,
  type PersonnelDeLaFiche,
  type PhaseDeLaCampagne,
} from '@teranga/contracts';
import { Badge, Card, type BadgeTone } from '@teranga/ui';
import { EnTete, Repere } from '../fiche';
import { Icon } from '../icons';

/* ────────────────────────────────────────────────────────────────
   Les pièces de la campagne d'évaluation annuelle (ADR-0211), communes à
   l'accueil et à la fiche d'un agent de l'équipe : l'en-tête qui situe la
   personne, comme celui de son dossier, et la carte de son auto-évaluation.
   ──────────────────────────────────────────────────────────────── */

/** Le statut, en un mot. */
const STATUTS: Record<PersonnelDeLaFiche, string> = { cadre: 'Cadre', non_cadre: 'NC' };

/**
 * L'en-tête d'un agent, comme celui de son dossier : le nom, puis le
 * matricule et le poste ; en repères, ce qui situe l'agent. Le département et le
 * service n'apparaissent que s'il y en a. Le N+1 ne manque qu'au sommet de
 * l'organigramme, qui n'est pas évalué.
 */
export function IdentiteDeLaCampagne({ agent: a }: { agent: AgentDeLaCampagne }) {
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
      colonnes={reperes.length as 2 | 3 | 4 | 5}
      reperes={<>{reperes}</>}
    />
  );
}

export interface StatutDeLAuto {
  libelle: string;
  ton: BadgeTone;
}

/** « 18 déc. » : le jour d'une transmission, court, pour un badge. */
const jourCourt = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

/** Sa propre auto-évaluation, selon le jour. */
export function statutDeMonAuto(auto: AutoDeLAgent, phase: PhaseDeLaCampagne): StatutDeLAuto {
  if (auto.etat === 'transmise') {
    return {
      libelle: auto.transmiseLe ? `Transmise le ${jourCourt(auto.transmiseLe)}` : 'Transmise',
      ton: 'vert',
    };
  }
  if (phase === 'non_fixee' || phase === 'a_venir') return { libelle: 'À venir', ton: 'gris' };
  if (phase === 'auto_evaluation') {
    return auto.etat === 'en_cours'
      ? { libelle: 'En cours', ton: 'bleu' }
      : { libelle: 'À faire', ton: 'orange' };
  }
  return { libelle: 'Non transmise', ton: 'rouge' };
}

/** L'auto-évaluation d'un agent, vue par son évaluateur. */
export function statutDeLAgent(auto: AutoDeLAgent): StatutDeLAuto {
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

/** « Du 16 novembre au 20 décembre 2026 » : la majuscule en tête de ligne. */
const enTete = (texte: string) => texte.charAt(0).toLocaleUpperCase('fr') + texte.slice(1);

/**
 * Une auto-évaluation, en une carte : son titre et où elle en est, puis la
 * période où elle se fait.
 */
export function CarteDeLAuto({
  titre,
  statut,
  periode,
}: {
  titre: string;
  statut: StatutDeLAuto;
  periode: PeriodeDeLaCampagne | null;
}) {
  return (
    <Card className="mb-4">
      <div className="flex items-center gap-4 p-5">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-bloc bg-primary-soft text-primary">
          <Icon name="rate_review" size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <h2 className="text-[15px] leading-tight font-bold text-ink-strong">{titre}</h2>
            <Badge tone={statut.ton}>{statut.libelle}</Badge>
          </div>
          <p className="mt-1.5 text-[12.5px] leading-tight text-ink-muted">
            {periode
              ? enTete(
                  periodeDEvaluationEnLettres({ du: periode.du, au: periode.autoAu ?? periode.au }),
                )
              : 'Période non fixée'}
          </p>
        </div>
      </div>
    </Card>
  );
}
