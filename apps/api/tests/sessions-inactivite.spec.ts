/**
 * La session se ferme après trois jours sans activité, et ne dépasse jamais
 * trente jours. Un relevé automatique de la page ne compte pas comme une
 * activité : un onglet resté ouvert ne garde pas la session en vie.
 */
import { randomUUID } from 'node:crypto';
import type { ExecutionContext } from '@nestjs/common';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import { AuthService } from '../src/modules/auth/auth.service';
import { SessionGuard } from '../src/modules/auth/session.guard';

const env = loadEnv();
const tenantId = randomUUID();
const userId = randomUUID();
let ownerPool: Pool;
let db: TenantDb;
let auth: AuthService;

const raw = (q: string, p: unknown[] = []) => ownerPool.query(q, p as never[]);

/** Une session ouverte, puis vieillie : dernier geste il y a `heures`. */
async function session(heures = 0): Promise<{ token: string; id: string }> {
  const { token } = await auth.issueSession(userId, tenantId, {});
  const { rows } = await raw(
    `UPDATE sessions SET last_seen_at = now() - make_interval(hours => $2)
      WHERE user_id = $1 AND id = (SELECT id FROM sessions WHERE user_id = $1
                                    ORDER BY created_at DESC LIMIT 1)
      RETURNING id`,
    [userId, heures],
  );
  return { token, id: rows[0].id };
}
const dernierGeste = async (id: string) =>
  (await raw(`SELECT last_seen_at FROM sessions WHERE id = $1`, [id])).rows[0].last_seen_at as Date;

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 2 });
  db = new TenantDb();
  auth = new AuthService(db);
  await raw(
    `INSERT INTO users (id, email, password_hash, given_name, family_name)
     VALUES ($1, $2, 'x', 'Inactif', 'Test')`,
    [userId, `inactif-${userId}@test.local`],
  );
  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1, 'APIX Test', $2)`, [
    tenantId,
    `inactif-${tenantId.slice(0, 8)}`,
  ]);
  await raw(
    `INSERT INTO user_tenant_memberships (id, tenant_id, user_id, role)
     VALUES ($1, $2, $3, 'employee')`,
    [randomUUID(), tenantId, userId],
  );
});

afterAll(async () => {
  await raw(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
  await raw(`DELETE FROM user_tenant_memberships WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  await raw(`DELETE FROM users WHERE id = $1`, [userId]);
  await db?.pool.end();
  await ownerPool?.end();
});

describe('trois jours sans activité', () => {
  it('une session ouverte vaut trente jours au plus', async () => {
    const { id } = await session();
    const { rows } = await raw(
      `SELECT round(extract(epoch FROM expires_at - created_at) / 86400) AS jours
         FROM sessions WHERE id = $1`,
      [id],
    );
    expect(Number(rows[0].jours)).toBe(30);
  });

  it('un peu moins de trois jours : la session tient ; un peu plus : elle se ferme', async () => {
    expect(await auth.resolveSession((await session(71)).token)).not.toBeNull();
    expect(await auth.resolveSession((await session(73)).token)).toBeNull();
  });

  it('un geste prolonge la session ; un relevé automatique, non', async () => {
    const { token, id } = await session(48);
    const avant = await dernierGeste(id);
    await auth.resolveSession(token, { activite: false });
    expect(await dernierGeste(id)).toEqual(avant);
    await auth.resolveSession(token, { activite: true });
    expect((await dernierGeste(id)).getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it('même active, une session échue ne s’ouvre plus', async () => {
    const { token, id } = await session();
    await raw(`UPDATE sessions SET expires_at = now() - interval '1 second' WHERE id = $1`, [id]);
    expect(await auth.resolveSession(token, { activite: true })).toBeNull();
  });
});

describe('la porte des requêtes', () => {
  /** Une requête vue par la garde, avec ou sans l'en-tête des relevés. */
  const requete = (token: string, arrierePlan: boolean) => {
    const req = {
      cookies: { tg_session: token },
      headers: arrierePlan ? { 'x-arriere-plan': '1' } : {},
    };
    return {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
  };

  it('la cloche ne prolonge pas la session ; une page ouverte, si', async () => {
    const garde = new SessionGuard(auth);
    const { token, id } = await session(48);
    const avant = await dernierGeste(id);
    await garde.canActivate(requete(token, true));
    expect(await dernierGeste(id)).toEqual(avant);
    await garde.canActivate(requete(token, false));
    expect((await dernierGeste(id)).getTime()).toBeGreaterThan(Date.now() - 60_000);
  });
});
