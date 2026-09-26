import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, isNull, lt, sql, type SQL } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type {
  AcademyCategory,
  BeatInput,
  BeatResult,
  CourseAdminSummary,
  CourseAdminView,
  CourseDetail,
  CourseSummary,
  EtatLecon,
  Intervalle,
  LessonPlayback,
  LessonView,
  ModeLecture,
  ModuleView,
  ObstaclePublication,
  PrepareVideoInput,
  SaveCourseInput,
  SessionUser,
  VideoStatus,
  VideoUploadTarget,
} from '@teranga/contracts';
import {
  DUREE_MAX_LECON_S,
  MARGE_DUREE_S,
  MAX_SUPPORT_BYTES,
  MAX_VIDEO_LOCALE_BYTES,
  TENTATIVES_PAR_JOUR,
} from '@teranga/contracts';
import { problem } from '../../common/problem';
import * as t from '../../db/schema';
import { TenantDb, type Tx } from '../../db/tenant-db';
import {
  employeActif,
  formationsCertifiees,
  quizAdmin,
  taillesDesBanques,
  vueEvaluation,
} from './academy-evaluation.service';
import { dureeMp4 } from './mp4';
import { StockageVideoLocal, VideoTropLourde } from './stockage-local';
import {
  atteintLeSeuil,
  crediter,
  etatsDuParcours,
  partVue,
  plusLoin,
  RESERVE_MAX_S,
  totalVu,
} from './visionnage';

/* ————————————————————————————————————————————————————————————————
   APIX Academy.

   Deux publics, deux écrans, un seul service. La RH CONSTRUIT : formations,
   modules, leçons, vidéos, supports ; elle publie quand tout est prêt. Les
   agents SUIVENT : dans l'ordre, sans sauter, et chaque seconde créditée
   l'est par le serveur — le lecteur ne fait que rendre compte (cf.
   `visionnage.ts`, où se tient le verrou).

   Ce que voit un agent n'est jamais le catalogue brut. Une formation en
   brouillon n'existe pas pour lui (404, pas 403 : lui dire qu'elle existe
   serait déjà trop), et dans une formation publiée, une leçon dont la vidéo
   n'est pas prête n'apparaît pas — la RH peut enrichir une formation en
   ligne sans montrer un chantier.

   Le mode `apercu` couvre ceux qui regardent sans suivre : la RH qui relit un
   brouillon, un compte d'administration sans dossier d'agent. Tout y est
   ouvert, rien n'y est compté.
   ———————————————————————————————————————————————————————————————— */

type LigneModule = { id: string; courseId: string; position: number; title: string };

type LigneLecon = {
  id: string;
  courseId: string;
  moduleId: string;
  position: number;
  title: string;
  videoProvider: string | null;
  videoUid: string | null;
  videoStatus: string;
  videoError: string | null;
  durationSeconds: number | null;
  supportFilename: string | null;
  supportSize: number | null;
};

type LigneProgres = {
  lessonId: string;
  watched: Intervalle[];
  watchedSeconds: number;
  positionSeconds: number;
  completedAt: Date | null;
  updatedAt: Date;
};

type LigneFormation = typeof t.academyCourses.$inferSelect;

/** Une leçon à sa place dans le parcours d'un agent. */
interface EtapeParcours {
  lecon: LigneLecon;
  progres: LigneProgres | undefined;
  etat: EtatLecon;
}

const MOTS_STATUT: Record<string, string> = {
  absente: 'n’a pas encore de vidéo',
  envoi: 'a une vidéo en cours d’envoi',
  traitement: 'a une vidéo en cours de traitement',
  erreur: 'a une vidéo en erreur',
};

function formatDuree(secondes: number): string {
  const m = Math.floor(secondes / 60);
  const s = Math.round(secondes % 60);
  return `${m} min ${String(s).padStart(2, '0')} s`;
}

@Injectable()
export class AcademyService {
  /** L'horloge du serveur — remplaçable dans les tests, jamais par le client. */
  horloge: () => Date = () => new Date();
  /** Tentatives d'évaluation par vingt-quatre heures (`null` : sans limite) — idem. */
  limiteTentatives: number | null = TENTATIVES_PAR_JOUR;

  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(StockageVideoLocal) private readonly stockage: StockageVideoLocal,
  ) {}

  private ctx(user: SessionUser) {
    return { tenantId: user.tenantId, userId: user.userId };
  }

  /** Qui construit le catalogue : la RH et l'administration, personne d'autre. */
  private gere(user: SessionUser): boolean {
    return user.role === 'admin' || user.role === 'hr';
  }

  private exigerGestion(user: SessionUser): void {
    if (!this.gere(user)) {
      problem(403, 'academy.forbidden', 'Seule la RH gère le catalogue de l’Academy');
    }
  }

  // ———————————————————————————— lectures de base

  /** Le dossier d'agent ACTIF relié au compte, s'il y en a un. */
  private employeDe(tx: Tx, user: SessionUser): Promise<string | null> {
    return employeActif(tx, user.userId);
  }

  private async formation(tx: Tx, id: string): Promise<LigneFormation> {
    const [row] = await tx
      .select()
      .from(t.academyCourses)
      .where(eq(t.academyCourses.id, id))
      .limit(1);
    if (!row) problem(404, 'academy.course_not_found', 'Formation introuvable');
    return row;
  }

  /** La formation, si cet utilisateur a le droit de la voir. */
  private async formationVisible(tx: Tx, id: string, user: SessionUser) {
    const f = await this.formation(tx, id).catch(() => null);
    if (!f || (f.publishedAt === null && !this.gere(user))) {
      problem(404, 'academy.course_not_found', 'Formation introuvable');
    }
    return f;
  }

  private async lecon(tx: Tx, id: string): Promise<LigneLecon> {
    const [row] = await this.lecons(tx, eq(t.academyLessons.id, id));
    if (!row) problem(404, 'academy.lesson_not_found', 'Leçon introuvable');
    return row;
  }

  private lecons(tx: Tx, ou: SQL) {
    return tx
      .select({
        id: t.academyLessons.id,
        courseId: t.academyLessons.courseId,
        moduleId: t.academyLessons.moduleId,
        position: t.academyLessons.position,
        title: t.academyLessons.title,
        videoProvider: t.academyLessons.videoProvider,
        videoUid: t.academyLessons.videoUid,
        videoStatus: t.academyLessons.videoStatus,
        videoError: t.academyLessons.videoError,
        durationSeconds: t.academyLessons.durationSeconds,
        supportFilename: t.academyLessonSupports.filename,
        supportSize: t.academyLessonSupports.size,
      })
      .from(t.academyLessons)
      .leftJoin(t.academyLessonSupports, eq(t.academyLessonSupports.lessonId, t.academyLessons.id))
      .where(ou)
      .orderBy(asc(t.academyLessons.position));
  }

  /** Modules et leçons de plusieurs formations, en deux requêtes. */
  private async structure(tx: Tx, courseIds: string[]) {
    if (courseIds.length === 0) return { modules: [] as LigneModule[], lecons: [] as LigneLecon[] };
    const modules = await tx
      .select({
        id: t.academyModules.id,
        courseId: t.academyModules.courseId,
        position: t.academyModules.position,
        title: t.academyModules.title,
      })
      .from(t.academyModules)
      .where(inArray(t.academyModules.courseId, courseIds))
      .orderBy(asc(t.academyModules.position));
    const lecons = await this.lecons(tx, inArray(t.academyLessons.courseId, courseIds));
    return { modules, lecons };
  }

  private async progresDe(
    tx: Tx,
    employeeId: string | null,
    lessonIds: string[],
  ): Promise<Map<string, LigneProgres>> {
    if (!employeeId || lessonIds.length === 0) return new Map();
    const rows = await tx
      .select({
        lessonId: t.academyLessonProgress.lessonId,
        watched: t.academyLessonProgress.watched,
        watchedSeconds: t.academyLessonProgress.watchedSeconds,
        positionSeconds: t.academyLessonProgress.positionSeconds,
        completedAt: t.academyLessonProgress.completedAt,
        updatedAt: t.academyLessonProgress.updatedAt,
      })
      .from(t.academyLessonProgress)
      .where(
        and(
          eq(t.academyLessonProgress.employeeId, employeeId),
          inArray(t.academyLessonProgress.lessonId, lessonIds),
        ),
      );
    return new Map(rows.map((r) => [r.lessonId, r]));
  }

  /**
   * Le parcours d'une formation : ses leçons PRÊTES, dans l'ordre (module,
   * puis leçon), chacune avec sa progression et son état.
   */
  private etapes(
    modules: LigneModule[],
    lecons: LigneLecon[],
    progres: Map<string, LigneProgres>,
    mode: ModeLecture,
  ): EtapeParcours[] {
    const rang = new Map(modules.map((m) => [m.id, m.position]));
    const pretes = lecons
      .filter((l) => l.videoStatus === 'prete' && rang.has(l.moduleId))
      .sort((a, b) => rang.get(a.moduleId)! - rang.get(b.moduleId)! || a.position - b.position);
    const etats: EtatLecon[] =
      mode === 'suivi'
        ? etatsDuParcours(
            pretes.map((l) => {
              const p = progres.get(l.id);
              return { validee: Boolean(p?.completedAt), commencee: (p?.watchedSeconds ?? 0) > 0 };
            }),
          )
        : pretes.map(() => 'a_suivre');
    return pretes.map((lecon, i) => ({ lecon, progres: progres.get(lecon.id), etat: etats[i]! }));
  }

  // ———————————————————————————— assemblage des vues

  private vueLecon(l: LigneLecon, etape: EtapeParcours | undefined): LessonView {
    return {
      id: l.id,
      moduleId: l.moduleId,
      title: l.title,
      position: l.position,
      durationSeconds: l.durationSeconds,
      support:
        l.supportFilename && l.supportSize
          ? { filename: l.supportFilename, size: l.supportSize }
          : null,
      videoStatus: l.videoStatus as VideoStatus,
      videoError: l.videoError,
      etat: etape?.etat ?? 'verrouillee',
      vu:
        etape?.progres && l.durationSeconds ? partVue(etape.progres.watched, l.durationSeconds) : 0,
    };
  }

  private resume(
    f: LigneFormation,
    modules: LigneModule[],
    etapes: EtapeParcours[],
    gestion: boolean,
    lecons: LigneLecon[],
  ): CourseSummary {
    const activites = etapes.map((e) => e.progres?.updatedAt.getTime() ?? 0).filter((x) => x > 0);
    const courante = etapes.find((e) => e.etat === 'a_suivre' || e.etat === 'en_cours');
    return {
      id: f.id,
      title: f.title,
      summary: f.summary,
      category: f.category as AcademyCategory,
      published: f.publishedAt !== null,
      lessonCount: gestion ? lecons.length : etapes.length,
      moduleCount: gestion ? modules.length : new Set(etapes.map((e) => e.lecon.moduleId)).size,
      totalSeconds: etapes.reduce((s, e) => s + (e.lecon.durationSeconds ?? 0), 0),
      completedLessons: etapes.filter((e) => e.etat === 'validee').length,
      resumeLessonId: courante?.lecon.id ?? null,
      lastActivityAt: activites.length ? new Date(Math.max(...activites)).toISOString() : null,
      updatedAt: f.updatedAt.toISOString(),
      // Complétés par l'appelant, qui lit la banque et les certificats.
      hasEvaluation: false,
      certified: false,
      bookmarked: false,
    };
  }

  private detailDe(
    f: LigneFormation,
    modules: LigneModule[],
    lecons: LigneLecon[],
    progres: Map<string, LigneProgres>,
    mode: ModeLecture,
    gestion: boolean,
  ): CourseDetail {
    const siens = modules.filter((m) => m.courseId === f.id);
    const leurs = lecons.filter((l) => l.courseId === f.id);
    const etapes = this.etapes(siens, leurs, progres, mode);
    const parId = new Map(etapes.map((e) => [e.lecon.id, e]));
    const vues: ModuleView[] = siens
      .map((m) => ({
        id: m.id,
        title: m.title,
        position: m.position,
        lessons: leurs
          .filter((l) => l.moduleId === m.id && (gestion || parId.has(l.id)))
          .sort((a, b) => a.position - b.position)
          .map((l) => this.vueLecon(l, parId.get(l.id))),
      }))
      // Un module sans leçon prête n'a rien à montrer à un agent.
      .filter((m) => gestion || m.lessons.length > 0);
    return {
      ...this.resume(f, siens, etapes, gestion, leurs),
      mode,
      modules: vues,
      evaluation: null,
    };
  }

  /** Ce qui empêche de publier, dans l'ordre où la RH le corrigera. */
  private obstacles(modules: LigneModule[], lecons: LigneLecon[]): ObstaclePublication[] {
    const out: ObstaclePublication[] = [];
    if (modules.length === 0) {
      out.push({ lessonId: null, texte: 'Ajoutez au moins un module et une leçon.' });
    }
    for (const m of modules) {
      const siennes = lecons.filter((l) => l.moduleId === m.id);
      if (siennes.length === 0) {
        out.push({ lessonId: null, texte: `Le module « ${m.title} » n’a aucune leçon.` });
      }
      for (const l of siennes) {
        if (l.videoStatus !== 'prete') {
          out.push({
            lessonId: l.id,
            texte: `La leçon « ${l.title} » ${MOTS_STATUT[l.videoStatus] ?? 'n’est pas prête'}.`,
          });
        }
      }
    }
    return out;
  }

  // ———————————————————————————— lectures (agents et RH)

  /** Le catalogue publié, avec la progression de l'agent connecté. */
  async catalogue(user: SessionUser): Promise<CourseSummary[]> {
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const formations = await tx
        .select()
        .from(t.academyCourses)
        .where(sql`${t.academyCourses.publishedAt} IS NOT NULL`)
        .orderBy(asc(t.academyCourses.title));
      const { modules, lecons } = await this.structure(
        tx,
        formations.map((f) => f.id),
      );
      const employeeId = await this.employeDe(tx, user);
      const progres = await this.progresDe(
        tx,
        employeeId,
        lecons.map((l) => l.id),
      );
      const mode: ModeLecture = employeeId ? 'suivi' : 'apercu';
      const banques = await taillesDesBanques(
        tx,
        formations.map((f) => f.id),
      );
      const certifiees = await formationsCertifiees(tx, employeeId, this.horloge());
      const signets = await this.signetsDe(tx, user.userId);
      return (
        formations
          .map((f) => this.detailDe(f, modules, lecons, progres, mode, false))
          // Une formation publiée dont aucune vidéo n'est prête n'a rien à
          // offrir : elle ne s'affiche pas.
          .filter((d) => d.lessonCount > 0)
          .map(({ modules: _m, mode: _mode, evaluation: _e, ...resume }) => ({
            ...resume,
            hasEvaluation: (banques.get(resume.id) ?? 0) > 0,
            certified: certifiees.has(resume.id),
            bookmarked: signets.has(resume.id),
          }))
      );
    });
  }

  /** Une formation, telle que la voit celui qui la suit (ou la relit). */
  async detail(user: SessionUser, courseId: string): Promise<CourseDetail> {
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const f = await this.formationVisible(tx, courseId, user);
      const { modules, lecons } = await this.structure(tx, [f.id]);
      const employeeId = f.publishedAt ? await this.employeDe(tx, user) : null;
      const progres = await this.progresDe(
        tx,
        employeeId,
        lecons.map((l) => l.id),
      );
      const d = this.detailDe(f, modules, lecons, progres, employeeId ? 'suivi' : 'apercu', false);
      const toutesValidees = d.lessonCount > 0 && d.completedLessons === d.lessonCount;
      const evaluation = await vueEvaluation(
        tx,
        f,
        employeeId,
        toutesValidees,
        this.horloge(),
        this.limiteTentatives,
      );
      return {
        ...d,
        evaluation,
        hasEvaluation: evaluation !== null,
        certified: evaluation?.etat === 'reussie',
        bookmarked: (await this.signetsDe(tx, user.userId)).has(f.id),
      };
    });
  }

  // ———————————————————————————— « Ma liste »

  /** Les formations que le compte garde de côté, et depuis quand. */
  private async signetsDe(tx: Tx, userId: string): Promise<Map<string, Date>> {
    const rows = await tx
      .select({ courseId: t.academyBookmarks.courseId, createdAt: t.academyBookmarks.createdAt })
      .from(t.academyBookmarks)
      .where(eq(t.academyBookmarks.userId, userId));
    return new Map(rows.map((r) => [r.courseId, r.createdAt]));
  }

  /**
   * « Ma liste » : les formations gardées, la dernière gardée en tête. Une
   * formation retirée du catalogue en sort d'elle-même — elle revient avec
   * son signet si la RH la republie.
   */
  async maListe(user: SessionUser): Promise<CourseSummary[]> {
    const formations = await this.catalogue(user);
    const signets = await this.db.withTenant(this.ctx(user), (tx) =>
      this.signetsDe(tx, user.userId),
    );
    return formations
      .filter((f) => signets.has(f.id))
      .sort((a, b) => signets.get(b.id)!.getTime() - signets.get(a.id)!.getTime());
  }

  /** Garder une formation dans « Ma liste ». Deux fois de suite ne double rien. */
  async garder(user: SessionUser, courseId: string): Promise<{ bookmarked: boolean }> {
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const f = await this.formation(tx, courseId).catch(() => null);
      if (!f || f.publishedAt === null) {
        problem(404, 'academy.course_not_found', 'Formation introuvable');
      }
      await tx
        .insert(t.academyBookmarks)
        .values({ tenantId: user.tenantId, userId: user.userId, courseId })
        .onConflictDoNothing();
      return { bookmarked: true };
    });
  }

  /** La retirer de « Ma liste ». Absente, rien à faire — ce n'est pas une erreur. */
  async oublier(user: SessionUser, courseId: string): Promise<{ bookmarked: boolean }> {
    return this.db.withTenant(this.ctx(user), async (tx) => {
      await tx
        .delete(t.academyBookmarks)
        .where(
          and(
            eq(t.academyBookmarks.userId, user.userId),
            eq(t.academyBookmarks.courseId, courseId),
          ),
        );
      return { bookmarked: false };
    });
  }

  // ———————————————————————————— gestion du catalogue (RH)

  async gestionListe(user: SessionUser): Promise<CourseAdminSummary[]> {
    this.exigerGestion(user);
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const formations = await tx
        .select()
        .from(t.academyCourses)
        .orderBy(desc(t.academyCourses.updatedAt));
      const { modules, lecons } = await this.structure(
        tx,
        formations.map((f) => f.id),
      );
      const banques = await taillesDesBanques(
        tx,
        formations.map((f) => f.id),
      );
      return formations.map((f) => {
        const siens = modules.filter((m) => m.courseId === f.id);
        const leurs = lecons.filter((l) => l.courseId === f.id);
        const {
          modules: _m,
          mode: _mode,
          evaluation: _e,
          ...resume
        } = this.detailDe(f, modules, lecons, new Map(), 'apercu', true);
        return {
          ...resume,
          hasEvaluation: (banques.get(f.id) ?? 0) > 0,
          obstacleCount: this.obstacles(siens, leurs).length,
        };
      });
    });
  }

  async gestionDetail(user: SessionUser, courseId: string): Promise<CourseAdminView> {
    this.exigerGestion(user);
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const f = await this.formation(tx, courseId);
      const { modules, lecons } = await this.structure(tx, [f.id]);
      const quiz = await quizAdmin(tx, f);
      return {
        ...this.detailDe(f, modules, lecons, new Map(), 'apercu', true),
        hasEvaluation: quiz.questions.length > 0,
        obstacles: this.obstacles(modules, lecons),
        quiz,
      };
    });
  }

  async creerFormation(user: SessionUser, input: SaveCourseInput): Promise<{ id: string }> {
    this.exigerGestion(user);
    const id = uuidv7();
    await this.db.withTenant(this.ctx(user), (tx) =>
      tx.insert(t.academyCourses).values({
        id,
        tenantId: user.tenantId,
        title: input.title,
        summary: input.summary ?? null,
        category: input.category,
        createdByUserId: user.userId,
      }),
    );
    return { id };
  }

  async modifierFormation(user: SessionUser, id: string, input: SaveCourseInput): Promise<void> {
    this.exigerGestion(user);
    await this.db.withTenant(this.ctx(user), async (tx) => {
      await this.formation(tx, id);
      await tx
        .update(t.academyCourses)
        .set({
          title: input.title,
          summary: input.summary ?? null,
          category: input.category,
          updatedAt: new Date(),
        })
        .where(eq(t.academyCourses.id, id));
    });
  }

  /**
   * Publier, ou retirer du catalogue.
   *
   * Publier exige une formation COMPLÈTE : chaque module a ses leçons, chaque
   * leçon sa vidéo prête. Retirer est toujours possible — les progressions
   * restent, et reviennent avec la formation.
   */
  async publier(user: SessionUser, id: string, publiee: boolean): Promise<void> {
    this.exigerGestion(user);
    await this.db.withTenant(this.ctx(user), async (tx) => {
      const f = await this.formation(tx, id);
      if (publiee) {
        const { modules, lecons } = await this.structure(tx, [id]);
        const obstacles = this.obstacles(modules, lecons);
        if (obstacles.length > 0) {
          problem(
            422,
            'academy.publication_incomplete',
            'La formation n’est pas encore publiable',
            obstacles.map((o) => o.texte).join(' '),
          );
        }
      }
      if (publiee === (f.publishedAt !== null)) return;
      await tx
        .update(t.academyCourses)
        .set({ publishedAt: publiee ? new Date() : null, updatedAt: new Date() })
        .where(eq(t.academyCourses.id, id));
    });
  }

  /**
   * Ce qui se supprime, se supprime en BROUILLON seulement.
   *
   * Supprimer une leçon publiée effacerait la progression de ceux qui la
   * suivent, sans qu'ils le sachent. La RH retire d'abord la formation du
   * catalogue : le geste devient délibéré.
   */
  private exigerBrouillon(f: LigneFormation): void {
    if (f.publishedAt !== null) {
      problem(
        409,
        'academy.course_published',
        'La formation est publiée',
        'Retirez-la du catalogue avant de supprimer quoi que ce soit : des agents la suivent.',
      );
    }
  }

  /** Les vidéos à effacer du stockage, une fois la base à jour. */
  private async effacerVideos(
    tenantId: string,
    lecons: Array<{ videoUid: string | null; videoProvider: string | null }>,
  ) {
    for (const l of lecons) {
      if (l.videoUid && l.videoProvider === 'local') {
        await this.stockage.supprimer(tenantId, l.videoUid).catch(() => undefined);
      }
    }
  }

  async supprimerFormation(user: SessionUser, id: string): Promise<void> {
    this.exigerGestion(user);
    const lecons = await this.db.withTenant(this.ctx(user), async (tx) => {
      const f = await this.formation(tx, id);
      this.exigerBrouillon(f);
      const siennes = await this.lecons(tx, eq(t.academyLessons.courseId, id));
      await tx.delete(t.academyCourses).where(eq(t.academyCourses.id, id));
      return siennes;
    });
    await this.effacerVideos(user.tenantId, lecons);
  }

  private async toucher(tx: Tx, courseId: string): Promise<void> {
    await tx
      .update(t.academyCourses)
      .set({ updatedAt: new Date() })
      .where(eq(t.academyCourses.id, courseId));
  }

  async creerModule(user: SessionUser, courseId: string, title: string): Promise<{ id: string }> {
    this.exigerGestion(user);
    const id = uuidv7();
    await this.db.withTenant(this.ctx(user), async (tx) => {
      await this.formation(tx, courseId);
      const [rang] = await tx
        .select({ max: sql<number>`coalesce(max(${t.academyModules.position}), -1)::int` })
        .from(t.academyModules)
        .where(eq(t.academyModules.courseId, courseId));
      await tx.insert(t.academyModules).values({
        id,
        tenantId: user.tenantId,
        courseId,
        position: (rang?.max ?? -1) + 1,
        title,
      });
      await this.toucher(tx, courseId);
    });
    return { id };
  }

  private async module(tx: Tx, id: string): Promise<LigneModule> {
    const [row] = await tx
      .select({
        id: t.academyModules.id,
        courseId: t.academyModules.courseId,
        position: t.academyModules.position,
        title: t.academyModules.title,
      })
      .from(t.academyModules)
      .where(eq(t.academyModules.id, id))
      .limit(1);
    if (!row) problem(404, 'academy.module_not_found', 'Module introuvable');
    return row;
  }

  async renommerModule(user: SessionUser, id: string, title: string): Promise<void> {
    this.exigerGestion(user);
    await this.db.withTenant(this.ctx(user), async (tx) => {
      const m = await this.module(tx, id);
      await tx
        .update(t.academyModules)
        .set({ title, updatedAt: new Date() })
        .where(eq(t.academyModules.id, id));
      await this.toucher(tx, m.courseId);
    });
  }

  async supprimerModule(user: SessionUser, id: string): Promise<void> {
    this.exigerGestion(user);
    const lecons = await this.db.withTenant(this.ctx(user), async (tx) => {
      const m = await this.module(tx, id);
      this.exigerBrouillon(await this.formation(tx, m.courseId));
      const siennes = await this.lecons(tx, eq(t.academyLessons.moduleId, id));
      await tx.delete(t.academyModules).where(eq(t.academyModules.id, id));
      await this.toucher(tx, m.courseId);
      return siennes;
    });
    await this.effacerVideos(user.tenantId, lecons);
  }

  /**
   * Monter ou descendre d'un cran : on ÉCHANGE avec le voisin. Les rangs sont
   * uniques, mais la contrainte est différée — l'état intermédiaire où deux
   * modules partagent un rang n'existe que dans la transaction.
   */
  async deplacerModule(user: SessionUser, id: string, sens: 'haut' | 'bas'): Promise<void> {
    this.exigerGestion(user);
    await this.db.withTenant(this.ctx(user), async (tx) => {
      const m = await this.module(tx, id);
      const [voisin] = await tx
        .select({ id: t.academyModules.id, position: t.academyModules.position })
        .from(t.academyModules)
        .where(
          and(
            eq(t.academyModules.courseId, m.courseId),
            sens === 'haut'
              ? lt(t.academyModules.position, m.position)
              : gt(t.academyModules.position, m.position),
          ),
        )
        .orderBy(sens === 'haut' ? desc(t.academyModules.position) : asc(t.academyModules.position))
        .limit(1);
      if (!voisin) return;
      await tx
        .update(t.academyModules)
        .set({ position: voisin.position })
        .where(eq(t.academyModules.id, m.id));
      await tx
        .update(t.academyModules)
        .set({ position: m.position })
        .where(eq(t.academyModules.id, voisin.id));
      await this.toucher(tx, m.courseId);
    });
  }

  async creerLecon(user: SessionUser, moduleId: string, title: string): Promise<{ id: string }> {
    this.exigerGestion(user);
    const id = uuidv7();
    await this.db.withTenant(this.ctx(user), async (tx) => {
      const m = await this.module(tx, moduleId);
      const [rang] = await tx
        .select({ max: sql<number>`coalesce(max(${t.academyLessons.position}), -1)::int` })
        .from(t.academyLessons)
        .where(eq(t.academyLessons.moduleId, moduleId));
      await tx.insert(t.academyLessons).values({
        id,
        tenantId: user.tenantId,
        courseId: m.courseId,
        moduleId,
        position: (rang?.max ?? -1) + 1,
        title,
      });
      await this.toucher(tx, m.courseId);
    });
    return { id };
  }

  async renommerLecon(user: SessionUser, id: string, title: string): Promise<void> {
    this.exigerGestion(user);
    await this.db.withTenant(this.ctx(user), async (tx) => {
      const l = await this.lecon(tx, id);
      await tx
        .update(t.academyLessons)
        .set({ title, updatedAt: new Date() })
        .where(eq(t.academyLessons.id, id));
      await this.toucher(tx, l.courseId);
    });
  }

  async supprimerLecon(user: SessionUser, id: string): Promise<void> {
    this.exigerGestion(user);
    const lecon = await this.db.withTenant(this.ctx(user), async (tx) => {
      const l = await this.lecon(tx, id);
      this.exigerBrouillon(await this.formation(tx, l.courseId));
      await tx.delete(t.academyLessons).where(eq(t.academyLessons.id, id));
      await this.toucher(tx, l.courseId);
      return l;
    });
    await this.effacerVideos(user.tenantId, [lecon]);
  }

  async deplacerLecon(user: SessionUser, id: string, sens: 'haut' | 'bas'): Promise<void> {
    this.exigerGestion(user);
    await this.db.withTenant(this.ctx(user), async (tx) => {
      const l = await this.lecon(tx, id);
      const [voisin] = await tx
        .select({ id: t.academyLessons.id, position: t.academyLessons.position })
        .from(t.academyLessons)
        .where(
          and(
            eq(t.academyLessons.moduleId, l.moduleId),
            sens === 'haut'
              ? lt(t.academyLessons.position, l.position)
              : gt(t.academyLessons.position, l.position),
          ),
        )
        .orderBy(sens === 'haut' ? desc(t.academyLessons.position) : asc(t.academyLessons.position))
        .limit(1);
      if (!voisin) return;
      await tx
        .update(t.academyLessons)
        .set({ position: voisin.position })
        .where(eq(t.academyLessons.id, l.id));
      await tx
        .update(t.academyLessons)
        .set({ position: l.position })
        .where(eq(t.academyLessons.id, voisin.id));
      await this.toucher(tx, l.courseId);
    });
  }

  // ———————————————————————————— vidéo

  /**
   * Préparer l'envoi d'une vidéo : un identifiant neuf chez le fournisseur,
   * et l'adresse où l'écran enverra le fichier.
   *
   * Remplacer la vidéo d'une leçon efface l'ancienne dès maintenant : la
   * leçon disparaît du parcours des agents le temps que la nouvelle soit
   * prête, plutôt que de montrer une vidéo qu'on a décidé de retirer.
   */
  async preparerVideo(
    user: SessionUser,
    lessonId: string,
    input: PrepareVideoInput,
  ): Promise<VideoUploadTarget> {
    this.exigerGestion(user);
    if (input.size > MAX_VIDEO_LOCALE_BYTES) {
      problem(
        413,
        'academy.video_too_large',
        'Le fichier dépasse 2 Go',
        'Exportez la vidéo en 1080p ou 720p : douze minutes y tiennent largement.',
      );
    }
    const { uid, cible } = this.stockage.preparerEnvoi(lessonId);
    const ancienne = await this.db.withTenant(this.ctx(user), async (tx) => {
      const l = await this.lecon(tx, lessonId);
      await tx
        .update(t.academyLessons)
        .set({
          videoProvider: this.stockage.nom,
          videoUid: uid,
          videoStatus: 'envoi',
          videoError: null,
          durationSeconds: null,
          updatedAt: new Date(),
        })
        .where(eq(t.academyLessons.id, lessonId));
      await this.toucher(tx, l.courseId);
      return l;
    });
    await this.effacerVideos(user.tenantId, [ancienne]);
    return cible;
  }

  private async marquerErreur(user: SessionUser, lessonId: string, uid: string, texte: string) {
    await this.db.withTenant(this.ctx(user), (tx) =>
      tx
        .update(t.academyLessons)
        .set({ videoStatus: 'erreur', videoError: texte, updatedAt: new Date() })
        .where(and(eq(t.academyLessons.id, lessonId), eq(t.academyLessons.videoUid, uid))),
    );
  }

  /**
   * Recevoir le fichier (stockage LOCAL seulement).
   *
   * Aucune transaction n'est ouverte pendant l'envoi : il peut durer des
   * minutes, et une transaction ouverte aussi longtemps retiendrait une
   * connexion à la base que les autres écrans attendent.
   */
  async recevoirVideo(
    user: SessionUser,
    lessonId: string,
    flux: Readable,
  ): Promise<{ durationSeconds: number }> {
    this.exigerGestion(user);
    const lecon = await this.db.withTenant(this.ctx(user), (tx) => this.lecon(tx, lessonId));
    if (lecon.videoStatus !== 'envoi' || lecon.videoProvider !== 'local' || !lecon.videoUid) {
      problem(409, 'academy.upload_not_prepared', 'Aucun envoi n’est attendu pour cette leçon');
    }
    const uid = lecon.videoUid;

    let temporaire: string;
    try {
      temporaire = await this.stockage.recevoir(user.tenantId, uid, flux);
    } catch (err) {
      const tropLourde = err instanceof VideoTropLourde;
      const texte = tropLourde ? 'Le fichier dépasse 2 Go.' : 'L’envoi a été interrompu.';
      await this.marquerErreur(user, lessonId, uid, texte);
      problem(tropLourde ? 413 : 400, 'academy.upload_failed', texte);
    }

    const duree = await dureeMp4(temporaire).catch(() => null);
    if (duree === null) {
      await rm(temporaire, { force: true });
      const texte = 'Ce fichier n’est pas une vidéo MP4 lisible.';
      await this.marquerErreur(user, lessonId, uid, texte);
      problem(422, 'academy.video_unreadable', texte, 'Exportez la vidéo au format MP4 (H.264).');
    }
    if (duree > DUREE_MAX_LECON_S + MARGE_DUREE_S) {
      await rm(temporaire, { force: true });
      const texte = `La vidéo dure ${formatDuree(duree)} : une leçon fait 12 minutes au plus.`;
      await this.marquerErreur(user, lessonId, uid, texte);
      problem(422, 'academy.video_too_long', texte, 'Découpez-la en plusieurs leçons.');
    }

    await this.stockage.installer(temporaire, user.tenantId, uid);
    const installee = await this.db.withTenant(this.ctx(user), async (tx) => {
      const res = await tx
        .update(t.academyLessons)
        .set({
          videoStatus: 'prete',
          videoError: null,
          durationSeconds: duree,
          updatedAt: new Date(),
        })
        .where(and(eq(t.academyLessons.id, lessonId), eq(t.academyLessons.videoUid, uid)))
        .returning({ id: t.academyLessons.id });
      if (res.length === 0) return false;
      // La vidéo a changé : ce qu'on avait vu de l'ANCIENNE ne vaut plus pour
      // la nouvelle. Ceux qui avaient validé la leçon la gardent validée.
      await tx
        .delete(t.academyLessonProgress)
        .where(
          and(
            eq(t.academyLessonProgress.lessonId, lessonId),
            isNull(t.academyLessonProgress.completedAt),
          ),
        );
      await this.toucher(tx, lecon.courseId);
      return true;
    });
    if (!installee) {
      // Un autre envoi a été préparé entre-temps : celui-ci est déjà caduc.
      await this.stockage.supprimer(user.tenantId, uid);
      problem(409, 'academy.upload_superseded', 'Un autre envoi a remplacé celui-ci');
    }
    return { durationSeconds: duree };
  }

  // ———————————————————————————— support PDF

  async deposerSupport(
    user: SessionUser,
    lessonId: string,
    filename: string,
    data: Buffer,
  ): Promise<void> {
    this.exigerGestion(user);
    if (data.length === 0 || data.length > MAX_SUPPORT_BYTES) {
      problem(422, 'academy.support_too_large', 'Le support doit faire 10 Mo maximum');
    }
    if (data.subarray(0, 5).toString() !== '%PDF-') {
      problem(422, 'academy.support_not_pdf', 'Le support doit être un PDF');
    }
    await this.db.withTenant(this.ctx(user), async (tx) => {
      const l = await this.lecon(tx, lessonId);
      await tx
        .insert(t.academyLessonSupports)
        .values({ lessonId, tenantId: user.tenantId, filename, data, size: data.length })
        .onConflictDoUpdate({
          target: t.academyLessonSupports.lessonId,
          set: { filename, data, size: data.length, createdAt: new Date() },
        });
      await this.toucher(tx, l.courseId);
    });
  }

  async supprimerSupport(user: SessionUser, lessonId: string): Promise<void> {
    this.exigerGestion(user);
    await this.db.withTenant(this.ctx(user), async (tx) => {
      const l = await this.lecon(tx, lessonId);
      await tx
        .delete(t.academyLessonSupports)
        .where(eq(t.academyLessonSupports.lessonId, lessonId));
      await this.toucher(tx, l.courseId);
    });
  }

  /**
   * Le parcours d'un utilisateur dans la formation d'une leçon, et la place
   * de cette leçon dedans. Sert à la lecture comme au support : ce qui est
   * verrouillé l'est pour les deux.
   */
  private async situer(tx: Tx, user: SessionUser, lessonId: string) {
    const lecon = await this.lecon(tx, lessonId);
    const f = await this.formationVisible(tx, lecon.courseId, user);
    const employeeId = f.publishedAt ? await this.employeDe(tx, user) : null;
    const mode: ModeLecture = employeeId ? 'suivi' : 'apercu';
    const { modules, lecons } = await this.structure(tx, [f.id]);
    const progres = await this.progresDe(
      tx,
      employeeId,
      lecons.map((l) => l.id),
    );
    const etapes = this.etapes(modules, lecons, progres, mode);
    const rang = etapes.findIndex((e) => e.lecon.id === lessonId);
    return { lecon, f, employeeId, mode, etapes, rang };
  }

  async support(user: SessionUser, lessonId: string): Promise<{ filename: string; data: Buffer }> {
    return this.db.withTenant(this.ctx(user), async (tx) => {
      if (!this.gere(user)) {
        const { etapes, rang } = await this.situer(tx, user, lessonId);
        if (rang < 0 || etapes[rang]!.etat === 'verrouillee') {
          problem(403, 'academy.lesson_locked', 'Terminez d’abord les leçons précédentes');
        }
      }
      const [s] = await tx
        .select({ filename: t.academyLessonSupports.filename, data: t.academyLessonSupports.data })
        .from(t.academyLessonSupports)
        .where(eq(t.academyLessonSupports.lessonId, lessonId))
        .limit(1);
      if (!s) problem(404, 'academy.no_support', 'Aucun support pour cette leçon');
      return s;
    });
  }

  // ———————————————————————————— lecture

  /**
   * Ouvrir une leçon : la source vidéo, signée, et — pour un agent qui suit
   * la formation — une SESSION DE LECTURE neuve.
   *
   * Une seule session par agent : en ouvrir une remplace la précédente, et
   * l'onglet qui la portait l'apprend à son battement suivant. La réserve de
   * temps, elle, reste celle de l'agent d'une session à l'autre : recharger
   * la page ne la remplit pas.
   */
  async demarrer(user: SessionUser, lessonId: string): Promise<LessonPlayback> {
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const { lecon, f, employeeId, mode, etapes, rang } = await this.situer(tx, user, lessonId);
      if (rang < 0 || !lecon.videoUid || lecon.durationSeconds === null) {
        problem(409, 'academy.video_unavailable', 'La vidéo de cette leçon n’est pas prête');
      }
      const etape = etapes[rang]!;
      if (etape.etat === 'verrouillee') {
        problem(403, 'academy.lesson_locked', 'Terminez d’abord les leçons précédentes');
      }

      let sessionId: string | null = null;
      if (mode === 'suivi' && employeeId) {
        sessionId = randomUUID();
        const maintenant = this.horloge();
        await tx
          .insert(t.academyViewers)
          .values({
            employeeId,
            tenantId: user.tenantId,
            sessionId,
            lessonId,
            tokens: RESERVE_MAX_S,
            tokensAt: maintenant,
            startedAt: maintenant,
          })
          .onConflictDoUpdate({
            target: t.academyViewers.employeeId,
            set: { sessionId, lessonId, startedAt: maintenant },
          });
      }

      const intervalles = etape.progres?.watched ?? [];
      const validee = Boolean(etape.progres?.completedAt);
      const duree = lecon.durationSeconds;
      // Reprendre là où l'on s'était arrêté — sauf tout à la fin : une leçon
      // terminée se revoit depuis le début.
      const position = etape.progres?.positionSeconds ?? 0;
      const reprise = position >= duree - 5 ? 0 : position;
      return {
        lessonId,
        courseId: f.id,
        title: lecon.title,
        mode,
        sessionId,
        source: this.stockage.source(user.tenantId, lecon.videoUid),
        durationSeconds: duree,
        intervalles,
        plusLoin: plusLoin(intervalles),
        reprise,
        validee,
        vu: partVue(intervalles, duree),
        precedente: rang > 0 ? etapes[rang - 1]!.lecon.id : null,
        suivante: rang < etapes.length - 1 ? etapes[rang + 1]!.lecon.id : null,
      };
    });
  }

  /**
   * Un battement du lecteur : le passage joué depuis le précédent.
   *
   * Tout se décide ici, sous verrou de ligne — deux battements du même agent
   * arrivés ensemble ne se croisent pas : la réserve et les passages sont lus
   * et réécrits d'un seul tenant.
   */
  async battement(user: SessionUser, lessonId: string, input: BeatInput): Promise<BeatResult> {
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const employeeId = await this.employeDe(tx, user);
      if (!employeeId) {
        problem(403, 'academy.preview_only', 'En aperçu, rien n’est enregistré');
      }
      const [lecteur] = await tx
        .select()
        .from(t.academyViewers)
        .where(eq(t.academyViewers.employeeId, employeeId))
        .for('update');
      if (!lecteur || lecteur.sessionId !== input.sessionId || lecteur.lessonId !== lessonId) {
        problem(
          409,
          'academy.playing_elsewhere',
          'La lecture se poursuit ailleurs',
          'Une autre leçon, ou la même dans un autre onglet, a pris le relais.',
        );
      }
      const lecon = await this.lecon(tx, lessonId);
      if (lecon.videoStatus !== 'prete' || lecon.durationSeconds === null) {
        problem(409, 'academy.video_unavailable', 'La vidéo de cette leçon n’est pas prête');
      }
      const duree = lecon.durationSeconds;
      const [progres] = await tx
        .select()
        .from(t.academyLessonProgress)
        .where(
          and(
            eq(t.academyLessonProgress.employeeId, employeeId),
            eq(t.academyLessonProgress.lessonId, lessonId),
          ),
        )
        .for('update');

      const maintenant = this.horloge();
      const dejaValidee = Boolean(progres?.completedAt);
      const r = crediter({
        intervalles: progres?.watched ?? [],
        reserve: { jetons: lecteur.tokens, a: lecteur.tokensAt.getTime() },
        segment: { de: input.de, a: input.a },
        maintenant: maintenant.getTime(),
        duree,
        validee: dejaValidee,
      });
      const atteint = atteintLeSeuil(r.intervalles, duree);
      const loin = plusLoin(r.intervalles);
      const completedAt = progres?.completedAt ?? (atteint ? maintenant : null);
      // La reprise ne se fait jamais au-delà de ce qui a été crédité, tant que
      // la leçon n'est pas validée : un passage rogné par la réserve ne doit
      // pas devenir, à la réouverture, un saut offert.
      const declaree = Math.min(Math.max(input.a, 0), duree);
      const position = completedAt ? declaree : Math.min(declaree, loin);

      await tx
        .insert(t.academyLessonProgress)
        .values({
          tenantId: user.tenantId,
          employeeId,
          lessonId,
          watched: r.intervalles,
          watchedSeconds: totalVu(r.intervalles),
          positionSeconds: position,
          completedAt,
          startedAt: maintenant,
          updatedAt: maintenant,
        })
        .onConflictDoUpdate({
          target: [t.academyLessonProgress.employeeId, t.academyLessonProgress.lessonId],
          set: {
            watched: r.intervalles,
            watchedSeconds: totalVu(r.intervalles),
            positionSeconds: position,
            completedAt,
            updatedAt: maintenant,
          },
        });
      await tx
        .update(t.academyViewers)
        .set({ tokens: r.reserve.jetons, tokensAt: new Date(r.reserve.a) })
        .where(eq(t.academyViewers.employeeId, employeeId));

      return {
        intervalles: r.intervalles,
        plusLoin: loin,
        vu: partVue(r.intervalles, duree),
        validee: completedAt !== null,
        vientDeValider: !dejaValidee && completedAt !== null,
        refus: r.refus,
      };
    });
  }

  // ———————————————————————————— média (stockage local)

  /** Le fichier d'une vidéo locale, si l'adresse signée tient. */
  media(tenantId: string, uid: string, exp: string, sig: string): string {
    if (!this.stockage.verifier(tenantId, uid, exp, sig)) {
      problem(403, 'academy.media_forbidden', 'Adresse de lecture invalide ou expirée');
    }
    return this.stockage.chemin(tenantId, uid);
  }
}
