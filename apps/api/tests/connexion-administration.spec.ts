/**
 * La page de connexion de l'administration (ADR-0210) : l'adresse et le mot
 * de passe, comme la connexion par mot de passe des agents.
 *
 * Ce qui compte : seul un compte d'administration y ouvre sa session ; un
 * compte d'agent y est refusé, et entre toujours par les pages des agents ;
 * un mauvais mot de passe reste un mauvais mot de passe, sans rien dire du
 * rôle.
 */
import { randomUUID } from 'node:crypto';
import { hash as argonHash } from '@node-rs/argon2';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProblemException } from '../src/common/problem';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import { AuthService } from '../src/modules/auth/auth.service';

const env = loadEnv();
const tenantId = randomUUID();
const domaine = `admin-${tenantId.slice(0, 8)}.test.local`;
const MOT_DE_PASSE = 'MotDePasseDeTest1!';

let ownerPool: Pool;
let db: TenantDb;
let auth: AuthService;

async function raw(q: string, params: unknown[] = []) {
  return ownerPool.query(q, params as never[]);
}

/** Un compte de l'organisation, avec son mot de passe et son rôle. */
async function creerCompte(prenom: string, role: 'admin' | 'employee'): Promise<string> {
  const userId = randomUUID();
  const email = `${prenom.toLowerCase()}@${domaine}`;
  await raw(
    `INSERT INTO users (id, email, password_hash, given_name, family_name) VALUES ($1,$2,$3,$4,'Test')`,
    [userId, email, await argonHash(MOT_DE_PASSE), prenom],
  );
  await raw(
    `INSERT INTO user_tenant_memberships (id, tenant_id, user_id, role) VALUES ($1,$2,$3,$4)`,
    [randomUUID(), tenantId, userId, role],
  );
  return email;
}

async function refus(p: Promise<unknown>): Promise<{ status: number; code: string }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ProblemException) return { status: e.problem.status, code: e.problem.code };
    throw e;
  }
  throw new Error('Aucun refus');
}

async function vider() {
  const { rows } = await raw(`SELECT id FROM users WHERE email LIKE $1`, [`%@${domaine}`]);
  const ids = rows.map((r: { id: string }) => r.id);
  await raw(`DELETE FROM audit_log WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM user_tenant_memberships WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM sessions WHERE user_id = ANY($1::uuid[])`, [ids]);
  await raw(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [ids]);
}

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 3 });
  db = new TenantDb();
  auth = new AuthService(db);
  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1,'APIX Test',$2)`, [
    tenantId,
    `admin-${tenantId.slice(0, 8)}`,
  ]);
});

afterAll(async () => {
  await vider();
  await raw(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  await db?.pool.end();
  await ownerPool?.end();
});

describe('la connexion de l’administration', () => {
  it('ouvre la session d’un compte d’administration', async () => {
    const email = await creerCompte('Admin', 'admin');
    const { token, user } = await auth.login(
      { email, password: MOT_DE_PASSE, administration: true },
      {},
    );
    expect(token).toBeTruthy();
    expect(user.role).toBe('admin');
  });

  it('refuse un compte d’agent, qui entre toujours par ses pages', async () => {
    const email = await creerCompte('Agent', 'employee');
    expect(
      await refus(auth.login({ email, password: MOT_DE_PASSE, administration: true }, {})),
    ).toEqual({ status: 403, code: 'auth.reserve_a_l_administration' });
    const { user } = await auth.login({ email, password: MOT_DE_PASSE }, {});
    expect(user.role).toBe('employee');
  });

  it('un mauvais mot de passe ne dit rien du rôle du compte', async () => {
    const agent = await creerCompte('Autre', 'employee');
    const admin = await creerCompte('Second', 'admin');
    for (const email of [agent, admin]) {
      expect(
        await refus(auth.login({ email, password: 'pas-le-bon', administration: true }, {})),
      ).toEqual({ status: 401, code: 'auth.invalid_credentials' });
    }
  });
});
