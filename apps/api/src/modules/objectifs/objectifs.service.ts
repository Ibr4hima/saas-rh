import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import {
  LIBELLES_EVALUATION,
  type CreerObjectifInput,
  type EvaluerObjectifInput,
  type FicheSuivi,
  type FormationProposable,
  type MembreSuivi,
  type MesObjectifs,
  type ModifierObjectifInput,
  type ObjectifsAPIX,
  type ObjectifView,
  type SessionUser,
  type SuiviEquipe,
  type TeamCourseProgress,
} from '@teranga/contracts';
import { problem } from '../../common/problem';
import { TenantDb, type Tx } from '../../db/tenant-db';
import { frDate } from '../acces/appels';
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
}

const iso = (d: string | Date | null): string | null =>
  d === null ? null : d instanceof Date ? d.toISOString() : new Date(d).toISOString();
const jour = (d: string | Date | null): string | null =>
  d === null ? null : typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);

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
      const membres = await this.directs(tx, moi);
      const ids = membres.map((m) => m.id);
      const objectifs = ids.length
        ? await this.lire(
            tx,
            sql`o.niveau = 'individuel' AND o.annee = ${an} AND o.employee_id IN ${ids}`,
          )
        : [];
      const progression = await this.progression(tx, ids);
      return {
        annee: an,
        membres: membres.map((m) =>
          this.membre(
            m,
            objectifs
              .filter((o) => o.employee_id === m.id)
              .map((o) => this.vue(o, progression.get(m.id))),
          ),
        ),
      };
    });
  }

  async fiche(user: SessionUser, employeeId: string, annee?: number): Promise<FicheSuivi> {
    const an = annee ?? this.anneeCourante();
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const moi = await this.exigerAgent(tx, user);
      const membre = (await this.directs(tx, moi)).find((m) => m.id === employeeId);
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
      return { annee: an, membre: this.membre(membre, objectifs), objectifs };
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
          await notifier(tx, user.tenantId, compte, {
            type: 'objectif',
            title: `Objectif évalué : ${apres.titre}`,
            body: `${LIBELLES_EVALUATION[apres.evaluation]}${apres.commentaire ? ` — « ${apres.commentaire} »` : ''}`,
            link: '/moi/objectifs',
            dedupeKey: `objectif:${apres.id}:evaluation:${apres.evaluation}`,
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
  private async exigerSonN1(tx: Tx, moi: string, employeeId: string): Promise<void> {
    const { rows } = await tx.execute(sql`
      SELECT 1 FROM employees
       WHERE id = ${employeeId} AND manager_employee_id = ${moi} AND status = 'active'
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

  /** Les directs ACTIFS de l'agent, avec leur poste du jour — jamais le DG. */
  private async directs(tx: Tx, moi: string): Promise<LigneMembre[]> {
    const { rows } = await tx.execute<LigneMembre>(sql`
      SELECT e.id, e.employee_number, p.given_name, p.family_name,
             a.position_title, u.name AS unite
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
         AND e.status = 'active'
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

  private membre(m: LigneMembre, objectifs: ObjectifView[]): MembreSuivi {
    return {
      employeeId: m.id,
      givenName: m.given_name,
      familyName: m.family_name,
      number: m.employee_number,
      positionTitle: m.position_title,
      unitName: m.unite,
      total: objectifs.length,
      atteints: objectifs.filter((o) => o.atteint).length,
      enRetard: objectifs.filter((o) => o.enRetard).length,
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
    const auteur = o.auteur ?? 'Votre n+1';
    const le = this.aujourdhui();
    if (o.niveau === 'individuel' && o.employee_id) {
      const compte = await this.compteDe(tx, o.employee_id);
      if (!compte) return;
      const echeance = jour(o.echeance);
      await notifier(tx, user.tenantId, compte, {
        type: 'objectif',
        title:
          o.nature === 'formation'
            ? `Formation à suivre : ${o.titre}`
            : `Nouvel objectif : ${o.titre}`,
        body: `Fixé par ${auteur}${echeance ? `, pour le ${frDate(echeance)}` : ''}.`,
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
    const title =
      o.niveau === 'direction'
        ? `Objectifs ${o.annee} de votre direction`
        : `Orientations ${o.annee} de l’APIX`;
    for (const compte of destinataires) {
      await notifier(tx, user.tenantId, compte, {
        type: 'objectif',
        title,
        body: `${auteur} les a fixés.`,
        link: '/moi/objectifs',
        dedupeKey:
          o.niveau === 'direction'
            ? `objectifs:direction:${o.direction_id}:${le}`
            : `objectifs:apix:${le}`,
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
