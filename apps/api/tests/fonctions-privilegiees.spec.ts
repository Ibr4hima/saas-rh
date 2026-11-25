/**
 * Les fonctions SECURITY DEFINER tournent avec les droits de leur
 * propriétaire (ADR-0288) : chacune fige son search_path, pg_catalog en
 * tête et pg_temp en dernier, pour ne lire que les vraies tables. Une
 * fonction ajoutée ou réécrite sans ce réglage fait échouer ce test.
 */
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';

const env = loadEnv();
let pool: Pool;

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  pool = new Pool({ connectionString: env.DATABASE_URL, max: 1 });
});

afterAll(async () => {
  await pool?.end();
});

describe('les fonctions privilégiées', () => {
  it('figent leur search_path, le schéma temporaire en dernier', async () => {
    const { rows } = await pool.query<{ fonction: string; reglages: string[] | null }>(
      `SELECT p.oid::regprocedure::text AS fonction, p.proconfig AS reglages
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.prosecdef AND n.nspname = 'public'
        ORDER BY 1`,
    );
    expect(rows.length).toBeGreaterThan(0);
    const malReglees = rows
      .filter((r) => !(r.reglages ?? []).includes('search_path=pg_catalog, public, pg_temp'))
      .map((r) => r.fonction);
    expect(malReglees).toEqual([]);
  });
});
