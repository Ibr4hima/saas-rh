import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import {
  ancienneteEnLettres,
  ceQuiManque,
  completerLaGrille,
  contenuDeGrilleSchema,
  grilleVide,
  nomDeLaGrille,
  OBJECTIFS_ECOULES,
  peut,
  texteRicheDe,
  type ActionsSurLaGrille,
  type ContenuDeGrille,
  type EtatDeGrille,
  type EvaluationsDeLEquipe,
  type FormationProposable,
  type GrilleAuDossier,
  type IdentificationDeGrille,
  type LigneDEvaluation,
  type MesEvaluations,
  type OuEnEst,
  type PeriodeEvaluation,
  type PeriodeEvaluationInput,
  type Personnel,
  type RoleDansLaGrille,
  type SessionUser,
  type SuiviDesEvaluations,
  type VueDeGrille,
  type VueDeLaPeriode,
} from '@teranga/contracts';
import { problem } from '../../common/problem';
import * as t from '../../db/schema';
import { TenantDb, type Tx } from '../../db/tenant-db';
import { retirerLesAppels, tenirLesAppels } from '../acces/appels';
import { AcademySuiviService } from '../academy/academy-suivi.service';
import type { DocumentPdf } from '../documents/feuille';
import { notifier } from '../notifications/notifier';
import {
  evaluable,
  lienDeLAgent,
  lienDeLEquipe,
  prefixeDeLaGrille,
  reconcilierLesGrilles,
} from './circuit';
import { grilleDuPersonnelCadre } from './grille-cadre';
import { grilleDuPersonnelNonCadre } from './grille-non-cadre';

/* ────────────────────────────────────────────────────────────────
   L'évaluation annuelle sur la grille de l'APIX (ADR-0149).

   Qui fait quoi se lit dans l'organigramme, comme pour les congés :
   · le N+1 d'aujourd'hui remplit la grille de chaque agent de son équipe,
     celle du personnel cadre ou celle du personnel non cadre, selon sa
     fiche (ADR-0155), une fois la période ouverte ; l'envoie à l'agent,
     puis à la DCH ou d'abord au N+2 ; tant que la grille attend l'avis du
     N+2, le N+1 peut la reprendre (ADR-0156) ;
   · l'agent la lit, sans la partie réservée à la hiérarchie, la valide ou
     la renvoie ;
   · le N+2 qui l'a reçue la lit en entier, la commente et la valide ;
   · la DCH ouvre la période, suit les grilles, et reçoit l'original.
   ──────────────────────────────────────────────────────────────── */

type Grille = typeof t.evaluationGrilles.$inferSelect;

/** L'agent d'une grille, et son N+1, tels que l'organigramme les donne aujourd'hui. */
interface Agent {
  id: string;
  prenom: string;
  nom: string;
  userId: string | null;
  matricule: string;
  personnel: Personnel | null;
  poste: string | null;
  /** Le premier jour de son affectation en cours, AAAA-MM-JJ. */
  posteDepuis: string | null;
  uniteId: string | null;
  /** Des agents en relèvent : le critère « Commandement » vaut. */
  encadre: boolean;
  n1: {
    id: string;
    prenom: string;
    nom: string;
    userId: string | null;
    poste: string | null;
  } | null;
  /** Le N+1 de son N+1, en activité ; null sans N+1 au-dessus. */
  n2: {
    id: string;
    prenom: string;
    nom: string;
    userId: string | null;
    poste: string | null;
  } | null;
}

interface Contexte {
  moi: string | null;
  annee: number;
  agent: Agent & { unites: Unites };
  grille: Grille | null;
  /**
   * Une grille pas encore commencée ; celle du personnel cadre reprend dans
   * son rappel des objectifs les objectifs à venir de la grille précédente.
   */
  prefill: ContenuDeGrille | null;
  periode: PeriodeEvaluation | null;
  aujourdhui: string;
  role: RoleDansLaGrille;
  /** L'appelant est le N+1 d'aujourd'hui de l'agent : à cette personne d'agir. */
  n1Courant: boolean;
  /** Qui a rempli la grille, ou qui la remplira : son N+1 d'aujourd'hui. */
  evaluateur: string | null;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const jour = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const nomComplet = (prenom: string, nom: string) => `${prenom} ${nom}`;
/** Le nom tel que les documents de l'APIX l'écrivent : « Moussa NDIAYE ». */
const nomDuDocument = (prenom: string, nom: string) => `${prenom} ${nom.toUpperCase()}`;

@Injectable()
export class EvaluationsService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(AcademySuiviService) private readonly academy: AcademySuiviService,
  ) {}

  private ctx(user: SessionUser) {
    return { tenantId: user.tenantId, userId: user.userId };
  }

  // ──────────────────────────────────────────────── la période

  async periode(user: SessionUser, annee?: number): Promise<VueDeLaPeriode> {
    if (!peut(user, 'pilotage'))
      problem(403, 'auth.forbidden', 'Vous n’avez pas les droits nécessaires pour cette action');
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const a = annee ?? (await this.anneeCourante(tx));
      return {
        annee: a,
        periode: await this.periodeDe(tx, a),
        modifiable: Boolean(user.dirigeLaDCH),
        annees: await this.anneesDesPeriodes(tx),
      };
    });
  }

  /** Qui dirige la DCH fixe la période d'une année : du … au …. */
  async fixerPeriode(
    user: SessionUser,
    annee: number,
    input: PeriodeEvaluationInput,
  ): Promise<VueDeLaPeriode> {
    if (!user.dirigeLaDCH) {
      problem(
        403,
        'evaluations.periode_reservee',
        'Seule la personne qui dirige la DCH fixe la période d’évaluation',
      );
    }
    const debut = Number(input.du.slice(0, 4));
    if (debut < annee || debut > annee + 1) {
      problem(
        422,
        'evaluations.periode_hors_annee',
        `La période d’évaluation ${annee} doit commencer en ${annee} ou en ${annee + 1}`,
      );
    }
    return this.db.withTenant(this.ctx(user), async (tx) => {
      await tx.execute(sql`
        INSERT INTO evaluation_periodes (id, tenant_id, annee, du, au)
        VALUES (${uuidv7()}, ${user.tenantId}, ${annee}, ${input.du}, ${input.au})
        ON CONFLICT (tenant_id, annee) DO UPDATE
           SET du = EXCLUDED.du, au = EXCLUDED.au, updated_at = now()`);
      return {
        annee,
        periode: await this.periodeDe(tx, annee),
        modifiable: true,
        annees: await this.anneesDesPeriodes(tx),
      };
    });
  }

  /**
   * L'année qu'on évalue : celle de la dernière période ouverte ; sans
   * période ouverte, l'année en cours.
   */
  private async anneeCourante(tx: Tx): Promise<number> {
    const { rows } = await tx.execute<{ annee: number | null; courante: number }>(sql`
      SELECT (SELECT max(annee) FROM evaluation_periodes WHERE du <= CURRENT_DATE) AS annee,
             extract(year FROM CURRENT_DATE)::int AS courante`);
    return rows[0]?.annee ?? rows[0]!.courante;
  }

  private async periodeDe(tx: Tx, annee: number): Promise<PeriodeEvaluation | null> {
    const { rows } = await tx.execute<{ du: string; au: string }>(sql`
      SELECT du::text AS du, au::text AS au FROM evaluation_periodes WHERE annee = ${annee}`);
    return rows[0] ? { annee, du: rows[0].du, au: rows[0].au } : null;
  }

  private async anneesDesPeriodes(tx: Tx): Promise<number[]> {
    const { rows } = await tx.execute<{ annee: number }>(
      sql`SELECT annee FROM evaluation_periodes ORDER BY annee DESC`,
    );
    return rows.map((r) => r.annee);
  }

  // ──────────────────────────────────────────────── les listes

  /** Les grilles de l'équipe du N+1, et celles reçues d'un autre N+1, en N+2. */
  async equipe(user: SessionUser, annee?: number): Promise<EvaluationsDeLEquipe> {
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const a = annee ?? (await this.anneeCourante(tx));
      const periode = await this.periodeDe(tx, a);
      const moi = await this.employeDuCompte(tx, user.userId);
      const aujourdhui = await this.aujourdhui(tx);
      if (!moi) {
        return { annee: a, periode, ouverte: false, annees: [], lignes: [] };
      }
      const lignes = await this.lignes(
        tx,
        a,
        periode,
        aujourdhui,
        // Ses agents à évaluer, et ceux dont la grille existe déjà, partis
        // depuis : elle s'achève comme les autres.
        sql`((e.manager_employee_id = ${moi} AND (${evaluable(sql`e`)} OR g.id IS NOT NULL))
             OR (g.n2_employee_id = ${moi} AND g.etat IN ('chez_n2', 'validee_n2', 'terminee')))`,
        moi,
      );
      return {
        annee: a,
        periode,
        ouverte: Boolean(periode && periode.du <= aujourdhui),
        annees: await this.anneesDesPeriodes(tx),
        lignes,
      };
    });
  }

  /** Le suivi de la DCH : chaque agent qu'on évalue, et où en est sa grille. */
  async suivi(user: SessionUser, annee?: number): Promise<SuiviDesEvaluations> {
    if (!peut(user, 'pilotage'))
      problem(403, 'auth.forbidden', 'Vous n’avez pas les droits nécessaires pour cette action');
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const a = annee ?? (await this.anneeCourante(tx));
      const periode = await this.periodeDe(tx, a);
      const aujourdhui = await this.aujourdhui(tx);
      return {
        annee: a,
        periode,
        ouverte: Boolean(periode && periode.du <= aujourdhui),
        annees: await this.anneesDesPeriodes(tx),
        modifiable: Boolean(user.dirigeLaDCH),
        lignes: await this.lignes(
          tx,
          a,
          periode,
          aujourdhui,
          sql`(${evaluable(sql`e`)} OR g.id IS NOT NULL)`,
          null,
          peut(user, 'personnel.gerer'),
        ),
      };
    });
  }

  /**
   * Cadre ou non cadre, depuis le suivi : la colonne de la fiche de l'agent.
   * Qui gère le personnel le dit pour tout dossier en activité, le sien
   * compris : c'est la seule chose qu'on règle sur son propre dossier, et
   * elle ne donne aucun droit. Le reste de sa fiche passe toujours par
   * quelqu'un d'autre (ADR-0157).
   */
  async choisirLePersonnel(
    user: SessionUser,
    employeeId: string,
    personnel: Personnel,
  ): Promise<void> {
    if (!peut(user, 'personnel.gerer'))
      problem(403, 'auth.forbidden', 'Vous n’avez pas les droits nécessaires pour cette action');
    await this.db.withTenant(this.ctx(user), async (tx) => {
      const [dossier] = await tx
        .select({ status: t.employees.status })
        .from(t.employees)
        .where(eq(t.employees.id, employeeId))
        .limit(1);
      if (!dossier) problem(404, 'people.employee_not_found', 'Employé introuvable');
      if (dossier.status !== 'active') {
        problem(
          422,
          'people.dossier_inactif',
          'Ce dossier est inactif',
          'La fiche d’un agent inactif ne peut pas être modifiée : réactivez d’abord le dossier.',
        );
      }
      await tx
        .update(t.employees)
        .set({ personnel, updatedAt: new Date() })
        .where(eq(t.employees.id, employeeId));
    });
  }

  private async lignes(
    tx: Tx,
    annee: number,
    periode: PeriodeEvaluation | null,
    aujourdhui: string,
    filtre: ReturnType<typeof sql>,
    moi: string | null,
    /**
     * Qui lit le suivi gère le personnel : cadre ou non cadre se change alors
     * depuis la ligne de tout dossier en activité, le sien compris
     * (ADR-0157). false : en lecture seule.
     */
    gestion = false,
  ): Promise<LigneDEvaluation[]> {
    const { rows } = await tx.execute<{
      employee_id: string;
      prenom: string;
      nom: string;
      matricule: string;
      poste: string | null;
      direction: string | null;
      personnel: Personnel | null;
      personnel_modifiable: boolean;
      etat: EtatDeGrille | null;
      renvoyee: boolean;
      n1: string | null;
      n2_employee_id: string | null;
      manager: string | null;
      le: string | null;
    }>(sql`
      SELECT e.id AS employee_id, p.given_name AS prenom, p.family_name AS nom,
             e.employee_number AS matricule, a.position_title AS poste,
             (WITH RECURSIVE remontee AS (
                SELECT u.id, u.parent_id, u.unit_type, u.name, 0 AS prof
                  FROM org_units u WHERE u.id = a.org_unit_id AND u.deleted_at IS NULL
                UNION ALL
                SELECT o.id, o.parent_id, o.unit_type, o.name, r.prof + 1
                  FROM remontee r JOIN org_units o ON o.id = r.parent_id AND o.deleted_at IS NULL
                 WHERE r.prof < 64)
              SELECT coalesce(nullif(x.short_name, ''), x.name) FROM remontee rr
                JOIN org_units x ON x.id = rr.id
               WHERE rr.unit_type = 'direction' ORDER BY rr.prof LIMIT 1) AS direction,
             e.personnel,
             (${gestion}::boolean AND e.status = 'active') AS personnel_modifiable,
             g.etat,
             (g.etat = 'brouillon' AND g.renvoyee_le IS NOT NULL) AS renvoyee,
             CASE WHEN g.n2_employee_id = ${moi} AND g.etat IN ('chez_n2', 'validee_n2', 'terminee')
                  THEN (SELECT pv.given_name || ' ' || pv.family_name FROM employees v
                          JOIN persons pv ON pv.id = v.person_id WHERE v.id = g.evaluateur_employee_id)
                  ELSE (SELECT pm.given_name || ' ' || pm.family_name FROM employees m
                          JOIN persons pm ON pm.id = m.person_id WHERE m.id = e.manager_employee_id)
             END AS n1,
             g.n2_employee_id, e.manager_employee_id AS manager,
             (coalesce(g.terminee_le, g.validee_n2_le, g.reprise_n2_le, g.envoyee_n2_le,
                       g.validee_agent_le, g.renvoyee_le, g.envoyee_le,
                       g.updated_at) AT TIME ZONE 'UTC')::date::text AS le
        FROM employees e
        JOIN persons p ON p.id = e.person_id AND p.deleted_at IS NULL
        LEFT JOIN assignments a ON a.employee_id = e.id AND a.validity @> CURRENT_DATE
        LEFT JOIN evaluation_grilles g ON g.employee_id = e.id AND g.annee = ${annee}
       WHERE ${filtre}
       ORDER BY direction NULLS LAST, p.family_name, p.given_name`);
    return rows.map((r) => {
      const ouEnEst: OuEnEst = !r.etat
        ? 'a_remplir'
        : r.etat === 'brouillon'
          ? r.renvoyee
            ? 'renvoyee'
            : 'en_cours'
          : r.etat;
      return {
        employeeId: r.employee_id,
        nom: nomComplet(r.prenom, r.nom),
        matricule: r.matricule,
        poste: r.poste,
        direction: r.direction,
        personnel: r.personnel,
        personnelModifiable: r.personnel_modifiable,
        ouEnEst,
        n1: r.n1,
        enN2: Boolean(moi && r.n2_employee_id === moi && r.manager !== moi),
        enRetard: Boolean(periode && aujourdhui > periode.au && ouEnEst !== 'terminee'),
        le: r.le,
      };
    });
  }

  /** Les années où l'agent a une grille à lire. */
  async mesEvaluations(user: SessionUser): Promise<MesEvaluations> {
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const moi = await this.employeDuCompte(tx, user.userId);
      if (!moi) return { employeeId: null, annees: [] };
      const { rows } = await tx.execute<{ annee: number; etat: EtatDeGrille }>(sql`
        SELECT annee, etat FROM evaluation_grilles
         WHERE employee_id = ${moi} AND etat <> 'brouillon' ORDER BY annee DESC`);
      return { employeeId: moi, annees: rows.map((r) => ({ annee: r.annee, etat: r.etat })) };
    });
  }

  /**
   * Les grilles terminées d'un agent, à son dossier, avec les deux notes de
   * la synthèse du N+1 (ADR-0151) : pour la DCH qui suit l'évaluation.
   * Consulter les dossiers n'y suffit pas : une grille ne se lit pas comme une
   * adresse.
   */
  async dossier(user: SessionUser, employeeId: string): Promise<GrilleAuDossier[]> {
    if (!peut(user, 'pilotage')) {
      problem(403, 'auth.forbidden', 'Vous n’avez pas les droits nécessaires pour cette action');
    }
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const lignes = await tx
        .select({
          annee: t.evaluationGrilles.annee,
          modele: t.evaluationGrilles.modele,
          termineeLe: t.evaluationGrilles.termineeLe,
          contenu: t.evaluationGrilles.contenu,
        })
        .from(t.evaluationGrilles)
        .where(
          and(
            eq(t.evaluationGrilles.employeeId, employeeId),
            eq(t.evaluationGrilles.etat, 'terminee'),
          ),
        );
      return lignes
        .map((l) => {
          const { comprehension, tenue } = contenuDeGrilleSchema.parse(l.contenu);
          return {
            annee: l.annee,
            modele: l.modele as Personnel,
            termineeLe: iso(l.termineeLe)!,
            comprehension,
            tenue,
          };
        })
        .sort((a, b) => b.annee - a.annee);
    });
  }

  // ──────────────────────────────────────────────── une grille

  async grille(user: SessionUser, employeeId: string, annee: number): Promise<VueDeGrille> {
    return this.db.withTenant(this.ctx(user), async (tx) =>
      this.vue(tx, await this.contexte(tx, user, employeeId, annee)),
    );
  }

  /**
   * Le N+1 enregistre la grille telle qu'elle est, sur le modèle que dit la
   * fiche de l'agent ; le premier enregistrement la crée.
   */
  async enregistrer(
    user: SessionUser,
    employeeId: string,
    annee: number,
    contenu: ContenuDeGrille,
  ): Promise<VueDeGrille> {
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const c = await this.contexte(tx, user, employeeId, annee);
      this.exiger(c, 'enregistrer');
      const modele = this.modeleDe(c.agent);
      const lu = completerLaGrille(contenuDeGrilleSchema.parse(contenu), modele);
      const avant = c.grille ? contenuDeGrilleSchema.parse(c.grille.contenu).formations : [];
      const complet = {
        ...lu,
        formations: await this.formationsDuCatalogue(tx, lu.formations, avant),
      };
      if (!c.grille) {
        await tx.insert(t.evaluationGrilles).values({
          id: uuidv7(),
          tenantId: user.tenantId,
          employeeId,
          annee,
          modele,
          contenu: complet,
          evaluateurEmployeeId: c.moi,
        });
      } else {
        // La DCH a pu corriger la fiche entre-temps : la grille la suit.
        await this.passer(tx, c.grille, ['brouillon'], {
          modele,
          contenu: complet,
          evaluateurEmployeeId: c.moi,
        });
      }
      return this.vue(tx, await this.contexte(tx, user, employeeId, annee));
    });
  }

  /** Le N+1 envoie la grille complète à l'agent ; son modèle et l'identification s'y figent. */
  async envoyer(user: SessionUser, employeeId: string, annee: number): Promise<VueDeGrille> {
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const c = await this.contexte(tx, user, employeeId, annee);
      this.exiger(c, 'envoyer');
      if (!c.grille) problem(422, 'evaluations.vide', 'La grille n’est pas encore remplie');
      const modele = this.modeleDe(c.agent);
      const contenu = completerLaGrille(contenuDeGrilleSchema.parse(c.grille.contenu), modele);
      const manque = ceQuiManque(contenu, { modele, commandement: c.agent.encadre });
      if (manque.length > 0) {
        problem(422, 'evaluations.incomplete', 'La grille n’est pas complète', manque.join(' ; '));
      }
      if (!c.agent.userId) {
        problem(
          422,
          'evaluations.sans_acces',
          `${nomComplet(c.agent.prenom, c.agent.nom)} n’a pas encore accès au portail`,
          'L’agent doit valider sa grille sur le portail : envoyez l’invitation depuis sa fiche.',
        );
      }
      await this.passer(tx, c.grille, ['brouillon'], {
        etat: 'chez_agent',
        modele,
        identification: this.identification(c.agent, c.aujourdhui),
        evaluateurEmployeeId: c.moi,
        envoyeeLe: new Date(),
        renvoiMot: null,
        renvoyeeLe: null,
      });
      await tenirLesAppels(
        tx,
        user.tenantId,
        prefixeDeLaGrille(employeeId, annee),
        'agent',
        [c.agent.userId],
        {
          type: 'evaluation',
          sujet: 'evaluation',
          title: `${c.evaluateur ?? 'Votre N+1'} vous a envoyé votre grille d’évaluation ${annee} à valider`,
          link: lienDeLAgent(annee),
        },
      );
      return this.vue(tx, await this.contexte(tx, user, employeeId, annee));
    });
  }

  /** Le N+1 reprend la grille que l'agent n'a pas encore validée. */
  async reprendre(user: SessionUser, employeeId: string, annee: number): Promise<VueDeGrille> {
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const c = await this.contexte(tx, user, employeeId, annee);
      this.exiger(c, 'reprendre');
      await this.passer(tx, c.grille!, ['chez_agent'], { etat: 'brouillon' });
      await retirerLesAppels(tx, prefixeDeLaGrille(employeeId, annee));
      return this.vue(tx, await this.contexte(tx, user, employeeId, annee));
    });
  }

  /**
   * L'agent renvoie la grille au N+1, avec un mot. Elle redevient un
   * brouillon du N+1 et quitte la page de l'agent : la réponse est vide.
   */
  async renvoyer(user: SessionUser, employeeId: string, annee: number, mot: string): Promise<void> {
    await this.db.withTenant(this.ctx(user), async (tx) => {
      const c = await this.contexte(tx, user, employeeId, annee);
      this.exiger(c, 'renvoyer');
      await this.passer(tx, c.grille!, ['chez_agent'], {
        etat: 'brouillon',
        renvoiMot: mot,
        renvoyeeLe: new Date(),
      });
      await reconcilierLesGrilles(tx, employeeId);
    });
  }

  /** L'agent valide la grille, avec ses commentaires : c'est sa ratification. */
  async valider(
    user: SessionUser,
    employeeId: string,
    annee: number,
    commentaires: string,
  ): Promise<VueDeGrille> {
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const c = await this.contexte(tx, user, employeeId, annee);
      this.exiger(c, 'valider');
      await this.passer(tx, c.grille!, ['chez_agent'], {
        etat: 'validee_agent',
        commentairesAgent: commentaires || null,
        valideeAgentLe: new Date(),
      });
      await reconcilierLesGrilles(tx, employeeId);
      return this.vue(tx, await this.contexte(tx, user, employeeId, annee));
    });
  }

  /** Le N+1 envoie la grille validée au N+2, une première fois ou après l'avoir reprise. */
  async transmettre(user: SessionUser, employeeId: string, annee: number): Promise<VueDeGrille> {
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const c = await this.contexte(tx, user, employeeId, annee);
      this.exiger(c, 'transmettreAuN2');
      const n2 = c.agent.n2!;
      await this.passer(tx, c.grille!, ['validee_agent'], {
        etat: 'chez_n2',
        n2EmployeeId: n2.id,
        n2Identite: { nom: n2.nom, prenom: n2.prenom, fonction: n2.poste },
        envoyeeN2Le: new Date(),
        repriseN2Le: null,
      });
      const nom = nomComplet(c.agent.prenom, c.agent.nom);
      await tenirLesAppels(
        tx,
        user.tenantId,
        prefixeDeLaGrille(employeeId, annee),
        'n2',
        [n2.userId!],
        {
          type: 'evaluation',
          sujet: 'equipe.evaluations',
          title: `${c.evaluateur ?? 'Le N+1'} vous a envoyé la grille d’évaluation ${annee} de ${nom}`,
          link: lienDeLEquipe(employeeId, annee),
        },
      );
      return this.vue(tx, await this.contexte(tx, user, employeeId, annee));
    });
  }

  /**
   * Le N+1 reprend la grille au N+2, qui ne l'a pas encore validée
   * (ADR-0156) : elle revient au N+1, validée par l'agent, et part ensuite à
   * la DCH, ou de nouveau au N+2. L'appel du N+2 laisse la place à celui du
   * N+1 ; une notification annonce la reprise au N+2.
   */
  async reprendreAuN2(user: SessionUser, employeeId: string, annee: number): Promise<VueDeGrille> {
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const c = await this.contexte(tx, user, employeeId, annee);
      this.exiger(c, 'reprendreAuN2');
      const g = c.grille!;
      await this.passer(tx, g, ['chez_n2'], { etat: 'validee_agent', repriseN2Le: new Date() });
      await reconcilierLesGrilles(tx, employeeId);
      const n2 = g.n2EmployeeId ? await this.compteDe(tx, g.n2EmployeeId) : null;
      if (n2) {
        await notifier(tx, user.tenantId, n2, {
          type: 'evaluation',
          sujet: 'equipe.evaluations',
          title: `${c.evaluateur ?? 'Le N+1'} a repris la grille d’évaluation ${annee} de ${nomComplet(c.agent.prenom, c.agent.nom)}`,
          // Une clé par envoi : la grille peut repartir au N+2, et revenir encore.
          dedupeKey: `${prefixeDeLaGrille(employeeId, annee)}:reprise-n2:${iso(g.envoyeeN2Le)}`,
        });
      }
      return this.vue(tx, await this.contexte(tx, user, employeeId, annee));
    });
  }

  /**
   * Le N+1 envoie la grille à la DCH : validée par l'agent, ou validée par le
   * N+2. Chez le N+2, le N+1 attend l'avis du N+2, ou reprend d'abord la
   * grille (ADR-0156). Seul le N+1 l'envoie (ADR-0154). Ses appels s'en
   * vont ; une notification l'annonce à l'agent.
   */
  async terminer(user: SessionUser, employeeId: string, annee: number): Promise<VueDeGrille> {
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const c = await this.contexte(tx, user, employeeId, annee);
      this.exiger(c, 'terminer');
      await this.passer(tx, c.grille!, ['validee_agent', 'validee_n2'], {
        etat: 'terminee',
        termineeLe: new Date(),
      });
      const prefixe = prefixeDeLaGrille(employeeId, annee);
      await retirerLesAppels(tx, prefixe);
      if (c.agent.userId) {
        await notifier(tx, user.tenantId, c.agent.userId, {
          type: 'evaluation',
          sujet: 'evaluation',
          title: `Votre grille d’évaluation ${annee} est transmise à la DCH`,
          link: lienDeLAgent(annee),
          dedupeKey: `${prefixe}:terminee`,
        });
      }
      return this.vue(tx, await this.contexte(tx, user, employeeId, annee));
    });
  }

  /**
   * Le N+2 commente et valide : la grille revient au N+1, qui l'envoie à la
   * DCH (ADR-0154). L'appel du N+2 laisse la place à celui du N+1.
   */
  async commenter(
    user: SessionUser,
    employeeId: string,
    annee: number,
    commentaires: string,
  ): Promise<VueDeGrille> {
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const c = await this.contexte(tx, user, employeeId, annee);
      this.exiger(c, 'commenter');
      await this.passer(tx, c.grille!, ['chez_n2'], {
        etat: 'validee_n2',
        commentairesN2: commentaires || null,
        valideeN2Le: new Date(),
      });
      await reconcilierLesGrilles(tx, employeeId);
      return this.vue(tx, await this.contexte(tx, user, employeeId, annee));
    });
  }

  async pdf(user: SessionUser, employeeId: string, annee: number): Promise<DocumentPdf> {
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const c = await this.contexte(tx, user, employeeId, annee);
      this.exiger(c, 'pdf');
      const v = await this.vue(tx, c);
      const g = c.grille;
      const n2 = g?.n2Identite as { nom: string; prenom: string; fonction: string | null } | null;
      const imprimer =
        v.modele === 'non_cadre' ? grilleDuPersonnelNonCadre : grilleDuPersonnelCadre;
      const pdf = await imprimer({
        annee,
        identification: v.identification,
        contenu: v.contenu,
        commandement: v.commandement,
        nouveauAuPoste: v.contenu.nouveauAuPoste ?? v.identification.nouveauAuPoste,
        ratification: {
          evaluateur: v.identification.evaluateur,
          envoyeeLe: g?.etat !== 'brouillon' ? jour(g?.envoyeeLe ?? null) : null,
          agent: v.identification.agent,
          valideeLe: jour(g?.valideeAgentLe ?? null),
          commentaires: v.commentairesAgent,
        },
        n2: n2
          ? {
              nom: g?.valideeN2Le ? n2.nom.toUpperCase() : null,
              prenom: g?.valideeN2Le ? n2.prenom : null,
              fonction: g?.valideeN2Le ? n2.fonction : null,
              le: jour(g?.valideeN2Le ?? null),
              commentaires: v.commentairesN2,
            }
          : null,
      });
      return { filename: nomDeLaGrille(annee, c.agent.matricule), pdf };
    });
  }

  // ──────────────────────────────────────────────── le contexte et la vue

  private async contexte(
    tx: Tx,
    user: SessionUser,
    employeeId: string,
    annee: number,
  ): Promise<Contexte> {
    const agent = await this.agent(tx, employeeId);
    const [grille] = await tx
      .select()
      .from(t.evaluationGrilles)
      .where(
        and(eq(t.evaluationGrilles.employeeId, employeeId), eq(t.evaluationGrilles.annee, annee)),
      )
      .limit(1);
    const moi = await this.employeDuCompte(tx, user.userId);
    const periode = await this.periodeDe(tx, annee);
    const aujourdhui = await this.aujourdhui(tx);
    const n1Courant = Boolean(moi && agent.n1?.id === moi);
    let role: RoleDansLaGrille | null = null;
    if (moi && moi === employeeId) role = 'agent';
    else if (n1Courant) role = 'n1';
    else if (
      moi &&
      grille?.n2EmployeeId === moi &&
      ['chez_n2', 'validee_n2', 'terminee'].includes(grille.etat)
    ) {
      role = 'n2';
    } else if (moi && grille?.evaluateurEmployeeId === moi && grille.etat !== 'brouillon') {
      role = 'n1';
    } else if (grille?.etat === 'terminee' && peut(user, 'pilotage')) {
      role = 'dch';
    }
    if (!role) {
      problem(
        403,
        'evaluations.hors_perimetre',
        'Vous n’avez pas accès à cette grille d’évaluation',
      );
    }
    if (role === 'agent' && (!grille || grille.etat === 'brouillon')) {
      problem(
        404,
        'evaluations.pas_encore',
        `Votre grille d’évaluation ${annee} n’est pas encore disponible`,
      );
    }
    const prefill = grille
      ? null
      : await this.grilleNeuve(tx, employeeId, annee, agent.personnel ?? 'cadre');
    const parQui = grille?.evaluateurEmployeeId ?? agent.n1?.id ?? null;
    const evaluateur =
      parQui && parQui === agent.n1?.id
        ? nomComplet(agent.n1.prenom, agent.n1.nom)
        : parQui
          ? await this.nomDe(tx, parQui)
          : null;
    return {
      moi,
      annee,
      agent,
      grille: grille ?? null,
      prefill,
      periode,
      aujourdhui,
      role,
      n1Courant,
      evaluateur,
    };
  }

  /**
   * Une grille neuve. Dans celle du personnel cadre, les objectifs à venir de
   * la grille précédente deviennent le rappel des objectifs de l'année
   * écoulée, que le N+1 corrige. Celle du personnel non cadre n'a pas
   * d'objectifs.
   */
  private async grilleNeuve(
    tx: Tx,
    employeeId: string,
    annee: number,
    modele: Personnel,
  ): Promise<ContenuDeGrille> {
    const vide = grilleVide(modele);
    if (modele === 'non_cadre') return vide;
    const [precedente] = await tx
      .select({ contenu: t.evaluationGrilles.contenu })
      .from(t.evaluationGrilles)
      .where(
        and(
          eq(t.evaluationGrilles.employeeId, employeeId),
          sql`${t.evaluationGrilles.annee} < ${annee}`,
        ),
      )
      .orderBy(sql`${t.evaluationGrilles.annee} DESC`)
      .limit(1);
    if (!precedente) return vide;
    const aVenir = contenuDeGrilleSchema
      .parse(precedente.contenu)
      .objectifsAVenir.map((o) => o.texte)
      .filter(Boolean)
      .slice(0, OBJECTIFS_ECOULES);
    if (aVenir.length === 0) return vide;
    return {
      ...vide,
      objectifs: aVenir.map((texte) => ({ texte: texteRicheDe(texte), niveau: null })),
    };
  }

  /**
   * Les formations que le N+1 peut demander pour l'agent : le catalogue de
   * l'APIX Academy, sans ce que l'agent a terminé ou obtenu, ni ce que
   * l'agent anime (ADR-0150).
   */
  private async formationsProposables(tx: Tx, employeeId: string): Promise<FormationProposable[]> {
    const suivi = (await this.academy.suivi(tx, [employeeId])).get(employeeId) ?? [];
    const animees = await tx
      .select({ id: t.academyCourses.id })
      .from(t.academyCourses)
      .where(eq(t.academyCourses.formateurEmployeeId, employeeId));
    const exclues = new Set(animees.map((a) => a.id));
    return suivi
      .filter((f) => f.courseId && !exclues.has(f.courseId))
      .filter((f) => f.status !== 'terminee' && f.status !== 'certifiee')
      .map((f) => ({ courseId: f.courseId!, titre: f.title }))
      .sort((a, b) => a.titre.localeCompare(b.titre, 'fr'));
  }

  /**
   * Les besoins de formation, ceux du catalogue tels qu'il les connaît :
   * une formation publiée, sous son titre d'aujourd'hui. Une formation déjà
   * demandée, retirée du catalogue depuis, se garde sous son titre. Un
   * besoin écrit par le N+1, hors du catalogue, se garde tel qu'il est écrit.
   */
  private async formationsDuCatalogue(
    tx: Tx,
    demandees: ContenuDeGrille['formations'],
    deja: ContenuDeGrille['formations'],
  ): Promise<ContenuDeGrille['formations']> {
    const ids = demandees.flatMap((f) => (f.courseId ? [f.courseId] : []));
    const publiees =
      ids.length === 0
        ? []
        : await tx
            .select({ id: t.academyCourses.id, titre: t.academyCourses.title })
            .from(t.academyCourses)
            .where(and(inArray(t.academyCourses.id, ids), isNotNull(t.academyCourses.publishedAt)));
    const titres = new Map<string, string>([
      ...deja.flatMap((f) => (f.courseId ? [[f.courseId, f.titre] as const] : [])),
      ...publiees.map((p) => [p.id, p.titre] as const),
    ]);
    const inconnue = demandees.find((f) => f.courseId && !titres.has(f.courseId));
    if (inconnue) {
      problem(
        422,
        'evaluations.formation',
        `La formation « ${inconnue.titre} » n’est pas au catalogue de l’APIX Academy`,
      );
    }
    return demandees.map((f) =>
      f.courseId ? { courseId: f.courseId, titre: titres.get(f.courseId)! } : f,
    );
  }

  private actions(c: Contexte): ActionsSurLaGrille {
    const e = c.grille?.etat ?? null;
    const ouverte = Boolean(c.periode && c.periode.du <= c.aujourdhui);
    const remplir = c.n1Courant && ouverte && (e === null || e === 'brouillon');
    const n2 = c.agent.n2;
    return {
      enregistrer: remplir,
      envoyer: remplir,
      reprendre: c.n1Courant && e === 'chez_agent',
      renvoyer: c.role === 'agent' && e === 'chez_agent',
      valider: c.role === 'agent' && e === 'chez_agent',
      transmettreAuN2: c.n1Courant && e === 'validee_agent' && Boolean(n2?.userId),
      reprendreAuN2: c.n1Courant && e === 'chez_n2',
      terminer: c.n1Courant && (e === 'validee_agent' || e === 'validee_n2'),
      commenter: c.role === 'n2' && e === 'chez_n2',
      pdf: c.role === 'n1' || c.role === 'n2' || (c.role === 'dch' && e === 'terminee'),
    };
  }

  private exiger(c: Contexte, action: keyof ActionsSurLaGrille) {
    if (this.actions(c)[action]) return;
    if (action === 'pdf') {
      problem(
        403,
        'evaluations.pdf_reserve',
        'Le PDF de la grille est réservé à la hiérarchie et à la DCH',
      );
    }
    if (action === 'terminer' && c.n1Courant && c.grille?.etat === 'chez_n2') {
      problem(
        409,
        'evaluations.chez_n2',
        'La grille est chez le N+2',
        'Attendez son avis, ou reprenez la grille avant de l’envoyer à la DCH.',
      );
    }
    if (action === 'enregistrer' || action === 'envoyer') {
      if (c.n1Courant && !(c.periode && c.periode.du <= c.aujourdhui)) {
        problem(
          422,
          'evaluations.periode_fermee',
          `La période d’évaluation ${c.annee} n’est pas ouverte`,
        );
      }
    }
    problem(
      409,
      'evaluations.etat',
      'La grille est déjà passée à une autre étape : rechargez la page',
    );
  }

  /** Passe la grille d'un état attendu au suivant ; refusé si elle a changé entre-temps. */
  private async passer(
    tx: Tx,
    g: Grille,
    depuis: EtatDeGrille[],
    champs: Partial<typeof t.evaluationGrilles.$inferInsert>,
  ) {
    const faits = await tx
      .update(t.evaluationGrilles)
      .set({ ...champs, updatedAt: new Date() })
      .where(
        and(
          eq(t.evaluationGrilles.id, g.id),
          sql`${t.evaluationGrilles.etat} IN (${sql.join(
            depuis.map((d) => sql`${d}`),
            sql`, `,
          )})`,
        ),
      )
      .returning({ id: t.evaluationGrilles.id });
    if (faits.length === 0) {
      problem(409, 'evaluations.etat', 'La grille a changé entre-temps : rechargez la page');
    }
  }

  private modeleDe(agent: Agent): Personnel {
    if (!agent.personnel) {
      problem(
        422,
        'evaluations.personnel',
        `${nomComplet(agent.prenom, agent.nom)} : cadre ou non-cadre à renseigner`,
        'La DCH doit l’indiquer sur la fiche de l’agent.',
      );
    }
    return agent.personnel;
  }

  private async vue(tx: Tx, c: Contexte): Promise<VueDeGrille> {
    const g = c.grille;
    // Chez le N+1, la grille suit la fiche de l'agent ; partie, elle garde son modèle.
    const modele: Personnel =
      g && g.etat !== 'brouillon'
        ? (g.modele as Personnel)
        : (c.agent.personnel ?? (g?.modele as Personnel | undefined) ?? 'cadre');
    let contenu = g
      ? completerLaGrille(contenuDeGrilleSchema.parse(g.contenu), modele)
      : (c.prefill ?? grilleVide(modele));
    if (c.role === 'agent') {
      // La dernière page est réservée à la hiérarchie.
      contenu = { ...contenu, comprehension: null, tenue: null, observations: [] };
    }
    const figee =
      g && g.etat !== 'brouillon' ? (g.identification as IdentificationDeGrille | null) : null;
    const identification = figee ?? this.identification(c.agent, c.aujourdhui);
    const n2Fige = g?.n2Identite as { nom: string; prenom: string; fonction: string | null } | null;
    const actions = this.actions(c);
    const n2 = n2Fige
      ? { nom: `${n2Fige.prenom} ${n2Fige.nom}`, fonction: n2Fige.fonction }
      : c.agent.n2 && c.role !== 'agent'
        ? { nom: nomComplet(c.agent.n2.prenom, c.agent.n2.nom), fonction: c.agent.n2.poste }
        : null;
    return {
      employeeId: c.agent.id,
      annee: g?.annee ?? c.annee,
      modele,
      personnel: c.agent.personnel,
      etat: (g?.etat as EtatDeGrille | undefined) ?? null,
      role: c.role,
      agent: { nom: nomComplet(c.agent.prenom, c.agent.nom), poste: c.agent.poste },
      evaluateur: c.evaluateur,
      identification,
      commandement: c.agent.encadre,
      contenu,
      formationsProposables: actions.enregistrer
        ? await this.formationsProposables(tx, c.agent.id)
        : [],
      commentairesAgent: g?.commentairesAgent ?? '',
      commentairesN2: c.role === 'agent' ? '' : (g?.commentairesN2 ?? ''),
      renvoi:
        g?.etat === 'brouillon' && g.renvoyeeLe && g.renvoiMot
          ? { mot: g.renvoiMot, le: iso(g.renvoyeeLe)! }
          : null,
      n2: c.role === 'agent' ? null : n2,
      periode: c.periode,
      dates: {
        envoyeeLe: iso(g?.envoyeeLe ?? null),
        valideeAgentLe: iso(g?.valideeAgentLe ?? null),
        envoyeeN2Le: c.role === 'agent' ? null : iso(g?.envoyeeN2Le ?? null),
        repriseN2Le: c.role === 'agent' ? null : iso(g?.repriseN2Le ?? null),
        valideeN2Le: c.role === 'agent' ? null : iso(g?.valideeN2Le ?? null),
        termineeLe: iso(g?.termineeLe ?? null),
      },
      actions,
    };
  }

  /** Ce que la page 1 imprime, lu aujourd'hui dans le dossier et l'organigramme. */
  private identification(
    a: Agent & { unites: Unites },
    aujourdhui: string,
  ): IdentificationDeGrille {
    const anciennete = a.posteDepuis ? ancienneteEnLettres(a.posteDepuis, aujourdhui) : null;
    const unAn = a.posteDepuis
      ? `${Number(a.posteDepuis.slice(0, 4)) + 1}${a.posteDepuis.slice(4)}` > aujourdhui
      : false;
    return {
      ...a.unites,
      agent: nomDuDocument(a.prenom, a.nom),
      matricule: a.matricule,
      fonction: a.poste,
      anciennete,
      nouveauAuPoste: unAn,
      evaluateur: a.n1 ? nomDuDocument(a.n1.prenom, a.n1.nom) : null,
      fonctionEvaluateur: a.n1?.poste ?? null,
    };
  }

  // ──────────────────────────────────────────────── lectures

  private async aujourdhui(tx: Tx): Promise<string> {
    const { rows } = await tx.execute<{ jour: string }>(sql`SELECT CURRENT_DATE::text AS jour`);
    return rows[0]!.jour;
  }

  /** « Awa Diop » : le prénom et le nom d'un agent. */
  private async nomDe(tx: Tx, employeeId: string): Promise<string | null> {
    const { rows } = await tx.execute<{ nom: string }>(sql`
      SELECT p.given_name || ' ' || p.family_name AS nom
        FROM employees e JOIN persons p ON p.id = e.person_id WHERE e.id = ${employeeId}`);
    return rows[0]?.nom ?? null;
  }

  /** Le compte relié au dossier d'un agent ; null : sans compte. */
  private async compteDe(tx: Tx, employeeId: string): Promise<string | null> {
    const { rows } = await tx.execute<{ user_id: string | null }>(sql`
      SELECT p.user_id FROM employees e JOIN persons p ON p.id = e.person_id
       WHERE e.id = ${employeeId} AND p.deleted_at IS NULL`);
    return rows[0]?.user_id ?? null;
  }

  /** Le dossier d'agent actif relié au compte. */
  private async employeDuCompte(tx: Tx, userId: string): Promise<string | null> {
    const { rows } = await tx.execute<{ id: string }>(sql`
      SELECT e.id FROM employees e JOIN persons p ON p.id = e.person_id
       WHERE p.user_id = ${userId} AND p.deleted_at IS NULL AND e.status = 'active'
       LIMIT 1`);
    return rows[0]?.id ?? null;
  }

  private async agent(tx: Tx, employeeId: string): Promise<Agent & { unites: Unites }> {
    const { rows } = await tx.execute<{
      id: string;
      prenom: string;
      nom: string;
      user_id: string | null;
      matricule: string;
      personnel: Personnel | null;
      poste: string | null;
      poste_depuis: string | null;
      unite_id: string | null;
      encadre: boolean;
      n1_id: string | null;
      n1_prenom: string | null;
      n1_nom: string | null;
      n1_user: string | null;
      n1_poste: string | null;
      n2_id: string | null;
      n2_prenom: string | null;
      n2_nom: string | null;
      n2_user: string | null;
      n2_poste: string | null;
    }>(sql`
      SELECT e.id, p.given_name AS prenom, p.family_name AS nom, p.user_id,
             e.employee_number AS matricule, e.personnel,
             a.position_title AS poste, lower(a.validity)::text AS poste_depuis,
             a.org_unit_id AS unite_id,
             EXISTS (SELECT 1 FROM employees s WHERE s.manager_employee_id = e.id
                        AND s.status = 'active') AS encadre,
             n.id AS n1_id, pn.given_name AS n1_prenom, pn.family_name AS n1_nom,
             CASE WHEN pn.deleted_at IS NULL THEN pn.user_id END AS n1_user,
             an.position_title AS n1_poste,
             d.id AS n2_id, pd.given_name AS n2_prenom, pd.family_name AS n2_nom,
             CASE WHEN pd.deleted_at IS NULL THEN pd.user_id END AS n2_user,
             ad.position_title AS n2_poste
        FROM employees e
        JOIN persons p ON p.id = e.person_id
        LEFT JOIN assignments a ON a.employee_id = e.id AND a.validity @> CURRENT_DATE
        LEFT JOIN employees n ON n.id = e.manager_employee_id AND n.status = 'active'
        LEFT JOIN persons pn ON pn.id = n.person_id
        LEFT JOIN assignments an ON an.employee_id = n.id AND an.validity @> CURRENT_DATE
        LEFT JOIN employees d ON d.id = n.manager_employee_id AND d.status = 'active'
        LEFT JOIN persons pd ON pd.id = d.person_id
        LEFT JOIN assignments ad ON ad.employee_id = d.id AND ad.validity @> CURRENT_DATE
       WHERE e.id = ${employeeId}`);
    const r = rows[0];
    if (!r) problem(404, 'people.employee_not_found', 'Employé introuvable');
    return {
      id: r.id,
      prenom: r.prenom,
      nom: r.nom,
      userId: r.user_id,
      matricule: r.matricule,
      personnel: r.personnel,
      poste: r.poste,
      posteDepuis: r.poste_depuis,
      uniteId: r.unite_id,
      encadre: r.encadre,
      n1: r.n1_id
        ? {
            id: r.n1_id,
            prenom: r.n1_prenom!,
            nom: r.n1_nom!,
            userId: r.n1_user,
            poste: r.n1_poste,
          }
        : null,
      n2: r.n2_id
        ? {
            id: r.n2_id,
            prenom: r.n2_prenom!,
            nom: r.n2_nom!,
            userId: r.n2_user,
            poste: r.n2_poste,
          }
        : null,
      unites: await this.unites(tx, r.unite_id),
    };
  }

  /** La direction, le département et le service d'une unité, en remontant l'organigramme. */
  private async unites(tx: Tx, uniteId: string | null): Promise<Unites> {
    const vide: Unites = { direction: null, departement: null, service: null };
    if (!uniteId) return vide;
    const { rows } = await tx.execute<{ unit_type: string; name: string }>(sql`
      WITH RECURSIVE remontee AS (
        SELECT id, parent_id, unit_type, name, 0 AS prof
          FROM org_units WHERE id = ${uniteId} AND deleted_at IS NULL
        UNION ALL
        SELECT o.id, o.parent_id, o.unit_type, o.name, r.prof + 1
          FROM remontee r JOIN org_units o ON o.id = r.parent_id AND o.deleted_at IS NULL
         WHERE r.prof < 64 AND r.unit_type <> 'direction')
      SELECT unit_type, name FROM remontee ORDER BY prof`);
    const premier = (type: string) => rows.find((u) => u.unit_type === type)?.name ?? null;
    return {
      direction: premier('direction'),
      departement: premier('department'),
      service: premier('service'),
    };
  }
}

interface Unites {
  direction: string | null;
  departement: string | null;
  service: string | null;
}
