/**
 * Le DGA (ADR-0126) : la désignation se fait au sommet, à côté de celle du
 * DG, et s'écrit dans les affectations, comme celle d'un responsable
 * (ADR-0033) : le poste au genre, à compter de la prise de fonction. La
 * personne remplacée reçoit son nouveau poste, et son équipe passe au
 * nouveau DGA.
 *
 * Le bac d'essai : la Direction Générale (DG) au sommet, une cellule en son
 * sein, la DGT dessous.
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  newAssignmentSchema,
  posteDAdjoint,
  type CreateEmployeeInput,
  type NewAssignmentInput,
  type SessionUser,
  type UpdateOrgUnitInput,
} from '@teranga/contracts';
import { EncryptionService } from '../src/common/encryption.service';
import { ProblemException } from '../src/common/problem';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import { quiSecondeLeSommet } from '../src/modules/documents/dossier';
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

let uDG: string;
let uCellule: string;
let uDGT: string;

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

/** Le jour, décalé de `n` jours, comme la base le compte (Africa/Dakar). */
async function jour(n = 0): Promise<string> {
  const { rows } = await raw(`SELECT (CURRENT_DATE + $1::int)::text AS j`, [n]);
  return (rows[0] as { j: string }).j;
}

async function agent(
  matricule: string,
  uniteId: string,
  { genre, depuis = '2024-01-01' }: { genre?: 'female' | 'male'; depuis?: string } = {},
): Promise<string> {
  const input = {
    person: { givenName: matricule, familyName: 'Test', ...(genre ? { gender: genre } : {}) },
    employee: { employeeNumber: matricule, hiredOn: '2024-01-01' },
    assignment: { positionTitle: 'Analyste', startDate: depuis, orgUnitId: uniteId },
  } as CreateEmployeeInput;
  return (await people.create(user, input)).id;
}

/** Ses affectations, de la plus ancienne à la plus récente ; `au` est exclu. */
async function affectations(employeeId: string) {
  const { rows } = await raw(
    `SELECT position_title AS poste, org_unit_id AS unite, responsable,
            lower(validity)::text AS du, upper(validity)::text AS au
       FROM assignments WHERE employee_id = $1 ORDER BY lower(validity)`,
    [employeeId],
  );
  return rows as {
    poste: string;
    unite: string;
    responsable: boolean;
    du: string;
    au: string | null;
  }[];
}

async function n1(employeeId: string): Promise<string | null> {
  const { rows } = await raw(`SELECT manager_employee_id AS n1 FROM employees WHERE id = $1`, [
    employeeId,
  ]);
  return (rows[0] as { n1: string | null }).n1;
}

/** Le DGA que porte le sommet, tel qu'écrit en base. */
async function adjointEcrit(): Promise<string | null> {
  const { rows } = await raw(`SELECT adjoint_employee_id AS a FROM org_units WHERE id = $1`, [uDG]);
  return (rows[0] as { a: string | null }).a;
}

/** La fiche du sommet, telle que l'organigramme la lit. */
async function sommet() {
  return (await organigramme.list(user)).find((u) => u.id === uDG)!;
}

/** Le DG, en fonction depuis son arrivée à la Direction Générale. */
async function leDG(): Promise<string> {
  const dg = await agent('DG', uDG, { genre: 'male' });
  await organigramme.update(user, uDG, { managerEmployeeId: dg, depuis: '2024-01-01' });
  return dg;
}

/** Désigner le DGA, depuis l'organigramme. */
const designer = (adjointEmployeeId: string | null, plus: Partial<UpdateOrgUnitInput> = {}) =>
  organigramme.update(user, uDG, { adjointEmployeeId, ...plus }, people.suiteDeLaPassation(user));

/** Reste à la Direction Générale, au poste dit. */
const reste = (positionTitle: string) => ({
  devenirDeLAncien: { choix: 'affectation' as const, orgUnitId: uDG, positionTitle },
});

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
  await raw(
    `UPDATE org_units SET manager_employee_id = NULL, adjoint_employee_id = NULL
      WHERE tenant_id = $1`,
    [tenantId],
  );
  await raw(`UPDATE employees SET manager_employee_id = NULL WHERE tenant_id = $1`, [tenantId]);
  for (const table of ['assignments', 'contracts', 'employees', 'persons', 'org_units']) {
    await raw(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  }
  await raw(`DELETE FROM audit_log WHERE tenant_id = $1`, [tenantId]);
}

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 3 });
  db = new TenantDb();
  people = new PeopleService(db, new EncryptionService());
  organigramme = new OrgUnitsService(db);
  await raw(
    `INSERT INTO users (id, email, password_hash, given_name, family_name)
     VALUES ($1,$2,'x','Test','Admin')`,
    [userId, `adjoint-${userId}@test.local`],
  );
  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1,'Adjoint',$2)`, [
    tenantId,
    `adjoint-${tenantId.slice(0, 8)}`,
  ]);
});

beforeEach(async () => {
  await vider();
  uDG = await unite('Direction Générale', 'direction', null, 'DG');
  uCellule = await unite('Cellule de communication', 'department', uDG);
  uDGT = await unite('Direction des Grands Travaux', 'direction', uDG, 'DGT');
});

afterAll(async () => {
  await vider();
  await raw(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  await raw(`DELETE FROM users WHERE id = $1`, [userId]);
  await db?.pool.end();
  await ownerPool?.end();
});

describe('l’intitulé du poste', () => {
  it('Directeur général adjoint, Directrice générale adjointe ; sans genre, Responsable adjoint·e', () => {
    const dg = { name: 'Direction Générale', shortName: 'DG' };
    expect(posteDAdjoint(dg, 'male')).toBe('Directeur général adjoint');
    expect(posteDAdjoint(dg, 'female')).toBe('Directrice générale adjointe');
    expect(posteDAdjoint(dg, null)).toBe('Responsable adjoint·e de la DG');
  });
});

describe('la désignation', () => {
  it('au genre, à sa prise de fonction ; relève du DG ; la fiche du sommet la montre', async () => {
    const dg = await leDG();
    const a = await agent('A', uDG, { genre: 'female', depuis: '2024-02-01' });
    const aujourdhui = await jour(0);

    await designer(a, { depuis: aujourdhui });

    expect(await adjointEcrit()).toBe(a);
    expect(await n1(a)).toBe(dg);
    const postes = await affectations(a);
    expect(postes.at(-2)).toMatchObject({ poste: 'Analyste', au: aujourdhui });
    expect(postes.at(-1)).toMatchObject({
      poste: 'Directrice générale adjointe',
      unite: uDG,
      responsable: false,
      du: aujourdhui,
      au: null,
    });
    expect((await sommet()).adjoint).toEqual({
      employeeId: a,
      nomAbrege: 'A Test',
      genre: 'female',
      matricule: 'A',
      depuis: aujourdhui,
    });
    const ailleurs = (await organigramme.list(user)).filter((u) => u.id !== uDG);
    expect(ailleurs.map((u) => u.adjoint)).toEqual(ailleurs.map(() => null));
  });

  it('refusée : hors du sommet, au DG, hors de la Direction Générale, à une tête, avec autre chose', async () => {
    const dg = await leDG();
    const x = await agent('X', uDGT, { genre: 'male' });
    const c = await agent('C', uCellule, { genre: 'male' });
    await organigramme.update(user, uCellule, { managerEmployeeId: c, depuis: '2024-01-01' });

    expect(await codeOf(() => organigramme.update(user, uDGT, { adjointEmployeeId: x }))).toBe(
      'org.adjoint_au_sommet',
    );
    expect(await codeOf(() => designer(dg))).toBe('org.adjoint_est_le_dg');
    expect(await codeOf(() => designer(x))).toBe('org.adjoint_hors_direction_generale');
    expect(await codeOf(() => designer(c))).toBe('org.adjoint_dirige_une_unite');
    expect(await codeOf(() => designer(c, { name: 'Direction Générale' }))).toBe(
      'org.adjoint_seul',
    );
    expect(await adjointEcrit()).toBeNull();
  });

  it('remplacé : la personne remplacée reçoit son poste, son équipe passe au nouveau DGA', async () => {
    const dg = await leDG();
    const a = await agent('A', uDG, { genre: 'female' });
    const b = await agent('B', uDG, { genre: 'male' });
    const e = await agent('E', uDG, { genre: 'male' });
    await designer(a, { depuis: '2024-06-01' });
    await raw(`UPDATE employees SET manager_employee_id = $2 WHERE id = $1`, [e, a]);

    const { changements } = await designer(b, {
      depuis: await jour(0),
      ...reste('Conseillère technique'),
    });

    expect(await adjointEcrit()).toBe(b);
    expect((await affectations(a)).at(-1)).toMatchObject({
      poste: 'Conseillère technique',
      responsable: false,
      au: null,
    });
    expect((await affectations(b)).at(-1)).toMatchObject({
      poste: 'Directeur général adjoint',
      au: null,
    });
    expect(await n1(b)).toBe(dg);
    expect(await n1(e)).toBe(b);
    expect(changements).toContainEqual(
      expect.objectContaining({ employeeId: e, motif: 'suit_le_dga' }),
    );
  });

  it('sans successeur, la place se libère ; la personne remplacée reçoit son poste, qui se demande', async () => {
    await leDG();
    const a = await agent('A', uDG, { genre: 'female' });
    await designer(a, { depuis: '2024-06-01' });

    expect(await codeOf(() => designer(null))).toBe('org.poste_de_l_ancien_requis');
    await designer(null, reste('Conseillère'));

    expect(await adjointEcrit()).toBeNull();
    expect((await affectations(a)).at(-1)!.poste).toBe('Conseillère');
    expect((await sommet()).adjoint).toBeNull();
  });

  it('le DGA qui prend la tête du sommet quitte sa place', async () => {
    const dg = await leDG();
    const a = await agent('A', uDG, { genre: 'female' });
    await designer(a, { depuis: '2024-06-01' });

    await organigramme.update(
      user,
      uDG,
      { managerEmployeeId: a, ...reste('Conseiller spécial') },
      people.suiteDeLaPassation(user),
    );

    expect(await adjointEcrit()).toBeNull();
    expect((await affectations(a)).at(-1)!.poste).toBe('Directrice générale');
    expect((await affectations(dg)).at(-1)!.poste).toBe('Conseiller spécial');
    expect(await n1(a)).toBeNull();
  });

  it('muté hors de la Direction Générale, le DGA laisse sa place vacante : pas de poste à rendre', async () => {
    await leDG();
    const a = await agent('A', uDG, { genre: 'female' });
    const b = await agent('B', uDG, { genre: 'male' });
    await designer(a, { depuis: '2024-06-01' });
    await raw(`UPDATE assignments SET org_unit_id = $2 WHERE employee_id = $1`, [a, uDGT]);

    expect((await sommet()).adjoint).toBeNull();
    await designer(b, { depuis: await jour(0) });
    expect(await adjointEcrit()).toBe(b);
    expect((await affectations(a)).at(-1)!.poste).toBe('Directrice générale adjointe');
  });

  it('l’aperçu dit ce que ferait la désignation, sans l’écrire', async () => {
    await leDG();
    const a = await agent('A', uDG, { genre: 'female' });

    await organigramme.apercu(user, uDG, { adjointEmployeeId: a }, people.suiteDeLaPassation(user));

    expect(await adjointEcrit()).toBeNull();
    expect((await affectations(a)).at(-1)!.poste).toBe('Analyste');
  });
});

describe('depuis une nouvelle affectation (ADR-0127)', () => {
  /** La place de DGA, depuis la fiche de la personne. */
  const commeDGA = async (id: string, plus: Partial<NewAssignmentInput> = {}) =>
    people.newAssignment(user, id, {
      adjoint: true,
      orgUnitId: uDG,
      startDate: await jour(0),
      ...plus,
    });

  it('la personne rejoint la Direction Générale au poste de DGA, sous le DG', async () => {
    const dg = await leDG();
    const x = await agent('X', uDGT, { genre: 'female' });
    const aujourdhui = await jour(0);

    await commeDGA(x);

    expect(await adjointEcrit()).toBe(x);
    expect(await n1(x)).toBe(dg);
    expect((await affectations(x)).at(-1)).toMatchObject({
      poste: 'Directrice générale adjointe',
      unite: uDG,
      responsable: false,
      du: aujourdhui,
      au: null,
    });
    expect((await sommet()).adjoint?.employeeId).toBe(x);
  });

  it('remplace le DGA en place, qui reçoit son poste', async () => {
    const dg = await leDG();
    const a = await agent('A', uDG, { genre: 'female' });
    const b = await agent('B', uDGT, { genre: 'male' });
    await designer(a, { depuis: '2024-06-01' });

    expect(await codeOf(() => commeDGA(b))).toBe('org.poste_de_l_ancien_requis');
    await commeDGA(b, reste('Conseillère'));

    expect(await adjointEcrit()).toBe(b);
    expect(await n1(b)).toBe(dg);
    expect((await affectations(a)).at(-1)!.poste).toBe('Conseillère');
    expect((await affectations(b)).at(-1)!.poste).toBe('Directeur général adjoint');
  });

  it('refusée : hors du sommet, au DG, à une tête d’unité, sans DG', async () => {
    const x = await agent('X', uDG, { genre: 'female' });
    expect(await codeOf(() => commeDGA(x))).toBe('org.aucun_directeur_general');
    expect(await codeOf(() => designer(x))).toBe('org.aucun_directeur_general');

    const dg = await leDG();
    const c = await agent('C', uCellule, { genre: 'male' });
    await organigramme.update(user, uCellule, { managerEmployeeId: c, depuis: '2024-01-01' });
    expect(await codeOf(() => commeDGA(x, { orgUnitId: uDGT }))).toBe('org.adjoint_au_sommet');
    expect(await codeOf(() => commeDGA(dg))).toBe('org.adjoint_est_le_dg');
    expect(await codeOf(() => commeDGA(c))).toBe('people.dirige_deja');
    expect(await adjointEcrit()).toBeNull();
  });

  it('le formulaire : une désignation à la fois, la Direction Générale choisie', () => {
    const base = { startDate: '2026-10-19', orgUnitId: uDG };
    expect(newAssignmentSchema.safeParse({ ...base, adjoint: true }).success).toBe(true);
    expect(
      newAssignmentSchema.safeParse({ ...base, adjoint: true, responsable: true }).success,
    ).toBe(false);
    expect(newAssignmentSchema.safeParse({ startDate: '2026-10-19', adjoint: true }).success).toBe(
      false,
    );
  });
});

describe('les documents', () => {
  it('connaissent qui seconde le DG, et son genre', async () => {
    await leDG();
    const a = await agent('A', uDG, { genre: 'female' });
    const lire = () => db.withTenant({ tenantId, userId }, (tx) => quiSecondeLeSommet(tx));

    expect(await lire()).toBeNull();
    await designer(a, { depuis: '2024-06-01' });
    expect(await lire()).toEqual({ nom: 'A TEST', genre: 'female' });
  });
});
