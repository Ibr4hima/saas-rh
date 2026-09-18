/**
 * Textes de référence : ce que le SQL ne tient pas.
 *
 * Deux règles y sont applicatives, et toutes deux se cassent en silence. Le
 * BROUILLON : tant qu'un texte n'est pas publié, il n'existe que pour qui le
 * rédige — un règlement à moitié écrit ne doit pas passer pour le règlement en
 * vigueur. L'ENREGISTREMENT : le texte part en entier à chaque envoi, et les
 * articles se rapprochent par leur numéro pour que « Article 47 » garde son
 * identifiant d'une version à l'autre.
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SaveReferenceTextInput, SessionUser } from '@teranga/contracts';
import { ProblemException } from '../src/common/problem';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import { ReferenceTextsService } from '../src/modules/reference/reference-texts.service';

const env = loadEnv();
const tenantId = randomUUID();
const userId = randomUUID();
const rh = { userId, tenantId, role: 'hr' } as SessionUser;
const employe = { userId, tenantId, role: 'employee' } as SessionUser;

let ownerPool: Pool;
let db: TenantDb;
let service: ReferenceTextsService;

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

const texte = (published: boolean): SaveReferenceTextInput => ({
  title: 'Règlement intérieur',
  reference: 'Adopté le 1er mars 2024',
  effectiveOn: '2024-03-01',
  published,
  chapters: [
    {
      number: 1,
      title: 'Dispositions générales',
      body: null,
      sections: [{ number: 1, title: 'Champ d’application', body: null }],
      articles: [
        { number: 1, sectionNumber: 1, title: 'Objet', body: 'Le présent règlement fixe…' },
        { number: 2, sectionNumber: 1, title: 'Portée', body: 'Il s’impose à chacun.' },
      ],
    },
  ],
});

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 3 });
  db = new TenantDb();
  service = new ReferenceTextsService(db);
  await raw(
    `INSERT INTO users (id, email, password_hash, given_name, family_name)
     VALUES ($1,$2,'x','Test','RH')`,
    [userId, `reftexts-${userId}@test.local`],
  );
  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1,'RefTexts',$2)`, [
    tenantId,
    `reftexts-${tenantId.slice(0, 8)}`,
  ]);
});

beforeEach(async () => {
  await raw(`DELETE FROM reference_texts WHERE tenant_id = $1`, [tenantId]);
});

afterAll(async () => {
  await raw(`DELETE FROM reference_texts WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  await raw(`DELETE FROM users WHERE id = $1`, [userId]);
  await db?.pool.end();
  await ownerPool?.end();
});

describe('brouillon', () => {
  it('reste invisible à l’employé tant qu’il n’est pas publié', async () => {
    await service.save(rh, 'reglement-interieur', texte(false));
    expect(await codeOf(() => service.get(employe, 'reglement-interieur'))).toBe(
      'reference.not_found',
    );
    expect(await service.list(employe)).toHaveLength(0);
    // Celle qui le rédige, elle, le voit.
    expect((await service.get(rh, 'reglement-interieur')).published).toBe(false);
  });

  it('s’ouvre à tous une fois publié', async () => {
    await service.save(rh, 'reglement-interieur', texte(true));
    const vu = await service.get(employe, 'reglement-interieur');
    expect(vu.published).toBe(true);
    expect(vu.chapters).toHaveLength(1);
    expect(await service.list(employe)).toHaveLength(1);
  });
});

describe('enregistrement', () => {
  it('refuse un employé qui voudrait déposer', async () => {
    expect(await codeOf(() => service.save(employe, 'reglement-interieur', texte(true)))).toBe(
      'reference.forbidden',
    );
  });

  it('numérote à la française : « premier », puis les chiffres', async () => {
    await service.save(rh, 'reglement-interieur', texte(true));
    const vu = await service.get(rh, 'reglement-interieur');
    expect(vu.chapters[0]!.numero).toBe('Chapitre premier');
    expect(vu.chapters[0]!.sections[0]!.numero).toBe('Section I');
    expect(vu.chapters[0]!.articles.map((a) => a.numero)).toEqual(['premier', '2']);
  });

  it('garde l’identifiant d’un article que la nouvelle version conserve', async () => {
    await service.save(rh, 'reglement-interieur', texte(true));
    const avant = await service.get(rh, 'reglement-interieur');
    const idArticle1 = avant.chapters[0]!.articles[0]!.id;

    // Version suivante : l'article 1 est réécrit, l'article 2 disparaît, un
    // article 3 arrive.
    const suivante = texte(true);
    suivante.chapters[0]!.articles = [
      { number: 1, sectionNumber: 1, title: 'Objet', body: 'Texte révisé.' },
      { number: 3, sectionNumber: 1, title: 'Entrée en vigueur', body: 'À compter de ce jour.' },
    ];
    await service.save(rh, 'reglement-interieur', suivante);

    const apres = await service.get(rh, 'reglement-interieur');
    const articles = apres.chapters[0]!.articles;
    expect(articles.map((a) => a.numero)).toEqual(['premier', '3']);
    // Le lien posé vers l'article premier continue de tomber juste.
    expect(articles[0]!.id).toBe(idArticle1);
    expect(articles[0]!.body).toBe('Texte révisé.');
  });

  it('trouve un article par un mot de son corps', async () => {
    await service.save(rh, 'reglement-interieur', texte(true));
    const hits = await service.search(rh, 'reglement-interieur', 'impose');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.numero).toBe('2');
    // Le surlignage voyage en marques convenues, jamais en balises.
    expect(hits[0]!.extract).toContain('[[');
    expect(hits[0]!.extract).not.toContain('<');
  });
});
