/**
 * Le n+1 des chefs de département et de service (ADR-0034).
 *
 * Il ne se choisit pas : le chef d'un département relève du directeur, le
 * chef d'un service rattaché à la direction aussi, celui d'un service
 * rattaché à un département relève du chef de ce département. Une unité
 * au-dessus sans tête renvoie au niveau suivant, et le DG couvre une
 * direction qui attend la sienne. Les autres agents restent libres : leur
 * n+1 est seulement de leur direction.
 *
 * Le bac d'essai : la Direction Générale au sommet, la DGT dessous, avec le
 * département Études (et son service Comptabilité) et le service Courrier
 * rattaché à la direction.
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CreateEmployeeInput, SessionUser } from '@teranga/contracts';
import { EncryptionService } from '../src/common/encryption.service';
import { ProblemException } from '../src/common/problem';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import { HierarchieService } from '../src/modules/people/hierarchie.service';
import { OrgUnitsService } from '../src/modules/people/org-units.service';
import { PeopleService } from '../src/modules/people/people.service';

const env = loadEnv();
const tenantId = randomUUID();
const userId = randomUUID();
const user = { userId, tenantId, role: 'admin' } as SessionUser;

let ownerPool: Pool;
let db: TenantDb;
let people: PeopleService;
let organigramme: OrgUnitsService;
let hierarchie: HierarchieService;

let uDG: string;
let uDGT: string;
let uEtudes: string;
let uCompta: string;
let uCourrier: string;

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

async function agent(matricule: string, uniteId: string, n1?: string): Promise<string> {
  const input = {
    person: { givenName: matricule, familyName: 'Test' },
    employee: {
      employeeNumber: matricule,
      hiredOn: '2024-01-01',
      ...(n1 ? { managerEmployeeId: n1 } : {}),
    },
    assignment: { positionTitle: 'Analyste', startDate: '2024-01-01', orgUnitId: uniteId },
  } as CreateEmployeeInput;
  return (await people.create(user, input)).id;
}

/** Désigne, depuis l'organigramme ; la personne remplacée devient conseillère. */
const nommer = (uniteId: string, employeeId: string | null) =>
  organigramme.update(user, uniteId, {
    managerEmployeeId: employeeId,
    depuis: '2024-01-01',
    posteDeLAncien: 'Conseiller',
  });

async function n1(employeeId: string): Promise<string | null> {
  const { rows } = await raw(`SELECT manager_employee_id AS n1 FROM employees WHERE id = $1`, [
    employeeId,
  ]);
  return (rows[0] as { n1: string | null }).n1;
}

async function unite(
  nom: string,
  type: string,
  parentId: string | null,
  sigle: string | null = null,
): Promise<string> {
  const id = randomUUID();
  await raw(
    `INSERT INTO org_units (id, tenant_id, parent_id, unit_type, name, short_name)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, tenantId, parentId, type, nom, sigle],
  );
  return id;
}

async function vider() {
  await raw(`UPDATE org_units SET manager_employee_id = NULL WHERE tenant_id = $1`, [tenantId]);
  await raw(`UPDATE employees SET manager_employee_id = NULL WHERE tenant_id = $1`, [tenantId]);
  for (const table of ['assignments', 'contracts', 'employees', 'persons', 'org_units']) {
    await raw(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  }
  await raw(`DELETE FROM audit_log WHERE tenant_id = $1`, [tenantId]);
}

/** Le DG et le directeur de la DGT, en place. */
async function laTete(): Promise<{ dg: string; directeur: string }> {
  const dg = await agent('DG', uDG);
  await nommer(uDG, dg);
  const directeur = await agent('DIR', uDGT);
  await nommer(uDGT, directeur);
  return { dg, directeur };
}

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 3 });
  db = new TenantDb();
  people = new PeopleService(db, new EncryptionService());
  organigramme = new OrgUnitsService(db);
  hierarchie = new HierarchieService(db);
  await raw(
    `INSERT INTO users (id, email, password_hash, given_name, family_name)
     VALUES ($1,$2,'x','Test','Admin')`,
    [userId, `chefs-${userId}@test.local`],
  );
  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1,'Chefs',$2)`, [
    tenantId,
    `chefs-${tenantId.slice(0, 8)}`,
  ]);
});

beforeEach(async () => {
  await vider();
  uDG = await unite('Direction Générale', 'direction', null, 'DG');
  uDGT = await unite('Direction des Grands Travaux', 'direction', uDG, 'DGT');
  uEtudes = await unite('Département Études', 'department', uDGT);
  uCompta = await unite('Service Comptabilité', 'service', uEtudes);
  uCourrier = await unite('Service Courrier', 'service', uDGT);
});

afterAll(async () => {
  await vider();
  await raw(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  await raw(`DELETE FROM users WHERE id = $1`, [userId]);
  await db?.pool.end();
  await ownerPool?.end();
});

describe('désigné, le chef prend le n+1 de sa place', () => {
  it('chef d’un département : le directeur', async () => {
    const { directeur } = await laTete();
    const collegue = await agent('COLLEGUE', uDGT, directeur);
    const x = await agent('X', uEtudes, collegue);
    const r = await nommer(uEtudes, x);
    expect(await n1(x)).toBe(directeur);
    expect(r.changements).toContainEqual(
      expect.objectContaining({ employeeId: x, motif: 'chef_d_unite' }),
    );
  });

  it('chef d’un service rattaché à un département : le chef du département', async () => {
    await laTete();
    const chefEtudes = await agent('ETUDES', uEtudes);
    await nommer(uEtudes, chefEtudes);
    const y = await agent('Y', uCompta);
    await nommer(uCompta, y);
    expect(await n1(y)).toBe(chefEtudes);
  });

  it('chef d’un service rattaché à la direction : le directeur', async () => {
    const { directeur } = await laTete();
    const z = await agent('Z', uCourrier);
    await nommer(uCourrier, z);
    expect(await n1(z)).toBe(directeur);
  });

  it('par la case « Désigner comme responsable » aussi, sans n+1 à choisir', async () => {
    await laTete();
    const chefEtudes = await agent('ETUDES', uEtudes);
    await nommer(uEtudes, chefEtudes);
    const x = await agent('X', uCourrier);
    await people.newAssignment(user, x, {
      orgUnitId: uCompta,
      startDate: '2025-05-01',
      responsable: true,
    } as never);
    expect(await n1(x)).toBe(chefEtudes);
  });
});

describe('quand l’unité au-dessus change de tête', () => {
  it('département sans chef : le chef de service relève du directeur, puis du chef nommé', async () => {
    const { directeur } = await laTete();
    const y = await agent('Y', uCompta);
    await nommer(uCompta, y);
    expect(await n1(y)).toBe(directeur);

    const chefEtudes = await agent('ETUDES', uEtudes);
    const r = await nommer(uEtudes, chefEtudes);
    expect(await n1(y)).toBe(chefEtudes);
    expect(r.changements).toContainEqual(
      expect.objectContaining({ employeeId: y, motif: 'chef_d_unite' }),
    );
  });

  it('chef du département retiré : ses chefs de service remontent au directeur', async () => {
    const { directeur } = await laTete();
    const chefEtudes = await agent('ETUDES', uEtudes);
    await nommer(uEtudes, chefEtudes);
    const y = await agent('Y', uCompta);
    await nommer(uCompta, y);
    await nommer(uEtudes, null);
    expect(await n1(y)).toBe(directeur);
    // L'ancien chef, resté dans la direction, garde son n+1.
    expect(await n1(chefEtudes)).toBe(directeur);
  });

  it('chef du département remplacé : le chef de service passe au nouveau, l’ancien ne bouge pas', async () => {
    const { directeur } = await laTete();
    const ancien = await agent('ANCIEN', uEtudes);
    await nommer(uEtudes, ancien);
    const y = await agent('Y', uCompta);
    await nommer(uCompta, y);
    const nouveau = await agent('NOUVEAU', uEtudes);
    await nommer(uEtudes, nouveau);
    expect(await n1(y)).toBe(nouveau);
    expect(await n1(nouveau)).toBe(directeur);
    expect(await n1(ancien)).toBe(directeur);
  });

  it('direction sans tête : le DG couvre le chef du département, le directeur nommé le reprend', async () => {
    const dg = await agent('DG', uDG);
    await nommer(uDG, dg);
    const chefEtudes = await agent('ETUDES', uEtudes);
    await nommer(uEtudes, chefEtudes);
    expect(await n1(chefEtudes)).toBe(dg);

    const directeur = await agent('DIR', uDGT);
    await nommer(uDGT, directeur);
    expect(await n1(chefEtudes)).toBe(directeur);
  });

  it('un service rattaché ailleurs change de supérieur', async () => {
    const { directeur } = await laTete();
    const chefEtudes = await agent('ETUDES', uEtudes);
    await nommer(uEtudes, chefEtudes);
    const z = await agent('Z', uCourrier);
    await nommer(uCourrier, z);
    expect(await n1(z)).toBe(directeur);
    await organigramme.update(user, uCourrier, { parentId: uEtudes });
    expect(await n1(z)).toBe(chefEtudes);
  });
});

describe('le n+1 d’un chef ne se choisit pas', () => {
  it('refusé dans la fiche, accepté pour le responsable au-dessus', async () => {
    const { directeur } = await laTete();
    const collegue = await agent('COLLEGUE', uDGT, directeur);
    const chefEtudes = await agent('ETUDES', uEtudes);
    await nommer(uEtudes, chefEtudes);
    expect(
      await codeOf(() =>
        people.update(user, chefEtudes, { employee: { managerEmployeeId: collegue } }),
      ),
    ).toBe('people.chef_mal_rattache');
    expect(await n1(chefEtudes)).toBe(directeur);
  });

  it('les autres agents restent libres dans leur direction', async () => {
    const { directeur } = await laTete();
    const chefEtudes = await agent('ETUDES', uEtudes);
    await nommer(uEtudes, chefEtudes);
    // Agent du service Comptabilité, rattaché à un collègue du service
    // Courrier : la même direction suffit.
    const collegue = await agent('COLLEGUE', uCourrier, directeur);
    const a = await agent('A', uCompta, collegue);
    expect(await n1(a)).toBe(collegue);
  });

  it('le contrôle signale un chef mal rattaché', async () => {
    const { directeur } = await laTete();
    const collegue = await agent('COLLEGUE', uDGT, directeur);
    const chefEtudes = await agent('ETUDES', uEtudes);
    await nommer(uEtudes, chefEtudes);
    await raw(`UPDATE employees SET manager_employee_id = $1 WHERE id = $2`, [
      collegue,
      chefEtudes,
    ]);
    const { anomalies } = await hierarchie.controle(user);
    expect(anomalies.map((a) => `${a.matricule}:${a.type}`)).toEqual(['ETUDES:chef_mal_rattache']);
  });
});
