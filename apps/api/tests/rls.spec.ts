/**
 * LE gate de la Phase 0 (ADR-0002, revue A15) : étanchéité inter-tenant testée
 * contre un Postgres réel, avec le rôle applicatif non-owner et un pool de
 * connexions partagé — les conditions exactes de la production.
 */
import { randomUUID } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';

const env = loadEnv();

let ownerPool: Pool;
let appPool: Pool;

interface TenantFixture {
  tenantId: string;
  userId: string;
  personId: string;
  employeeId: string;
}

const A: TenantFixture = {
  tenantId: randomUUID(),
  userId: randomUUID(),
  personId: randomUUID(),
  employeeId: randomUUID(),
};
const B: TenantFixture = {
  tenantId: randomUUID(),
  userId: randomUUID(),
  personId: randomUUID(),
  employeeId: randomUUID(),
};

/** Reproduit le helper de production : SET LOCAL dans une transaction. */
async function withTenant<T>(
  tenantId: string,
  userId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await appPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)`,
      [tenantId, userId],
    );
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function seedTenant(f: TenantFixture, name: string): Promise<void> {
  await withTenant(f.tenantId, f.userId, async (c) => {
    await c.query(
      `INSERT INTO users (id, email, password_hash, given_name, family_name)
       VALUES ($1, $2, 'x', 'Test', $3)`,
      [f.userId, `${name}-${f.userId}@test.local`, name],
    );
    await c.query(`INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3)`, [
      f.tenantId,
      name,
      `${name}-${f.tenantId.slice(0, 8)}`,
    ]);
    await c.query(
      `INSERT INTO persons (id, tenant_id, given_name, family_name)
       VALUES ($1, $2, 'Personne', $3)`,
      [f.personId, f.tenantId, name],
    );
    await c.query(
      `INSERT INTO employees (id, tenant_id, person_id, employee_number, hired_on)
       VALUES ($1, $2, $3, $4, '2026-01-01')`,
      [f.employeeId, f.tenantId, f.personId, `EMP-${name}`],
    );
  });
}

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 2 });
  // Base propre : le test est le seul écrivain de cette base de test/CI.
  await ownerPool.query(
    `TRUNCATE audit_log, contracts, assignments, employees, persons, org_units,
              user_tenant_memberships, sessions, tenants, users CASCADE`,
  );
  appPool = new Pool({ connectionString: env.APP_DATABASE_URL, max: 5 });
  await seedTenant(A, 'alpha');
  await seedTenant(B, 'bravo');
});

afterAll(async () => {
  await appPool?.end();
  await ownerPool?.end();
});

describe('préconditions', () => {
  it('le runtime se connecte avec un rôle non-owner (sinon la RLS est bypassée)', async () => {
    const { rows } = await appPool.query(`SELECT current_user`);
    expect(rows[0].current_user).toBe('app_user');
    const owner = await ownerPool.query(
      `SELECT tableowner FROM pg_tables WHERE tablename = 'persons'`,
    );
    expect(owner.rows[0].tableowner).not.toBe('app_user');
  });

  it('la RLS est active ET forcée sur toutes les tables tenantées', async () => {
    const { rows } = await ownerPool.query(`
      SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname IN ('tenants', 'user_tenant_memberships', 'org_units', 'contracts',
                          'persons', 'employees', 'assignments', 'audit_log')
        AND NOT (c.relrowsecurity AND c.relforcerowsecurity)
    `);
    expect(rows).toEqual([]);
  });
});

describe('étanchéité inter-tenant', () => {
  it('un tenant ne voit que ses propres lignes', async () => {
    const rows = await withTenant(A.tenantId, A.userId, async (c) => {
      const r = await c.query(`SELECT id, tenant_id FROM persons`);
      return r.rows;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].tenant_id).toBe(A.tenantId);
  });

  it('sans contexte tenant : zéro ligne, pas une erreur', async () => {
    const r = await appPool.query(`SELECT count(*)::int AS n FROM persons`);
    expect(r.rows[0].n).toBe(0);
  });

  it('le contexte ne fuit pas entre les requêtes du pool (SET LOCAL transactionnel)', async () => {
    await withTenant(A.tenantId, A.userId, async (c) => {
      const r = await c.query(`SELECT app_tenant_id() AS t`);
      expect(r.rows[0].t).toBe(A.tenantId);
    });
    // Après la transaction, aucune connexion du pool ne doit porter le contexte.
    for (let i = 0; i < 5; i += 1) {
      const r = await appPool.query(
        `SELECT app_tenant_id() AS t, count(*)::int AS n FROM persons GROUP BY 1`,
      );
      expect(r.rows).toEqual([]);
    }
  });

  it("un UPDATE ciblant une ligne d'un autre tenant ne touche rien", async () => {
    const updated = await withTenant(A.tenantId, A.userId, async (c) => {
      const r = await c.query(`UPDATE persons SET family_name = 'pirate' WHERE id = $1`, [
        B.personId,
      ]);
      return r.rowCount;
    });
    expect(updated).toBe(0);
    const check = await withTenant(B.tenantId, B.userId, (c) =>
      c.query(`SELECT family_name FROM persons WHERE id = $1`, [B.personId]),
    );
    expect(check.rows[0].family_name).toBe('bravo');
  });

  it("un INSERT portant le tenant_id d'un autre tenant est rejeté (WITH CHECK)", async () => {
    await expect(
      withTenant(A.tenantId, A.userId, (c) =>
        c.query(
          `INSERT INTO persons (id, tenant_id, given_name, family_name)
           VALUES ($1, $2, 'Intrus', 'Intrus')`,
          [randomUUID(), B.tenantId],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});

describe('effective dating (ADR-0003)', () => {
  it('deux affectations qui se chevauchent pour un même employé sont rejetées', async () => {
    await withTenant(A.tenantId, A.userId, (c) =>
      c.query(
        `INSERT INTO assignments (id, tenant_id, employee_id, position_title, validity)
         VALUES ($1, $2, $3, 'Analyste', daterange('2026-01-01', '2026-07-01'))`,
        [randomUUID(), A.tenantId, A.employeeId],
      ),
    );
    await expect(
      withTenant(A.tenantId, A.userId, (c) =>
        c.query(
          `INSERT INTO assignments (id, tenant_id, employee_id, position_title, validity)
           VALUES ($1, $2, $3, 'Chef de service', daterange('2026-06-01', NULL))`,
          [randomUUID(), A.tenantId, A.employeeId],
        ),
      ),
    ).rejects.toThrow(/assignments_no_overlap/);
  });

  it('des affectations contiguës (fin exclusive = début suivant) sont acceptées', async () => {
    await withTenant(A.tenantId, A.userId, (c) =>
      c.query(
        `INSERT INTO assignments (id, tenant_id, employee_id, position_title, validity)
         VALUES ($1, $2, $3, 'Chef de service', daterange('2026-07-01', NULL))`,
        [randomUUID(), A.tenantId, A.employeeId],
      ),
    );
    const r = await withTenant(A.tenantId, A.userId, (c) =>
      c.query(
        `SELECT position_title FROM assignments
         WHERE employee_id = $1 AND validity @> current_date + 400`,
        [A.employeeId],
      ),
    );
    expect(r.rows).toHaveLength(1);
  });
});

describe('audit append-only (ADR-0008)', () => {
  it('chaque écriture métier produit une ligne d’audit portée par le bon tenant', async () => {
    const r = await withTenant(A.tenantId, A.userId, (c) =>
      c.query(
        `SELECT count(*)::int AS n FROM audit_log
         WHERE table_name = 'persons' AND action = 'INSERT' AND tenant_id = $1`,
        [A.tenantId],
      ),
    );
    expect(r.rows[0].n).toBeGreaterThanOrEqual(1);
  });

  it("l'audit d'un autre tenant est invisible", async () => {
    const r = await withTenant(A.tenantId, A.userId, (c) =>
      c.query(`SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = $1`, [B.tenantId]),
    );
    expect(r.rows[0].n).toBe(0);
  });

  it("le rôle applicatif ne peut ni modifier ni supprimer l'audit", async () => {
    await expect(
      withTenant(A.tenantId, A.userId, (c) => c.query(`UPDATE audit_log SET action = 'INSERT'`)),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      withTenant(A.tenantId, A.userId, (c) => c.query(`DELETE FROM audit_log`)),
    ).rejects.toThrow(/permission denied/i);
  });
});
