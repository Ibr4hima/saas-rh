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
import type { ListEmployeesQuery, SessionUser } from '@teranga/contracts';
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
  await raw(`DELETE FROM assignments WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM contracts WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM employees WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM persons WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM org_units WHERE tenant_id = $1`, [tenantId]);
  alice = await creerEmploye('ALICE');
  bruno = await creerEmploye('BRUNO');
  carla = await creerEmploye('CARLA');
});

afterAll(async () => {
  await raw(`UPDATE employees SET manager_employee_id = NULL WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM assignments WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM contracts WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM employees WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM persons WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM org_units WHERE tenant_id = $1`, [tenantId]);
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

  it('refuse un employé au dossier archivé', async () => {
    await raw(`UPDATE employees SET status = 'archived' WHERE id = $1`, [alice]);
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
    const page = await people.list(user, { limit: 25, sort: 'recent', dir: 'desc', offset: 0 });
    const ligne = page.items.find((i) => i.employeeNumber === 'BRUNO')!;
    expect(ligne.managerName).toBe('ALICE Test');
    expect(ligne.managerId).toBe(alice);
  });

  it('laisse le manager vide quand il n’y en a pas', async () => {
    const page = await people.list(user, { limit: 25, sort: 'recent', dir: 'desc', offset: 0 });
    expect(page.items.find((i) => i.employeeNumber === 'ALICE')!.managerName).toBeNull();
  });
});

describe('tri, filtres et effectifs', () => {
  const lister = (q: Partial<ListEmployeesQuery> = {}) =>
    people.list(user, { limit: 25, sort: 'recent', dir: 'desc', offset: 0, ...q });

  /** Affecte l'agent à une unité, avec un intitulé de poste. */
  async function affecter(employeeId: string, poste: string, uniteId: string | null) {
    await raw(
      `INSERT INTO assignments (id, tenant_id, employee_id, org_unit_id, position_title, validity)
       VALUES ($1,$2,$3,$4,$5,'[2024-01-01,)')`,
      [randomUUID(), tenantId, employeeId, uniteId, poste],
    );
  }

  it('trie par nom, dans les deux sens', async () => {
    const asc = await lister({ sort: 'name', dir: 'asc' });
    expect(asc.items.map((i) => i.employeeNumber)).toEqual(['ALICE', 'BRUNO', 'CARLA']);
    const desc = await lister({ sort: 'name', dir: 'desc' });
    expect(desc.items.map((i) => i.employeeNumber)).toEqual(['CARLA', 'BRUNO', 'ALICE']);
  });

  it('trie par date de contrat, et renvoie les dossiers sans date en dernier', async () => {
    await raw(
      `INSERT INTO contracts (id, tenant_id, employee_id, contract_type, start_date, end_date)
       VALUES ($1,$2,$3,'cdd','2025-06-01','2026-06-01')`,
      [randomUUID(), tenantId, bruno],
    );
    await raw(
      `INSERT INTO contracts (id, tenant_id, employee_id, contract_type, start_date, end_date)
       VALUES ($1,$2,$3,'cdi','2024-02-01',NULL)`,
      [randomUUID(), tenantId, alice],
    );

    const asc = await lister({ sort: 'contractStart', dir: 'asc' });
    expect(asc.items.map((i) => i.employeeNumber)).toEqual(['ALICE', 'BRUNO', 'CARLA']);

    // Une fin de contrat absente n'est pas « la plus ancienne » : elle n'existe
    // pas, et sa place est en bas quel que soit le sens du tri.
    for (const dir of ['asc', 'desc'] as const) {
      const page = await lister({ sort: 'contractEnd', dir });
      expect(page.items.at(-1)!.employeeNumber).not.toBe('BRUNO');
      expect(page.items.at(-1)!.contractEndDate).toBeNull();
    }
  });

  it('filtre par poste, par manager et par unité', async () => {
    const uniteId = randomUUID();
    await raw(
      `INSERT INTO org_units (id, tenant_id, name, unit_type, short_name)
       VALUES ($1,$2,'Direction Financière','direction','DFC')`,
      [uniteId, tenantId],
    );
    await affecter(alice, 'Comptable', uniteId);
    await affecter(bruno, 'Comptable', null);
    await affecter(carla, 'Analyste', uniteId);
    await setManager(bruno, alice);

    expect((await lister({ positionTitle: 'Comptable' })).items).toHaveLength(2);
    expect((await lister({ managerId: alice })).items.map((i) => i.employeeNumber)).toEqual([
      'BRUNO',
    ]);
    // L'unité se filtre sur ce que la colonne AFFICHE — l'abrégé de la direction.
    expect((await lister({ unit: 'DFC' })).items.map((i) => i.employeeNumber).sort()).toEqual([
      'ALICE',
      'CARLA',
    ]);
  });

  it('propose en filtre exactement ce que l’onglet contient', async () => {
    const uniteId = randomUUID();
    await raw(
      `INSERT INTO org_units (id, tenant_id, name, unit_type, short_name)
       VALUES ($1,$2,'Direction Générale','direction','DG')`,
      [uniteId, tenantId],
    );
    await affecter(alice, 'Comptable', uniteId);
    await affecter(carla, 'Analyste', null);
    await raw(`UPDATE employees SET status = 'archived' WHERE id = $1`, [carla]);

    const actifs = await lister({ status: 'active' });
    expect(actifs.facets.positions).toEqual(['Comptable']);
    expect(actifs.facets.units).toEqual(['DG']);

    const archives = await lister({ status: 'archived' });
    expect(archives.facets.positions).toEqual(['Analyste']);
  });

  it('compte les deux onglets, quel que soit celui qu’on regarde', async () => {
    await raw(`UPDATE employees SET status = 'archived' WHERE id = $1`, [carla]);
    for (const status of [undefined, 'active', 'archived'] as const) {
      const page = await lister({ status });
      expect(page.counts).toEqual({ active: 2, archived: 1 });
    }
  });

  it('compte ce que la RECHERCHE trouve — c’est ce qui dit dans quel onglet chercher', async () => {
    await raw(`UPDATE employees SET status = 'archived' WHERE id = $1`, [carla]);
    const page = await lister({ q: 'CARLA', status: 'active' });
    expect(page.items).toHaveLength(0);
    expect(page.counts).toEqual({ active: 0, archived: 1 });
  });

  it('pagine par décalage', async () => {
    const p1 = await lister({ sort: 'name', dir: 'asc', limit: 2, offset: 0 });
    expect(p1.items.map((i) => i.employeeNumber)).toEqual(['ALICE', 'BRUNO']);
    expect(p1.nextOffset).toBe(2);
    const p2 = await lister({ sort: 'name', dir: 'asc', limit: 2, offset: 2 });
    expect(p2.items.map((i) => i.employeeNumber)).toEqual(['CARLA']);
    expect(p2.nextOffset).toBeNull();
  });
});
