/**
 * Règles de cohérence de l'organigramme (migration 0012).
 *
 * Chacune correspond à une incohérence qui était possible et s'est vérifiée en
 * pratique : un employé responsable de trois unités, une direction rangée sous
 * un service, un chef parti ailleurs qui dirige toujours son ancienne équipe.
 * Ces règles se tiennent à trois étages — index uniques SQL, validation
 * applicative, formulaire — et c'est le SQL qui a le dernier mot : on le teste.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';

const env = loadEnv();

const tenantId = randomUUID();
const userId = randomUUID();
const personId = randomUUID();
const employeeId = randomUUID();
/** Second employé : sert au cas « l'unité dissoute libère son responsable ». */
const person2Id = randomUUID();
const employee2Id = randomUUID();
const directionId = randomUUID();

let ownerPool: Pool;
let appPool: Pool;

async function withTenant<T>(fn: (db: NodePgDatabase) => Promise<T>): Promise<T> {
  const client = await appPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)`,
      [tenantId, userId],
    );
    const result = await fn(drizzle(client));
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Tente l'insertion et rend le code SQLSTATE, ou null si elle passe. */
async function tenter(query: ReturnType<typeof sql>): Promise<string | null> {
  try {
    await withTenant(async (db) => db.execute(query));
    return null;
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } };
    return e?.code ?? e?.cause?.code ?? 'inconnu';
  }
}

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 2 });
  appPool = new Pool({ connectionString: env.APP_DATABASE_URL, max: 5 });

  await withTenant(async (db) => {
    await db.execute(
      sql`INSERT INTO users (id, email, password_hash, given_name, family_name)
          VALUES (${userId}, ${`org-${userId}@test.local`}, 'x', 'Test', 'Org')`,
    );
    await db.execute(
      sql`INSERT INTO tenants (id, name, slug)
          VALUES (${tenantId}, 'Org', ${`org-${tenantId.slice(0, 8)}`})`,
    );
    await db.execute(
      sql`INSERT INTO persons (id, tenant_id, given_name, family_name)
          VALUES (${personId}, ${tenantId}, 'Chef', 'Unique')`,
    );
    await db.execute(
      sql`INSERT INTO employees (id, tenant_id, person_id, employee_number, hired_on)
          VALUES (${employeeId}, ${tenantId}, ${personId}, 'ORG-1', '2026-01-01')`,
    );
    await db.execute(
      sql`INSERT INTO persons (id, tenant_id, given_name, family_name)
          VALUES (${person2Id}, ${tenantId}, 'Chef', 'Second')`,
    );
    await db.execute(
      sql`INSERT INTO employees (id, tenant_id, person_id, employee_number, hired_on)
          VALUES (${employee2Id}, ${tenantId}, ${person2Id}, 'ORG-2', '2026-01-01')`,
    );
    await db.execute(
      sql`INSERT INTO org_units (id, tenant_id, unit_type, name, short_name, manager_employee_id)
          VALUES (${directionId}, ${tenantId}, 'direction', 'Direction Test', 'DTS', ${employeeId})`,
    );
  });
});

afterAll(async () => {
  await ownerPool?.query(`DELETE FROM org_units WHERE tenant_id = $1`, [tenantId]);
  await ownerPool?.query(`DELETE FROM employees WHERE tenant_id = $1`, [tenantId]);
  await ownerPool?.query(`DELETE FROM persons WHERE tenant_id = $1`, [tenantId]);
  await ownerPool?.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  await ownerPool?.query(`DELETE FROM users WHERE id = $1`, [userId]);
  await appPool?.end();
  await ownerPool?.end();
});

describe('un employé ne dirige qu’une unité', () => {
  it('refuse un second poste de responsable pour la même personne', async () => {
    const code = await tenter(
      sql`INSERT INTO org_units (id, tenant_id, unit_type, name, manager_employee_id)
          VALUES (${randomUUID()}, ${tenantId}, 'direction', 'Autre Direction', ${employeeId})`,
    );
    expect(code).toBe('23505');
  });

  it('libère la place quand l’unité est dissoute (effacement doux)', async () => {
    const dissoute = randomUUID();
    const autre = employee2Id;
    await withTenant(async (db) => {
      await db.execute(
        sql`INSERT INTO org_units (id, tenant_id, unit_type, name, manager_employee_id, deleted_at)
            VALUES (${dissoute}, ${tenantId}, 'direction', 'Dissoute', ${autre}, now())`,
      );
    });
    // L'unité dissoute ne compte plus : le même responsable redevient libre.
    const code = await tenter(
      sql`INSERT INTO org_units (id, tenant_id, unit_type, name, manager_employee_id)
          VALUES (${randomUUID()}, ${tenantId}, 'direction', 'Reprise', ${autre})`,
    );
    expect(code).toBeNull();
  });
});

describe('abrégé', () => {
  it('refuse un abrégé sur autre chose qu’une direction', async () => {
    const code = await tenter(
      sql`INSERT INTO org_units (id, tenant_id, unit_type, name, parent_id, short_name)
          VALUES (${randomUUID()}, ${tenantId}, 'department', 'Dépt', ${directionId}, 'DPT')`,
    );
    expect(code).toBe('23514'); // violation de CHECK
  });

  it('refuse deux directions au même abrégé, quelle que soit la casse', async () => {
    const code = await tenter(
      sql`INSERT INTO org_units (id, tenant_id, unit_type, name, short_name)
          VALUES (${randomUUID()}, ${tenantId}, 'direction', 'Direction Bis', 'dts')`,
    );
    expect(code).toBe('23505');
  });
});

describe('noms', () => {
  it('refuse deux unités sœurs homonymes', async () => {
    const code = await tenter(
      sql`INSERT INTO org_units (id, tenant_id, unit_type, name)
          VALUES (${randomUUID()}, ${tenantId}, 'direction', 'direction test')`,
    );
    expect(code).toBe('23505');
  });

  it('accepte le même nom sous des parents différents', async () => {
    const autreDirection = randomUUID();
    await withTenant(async (db) => {
      await db.execute(
        sql`INSERT INTO org_units (id, tenant_id, unit_type, name)
            VALUES (${autreDirection}, ${tenantId}, 'direction', 'Direction Voisine')`,
      );
      await db.execute(
        sql`INSERT INTO org_units (id, tenant_id, unit_type, name, parent_id)
            VALUES (${randomUUID()}, ${tenantId}, 'service', 'Service Courrier', ${directionId})`,
      );
    });
    const code = await tenter(
      sql`INSERT INTO org_units (id, tenant_id, unit_type, name, parent_id)
          VALUES (${randomUUID()}, ${tenantId}, 'service', 'Service Courrier', ${autreDirection})`,
    );
    expect(code).toBeNull();
  });
});
