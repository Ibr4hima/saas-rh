import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  AccueilDeLaCampagne,
  AgentDeLaCampagne,
  AgentDeLEquipe,
  AutoDeLAgent,
  EvaluationDeLAgent,
  PeriodeDeLaCampagne,
  PersonnelDeLaFiche,
  PhaseDeLaCampagne,
  SessionUser,
} from '@teranga/contracts';
import { problem } from '../../common/problem';
import { loadEnv } from '../../config/env';
import { TenantDb, type Tx } from '../../db/tenant-db';
import { evaluable } from '../evaluations/circuit';
import { unitesDe } from '../evaluations/unites';
import { directionDeLUnite } from '../people/chaine';

/* ────────────────────────────────────────────────────────────────
   L'accueil de la campagne d'évaluation annuelle (ADR-0211).

   La personne connectée y lit sa fiche, comme celle de son dossier, l'état
   de son auto-évaluation, et les agents qu'évalue cette personne, avec
   l'état de chaque auto-évaluation. L'évaluateur d'un agent : le choix de
   l'administration pour la campagne, sinon le N+1 dans l'organigramme. Ce
   choix ne touche pas à l'organigramme.
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
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      const annee = await anneeDeLaCampagne(tx);
      const moi = await employeDuCompte(tx, user.userId);
      if (!moi || !(await dansLEquipe(tx, employeeId, moi, annee))) {
        problem(404, 'campagne.agent_hors_equipe', 'Agent introuvable dans votre équipe');
      }
      const { periode, phase } = await periodeDe(tx, annee);
      return { annee, periode, phase, agent: await ficheDe(tx, employeeId, annee) };
    });
  }
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
  }>(sql`
    SELECT e.id, p.given_name AS prenom, p.family_name AS nom, e.employee_number AS matricule,
           a.position_title AS poste,
           f.auto IS NOT NULL AS commencee, f.auto_transmise_le::date::text AS transmise_le
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
  }));
}
