/**
 * Le N+1 des têtes de département et de service (ADR-0034, ADR-0147).
 *
 * Ce N+1 se calcule : la tête d'un département relève de la tête de sa
 * direction, la tête d'un service rattaché à la direction aussi, la tête d'un
 * service rattaché à un département relève de la tête de ce département. Une
 * unité au-dessus sans tête renvoie au niveau suivant, et le DG couvre une
 * direction qui attend la sienne. À la relève d'une tête, son unité passe à
 * la nouvelle, et l'ancienne tête aussi, restée dans l'unité.
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
import { recalculerLaChaine } from '../src/modules/people/recalcul-de-la-chaine';

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

async function agent(matricule: string, uniteId: string): Promise<string> {
  const input = {
    person: { givenName: matricule, familyName: 'Test' },
    employee: { employeeNumber: matricule, hiredOn: '2024-01-01' },
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

describe('désignée, la tête d’une unité relève de l’unité au-dessus', () => {
  it('tête d’un département : la tête de la direction', async () => {
    const { directeur } = await laTete();
    const x = await agent('X', uEtudes);
    await nommer(uEtudes, x);
    expect(await n1(x)).toBe(directeur);
  });

  it('tête d’un service rattaché à un département : la tête du département', async () => {
    await laTete();
    const chefEtudes = await agent('ETUDES', uEtudes);
    await nommer(uEtudes, chefEtudes);
    const y = await agent('Y', uCompta);
    await nommer(uCompta, y);
    expect(await n1(y)).toBe(chefEtudes);
  });

  it('tête d’un service rattaché à la direction : la tête de la direction', async () => {
    const { directeur } = await laTete();
    const z = await agent('Z', uCourrier);
    await nommer(uCourrier, z);
    expect(await n1(z)).toBe(directeur);
  });

  it('par la case « Désigner comme responsable » aussi, sans N+1 à choisir', async () => {
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
  it('département sans tête : la tête du service relève de la direction, puis de la tête nommée', async () => {
    const { directeur } = await laTete();
    const y = await agent('Y', uCompta);
    await nommer(uCompta, y);
    expect(await n1(y)).toBe(directeur);

    const chefEtudes = await agent('ETUDES', uEtudes);
    const r = await nommer(uEtudes, chefEtudes);
    expect(await n1(y)).toBe(chefEtudes);
    expect(r.changements).toContainEqual(
      expect.objectContaining({ employeeId: y, motif: 'unite_au_dessus' }),
    );
  });

  it('tête du département retirée : tout le département remonte à la direction', async () => {
    const { directeur } = await laTete();
    const chefEtudes = await agent('ETUDES', uEtudes);
    await nommer(uEtudes, chefEtudes);
    const y = await agent('Y', uCompta);
    await nommer(uCompta, y);
    const a = await agent('A', uEtudes);
    await nommer(uEtudes, null);
    expect(await n1(y)).toBe(directeur);
    // Sans successeur, le département relève de la direction : l'ancienne
    // tête, restée conseillère, comme ses agents.
    expect(await n1(chefEtudes)).toBe(directeur);
    expect(await n1(a)).toBe(directeur);
  });

  it('tête du département remplacée : la tête du service et l’ancienne passent sous la nouvelle', async () => {
    const { directeur } = await laTete();
    const ancien = await agent('ANCIEN', uEtudes);
    await nommer(uEtudes, ancien);
    const y = await agent('Y', uCompta);
    await nommer(uCompta, y);
    const nouveau = await agent('NOUVEAU', uEtudes);
    const r = await nommer(uEtudes, nouveau);
    expect(await n1(y)).toBe(nouveau);
    expect(await n1(nouveau)).toBe(directeur);
    // Restée dans le département, conseillère : l'ancienne tête relève de la nouvelle.
    expect(await n1(ancien)).toBe(nouveau);
    expect(r.changements).toContainEqual(
      expect.objectContaining({ employeeId: ancien, motif: 'tete_de_son_unite' }),
    );
  });

  it('direction sans tête : le DG couvre la tête du département, jusqu’à la tête de direction', async () => {
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

describe('à la relève d’une tête, son unité passe à la nouvelle', () => {
  it('les agents de l’unité, et l’ancienne tête restée dans l’unité ; pas les agents d’ailleurs', async () => {
    const { directeur } = await laTete();
    const ancien = await agent('ANCIEN', uEtudes);
    await nommer(uEtudes, ancien);
    const dedans = await agent('DEDANS', uEtudes);
    const ailleurs = await agent('AILLEURS', uCourrier);
    const nouveau = await agent('NOUVEAU', uEtudes);

    const r = await nommer(uEtudes, nouveau);
    expect(await n1(dedans)).toBe(nouveau);
    expect(await n1(ailleurs)).toBe(directeur);
    expect(r.changements.map((c) => `${c.nom}:${c.motif}`).sort()).toEqual([
      'ANCIEN Test:tete_de_son_unite',
      'DEDANS Test:tete_de_son_unite',
      'NOUVEAU Test:unite_au_dessus',
    ]);
  });

  it('la nouvelle tête, prise dans l’unité, relève de l’unité au-dessus', async () => {
    const { directeur } = await laTete();
    const ancien = await agent('ANCIEN', uCompta);
    await nommer(uCompta, ancien);
    const nouveau = await agent('NOUVEAU', uCompta);
    const collegue = await agent('COLLEGUE', uCompta);
    await nommer(uCompta, nouveau);
    expect(await n1(nouveau)).toBe(directeur);
    expect(await n1(collegue)).toBe(nouveau);
    expect(await n1(ancien)).toBe(nouveau);
  });

  it('par la case « Désigner comme responsable » aussi', async () => {
    await laTete();
    const ancien = await agent('ANCIEN', uEtudes);
    await nommer(uEtudes, ancien);
    const a = await agent('A', uEtudes);
    const x = await agent('X', uCourrier);
    await people.newAssignment(user, x, {
      orgUnitId: uEtudes,
      startDate: '2025-05-01',
      responsable: true,
      posteDeLAncien: 'Conseiller',
    } as never);
    expect(await n1(a)).toBe(x);
    expect(await n1(ancien)).toBe(x);
  });
});

describe('le responsable se choisit dans la direction', () => {
  /** Son affectation du jour : l'unité et le poste. */
  async function place(employeeId: string): Promise<{ unite: string; poste: string }> {
    const { rows } = await raw(
      `SELECT org_unit_id AS unite, position_title AS poste FROM assignments
        WHERE employee_id = $1 AND validity @> CURRENT_DATE`,
      [employeeId],
    );
    return rows[0] as { unite: string; poste: string };
  }

  it('un département vide : un agent de la direction en prend la tête, et y est affecté', async () => {
    const { directeur } = await laTete();
    const x = await agent('X', uCourrier);
    await nommer(uEtudes, x);
    // Sans genre connu, l'intitulé reste neutre.
    expect(await place(x)).toEqual({ unite: uEtudes, poste: 'Responsable du département Études' });
    expect(await n1(x)).toBe(directeur);
  });

  it('chef d’un service rattaché au département : affecté au service, sous le chef du département', async () => {
    await laTete();
    const chefEtudes = await agent('ETUDES', uEtudes);
    await nommer(uEtudes, chefEtudes);
    const y = await agent('Y', uDGT);
    await nommer(uCompta, y);
    expect((await place(y)).unite).toBe(uCompta);
    expect(await n1(y)).toBe(chefEtudes);
  });

  it('ni le directeur, ni un agent d’une autre direction', async () => {
    const { dg, directeur } = await laTete();
    expect(await codeOf(() => nommer(uEtudes, directeur))).toBe('org.manager_already_assigned');
    const ailleurs = await agent('AILLEURS', uDG);
    expect(await codeOf(() => nommer(uEtudes, ailleurs))).toBe('org.manager_outside_unit');
  });

  it('la liste propose toute la direction, sans qui dirige déjà une unité', async () => {
    const { dg } = await laTete();
    const chefEtudes = await agent('ETUDES', uEtudes);
    await nommer(uEtudes, chefEtudes);
    await agent('COURRIER', uCourrier);
    await agent('DGT', uDGT);
    await agent('AILLEURS', uDG);
    const candidats = await organigramme.eligibleManagers(user, uCompta);
    expect(candidats.map((c) => c.employeeNumber).sort()).toEqual(['COURRIER', 'DGT']);
  });
});

describe('le N+1 d’une tête ne se choisit pas', () => {
  it('la fiche ne le saisit pas', async () => {
    const { directeur } = await laTete();
    const collegue = await agent('COLLEGUE', uDGT);
    const chefEtudes = await agent('ETUDES', uEtudes);
    await nommer(uEtudes, chefEtudes);
    expect(
      await codeOf(() =>
        people.update(user, chefEtudes, { employee: { managerEmployeeId: collegue } as never }),
      ),
    ).toBe('AUCUNE ERREUR');
    expect(await n1(chefEtudes)).toBe(directeur);
  });

  it('le N+1 fonctionnel se choisit, en revanche, dans toute direction', async () => {
    await laTete();
    const chefEtudes = await agent('ETUDES', uEtudes);
    await nommer(uEtudes, chefEtudes);
    const ailleurs = await agent('AILLEURS', uDG);
    const a = await agent('A', uCompta);
    await people.update(user, a, { employee: { n1FonctionnelId: ailleurs } });
    expect(await n1(a)).toBe(chefEtudes);
    expect((await people.detail(user, a)).n1Fonctionnel?.id).toBe(ailleurs);
  });

  it('un N+1 écrit à la main se corrige au calcul suivant', async () => {
    const { directeur } = await laTete();
    const collegue = await agent('COLLEGUE', uDGT);
    const chefEtudes = await agent('ETUDES', uEtudes);
    await nommer(uEtudes, chefEtudes);
    await raw(`UPDATE employees SET manager_employee_id = $1 WHERE id = $2`, [
      collegue,
      chefEtudes,
    ]);
    await db.withTenant({ tenantId, userId }, (tx) => recalculerLaChaine(tx, tenantId));
    expect(await n1(chefEtudes)).toBe(directeur);
    expect((await hierarchie.controle(user)).anomalies).toEqual([]);
  });
});
