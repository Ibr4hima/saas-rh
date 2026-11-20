import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  autoEvaluationSchema,
  autoEvaluationVide,
  ceQuiManqueALAutoEvaluation,
  ceQuiManqueALEvaluationDuN1,
  competencesDe,
  evaluationDuN1Schema,
  evaluationDuN1Vide,
  objectifEvalueSchema,
  partieReserveeSchema,
  partieReserveeVide,
  personnelDeLaFiche,
  sansLignesVides,
  type AccueilDeLaCampagne,
  type AgentACommenter,
  type AgentDeLaCampagne,
  type AgentDeLEquipe,
  type AutoDeLAgent,
  type AutoEvaluation,
  type CommentairesDuN2,
  type EcritureDeLEvaluation,
  type EtatDeLEvaluation,
  type EtatDeMonEvaluation,
  type EtatDesCommentaires,
  type EvaluationDeLAgent,
  type EvaluationDuN1,
  type EvaluationRecue,
  type FichePourLeN2,
  type MonAutoEvaluation,
  type MonEvaluation,
  type ObjectifEvalue,
  type PartieReservee,
  type PeriodeDeLaCampagne,
  type PersonneDeLaCampagne,
  type PersonnelDeLaFiche,
  type PhaseDeLaCampagne,
  type RenvoiDeLEvaluation,
  type SessionUser,
} from '@teranga/contracts';
import { v7 as uuidv7 } from 'uuid';
import { problem } from '../../common/problem';
import { loadEnv } from '../../config/env';
import { TenantDb, type Tx } from '../../db/tenant-db';
import { evaluable } from '../evaluations/circuit';
import { unitesDe } from '../evaluations/unites';
import { directionDeLUnite } from '../people/chaine';

/* ────────────────────────────────────────────────────────────────
   La campagne d'évaluation annuelle (ADR-0211, ADR-0215).

   À l'accueil, la personne connectée lit sa fiche, comme celle de son
   dossier, l'état de son auto-évaluation, et les agents qu'évalue cette
   personne, avec l'état de chaque auto-évaluation. L'évaluateur d'un agent :
   le choix de l'administration pour la campagne, sinon le N+1 dans
   l'organigramme. Ce choix ne touche pas à l'organigramme.

   L'auto-évaluation s'écrit sur sa propre fiche seulement, pendant sa
   période, et se garde en brouillon jusqu'à sa transmission au N+1 : elle
   ne change plus ensuite. Le N+1 la lit une fois transmise, jamais avant.

   L'évaluation du N+1 s'écrit ensuite, par l'évaluateur de l'agent et par
   personne d'autre, pendant la période de l'année, en brouillon puis
   transmise à l'agent (ADR-0216). La partie réservée à la hiérarchie se
   garde à part : l'agent ne la lit jamais.

   L'agent lit l'évaluation transmise, puis la valide : elle ne change
   plus. En désaccord, l'agent la renvoie au N+1 avec un mot, tant que le
   N+1 peut encore la reprendre ; le N+1 la corrige et la transmet de
   nouveau (ADR-0217).

   Validée par l'agent, la fiche arrive chez le N+2, l'évaluateur du N+1 :
   le N+2 la lit en entier, partie réservée comprise, la commente s'il y a
   lieu, et transmet ses commentaires au N+1 (ADR-0218).
   ──────────────────────────────────────────────────────────────── */

/** L'évaluateur de la campagne, sur un agent `e` et sa fiche de l'année `f`. */
const EVALUATEUR = sql`COALESCE(f.evaluateur_employee_id, e.manager_employee_id)`;

/** L'état d'une auto-évaluation : transmise, commencée, ou encore à faire. */
const autoDe = (commencee: boolean, transmiseLe: string | null): AutoDeLAgent => ({
  etat: transmiseLe ? 'transmise' : commencee ? 'en_cours' : 'a_faire',
  transmiseLe,
});

@Injectable()
export class CampagneService {
  constructor(@Inject(TenantDb) private readonly db: TenantDb) {}

  /** Ce que l'accueil montre à la personne connectée. */
  async accueil(user: SessionUser): Promise<AccueilDeLaCampagne> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      const annee = await anneeDeLaCampagne(tx);
      const { periode, phase } = await periodeDe(tx, annee);
      const moi = await employeDuCompte(tx, user.userId);
      if (!moi) {
        return {
          annee,
          periode,
          phase,
          moi: null,
          equipe: [],
          monEvaluation: null,
          aCommenter: [],
        };
      }
      const fiche = await ficheDe(tx, moi, annee);
      return {
        annee,
        periode,
        phase,
        moi: fiche,
        equipe: await equipeDe(tx, moi, annee, fiche.evaluateur !== null),
        monEvaluation: fiche.auto ? evaluationRecue(await ficheDeLAnnee(tx, moi, annee)) : null,
        aCommenter: await aCommenterDe(tx, moi, annee),
      };
    });
  }

  /**
   * Un agent de l'équipe, ouvert par son évaluateur depuis sa carte. Hors de
   * l'équipe de la personne connectée, l'agent reste introuvable : la
   * réponse ne dit pas si ce dossier existe.
   */
  async agentDeLEquipe(user: SessionUser, employeeId: string): Promise<EvaluationDeLAgent> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, (tx) =>
      agentDans(tx, user, employeeId),
    );
  }

  /** Le brouillon de l'évaluation d'un agent de son équipe, gardé tel qu'il est. */
  async enregistrerEvaluation(
    user: SessionUser,
    employeeId: string,
    ecriture: EcritureDeLEvaluation,
  ): Promise<EvaluationDeLAgent> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      await ecrireEvaluation(tx, user, employeeId, ecriture, false);
      return agentDans(tx, user, employeeId);
    });
  }

  /**
   * L'évaluation, complète, transmise à l'agent : elle ne change plus.
   * Incomplète, elle reste en brouillon et la réponse dit ce qui manque.
   */
  async transmettreEvaluation(
    user: SessionUser,
    employeeId: string,
    ecriture: EcritureDeLEvaluation,
  ): Promise<EvaluationDeLAgent> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      await ecrireEvaluation(tx, user, employeeId, ecriture, true);
      return agentDans(tx, user, employeeId);
    });
  }

  /** La fiche d'un agent dont la personne connectée est le N+2, pour la commenter (ADR-0218). */
  async ficheDuN2(user: SessionUser, employeeId: string): Promise<FichePourLeN2> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, (tx) =>
      ficheDuN2Dans(tx, user, employeeId),
    );
  }

  /** Le brouillon des commentaires du N+2, gardé tel qu'il est. */
  async enregistrerCommentaires(
    user: SessionUser,
    employeeId: string,
    commentaires: string,
  ): Promise<FichePourLeN2> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      await ecrireCommentaires(tx, user, employeeId, commentaires, false);
      return ficheDuN2Dans(tx, user, employeeId);
    });
  }

  /** Les commentaires du N+2, transmis au N+1, avec ou sans un mot : ils ne changent plus. */
  async transmettreCommentaires(
    user: SessionUser,
    employeeId: string,
    commentaires: string,
  ): Promise<FichePourLeN2> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      await ecrireCommentaires(tx, user, employeeId, commentaires, true);
      return ficheDuN2Dans(tx, user, employeeId);
    });
  }

  /** Son évaluation par le N+1, pour la lire, puis la valider ou la renvoyer (ADR-0217). */
  async monEvaluation(user: SessionUser): Promise<MonEvaluation> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, (tx) =>
      monEvaluationDans(tx, user),
    );
  }

  /** L'agent valide son évaluation : elle ne change plus. */
  async validerMonEvaluation(user: SessionUser): Promise<MonEvaluation> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      await validerMonEvaluationDans(tx, user);
      return monEvaluationDans(tx, user);
    });
  }

  /** En désaccord, l'agent renvoie son évaluation au N+1, avec un mot. */
  async renvoyerMonEvaluation(user: SessionUser, mot: string): Promise<MonEvaluation> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      await renvoyerMonEvaluationDans(tx, user, mot);
      return monEvaluationDans(tx, user);
    });
  }

  /** Son auto-évaluation, pour son formulaire. */
  async monAuto(user: SessionUser): Promise<MonAutoEvaluation> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, (tx) =>
      monAutoDans(tx, user),
    );
  }

  /** Le brouillon de son auto-évaluation, gardé tel qu'il est. */
  async enregistrerMonAuto(user: SessionUser, auto: AutoEvaluation): Promise<MonAutoEvaluation> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      await ecrireMonAuto(tx, user, auto, false);
      return monAutoDans(tx, user);
    });
  }

  /**
   * Son auto-évaluation, complète, transmise au N+1 : elle ne change plus.
   * Incomplète, elle reste en brouillon et la réponse dit ce qui manque.
   */
  async transmettreMonAuto(user: SessionUser, auto: AutoEvaluation): Promise<MonAutoEvaluation> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      await ecrireMonAuto(tx, user, auto, true);
      return monAutoDans(tx, user);
    });
  }
}

/** L'évaluation du N+1 s'écrit du début à la fin de la période de l'année. */
const evaluationOuverte = (phase: PhaseDeLaCampagne) =>
  phase === 'auto_evaluation' || phase === 'evaluation';

/** Un agent de l'équipe de la personne connectée ; hors de son équipe, introuvable. */
async function agentDans(
  tx: Tx,
  user: SessionUser,
  employeeId: string,
): Promise<EvaluationDeLAgent> {
  const annee = await anneeDeLaCampagne(tx);
  const moi = await employeDuCompte(tx, user.userId);
  if (!moi || !(await dansLEquipe(tx, employeeId, moi, annee))) {
    problem(404, 'campagne.agent_hors_equipe', 'Agent introuvable dans votre équipe');
  }
  const { periode, phase } = await periodeDe(tx, annee);
  const agent = await ficheDe(tx, employeeId, annee);
  const annuelle = await ficheDeLAnnee(tx, employeeId, annee);
  const autoTransmise = agent.auto?.etat === 'transmise';
  const etatDeLEvaluation = etatSurLaFiche(annuelle);
  const n2 = await n2De(tx, employeeId, annee);
  return {
    annee,
    periode,
    phase,
    agent,
    objectifs: annuelle.objectifs,
    // Le brouillon reste à l'agent : le N+1 ne lit que la version transmise.
    autoEvaluation: autoTransmise ? annuelle.auto : null,
    evaluation: annuelle.evaluation ?? evaluationDuN1Vide(),
    reservee: annuelle.reservee ?? partieReserveeVide(),
    etatDeLEvaluation,
    evaluationTransmiseLe: annuelle.evaluationTransmiseLe,
    valideeLe: annuelle.valideeLe,
    renvoi: etatDeLEvaluation === 'renvoyee' ? annuelle.renvoi : null,
    n2: n2?.personne ?? null,
    etatDesCommentaires: n2 ? etatDesCommentaires(annuelle) : null,
    // Le brouillon du N+2 reste au N+2 : le N+1 ne lit que ce qui est transmis.
    commentairesDuN2: annuelle.commentairesDuN2,
    modifiable:
      autoTransmise &&
      evaluationOuverte(phase) &&
      etatDeLEvaluation !== 'transmise' &&
      etatDeLEvaluation !== 'validee',
  };
}

/**
 * Écrit l'évaluation d'un agent de son équipe : le brouillon, ou la version
 * transmise, une fois complète. Seulement l'auto-évaluation transmise,
 * pendant la période de l'année, et tant que l'évaluation ne l'est pas.
 */
async function ecrireEvaluation(
  tx: Tx,
  user: SessionUser,
  employeeId: string,
  { evaluation, reservee }: EcritureDeLEvaluation,
  transmettre: boolean,
): Promise<void> {
  const annee = await anneeDeLaCampagne(tx);
  const moi = await employeDuCompte(tx, user.userId);
  if (!moi || !(await dansLEquipe(tx, employeeId, moi, annee))) {
    problem(404, 'campagne.agent_hors_equipe', 'Agent introuvable dans votre équipe');
  }
  const agent = await ficheDe(tx, employeeId, annee);
  if (agent.auto?.etat !== 'transmise') {
    problem(
      409,
      'campagne.auto_non_transmise',
      'L’auto-évaluation de l’agent n’est pas encore transmise',
    );
  }
  const { phase } = await periodeDe(tx, annee);
  if (!evaluationOuverte(phase)) {
    problem(409, 'campagne.evaluation_fermee', 'L’évaluation n’est pas ouverte');
  }
  const annuelle = await ficheDeLAnnee(tx, employeeId, annee);
  if (annuelle.valideeLe) {
    problem(409, 'campagne.evaluation_validee', 'Évaluation déjà validée par l’agent');
  }
  if (annuelle.evaluationTransmiseLe) {
    problem(409, 'campagne.evaluation_transmise', 'Évaluation déjà transmise');
  }
  const personnel = personnelDeLaFiche(agent.personnel);
  const surLaFiche = evaluationSurLaFiche(evaluation, annuelle.objectifs, personnel);
  // Transmise, l'évaluation part sans les lignes de ses tableaux restées vides.
  const propre = transmettre ? sansLignesVides(surLaFiche) : surLaFiche;
  if (transmettre) {
    const manque = ceQuiManqueALEvaluationDuN1(propre, reservee, annuelle.objectifs, personnel);
    if (manque.length > 0) {
      problem(
        422,
        'campagne.evaluation_incomplete',
        'Évaluation incomplète',
        `À compléter : ${manque.join(', ')}.`,
      );
    }
  }
  // La ligne existe : l'auto-évaluation transmise l'a créée. Transmise,
  // l'évaluation ne se réécrit plus, même par deux envois qui se croisent.
  await tx.execute(sql`
    UPDATE fiches_entretien
       SET evaluation = ${JSON.stringify(propre)}::jsonb,
           reservee = ${JSON.stringify(reservee)}::jsonb,
           evaluation_par_employee_id = ${moi},
           evaluation_transmise_le = ${transmettre ? sql`now()` : sql`NULL`},
           updated_at = now()
     WHERE employee_id = ${employeeId} AND annee = ${annee}
       AND evaluation_transmise_le IS NULL`);
}

/** De ce qu'écrit le N+1, les objectifs de la fiche et les compétences de l'agent seulement. */
function evaluationSurLaFiche(
  e: EvaluationDuN1,
  objectifs: readonly ObjectifEvalue[],
  personnel: PersonnelDeLaFiche,
): EvaluationDuN1 {
  const ids = new Set(objectifs.map((o) => o.id));
  const cles = new Set<string>(competencesDe(personnel).map((c) => c.cle));
  return {
    ...e,
    objectifs: Object.fromEntries(Object.entries(e.objectifs).filter(([id]) => ids.has(id))),
    competences: Object.fromEntries(
      Object.entries(e.competences).filter(([cle]) => cles.has(cle)),
    ) as EvaluationDuN1['competences'],
  };
}

/** Le dossier de la personne connectée, évalué cette année ; sinon, introuvable. */
async function monDossierEvalue(
  tx: Tx,
  user: SessionUser,
  annee: number,
): Promise<{ id: string; fiche: AgentDeLaCampagne; auto: AutoDeLAgent }> {
  const id = await employeDuCompte(tx, user.userId);
  const fiche = id ? await ficheDe(tx, id, annee) : null;
  if (!id || !fiche?.auto) {
    problem(404, 'campagne.sans_auto_evaluation', 'Aucune auto-évaluation pour ce compte');
  }
  return { id, fiche, auto: fiche.auto };
}

async function monAutoDans(tx: Tx, user: SessionUser): Promise<MonAutoEvaluation> {
  const annee = await anneeDeLaCampagne(tx);
  const { fiche, auto, id } = await monDossierEvalue(tx, user, annee);
  const { periode, phase } = await periodeDe(tx, annee);
  const annuelle = await ficheDeLAnnee(tx, id, annee);
  return {
    annee,
    periode,
    phase,
    objectifs: annuelle.objectifs,
    auto: annuelle.auto ?? autoEvaluationVide(),
    etat: auto.etat,
    transmiseLe: auto.transmiseLe,
    evaluateur: fiche.evaluateur,
    modifiable: phase === 'auto_evaluation' && auto.etat !== 'transmise',
  };
}

/**
 * Écrit son auto-évaluation : le brouillon, ou la version transmise, une
 * fois complète. Seulement pendant l'auto-évaluation, et tant qu'elle n'est
 * pas transmise.
 */
async function ecrireMonAuto(
  tx: Tx,
  user: SessionUser,
  auto: AutoEvaluation,
  transmettre: boolean,
): Promise<void> {
  const annee = await anneeDeLaCampagne(tx);
  const { id, auto: etat } = await monDossierEvalue(tx, user, annee);
  const { phase } = await periodeDe(tx, annee);
  if (phase !== 'auto_evaluation') {
    problem(409, 'campagne.auto_fermee', 'L’auto-évaluation n’est pas ouverte');
  }
  if (etat.etat === 'transmise') {
    problem(409, 'campagne.auto_transmise', 'Auto-évaluation déjà transmise');
  }
  const { objectifs } = await ficheDeLAnnee(tx, id, annee);
  const propre = surLesObjectifs(auto, objectifs);
  if (transmettre) {
    const manque = ceQuiManqueALAutoEvaluation(propre, objectifs);
    if (manque.length > 0) {
      problem(
        422,
        'campagne.auto_incomplete',
        'Auto-évaluation incomplète',
        `À compléter : ${manque.join(', ')}.`,
      );
    }
  }
  // La ligne de l'année se crée au premier enregistrement. Transmise, elle
  // ne se réécrit plus, même par deux envois qui se croisent.
  await tx.execute(sql`
    INSERT INTO fiches_entretien (id, tenant_id, employee_id, annee, auto, auto_transmise_le)
    VALUES (${uuidv7()}, ${user.tenantId}, ${id}, ${annee}, ${JSON.stringify(propre)}::jsonb,
            ${transmettre ? sql`now()` : sql`NULL`})
    ON CONFLICT (tenant_id, employee_id, annee) DO UPDATE
       SET auto = EXCLUDED.auto,
           auto_transmise_le = EXCLUDED.auto_transmise_le,
           updated_at = now()
     WHERE fiches_entretien.auto_transmise_le IS NULL`);
}

/** De ce qu'écrit l'agent, les appréciations des objectifs de sa fiche seulement. */
function surLesObjectifs(
  auto: AutoEvaluation,
  objectifs: readonly ObjectifEvalue[],
): AutoEvaluation {
  const ids = new Set(objectifs.map((o) => o.id));
  return {
    ...auto,
    objectifs: Object.fromEntries(Object.entries(auto.objectifs).filter(([id]) => ids.has(id))),
  };
}

/** La fiche de l'année d'un agent, telle qu'elle est écrite. */
interface FicheDeLAnnee {
  objectifs: ObjectifEvalue[];
  /** `null` tant que rien n'est écrit. */
  auto: AutoEvaluation | null;
  evaluation: EvaluationDuN1 | null;
  reservee: PartieReservee | null;
  /** AAAA-MM-JJ. */
  evaluationTransmiseLe: string | null;
  /** AAAA-MM-JJ : la validation par l'agent. */
  valideeLe: string | null;
  /** Le dernier renvoi de l'agent au N+1, s'il y en a eu un. */
  renvoi: RenvoiDeLEvaluation | null;
  /** Le brouillon des commentaires du N+2 ; `null` tant que rien n'est écrit. */
  commentairesN2: string | null;
  /** Les commentaires du N+2, une fois transmis au N+1. */
  commentairesDuN2: CommentairesDuN2 | null;
}

/**
 * La fiche de l'année d'un agent : ses objectifs, son auto-évaluation,
 * l'évaluation du N+1 et la partie réservée. Ce que la base garde se relit
 * au contrat ; un champ qui manque reprend sa valeur vide.
 */
async function ficheDeLAnnee(tx: Tx, employeeId: string, annee: number): Promise<FicheDeLAnnee> {
  const { rows } = await tx.execute<{
    objectifs: unknown;
    auto: unknown;
    evaluation: unknown;
    reservee: unknown;
    evaluation_transmise_le: string | null;
    validee_le: string | null;
    renvoyee_le: string | null;
    renvoi_mot: string | null;
    commentaires_n2: string | null;
    commentaires_n2_le: string | null;
    n2_prenom: string | null;
    n2_nom: string | null;
    n2_poste: string | null;
  }>(sql`
    SELECT f.objectifs, f.auto, f.evaluation, f.reservee,
           f.evaluation_transmise_le::date::text AS evaluation_transmise_le,
           f.validee_le::date::text AS validee_le, f.renvoyee_le::date::text AS renvoyee_le,
           f.renvoi_mot, f.commentaires_n2,
           f.commentaires_n2_transmis_le::date::text AS commentaires_n2_le,
           pc.given_name AS n2_prenom, pc.family_name AS n2_nom, ac.position_title AS n2_poste
      FROM fiches_entretien f
      LEFT JOIN employees c ON c.id = f.commentaires_n2_par
      LEFT JOIN persons pc ON pc.id = c.person_id
      LEFT JOIN assignments ac ON ac.employee_id = c.id AND ac.validity @> CURRENT_DATE
     WHERE f.employee_id = ${employeeId} AND f.annee = ${annee}`);
  const r = rows[0];
  const objectifs = objectifEvalueSchema.array().safeParse(r?.objectifs ?? []);
  const auto = r?.auto ? autoEvaluationSchema.partial().safeParse(r.auto) : null;
  const evaluation = r?.evaluation ? evaluationDuN1Schema.partial().safeParse(r.evaluation) : null;
  const reservee = r?.reservee ? partieReserveeSchema.partial().safeParse(r.reservee) : null;
  return {
    objectifs: objectifs.success ? objectifs.data : [],
    auto: auto?.success ? { ...autoEvaluationVide(), ...auto.data } : null,
    evaluation: evaluation?.success ? { ...evaluationDuN1Vide(), ...evaluation.data } : null,
    reservee: reservee?.success ? { ...partieReserveeVide(), ...reservee.data } : null,
    evaluationTransmiseLe: r?.evaluation_transmise_le ?? null,
    valideeLe: r?.validee_le ?? null,
    renvoi: r?.renvoyee_le ? { mot: r.renvoi_mot ?? '', le: r.renvoyee_le } : null,
    commentairesN2: r?.commentaires_n2 ?? null,
    commentairesDuN2: r?.commentaires_n2_le
      ? {
          texte: r.commentaires_n2 ?? '',
          le: r.commentaires_n2_le,
          par: r.n2_nom ? { prenom: r.n2_prenom!, nom: r.n2_nom, poste: r.n2_poste } : null,
        }
      : null,
  };
}

/** Où en sont les commentaires du N+2, sur ce que garde la fiche de l'année. */
function etatDesCommentaires(f: FicheDeLAnnee): EtatDesCommentaires {
  if (!f.valideeLe) return 'en_attente';
  if (f.commentairesDuN2) return 'transmis';
  return f.commentairesN2 !== null ? 'en_cours' : 'a_commenter';
}

/**
 * L'état de l'évaluation, sur ce que garde la fiche de l'année : validée,
 * transmise, renvoyée par l'agent, commencée, ou encore à faire. Une
 * évaluation transmise de nouveau après un renvoi est transmise.
 */
function etatDeLEvaluation(f: {
  commencee: boolean;
  transmise: boolean;
  validee: boolean;
  renvoyee: boolean;
}): EtatDeLEvaluation {
  if (f.validee) return 'validee';
  if (f.transmise) return 'transmise';
  if (f.renvoyee) return 'renvoyee';
  return f.commencee ? 'en_cours' : 'a_faire';
}

const etatSurLaFiche = (f: FicheDeLAnnee) =>
  etatDeLEvaluation({
    commencee: f.evaluation !== null,
    transmise: f.evaluationTransmiseLe !== null,
    validee: f.valideeLe !== null,
    renvoyee: f.renvoi !== null,
  });

/** Ce que l'agent sait de son évaluation : rien du brouillon du N+1. */
const POUR_L_AGENT: Record<EtatDeLEvaluation, EtatDeMonEvaluation> = {
  a_faire: 'en_attente',
  en_cours: 'en_attente',
  renvoyee: 'renvoyee',
  transmise: 'a_valider',
  validee: 'validee',
};

/** Son évaluation par le N+1, vue par l'agent. */
function evaluationRecue(f: FicheDeLAnnee): EvaluationRecue {
  const etat = POUR_L_AGENT[etatSurLaFiche(f)];
  return {
    etat,
    transmiseLe: f.evaluationTransmiseLe,
    valideeLe: f.valideeLe,
    renvoyeeLe: etat === 'renvoyee' ? (f.renvoi?.le ?? null) : null,
  };
}

/**
 * Son évaluation, telle que l'agent la lit : la version transmise par le
 * N+1, jamais son brouillon, jamais la partie réservée à la hiérarchie.
 */
async function monEvaluationDans(tx: Tx, user: SessionUser): Promise<MonEvaluation> {
  const annee = await anneeDeLaCampagne(tx);
  const { id, fiche } = await monDossierEvalue(tx, user, annee);
  const { periode, phase } = await periodeDe(tx, annee);
  const annuelle = await ficheDeLAnnee(tx, id, annee);
  const recue = evaluationRecue(annuelle);
  return {
    annee,
    periode,
    phase,
    personnel: personnelDeLaFiche(fiche.personnel),
    objectifs: annuelle.objectifs,
    auto: annuelle.auto ?? autoEvaluationVide(),
    evaluation:
      recue.etat === 'a_valider' || recue.etat === 'validee'
        ? (annuelle.evaluation ?? evaluationDuN1Vide())
        : null,
    evaluateur: fiche.evaluateur,
    ...recue,
    renvoi: recue.etat === 'renvoyee' ? annuelle.renvoi : null,
    validable: recue.etat === 'a_valider',
    renvoyable: recue.etat === 'a_valider' && evaluationOuverte(phase),
  };
}

/** Son évaluation, transmise et pas encore validée ; sinon, 409. */
async function aValider(
  tx: Tx,
  user: SessionUser,
): Promise<{ id: string; annee: number; phase: PhaseDeLaCampagne }> {
  const annee = await anneeDeLaCampagne(tx);
  const { id } = await monDossierEvalue(tx, user, annee);
  const annuelle = await ficheDeLAnnee(tx, id, annee);
  if (annuelle.valideeLe) {
    problem(409, 'campagne.evaluation_validee', 'Évaluation déjà validée');
  }
  if (!annuelle.evaluationTransmiseLe) {
    problem(
      409,
      'campagne.evaluation_non_transmise',
      'L’évaluation de votre N+1 n’est pas encore transmise',
    );
  }
  const { phase } = await periodeDe(tx, annee);
  return { id, annee, phase };
}

/**
 * L'agent valide son évaluation, à tout moment une fois transmise : la
 * fiche n'est valable qu'une fois validée. Elle ne change plus ensuite, même
 * par deux gestes qui se croisent.
 */
async function validerMonEvaluationDans(tx: Tx, user: SessionUser): Promise<void> {
  const { id, annee } = await aValider(tx, user);
  await tx.execute(sql`
    UPDATE fiches_entretien SET validee_le = now(), updated_at = now()
     WHERE employee_id = ${id} AND annee = ${annee}
       AND evaluation_transmise_le IS NOT NULL AND validee_le IS NULL`);
}

/**
 * L'agent renvoie son évaluation au N+1, avec son mot : elle redevient un
 * brouillon du N+1. Seulement pendant la période de l'année, où le N+1 peut
 * encore la reprendre.
 */
async function renvoyerMonEvaluationDans(tx: Tx, user: SessionUser, mot: string): Promise<void> {
  const { id, annee, phase } = await aValider(tx, user);
  if (!evaluationOuverte(phase)) {
    problem(
      409,
      'campagne.evaluation_fermee',
      'La période de l’évaluation est terminée : votre N+1 ne peut plus la reprendre',
    );
  }
  await tx.execute(sql`
    UPDATE fiches_entretien
       SET evaluation_transmise_le = NULL, renvoyee_le = now(), renvoi_mot = ${mot},
           updated_at = now()
     WHERE employee_id = ${id} AND annee = ${annee}
       AND evaluation_transmise_le IS NOT NULL AND validee_le IS NULL`);
}

/** L'année de la campagne : celle du mode campagne, sinon l'année en cours. */
async function anneeDeLaCampagne(tx: Tx): Promise<number> {
  const campagne = loadEnv().CAMPAGNE_D_EVALUATION;
  if (campagne) return campagne;
  const { rows } = await tx.execute<{ annee: number }>(
    sql`SELECT extract(year FROM CURRENT_DATE)::int AS annee`,
  );
  return rows[0]!.annee;
}

/** La période de l'année, et la phase du jour (le jour de Dakar). */
async function periodeDe(
  tx: Tx,
  annee: number,
): Promise<{ periode: PeriodeDeLaCampagne | null; phase: PhaseDeLaCampagne }> {
  const { rows } = await tx.execute<{
    du: string;
    au: string;
    auto_au: string | null;
    phase: PhaseDeLaCampagne;
  }>(sql`
    SELECT du::text, au::text, auto_au::text,
           CASE WHEN CURRENT_DATE < du THEN 'a_venir'
                WHEN CURRENT_DATE <= COALESCE(auto_au, au) THEN 'auto_evaluation'
                WHEN CURRENT_DATE <= au THEN 'evaluation'
                ELSE 'terminee' END AS phase
      FROM evaluation_periodes WHERE annee = ${annee}`);
  const r = rows[0];
  if (!r) return { periode: null, phase: 'non_fixee' };
  return { periode: { du: r.du, autoAu: r.auto_au, au: r.au }, phase: r.phase };
}

/** Le dossier d'agent actif relié au compte. */
async function employeDuCompte(tx: Tx, userId: string): Promise<string | null> {
  const { rows } = await tx.execute<{ id: string }>(sql`
    SELECT e.id FROM employees e JOIN persons p ON p.id = e.person_id
     WHERE p.user_id = ${userId} AND p.deleted_at IS NULL AND e.status = 'active'
     LIMIT 1`);
  return rows[0]?.id ?? null;
}

/** La fiche de la personne connectée, et son évaluateur. */
async function ficheDe(tx: Tx, id: string, annee: number): Promise<AgentDeLaCampagne> {
  const { rows } = await tx.execute<{
    prenom: string;
    nom: string;
    matricule: string;
    personnel: PersonnelDeLaFiche | null;
    poste: string | null;
    unite_id: string | null;
    direction_abregee: string | null;
    evalue: boolean;
    commencee: boolean;
    transmise_le: string | null;
    ev_prenom: string | null;
    ev_nom: string | null;
    ev_poste: string | null;
  }>(sql`
    SELECT p.given_name AS prenom, p.family_name AS nom, e.employee_number AS matricule,
           e.personnel, a.position_title AS poste, a.org_unit_id AS unite_id,
           ${directionDeLUnite(sql`a.org_unit_id`, 'short_name')} AS direction_abregee,
           ${evaluable(sql`e`)} AS evalue,
           f.auto IS NOT NULL AS commencee, f.auto_transmise_le::date::text AS transmise_le,
           pv.given_name AS ev_prenom, pv.family_name AS ev_nom, av.position_title AS ev_poste
      FROM employees e
      JOIN persons p ON p.id = e.person_id
      LEFT JOIN assignments a ON a.employee_id = e.id AND a.validity @> CURRENT_DATE
      LEFT JOIN fiches_entretien f ON f.employee_id = e.id AND f.annee = ${annee}
      LEFT JOIN employees v ON v.id = ${EVALUATEUR} AND v.status = 'active'
      LEFT JOIN persons pv ON pv.id = v.person_id
      LEFT JOIN assignments av ON av.employee_id = v.id AND av.validity @> CURRENT_DATE
     WHERE e.id = ${id}
     LIMIT 1`);
  const r = rows[0]!;
  return {
    employeeId: id,
    prenom: r.prenom,
    nom: r.nom,
    matricule: r.matricule,
    poste: r.poste,
    personnel: r.personnel,
    ...(await unitesDe(tx, r.unite_id)),
    directionAbregee: r.direction_abregee,
    evaluateur: r.ev_nom ? { prenom: r.ev_prenom!, nom: r.ev_nom, poste: r.ev_poste } : null,
    auto: r.evalue ? autoDe(r.commencee, r.transmise_le) : null,
  };
}

/** Vrai si `evaluateur` évalue cet agent cette année. */
async function dansLEquipe(
  tx: Tx,
  employeeId: string,
  evaluateur: string,
  annee: number,
): Promise<boolean> {
  const { rows } = await tx.execute(sql`
    SELECT 1 FROM employees e
      LEFT JOIN fiches_entretien f ON f.employee_id = e.id AND f.annee = ${annee}
     WHERE e.id = ${employeeId} AND ${evaluable(sql`e`)} AND ${EVALUATEUR} = ${evaluateur}`);
  return rows.length > 0;
}

/**
 * Les agents qu'évalue la personne connectée, par ordre alphabétique. Leur
 * N+2 est l'évaluateur de cette personne : `avecN2` dit s'il y en a un.
 */
async function equipeDe(
  tx: Tx,
  id: string,
  annee: number,
  avecN2: boolean,
): Promise<AgentDeLEquipe[]> {
  const { rows } = await tx.execute<{
    id: string;
    prenom: string;
    nom: string;
    matricule: string;
    poste: string | null;
    commencee: boolean;
    transmise_le: string | null;
    evaluation_commencee: boolean;
    evaluation_transmise: boolean;
    evaluation_validee: boolean;
    evaluation_renvoyee: boolean;
    commentaires_commences: boolean;
    commentaires_transmis: boolean;
  }>(sql`
    SELECT e.id, p.given_name AS prenom, p.family_name AS nom, e.employee_number AS matricule,
           a.position_title AS poste,
           f.commentaires_n2 IS NOT NULL AS commentaires_commences,
           f.commentaires_n2_transmis_le IS NOT NULL AS commentaires_transmis,
           f.auto IS NOT NULL AS commencee, f.auto_transmise_le::date::text AS transmise_le,
           f.evaluation IS NOT NULL AS evaluation_commencee,
           f.evaluation_transmise_le IS NOT NULL AS evaluation_transmise,
           f.validee_le IS NOT NULL AS evaluation_validee,
           f.renvoyee_le IS NOT NULL AS evaluation_renvoyee
      FROM employees e
      JOIN persons p ON p.id = e.person_id
      LEFT JOIN assignments a ON a.employee_id = e.id AND a.validity @> CURRENT_DATE
      LEFT JOIN fiches_entretien f ON f.employee_id = e.id AND f.annee = ${annee}
     WHERE ${evaluable(sql`e`)} AND ${EVALUATEUR} = ${id}
     ORDER BY p.family_name, p.given_name`);
  return rows.map((r) => ({
    employeeId: r.id,
    prenom: r.prenom,
    nom: r.nom,
    matricule: r.matricule,
    poste: r.poste,
    auto: autoDe(r.commencee, r.transmise_le),
    evaluation: etatDeLEvaluation({
      commencee: r.evaluation_commencee,
      transmise: r.evaluation_transmise,
      validee: r.evaluation_validee,
      renvoyee: r.evaluation_renvoyee,
    }),
    commentaires: avecN2
      ? etatDesCommentairesDe({
          validee: r.evaluation_validee,
          commences: r.commentaires_commences,
          transmis: r.commentaires_transmis,
        })
      : null,
  }));
}

const etatDesCommentairesDe = (f: {
  validee: boolean;
  commences: boolean;
  transmis: boolean;
}): EtatDesCommentaires =>
  !f.validee ? 'en_attente' : f.transmis ? 'transmis' : f.commences ? 'en_cours' : 'a_commenter';

/**
 * Le N+2 de la campagne, sur un agent `e` et sa fiche `f`, son N+1 `n1` et
 * la fiche de l'année du N+1 `f1` : l'évaluateur de l'évaluateur, choisi
 * pour la campagne, sinon le N+1 de l'organigramme.
 */
const N2 = sql`COALESCE(f1.evaluateur_employee_id, n1.manager_employee_id)`;

/** Le N+2 d'un agent, pour la campagne de l'année ; `null` s'il n'y en a pas (le N+1 au sommet). */
async function n2De(
  tx: Tx,
  employeeId: string,
  annee: number,
): Promise<{ id: string; personne: PersonneDeLaCampagne } | null> {
  const { rows } = await tx.execute<{
    id: string;
    prenom: string;
    nom: string;
    poste: string | null;
  }>(sql`
    SELECT n2.id, p2.given_name AS prenom, p2.family_name AS nom, a2.position_title AS poste
      FROM employees e
      LEFT JOIN fiches_entretien f ON f.employee_id = e.id AND f.annee = ${annee}
      JOIN employees n1 ON n1.id = ${EVALUATEUR}
      LEFT JOIN fiches_entretien f1 ON f1.employee_id = n1.id AND f1.annee = ${annee}
      JOIN employees n2 ON n2.id = ${N2} AND n2.status = 'active'
      JOIN persons p2 ON p2.id = n2.person_id
      LEFT JOIN assignments a2 ON a2.employee_id = n2.id AND a2.validity @> CURRENT_DATE
     WHERE e.id = ${employeeId} AND ${evaluable(sql`e`)} AND n2.id <> e.id
     LIMIT 1`);
  const r = rows[0];
  return r ? { id: r.id, personne: { prenom: r.prenom, nom: r.nom, poste: r.poste } } : null;
}

/**
 * Les agents dont la personne connectée est le N+2, rangés par N+1, puis
 * par ordre alphabétique : chacune de leurs fiches, où qu'elle en soit.
 */
async function aCommenterDe(tx: Tx, id: string, annee: number): Promise<AgentACommenter[]> {
  const { rows } = await tx.execute<{
    id: string;
    prenom: string;
    nom: string;
    matricule: string;
    poste: string | null;
    commencee: boolean;
    transmise_le: string | null;
    evaluation_commencee: boolean;
    evaluation_transmise: boolean;
    evaluation_validee: boolean;
    evaluation_renvoyee: boolean;
    commentaires_commences: boolean;
    commentaires_transmis: boolean;
    n1_prenom: string;
    n1_nom: string;
    n1_poste: string | null;
  }>(sql`
    SELECT e.id, p.given_name AS prenom, p.family_name AS nom, e.employee_number AS matricule,
           a.position_title AS poste,
           f.auto IS NOT NULL AS commencee, f.auto_transmise_le::date::text AS transmise_le,
           f.evaluation IS NOT NULL AS evaluation_commencee,
           f.evaluation_transmise_le IS NOT NULL AS evaluation_transmise,
           f.validee_le IS NOT NULL AS evaluation_validee,
           f.renvoyee_le IS NOT NULL AS evaluation_renvoyee,
           f.commentaires_n2 IS NOT NULL AS commentaires_commences,
           f.commentaires_n2_transmis_le IS NOT NULL AS commentaires_transmis,
           p1.given_name AS n1_prenom, p1.family_name AS n1_nom, a1.position_title AS n1_poste
      FROM employees e
      JOIN persons p ON p.id = e.person_id
      LEFT JOIN assignments a ON a.employee_id = e.id AND a.validity @> CURRENT_DATE
      LEFT JOIN fiches_entretien f ON f.employee_id = e.id AND f.annee = ${annee}
      JOIN employees n1 ON n1.id = ${EVALUATEUR}
      JOIN persons p1 ON p1.id = n1.person_id
      LEFT JOIN assignments a1 ON a1.employee_id = n1.id AND a1.validity @> CURRENT_DATE
      LEFT JOIN fiches_entretien f1 ON f1.employee_id = n1.id AND f1.annee = ${annee}
     WHERE ${evaluable(sql`e`)} AND ${N2} = ${id} AND e.id <> ${id}
     ORDER BY p1.family_name, p1.given_name, p.family_name, p.given_name`);
  return rows.map((r) => ({
    employeeId: r.id,
    prenom: r.prenom,
    nom: r.nom,
    matricule: r.matricule,
    poste: r.poste,
    n1: { prenom: r.n1_prenom, nom: r.n1_nom, poste: r.n1_poste },
    auto: autoDe(r.commencee, r.transmise_le),
    evaluation: etatDeLEvaluation({
      commencee: r.evaluation_commencee,
      transmise: r.evaluation_transmise,
      validee: r.evaluation_validee,
      renvoyee: r.evaluation_renvoyee,
    }),
    commentaires: etatDesCommentairesDe({
      validee: r.evaluation_validee,
      commences: r.commentaires_commences,
      transmis: r.commentaires_transmis,
    }),
  }));
}

/** Un agent dont la personne connectée est le N+2 ; sinon, introuvable. */
async function monN2(
  tx: Tx,
  user: SessionUser,
  employeeId: string,
): Promise<{ moi: string; annee: number }> {
  const annee = await anneeDeLaCampagne(tx);
  const moi = await employeDuCompte(tx, user.userId);
  if (!moi || (await n2De(tx, employeeId, annee))?.id !== moi) {
    problem(404, 'campagne.agent_hors_perimetre', 'Agent introuvable parmi les équipes de vos N+1');
  }
  return { moi, annee };
}

/**
 * La fiche d'un agent, telle que son N+2 l'ouvre : en entier, partie
 * réservée comprise, une fois validée par l'agent ; avant, seulement où
 * elle en est.
 */
async function ficheDuN2Dans(
  tx: Tx,
  user: SessionUser,
  employeeId: string,
): Promise<FichePourLeN2> {
  const { annee } = await monN2(tx, user, employeeId);
  const { periode, phase } = await periodeDe(tx, annee);
  const agent = await ficheDe(tx, employeeId, annee);
  const annuelle = await ficheDeLAnnee(tx, employeeId, annee);
  const etat = etatDesCommentaires(annuelle);
  return {
    annee,
    periode,
    phase,
    agent,
    objectifs: annuelle.objectifs,
    fiche: annuelle.valideeLe
      ? {
          auto: annuelle.auto ?? autoEvaluationVide(),
          evaluation: annuelle.evaluation ?? evaluationDuN1Vide(),
          reservee: annuelle.reservee ?? partieReserveeVide(),
        }
      : null,
    autoTransmiseLe: agent.auto?.transmiseLe ?? null,
    evaluationTransmiseLe: annuelle.evaluationTransmiseLe,
    valideeLe: annuelle.valideeLe,
    commentaires: annuelle.commentairesDuN2?.texte ?? annuelle.commentairesN2 ?? '',
    etat,
    transmisLe: annuelle.commentairesDuN2?.le ?? null,
    modifiable: etat === 'a_commenter' || etat === 'en_cours',
  };
}

/**
 * Écrit les commentaires du N+2 : le brouillon, ou la version transmise au
 * N+1, avec ou sans un mot. Seulement la fiche validée par l'agent, et tant
 * qu'ils ne sont pas transmis ; transmis, ils ne se réécrivent plus.
 */
async function ecrireCommentaires(
  tx: Tx,
  user: SessionUser,
  employeeId: string,
  commentaires: string,
  transmettre: boolean,
): Promise<void> {
  const { moi, annee } = await monN2(tx, user, employeeId);
  const annuelle = await ficheDeLAnnee(tx, employeeId, annee);
  if (!annuelle.valideeLe) {
    problem(409, 'campagne.fiche_non_validee', 'La fiche n’est pas encore validée par l’agent');
  }
  if (annuelle.commentairesDuN2) {
    problem(409, 'campagne.commentaires_transmis', 'Commentaires déjà transmis');
  }
  await tx.execute(sql`
    UPDATE fiches_entretien
       SET commentaires_n2 = ${commentaires}, commentaires_n2_par = ${moi},
           commentaires_n2_transmis_le = ${transmettre ? sql`now()` : sql`NULL`},
           updated_at = now()
     WHERE employee_id = ${employeeId} AND annee = ${annee}
       AND validee_le IS NOT NULL AND commentaires_n2_transmis_le IS NULL`);
}
