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
  type AgentDeLaCampagne,
  type AgentDeLEquipe,
  type AutoDeLAgent,
  type AutoEvaluation,
  type EcritureDeLEvaluation,
  type EtatDeLEvaluation,
  type EvaluationDeLAgent,
  type EvaluationDuN1,
  type MonAutoEvaluation,
  type ObjectifEvalue,
  type PartieReservee,
  type PeriodeDeLaCampagne,
  type PersonnelDeLaFiche,
  type PhaseDeLaCampagne,
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
      if (!moi) return { annee, periode, phase, moi: null, equipe: [] };
      return {
        annee,
        periode,
        phase,
        moi: await ficheDe(tx, moi, annee),
        equipe: await equipeDe(tx, moi, annee),
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
  const etatDeLEvaluation: EtatDeLEvaluation = annuelle.evaluationTransmiseLe
    ? 'transmise'
    : annuelle.evaluation
      ? 'en_cours'
      : 'a_faire';
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
    modifiable: autoTransmise && evaluationOuverte(phase) && etatDeLEvaluation !== 'transmise',
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
  }>(sql`
    SELECT objectifs, auto, evaluation, reservee,
           evaluation_transmise_le::date::text AS evaluation_transmise_le
      FROM fiches_entretien
     WHERE employee_id = ${employeeId} AND annee = ${annee}`);
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
  };
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

/** Les agents qu'évalue la personne connectée, par ordre alphabétique. */
async function equipeDe(tx: Tx, id: string, annee: number): Promise<AgentDeLEquipe[]> {
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
  }>(sql`
    SELECT e.id, p.given_name AS prenom, p.family_name AS nom, e.employee_number AS matricule,
           a.position_title AS poste,
           f.auto IS NOT NULL AS commencee, f.auto_transmise_le::date::text AS transmise_le,
           f.evaluation IS NOT NULL AS evaluation_commencee,
           f.evaluation_transmise_le IS NOT NULL AS evaluation_transmise
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
    evaluation: r.evaluation_transmise
      ? 'transmise'
      : r.evaluation_commencee
        ? 'en_cours'
        : 'a_faire',
  }));
}
