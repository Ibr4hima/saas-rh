/**
 * L'inscription publique crée une organisation : fermée, sauf sur une base
 * vide (l'installation) ou si le serveur l'ouvre. Sans quoi n'importe qui
 * ouvrait une « APIX S.A » et publiait des offres sur le vrai domaine.
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProblemException } from '../src/common/problem';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import { AuthService } from '../src/modules/auth/auth.service';

const env = loadEnv();
const dejaLa = randomUUID();
let ownerPool: Pool;
let db: TenantDb;
let auth: AuthService;
const ouverteAvant = env.INSCRIPTION_OUVERTE;

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 2 });
  db = new TenantDb();
  auth = new AuthService(db);
  // Un compte existe : la base n'est plus vide.
  await ownerPool.query(
    `INSERT INTO users (id, email, password_hash, given_name, family_name)
     VALUES ($1, $2, 'x', 'Déjà', 'Là')`,
    [dejaLa, `inscription-${dejaLa}@test.local`],
  );
});

afterAll(async () => {
  env.INSCRIPTION_OUVERTE = ouverteAvant;
  await ownerPool?.query(`DELETE FROM users WHERE id = $1`, [dejaLa]);
  await db?.pool.end();
  await ownerPool?.end();
});

describe('l’inscription publique', () => {
  it('est fermée dès qu’un compte existe', async () => {
    env.INSCRIPTION_OUVERTE = false;
    expect(await auth.inscriptionOuverte()).toBe(false);
    const email = `pirate-${randomUUID()}@exemple.sn`;
    const refus = await auth
      .register(
        {
          organizationName: 'APIX S.A',
          givenName: 'Faux',
          familyName: 'Recruteur',
          email,
          password: 'MotDePasseSolide123!',
        },
        {},
      )
      .catch((e: unknown) => e);
    expect((refus as ProblemException).problem.code).toBe('auth.inscription_fermee');
    const { rows } = await ownerPool.query(`SELECT 1 FROM users WHERE email = $1`, [email]);
    expect(rows).toHaveLength(0);
  });

  it('s’ouvre quand le serveur le permet', async () => {
    env.INSCRIPTION_OUVERTE = true;
    expect(await auth.inscriptionOuverte()).toBe(true);
  });
});
