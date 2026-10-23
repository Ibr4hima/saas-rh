/**
 * La migration 0111 (ADR-0075), sur une base jetable migrée jusqu'à 0110 :
 * les fiches du 1er et du 2nd semestre d'une même année n'en font plus
 * qu'une, les appels du n+1 suivent la fiche de l'année, la date
 * d'évaluation passe au 15 décembre, et les fiches d'avant restent à part,
 * telles quelles.
 *
 * Une année close (son 15 décembre passé) garde ce qui a été fait ; l'année
 * en cours, ou à venir, n'a pas encore eu son évaluation. D'où des années
 * loin derrière (2020) et loin devant (2095 à 2099) : le test ne dépend pas
 * du jour où il tourne.
 */
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';

const env = loadEnv();
const DEPOT = join(__dirname, '..', 'src', 'db', 'sql');
const MIGRATION = '0111_objectifs_annuels.sql';
const nomBase = `teranga_0111_${randomUUID().slice(0, 8)}`;
const url = (() => {
  const u = new URL(env.DATABASE_URL);
  u.pathname = `/${nomBase}`;
  return u.toString();
})();

const tenantId = randomUUID();
const agent = { user: randomUUID(), person: randomUUID(), employee: randomUUID() };
const n1 = { user: randomUUID(), person: randomUUID(), employee: randomUUID() };

let base: Client;
let dossier: string;
const q = (sql: string, p: unknown[] = []) => base.query(sql, p as never[]);

async function proprietaire(sql: string) {
  const c = new Client({ connectionString: env.DATABASE_URL });
  await c.connect();
  try {
    await c.query(sql);
  } finally {
    await c.end();
  }
}

type Bloc = Record<string, unknown>;
const caseA = (id: string, texte: string, echeance?: string): Bloc => ({
  id,
  type: 'checkListItem',
  props: echeance ? { echeance } : {},
  content: [{ type: 'text', text: texte, styles: {} }],
  children: [],
});
const formation = (id: string, courseId: string, titre: string): Bloc => ({
  id,
  type: 'formation',
  props: { courseId, titre },
  children: [],
});
const paragraphe = (id: string, texte: string): Bloc => ({
  id,
  type: 'paragraph',
  props: {},
  content: [{ type: 'text', text: texte, styles: {} }],
  children: [],
});

interface Semestre {
  contenu: Bloc[];
  statuts?: Record<string, string>;
  agent?: Record<string, string>;
  n1?: Record<string, string>;
  envoyeeLe?: string;
  valideeLe?: string;
  note?: string;
  figees?: unknown[];
  majLe?: string;
}

/** Une fiche par semestre, comme jusqu'à 0110. */
async function fiche(annee: number, semestre: 1 | 2, f: Semestre) {
  await q(
    `INSERT INTO objectifs_fiches
       (id, tenant_id, employee_id, annee, semestre, contenu, statuts, commentaires_agent,
        commentaires_n1, commentaires_envoyes_le, evaluation_validee_le, evaluation_note,
        evaluateur_employee_id, formations_figees, auteur_employee_id, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14::jsonb,$15,
             $16,$16)`,
    [
      randomUUID(),
      tenantId,
      agent.employee,
      annee,
      semestre,
      JSON.stringify(f.contenu),
      JSON.stringify(f.statuts ?? {}),
      JSON.stringify(f.agent ?? {}),
      JSON.stringify(f.n1 ?? {}),
      f.envoyeeLe ?? null,
      f.valideeLe ?? null,
      f.note ?? null,
      f.note || f.n1 ? n1.employee : null,
      f.figees ? JSON.stringify(f.figees) : null,
      n1.employee,
      f.majLe ?? `${annee}-0${semestre === 1 ? 3 : 9}-01T10:00:00Z`,
    ],
  );
}

/** L'appel du n+1 à évaluer un semestre envoyé, comme jusqu'à 0110. */
async function appel(annee: number, semestre: 1 | 2, le: string) {
  await q(
    `INSERT INTO notifications (id, tenant_id, recipient_user_id, type, sujet, title, link,
                                dedupe_key, created_at)
     VALUES ($1,$2,$3,'objectif','equipe.objectifs',$4,$5,$6,$7)`,
    [
      randomUUID(),
      tenantId,
      n1.user,
      `Aminata Diallo a envoyé son auto-évaluation du ${semestre === 1 ? '1er' : '2nd'} semestre ${annee}`,
      `/moi/equipe/suivi/${agent.employee}?vue=evaluation&annee=${annee}`,
      `objectifs:${agent.employee}:${annee}:${semestre}:appel:n1`,
      le,
    ],
  );
}

interface LigneAnnuelle {
  annee: number;
  ids: string[];
  statuts: Record<string, string>;
  agent: Record<string, string>;
  n1: Record<string, string>;
  envoyee: string | null;
  validee: string | null;
  note: string | null;
  evaluateur: string | null;
  figees: { courseId: string }[] | null;
}

async function annuelles(): Promise<Map<number, LigneAnnuelle>> {
  const { rows } = await q(
    `SELECT annee,
            (SELECT coalesce(jsonb_agg(b->>'id' ORDER BY i), '[]'::jsonb)
               FROM jsonb_array_elements(contenu) WITH ORDINALITY AS e (b, i)) AS ids,
            statuts, commentaires_agent AS agent, commentaires_n1 AS n1,
            to_char(commentaires_envoyes_le AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS envoyee,
            to_char(evaluation_validee_le AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS validee,
            evaluation_note AS note, evaluateur_employee_id AS evaluateur,
            formations_figees AS figees
       FROM objectifs_fiches WHERE employee_id = $1 ORDER BY annee`,
    [agent.employee],
  );
  return new Map((rows as LigneAnnuelle[]).map((r) => [r.annee, r]));
}

const coursX = randomUUID();
const coursY = randomUUID();
let avant = 0;

beforeAll(async () => {
  await proprietaire(`CREATE DATABASE ${nomBase}`);
  dossier = mkdtempSync(join(tmpdir(), 'migrations-0111-'));
  for (const f of readdirSync(DEPOT).filter((f) => f.endsWith('.sql') && f < MIGRATION)) {
    copyFileSync(join(DEPOT, f), join(dossier, f));
  }
  await runMigrations(url, { dossier });
  base = new Client({ connectionString: url });
  await base.connect();

  await q(`INSERT INTO tenants (id, name, slug) VALUES ($1,'Migration 0111',$2)`, [
    tenantId,
    `m0111-${tenantId.slice(0, 8)}`,
  ]);
  for (const [qui, prenom, nom, numero, manager] of [
    [n1, 'Bineta', 'Sow', 'M-N1', null],
    [agent, 'Aminata', 'Diallo', 'M-AG', n1.employee],
  ] as const) {
    await q(
      `INSERT INTO users (id, email, password_hash, given_name, family_name)
       VALUES ($1,$2,'x',$3,$4)`,
      [qui.user, `m0111-${qui.user}@test.local`, prenom, nom],
    );
    await q(
      `INSERT INTO persons (id, tenant_id, user_id, given_name, family_name)
       VALUES ($1,$2,$3,$4,$5)`,
      [qui.person, tenantId, qui.user, prenom, nom],
    );
    await q(
      `INSERT INTO employees (id, tenant_id, person_id, employee_number, hired_on, status,
                              manager_employee_id)
       VALUES ($1,$2,$3,$4,'2019-01-01','active',$5)`,
      [qui.employee, tenantId, qui.person, numero, manager],
    );
  }
  // La DCH avait déplacé les deux dates.
  await q(
    `INSERT INTO objective_review_schedule (id, tenant_id, s1_month, s1_day, s2_month, s2_day)
     VALUES ($1,$2,6,30,12,20)`,
    [randomUUID(), tenantId],
  );

  // 2020, close : le 1er semestre évalué A, le 2nd jamais envoyé.
  await fiche(2020, 1, {
    contenu: [caseA('a1', 'Publier le guide', '2020-03-31')],
    statuts: { a1: 'atteint' },
    agent: { a1: 'Publié.' },
    envoyeeLe: '2020-06-25T10:00:00Z',
    valideeLe: '2020-06-30T10:00:00Z',
    note: 'A',
  });
  await fiche(2020, 2, { contenu: [caseA('a2', 'Animer deux ateliers', '2020-09-30')] });
  // 2021, close : deux semestres évalués, A puis C.
  await fiche(2021, 1, {
    contenu: [caseA('b1', 'Refondre le tableau de bord')],
    envoyeeLe: '2021-06-20T10:00:00Z',
    valideeLe: '2021-06-28T10:00:00Z',
    note: 'A',
  });
  await fiche(2021, 2, {
    contenu: [caseA('b2', 'Former l’équipe')],
    envoyeeLe: '2021-12-10T10:00:00Z',
    valideeLe: '2021-12-18T10:00:00Z',
    note: 'C',
  });
  // 2099, à venir : le 1er semestre évalué B, le 2nd en cours ; une
  // formation demandée aux deux semestres, une autre au 2nd seulement.
  await fiche(2099, 1, {
    contenu: [
      caseA('c1', 'Livrer la note', '2099-05-10'),
      caseA('c2', 'Mettre à jour la base'),
      formation('f1', coursX, 'Word pour tous'),
      paragraphe('p1', 'Critères du premier semestre.'),
    ],
    statuts: { c1: 'atteint', c2: 'partiel' },
    agent: { c1: 'Fait.', c2: 'À moitié.' },
    n1: { c1: 'Bien.' },
    envoyeeLe: '2099-06-25T10:00:00Z',
    valideeLe: '2099-06-30T10:00:00Z',
    note: 'B',
    figees: [{ courseId: coursX, statut: 'terminee', lecons: 2, validees: 2 }],
  });
  await fiche(2099, 2, {
    contenu: [
      caseA('d1', 'Préparer le budget', '2099-03-01'),
      caseA('d2', 'Clore les comptes'),
      formation('f2', coursX, 'Word pour tous'),
      formation('f3', coursY, 'Excel avancé'),
      paragraphe('p2', 'Critères du second semestre.'),
    ],
    statuts: { d1: 'partiel' },
    agent: { d1: 'En cours.' },
  });
  // 2098, à venir : les deux semestres envoyés, chacun son appel.
  await fiche(2098, 1, {
    contenu: [caseA('e1', 'Premier')],
    statuts: { e1: 'atteint' },
    agent: { e1: 'Fait.' },
    envoyeeLe: '2098-06-20T10:00:00Z',
    figees: [{ courseId: coursX, statut: 'terminee', lecons: 2, validees: 2 }],
  });
  await fiche(2098, 2, {
    contenu: [caseA('e2', 'Second')],
    statuts: { e2: 'partiel' },
    agent: { e2: 'À moitié.' },
    envoyeeLe: '2098-12-10T10:00:00Z',
    figees: [{ courseId: coursY, statut: 'en_cours', lecons: 4, validees: 1 }],
  });
  await appel(2098, 1, '2098-06-20T10:00:00Z');
  await appel(2098, 2, '2098-12-10T10:00:00Z');
  // 2097, à venir : le 1er semestre envoyé, le 2nd en cours.
  await fiche(2097, 1, {
    contenu: [caseA('g1', 'Premier')],
    statuts: { g1: 'atteint' },
    agent: { g1: 'Fait.' },
    envoyeeLe: '2097-06-20T10:00:00Z',
  });
  await fiche(2097, 2, { contenu: [caseA('g2', 'Second')] });
  await appel(2097, 1, '2097-06-20T10:00:00Z');
  // 2096, à venir : une seule fiche, envoyée.
  await fiche(2096, 2, {
    contenu: [caseA('h1', 'Seul')],
    statuts: { h1: 'atteint' },
    agent: { h1: 'Fait.' },
    envoyeeLe: '2096-12-10T10:00:00Z',
  });
  await appel(2096, 2, '2096-12-10T10:00:00Z');
  // 2095, à venir : un 1er semestre resté vide, un 2nd évalué D.
  await fiche(2095, 1, { contenu: [] });
  await fiche(2095, 2, {
    contenu: [caseA('k1', 'Unique')],
    statuts: { k1: 'non_atteint' },
    agent: { k1: 'Pas fait.' },
    envoyeeLe: '2095-12-10T10:00:00Z',
    valideeLe: '2095-12-12T10:00:00Z',
    note: 'D',
  });
  avant = Number((await q(`SELECT count(*)::int AS n FROM objectifs_fiches`)).rows[0].n);

  copyFileSync(join(DEPOT, MIGRATION), join(dossier, MIGRATION));
  // Une base en service : la fusion se déclare destructive, elle se consent.
  await runMigrations(url, { dossier, destructivesPermises: [MIGRATION] });
});

afterAll(async () => {
  await base?.end();
  if (dossier) rmSync(dossier, { recursive: true, force: true });
  await proprietaire(`DROP DATABASE IF EXISTS ${nomBase} WITH (FORCE)`);
});

describe('0111 : une fiche d’objectifs par année', () => {
  it('une fiche par agent et par année, les semestres d’avant gardés à part, tels quels', async () => {
    expect([...(await annuelles()).keys()]).toEqual([2020, 2021, 2095, 2096, 2097, 2098, 2099]);
    const { rows } = await q(
      `SELECT annee, semestre FROM objectifs_fiches_semestres ORDER BY annee, semestre`,
    );
    expect(rows).toHaveLength(avant);
    expect(rows).toContainEqual({ annee: 2099, semestre: 1 });
    expect(rows).toContainEqual({ annee: 2099, semestre: 2 });
    // Une seconde fiche pour la même année ne passe plus ; une nouvelle n'a pas de semestre.
    await expect(
      q(
        `INSERT INTO objectifs_fiches (id, tenant_id, employee_id, annee, semestre)
         VALUES ($1,$2,$3,2099,1)`,
        [randomUUID(), tenantId, agent.employee],
      ),
    ).rejects.toThrow(/objectifs_fiches_une_par_annee/);
    await q(
      `INSERT INTO objectifs_fiches (id, tenant_id, employee_id, annee) VALUES ($1,$2,$3,2094)`,
      [randomUUID(), tenantId, agent.employee],
    );
  });

  it('une année close garde l’évaluation faite : celle du 1er semestre, ou la note du 2nd', async () => {
    const fiches = await annuelles();
    // Le 2nd semestre n'avait jamais été envoyé : la note du 1er reste, ses
    // objectifs rejoignent la fiche.
    expect(fiches.get(2020)).toMatchObject({
      ids: ['a1', 'a2'],
      envoyee: '2020-06-25',
      validee: '2020-06-30',
      note: 'A',
      evaluateur: n1.employee,
    });
    expect(fiches.get(2021)).toMatchObject({
      ids: ['b1', 'b2'],
      envoyee: '2021-12-10',
      validee: '2021-12-18',
      note: 'C',
    });
  });

  it('l’année à venir se rouvre, sauf deux semestres évalués ou envoyés', async () => {
    const fiches = await annuelles();
    // Le 1er semestre évalué, le 2nd en cours : l'auto-évaluation de l'année
    // reste à faire, avec ce qui a déjà été dit ; la note du n+1 reste son
    // brouillon.
    expect(fiches.get(2099)).toMatchObject({
      // Par échéance, sans échéance à la fin ; une formation demandée deux
      // fois ne l'est plus qu'une ; les commentaires bout à bout.
      ids: ['d1', 'c1', 'c2', 'd2', 'f1', 'f3', 'p1', 'p2'],
      statuts: { c1: 'atteint', c2: 'partiel', d1: 'partiel' },
      agent: { c1: 'Fait.', c2: 'À moitié.', d1: 'En cours.' },
      n1: { c1: 'Bien.' },
      envoyee: null,
      validee: null,
      note: 'B',
      evaluateur: n1.employee,
      figees: null,
    });
    // Envoyés tous deux : la fiche de l'année attend le n+1 ; l'état des
    // formations reste figé, celui du 2nd semestre d'abord.
    expect(fiches.get(2098)).toMatchObject({
      ids: ['e1', 'e2'],
      envoyee: '2098-12-10',
      validee: null,
      figees: [{ courseId: coursY }, { courseId: coursX }],
    });
    expect(fiches.get(2097)).toMatchObject({ ids: ['g1', 'g2'], envoyee: null, validee: null });
    // Une fiche seule ne change pas ; un semestre vide ne compte pas.
    expect(fiches.get(2096)).toMatchObject({ ids: ['h1'], envoyee: '2096-12-10', validee: null });
    expect(fiches.get(2095)).toMatchObject({ ids: ['k1'], validee: '2095-12-12', note: 'D' });
  });

  it('les appels du n+1 suivent la fiche de l’année', async () => {
    const { rows } = await q(
      `SELECT dedupe_key, title, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS le
         FROM notifications WHERE recipient_user_id = $1 ORDER BY dedupe_key`,
      [n1.user],
    );
    // 2098 : deux appels n'en font qu'un, le plus ancien ; 2097, rouverte,
    // n'en a plus ; 2096 garde le sien.
    expect(rows).toEqual([
      {
        dedupe_key: `objectifs:${agent.employee}:2096:appel:n1`,
        title: 'Aminata Diallo a envoyé son auto-évaluation de l’année 2096',
        le: '2096-12-10',
      },
      {
        dedupe_key: `objectifs:${agent.employee}:2098:appel:n1`,
        title: 'Aminata Diallo a envoyé son auto-évaluation de l’année 2098',
        le: '2098-06-20',
      },
    ]);
  });

  it('la date d’évaluation : le 15 décembre, pour toutes les organisations', async () => {
    const { rows } = await q(
      `SELECT review_month, review_day FROM objective_review_schedule WHERE tenant_id = $1`,
      [tenantId],
    );
    expect(rows).toEqual([{ review_month: 12, review_day: 15 }]);
    // Les jours des semestres ne s'écrivent plus : ils peuvent manquer.
    await q(
      `UPDATE objective_review_schedule
          SET s1_month = NULL, s1_day = NULL, s2_month = NULL, s2_day = NULL,
              review_month = 11, review_day = 30
        WHERE tenant_id = $1`,
      [tenantId],
    );
  });
});
