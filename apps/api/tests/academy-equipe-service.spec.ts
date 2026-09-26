/**
 * « Mon équipe », contre la base.
 *
 * L'organigramme du test : Mariama encadre Awa, qui encadre Moussa et un
 * ancien agent archivé. Fatou est ailleurs. Le compte RH n'a pas de dossier.
 *
 * On vérifie que l'équipe descend toute la chaîne et s'arrête là, qu'un
 * agent hors de la chaîne est introuvable — vers le haut comme de côté — et
 * que chaque état d'une formation se lit juste, du premier clic au
 * certificat, expiré ou tenu d'une formation retirée depuis.
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser, TeamCourseProgress } from '@teranga/contracts';
import { ProblemException } from '../src/common/problem';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import { AcademyEquipeService } from '../src/modules/academy/academy-equipe.service';

const env = loadEnv();
const tenantId = randomUUID();
const maintenant = new Date(Date.UTC(2026, 8, 26, 9, 0, 0));

const comptes = {
  rh: randomUUID(),
  mariama: randomUUID(),
  awa: randomUUID(),
  moussa: randomUUID(),
  fatou: randomUUID(),
};
const agents = {
  mariama: randomUUID(),
  awa: randomUUID(),
  moussa: randomUUID(),
  fatou: randomUUID(),
  ancien: randomUUID(),
};
const session = (userId: string) => ({ userId, tenantId, role: 'employee' }) as SessionUser;
const rh = { userId: comptes.rh, tenantId, role: 'hr' } as SessionUser;

let ownerPool: Pool;
let db: TenantDb;
let equipe: AcademyEquipeService;
/** La formation évaluée, ses deux leçons, et celle qui ne s'évalue pas. */
let excel: string;
let lecons: string[];
let word: string;

const raw = (q: string, p: unknown[] = []) => ownerPool.query(q, p as never[]);

async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'AUCUNE ERREUR';
  } catch (err) {
    if (err instanceof ProblemException) return err.problem.code;
    return `NON-PROBLEM: ${(err as Error).message}`;
  }
}

async function agent(
  id: string,
  prenom: string,
  nom: string,
  numero: string,
  compte: string | null,
  responsable: string | null,
  statut = 'active',
) {
  const personId = randomUUID();
  await raw(
    `INSERT INTO persons (id, tenant_id, user_id, given_name, family_name) VALUES ($1,$2,$3,$4,$5)`,
    [personId, tenantId, compte, prenom, nom],
  );
  await raw(
    `INSERT INTO employees (id, tenant_id, person_id, employee_number, hired_on, status, manager_employee_id)
     VALUES ($1,$2,$3,$4,'2024-01-01',$5,$6)`,
    [id, tenantId, personId, numero, statut, responsable],
  );
}

/** Une formation publiée : un module, `n` leçons prêtes, et une question si elle s'évalue. */
async function formation(titre: string, n: number, evaluee: boolean): Promise<[string, string[]]> {
  const courseId = randomUUID();
  const moduleId = randomUUID();
  await raw(
    `INSERT INTO academy_courses (id, tenant_id, title, category, published_at, created_by_user_id)
     VALUES ($1,$2,$3,'bureautique', now(), $4)`,
    [courseId, tenantId, titre, comptes.rh],
  );
  await raw(
    `INSERT INTO academy_modules (id, tenant_id, course_id, position, title) VALUES ($1,$2,$3,0,'Bases')`,
    [moduleId, tenantId, courseId],
  );
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const id = randomUUID();
    ids.push(id);
    await raw(
      `INSERT INTO academy_lessons (id, tenant_id, course_id, module_id, position, title,
         video_provider, video_uid, video_status, duration_seconds)
       VALUES ($1,$2,$3,$4,$5,$6,'local',$7,'prete',60)`,
      [id, tenantId, courseId, moduleId, i, `Leçon ${i + 1}`, randomUUID()],
    );
  }
  if (evaluee) {
    await raw(
      `INSERT INTO academy_questions (id, tenant_id, course_id, position, prompt, kind, options)
       VALUES ($1,$2,$3,0,'Vrai ou faux ?','unique',
         '[{"id":"a","text":"Vrai","correct":true},{"id":"b","text":"Faux","correct":false}]')`,
      [randomUUID(), tenantId, courseId],
    );
  }
  return [courseId, ids];
}

async function progres(employeeId: string, lessonId: string, validee: boolean) {
  await raw(
    `INSERT INTO academy_lesson_progress (tenant_id, employee_id, lesson_id, watched, watched_seconds, completed_at, updated_at)
     VALUES ($1,$2,$3,'[[0,30]]',30, $4, $5)
     ON CONFLICT (employee_id, lesson_id) DO UPDATE SET completed_at = EXCLUDED.completed_at`,
    [tenantId, employeeId, lessonId, validee ? maintenant : null, maintenant],
  );
}

async function copie(employeeId: string, courseId: string, reussie: boolean, score: number) {
  const id = randomUUID();
  await raw(
    `INSERT INTO academy_quiz_attempts (id, tenant_id, employee_id, course_id, questions, started_at,
       expires_at, submitted_at, answers, score, passed)
     VALUES ($1,$2,$3,$4,'[]', $5::timestamptz - interval '10 minutes', $5, $5, '{}', $6, $7)`,
    [id, tenantId, employeeId, courseId, maintenant, score, reussie],
  );
  return id;
}

async function certificat(
  employeeId: string,
  courseId: string | null,
  titre: string,
  score: number,
  emis: string,
  expire: string | null,
) {
  const numero = `APX-${randomUUID().slice(0, 4).toUpperCase()}-${randomUUID().slice(0, 4).toUpperCase()}`;
  await raw(
    `INSERT INTO academy_certificates (id, tenant_id, employee_id, course_id, number, holder_name,
       holder_number, course_title, course_category, organization_name, score, issued_at, expires_at)
     VALUES ($1,$2,$3,$4,$5,'Moussa Ndiaye','EQ-003',$6,'bureautique','APIX',$7,$8,$9)`,
    [randomUUID(), tenantId, employeeId, courseId, numero, titre, score, emis, expire],
  );
}

/** La fiche de Moussa vue par Awa, formation par formation. */
async function ficheDeMoussa(): Promise<Map<string, TeamCourseProgress>> {
  const fiche = await equipe.agent(session(comptes.awa), agents.moussa);
  return new Map(fiche.courses.map((c) => [c.title, c]));
}

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 3 });
  db = new TenantDb();
  equipe = new AcademyEquipeService(db);
  equipe.horloge = () => maintenant;

  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1,'Équipe',$2)`, [
    tenantId,
    `equipe-${tenantId.slice(0, 8)}`,
  ]);
  for (const [nom, id] of Object.entries(comptes)) {
    await raw(
      `INSERT INTO users (id, email, password_hash, given_name, family_name)
       VALUES ($1,$2,'x','Test',$3)`,
      [id, `equipe-${nom}-${id}@test.local`, nom],
    );
  }
  await agent(agents.mariama, 'Mariama', 'Cissé', 'EQ-001', comptes.mariama, null);
  await agent(agents.fatou, 'Fatou', 'Sall', 'EQ-004', comptes.fatou, null);
  await agent(agents.awa, 'Awa', 'Diop', 'EQ-002', comptes.awa, agents.mariama);
  await agent(agents.moussa, 'Moussa', 'Ndiaye', 'EQ-003', comptes.moussa, agents.awa);
  await agent(agents.ancien, 'Ancien', 'Agent', 'EQ-009', null, agents.awa, 'archived');

  const unite = randomUUID();
  await raw(
    `INSERT INTO org_units (id, tenant_id, unit_type, name) VALUES ($1,$2,'department','Département Études')`,
    [unite, tenantId],
  );
  await raw(
    `INSERT INTO assignments (id, tenant_id, employee_id, org_unit_id, position_title, validity)
     VALUES ($1,$2,$3,$4,'Chargé d’études', daterange('2024-01-01', NULL))`,
    [randomUUID(), tenantId, agents.moussa, unite],
  );
});

beforeEach(async () => {
  await raw(`DELETE FROM academy_certificates WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM academy_courses WHERE tenant_id = $1`, [tenantId]);
  [excel, lecons] = await formation('Excel', 2, true);
  [word] = await formation('Word', 1, false);
  // Ni un brouillon, ni une formation sans vidéo prête ne comptent.
  await raw(
    `INSERT INTO academy_courses (id, tenant_id, title, category, created_by_user_id)
     VALUES ($1,$2,'Brouillon','bureautique',$3)`,
    [randomUUID(), tenantId, comptes.rh],
  );
  await formation('Sans vidéo', 0, true);
});

afterAll(async () => {
  await raw(`DELETE FROM academy_certificates WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM academy_courses WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM assignments WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM org_units WHERE tenant_id = $1`, [tenantId]);
  await raw(`UPDATE employees SET manager_employee_id = NULL WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM employees WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM persons WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM audit_log WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  await raw(`DELETE FROM users WHERE id = ANY($1)`, [Object.values(comptes)]);
  await db?.pool.end();
  await ownerPool?.end();
});

describe('qui fait partie de l’équipe', () => {
  it('l’organigramme, sur toute la chaîne : Mariama voit Awa, et Moussa par Awa', async () => {
    const vue = await equipe.equipe(session(comptes.mariama));
    expect(
      vue.members.map((m) => [m.givenName, m.level, m.manager.name, m.manager.employeeId]),
    ).toEqual([
      ['Awa', 1, 'Mariama Cissé', agents.mariama],
      ['Moussa', 2, 'Awa Diop', agents.awa],
    ]);
    expect(await equipe.effectif(session(comptes.mariama))).toEqual({ total: 2, direct: 1 });
  });

  it('un dossier archivé ne figure pas dans l’équipe', async () => {
    const vue = await equipe.equipe(session(comptes.awa));
    expect(vue.members.map((m) => m.givenName)).toEqual(['Moussa']);
    expect(await equipe.effectif(session(comptes.awa))).toEqual({ total: 1, direct: 1 });
  });

  it('porte le poste et l’unité du jour', async () => {
    const [moussa] = (await equipe.equipe(session(comptes.awa))).members;
    expect(moussa).toMatchObject({
      number: 'EQ-003',
      positionTitle: 'Chargé d’études',
      unitName: 'Département Études',
    });
  });

  it('personne sous soi, ou pas de dossier : pas d’équipe — le rôle n’y change rien', async () => {
    expect(await equipe.effectif(session(comptes.moussa))).toEqual({ total: 0, direct: 0 });
    expect(await equipe.effectif(rh)).toEqual({ total: 0, direct: 0 });
    expect((await equipe.equipe(rh)).members).toEqual([]);
  });

  it('hors de la chaîne, un agent est introuvable — de côté comme vers le haut', async () => {
    expect(await codeOf(() => equipe.agent(session(comptes.awa), agents.fatou))).toBe(
      'academy.team_member_not_found',
    );
    expect(await codeOf(() => equipe.agent(session(comptes.awa), agents.mariama))).toBe(
      'academy.team_member_not_found',
    );
    expect(await codeOf(() => equipe.agent(session(comptes.moussa), agents.awa))).toBe(
      'academy.team_member_not_found',
    );
    expect(await codeOf(() => equipe.agent(rh, agents.moussa))).toBe(
      'academy.team_member_not_found',
    );
    expect(await codeOf(() => equipe.agent(session(comptes.awa), agents.ancien))).toBe(
      'academy.team_member_not_found',
    );
    // Deux niveaux plus bas, Moussa est bien dans l'équipe de Mariama.
    expect((await equipe.agent(session(comptes.mariama), agents.moussa)).givenName).toBe('Moussa');
  });
});

describe('où en est chaque agent', () => {
  it('ne compte que le catalogue publié, leçons prêtes seulement', async () => {
    const fiche = await ficheDeMoussa();
    expect([...fiche.keys()].sort()).toEqual(['Excel', 'Word']);
    expect(fiche.get('Excel')).toMatchObject({
      status: 'a_commencer',
      lessonCount: 2,
      completedLessons: 0,
      hasEvaluation: true,
      lastActivityAt: null,
      certificate: null,
    });
    expect(fiche.get('Word')).toMatchObject({ hasEvaluation: false });
  });

  it('suit le parcours : en cours, puis l’évaluation qui attend', async () => {
    await progres(agents.moussa, lecons[0]!, true);
    await progres(agents.moussa, lecons[1]!, false);
    expect((await ficheDeMoussa()).get('Excel')).toMatchObject({
      status: 'en_cours',
      completedLessons: 1,
      lastActivityAt: maintenant.toISOString(),
    });

    await progres(agents.moussa, lecons[1]!, true);
    expect((await ficheDeMoussa()).get('Excel')!.status).toBe('evaluation_a_passer');
  });

  it('une copie ratée se dit « pas encore réussie » — sans le score ni le nombre d’essais', async () => {
    for (const l of lecons) await progres(agents.moussa, l, true);
    await copie(agents.moussa, excel, false, 0.4);
    await copie(agents.moussa, excel, false, 0.6);
    const excelVu = (await ficheDeMoussa()).get('Excel')!;
    expect(excelVu.status).toBe('non_reussie');
    expect(Object.keys(excelVu).sort()).toEqual([
      'category',
      'certificate',
      'completedLessons',
      'courseId',
      'hasEvaluation',
      'lastActivityAt',
      'lessonCount',
      'status',
      'title',
    ]);
    expect(JSON.stringify(excelVu)).not.toContain('0.4');
  });

  it('réussie : certifiée, avec le score et la date du certificat', async () => {
    for (const l of lecons) await progres(agents.moussa, l, true);
    await copie(agents.moussa, excel, false, 0.6);
    await copie(agents.moussa, excel, true, 0.9);
    await certificat(agents.moussa, excel, 'Excel', 0.9, '2026-09-20T10:00:00Z', null);
    expect((await ficheDeMoussa()).get('Excel')).toMatchObject({
      status: 'certifiee',
      certificate: {
        score: 0.9,
        issuedAt: '2026-09-20T10:00:00.000Z',
        expiresAt: null,
        status: 'valide',
      },
    });
    const [moussa] = (await equipe.equipe(session(comptes.awa))).members;
    expect(moussa!.counts).toMatchObject({ certifiee: 1, a_commencer: 1 });
  });

  it('certificat expiré : l’évaluation est à repasser, et l’expiration se dit', async () => {
    for (const l of lecons) await progres(agents.moussa, l, true);
    await copie(agents.moussa, excel, true, 0.85);
    await certificat(
      agents.moussa,
      excel,
      'Excel',
      0.85,
      '2025-01-10T10:00:00Z',
      '2026-01-10T10:00:00Z',
    );
    expect((await ficheDeMoussa()).get('Excel')).toMatchObject({
      status: 'evaluation_a_passer',
      certificate: { status: 'expire', expiresAt: '2026-01-10T10:00:00.000Z' },
    });
  });

  it('un certificat révoqué ne se montre pas', async () => {
    for (const l of lecons) await progres(agents.moussa, l, true);
    await certificat(agents.moussa, excel, 'Excel', 0.9, '2026-09-20T10:00:00Z', null);
    await raw(`UPDATE academy_certificates SET revoked_at = now() WHERE employee_id = $1`, [
      agents.moussa,
    ]);
    expect((await ficheDeMoussa()).get('Excel')).toMatchObject({
      status: 'evaluation_a_passer',
      certificate: null,
    });
  });

  it('la formation retirée du catalogue laisse son certificat valide à l’agent', async () => {
    await certificat(agents.moussa, word, 'Word', 1, '2026-09-01T10:00:00Z', null);
    await raw(`DELETE FROM academy_courses WHERE id = $1`, [word]);
    const retiree = (await ficheDeMoussa()).get('Word');
    expect(retiree).toMatchObject({ courseId: null, status: 'certifiee', lessonCount: 0 });
  });

  it('la fiche range ce qui attend l’agent devant ce qu’il n’a pas ouvert', async () => {
    for (const l of lecons) await progres(agents.moussa, l, true);
    const fiche = await equipe.agent(session(comptes.awa), agents.moussa);
    expect(fiche.courses.map((c) => [c.title, c.status])).toEqual([
      ['Excel', 'evaluation_a_passer'],
      ['Word', 'a_commencer'],
    ]);
    expect(fiche.lastActivityAt).toBe(maintenant.toISOString());
  });
});
