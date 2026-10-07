import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type {
  AcademyCategory,
  AttemptResult,
  AttemptView,
  CertificateSummary,
  EvaluationView,
  FormationAnimee,
  PublicCertificateView,
  QuestionInput,
  QuizAdminView,
  QuizSettingsInput,
  RevoquerCertificatInput,
  SessionUser,
  SubmitAttemptInput,
  SubmitTrialInput,
  TrialResult,
} from '@teranga/contracts';
import { peut, SEUIL_REUSSITE, TENTATIVES_PAR_JOUR } from '@teranga/contracts';
import { problem } from '../../common/problem';
import { loadEnv } from '../../config/env';
import * as t from '../../db/schema';
import { TenantDb, type Tx } from '../../db/tenant-db';
import { ENTETE } from '../documents/entete';
import { genererCertificatPdf } from './certificat-pdf';
import { notifier } from '../notifications/notifier';
import {
  corriger,
  dureeTentative,
  expiration,
  fenetreTentatives,
  hasardSur,
  normaliserNumero,
  numeroCertificat,
  renouvelable,
  statutCertificat,
  tirerQuestions,
  type Hasard,
} from './evaluation';

/* ————————————————————————————————————————————————————————————————
   APIX Academy — l'évaluation finale et le certificat.

   La RH tient une BANQUE de questions par formation. L'agent qui a validé
   toutes les leçons compose : le serveur tire ses questions, fixe l'heure
   limite, garde les bonnes réponses pour lui et corrige la copie rendue. À
   80 % ou plus, il émet un certificat numéroté — et c'est tout : aucune
   étape de l'écran ne peut décider d'une réussite.

   Les règles elles-mêmes vivent dans `evaluation.ts`, en fonctions pures ;
   ce service les applique aux données et tient les verrous.
   ———————————————————————————————————————————————————————————————— */

/** La copie arrive par le réseau : trente secondes de marge après l'heure limite. */
const GRACE_SOUMISSION_S = 30;

type LigneFormation = typeof t.academyCourses.$inferSelect;
type LigneCertificat = typeof t.academyCertificates.$inferSelect;
type LigneTentative = typeof t.academyQuizAttempts.$inferSelect;

/** Le dossier d'agent ACTIF relié à un compte, s'il y en a un. */
export async function employeActif(tx: Tx, userId: string): Promise<string | null> {
  const [row] = await tx
    .select({ id: t.employees.id })
    .from(t.employees)
    .innerJoin(t.persons, eq(t.persons.id, t.employees.personId))
    .where(
      and(
        eq(t.persons.userId, userId),
        isNull(t.persons.deletedAt),
        eq(t.employees.status, 'active'),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

/**
 * Le dossier relié à un compte, actif ou non : ses certificats restent à
 * l'agent qui n'est plus en activité, le temps de son mois d'accès.
 */
async function sonDossier(tx: Tx, userId: string): Promise<string | null> {
  const [row] = await tx
    .select({ id: t.employees.id })
    .from(t.employees)
    .innerJoin(t.persons, eq(t.persons.id, t.employees.personId))
    .where(and(eq(t.persons.userId, userId), isNull(t.persons.deletedAt)))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Pourquoi l'évaluation est fermée à cet agent — s'il y a lieu.
 *
 * Le formateur a fait la formation : il en suit les leçons, il n'en passe
 * pas l'évaluation. Qui gère le catalogue (la DCH, ses délégués,
 * l'administrateur) en voit les questions : les évaluations lui sont
 * fermées. Tous les autres la passent et obtiennent leur certificat.
 */
export function fermeture(
  f: LigneFormation,
  employeeId: string | null,
  gereLeCatalogue: boolean,
  aVuLesReponses = false,
): 'formateur' | 'gestion' | 'reponses' | null {
  if (!employeeId) return null;
  if (gereLeCatalogue) return 'gestion';
  if (f.formateurEmployeeId === employeeId) return 'formateur';
  return aVuLesReponses ? 'reponses' : null;
}

/**
 * Qui ouvre les bonnes réponses d'une formation s'en souvient : la banque à
 * l'atelier, une question écrite, un essai corrigé. Retenu une fois pour
 * toutes, son évaluation lui reste fermée, même sa délégation retirée.
 */
export async function retenirLesReponsesVues(
  tx: Tx,
  user: SessionUser,
  courseId: string,
): Promise<void> {
  const employeeId = await sonDossier(tx, user.userId);
  if (!employeeId) return;
  await tx
    .insert(t.academyReponsesVues)
    .values({ tenantId: user.tenantId, employeeId, courseId })
    .onConflictDoNothing();
}

export async function aVuLesReponses(
  tx: Tx,
  employeeId: string | null,
  courseId: string,
): Promise<boolean> {
  if (!employeeId) return false;
  const [vue] = await tx
    .select({ courseId: t.academyReponsesVues.courseId })
    .from(t.academyReponsesVues)
    .where(
      and(
        eq(t.academyReponsesVues.employeeId, employeeId),
        eq(t.academyReponsesVues.courseId, courseId),
      ),
    )
    .limit(1);
  return Boolean(vue);
}

/** Combien de questions compte la banque de chaque formation. */
export async function taillesDesBanques(tx: Tx, courseIds: string[]): Promise<Map<string, number>> {
  if (courseIds.length === 0) return new Map();
  const rows = await tx
    .select({ courseId: t.academyQuestions.courseId, n: sql<number>`count(*)::int` })
    .from(t.academyQuestions)
    .where(inArray(t.academyQuestions.courseId, courseIds))
    .groupBy(t.academyQuestions.courseId);
  return new Map(rows.map((r) => [r.courseId, r.n]));
}

/** Les formations pour lesquelles l'agent tient un certificat EN COURS DE VALIDITÉ. */
export async function formationsCertifiees(
  tx: Tx,
  employeeId: string | null,
  maintenant: Date,
): Promise<Set<string>> {
  if (!employeeId) return new Set();
  const rows = await tx
    .select({
      courseId: t.academyCertificates.courseId,
      expiresAt: t.academyCertificates.expiresAt,
      revokedAt: t.academyCertificates.revokedAt,
    })
    .from(t.academyCertificates)
    .where(eq(t.academyCertificates.employeeId, employeeId));
  return new Set(
    rows
      .filter((r) => r.courseId && statutCertificat(r, maintenant) === 'valide')
      .map((r) => r.courseId!),
  );
}

function resumeCertificat(
  c: LigneCertificat,
  maintenant: Date,
  gestes: CertificateSummary['gestes'] = { revoquer: false, reemettre: false },
): CertificateSummary {
  return {
    id: c.id,
    number: c.number,
    courseId: c.courseId,
    courseTitle: c.courseTitle,
    courseCategory: c.courseCategory as AcademyCategory,
    score: c.score,
    issuedAt: c.issuedAt.toISOString(),
    expiresAt: c.expiresAt?.toISOString() ?? null,
    status: statutCertificat(c, maintenant),
    revocationMotif: c.revocationMotif,
    reemisSous: c.reemisSous,
    gestes,
  };
}

/** Toutes les leçons prêtes de la formation sont-elles validées par l'agent ? */
export async function toutesLeconsValidees(
  tx: Tx,
  courseId: string,
  employeeId: string,
): Promise<boolean> {
  const { rows } = await tx.execute<{ total: number; restantes: number }>(sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE p.completed_at IS NULL)::int AS restantes
      FROM academy_lessons l
      LEFT JOIN academy_lesson_progress p
        ON p.lesson_id = l.id AND p.employee_id = ${employeeId}
     WHERE l.course_id = ${courseId} AND l.video_status = 'prete'`);
  const r = rows[0];
  return Boolean(r && r.total > 0 && r.restantes === 0);
}

/**
 * L'évaluation d'une formation, telle que la voit l'agent — ou `null` si la
 * formation n'a pas de banque de questions.
 *
 * Lecture seule : une copie ouverte dont le temps est écoulé est COMPTÉE
 * comme un échec, sans être réécrite ici ; elle le sera à la tentative
 * suivante.
 */
export async function vueEvaluation(
  tx: Tx,
  f: LigneFormation,
  employeeId: string | null,
  toutesValidees: boolean,
  gereLeCatalogue: boolean,
  maintenant: Date,
  parJour: number | null = TENTATIVES_PAR_JOUR,
): Promise<EvaluationView | null> {
  const taille = (await taillesDesBanques(tx, [f.id])).get(f.id) ?? 0;
  if (taille === 0) return null;
  const questionCount = Math.min(f.quizQuestionCount, taille);
  const base = {
    questionCount,
    minutes: Math.ceil(dureeTentative(questionCount) / 60),
    seuil: SEUIL_REUSSITE,
    tentativesParJour: parJour,
  };
  if (!employeeId) {
    return {
      ...base,
      etat: 'verrouillee',
      fermeture: null,
      tentativesRestantes: parJour,
      prochaineTentative: null,
      derniere: null,
      certificat: null,
      renouvellement: false,
    };
  }
  const raison = fermeture(
    f,
    employeeId,
    gereLeCatalogue,
    await aVuLesReponses(tx, employeeId, f.id),
  );

  const certificats = await tx
    .select()
    .from(t.academyCertificates)
    .where(
      and(
        eq(t.academyCertificates.employeeId, employeeId),
        eq(t.academyCertificates.courseId, f.id),
      ),
    )
    .orderBy(desc(t.academyCertificates.issuedAt));
  const valide = certificats.find((c) => statutCertificat(c, maintenant) === 'valide');

  const tentatives = await tx
    .select()
    .from(t.academyQuizAttempts)
    .where(
      and(
        eq(t.academyQuizAttempts.employeeId, employeeId),
        eq(t.academyQuizAttempts.courseId, f.id),
      ),
    )
    .orderBy(desc(t.academyQuizAttempts.startedAt));
  const limite = (a: LigneTentative) => a.expiresAt.getTime() + GRACE_SOUMISSION_S * 1000;
  const ouverte = tentatives.find((a) => !a.submittedAt && limite(a) > maintenant.getTime());
  const rendue = tentatives.find((a) => a.submittedAt || limite(a) <= maintenant.getTime());
  const derniere = rendue
    ? {
        score: rendue.score ?? 0,
        passed: rendue.passed ?? false,
        submittedAt: (rendue.submittedAt ?? rendue.expiresAt).toISOString(),
      }
    : null;
  const { restantes, prochaine } = fenetreTentatives(
    tentatives.map((a) => a.startedAt),
    maintenant,
    parJour,
  );

  // Un certificat qui expire bientôt n'arrête plus l'évaluation : elle se
  // repasse pour le renouveler. Obtenu AVANT d'être désigné formateur, il
  // reste le sien.
  const renouvellement = Boolean(valide && renouvelable(valide, maintenant));
  const acquis = valide && !renouvellement;
  const etat: EvaluationView['etat'] = acquis
    ? 'reussie'
    : raison
      ? 'fermee'
      : !toutesValidees
        ? 'verrouillee'
        : ouverte
          ? 'en_cours'
          : restantes === 0
            ? 'attente'
            : 'ouverte';

  return {
    ...base,
    etat,
    fermeture: acquis ? null : raison,
    tentativesRestantes: restantes,
    prochaineTentative: etat === 'attente' ? (prochaine?.toISOString() ?? null) : null,
    derniere,
    certificat: valide ? resumeCertificat(valide, maintenant) : null,
    renouvellement,
  };
}

/** La banque de questions d'une formation, pour l'atelier de la RH. */
export async function quizAdmin(tx: Tx, f: LigneFormation): Promise<QuizAdminView> {
  const questions = await tx
    .select()
    .from(t.academyQuestions)
    .where(eq(t.academyQuestions.courseId, f.id))
    .orderBy(asc(t.academyQuestions.position));
  return {
    questionCount: f.quizQuestionCount,
    certificateValidityMonths: f.certificateValidityMonths,
    questions: questions.map((q) => ({
      id: q.id,
      position: q.position,
      prompt: q.prompt,
      kind: q.kind === 'multiple' ? 'multiple' : 'unique',
      options: q.options,
    })),
  };
}

@Injectable()
export class AcademyEvaluationService {
  /** L'horloge et le hasard du serveur — remplaçables dans les tests seulement. */
  horloge: () => Date = () => new Date();
  hasard: Hasard = hasardSur;
  /** Tentatives par vingt-quatre heures (`null` : sans limite) — idem. */
  limiteTentatives: number | null = TENTATIVES_PAR_JOUR;

  constructor(@Inject(TenantDb) private readonly db: TenantDb) {}

  private ctx(user: SessionUser) {
    return { tenantId: user.tenantId, userId: user.userId };
  }

  private gere(user: SessionUser): boolean {
    return peut(user, 'academy');
  }

  private exigerGestion(user: SessionUser): void {
    if (!this.gere(user)) {
      problem(
        403,
        'academy.forbidden',
        'Vous n’êtes pas habilité à gérer le catalogue de l’Academy',
      );
    }
  }

  private async formation(tx: Tx, id: string): Promise<LigneFormation> {
    const [f] = await tx
      .select()
      .from(t.academyCourses)
      .where(eq(t.academyCourses.id, id))
      .limit(1);
    if (!f) problem(404, 'academy.course_not_found', 'Formation introuvable');
    return f;
  }

  private async toucher(tx: Tx, courseId: string): Promise<void> {
    await tx
      .update(t.academyCourses)
      .set({ updatedAt: new Date() })
      .where(eq(t.academyCourses.id, courseId));
  }

  // ———————————————————————————— la banque (RH)

  async reglerEvaluation(user: SessionUser, courseId: string, input: QuizSettingsInput) {
    this.exigerGestion(user);
    await this.db.withTenant(this.ctx(user), async (tx) => {
      await this.formation(tx, courseId);
      await tx
        .update(t.academyCourses)
        .set({
          quizQuestionCount: input.questionCount,
          certificateValidityMonths: input.certificateValidityMonths,
          updatedAt: new Date(),
        })
        .where(eq(t.academyCourses.id, courseId));
    });
  }

  /** Les choix reçoivent chacun un identifiant : c'est lui que l'agent coche. */
  private options(input: QuestionInput): t.OptionQuestion[] {
    return input.options.map((o) => ({ id: randomUUID(), text: o.text, correct: o.correct }));
  }

  async creerQuestion(user: SessionUser, courseId: string, input: QuestionInput) {
    this.exigerGestion(user);
    const id = uuidv7();
    await this.db.withTenant(this.ctx(user), async (tx) => {
      await this.formation(tx, courseId);
      const [rang] = await tx
        .select({ max: sql<number>`coalesce(max(${t.academyQuestions.position}), -1)::int` })
        .from(t.academyQuestions)
        .where(eq(t.academyQuestions.courseId, courseId));
      await tx.insert(t.academyQuestions).values({
        id,
        tenantId: user.tenantId,
        courseId,
        position: (rang?.max ?? -1) + 1,
        prompt: input.prompt,
        kind: input.kind,
        options: this.options(input),
      });
      await this.toucher(tx, courseId);
      await retenirLesReponsesVues(tx, user, courseId);
    });
    return { id };
  }

  private async question(tx: Tx, id: string) {
    const [q] = await tx
      .select()
      .from(t.academyQuestions)
      .where(eq(t.academyQuestions.id, id))
      .limit(1);
    if (!q) problem(404, 'academy.question_not_found', 'Question introuvable');
    return q;
  }

  /**
   * Modifier une question ne touche pas aux copies déjà posées : chacune
   * garde l'instantané de ce qui lui a été demandé.
   */
  async modifierQuestion(user: SessionUser, id: string, input: QuestionInput) {
    this.exigerGestion(user);
    await this.db.withTenant(this.ctx(user), async (tx) => {
      const q = await this.question(tx, id);
      await tx
        .update(t.academyQuestions)
        .set({
          prompt: input.prompt,
          kind: input.kind,
          options: this.options(input),
          updatedAt: new Date(),
        })
        .where(eq(t.academyQuestions.id, id));
      await this.toucher(tx, q.courseId);
      await retenirLesReponsesVues(tx, user, q.courseId);
    });
  }

  async supprimerQuestion(user: SessionUser, id: string) {
    this.exigerGestion(user);
    await this.db.withTenant(this.ctx(user), async (tx) => {
      const q = await this.question(tx, id);
      await tx.delete(t.academyQuestions).where(eq(t.academyQuestions.id, id));
      await this.toucher(tx, q.courseId);
    });
  }

  async deplacerQuestion(user: SessionUser, id: string, sens: 'haut' | 'bas') {
    this.exigerGestion(user);
    await this.db.withTenant(this.ctx(user), async (tx) => {
      const q = await this.question(tx, id);
      const [voisin] = await tx
        .select({ id: t.academyQuestions.id, position: t.academyQuestions.position })
        .from(t.academyQuestions)
        .where(
          and(
            eq(t.academyQuestions.courseId, q.courseId),
            sens === 'haut'
              ? lt(t.academyQuestions.position, q.position)
              : gt(t.academyQuestions.position, q.position),
          ),
        )
        .orderBy(
          sens === 'haut' ? desc(t.academyQuestions.position) : asc(t.academyQuestions.position),
        )
        .limit(1);
      if (!voisin) return;
      await tx
        .update(t.academyQuestions)
        .set({ position: voisin.position })
        .where(eq(t.academyQuestions.id, q.id));
      await tx
        .update(t.academyQuestions)
        .set({ position: q.position })
        .where(eq(t.academyQuestions.id, voisin.id));
    });
  }

  // ———————————————————————————— l'essai (RH)

  /**
   * Une copie d'ESSAI pour la RH : tirée, mélangée et minutée comme celle
   * d'un agent — mais rien n'est enregistré, ni tentative ni certificat. La
   * RH relit ainsi ses questions dans les conditions de l'épreuve, que la
   * formation soit publiée ou non.
   */
  async essayer(user: SessionUser, courseId: string): Promise<AttemptView> {
    this.exigerGestion(user);
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const f = await this.formation(tx, courseId);
      const banque = await tx
        .select()
        .from(t.academyQuestions)
        .where(eq(t.academyQuestions.courseId, courseId));
      if (banque.length === 0) {
        problem(409, 'academy.no_evaluation', 'Ajoutez d’abord des questions');
      }
      const posees = tirerQuestions(banque, f.quizQuestionCount, this.hasard);
      const maintenant = this.horloge();
      return {
        id: uuidv7(),
        courseId: f.id,
        courseTitle: f.title,
        startedAt: maintenant.toISOString(),
        expiresAt: new Date(
          maintenant.getTime() + dureeTentative(posees.length) * 1000,
        ).toISOString(),
        questions: posees.map(({ correct: _c, ...q }) => q),
      };
    });
  }

  /**
   * Corrige une copie d'essai — avec la règle de l'épreuve, `corriger` — et
   * rend les bonnes réponses. Sans instantané, la correction se fait contre
   * la banque du moment : une question supprimée entre-temps sort du compte.
   */
  async corrigerEssai(
    user: SessionUser,
    courseId: string,
    input: SubmitTrialInput,
  ): Promise<TrialResult> {
    this.exigerGestion(user);
    return this.db.withTenant(this.ctx(user), async (tx) => {
      await this.formation(tx, courseId);
      // La correction rend les bonnes réponses.
      await retenirLesReponsesVues(tx, user, courseId);
      const rows = await tx
        .select()
        .from(t.academyQuestions)
        .where(
          and(
            eq(t.academyQuestions.courseId, courseId),
            inArray(t.academyQuestions.id, input.questionIds),
          ),
        );
      const parId = new Map(rows.map((q) => [q.id, q]));
      const banque = [...new Set(input.questionIds)].flatMap((id) => {
        const q = parId.get(id);
        return q ? [q] : [];
      });
      const posees = banque.map((q) => ({
        id: q.id,
        prompt: q.prompt,
        kind: q.kind === 'multiple' ? ('multiple' as const) : ('unique' as const),
        options: q.options.map((o) => ({ id: o.id, text: o.text })),
        correct: q.options.filter((o) => o.correct).map((o) => o.id),
      }));
      const c = corriger(posees, input.answers);
      return {
        score: c.score,
        passed: c.passed,
        correctCount: c.correctCount,
        total: c.total,
        seuil: SEUIL_REUSSITE,
        questions: banque.map((q, i) => {
          const cochees = input.answers[q.id] ?? [];
          return {
            id: q.id,
            prompt: q.prompt,
            kind: posees[i]!.kind,
            correct: c.parQuestion[i]!.correct,
            options: q.options.map((o) => ({
              id: o.id,
              text: o.text,
              correct: o.correct,
              chosen: cochees.includes(o.id),
            })),
          };
        }),
      };
    });
  }

  /**
   * Le certificat tel qu'un agent le recevra, au nom de la personne qui
   * essaie — barré « SPÉCIMEN », sans numéro attribué, jamais enregistré ni
   * vérifiable.
   */
  async specimen(
    user: SessionUser,
    courseId: string,
    score: number,
  ): Promise<{ filename: string; data: Buffer }> {
    this.exigerGestion(user);
    const d = await this.db.withTenant(this.ctx(user), async (tx) => {
      const f = await this.formation(tx, courseId);
      const [fiche] = await tx
        .select({
          givenName: t.persons.givenName,
          familyName: t.persons.familyName,
          number: t.employees.employeeNumber,
        })
        .from(t.persons)
        .leftJoin(t.employees, eq(t.employees.personId, t.persons.id))
        .where(eq(t.persons.userId, user.userId))
        .limit(1);
      const [compte] = fiche
        ? [fiche]
        : await tx
            .select({ givenName: t.users.givenName, familyName: t.users.familyName })
            .from(t.users)
            .where(eq(t.users.id, user.userId))
            .limit(1);
      return { f, compte, matricule: fiche?.number ?? null };
    });
    const maintenant = this.horloge();
    const numero = 'APX-XXXX-XXXX';
    const data = await genererCertificatPdf({
      numero,
      titulaire: d.compte ? `${d.compte.givenName} ${d.compte.familyName}` : 'Prénom Nom',
      matricule: d.matricule,
      formation: d.f.title,
      organisation: ENTETE.raisonSociale,
      score,
      emisLe: maintenant,
      expireLe: expiration(maintenant, d.f.certificateValidityMonths),
      urlVerification: `${loadEnv().PUBLIC_WEB_URL.replace(/\/$/, '')}/verifier/${numero}`,
      specimen: true,
    });
    return { filename: 'Certificat specimen.pdf', data };
  }

  // ———————————————————————————— la copie (agent)

  private vueTentative(a: LigneTentative, f: LigneFormation): AttemptView {
    return {
      id: a.id,
      courseId: f.id,
      courseTitle: f.title,
      startedAt: a.startedAt.toISOString(),
      expiresAt: a.expiresAt.toISOString(),
      // Les bonnes réponses restent au serveur.
      questions: a.questions.map(({ correct: _c, ...q }) => q),
    };
  }

  /**
   * Commencer l'évaluation — ou reprendre la copie ouverte, si le temps
   * court encore : un rechargement de page ne coûte pas une tentative.
   */
  async demarrer(user: SessionUser, courseId: string): Promise<AttemptView> {
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const employeeId = await employeActif(tx, user.userId);
      if (!employeeId) {
        problem(403, 'academy.preview_only', 'L’évaluation se passe depuis un compte d’agent');
      }
      const f = await this.formation(tx, courseId);
      if (f.publishedAt === null) problem(404, 'academy.course_not_found', 'Formation introuvable');
      const banque = await tx
        .select()
        .from(t.academyQuestions)
        .where(eq(t.academyQuestions.courseId, courseId));
      if (banque.length === 0) {
        problem(409, 'academy.no_evaluation', 'Cette formation n’a pas d’évaluation');
      }
      const raison = fermeture(
        f,
        employeeId,
        this.gere(user),
        await aVuLesReponses(tx, employeeId, f.id),
      );
      if (raison === 'formateur') {
        problem(
          403,
          'academy.formateur',
          'Vous êtes le formateur de cette formation : l’évaluation ne vous concerne pas',
          'Vous pouvez en suivre les leçons librement.',
        );
      }
      if (raison === 'gestion') {
        problem(
          403,
          'academy.gestion',
          'Vous gérez le catalogue : les évaluations vous sont fermées',
          'Vous en connaissez les questions.',
        );
      }
      if (raison === 'reponses') {
        problem(
          403,
          'academy.reponses_vues',
          'Vous avez vu les réponses de cette évaluation : elle vous est fermée',
          'Vous les avez ouvertes en gérant le catalogue.',
        );
      }
      if (!(await toutesLeconsValidees(tx, courseId, employeeId))) {
        problem(403, 'academy.evaluation_locked', 'Validez d’abord toutes les leçons');
      }
      const maintenant = this.horloge();
      // Un certificat valide arrête l'évaluation, sauf dans les jours qui
      // précèdent son expiration : on la repasse pour le renouveler.
      const acquis = (
        await tx
          .select()
          .from(t.academyCertificates)
          .where(
            and(
              eq(t.academyCertificates.employeeId, employeeId),
              eq(t.academyCertificates.courseId, courseId),
            ),
          )
      ).some((c) => statutCertificat(c, maintenant) === 'valide' && !renouvelable(c, maintenant));
      if (acquis) {
        problem(409, 'academy.already_certified', 'Vous avez déjà réussi cette évaluation');
      }

      const [ouverte] = await tx
        .select()
        .from(t.academyQuizAttempts)
        .where(
          and(
            eq(t.academyQuizAttempts.employeeId, employeeId),
            eq(t.academyQuizAttempts.courseId, courseId),
            isNull(t.academyQuizAttempts.submittedAt),
          ),
        )
        .for('update');
      if (ouverte) {
        if (ouverte.expiresAt.getTime() + GRACE_SOUMISSION_S * 1000 > maintenant.getTime()) {
          return this.vueTentative(ouverte, f);
        }
        // Temps écoulé sans copie rendue : c'est un échec, et il compte.
        await tx
          .update(t.academyQuizAttempts)
          .set({ submittedAt: ouverte.expiresAt, score: 0, passed: false })
          .where(eq(t.academyQuizAttempts.id, ouverte.id));
      }

      const debuts = await tx
        .select({ startedAt: t.academyQuizAttempts.startedAt })
        .from(t.academyQuizAttempts)
        .where(
          and(
            eq(t.academyQuizAttempts.employeeId, employeeId),
            eq(t.academyQuizAttempts.courseId, courseId),
          ),
        );
      const { restantes, prochaine } = fenetreTentatives(
        debuts.map((d) => d.startedAt),
        maintenant,
        this.limiteTentatives,
      );
      if (restantes === 0) {
        problem(
          429,
          'academy.attempts_exhausted',
          'Vos tentatives du jour sont passées',
          prochaine ? `Prochaine tentative possible : ${prochaine.toISOString()}` : undefined,
        );
      }

      const posees = tirerQuestions(banque, f.quizQuestionCount, this.hasard);
      const tentative = {
        id: uuidv7(),
        tenantId: user.tenantId,
        employeeId,
        courseId,
        questions: posees,
        startedAt: maintenant,
        expiresAt: new Date(maintenant.getTime() + dureeTentative(posees.length) * 1000),
      };
      // Deux clics sur « Commencer » partent ensemble : l'index d'unicité ne
      // laisse passer qu'une copie ouverte, et la seconde demande reçoit la
      // première au lieu d'une erreur.
      const [inseree] = await tx
        .insert(t.academyQuizAttempts)
        .values(tentative)
        .onConflictDoNothing()
        .returning({ id: t.academyQuizAttempts.id });
      if (!inseree) {
        const [deja] = await tx
          .select()
          .from(t.academyQuizAttempts)
          .where(
            and(
              eq(t.academyQuizAttempts.employeeId, employeeId),
              eq(t.academyQuizAttempts.courseId, courseId),
              isNull(t.academyQuizAttempts.submittedAt),
            ),
          )
          .limit(1);
        if (deja) return this.vueTentative(deja, f);
      }
      return this.vueTentative(
        { ...tentative, submittedAt: null, answers: null, score: null, passed: null },
        f,
      );
    });
  }

  /**
   * Rendre la copie. Le serveur corrige contre l'instantané de la tentative ;
   * à 80 % ou plus, il émet le certificat DANS LA MÊME TRANSACTION — une
   * réussite sans certificat, ou l'inverse, ne peut pas exister.
   */
  async soumettre(
    user: SessionUser,
    attemptId: string,
    input: SubmitAttemptInput,
  ): Promise<AttemptResult> {
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const employeeId = await employeActif(tx, user.userId);
      if (!employeeId) {
        problem(403, 'academy.preview_only', 'L’évaluation se passe depuis un compte d’agent');
      }
      const [a] = await tx
        .select()
        .from(t.academyQuizAttempts)
        .where(
          and(
            eq(t.academyQuizAttempts.id, attemptId),
            eq(t.academyQuizAttempts.employeeId, employeeId),
          ),
        )
        .for('update');
      if (!a) problem(404, 'academy.attempt_not_found', 'Copie introuvable');
      if (a.submittedAt) problem(409, 'academy.attempt_closed', 'Cette copie a déjà été rendue');

      const maintenant = this.horloge();
      const expiree = maintenant.getTime() > a.expiresAt.getTime() + GRACE_SOUMISSION_S * 1000;
      const reponses = expiree ? null : input.answers;
      const c = corriger(a.questions, reponses);
      await tx
        .update(t.academyQuizAttempts)
        .set({ submittedAt: maintenant, answers: reponses, score: c.score, passed: c.passed })
        .where(eq(t.academyQuizAttempts.id, a.id));

      const f = await this.formation(tx, a.courseId);
      let certificat: CertificateSummary | null = null;
      // Désigné formateur pendant sa copie : elle compte, sans certificat.
      const fermee = fermeture(
        f,
        employeeId,
        this.gere(user),
        await aVuLesReponses(tx, employeeId, f.id),
      );
      if (c.passed && fermee === null) {
        certificat = resumeCertificat(
          await this.emettre(tx, user, employeeId, f, a.id, c.score, maintenant),
          maintenant,
        );
      }
      const evaluation = await vueEvaluation(
        tx,
        f,
        employeeId,
        true,
        this.gere(user),
        maintenant,
        this.limiteTentatives,
      );
      const libelles = new Map(a.questions.map((q) => [q.id, q.prompt]));
      return {
        score: c.score,
        passed: c.passed,
        correctCount: c.correctCount,
        total: c.total,
        questions: c.parQuestion.map((q) => ({
          id: q.id,
          prompt: libelles.get(q.id) ?? '',
          correct: q.correct,
        })),
        expired: expiree,
        certificat,
        evaluation: evaluation!,
      };
    });
  }

  /** Émet le certificat, avec l'instantané de ce qu'il atteste. */
  private async emettre(
    tx: Tx,
    user: SessionUser,
    employeeId: string,
    f: LigneFormation,
    attemptId: string,
    score: number,
    maintenant: Date,
  ): Promise<LigneCertificat> {
    const [agent] = await tx
      .select({
        givenName: t.persons.givenName,
        familyName: t.persons.familyName,
        number: t.employees.employeeNumber,
      })
      .from(t.employees)
      .innerJoin(t.persons, eq(t.persons.id, t.employees.personId))
      .where(eq(t.employees.id, employeeId))
      .limit(1);
    // Le numéro est tiré au hasard : une collision est improbable, pas
    // impossible — on retire alors, sans faire échouer la réussite.
    for (let essai = 0; essai < 5; essai += 1) {
      const [c] = await tx
        .insert(t.academyCertificates)
        .values({
          id: uuidv7(),
          tenantId: user.tenantId,
          employeeId,
          courseId: f.id,
          attemptId,
          number: numeroCertificat(this.hasard),
          holderName: agent ? `${agent.givenName} ${agent.familyName}` : '—',
          holderNumber: agent?.number ?? '—',
          courseTitle: f.title,
          courseCategory: f.category,
          // L'émetteur, tel qu'il signe ses actes : la raison sociale, et non
          // le nom court du compte.
          organizationName: ENTETE.raisonSociale,
          score,
          issuedAt: maintenant,
          expiresAt: expiration(maintenant, f.certificateValidityMonths),
        })
        .onConflictDoNothing({ target: t.academyCertificates.number })
        .returning();
      if (c) return c;
    }
    problem(500, 'academy.certificate_number', 'Impossible d’attribuer un numéro de certificat');
  }

  // ———————————————————————————— les certificats

  /** Qui voit l'Academy d'un agent : lui, qui gère l'Academy, qui consulte les dossiers. */
  private async exigerDeVoir(tx: Tx, user: SessionUser, employeeId: string): Promise<void> {
    if (this.gere(user) || peut(user, 'personnel.consulter')) return;
    if ((await sonDossier(tx, user.userId)) !== employeeId) {
      problem(403, 'academy.forbidden', 'Ces certificats ne sont pas les vôtres');
    }
  }

  /** Les certificats d'un agent : la DCH les voit tous, l'agent les siens. */
  async certificatsDe(user: SessionUser, employeeId: string): Promise<CertificateSummary[]> {
    return this.db.withTenant(this.ctx(user), async (tx) => {
      await this.exigerDeVoir(tx, user, employeeId);
      const maintenant = this.horloge();
      const rows = await tx
        .select()
        .from(t.academyCertificates)
        .where(eq(t.academyCertificates.employeeId, employeeId))
        .orderBy(desc(t.academyCertificates.issuedAt));
      // Qui gère l'Academy révoque ou réémet : jamais ses propres certificats.
      const gerant = this.gere(user) && (await sonDossier(tx, user.userId)) !== employeeId;
      return rows.map((c) => {
        const valide = statutCertificat(c, maintenant) === 'valide';
        return resumeCertificat(c, maintenant, {
          revoquer: gerant && valide,
          reemettre: gerant && valide,
        });
      });
    });
  }

  /** Les formations qu'un agent a faites : son dossier dit qu'il en est le formateur. */
  async formationsAnimees(user: SessionUser, employeeId: string): Promise<FormationAnimee[]> {
    return this.db.withTenant(this.ctx(user), async (tx) => {
      await this.exigerDeVoir(tx, user, employeeId);
      const rows = await tx
        .select({
          id: t.academyCourses.id,
          title: t.academyCourses.title,
          category: t.academyCourses.category,
          publishedAt: t.academyCourses.publishedAt,
        })
        .from(t.academyCourses)
        .where(eq(t.academyCourses.formateurEmployeeId, employeeId))
        .orderBy(asc(t.academyCourses.title));
      return rows.map((r) => ({
        courseId: r.id,
        title: r.title,
        category: r.category as AcademyCategory,
        published: r.publishedAt !== null,
      }));
    });
  }

  async mesFormationsAnimees(user: SessionUser): Promise<FormationAnimee[]> {
    const employeeId = await this.db.withTenant(this.ctx(user), (tx) =>
      sonDossier(tx, user.userId),
    );
    return employeeId ? this.formationsAnimees(user, employeeId) : [];
  }

  async mesCertificats(user: SessionUser): Promise<CertificateSummary[]> {
    const employeeId = await this.db.withTenant(this.ctx(user), (tx) =>
      sonDossier(tx, user.userId),
    );
    return employeeId ? this.certificatsDe(user, employeeId) : [];
  }

  async pdf(user: SessionUser, certificateId: string): Promise<{ filename: string; data: Buffer }> {
    const c = await this.db.withTenant(this.ctx(user), async (tx) => {
      const [c] = await tx
        .select()
        .from(t.academyCertificates)
        .where(eq(t.academyCertificates.id, certificateId))
        .limit(1);
      if (!c) problem(404, 'academy.certificate_not_found', 'Certificat introuvable');
      if (!this.gere(user) && (await sonDossier(tx, user.userId)) !== c.employeeId) {
        problem(404, 'academy.certificate_not_found', 'Certificat introuvable');
      }
      return c;
    });
    const data = await genererCertificatPdf({
      numero: c.number,
      titulaire: c.holderName,
      matricule: c.holderNumber,
      formation: c.courseTitle,
      organisation: c.organizationName,
      score: c.score,
      emisLe: c.issuedAt,
      expireLe: c.expiresAt,
      urlVerification: `${loadEnv().PUBLIC_WEB_URL.replace(/\/$/, '')}/verifier/${c.number}`,
    });
    return { filename: `Certificat ${c.number}.pdf`, data };
  }

  /** La vérification publique : un numéro, et ce qu'il atteste — rien de plus. */
  async verifier(saisie: string): Promise<PublicCertificateView> {
    const numero = normaliserNumero(saisie);
    if (!numero)
      problem(404, 'academy.certificate_not_found', 'Aucun certificat ne porte ce numéro');
    const c = await this.db.withCertificateNumber(numero, async (tx) => {
      const [c] = await tx
        .select()
        .from(t.academyCertificates)
        .where(eq(t.academyCertificates.number, numero))
        .limit(1);
      return c;
    });
    if (!c) problem(404, 'academy.certificate_not_found', 'Aucun certificat ne porte ce numéro');
    return {
      number: c.number,
      status: statutCertificat(c, this.horloge()),
      holderName: c.holderName,
      courseTitle: c.courseTitle,
      courseCategory: c.courseCategory as AcademyCategory,
      organizationName: c.organizationName,
      score: c.score,
      issuedAt: c.issuedAt.toISOString(),
      expiresAt: c.expiresAt?.toISOString() ?? null,
      reemisSous: c.reemisSous,
    };
  }

  // ---------------------------- révoquer, réémettre

  /** Le certificat, verrouillé, pour qui gère l'Academy : pas l'un des siens. */
  private async certificatAGerer(
    tx: Tx,
    user: SessionUser,
    certificateId: string,
  ): Promise<LigneCertificat> {
    this.exigerGestion(user);
    const [c] = await tx
      .select()
      .from(t.academyCertificates)
      .where(eq(t.academyCertificates.id, certificateId))
      .for('update')
      .limit(1);
    if (!c) problem(404, 'academy.certificate_not_found', 'Certificat introuvable');
    if ((await sonDossier(tx, user.userId)) === c.employeeId) {
      problem(403, 'academy.son_certificat', 'Personne ne révoque ni ne réémet ses certificats');
    }
    const statut = statutCertificat(c, this.horloge());
    if (statut !== 'valide') {
      problem(
        422,
        'academy.certificat_clos',
        statut === 'revoque' ? 'Ce certificat est déjà révoqué' : 'Ce certificat a expiré',
      );
    }
    return c;
  }

  /** Le compte du titulaire, s'il en a un : il apprend ce qui arrive à son certificat. */
  private async titulaire(tx: Tx, employeeId: string): Promise<string | null> {
    const [p] = await tx
      .select({ userId: t.persons.userId })
      .from(t.employees)
      .innerJoin(t.persons, eq(t.persons.id, t.employees.personId))
      .where(eq(t.employees.id, employeeId))
      .limit(1);
    return p?.userId ?? null;
  }

  /**
   * Révoquer : le certificat ne vaut plus, la vérification publique le dit
   * aussitôt. Le motif est dit au titulaire ; il reste au journal.
   */
  async revoquer(
    user: SessionUser,
    certificateId: string,
    input: RevoquerCertificatInput,
  ): Promise<void> {
    await this.db.withTenant(this.ctx(user), async (tx) => {
      const c = await this.certificatAGerer(tx, user, certificateId);
      await tx
        .update(t.academyCertificates)
        .set({
          revokedAt: this.horloge(),
          revocationMotif: input.motif,
          revoqueParUserId: user.userId,
        })
        .where(eq(t.academyCertificates.id, c.id));
      const destinataire = await this.titulaire(tx, c.employeeId);
      if (destinataire) {
        await notifier(tx, user.tenantId, destinataire, {
          type: 'certificat_revoque',
          sujet: 'academy',
          title: `Votre certificat « ${c.courseTitle} » est révoqué : ${input.motif}`,
          link: '/academy/certificats',
          dedupeKey: `certificat:${c.id}:revoque`,
        });
      }
    });
  }

  /**
   * Réémettre : un nom ou un matricule corrigé depuis l'émission. Le nouveau
   * certificat reprend la réussite (formation, score, date, échéance) sous
   * le nom actuel du titulaire et un nouveau numéro ; l'ancien est révoqué
   * et renvoie au nouveau.
   */
  async reemettre(user: SessionUser, certificateId: string): Promise<CertificateSummary> {
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const ancien = await this.certificatAGerer(tx, user, certificateId);
      const [agent] = await tx
        .select({
          givenName: t.persons.givenName,
          familyName: t.persons.familyName,
          number: t.employees.employeeNumber,
        })
        .from(t.employees)
        .innerJoin(t.persons, eq(t.persons.id, t.employees.personId))
        .where(eq(t.employees.id, ancien.employeeId))
        .limit(1);
      let nouveau: LigneCertificat | undefined;
      for (let essai = 0; essai < 5 && !nouveau; essai += 1) {
        [nouveau] = await tx
          .insert(t.academyCertificates)
          .values({
            id: uuidv7(),
            tenantId: user.tenantId,
            employeeId: ancien.employeeId,
            courseId: ancien.courseId,
            attemptId: ancien.attemptId,
            number: numeroCertificat(this.hasard),
            holderName: agent ? `${agent.givenName} ${agent.familyName}` : ancien.holderName,
            holderNumber: agent?.number ?? ancien.holderNumber,
            courseTitle: ancien.courseTitle,
            courseCategory: ancien.courseCategory,
            organizationName: ENTETE.raisonSociale,
            score: ancien.score,
            issuedAt: ancien.issuedAt,
            expiresAt: ancien.expiresAt,
          })
          .onConflictDoNothing({ target: t.academyCertificates.number })
          .returning();
      }
      if (!nouveau) {
        problem(
          500,
          'academy.certificate_number',
          'Impossible d’attribuer un numéro de certificat',
        );
      }
      await tx
        .update(t.academyCertificates)
        .set({
          revokedAt: this.horloge(),
          reemisSous: nouveau.number,
          revoqueParUserId: user.userId,
        })
        .where(eq(t.academyCertificates.id, ancien.id));
      const destinataire = await this.titulaire(tx, ancien.employeeId);
      if (destinataire) {
        await notifier(tx, user.tenantId, destinataire, {
          type: 'certificat_reemis',
          sujet: 'academy',
          title: `Votre certificat « ${ancien.courseTitle} » est réémis sous le n° ${nouveau.number}`,
          link: '/academy/certificats',
          dedupeKey: `certificat:${ancien.id}:reemis`,
        });
      }
      return resumeCertificat(nouveau, this.horloge());
    });
  }
}
