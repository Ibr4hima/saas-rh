/**
 * L'évaluation finale et le certificat, contre la base.
 *
 * Les règles pures sont éprouvées dans `academy-evaluation.spec.ts` ; ici on
 * vérifie qu'elles sont BRANCHÉES : que l'écran ne reçoit jamais les bonnes
 * réponses, que le serveur tient le verrou des leçons, le temps, le rythme
 * des tentatives, et qu'une réussite produit un certificat vérifiable —
 * publiquement, et seulement lui.
 */
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { QuestionInput, SessionUser } from '@teranga/contracts';
import { questionSchema } from '@teranga/contracts';
import { ProblemException } from '../src/common/problem';
import { loadEnv } from '../src/config/env';
import type { QuestionPosee } from '../src/db/schema';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import { AcademyEvaluationService } from '../src/modules/academy/academy-evaluation.service';
import { AcademyService } from '../src/modules/academy/academy.service';
import { StockageVideoLocal } from '../src/modules/academy/stockage-local';

const env = loadEnv();
const tenantId = randomUUID();
const rhUserId = randomUUID();
const agentUserId = randomUUID();
const autreUserId = randomUUID();
const rh = { userId: rhUserId, tenantId, role: 'hr' } as SessionUser;
const agent = { userId: agentUserId, tenantId, role: 'employee' } as SessionUser;
const autre = { userId: autreUserId, tenantId, role: 'employee' } as SessionUser;

let ownerPool: Pool;
let db: TenantDb;
let academy: AcademyService;
let evaluation: AcademyEvaluationService;
let repertoire: string;
let horloge = Date.UTC(2026, 8, 25, 9, 0, 0);
let agentEmployeeId: string;
let courseId: string;
let lecons: string[];

const raw = (q: string, p: unknown[] = []) => ownerPool.query(q, p as never[]);
const HEURE = 3600 * 1000;

async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'AUCUNE ERREUR';
  } catch (err) {
    if (err instanceof ProblemException) return err.problem.code;
    return `NON-PROBLEM: ${(err as Error).message}`;
  }
}

const question = (i: number): QuestionInput => ({
  prompt: `Question numéro ${i}`,
  kind: i % 4 === 0 ? 'multiple' : 'unique',
  options: [
    { text: 'Bonne', correct: true },
    { text: i % 4 === 0 ? 'Bonne aussi' : 'Fausse', correct: i % 4 === 0 },
    { text: 'Fausse encore', correct: false },
  ],
});

async function creerAgent(userId: string, nom: string, numero: string): Promise<string> {
  const personId = randomUUID();
  const employeeId = randomUUID();
  await raw(
    `INSERT INTO persons (id, tenant_id, user_id, given_name, family_name) VALUES ($1,$2,$3,$4,'Diop')`,
    [personId, tenantId, userId, nom],
  );
  await raw(
    `INSERT INTO employees (id, tenant_id, person_id, employee_number, hired_on)
     VALUES ($1,$2,$3,$4,'2024-01-01')`,
    [employeeId, tenantId, personId, numero],
  );
  return employeeId;
}

/** Une formation publiée, deux leçons prêtes — sans vidéo réelle : on ne lit rien ici. */
async function formationPubliee(): Promise<void> {
  courseId = randomUUID();
  const moduleId = randomUUID();
  await raw(
    `INSERT INTO academy_courses (id, tenant_id, title, category, published_at, created_by_user_id, quiz_question_count)
     VALUES ($1,$2,'PowerPoint','bureautique', now(), $3, 5)`,
    [courseId, tenantId, rhUserId],
  );
  await raw(
    `INSERT INTO academy_modules (id, tenant_id, course_id, position, title) VALUES ($1,$2,$3,0,'Bases')`,
    [moduleId, tenantId, courseId],
  );
  lecons = [randomUUID(), randomUUID()];
  for (const [i, id] of lecons.entries()) {
    await raw(
      `INSERT INTO academy_lessons (id, tenant_id, course_id, module_id, position, title,
         video_provider, video_uid, video_status, duration_seconds)
       VALUES ($1,$2,$3,$4,$5,$6,'local',$7,'prete',60)`,
      [id, tenantId, courseId, moduleId, i, `Leçon ${i + 1}`, randomUUID()],
    );
  }
  for (let i = 0; i < 8; i += 1) await evaluation.creerQuestion(rh, courseId, question(i));
}

async function validerLecons(employeeId = agentEmployeeId): Promise<void> {
  for (const id of lecons) {
    await raw(
      `INSERT INTO academy_lesson_progress (tenant_id, employee_id, lesson_id, watched, watched_seconds, completed_at)
       VALUES ($1,$2,$3,'[[0,60]]',60, now())`,
      [tenantId, employeeId, id],
    );
  }
}

/** Les bonnes réponses d'une copie, lues EN BASE — l'écran ne les a jamais. */
async function bonnesReponses(
  attemptId: string,
  justes = Infinity,
): Promise<Record<string, string[]>> {
  const { rows } = await raw(`SELECT questions FROM academy_quiz_attempts WHERE id = $1`, [
    attemptId,
  ]);
  const posees = rows[0].questions as QuestionPosee[];
  return Object.fromEntries(
    posees.map((q, i) => [
      q.id,
      i < justes
        ? q.correct
        : q.options
            .filter((o) => !q.correct.includes(o.id))
            .map((o) => o.id)
            .slice(0, 1),
    ]),
  );
}

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 3 });
  db = new TenantDb();
  repertoire = mkdtempSync(join(tmpdir(), 'academy-eval-'));
  academy = new AcademyService(db, new StockageVideoLocal(repertoire));
  evaluation = new AcademyEvaluationService(db);
  academy.horloge = () => new Date(horloge);
  evaluation.horloge = () => new Date(horloge);

  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1,'APIX',$2)`, [
    tenantId,
    `eval-${tenantId.slice(0, 8)}`,
  ]);
  for (const [id, nom] of [
    [rhUserId, 'rh'],
    [agentUserId, 'agent'],
    [autreUserId, 'autre'],
  ]) {
    await raw(
      `INSERT INTO users (id, email, password_hash, given_name, family_name) VALUES ($1,$2,'x','T',$3)`,
      [id, `eval-${nom}-${id}@test.local`, nom],
    );
  }
  agentEmployeeId = await creerAgent(agentUserId, 'Awa', 'EVA-001');
  await creerAgent(autreUserId, 'Moussa', 'EVA-002');
});

/** Fixe la limite de tentatives des deux services — `null` : sans limite. */
function limiter(parJour: number | null): void {
  academy.limiteTentatives = parJour;
  evaluation.limiteTentatives = parJour;
}

beforeEach(async () => {
  horloge = Date.UTC(2026, 8, 25, 9, 0, 0);
  limiter(null);
  await raw(`DELETE FROM academy_certificates WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM academy_courses WHERE tenant_id = $1`, [tenantId]);
  await formationPubliee();
});

afterAll(async () => {
  await raw(`DELETE FROM academy_certificates WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM academy_courses WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM employees WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM persons WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM audit_log WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  await raw(`DELETE FROM users WHERE id = ANY($1)`, [[rhUserId, agentUserId, autreUserId]]);
  rmSync(repertoire, { recursive: true, force: true });
  await db?.pool.end();
  await ownerPool?.end();
});

describe('la banque de questions', () => {
  it('refuse une question sans bonne réponse, ou à choix unique avec deux', () => {
    expect(
      questionSchema.safeParse({
        ...question(1),
        options: question(1).options.map((o) => ({ ...o, correct: false })),
      }).success,
    ).toBe(false);
    expect(
      questionSchema.safeParse({
        ...question(1),
        options: question(1).options.map((o) => ({ ...o, correct: true })),
      }).success,
    ).toBe(false);
    expect(questionSchema.safeParse(question(4)).success).toBe(true);
  });

  it('se lit dans l’atelier, bonnes réponses comprises', async () => {
    const vue = await academy.gestionDetail(rh, courseId);
    expect(vue.quiz.questions).toHaveLength(8);
    expect(vue.quiz.questions[0]!.options.some((o) => o.correct)).toBe(true);
    expect(vue.hasEvaluation).toBe(true);
  });
});

describe('le verrou des leçons', () => {
  it('l’évaluation reste fermée tant qu’une leçon n’est pas validée', async () => {
    expect((await academy.detail(agent, courseId)).evaluation?.etat).toBe('verrouillee');
    expect(await codeOf(() => evaluation.demarrer(agent, courseId))).toBe(
      'academy.evaluation_locked',
    );
    await validerLecons();
    const ev = (await academy.detail(agent, courseId)).evaluation!;
    expect(ev).toMatchObject({
      etat: 'ouverte',
      questionCount: 5,
      minutes: 10,
      tentativesParJour: null,
      tentativesRestantes: null,
    });
  });

  it('un compte sans dossier d’agent ne compose pas', async () => {
    expect(await codeOf(() => evaluation.demarrer(rh, courseId))).toBe('academy.preview_only');
  });
});

describe('la copie', () => {
  it('pose 5 questions sans jamais envoyer les bonnes réponses, et fixe l’heure limite', async () => {
    await validerLecons();
    const copie = await evaluation.demarrer(agent, courseId);
    expect(copie.questions).toHaveLength(5);
    expect(JSON.stringify(copie)).not.toContain('"correct"');
    expect(new Date(copie.expiresAt).getTime() - new Date(copie.startedAt).getTime()).toBe(
      5 * 120 * 1000,
    );
  });

  it('un rechargement reprend la même copie : il ne coûte pas une tentative', async () => {
    limiter(3);
    await validerLecons();
    const a = await evaluation.demarrer(agent, courseId);
    horloge += 60_000;
    const b = await evaluation.demarrer(agent, courseId);
    expect(b.id).toBe(a.id);
    expect((await academy.detail(agent, courseId)).evaluation).toMatchObject({
      etat: 'en_cours',
      tentativesRestantes: 2,
    });
  });

  it('réussir délivre un certificat, et ferme l’évaluation', async () => {
    await validerLecons();
    const copie = await evaluation.demarrer(agent, courseId);
    horloge += 5 * 60_000;
    const r = await evaluation.soumettre(agent, copie.id, {
      answers: await bonnesReponses(copie.id),
    });
    expect(r).toMatchObject({ passed: true, score: 1, correctCount: 5, total: 5, expired: false });
    expect(r.certificat?.number).toMatch(/^APX-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(r.evaluation.etat).toBe('reussie');
    expect((await academy.catalogue(agent)).find((c) => c.id === courseId)?.certified).toBe(true);
    expect(await codeOf(() => evaluation.demarrer(agent, courseId))).toBe(
      'academy.already_certified',
    );
  });

  it('4 sur 5 réussit, 3 sur 5 échoue', async () => {
    await validerLecons();
    const a = await evaluation.demarrer(agent, courseId);
    const echec = await evaluation.soumettre(agent, a.id, {
      answers: await bonnesReponses(a.id, 3),
    });
    expect(echec).toMatchObject({ passed: false, correctCount: 3, certificat: null });
    const b = await evaluation.demarrer(agent, courseId);
    const reussite = await evaluation.soumettre(agent, b.id, {
      answers: await bonnesReponses(b.id, 4),
    });
    expect(reussite.passed).toBe(true);
  });

  it('une copie rendue ne se rend pas deux fois', async () => {
    await validerLecons();
    const a = await evaluation.demarrer(agent, courseId);
    await evaluation.soumettre(agent, a.id, { answers: {} });
    expect(await codeOf(() => evaluation.soumettre(agent, a.id, { answers: {} }))).toBe(
      'academy.attempt_closed',
    );
  });

  it('la copie d’un autre ne se rend pas', async () => {
    await validerLecons();
    const a = await evaluation.demarrer(agent, courseId);
    expect(await codeOf(() => evaluation.soumettre(autre, a.id, { answers: {} }))).toBe(
      'academy.attempt_not_found',
    );
  });

  it('rendue après l’heure limite, elle compte pour zéro — même juste', async () => {
    await validerLecons();
    const a = await evaluation.demarrer(agent, courseId);
    horloge += 10 * 60_000 + 31_000;
    const r = await evaluation.soumettre(agent, a.id, { answers: await bonnesReponses(a.id) });
    expect(r).toMatchObject({ expired: true, passed: false, score: 0 });
  });

  it('une copie abandonnée compte comme un échec à la tentative suivante', async () => {
    await validerLecons();
    await evaluation.demarrer(agent, courseId);
    horloge += 11 * 60_000;
    const b = await evaluation.demarrer(agent, courseId);
    const { rows } = await raw(
      `SELECT passed, score FROM academy_quiz_attempts WHERE employee_id = $1 AND id <> $2`,
      [agentEmployeeId, b.id],
    );
    expect(rows).toEqual([{ passed: false, score: 0 }]);
  });

  it('se corrige contre ce qui a été posé, même si la RH change la banque entre-temps', async () => {
    await validerLecons();
    const a = await evaluation.demarrer(agent, courseId);
    const reponses = await bonnesReponses(a.id);
    const vue = await academy.gestionDetail(rh, courseId);
    for (const q of vue.quiz.questions) await evaluation.supprimerQuestion(rh, q.id);
    const r = await evaluation.soumettre(agent, a.id, { answers: reponses });
    expect(r.passed).toBe(true);
  });
});

describe('l’essai de la RH', () => {
  /** Les réponses d'après la BANQUE : les `justes` premières bonnes, les autres fausses. */
  async function reponsesDeBanque(
    ids: string[],
    justes = Infinity,
  ): Promise<Record<string, string[]>> {
    const { rows } = await raw(`SELECT id, options FROM academy_questions WHERE id = ANY($1)`, [
      ids,
    ]);
    const parId = new Map(
      rows.map((r) => [r.id as string, r.options as Array<{ id: string; correct: boolean }>]),
    );
    return Object.fromEntries(
      ids.map((id, i) => {
        const o = parId.get(id)!;
        return [
          id,
          i < justes
            ? o.filter((x) => x.correct).map((x) => x.id)
            : [o.find((x) => !x.correct)!.id],
        ];
      }),
    );
  }

  const compter = async (table: string) =>
    (await raw(`SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1`, [tenantId])).rows[0]
      .n as number;

  it('tire une copie comme celle d’un agent — sans les réponses, et sans rien enregistrer', async () => {
    const copie = await evaluation.essayer(rh, courseId);
    expect(copie.questions).toHaveLength(5);
    expect(JSON.stringify(copie)).not.toContain('"correct"');
    expect(new Date(copie.expiresAt).getTime() - new Date(copie.startedAt).getTime()).toBe(
      5 * 120 * 1000,
    );
    expect(await compter('academy_quiz_attempts')).toBe(0);
  });

  it('corrige avec la règle de l’épreuve, et rend les bonnes réponses', async () => {
    const copie = await evaluation.essayer(rh, courseId);
    const ids = copie.questions.map((q) => q.id);
    const r = await evaluation.corrigerEssai(rh, courseId, {
      questionIds: ids,
      answers: await reponsesDeBanque(ids, 3),
    });
    expect(r).toMatchObject({ correctCount: 3, total: 5, score: 0.6, passed: false });
    expect(r.questions.map((q) => q.id)).toEqual(ids);
    expect(r.questions.map((q) => q.correct)).toEqual([true, true, true, false, false]);
    for (const q of r.questions) expect(q.options.some((o) => o.correct)).toBe(true);
    expect(r.questions[4]!.options.find((o) => o.chosen)?.correct).toBe(false);

    const r2 = await evaluation.corrigerEssai(rh, courseId, {
      questionIds: ids,
      answers: await reponsesDeBanque(ids),
    });
    expect(r2.passed).toBe(true);
    expect(await compter('academy_quiz_attempts')).toBe(0);
    expect(await compter('academy_certificates')).toBe(0);
  });

  it('écarte une question supprimée entre le tirage et la correction', async () => {
    const copie = await evaluation.essayer(rh, courseId);
    const ids = copie.questions.map((q) => q.id);
    await evaluation.supprimerQuestion(rh, ids[0]!);
    const r = await evaluation.corrigerEssai(rh, courseId, {
      questionIds: ids,
      answers: await reponsesDeBanque(ids.slice(1)),
    });
    expect(r).toMatchObject({ total: 4, correctCount: 4, passed: true });
  });

  it('est réservé à la RH', async () => {
    expect(await codeOf(() => evaluation.essayer(agent, courseId))).toBe('academy.forbidden');
    expect(
      await codeOf(() =>
        evaluation.corrigerEssai(agent, courseId, { questionIds: [randomUUID()], answers: {} }),
      ),
    ).toBe('academy.forbidden');
    expect(await codeOf(() => evaluation.specimen(agent, courseId, 1))).toBe('academy.forbidden');
  });

  it('le certificat spécimen sort en PDF — ni enregistré, ni vérifiable', async () => {
    const pdf = await evaluation.specimen(rh, courseId, 0.8);
    expect(pdf.data.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.filename).toBe('Certificat specimen.pdf');
    expect(await compter('academy_certificates')).toBe(0);
    expect(await codeOf(() => evaluation.verifier('APX-XXXX-XXXX'))).toBe(
      'academy.certificate_not_found',
    );
  });
});

describe('le rythme', () => {
  it('sans limite — le réglage actuel —, on recompose autant qu’il le faut', async () => {
    await validerLecons();
    for (let k = 0; k < 6; k += 1) {
      const a = await evaluation.demarrer(agent, courseId);
      await evaluation.soumettre(agent, a.id, { answers: {} });
      horloge += 60_000;
    }
    const ev = (await academy.detail(agent, courseId)).evaluation!;
    expect(ev).toMatchObject({ etat: 'ouverte', tentativesRestantes: null });
    expect((await evaluation.demarrer(agent, courseId)).questions).toHaveLength(5);
  });

  it('avec une limite de trois par vingt-quatre heures, puis l’attente', async () => {
    limiter(3);
    await validerLecons();
    for (let k = 0; k < 3; k += 1) {
      const a = await evaluation.demarrer(agent, courseId);
      await evaluation.soumettre(agent, a.id, { answers: {} });
      horloge += HEURE;
    }
    expect(await codeOf(() => evaluation.demarrer(agent, courseId))).toBe(
      'academy.attempts_exhausted',
    );
    const ev = (await academy.detail(agent, courseId)).evaluation!;
    expect(ev.etat).toBe('attente');
    expect(ev.prochaineTentative).toBe(new Date(Date.UTC(2026, 8, 26, 9, 0, 0)).toISOString());

    horloge = Date.UTC(2026, 8, 26, 9, 0, 1);
    expect((await evaluation.demarrer(agent, courseId)).questions).toHaveLength(5);
  });
});

describe('le certificat', () => {
  async function reussir(): Promise<string> {
    await validerLecons();
    const a = await evaluation.demarrer(agent, courseId);
    const r = await evaluation.soumettre(agent, a.id, { answers: await bonnesReponses(a.id) });
    return r.certificat!.number;
  }

  it('se vérifie publiquement par son numéro, même saisi à la main', async () => {
    const numero = await reussir();
    const saisie = numero.toLowerCase().replace(/-/g, ' ');
    expect(await evaluation.verifier(saisie)).toMatchObject({
      number: numero,
      status: 'valide',
      holderName: 'Awa Diop',
      courseTitle: 'PowerPoint',
      organizationName: 'APIX',
      score: 1,
    });
    expect(await codeOf(() => evaluation.verifier('APX-0000-0000'))).toBe(
      'academy.certificate_not_found',
    );
  });

  it('la vérification publique ne voit que SON certificat, jamais une liste', async () => {
    const numero = await reussir();
    await raw(
      `INSERT INTO academy_certificates (id, tenant_id, employee_id, number, holder_name, holder_number,
         course_title, course_category, organization_name, score)
       VALUES ($1,$2,$3,'APX-ZZZZ-ZZZZ','Autre','X','Autre','bureautique','APIX',1)`,
      [randomUUID(), tenantId, agentEmployeeId],
    );
    const vus = await db.withCertificateNumber(numero, (tx) =>
      tx.execute(sql`SELECT number FROM academy_certificates`),
    );
    expect(vus.rows).toEqual([{ number: numero }]);
  });

  it('garde ce qu’il atteste, même si la formation est renommée ensuite', async () => {
    const numero = await reussir();
    await raw(`UPDATE academy_courses SET title = 'Autre titre' WHERE id = $1`, [courseId]);
    expect((await evaluation.verifier(numero)).courseTitle).toBe('PowerPoint');
  });

  it('expire au bout de la validité fixée — et l’évaluation se rouvre', async () => {
    await evaluation.reglerEvaluation(rh, courseId, {
      questionCount: 5,
      certificateValidityMonths: 12,
    });
    const numero = await reussir();
    expect((await evaluation.verifier(numero)).expiresAt?.slice(0, 10)).toBe('2027-09-25');
    horloge = Date.UTC(2027, 9, 1);
    expect((await evaluation.verifier(numero)).status).toBe('expire');
    expect((await academy.detail(agent, courseId)).evaluation?.etat).toBe('ouverte');
  });

  it('se télécharge en PDF par son titulaire et par la RH — pas par un collègue', async () => {
    await reussir();
    const [c] = await evaluation.mesCertificats(agent);
    const pdf = await evaluation.pdf(agent, c!.id);
    expect(pdf.data.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.data.length).toBeGreaterThan(5000);
    expect((await evaluation.pdf(rh, c!.id)).filename).toBe(`Certificat ${c!.number}.pdf`);
    expect(await codeOf(() => evaluation.pdf(autre, c!.id))).toBe('academy.certificate_not_found');
    expect(await codeOf(() => evaluation.certificatsDe(autre, agentEmployeeId))).toBe(
      'academy.forbidden',
    );
    expect(await evaluation.certificatsDe(rh, agentEmployeeId)).toHaveLength(1);
  });
});
