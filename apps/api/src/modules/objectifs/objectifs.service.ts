import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import {
  type CreerObjectifInput,
  type EvaluerObjectifInput,
  type FicheSuivi,
  type FormationProposable,
  type MembreSuivi,
  type MesObjectifs,
  type EnregistrerFicheObjectifsInput,
  type FicheObjectifs,
  FICHE_OBJECTIFS_MAX,
  type FormationDeLaFiche,
  type StatutObjectifInput,
  type StatutObjectif,
  type CommentairesAgentInput,
  type EvaluationN1Input,
  type EvaluationValidee,
  type NoteGlobale,
  objectifsDeLaFiche,
  type ModifierObjectifInput,
  type ObjectifsAPIX,
  type ObjectifView,
  type SessionUser,
  type SuiviEquipe,
  type TeamCourseProgress,
} from '@teranga/contracts';
import { problem } from '../../common/problem';
import { TenantDb, type Tx } from '../../db/tenant-db';
import { duSemestre } from '../notifications/phrases';
import { AcademyEquipeService } from '../academy/academy-equipe.service';
import { employeActif } from '../academy/academy-evaluation.service';
import { notifier } from '../notifications/notifier';
import {
  DG,
  SOMMET,
  directeurGeneral,
  directionDeEmploye,
  directionDeLUnite,
  dirigeUneDirection,
  uniteEnVigueur,
} from '../people/chaine';

/* ————————————————————————————————————————————————————————————————
   Les objectifs — qui les fixe, qui les voit.

   · Le directeur général fixe les orientations de l'APIX, diffusées à tous
     les agents ou aux directeurs seulement, et les objectifs de chaque
     direction (hors Direction Générale : ses orientations en tiennent lieu).
   · Le n+1 fixe ceux de ses DIRECTS — libres, ou une formation de l'Academy
     à suivre — et les évalue. Le n+1 qui compte est celui d'AUJOURD'HUI : un
     agent qui change de responsable garde ses objectifs, que le nouveau
     reprend.
   · L'agent voit les orientations qui lui sont diffusées, les objectifs de
     sa direction, et les siens.

   Tout se lit dans l'organigramme, comme la chaîne des visas : aucun rôle,
   aucune case à cocher.
   ———————————————————————————————————————————————————————————————— */

interface LigneObjectif extends Record<string, unknown> {
  id: string;
  niveau: 'apix' | 'direction' | 'individuel';
  annee: number;
  diffusion: 'tous' | 'directeurs' | null;
  direction_id: string | null;
  employee_id: string | null;
  nature: 'libre' | 'formation';
  course_id: string | null;
  titre: string;
  description: string | null;
  echeance: string | Date | null;
  evaluation: 'atteint' | 'partiel' | 'non_atteint' | null;
  evalue_le: string | Date | null;
  commentaire: string | null;
  auteur: string | null;
  created_at: string | Date;
}

interface LigneMembre extends Record<string, unknown> {
  id: string;
  employee_number: string;
  given_name: string;
  family_name: string;
  position_title: string | null;
  unite: string | null;
  direction_abrege: string | null;
  direction_nom: string | null;
  work_email: string | null;
  work_phone: string | null;
  phone: string | null;
  /** Parti de l'APIX : il ne reste là que le temps que son n+1 l'évalue. */
  parti: boolean;
}

/** Parti de l'APIX en laissant une auto-évaluation envoyée, pas encore validée. En SQL. */
const evaluationEnSuspens = (employeeId: SQL) => sql`(
  (SELECT es.status FROM employees es WHERE es.id = ${employeeId}) <> 'active'
  AND EXISTS (
    SELECT 1 FROM objectifs_fiches fs
     WHERE fs.employee_id = ${employeeId}
       AND fs.commentaires_envoyes_le IS NOT NULL AND fs.evaluation_validee_le IS NULL))`;

const iso = (d: string | Date | null): string | null =>
  d === null ? null : d instanceof Date ? d.toISOString() : new Date(d).toISOString();
const jour = (d: string | Date | null): string | null =>
  d === null ? null : typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);

/**
 * Une fiche vient du navigateur : on n'y garde que des liens qu'on peut
 * suivre sans risque — http(s) et mailto. Un « javascript: » glissé dans un
 * bloc perdrait sa cible, le texte reste.
 */
function assainir(valeur: unknown): unknown {
  if (Array.isArray(valeur)) return valeur.map(assainir);
  if (valeur === null || typeof valeur !== 'object') return valeur;
  const objet: Record<string, unknown> = {};
  for (const [cle, v] of Object.entries(valeur)) objet[cle] = assainir(v);
  if (objet.type === 'link' && typeof objet.href === 'string') {
    objet.href = /^(https?:|mailto:)/i.test(objet.href.trim()) ? objet.href.trim() : '';
  }
  return objet;
}

/** Une fiche dit quelque chose dès qu'un bloc porte du texte, une échéance ou une formation. */
function ficheRemplie(contenu: unknown): boolean {
  const texte = JSON.stringify(contenu);
  return /"text":"\s*[^"\s]/.test(texte) || /"type":"(echeance|formation)"/.test(texte);
}

/** Où en est l'agent des formations commencées — ce que les blocs « Formation » affichent. */
function formationsDe(progression: TeamCourseProgress[] | undefined): FormationDeLaFiche[] {
  return (progression ?? [])
    .filter((f): f is TeamCourseProgress & { courseId: string } => f.courseId !== null)
    .map((f) => ({
      courseId: f.courseId,
      statut: f.status,
      lecons: f.lessonCount,
      validees: f.completedLessons,
    }));
}

/** Une fiche d'objectifs, telle que la base la garde. */
type LigneFiche = {
  id: string;
  annee: number;
  semestre: number;
  contenu: Record<string, unknown>[];
  updated_at: string | Date;
  auteur: string | null;
  statuts: Record<string, StatutObjectif>;
  commentaires_agent: Record<string, string>;
  commentaires_envoyes_le: string | Date | null;
  commentaires_n1: Record<string, string>;
  evaluation_note: NoteGlobale | null;
  evaluation_validee_le: string | Date | null;
  evaluateur: string | null;
};

const SELECTION_FICHE = sql`
  SELECT f.id, f.annee, f.semestre, f.contenu, f.updated_at,
         CASE WHEN pa.id IS NULL THEN NULL ELSE pa.given_name || ' ' || pa.family_name END AS auteur,
         f.statuts, f.commentaires_agent, f.commentaires_envoyes_le, f.commentaires_n1,
         f.evaluation_note, f.evaluation_validee_le,
         CASE WHEN pv.id IS NULL THEN NULL ELSE pv.given_name || ' ' || pv.family_name END AS evaluateur
    FROM objectifs_fiches f
    LEFT JOIN employees ea ON ea.id = f.auteur_employee_id
    LEFT JOIN persons pa ON pa.id = ea.person_id
    LEFT JOIN employees ev ON ev.id = f.evaluateur_employee_id
    LEFT JOIN persons pv ON pv.id = ev.person_id`;

/**
 * Les cases de la fiche disent ce que l'agent en dit : cochée, l'objectif est
 * atteint. Ce que le n+1 aurait coché en rédigeant ne compte pas.
 */
function avecLesStatuts(
  blocs: unknown,
  statuts: Record<string, StatutObjectif>,
): Record<string, unknown>[] {
  if (!Array.isArray(blocs)) return [];
  return (blocs as Record<string, unknown>[]).map((b) => {
    const enfants = avecLesStatuts(b.children, statuts);
    if (b.type !== 'checkListItem') return { ...b, children: enfants };
    return {
      ...b,
      props: {
        ...(b.props as Record<string, unknown>),
        checked: statuts[String(b.id)] === 'atteint',
      },
      children: enfants,
    };
  });
}

function vueFiche(l: LigneFiche, vue: 'agent' | 'n1'): FicheObjectifs {
  const envoyes = l.commentaires_envoyes_le !== null;
  const validee = l.evaluation_validee_le !== null;
  const voitN1 = vue === 'n1' || validee;
  return {
    annee: l.annee,
    semestre: l.semestre === 1 ? 1 : 2,
    contenu: avecLesStatuts(l.contenu, l.statuts),
    majLe: iso(l.updated_at)!,
    auteur: l.auteur,
    statuts: l.statuts,
    evaluation: {
      commentairesAgent: vue === 'agent' || envoyes ? l.commentaires_agent : {},
      envoyesLe: iso(l.commentaires_envoyes_le),
      commentairesN1: voitN1 ? l.commentaires_n1 : {},
      note: voitN1 ? l.evaluation_note : null,
      valideeLe: iso(l.evaluation_validee_le),
      evaluateur: voitN1 ? l.evaluateur : null,
    },
  };
}

/** Des commentaires, réduits aux objectifs de la fiche — un objectif retiré emporte le sien. */
function garderLesObjectifs(
  f: LigneFiche,
  commentaires: Record<string, string>,
): Record<string, string> {
  const ids = new Set(objectifsDeLaFiche(f.contenu).map((o) => o.id));
  return Object.fromEntries(Object.entries(commentaires).filter(([id]) => ids.has(id)));
}

function exigerNonEnvoyee(f: LigneFiche): void {
  if (f.commentaires_envoyes_le) {
    problem(409, 'objectifs.auto_evaluation_envoyee', 'Votre auto-évaluation est déjà envoyée');
  }
}

function exigerEvaluable(f: LigneFiche): void {
  if (!f.commentaires_envoyes_le) {
    problem(
      409,
      'objectifs.auto_evaluation_attendue',
      'L’agent n’a pas encore envoyé son auto-évaluation',
    );
  }
  if (f.evaluation_validee_le) {
    problem(409, 'objectifs.evaluation_validee', 'Cette évaluation est déjà validée');
  }
}

/** Les objectifs, avec le nom de qui les a fixés. */
const SELECTION = sql`
  SELECT o.id, o.niveau, o.annee, o.diffusion, o.direction_id, o.employee_id, o.nature,
         o.course_id, o.titre, o.description, o.echeance::text AS echeance, o.evaluation,
         o.evalue_le, o.commentaire, o.created_at,
         CASE WHEN pa.id IS NULL THEN NULL ELSE pa.given_name || ' ' || pa.family_name END AS auteur
    FROM objectifs o
    LEFT JOIN employees ea ON ea.id = o.auteur_employee_id
    LEFT JOIN persons pa ON pa.id = ea.person_id`;

@Injectable()
export class ObjectifsService {
  /** L'horloge du serveur — remplaçable dans les tests seulement. */
  horloge: () => Date = () => new Date();

  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(AcademyEquipeService) private readonly academy: AcademyEquipeService,
  ) {}

  private ctx(user: SessionUser) {
    return { tenantId: user.tenantId, userId: user.userId };
  }

  private anneeCourante(): number {
    return this.horloge().getUTCFullYear();
  }

  private aujourdhui(): string {
    return this.horloge().toISOString().slice(0, 10);
  }

  // ———————————————————————————— lectures

  /** « Mes objectifs » : l'APIX (selon la diffusion), la direction, les siens. */
  async mesObjectifs(user: SessionUser, annee?: number): Promise<MesObjectifs> {
    const an = annee ?? this.anneeCourante();
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const moi = await this.exigerAgent(tx, user);
      const cadre = (await directeurGeneral(tx)) === moi || (await dirigeUneDirection(tx, moi));
      const apix = await this.lire(
        tx,
        sql`o.niveau = 'apix' AND o.annee = ${an}
            AND (o.diffusion = 'tous' OR (${cadre} AND o.diffusion = 'directeurs'))`,
      );
      const direction = await this.directionSaufSommet(tx, moi);
      const deLaDirection = direction
        ? await this.lire(
            tx,
            sql`o.niveau = 'direction' AND o.annee = ${an} AND o.direction_id = ${direction.id}`,
          )
        : [];
      const individuels = await this.lire(
        tx,
        sql`o.niveau = 'individuel' AND o.annee = ${an} AND o.employee_id = ${moi}`,
      );
      const progression = await this.progression(tx, [moi]);
      return {
        annee: an,
        fiches: await this.lireFiches(tx, moi, 'agent'),
        formations: formationsDe(progression.get(moi)),
        apix: apix.map((o) => this.vue(o)),
        direction: direction
          ? { ...direction, objectifs: deLaDirection.map((o) => this.vue(o)) }
          : null,
        individuels: individuels.map((o) => this.vue(o, progression.get(moi))),
      };
    });
  }

  /** « Suivi & Évaluation » : les directs, et où en sont leurs objectifs. */
  async suiviEquipe(user: SessionUser, annee?: number): Promise<SuiviEquipe> {
    const an = annee ?? this.anneeCourante();
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const moi = await this.exigerAgent(tx, user);
      const membres = await this.directs(tx, moi, true);
      const ids = membres.map((m) => m.id);
      const objectifs = ids.length
        ? await this.lire(
            tx,
            sql`o.niveau = 'individuel' AND o.annee = ${an} AND o.employee_id IN ${ids}`,
          )
        : [];
      const progression = await this.progression(tx, ids);
      const aEvaluer = new Map<string, number>();
      if (ids.length) {
        const { rows } = await tx.execute<{ employee_id: string; n: number }>(sql`
          SELECT employee_id, count(*)::int AS n FROM objectifs_fiches
           WHERE employee_id IN ${ids}
             AND commentaires_envoyes_le IS NOT NULL AND evaluation_validee_le IS NULL
           GROUP BY employee_id`);
        for (const r of rows) aEvaluer.set(r.employee_id, r.n);
      }
      return {
        annee: an,
        membres: membres.map((m) =>
          this.membre(
            m,
            objectifs
              .filter((o) => o.employee_id === m.id)
              .map((o) => this.vue(o, progression.get(m.id))),
            aEvaluer.get(m.id) ?? 0,
          ),
        ),
      };
    });
  }

  async fiche(user: SessionUser, employeeId: string, annee?: number): Promise<FicheSuivi> {
    const an = annee ?? this.anneeCourante();
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const moi = await this.exigerAgent(tx, user);
      const membre = (await this.directs(tx, moi, true)).find((m) => m.id === employeeId);
      if (!membre) {
        problem(404, 'objectifs.hors_equipe', 'Cet agent ne fait pas partie de votre équipe');
      }
      const progression = await this.progression(tx, [membre.id]);
      const objectifs = (
        await this.lire(
          tx,
          sql`o.niveau = 'individuel' AND o.annee = ${an} AND o.employee_id = ${membre.id}`,
        )
      ).map((o) => this.vue(o, progression.get(membre.id)));
      const fiches = await this.lireFiches(tx, membre.id, 'n1');
      const aEvaluer = fiches.filter(
        (f) => f.evaluation.envoyesLe && !f.evaluation.valideeLe,
      ).length;
      return {
        annee: an,
        membre: this.membre(membre, objectifs, aEvaluer),
        objectifs,
        fiches,
        formations: formationsDe(progression.get(membre.id)),
      };
    });
  }

  /**
   * Le n+1 enregistre la fiche d'objectifs de son direct pour un semestre —
   * à chaque pause de la saisie. L'agent en est prévenu une fois par jour et
   * par fiche, pas à chaque enregistrement.
   */
  async enregistrerFiche(
    user: SessionUser,
    employeeId: string,
    input: EnregistrerFicheObjectifsInput,
  ): Promise<{ majLe: string }> {
    const an = input.annee ?? this.anneeCourante();
    const contenu = assainir(input.contenu);
    const json = JSON.stringify(contenu);
    if (json.length > FICHE_OBJECTIFS_MAX) {
      problem(400, 'objectifs.fiche_trop_longue', 'La fiche est trop longue pour être enregistrée');
    }
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const moi = await this.exigerAgent(tx, user);
      const membre = (await this.directs(tx, moi)).find((m) => m.id === employeeId);
      if (!membre) {
        problem(404, 'objectifs.hors_equipe', 'Cet agent ne fait pas partie de votre équipe');
      }
      const { rows } = await tx.execute<{ updated_at: string | Date }>(sql`
        INSERT INTO objectifs_fiches
               (id, tenant_id, employee_id, annee, semestre, contenu, auteur_employee_id)
        VALUES (${uuidv7()}, ${user.tenantId}, ${employeeId}, ${an}, ${input.semestre},
                ${json}::jsonb, ${moi})
        ON CONFLICT (tenant_id, employee_id, annee, semestre) DO UPDATE
           SET contenu = EXCLUDED.contenu,
               auteur_employee_id = EXCLUDED.auteur_employee_id,
               updated_at = now()
         WHERE objectifs_fiches.commentaires_envoyes_le IS NULL
        RETURNING updated_at`);
      // L'agent a rendu compte de ces objectifs : ils ne changent plus.
      if (!rows[0]) {
        problem(
          409,
          'objectifs.fiche_verrouillee',
          'L’agent a envoyé son auto-évaluation : ces objectifs ne changent plus',
        );
      }

      if (ficheRemplie(contenu)) {
        const compte = await this.compteDe(tx, employeeId);
        if (compte) {
          const [auteur] = (
            await tx.execute<{ nom: string }>(sql`
              SELECT p.given_name || ' ' || p.family_name AS nom
                FROM employees e JOIN persons p ON p.id = e.person_id WHERE e.id = ${moi}`)
          ).rows;
          // Une par jour au plus, et seule la dernière reste dans la boîte.
          const sujet = `objectifs:fiche:${employeeId}:${an}:${input.semestre}:`;
          const { rows: deja } = await tx.execute(sql`
            SELECT 1 FROM notifications
             WHERE recipient_user_id = ${compte} AND dedupe_key LIKE ${`${sujet}%`} LIMIT 1`);
          await notifier(tx, user.tenantId, compte, {
            type: 'objectif',
            title: `${auteur?.nom ?? 'Votre n+1'} a ${deja.length > 0 ? 'mis à jour' : 'fixé'} vos objectifs ${duSemestre(input.semestre, an)}`,
            link: '/moi/objectifs',
            dedupeKey: `${sujet}${this.aujourdhui()}`,
            remplace: sujet,
          });
        }
      }
      return { majLe: iso(rows[0]!.updated_at)! };
    });
  }

  /**
   * Les fiches d'un agent, les plus récentes d'abord — sans les fiches vides.
   * Les cases de la fiche disent où l'agent en est. Chacun ne voit de
   * l'autre que ce qui est envoyé : le n+1, les commentaires de l'agent une
   * fois son auto-évaluation envoyée ; l'agent, ceux du n+1 et la note une
   * fois validés.
   */
  private async lireFiches(
    tx: Tx,
    employeeId: string,
    vue: 'agent' | 'n1',
  ): Promise<FicheObjectifs[]> {
    const { rows } = await tx.execute<LigneFiche>(sql`
      ${SELECTION_FICHE}
       WHERE f.employee_id = ${employeeId}
       ORDER BY f.annee DESC, f.semestre DESC`);
    return rows.filter((l) => ficheRemplie(l.contenu)).map((l) => vueFiche(l, vue));
  }

  /** Une fiche, verrouillée le temps du geste — 404 si elle n'existe pas. */
  private async uneFiche(
    tx: Tx,
    employeeId: string,
    annee: number,
    semestre: number,
  ): Promise<LigneFiche> {
    const { rows } = await tx.execute<LigneFiche>(sql`
      ${SELECTION_FICHE}
       WHERE f.employee_id = ${employeeId} AND f.annee = ${annee} AND f.semestre = ${semestre}
       FOR UPDATE OF f`);
    const ligne = rows[0];
    if (!ligne || !ficheRemplie(ligne.contenu)) {
      problem(404, 'objectifs.fiche_introuvable', 'Aucun objectif n’a été fixé pour ce semestre');
    }
    return ligne;
  }

  private async nomDe(tx: Tx, employeeId: string): Promise<string> {
    const { rows } = await tx.execute<{ nom: string }>(sql`
      SELECT p.given_name || ' ' || p.family_name AS nom
        FROM employees e JOIN persons p ON p.id = e.person_id WHERE e.id = ${employeeId}`);
    return rows[0]?.nom ?? '';
  }

  // ———————————————————————————— ce que l'agent en fait

  /**
   * L'agent dit où en est un objectif — atteint, partiellement, non atteint —
   * ou revient sur son choix (`null`). Son n+1 le voit à mesure. Son
   * auto-évaluation envoyée, plus rien ne bouge.
   */
  async statuer(
    user: SessionUser,
    annee: number,
    semestre: number,
    input: StatutObjectifInput,
  ): Promise<{ statuts: Record<string, StatutObjectif> }> {
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const moi = await this.exigerAgent(tx, user);
      const f = await this.uneFiche(tx, moi, annee, semestre);
      exigerNonEnvoyee(f);
      if (!objectifsDeLaFiche(f.contenu).some((o) => o.id === input.id)) {
        problem(422, 'objectifs.objectif_inconnu', 'Cet objectif n’est pas dans la fiche');
      }
      const { rows } = await tx.execute<{ statuts: Record<string, StatutObjectif> }>(sql`
        UPDATE objectifs_fiches
           SET statuts = ${input.statut ? sql`statuts || jsonb_build_object(${input.id}::text, ${input.statut}::text)` : sql`statuts - ${input.id}::text`}
         WHERE id = ${f.id}
        RETURNING statuts`);
      return { statuts: rows[0]!.statuts };
    });
  }

  /** L'agent enregistre ses commentaires, au brouillon : son n+1 ne les voit pas encore. */
  async enregistrerCommentaires(
    user: SessionUser,
    annee: number,
    semestre: number,
    input: CommentairesAgentInput,
  ): Promise<void> {
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const moi = await this.exigerAgent(tx, user);
      const f = await this.uneFiche(tx, moi, annee, semestre);
      exigerNonEnvoyee(f);
      await tx.execute(sql`
        UPDATE objectifs_fiches
           SET commentaires_agent = ${JSON.stringify(garderLesObjectifs(f, input.commentaires))}::jsonb
         WHERE id = ${f.id}`);
    });
  }

  /**
   * L'agent envoie son auto-évaluation à son n+1 — chaque objectif avec son
   * statut et son commentaire, atteint ou non. Les objectifs, les statuts et
   * les commentaires ne changent plus ; le n+1 en est prévenu.
   */
  async envoyerCommentaires(user: SessionUser, annee: number, semestre: number): Promise<void> {
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const moi = await this.exigerAgent(tx, user);
      const f = await this.uneFiche(tx, moi, annee, semestre);
      exigerNonEnvoyee(f);
      const restants = objectifsDeLaFiche(f.contenu).filter(
        (o) => !f.statuts[o.id] || !f.commentaires_agent[o.id]?.trim(),
      ).length;
      if (restants > 0) {
        problem(
          422,
          'objectifs.auto_evaluation_incomplete',
          restants > 1
            ? `${restants} objectifs attendent encore leur statut ou votre commentaire`
            : 'Un objectif attend encore son statut ou votre commentaire',
        );
      }
      await tx.execute(sql`
        UPDATE objectifs_fiches SET commentaires_envoyes_le = now() WHERE id = ${f.id}`);

      const { rows } = await tx.execute<{ n1: string | null }>(sql`
        SELECT manager_employee_id AS n1 FROM employees WHERE id = ${moi}`);
      const n1 = rows[0]?.n1;
      const compte = n1 ? await this.compteDe(tx, n1) : null;
      if (compte) {
        await notifier(tx, user.tenantId, compte, {
          type: 'objectif',
          title: `${await this.nomDe(tx, moi)} a envoyé son auto-évaluation ${duSemestre(semestre, annee)}`,
          link: `/moi/equipe/suivi/${moi}?vue=evaluation`,
          dedupeKey: `objectifs:commentaires:${moi}:${annee}:${semestre}`,
        });
      }
    });
  }

  // ———————————————————————————— ce que le n+1 en dit

  /**
   * Le n+1 commente à son tour, sous chaque objectif, et donne la note — au
   * brouillon, une fois l'auto-évaluation de l'agent reçue.
   */
  async enregistrerEvaluation(
    user: SessionUser,
    employeeId: string,
    annee: number,
    semestre: number,
    input: EvaluationN1Input,
  ): Promise<void> {
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const moi = await this.exigerAgent(tx, user);
      await this.exigerSonN1(tx, moi, employeeId, true);
      const f = await this.uneFiche(tx, employeeId, annee, semestre);
      exigerEvaluable(f);
      await tx.execute(sql`
        UPDATE objectifs_fiches
           SET commentaires_n1 = ${JSON.stringify(garderLesObjectifs(f, input.commentaires))}::jsonb,
               evaluation_note = ${input.note},
               evaluateur_employee_id = ${moi}
         WHERE id = ${f.id}`);
    });
  }

  /** Le n+1 valide l'évaluation : la note est donnée ; l'agent en est prévenu et la lit. */
  async validerEvaluation(
    user: SessionUser,
    employeeId: string,
    annee: number,
    semestre: number,
  ): Promise<void> {
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const moi = await this.exigerAgent(tx, user);
      await this.exigerSonN1(tx, moi, employeeId, true);
      const f = await this.uneFiche(tx, employeeId, annee, semestre);
      exigerEvaluable(f);
      if (!f.evaluation_note) {
        problem(422, 'objectifs.evaluation_sans_note', 'Donnez l’appréciation globale');
      }
      await tx.execute(sql`
        UPDATE objectifs_fiches
           SET evaluation_validee_le = now(), evaluateur_employee_id = ${moi}
         WHERE id = ${f.id}`);
      const compte = await this.compteDe(tx, employeeId);
      if (compte) {
        await notifier(tx, user.tenantId, compte, {
          type: 'objectif',
          title: `${await this.nomDe(tx, moi)} a évalué vos objectifs ${duSemestre(semestre, annee)}`,
          link: '/moi/objectifs',
          dedupeKey: `objectifs:evaluation:${employeeId}:${annee}:${semestre}`,
        });
      }
    });
  }

  /**
   * Les évaluations validées d'un agent, la plus récente d'abord — ce que son
   * dossier en garde. L'agent voit les siennes ; le directeur du Capital
   * Humain, celles de tous. Consulter les dossiers n'y suffit pas : une note
   * ne se lit pas comme une adresse.
   */
  async evaluationsDe(user: SessionUser, employeeId: string): Promise<EvaluationValidee[]> {
    return this.db.withTenant(this.ctx(user), async (tx) => {
      if (!user.dirigeLaDCH && (await employeActif(tx, user.userId)) !== employeeId) {
        problem(403, 'objectifs.dossier_interdit', 'Ces évaluations ne sont pas les vôtres');
      }
      const { rows } = await tx.execute<{
        annee: number;
        semestre: number;
        manager: string | null;
        note: NoteGlobale;
        validee_le: string | Date;
      }>(sql`
        SELECT f.annee, f.semestre, f.evaluation_note AS note, f.evaluation_validee_le AS validee_le,
               CASE WHEN p.id IS NULL THEN NULL ELSE p.given_name || ' ' || p.family_name END AS manager
          FROM objectifs_fiches f
          LEFT JOIN employees e ON e.id = f.evaluateur_employee_id
          LEFT JOIN persons p ON p.id = e.person_id
         WHERE f.employee_id = ${employeeId} AND f.evaluation_validee_le IS NOT NULL
         ORDER BY f.annee DESC, f.semestre DESC`);
      return rows.map((r) => ({
        annee: Number(r.annee),
        semestre: r.semestre === 1 ? 1 : 2,
        manager: r.manager,
        note: r.note,
        valideeLe: iso(r.validee_le)!,
      }));
    });
  }

  /** Les formations publiées qu'un n+1 peut donner à suivre. */
  async formationsProposables(user: SessionUser): Promise<FormationProposable[]> {
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const { rows } = await tx.execute<{ id: string; title: string }>(sql`
        SELECT c.id, c.title
          FROM academy_courses c
         WHERE c.published_at IS NOT NULL
           AND EXISTS (SELECT 1 FROM academy_lessons l JOIN academy_modules m ON m.id = l.module_id
                        WHERE l.course_id = c.id AND l.video_status = 'prete')
         ORDER BY c.title`);
      return rows;
    });
  }

  /** « Objectifs de l'APIX » : ce que le directeur général fixe. */
  async objectifsAPIX(user: SessionUser, annee?: number): Promise<ObjectifsAPIX> {
    const an = annee ?? this.anneeCourante();
    return this.db.withTenant(this.ctx(user), async (tx) => {
      await this.exigerDG(tx, user);
      const orientations = await this.lire(tx, sql`o.niveau = 'apix' AND o.annee = ${an}`);
      const { rows: directions } = await tx.execute<{
        id: string;
        name: string;
        directeur: string | null;
      }>(sql`
        SELECT o.id, o.name,
               CASE WHEN p.id IS NULL THEN NULL ELSE p.given_name || ' ' || p.family_name END AS directeur
          FROM org_units o
          LEFT JOIN employees e ON e.id = o.manager_employee_id AND e.status = 'active'
          LEFT JOIN persons p ON p.id = e.person_id
         WHERE o.unit_type = 'direction' AND o.deleted_at IS NULL
           AND o.id IS DISTINCT FROM ${SOMMET}
         ORDER BY o.name`);
      const objectifs = await this.lire(tx, sql`o.niveau = 'direction' AND o.annee = ${an}`);
      return {
        annee: an,
        orientations: orientations.map((o) => this.vue(o)),
        directions: directions.map((d) => ({
          id: d.id,
          nom: d.name,
          directeur: d.directeur,
          objectifs: objectifs.filter((o) => o.direction_id === d.id).map((o) => this.vue(o)),
        })),
      };
    });
  }

  // ———————————————————————————— écritures

  async creer(user: SessionUser, input: CreerObjectifInput): Promise<ObjectifView> {
    const an = input.annee ?? this.anneeCourante();
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const moi = await this.exigerAgent(tx, user);
      let titre = input.titre?.trim() ?? '';
      if (input.niveau === 'apix' || input.niveau === 'direction') {
        await this.exigerDG(tx, user);
      }
      if (input.niveau === 'direction') {
        const { rows } = await tx.execute(sql`
          SELECT 1 FROM org_units
           WHERE id = ${input.directionId} AND unit_type = 'direction' AND deleted_at IS NULL
             AND id IS DISTINCT FROM ${SOMMET}`);
        if (rows.length === 0) {
          problem(422, 'objectifs.direction_inconnue', 'Cette direction n’existe pas');
        }
      }
      if (input.niveau === 'individuel') {
        await this.exigerSonN1(tx, moi, input.employeeId!);
        if (input.nature === 'formation') {
          const { rows } = await tx.execute<{ title: string }>(sql`
            SELECT title FROM academy_courses
             WHERE id = ${input.courseId} AND published_at IS NOT NULL`);
          if (!rows[0]) {
            problem(422, 'objectifs.formation_inconnue', 'Cette formation n’est pas au catalogue');
          }
          titre = rows[0].title;
          const { rows: deja } = await tx.execute(sql`
            SELECT 1 FROM objectifs
             WHERE employee_id = ${input.employeeId} AND course_id = ${input.courseId}
               AND annee = ${an}`);
          if (deja.length > 0) {
            problem(409, 'objectifs.formation_deja_fixee', 'Cette formation lui est déjà fixée');
          }
        }
      }

      const id = uuidv7();
      await tx.execute(sql`
        INSERT INTO objectifs (id, tenant_id, niveau, annee, diffusion, direction_id, employee_id,
                               nature, course_id, titre, description, echeance, auteur_employee_id)
        VALUES (${id}, ${user.tenantId}, ${input.niveau}, ${an},
                ${input.niveau === 'apix' ? input.diffusion! : null},
                ${input.niveau === 'direction' ? input.directionId! : null},
                ${input.niveau === 'individuel' ? input.employeeId! : null},
                ${input.nature}, ${input.nature === 'formation' ? input.courseId! : null},
                ${titre}, ${input.description?.trim() || null}, ${input.echeance ?? null}, ${moi})`);

      const cree = await this.un(tx, id);
      await this.prevenirDeLaCreation(tx, user, moi, cree);
      const progression =
        cree.employee_id !== null ? await this.progression(tx, [cree.employee_id]) : undefined;
      return this.vue(cree, cree.employee_id ? progression?.get(cree.employee_id) : undefined);
    });
  }

  async modifier(
    user: SessionUser,
    id: string,
    input: ModifierObjectifInput,
  ): Promise<ObjectifView> {
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const moi = await this.exigerAgent(tx, user);
      const o = await this.un(tx, id);
      await this.exigerLaMain(tx, user, moi, o);
      if (input.titre !== undefined && o.nature === 'formation') {
        problem(422, 'objectifs.titre_formation', 'Une formation garde le titre du catalogue');
      }
      if (input.diffusion !== undefined && o.niveau !== 'apix') {
        problem(422, 'objectifs.diffusion', 'Seules les orientations de l’APIX se diffusent');
      }
      const champs: SQL[] = [sql`updated_at = now()`];
      if (input.titre !== undefined) champs.push(sql`titre = ${input.titre.trim()}`);
      if (input.description !== undefined) {
        champs.push(sql`description = ${input.description?.trim() || null}`);
      }
      if (input.echeance !== undefined) champs.push(sql`echeance = ${input.echeance}`);
      if (input.diffusion !== undefined) champs.push(sql`diffusion = ${input.diffusion}`);
      await tx.execute(sql`UPDATE objectifs SET ${sql.join(champs, sql`, `)} WHERE id = ${id}`);
      const apres = await this.un(tx, id);
      const progression = apres.employee_id
        ? await this.progression(tx, [apres.employee_id])
        : undefined;
      return this.vue(apres, apres.employee_id ? progression?.get(apres.employee_id) : undefined);
    });
  }

  async supprimer(user: SessionUser, id: string): Promise<void> {
    await this.db.withTenant(this.ctx(user), async (tx) => {
      const moi = await this.exigerAgent(tx, user);
      const o = await this.un(tx, id);
      await this.exigerLaMain(tx, user, moi, o);
      await tx.execute(sql`DELETE FROM objectifs WHERE id = ${id}`);
    });
  }

  /** Évaluer — ou retirer l'évaluation (`null`). Une formation s'évalue dans l'Academy. */
  async evaluer(user: SessionUser, id: string, input: EvaluerObjectifInput): Promise<ObjectifView> {
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const moi = await this.exigerAgent(tx, user);
      const o = await this.un(tx, id);
      await this.exigerLaMain(tx, user, moi, o);
      if (o.nature === 'formation') {
        problem(
          422,
          'objectifs.formation_auto',
          'Une formation est atteinte quand l’agent l’a terminée dans l’Academy',
        );
      }
      await tx.execute(sql`
        UPDATE objectifs
           SET evaluation = ${input.evaluation},
               commentaire = ${input.evaluation ? input.commentaire?.trim() || null : null},
               evalue_le = ${input.evaluation ? sql`now()` : sql`NULL`},
               updated_at = now()
         WHERE id = ${id}`);
      const apres = await this.un(tx, id);
      if (apres.niveau === 'individuel' && apres.evaluation && apres.employee_id) {
        const compte = await this.compteDe(tx, apres.employee_id);
        if (compte) {
          // Revue le lendemain, l'évaluation prend la place de la précédente.
          await notifier(tx, user.tenantId, compte, {
            type: 'objectif',
            title: `${await this.nomDe(tx, moi)} a évalué votre objectif « ${apres.titre} »`,
            link: '/moi/objectifs',
            dedupeKey: `objectif:${apres.id}:evaluation:${this.aujourdhui()}`,
            remplace: `objectif:${apres.id}:evaluation:`,
          });
        }
      }
      return this.vue(apres);
    });
  }

  // ———————————————————————————— droits

  private async exigerAgent(tx: Tx, user: SessionUser): Promise<string> {
    const moi = await employeActif(tx, user.userId);
    if (!moi) {
      problem(403, 'objectifs.sans_dossier', 'Les objectifs se fixent entre agents');
    }
    return moi;
  }

  private async exigerDG(tx: Tx, user: SessionUser): Promise<string> {
    const moi = await this.exigerAgent(tx, user);
    if ((await directeurGeneral(tx)) !== moi) {
      problem(
        403,
        'objectifs.reserve_dg',
        'Seul le directeur général fixe les objectifs de l’APIX et des directions',
      );
    }
    return moi;
  }

  /** L'agent doit être un direct ACTIF de l'appelant — jamais le DG. */
  private async exigerSonN1(
    tx: Tx,
    moi: string,
    employeeId: string,
    evaluation = false,
  ): Promise<void> {
    const { rows } = await tx.execute(sql`
      SELECT 1 FROM employees
       WHERE id = ${employeeId} AND manager_employee_id = ${moi}
         AND (status = 'active'
              ${evaluation ? sql`OR ${evaluationEnSuspens(sql`employees.id`)}` : sql``})
         AND id IS DISTINCT FROM ${DG}`);
    if (rows.length === 0) {
      problem(403, 'objectifs.hors_equipe', 'Vous fixez les objectifs de votre équipe seulement');
    }
  }

  /** Qui a la main sur un objectif : le DG pour l'APIX et les directions, le n+1 du jour pour un agent. */
  private async exigerLaMain(
    tx: Tx,
    user: SessionUser,
    moi: string,
    o: LigneObjectif,
  ): Promise<void> {
    if (o.niveau === 'individuel') await this.exigerSonN1(tx, moi, o.employee_id!);
    else await this.exigerDG(tx, user);
  }

  // ———————————————————————————— outils

  private async lire(tx: Tx, filtre: SQL): Promise<LigneObjectif[]> {
    const { rows } = await tx.execute<LigneObjectif>(sql`
      ${SELECTION}
       WHERE ${filtre}
       ORDER BY o.echeance NULLS LAST, o.created_at, o.id`);
    return rows;
  }

  private async un(tx: Tx, id: string): Promise<LigneObjectif> {
    const { rows } = await tx.execute<LigneObjectif>(sql`${SELECTION} WHERE o.id = ${id}`);
    if (!rows[0]) problem(404, 'objectifs.introuvable', 'Objectif introuvable');
    return rows[0];
  }

  /** La direction de l'agent — la Direction Générale n'en est pas une ici. */
  private async directionSaufSommet(
    tx: Tx,
    employeeId: string,
  ): Promise<{ id: string; nom: string } | null> {
    const direction = await directionDeEmploye(tx, employeeId);
    if (!direction) return null;
    const { rows } = await tx.execute<{ sommet: string | null }>(sql`SELECT ${SOMMET} AS sommet`);
    return rows[0]?.sommet === direction.id ? null : direction;
  }

  /**
   * Les directs ACTIFS de l'agent, avec leur poste du jour, jamais le DG.
   * `evaluations` y ajoute ceux qui sont partis en laissant une
   * auto-évaluation envoyée, pas encore validée : leur n+1 la termine.
   */
  private async directs(tx: Tx, moi: string, evaluations = false): Promise<LigneMembre[]> {
    const { rows } = await tx.execute<LigneMembre>(sql`
      SELECT e.id, e.employee_number, p.given_name, p.family_name,
             a.position_title, u.name AS unite,
             ${directionDeLUnite(sql`a.org_unit_id`, 'short_name')} AS direction_abrege,
             ${directionDeLUnite(sql`a.org_unit_id`, 'name')} AS direction_nom,
             e.work_email, e.work_phone, p.phone, e.status <> 'active' AS parti
        FROM employees e
        JOIN persons p ON p.id = e.person_id AND p.deleted_at IS NULL
        LEFT JOIN LATERAL (
          SELECT position_title, org_unit_id
            FROM assignments
           WHERE employee_id = e.id
             AND (validity @> CURRENT_DATE OR lower(validity) > CURRENT_DATE)
           ORDER BY lower(validity)
           LIMIT 1
        ) a ON true
        LEFT JOIN org_units u ON u.id = a.org_unit_id AND u.deleted_at IS NULL
       WHERE e.manager_employee_id = ${moi}
         AND (e.status = 'active'
              ${evaluations ? sql`OR ${evaluationEnSuspens(sql`e.id`)}` : sql``})
         AND e.id IS DISTINCT FROM ${DG}
       ORDER BY p.family_name, p.given_name, e.id`);
    return rows;
  }

  private async progression(
    tx: Tx,
    employeeIds: string[],
  ): Promise<Map<string, TeamCourseProgress[]>> {
    return this.academy.suivi(tx, employeeIds);
  }

  private async compteDe(tx: Tx, employeeId: string): Promise<string | null> {
    const { rows } = await tx.execute<{ user_id: string | null }>(sql`
      SELECT p.user_id FROM employees e JOIN persons p ON p.id = e.person_id
       WHERE e.id = ${employeeId} AND e.status = 'active' AND p.deleted_at IS NULL`);
    return rows[0]?.user_id ?? null;
  }

  private vue(o: LigneObjectif, formations?: TeamCourseProgress[]): ObjectifView {
    const echeance = jour(o.echeance);
    let formation: ObjectifView['formation'] = null;
    if (o.nature === 'formation') {
      const suivie =
        formations?.find((f) => o.course_id !== null && f.courseId === o.course_id) ??
        // Retirée du catalogue : son certificat, s'il vaut encore, reste un acquis.
        formations?.find((f) => f.courseId === null && f.title === o.titre);
      formation = {
        courseId: o.course_id,
        statut: suivie?.status ?? null,
        lecons: suivie?.lessonCount ?? 0,
        validees: suivie?.completedLessons ?? 0,
      };
    }
    const atteint =
      o.evaluation === 'atteint' ||
      formation?.statut === 'certifiee' ||
      formation?.statut === 'terminee';
    return {
      id: o.id,
      niveau: o.niveau,
      annee: Number(o.annee),
      nature: o.nature,
      titre: o.titre,
      description: o.description,
      echeance,
      diffusion: o.diffusion,
      evaluation: o.evaluation,
      commentaire: o.commentaire,
      evalueLe: iso(o.evalue_le),
      formation,
      atteint,
      enRetard: echeance !== null && echeance < this.aujourdhui() && !atteint && !o.evaluation,
      auteur: o.auteur,
      creeLe: iso(o.created_at)!,
    };
  }

  private membre(m: LigneMembre, objectifs: ObjectifView[], aEvaluer: number): MembreSuivi {
    return {
      employeeId: m.id,
      givenName: m.given_name,
      familyName: m.family_name,
      number: m.employee_number,
      positionTitle: m.position_title,
      unitName: m.unite,
      directionShortName: m.direction_abrege,
      directionName: m.direction_nom,
      workEmail: m.work_email,
      workPhone: m.work_phone,
      phone: m.phone,
      total: objectifs.length,
      atteints: objectifs.filter((o) => o.atteint).length,
      enRetard: objectifs.filter((o) => o.enRetard).length,
      aEvaluer,
      parti: m.parti,
    };
  }

  // ———————————————————————————— prévenir

  /**
   * Un objectif fixé à un agent le prévient ; les objectifs d'une direction,
   * ses agents ; les orientations de l'APIX, ceux à qui elles sont diffusées.
   * Une notification par jour et par direction (ou pour l'APIX) : dix
   * objectifs saisis d'affilée n'en font pas dix.
   */
  private async prevenirDeLaCreation(
    tx: Tx,
    user: SessionUser,
    moi: string,
    o: LigneObjectif,
  ): Promise<void> {
    const le = this.aujourdhui();
    if (o.niveau === 'individuel' && o.employee_id) {
      const compte = await this.compteDe(tx, o.employee_id);
      if (!compte) return;
      await notifier(tx, user.tenantId, compte, {
        type: 'objectif',
        title: `${o.auteur ?? 'Votre n+1'} vous a fixé ${o.nature === 'formation' ? 'une formation' : 'un objectif'} : ${o.titre}`,
        link: '/moi/objectifs',
        dedupeKey: `objectif:${o.id}`,
      });
      return;
    }
    const destinataires =
      o.niveau === 'direction'
        ? await this.comptes(
            tx,
            sql`${directionDeLUnite(uniteEnVigueur(sql`e.id`), 'id')} = ${o.direction_id}`,
            moi,
          )
        : o.diffusion === 'directeurs'
          ? await this.comptes(
              tx,
              sql`EXISTS (SELECT 1 FROM org_units d
                           WHERE d.manager_employee_id = e.id AND d.unit_type = 'direction'
                             AND d.deleted_at IS NULL AND d.id IS DISTINCT FROM ${SOMMET})`,
              moi,
            )
          : await this.comptes(tx, sql`TRUE`, moi);
    const quoi =
      o.niveau === 'direction'
        ? { nom: `les objectifs ${o.annee} de votre direction`, fixes: 'sont fixés' }
        : { nom: `les orientations ${o.annee} de l’APIX`, fixes: 'sont fixées' };
    const title = o.auteur
      ? `${o.auteur} a fixé ${quoi.nom}`
      : `${quoi.nom[0]!.toUpperCase()}${quoi.nom.slice(1)} ${quoi.fixes}`;
    const sujet =
      o.niveau === 'direction' ? `objectifs:direction:${o.direction_id}:` : 'objectifs:apix:';
    for (const compte of destinataires) {
      await notifier(tx, user.tenantId, compte, {
        type: 'objectif',
        title,
        link: '/moi/objectifs',
        dedupeKey: `${sujet}${le}`,
        remplace: sujet,
      });
    }
  }

  /** Les comptes des agents actifs qui répondent au filtre (sur `e`), sauf l'auteur. */
  private async comptes(tx: Tx, filtre: SQL, sauf: string): Promise<string[]> {
    const { rows } = await tx.execute<{ user_id: string }>(sql`
      SELECT DISTINCT p.user_id
        FROM employees e
        JOIN persons p ON p.id = e.person_id AND p.deleted_at IS NULL
       WHERE e.status = 'active' AND p.user_id IS NOT NULL AND e.id <> ${sauf}
         AND ${filtre}`);
    return rows.map((r) => r.user_id);
  }
}
