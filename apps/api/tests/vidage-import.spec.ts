/**
 * « Vider l'import » (ADR-0165) : l'administrateur efface ce que l'import a
 * créé, les dossiers avec tout ce qui s'y rattache et les unités, pour
 * recommencer. Ce qui a été saisi à la main reste, et une unité qu'un dossier
 * saisi à la main occupe reste avec lui.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SessionUser } from '@teranga/contracts';
import { EncryptionService } from '../src/common/encryption.service';
import { ProblemException } from '../src/common/problem';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import { ImportEmployesService } from '../src/modules/people/import.service';
import { PeopleService } from '../src/modules/people/people.service';
import { classeur } from './fabrique-xlsx';

const env = loadEnv();
const tenantId = randomUUID();
const adminId = randomUUID();
const autreAdminId = randomUUID();
const agentId = randomUUID();
const admin = { userId: adminId, tenantId, role: 'admin' } as SessionUser;

let pool: Pool;
let db: TenantDb;
let people: PeopleService;
let imports: ImportEmployesService;
const raw = (q: string, p: unknown[] = []) => pool.query(q, p as never[]);
const nombre = async (q: string, p: unknown[] = [tenantId]) =>
  ((await raw(q, p)).rows[0] as { n: number }).n;

const COLONNES = [
  'Matricule',
  'Prénom',
  'Nom',
  'Sexe',
  'Poste occupé',
  'Direction',
  'Type de contrat',
  "Date d'entrée",
  'Salaire de base',
];
const LIGNES = [
  ['1', 'CHEIKH', 'MBAYE', 'M', 'DIRECTEUR GENERAL', 'DG', 'CDI', '01/01/2015', '1500000'],
  ['2', 'AWA', 'DIOP', 'F', 'CHEF DU SERVICE PAIE', 'DCH', 'CDI', '01/03/2020', '900000'],
  ['3', 'MOUSSA', 'FALL', 'M', "CHARGE D'ETUDES", 'DCH', 'CDI', '01/06/2021', '450000'],
  ['4', 'FATOU', 'SARR', 'F', 'CHEF DU SERVICE FORMATION', 'DCH', 'CDI', '01/09/2019', '800000'],
];
const fichier = (lignes: string[][]) => {
  const rang = (v: string[], r: number) =>
    `<row r="${r}">${v.map((x, i) => `<c r="${'ABCDEFGHI'[i]}${r}" t="inlineStr"><is><t>${x}</t></is></c>`).join('')}</row>`;
  return classeur(
    `<sheetData>${[COLONNES, ...lignes].map((l, i) => rang(l, i + 1)).join('')}</sheetData>`,
  );
};

const unite = async (nom: string) =>
  (
    await raw(
      `SELECT id, cree_par_l_import, deleted_at FROM org_units WHERE tenant_id = $1 AND name = $2`,
      [tenantId, nom],
    )
  ).rows[0] as { id: string; cree_par_l_import: boolean; deleted_at: Date | null };

let saisieId = '';

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  pool = new Pool({ connectionString: env.DATABASE_URL, max: 2 });
  db = new TenantDb();
  const crypto = new EncryptionService();
  people = new PeopleService(db, crypto);
  imports = new ImportEmployesService(db, people, crypto);

  await raw(
    `INSERT INTO users (id, email, password_hash, given_name, family_name)
     VALUES ($1,$2,'x','Admin','Test'), ($3,$4,'x','Autre','Admin'), ($5,$6,'x','Agent','Test')`,
    [
      adminId,
      `admin-${adminId}@test.local`,
      autreAdminId,
      `autre-${autreAdminId}@test.local`,
      agentId,
      `agent-${agentId}@test.local`,
    ],
  );
  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1,'Vidage de l’import',$2)`, [
    tenantId,
    `vidage-import-${tenantId.slice(0, 8)}`,
  ]);
  await raw(
    `INSERT INTO user_tenant_memberships (id, tenant_id, user_id, role)
     VALUES ($1,$4,$5,'admin'), ($2,$4,$6,'admin'), ($3,$4,$7,'employee')`,
    [randomUUID(), randomUUID(), randomUUID(), tenantId, adminId, autreAdminId, agentId],
  );
  const dg = randomUUID();
  await raw(
    `INSERT INTO org_units (id, tenant_id, unit_type, name, short_name, parent_id, created_at)
     VALUES ($1,$3,'direction','Direction Générale','DG',NULL, now() - interval '1 day'),
            ($2,$3,'direction','Direction du Capital Humain','DCH',$1, now())`,
    [dg, randomUUID(), tenantId],
  );

  const r = await imports.importer(admin, fichier(LIGNES), true);
  expect(r).toMatchObject({ aCreer: 4, erreurs: 0 });
  // Deux comptes reliés à des dossiers importés : un agent, un administrateur.
  await raw(`UPDATE persons SET user_id = $1 WHERE tenant_id = $2 AND given_name = 'Moussa'`, [
    agentId,
    tenantId,
  ]);
  await raw(`UPDATE persons SET user_id = $1 WHERE tenant_id = $2 AND given_name = 'Fatou'`, [
    autreAdminId,
    tenantId,
  ]);

  // Un dossier saisi à la main, dans une unité que l'import a créée, sous un
  // N+1 importé.
  const formation = await unite('Service Formation');
  const awa = (
    await raw(
      `SELECT e.id FROM employees e JOIN persons p ON p.id = e.person_id
        WHERE e.tenant_id = $1 AND p.given_name = 'Awa'`,
      [tenantId],
    )
  ).rows[0] as { id: string };
  const saisi = await people.create(admin, {
    person: { givenName: 'Khady', familyName: 'Ba' },
    employee: { employeeNumber: 'M-1', hiredOn: '2022-01-03', managerEmployeeId: awa.id },
    contract: { contractType: 'cdi', startDate: '2022-01-03' },
    assignment: {
      positionTitle: 'Chargée de formation',
      orgUnitId: formation.id,
      startDate: '2022-01-03',
    },
  });
  saisieId = saisi.id;
});

afterAll(async () => {
  await raw(
    `UPDATE org_units SET manager_employee_id = NULL, adjoint_employee_id = NULL WHERE tenant_id = $1`,
    [tenantId],
  );
  await raw(`UPDATE employees SET manager_employee_id = NULL WHERE tenant_id = $1`, [tenantId]);
  for (const table of [
    'assignments',
    'contracts',
    'remunerations',
    'invitations',
    'notifications',
    'employees',
    'persons',
    'org_units',
    'user_tenant_memberships',
  ]) {
    await raw(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  }
  await raw(`DELETE FROM audit_log WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  await raw(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[adminId, autreAdminId, agentId]]);
  await db.pool.end();
  await pool.end();
});

describe('vider l’import', () => {
  it('marque ce que l’import crée, et pas ce qui se saisit à la main', async () => {
    expect(
      await nombre(
        `SELECT count(*)::int AS n FROM employees WHERE tenant_id = $1 AND cree_par_l_import`,
      ),
    ).toBe(4);
    expect(
      await nombre(`SELECT count(*)::int AS n FROM employees WHERE id = $1 AND cree_par_l_import`, [
        saisieId,
      ]),
    ).toBe(0);
    expect((await unite('Service Paie')).cree_par_l_import).toBe(true);
    expect((await unite('Service Formation')).cree_par_l_import).toBe(true);
    expect((await unite('Direction du Capital Humain')).cree_par_l_import).toBe(false);
  });

  it('est réservé à l’administrateur', async () => {
    const gestion = { ...admin, role: 'employee', capacites: ['personnel.gerer'] } as SessionUser;
    const refus = await imports.vider(gestion, false).catch((e: unknown) => e);
    expect(refus).toBeInstanceOf(ProblemException);
    expect((refus as ProblemException).getStatus()).toBe(403);
  });

  it('à blanc, dit ce qui partirait et ne touche à rien', async () => {
    expect(await imports.vider(admin, false)).toEqual({
      dossiers: 4,
      comptes: 1,
      unites: 2,
      unitesGardees: 1,
    });
    expect(await nombre(`SELECT count(*)::int AS n FROM employees WHERE tenant_id = $1`)).toBe(5);
  });

  it('efface les dossiers importés et leurs unités, et garde ce qui a été saisi à la main', async () => {
    await imports.vider(admin, true);

    // Les dossiers importés, et ce qui s'y rattachait.
    expect(await nombre(`SELECT count(*)::int AS n FROM employees WHERE tenant_id = $1`)).toBe(1);
    for (const table of ['contracts', 'assignments', 'persons']) {
      expect(await nombre(`SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1`)).toBe(1);
    }
    expect(await nombre(`SELECT count(*)::int AS n FROM remunerations WHERE tenant_id = $1`)).toBe(
      0,
    );

    // L'unité vide part ; celle qu'occupe le dossier saisi à la main reste.
    expect((await unite('Service Paie')).deleted_at).not.toBeNull();
    expect((await unite('Service Formation')).deleted_at).toBeNull();
    expect((await unite('Direction du Capital Humain')).deleted_at).toBeNull();

    // Le dossier saisi à la main perd son N+1 importé, et garde son unité.
    const saisi = (
      await raw(
        `SELECT e.manager_employee_id, a.org_unit_id FROM employees e
           JOIN assignments a ON a.employee_id = e.id WHERE e.id = $1`,
        [saisieId],
      )
    ).rows[0] as { manager_employee_id: string | null; org_unit_id: string };
    expect(saisi.org_unit_id).toBe((await unite('Service Formation')).id);
    expect(saisi.manager_employee_id).toBeNull();

    // Le compte de l'agent se ferme ; celui de l'administrateur reste.
    const comptes = (
      await raw(`SELECT id, email FROM users WHERE id = ANY($1::uuid[]) ORDER BY email`, [
        [agentId, autreAdminId],
      ])
    ).rows as { id: string; email: string }[];
    expect(comptes.find((c) => c.id === agentId)?.email).toBe(
      `supprime+${agentId}@compte.invalide`,
    );
    expect(comptes.find((c) => c.id === autreAdminId)?.email).toBe(
      `autre-${autreAdminId}@test.local`,
    );
    expect(
      await nombre(`SELECT count(*)::int AS n FROM user_tenant_memberships WHERE tenant_id = $1`),
    ).toBe(2);

    // Le même fichier se réimporte comme la première fois.
    expect(await imports.importer(admin, fichier(LIGNES), false)).toMatchObject({
      aCreer: 4,
      erreurs: 0,
    });
  });
});

describe('la migration 0127', () => {
  it('marque les imports faits avant elle : les dossiers nés ensemble, et leurs unités', async () => {
    const sql = readFileSync(join(__dirname, '../src/db/sql/0127_cree_par_l_import.sql'), 'utf8');
    const rattrapage = sql
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.startsWith('UPDATE'));
    expect(rattrapage).toHaveLength(2);

    // Un import d'avant la marque : deux dossiers et une unité nés à la même
    // heure. Un dossier saisi à la main, seul dans sa transaction.
    const ne = '2026-10-01T10:00:00Z';
    const dch = (await unite('Direction du Capital Humain')).id;
    const uniteAncienne = randomUUID();
    await raw(
      `INSERT INTO org_units (id, tenant_id, unit_type, name, parent_id, created_at)
       VALUES ($1,$2,'service','Service Ancien',$3,$4)`,
      [uniteAncienne, tenantId, dch, ne],
    );
    const ids: string[] = [];
    for (const [matricule, heure] of [
      ['A-1', ne],
      ['A-2', ne],
      ['A-3', '2026-10-02T09:00:00Z'],
    ] as const) {
      const personne = randomUUID();
      const id = randomUUID();
      ids.push(id);
      await raw(
        `INSERT INTO persons (id, tenant_id, given_name, family_name) VALUES ($1,$2,'Ancien',$3)`,
        [personne, tenantId, matricule],
      );
      await raw(
        `INSERT INTO employees (id, tenant_id, person_id, employee_number, hired_on, created_at)
         VALUES ($1,$2,$3,$4,'2020-01-01',$5)`,
        [id, tenantId, personne, matricule, heure],
      );
    }
    for (const q of rattrapage) await raw(q);

    const marques = (
      await raw(
        `SELECT employee_number, cree_par_l_import FROM employees
          WHERE id = ANY($1::uuid[]) ORDER BY employee_number`,
        [ids],
      )
    ).rows;
    expect(marques).toEqual([
      { employee_number: 'A-1', cree_par_l_import: true },
      { employee_number: 'A-2', cree_par_l_import: true },
      { employee_number: 'A-3', cree_par_l_import: false },
    ]);
    expect((await unite('Service Ancien')).cree_par_l_import).toBe(true);
  });
});
