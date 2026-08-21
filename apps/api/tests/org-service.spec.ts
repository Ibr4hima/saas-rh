/**
 * Règles APPLICATIVES de l'organigramme — celles que le SQL ne tient pas.
 *
 * La migration 0012 le dit elle-même : la hiérarchie des types et
 * l'appartenance d'un responsable à son unité « demandent de remonter l'arbre :
 * elles sont tenues côté applicatif, pas ici ». Elles étaient donc livrées sans
 * aucun filet — y compris `remove()`, l'opération la plus destructive du module.
 *
 * Une revue adverse a trouvé trois chemins qui contournaient la règle du
 * responsable (mutation, dissolution, re-rattachement) : chacun a son test.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '@teranga/contracts';
import { ProblemException } from '../src/common/problem';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import { OrgUnitsService } from '../src/modules/people/org-units.service';

const env = loadEnv();

const tenantId = randomUUID();
const userId = randomUUID();
const user = {
  userId,
  tenantId,
  role: 'admin',
  givenName: 'Test',
  familyName: 'Admin',
} as SessionUser;

let ownerPool: Pool;
let db: TenantDb;
let service: OrgUnitsService;

/** Identifiants recréés à chaque test : les cas se détruisent mutuellement. */
let direction: string;
let departement: string;
let serviceUnit: string;
let autreDirection: string;
let chefId: string;

const today = () => new Date().toISOString().slice(0, 10);

async function raw(query: string, params: unknown[] = []) {
  return ownerPool.query(query, params as never[]);
}

/** Le code d'erreur RFC 9457 d'un appel censé échouer. */
async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'AUCUNE ERREUR';
  } catch (err) {
    if (err instanceof ProblemException) return err.problem.code;
    return `NON-PROBLEM: ${(err as Error).message}`;
  }
}

async function creerEmploye(numero: string, orgUnitId: string | null): Promise<string> {
  const personId = randomUUID();
  const employeeId = randomUUID();
  await raw(
    `INSERT INTO persons (id, tenant_id, given_name, family_name) VALUES ($1,$2,'Agent',$3)`,
    [personId, tenantId, numero],
  );
  await raw(
    `INSERT INTO employees (id, tenant_id, person_id, employee_number, hired_on)
     VALUES ($1,$2,$3,$4,'2024-01-01')`,
    [employeeId, tenantId, personId, numero],
  );
  if (orgUnitId) {
    await raw(
      `INSERT INTO assignments (id, tenant_id, employee_id, org_unit_id, position_title, validity)
       VALUES ($1,$2,$3,$4,'Agent', daterange('2024-01-01', NULL))`,
      [randomUUID(), tenantId, employeeId, orgUnitId],
    );
  }
  return employeeId;
}

async function creerUnite(
  name: string,
  unitType: string,
  parentId: string | null,
): Promise<string> {
  const id = randomUUID();
  await raw(
    `INSERT INTO org_units (id, tenant_id, unit_type, name, parent_id) VALUES ($1,$2,$3,$4,$5)`,
    [id, tenantId, unitType, name, parentId],
  );
  return id;
}

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 3 });
  db = new TenantDb();
  service = new OrgUnitsService(db);
  await raw(
    `INSERT INTO users (id, email, password_hash, given_name, family_name)
     VALUES ($1,$2,'x','Test','Admin')`,
    [userId, `orgsvc-${userId}@test.local`],
  );
  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1,'OrgSvc',$2)`, [
    tenantId,
    `orgsvc-${tenantId.slice(0, 8)}`,
  ]);
});

beforeEach(async () => {
  await raw(`DELETE FROM assignments WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM job_postings WHERE tenant_id = $1`, [tenantId]);
  await raw(`UPDATE org_units SET manager_employee_id = NULL WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM employees WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM persons WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM org_units WHERE tenant_id = $1`, [tenantId]);

  direction = await creerUnite('Direction Mère', 'direction', null);
  autreDirection = await creerUnite('Direction Voisine', 'direction', null);
  departement = await creerUnite('Département Fils', 'department', direction);
  serviceUnit = await creerUnite('Service Petit-Fils', 'service', departement);
  chefId = await creerEmploye('CHEF-1', serviceUnit);
  await raw(`UPDATE org_units SET manager_employee_id = $1 WHERE id = $2`, [chefId, departement]);
});

afterAll(async () => {
  // Les responsables d'abord : org_units référence employees.
  await raw(`UPDATE org_units SET manager_employee_id = NULL WHERE tenant_id = $1`, [tenantId]);
  for (const table of ['assignments', 'job_postings', 'employees', 'persons']) {
    await raw(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  }
  await raw(`DELETE FROM org_units WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  await raw(`DELETE FROM users WHERE id = $1`, [userId]);
  await db?.pool.end();
  await ownerPool?.end();
});

describe('hiérarchie des types', () => {
  it('refuse une direction rattachée sous un service', async () => {
    // « autreDirection » n'est pas un ancêtre du service : c'est bien la règle
    // de type qui doit parler, pas l'anti-cycle.
    expect(
      await codeOf(() => service.update(user, autreDirection, { parentId: serviceUnit })),
    ).toBe('org.direction_is_root');
  });

  it('refuse un département sans rattachement', async () => {
    expect(
      await codeOf(() => service.create(user, { name: 'Orphelin', unitType: 'department' })),
    ).toBe('org.parent_required');
  });

  it('refuse un département sous un service', async () => {
    expect(
      await codeOf(() =>
        service.create(user, {
          name: 'Sous-service',
          unitType: 'department',
          parentId: serviceUnit,
        }),
      ),
    ).toBe('org.parent_type_invalid');
  });

  it('refuse un changement de type qui rendrait les enfants illégitimes', async () => {
    expect(await codeOf(() => service.update(user, departement, { unitType: 'service' }))).toBe(
      'org.children_type_invalid',
    );
  });
});

describe('responsable', () => {
  it('refuse un employé qui ne travaille pas dans l’unité', async () => {
    const etranger = await creerEmploye('ETR-1', autreDirection);
    expect(
      await codeOf(() => service.update(user, direction, { managerEmployeeId: etranger })),
    ).toBe('org.manager_outside_unit');
  });

  it('accepte un employé du sous-arbre', async () => {
    // chefId est affecté au service, petit-fils de la direction. On le libère
    // du département d'abord : un employé ne dirige qu'une unité.
    await raw(`UPDATE org_units SET manager_employee_id = NULL WHERE id = $1`, [departement]);
    await service.update(user, direction, { managerEmployeeId: chefId });
    const units = await service.list(user);
    expect(units.find((u) => u.id === direction)!.managerEmployeeId).toBe(chefId);
  });

  it('refuse un employé au dossier clos', async () => {
    await raw(`UPDATE employees SET status = 'terminated' WHERE id = $1`, [chefId]);
    expect(await codeOf(() => service.update(user, direction, { managerEmployeeId: chefId }))).toBe(
      'org.manager_not_active',
    );
  });

  it('ne propose comme éligibles que le sous-arbre actif', async () => {
    await creerEmploye('ETR-2', autreDirection);
    const eligibles = await service.eligibleManagers(user, departement);
    expect(eligibles.map((e) => e.employeeNumber)).toEqual(['CHEF-1']);
  });
});

describe('dissolution', () => {
  it('refuse tant que l’unité en contient d’autres', async () => {
    expect(await codeOf(() => service.remove(user, direction, {}))).toBe('org.unit_has_children');
  });

  it('exige une unité d’accueil dès qu’une affectation pointe dessus', async () => {
    expect(await codeOf(() => service.remove(user, serviceUnit, {}))).toBe('org.reassign_required');
  });

  it('compte AUSSI les employés non actifs et les affectations à venir', async () => {
    // Un suspendu est invisible à l'écran mais reste rattaché : le compter est
    // la seule façon de ne pas l'abandonner sur une unité fantôme.
    await raw(`UPDATE employees SET status = 'suspended' WHERE id = $1`, [chefId]);
    expect(await codeOf(() => service.remove(user, serviceUnit, {}))).toBe('org.reassign_required');
  });

  it('refuse si une offre de recrutement vise l’unité', async () => {
    await raw(
      `INSERT INTO job_postings
         (id, tenant_id, title, description, contract_type, org_unit_id, status,
          public_slug, created_by_user_id)
       VALUES ($1,$2,'Poste','desc','cdi',$3,'published',$4,$5)`,
      [randomUUID(), tenantId, serviceUnit, randomUUID().slice(0, 20), userId],
    );
    expect(await codeOf(() => service.remove(user, serviceUnit, { reassignTo: direction }))).toBe(
      'org.unit_has_job_postings',
    );
  });

  it('préserve l’historique : clôt l’ancienne affectation et en ouvre une neuve', async () => {
    await raw(`UPDATE org_units SET manager_employee_id = NULL WHERE id = $1`, [departement]);
    await service.remove(user, serviceUnit, { reassignTo: autreDirection });
    const { rows } = await raw(
      `SELECT org_unit_id, lower(validity)::text AS debut, upper(validity)::text AS fin
       FROM assignments WHERE employee_id = $1 ORDER BY lower(validity)`,
      [chefId],
    );
    expect(rows).toHaveLength(2);
    // L'ancienne garde son unité et se ferme aujourd'hui — le dossier ne dira
    // jamais que l'agent était ailleurs depuis 2024.
    expect(rows[0]).toMatchObject({ org_unit_id: serviceUnit, debut: '2024-01-01', fin: today() });
    expect(rows[1]).toMatchObject({ org_unit_id: autreDirection, debut: today(), fin: null });
  });

  it('refuse de faire sortir un responsable de l’unité qu’il dirige', async () => {
    // chefId dirige le département et travaille dans son service. Dissoudre le
    // service vers une autre direction le sortirait de son périmètre.
    expect(
      await codeOf(() => service.remove(user, serviceUnit, { reassignTo: autreDirection })),
    ).toBe('org.manager_would_leave_unit');
  });
});

describe('re-rattachement', () => {
  it('refuse de faire sortir un responsable par déplacement de son unité', async () => {
    expect(
      await codeOf(() => service.update(user, serviceUnit, { parentId: autreDirection })),
    ).toBe('org.manager_would_leave_unit');
  });

  it('accepte un déplacement qui garde le responsable dans son périmètre', async () => {
    const autreDept = await creerUnite('Département Voisin', 'department', direction);
    await raw(`UPDATE org_units SET manager_employee_id = NULL WHERE id = $1`, [departement]);
    await raw(`UPDATE org_units SET manager_employee_id = $1 WHERE id = $2`, [chefId, direction]);
    // Le service reste sous la direction que chefId dirige : périmètre conservé.
    await service.update(user, serviceUnit, { parentId: autreDept });
    const units = await service.list(user);
    expect(units.find((u) => u.id === serviceUnit)!.parentId).toBe(autreDept);
  });
});

describe('traductions d’erreurs SQL', () => {
  it('un abrégé déjà pris devient un 422 lisible', async () => {
    await service.update(user, direction, { shortName: 'DGX' });
    expect(await codeOf(() => service.update(user, autreDirection, { shortName: 'dgx' }))).toBe(
      'org.short_name_taken',
    );
  });

  it('deux unités sœurs homonymes deviennent un 422 lisible', async () => {
    expect(
      await codeOf(() => service.create(user, { name: 'direction mère', unitType: 'direction' })),
    ).toBe('org.name_taken');
  });

  it('un employé qui dirige déjà une unité devient un 422 lisible', async () => {
    // chefId dirige le département ; on tente de lui donner aussi le service.
    expect(
      await codeOf(() => service.update(user, serviceUnit, { managerEmployeeId: chefId })),
    ).toBe('org.manager_already_assigned');
  });
});
