/**
 * Manager d'un employé (migration 0013).
 *
 * À ne pas confondre avec le responsable d'unité : celui-ci désigne qui dirige
 * une unité, celui-là à qui un agent rend compte. Une boucle hiérarchique
 * (A → B → A) ferait tourner sans fin toute remontée de chaîne, d'où la
 * vérification récursive côté applicatif — le CHECK SQL ne couvre que le cas
 * « soi-même ».
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '@teranga/contracts';
import { EncryptionService } from '../src/common/encryption.service';
import { ProblemException } from '../src/common/problem';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import { PeopleService } from '../src/modules/people/people.service';

const env = loadEnv();

const tenantId = randomUUID();
const userId = randomUUID();
const user = { userId, tenantId, role: 'admin' } as SessionUser;

let ownerPool: Pool;
let db: TenantDb;
let people: PeopleService;
let alice: string;
let bruno: string;
let carla: string;

async function raw(q: string, params: unknown[] = []) {
  return ownerPool.query(q, params as never[]);
}

async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'AUCUNE ERREUR';
  } catch (err) {
    if (err instanceof ProblemException) return err.problem.code;
    return `NON-PROBLEM: ${(err as Error).message}`;
  }
}

async function creerEmploye(numero: string): Promise<string> {
  const personId = randomUUID();
  const employeeId = randomUUID();
  await raw(
    `INSERT INTO persons (id, tenant_id, given_name, family_name) VALUES ($1,$2,$3,'Test')`,
    [personId, tenantId, numero],
  );
  await raw(
    `INSERT INTO employees (id, tenant_id, person_id, employee_number, hired_on)
     VALUES ($1,$2,$3,$4,'2024-01-01')`,
    [employeeId, tenantId, personId, numero],
  );
  return employeeId;
}

const setManager = (id: string, managerEmployeeId: string | null) =>
  people.update(user, id, { employee: { managerEmployeeId } });

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 3 });
  db = new TenantDb();
  people = new PeopleService(db, new EncryptionService());
  await raw(
    `INSERT INTO users (id, email, password_hash, given_name, family_name)
     VALUES ($1,$2,'x','Test','Admin')`,
    [userId, `mgr-${userId}@test.local`],
  );
  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1,'Mgr',$2)`, [
    tenantId,
    `mgr-${tenantId.slice(0, 8)}`,
  ]);
});

beforeEach(async () => {
  await raw(`UPDATE employees SET manager_employee_id = NULL WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM employees WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM persons WHERE tenant_id = $1`, [tenantId]);
  alice = await creerEmploye('ALICE');
  bruno = await creerEmploye('BRUNO');
  carla = await creerEmploye('CARLA');
});

afterAll(async () => {
  await raw(`UPDATE employees SET manager_employee_id = NULL WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM employees WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM persons WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  await raw(`DELETE FROM users WHERE id = $1`, [userId]);
  await db?.pool.end();
  await ownerPool?.end();
});

describe('désignation', () => {
  it('rattache un employé à son manager', async () => {
    await setManager(bruno, alice);
    const detail = await people.detail(user, bruno);
    expect(detail.managerId).toBe(alice);
    expect(detail.managerName).toBe('ALICE Test');
  });

  it('accepte l’absence de manager — un directeur général n’en a pas', async () => {
    await setManager(bruno, alice);
    await setManager(bruno, null);
    expect((await people.detail(user, bruno)).managerId).toBeNull();
  });

  it('refuse un employé au dossier clos', async () => {
    await raw(`UPDATE employees SET status = 'terminated' WHERE id = $1`, [alice]);
    expect(await codeOf(() => setManager(bruno, alice))).toBe('people.manager_not_active');
  });

  it('refuse un manager inexistant', async () => {
    expect(await codeOf(() => setManager(bruno, randomUUID()))).toBe('people.manager_not_found');
  });
});

describe('boucles hiérarchiques', () => {
  it('refuse d’être son propre manager', async () => {
    expect(await codeOf(() => setManager(bruno, bruno))).toBe('people.manager_is_self');
  });

  it('refuse une boucle directe A → B → A', async () => {
    await setManager(bruno, alice);
    expect(await codeOf(() => setManager(alice, bruno))).toBe('people.manager_cycle');
  });

  it('refuse une boucle indirecte A → B → C → A', async () => {
    await setManager(bruno, alice);
    await setManager(carla, bruno);
    expect(await codeOf(() => setManager(alice, carla))).toBe('people.manager_cycle');
  });

  it('accepte une chaîne hiérarchique profonde', async () => {
    await setManager(bruno, alice);
    await setManager(carla, bruno);
    expect((await people.detail(user, carla)).managerId).toBe(bruno);
  });

  it('accepte deux subordonnés pour le même manager', async () => {
    await setManager(bruno, alice);
    await setManager(carla, alice);
    expect((await people.detail(user, carla)).managerId).toBe(alice);
  });
});

describe('liste des employés', () => {
  it('remonte le nom du manager', async () => {
    await setManager(bruno, alice);
    const page = await people.list(user, { limit: 25 });
    const ligne = page.items.find((i) => i.employeeNumber === 'BRUNO')!;
    expect(ligne.managerName).toBe('ALICE Test');
    expect(ligne.managerId).toBe(alice);
  });

  it('laisse le manager vide quand il n’y en a pas', async () => {
    const page = await people.list(user, { limit: 25 });
    expect(page.items.find((i) => i.employeeNumber === 'ALICE')!.managerName).toBeNull();
  });
});
