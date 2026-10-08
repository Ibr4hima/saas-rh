/**
 * La fonction de responsable, écrite dans les affectations (ADR-0033).
 *
 * Désigné à la tête d'une unité, l'agent y prend le poste de responsable à
 * la date où il prend ses fonctions : son affectation est remplacée si elle
 * commence ce jour-là, close la veille sinon. Celui qu'il remplace reçoit
 * son nouveau poste ce même jour. Depuis l'organigramme comme depuis une
 * nouvelle affectation.
 *
 * Le bac d'essai : la Direction Générale (DG) au sommet, la DGT et la DSI
 * dessous, un département Études dans la DGT et son service Comptabilité.
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  newAssignmentSchema,
  posteDeResponsable,
  type CreateEmployeeInput,
  type SessionUser,
} from '@teranga/contracts';
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

/** Le DG, en fonction depuis son arrivée à la Direction Générale. */
async function leDG(): Promise<string> {
  const dg = await agent('DG', uDG, { genre: 'male' });
  await organigramme.update(user, uDG, { managerEmployeeId: dg, depuis: '2024-01-01' });
  return dg;
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

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 3 });
  db = new TenantDb();
  people = new PeopleService(db, new EncryptionService());
  organigramme = new OrgUnitsService(db);
  await raw(
    `INSERT INTO users (id, email, password_hash, given_name, family_name)
     VALUES ($1,$2,'x','Test','Admin')`,
    [userId, `passation-${userId}@test.local`],
  );
  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1,'Passation',$2)`, [
    tenantId,
    `passation-${tenantId.slice(0, 8)}`,
  ]);
});

beforeEach(async () => {
  await vider();
  uDG = await unite('Direction Générale', 'direction', null, 'DG');
  uDGT = await unite('Direction des Grands Travaux', 'direction', uDG, 'DGT');
  uDSI = await unite('Direction des Systèmes', 'direction', uDG, 'DSI');
  uEtudes = await unite('Département Études', 'department', uDGT);
  uCompta = await unite('Service Comptabilité', 'service', uEtudes);
});

afterAll(async () => {
  await vider();
  await raw(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  await raw(`DELETE FROM users WHERE id = $1`, [userId]);
  await db?.pool.end();
  await ownerPool?.end();
});

describe('l’intitulé du poste de responsable', () => {
  const direction = { name: 'Direction des Grands Travaux', unitType: 'direction' as const };
  it('une direction : Directeur ou Directrice de son sigle', () => {
    expect(posteDeResponsable({ ...direction, shortName: 'DGT', sommet: false }, 'male')).toBe(
      'Directeur de la DGT',
    );
    expect(posteDeResponsable({ ...direction, shortName: 'DGT', sommet: false }, 'female')).toBe(
      'Directrice de la DGT',
    );
  });

  it('le sommet : Directeur général, Directrice générale', () => {
    const dg = { name: 'Direction Générale', unitType: 'direction' as const, shortName: 'DG' };
    expect(posteDeResponsable({ ...dg, sommet: true }, 'male')).toBe('Directeur général');
    expect(posteDeResponsable({ ...dg, sommet: true }, 'female')).toBe('Directrice générale');
  });

  it('un département, un service : Chef ou Cheffe, sans répéter le mot', () => {
    expect(
      posteDeResponsable(
        { name: 'Département Études', unitType: 'department', sommet: false },
        'male',
      ),
    ).toBe('Chef du département Études');
    expect(
      posteDeResponsable(
        { name: 'Service Comptabilité', unitType: 'service', sommet: false },
        'female',
      ),
    ).toBe('Cheffe du service Comptabilité');
    expect(posteDeResponsable({ name: 'Paie', unitType: 'service', sommet: false }, 'male')).toBe(
      'Chef du service Paie',
    );
  });

  it('sans genre connu : Responsable', () => {
    expect(posteDeResponsable({ ...direction, shortName: 'DGT', sommet: false }, null)).toBe(
      'Responsable de la DGT',
    );
    expect(
      posteDeResponsable(
        { name: 'Direction Générale', unitType: 'direction', shortName: 'DG', sommet: true },
        null,
      ),
    ).toBe('Responsable de la DG');
    expect(
      posteDeResponsable({ name: 'Service Paie', unitType: 'service', sommet: false }, null),
    ).toBe('Responsable du service Paie');
  });
});

describe('désigner depuis l’organigramme', () => {
  it('le jour où son affectation commence : elle devient celle de responsable', async () => {
    await leDG();
    const x = await agent('X', uDGT, { genre: 'male', depuis: '2024-03-01' });
    await organigramme.update(user, uDGT, { managerEmployeeId: x, depuis: '2024-03-01' });
    expect(await affectations(x)).toEqual([
      { poste: 'Directeur de la DGT', unite: uDGT, responsable: true, du: '2024-03-01', au: null },
    ]);
  });

  it('plus tard : son affectation s’arrête la veille, le poste de responsable suit', async () => {
    await leDG();
    const x = await agent('X', uCompta, { genre: 'female', depuis: '2024-03-01' });
    await organigramme.update(user, uDGT, { managerEmployeeId: x, depuis: '2025-01-15' });
    expect(await affectations(x)).toEqual([
      { poste: 'Analyste', unite: uCompta, responsable: false, du: '2024-03-01', au: '2025-01-15' },
      { poste: 'Directrice de la DGT', unite: uDGT, responsable: true, du: '2025-01-15', au: null },
    ]);
  });

  it('sans date : aujourd’hui', async () => {
    await leDG();
    const x = await agent('X', uDGT, { genre: 'male' });
    await organigramme.update(user, uDGT, { managerEmployeeId: x });
    const lignes = await affectations(x);
    expect(lignes).toHaveLength(2);
    expect(lignes[1]).toMatchObject({ poste: 'Directeur de la DGT', du: await jour() });
  });

  it('ni avant son affectation, ni dans le futur', async () => {
    await leDG();
    const x = await agent('X', uDGT, { depuis: '2024-03-01' });
    expect(
      await codeOf(() =>
        organigramme.update(user, uDGT, { managerEmployeeId: x, depuis: '2024-02-01' }),
      ),
    ).toBe('org.passation_trop_tot');
    expect(
      await codeOf(async () =>
        organigramme.update(user, uDGT, { managerEmployeeId: x, depuis: await jour(1) }),
      ),
    ).toBe('org.passation_future');
    expect(await responsableDe(uDGT)).toBeNull();
    expect(await affectations(x)).toHaveLength(1);
  });

  it('chef de département, cheffe de service', async () => {
    await leDG();
    const chef = await agent('CHEF', uEtudes, { genre: 'male' });
    const cheffe = await agent('CHEFFE', uCompta, { genre: 'female' });
    await organigramme.update(user, uEtudes, { managerEmployeeId: chef, depuis: '2024-01-01' });
    await organigramme.update(user, uCompta, { managerEmployeeId: cheffe, depuis: '2024-01-01' });
    expect((await affectations(chef))[0]!.poste).toBe('Chef du département Études');
    expect((await affectations(cheffe))[0]!.poste).toBe('Cheffe du service Comptabilité');
  });

  it('le directeur général', async () => {
    const dg = await leDG();
    expect(await affectations(dg)).toEqual([
      { poste: 'Directeur général', unite: uDG, responsable: true, du: '2024-01-01', au: null },
    ]);
  });

  it('l’aperçu n’écrit rien', async () => {
    await leDG();
    const x = await agent('X', uDGT, { depuis: '2024-03-01' });
    await organigramme.apercu(user, uDGT, { managerEmployeeId: x, depuis: '2024-06-01' });
    expect(await affectations(x)).toHaveLength(1);
    expect(await responsableDe(uDGT)).toBeNull();
  });

  it('une affectation déjà programmée : on l’annule d’abord', async () => {
    await leDG();
    const x = await agent('X', uDGT);
    await raw(
      `UPDATE assignments SET validity = daterange('2024-01-01', CURRENT_DATE + 30)
        WHERE employee_id = $1`,
      [x],
    );
    await raw(
      `INSERT INTO assignments (id, tenant_id, employee_id, org_unit_id, position_title, validity)
       VALUES ($1,$2,$3,$4,'Ingénieur', daterange(CURRENT_DATE + 30, NULL))`,
      [randomUUID(), tenantId, x, uEtudes],
    );
    expect(await codeOf(() => organigramme.update(user, uDGT, { managerEmployeeId: x }))).toBe(
      'org.responsable_affectation_programmee',
    );
  });
});

describe('celui qu’on remplace reçoit son nouveau poste', () => {
  async function dgtDirigeePar(genre: 'female' | 'male' = 'male'): Promise<string> {
    const z = await agent('Z', uDGT, { genre, depuis: '2024-03-01' });
    await organigramme.update(user, uDGT, { managerEmployeeId: z, depuis: '2024-03-01' });
    return z;
  }

  it('son poste est demandé', async () => {
    await leDG();
    const z = await dgtDirigeePar();
    const x = await agent('X', uDGT, { depuis: '2024-06-01' });
    expect(
      await codeOf(() =>
        organigramme.update(user, uDGT, { managerEmployeeId: x, depuis: '2025-01-01' }),
      ),
    ).toBe('org.poste_de_l_ancien_requis');
    expect(await responsableDe(uDGT)).toBe(z);
  });

  it('il le prend le jour de la passation, dans son unité', async () => {
    await leDG();
    const z = await dgtDirigeePar();
    const x = await agent('X', uDGT, { genre: 'female', depuis: '2024-06-01' });
    await organigramme.update(user, uDGT, {
      managerEmployeeId: x,
      depuis: '2025-01-01',
      posteDeLAncien: 'Conseiller technique',
    });
    expect(await affectations(z)).toEqual([
      {
        poste: 'Directeur de la DGT',
        unite: uDGT,
        responsable: true,
        du: '2024-03-01',
        au: '2025-01-01',
      },
      {
        poste: 'Conseiller technique',
        unite: uDGT,
        responsable: false,
        du: '2025-01-01',
        au: null,
      },
    ]);
    expect((await affectations(x))[1]).toMatchObject({
      poste: 'Directrice de la DGT',
      du: '2025-01-01',
    });
    // L'ancien directeur, resté dans la direction, relève du nouveau.
    expect(await n1(z)).toBe(x);
  });

  it('pas avant le début de son poste à lui', async () => {
    await leDG();
    await dgtDirigeePar();
    const x = await agent('X', uDGT, { depuis: '2024-01-01' });
    expect(
      await codeOf(() =>
        organigramme.update(user, uDGT, {
          managerEmployeeId: x,
          depuis: '2024-02-01',
          posteDeLAncien: 'Conseiller technique',
        }),
      ),
    ).toBe('org.passation_trop_tot');
  });

  it('retiré sans successeur, il reçoit aussi le sien', async () => {
    await leDG();
    const z = await dgtDirigeePar();
    await organigramme.update(user, uDGT, {
      managerEmployeeId: null,
      depuis: '2025-02-01',
      posteDeLAncien: 'Chargé de mission',
    });
    expect((await affectations(z)).map((a) => `${a.poste}:${a.du}`)).toEqual([
      'Directeur de la DGT:2024-03-01',
      'Chargé de mission:2025-02-01',
    ]);
  });

  it('parti, il ne reçoit rien', async () => {
    await leDG();
    const z = await dgtDirigeePar();
    await raw(`UPDATE employees SET status = 'archived' WHERE id = $1`, [z]);
    const x = await agent('X', uDGT);
    await organigramme.update(user, uDGT, { managerEmployeeId: x });
    expect(await affectations(z)).toHaveLength(1);
  });

  it('l’organigramme dit depuis quand chacun occupe son poste', async () => {
    await leDG();
    await dgtDirigeePar();
    await agent('X', uDGT, { depuis: '2024-06-01' });
    const dgt = (await organigramme.list(user)).find((u) => u.id === uDGT)!;
    expect(dgt.managerDepuis).toBe('2024-03-01');
    const candidats = await organigramme.eligibleManagers(user, uDGT);
    expect(candidats.map((c) => `${c.employeeNumber}:${c.depuis}`).sort()).toEqual([
      'X:2024-06-01',
      'Z:2024-03-01',
    ]);
  });
});

describe('une nouvelle affectation à la tête de l’unité', () => {
  const tete = (id: string, plus: Record<string, unknown>, qui: SessionUser = user) =>
    people.newAssignment(qui, id, { responsable: true, ...plus } as never);

  it('il prend le poste de responsable, l’unité le désigne, l’ancien change de poste', async () => {
    const dg = await leDG();
    const z = await agent('Z', uDGT, { genre: 'male', depuis: '2024-03-01' });
    await organigramme.update(user, uDGT, { managerEmployeeId: z, depuis: '2024-03-01' });
    const x = await agent('X', uDSI, { genre: 'female' });

    await tete(x, {
      orgUnitId: uDGT,
      startDate: '2025-05-01',
      positionTitle: 'Ignoré',
      posteDeLAncien: 'Conseiller technique',
    });

    expect(await affectations(x)).toEqual([
      { poste: 'Analyste', unite: uDSI, responsable: false, du: '2024-01-01', au: '2025-05-01' },
      { poste: 'Directrice de la DGT', unite: uDGT, responsable: true, du: '2025-05-01', au: null },
    ]);
    expect(await responsableDe(uDGT)).toBe(x);
    expect(await n1(x)).toBe(dg);
    expect((await affectations(z)).map((a) => `${a.poste}:${a.du}`)).toEqual([
      'Directeur de la DGT:2024-03-01',
      'Conseiller technique:2025-05-01',
    ]);
    expect(await n1(z)).toBe(x);
  });

  it('chef d’un service : le n+1 se pose comme pour toute mutation', async () => {
    await leDG();
    const directeur = await agent('D', uDGT, { genre: 'male' });
    await organigramme.update(user, uDGT, { managerEmployeeId: directeur, depuis: '2024-01-01' });
    const x = await agent('X', uDSI, { genre: 'male' });
    await tete(x, { orgUnitId: uCompta, startDate: '2025-05-01' });
    expect((await affectations(x))[1]).toMatchObject({
      poste: 'Chef du service Comptabilité',
      unite: uCompta,
      responsable: true,
    });
    expect(await responsableDe(uCompta)).toBe(x);
    expect(await n1(x)).toBe(directeur);
  });

  it('au plus tard aujourd’hui', async () => {
    await leDG();
    const x = await agent('X', uDGT);
    expect(await codeOf(async () => tete(x, { orgUnitId: uDGT, startDate: await jour(1) }))).toBe(
      'org.passation_future',
    );
  });

  it('qui dirige déjà une autre unité la confie d’abord', async () => {
    await leDG();
    const x = await agent('X', uEtudes);
    await organigramme.update(user, uEtudes, { managerEmployeeId: x, depuis: '2024-01-01' });
    expect(await codeOf(() => tete(x, { orgUnitId: uDGT, startDate: '2025-05-01' }))).toBe(
      'people.dirige_deja',
    );
  });

  it('désigner relève de l’organigramme', async () => {
    await leDG();
    const x = await agent('X', uDSI);
    const gestionnaire = {
      userId: randomUUID(),
      tenantId,
      role: 'employee',
      capacites: ['personnel.gerer'],
    } as unknown as SessionUser;
    expect(
      await codeOf(() => tete(x, { orgUnitId: uDGT, startDate: '2025-05-01' }, gestionnaire)),
    ).toBe('auth.forbidden');
  });

  it('sans la case, le poste reste à saisir ; avec, l’unité est requise', () => {
    const base = { startDate: '2025-05-01', orgUnitId: randomUUID() };
    expect(newAssignmentSchema.safeParse(base).success).toBe(false);
    expect(newAssignmentSchema.safeParse({ ...base, responsable: true }).success).toBe(true);
    expect(
      newAssignmentSchema.safeParse({ startDate: '2025-05-01', responsable: true }).success,
    ).toBe(false);
  });
});

describe('l’affectation de responsable ne s’annule pas tant qu’il dirige', () => {
  it('refusée, puis permise une fois un autre responsable désigné', async () => {
    await leDG();
    const x = await agent('X', uDGT, { genre: 'male' });
    const y = await agent('Y', uDGT, { genre: 'male' });
    await organigramme.update(user, uDGT, { managerEmployeeId: x, depuis: '2025-01-01' });
    const ligne = async () =>
      (await raw(`SELECT id FROM assignments WHERE employee_id = $1 AND responsable`, [x]))
        .rows[0] as { id: string };
    const { id } = await ligne();
    expect(await codeOf(() => people.annulerAffectation(user, x, id))).toBe(
      'people.affectation_de_responsable',
    );

    // Y prend la tête le même jour : la ligne de X redevient son poste.
    await organigramme.update(user, uDGT, {
      managerEmployeeId: y,
      depuis: '2025-01-01',
      posteDeLAncien: 'Ingénieur',
    });
    expect((await affectations(x)).map((a) => `${a.poste}:${a.responsable}`)).toEqual([
      'Analyste:false',
      'Ingénieur:false',
    ]);
    await people.annulerAffectation(user, x, id);
    expect((await affectations(x)).map((a) => a.poste)).toEqual(['Analyste']);
  });
});
