/**
 * Ce que devient l'ancien responsable quand un autre prend sa place
 * (ADR-0038) : il reste dans l'unité à un poste qu'on dit, change
 * d'affectation, prend la tête d'une autre unité, ou quitte l'APIX. Depuis
 * l'organigramme comme depuis une nouvelle affectation, dans la même
 * transaction que la passation.
 *
 * Le bac d'essai : la Direction Générale (DG) au sommet, la DGT et la DSI
 * dessous, un département Études dans la DGT et son service Comptabilité.
 * Z dirige la DGT depuis le 1er mars 2024, X la reprend le 1er janvier 2025,
 * W relève de Z.
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CreateEmployeeInput, SessionUser, UpdateOrgUnitInput } from '@teranga/contracts';
import { EncryptionService } from '../src/common/encryption.service';
import { ProblemException } from '../src/common/problem';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
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
let uDGT: string;
let uDSI: string;
let uEtudes: string;
let uCompta: string;

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

async function agent(
  matricule: string,
  uniteId: string,
  { genre = 'male', depuis = '2024-01-01' }: { genre?: 'female' | 'male'; depuis?: string } = {},
): Promise<string> {
  const input = {
    person: { givenName: matricule, familyName: 'Test', gender: genre },
    employee: { employeeNumber: matricule, hiredOn: '2024-01-01' },
    assignment: { positionTitle: 'Analyste', startDate: depuis, orgUnitId: uniteId },
  } as CreateEmployeeInput;
  return (await people.create(user, input)).id;
}

/** Ses affectations, de la plus ancienne à la plus récente. */
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

async function responsableDe(uniteId: string): Promise<string | null> {
  const { rows } = await raw(`SELECT manager_employee_id AS r FROM org_units WHERE id = $1`, [
    uniteId,
  ]);
  return (rows[0] as { r: string | null }).r;
}

async function dossier(employeeId: string) {
  const { rows } = await raw(
    `SELECT status, inactivite_motif AS motif, fin_activite::text AS fin
       FROM employees WHERE id = $1`,
    [employeeId],
  );
  return rows[0] as { status: string; motif: string | null; fin: string | null };
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
  for (const table of [
    'periodes_inactivite',
    'assignments',
    'contracts',
    'employees',
    'persons',
    'org_units',
  ]) {
    await raw(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  }
  await raw(`DELETE FROM audit_log WHERE tenant_id = $1`, [tenantId]);
}

/** Désigner depuis l'organigramme, comme le fait l'écran. */
const designer = (uniteId: string, input: UpdateOrgUnitInput) =>
  organigramme.update(user, uniteId, input, people.suiteDeLaPassation(user));

let dg: string;
let z: string;
let x: string;
let w: string;

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 3 });
  db = new TenantDb();
  people = new PeopleService(db, new EncryptionService());
  organigramme = new OrgUnitsService(db);
  await raw(
    `INSERT INTO users (id, email, password_hash, given_name, family_name)
     VALUES ($1,$2,'x','Test','Admin')`,
    [userId, `devenir-${userId}@test.local`],
  );
  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1,'Devenir',$2)`, [
    tenantId,
    `devenir-${tenantId.slice(0, 8)}`,
  ]);
});

beforeEach(async () => {
  await vider();
  uDG = await unite('Direction Générale', 'direction', null, 'DG');
  uDGT = await unite('Direction des Grands Travaux', 'direction', uDG, 'DGT');
  uDSI = await unite('Direction des Systèmes', 'direction', uDG, 'DSI');
  uEtudes = await unite('Département Études', 'department', uDGT);
  uCompta = await unite('Service Comptabilité', 'service', uEtudes);
  dg = await agent('DG', uDG);
  await organigramme.update(user, uDG, { managerEmployeeId: dg, depuis: '2024-01-01' });
  z = await agent('Z', uDGT, { depuis: '2024-03-01' });
  await organigramme.update(user, uDGT, { managerEmployeeId: z, depuis: '2024-03-01' });
  x = await agent('X', uDGT, { genre: 'female', depuis: '2024-06-01' });
  w = await agent('W', uDGT, { depuis: '2024-06-01' });
  await raw(`UPDATE employees SET manager_employee_id = $1 WHERE id IN ($2, $3)`, [z, x, w]);
});

afterAll(async () => {
  await vider();
  await raw(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  await raw(`DELETE FROM users WHERE id = $1`, [userId]);
  await db?.pool.end();
  await ownerPool?.end();
});

describe('il reste à l’APIX', () => {
  it('dans son unité, au poste qu’on dit : sous le nouveau', async () => {
    await designer(uDGT, {
      managerEmployeeId: x,
      depuis: '2025-01-01',
      devenirDeLAncien: {
        choix: 'affectation',
        orgUnitId: uDGT,
        positionTitle: 'Conseiller technique',
      },
    });
    expect((await affectations(z)).map((a) => `${a.poste}:${a.du}:${a.au}`)).toEqual([
      'Directeur de la DGT:2024-03-01:2025-01-01',
      'Conseiller technique:2025-01-01:null',
    ]);
    expect(await n1(z)).toBe(x);
    expect(await n1(w)).toBe(x);
  });

  it('dans une autre unité de la direction : le responsable de sa direction le reprend', async () => {
    const r = await designer(uDGT, {
      managerEmployeeId: x,
      depuis: '2025-01-01',
      devenirDeLAncien: {
        choix: 'affectation',
        orgUnitId: uEtudes,
        positionTitle: 'Chargé d’études',
      },
    });
    expect((await affectations(z)).at(-1)).toMatchObject({
      poste: 'Chargé d’études',
      unite: uEtudes,
      responsable: false,
      du: '2025-01-01',
    });
    // Ancien directeur, il relevait du DG : à sa nouvelle place, c'est la
    // nouvelle directrice. Son équipe, elle, est passée à elle aussi.
    expect(await n1(z)).toBe(x);
    expect(await n1(w)).toBe(x);
    const motifs = Object.fromEntries(r.changements.map((c) => [c.nom, c.motif]));
    expect(motifs['Z Test']).toBe('responsable_de_sa_direction');
    expect(motifs['W Test']).toBe('suit_le_directeur');
  });

  it('dans une autre direction : son directeur le reprend, son équipe reste', async () => {
    const y = await agent('Y', uDSI);
    await organigramme.update(user, uDSI, { managerEmployeeId: y, depuis: '2024-01-01' });
    await designer(uDGT, {
      managerEmployeeId: x,
      depuis: '2025-01-01',
      devenirDeLAncien: { choix: 'affectation', orgUnitId: uDSI, positionTitle: 'Conseiller' },
    });
    expect((await affectations(z)).at(-1)).toMatchObject({ unite: uDSI, poste: 'Conseiller' });
    expect(await n1(z)).toBe(y);
    expect(await n1(w)).toBe(x);
  });

  it('à la tête d’une autre direction : celui qu’il y remplace reste, au poste dit', async () => {
    const y = await agent('Y', uDSI, { depuis: '2024-01-01' });
    await organigramme.update(user, uDSI, { managerEmployeeId: y, depuis: '2024-01-01' });
    await designer(uDGT, {
      managerEmployeeId: x,
      depuis: '2025-01-01',
      devenirDeLAncien: {
        choix: 'affectation',
        orgUnitId: uDSI,
        responsable: true,
        posteDeLAncien: 'Chargé de mission',
      },
    });
    expect(await responsableDe(uDGT)).toBe(x);
    expect(await responsableDe(uDSI)).toBe(z);
    expect((await affectations(z)).at(-1)).toMatchObject({
      poste: 'Directeur de la DSI',
      unite: uDSI,
      responsable: true,
      du: '2025-01-01',
    });
    expect((await affectations(y)).at(-1)).toMatchObject({
      poste: 'Chargé de mission',
      unite: uDSI,
      responsable: false,
    });
    expect(await n1(z)).toBe(dg);
    expect(await n1(y)).toBe(z);
    expect(await n1(w)).toBe(x);
  });

  it('à la tête d’un service : il relève de l’unité au-dessus', async () => {
    await designer(uDGT, {
      managerEmployeeId: x,
      depuis: '2025-01-01',
      devenirDeLAncien: { choix: 'affectation', orgUnitId: uCompta, responsable: true },
    });
    expect(await responsableDe(uCompta)).toBe(z);
    expect((await affectations(z)).at(-1)).toMatchObject({
      poste: 'Chef du service Comptabilité',
      unite: uCompta,
    });
    // Le département Études n'a pas de tête : la directrice, au-dessus.
    expect(await n1(z)).toBe(x);
  });

  it('la tête de l’unité qu’il quitte ne se choisit pas', async () => {
    expect(
      await codeOf(() =>
        designer(uDGT, {
          managerEmployeeId: x,
          depuis: '2025-01-01',
          devenirDeLAncien: { choix: 'affectation', orgUnitId: uDGT, responsable: true },
        }),
      ),
    ).toBe('org.devenir_meme_unite');
    expect(await responsableDe(uDGT)).toBe(z);
  });
});

describe('il quitte l’APIX', () => {
  it('son dossier devient inactif, au motif et au dernier jour dits', async () => {
    await designer(uDGT, {
      managerEmployeeId: x,
      depuis: '2025-01-01',
      devenirDeLAncien: { choix: 'depart', motif: 'retraite', le: '2024-12-31' },
    });
    expect(await dossier(z)).toEqual({ status: 'archived', motif: 'retraite', fin: '2024-12-31' });
    expect((await affectations(z)).map((a) => `${a.poste}:${a.au}`)).toEqual([
      'Directeur de la DGT:2025-01-01',
    ]);
    expect(await responsableDe(uDGT)).toBe(x);
    expect(await n1(w)).toBe(x);
  });

  it('ni après la passation, ni avant son poste : rien ne s’écrit', async () => {
    const tenter = (le: string) =>
      codeOf(() =>
        designer(uDGT, {
          managerEmployeeId: x,
          depuis: '2025-01-01',
          devenirDeLAncien: { choix: 'depart', motif: 'demission', le },
        }),
      );
    expect(await tenter('2025-01-02')).toBe('people.depart_apres_la_passation');
    expect(await tenter('2024-02-01')).toBe('people.depart_avant_son_poste');
    expect(await responsableDe(uDGT)).toBe(z);
    expect((await dossier(z)).status).toBe('active');
  });

  it('retiré sans successeur : son équipe remonte à son propre n+1', async () => {
    await designer(uDGT, {
      managerEmployeeId: null,
      depuis: '2025-01-01',
      devenirDeLAncien: { choix: 'depart', motif: 'deces', le: '2024-12-31' },
    });
    expect(await responsableDe(uDGT)).toBeNull();
    expect((await dossier(z)).status).toBe('archived');
    expect(await n1(w)).toBe(dg);
  });

  it('depuis sa fiche aussi : la nouvelle affectation à la tête de l’unité', async () => {
    await people.newAssignment(user, x, {
      responsable: true,
      orgUnitId: uDGT,
      startDate: '2025-01-01',
      devenirDeLAncien: { choix: 'depart', motif: 'licenciement', le: '2024-12-31' },
    } as never);
    expect(await responsableDe(uDGT)).toBe(x);
    expect(await dossier(z)).toMatchObject({ status: 'archived', motif: 'licenciement' });
  });

  it('l’aperçu le dit sans rien écrire', async () => {
    const r = await organigramme.apercu(
      user,
      uDGT,
      {
        managerEmployeeId: x,
        depuis: '2025-01-01',
        devenirDeLAncien: { choix: 'depart', motif: 'retraite', le: '2024-12-31' },
      },
      people.suiteDeLaPassation(user),
    );
    expect(r.changements.map((c) => c.nom)).toContain('W Test');
    expect(await responsableDe(uDGT)).toBe(z);
    expect((await dossier(z)).status).toBe('active');
  });
});
