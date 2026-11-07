/**
 * Vider le personnel d'une organisation avant l'import du vrai fichier
 * (ADR-0159) : à blanc rien ne bouge ; confirmé, les agents et ce qui leur
 * est rattaché s'en vont, l'organisation, son administration et son
 * organigramme restent, et l'organisation voisine n'est pas touchée.
 */
import { randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SessionUser } from '@teranga/contracts';
import { EncryptionService } from '../src/common/encryption.service';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import { viderLePersonnel } from '../src/db/vider-le-personnel';
import { ImportEmployesService } from '../src/modules/people/import.service';
import { PeopleService } from '../src/modules/people/people.service';
import { classeur } from './fabrique-xlsx';

const env = loadEnv();
const tenantId = randomUUID();
const voisinId = randomUUID();
const adminId = randomUUID();
const agentUserId = randomUUID();
const admin = { userId: adminId, tenantId, role: 'admin' } as SessionUser;

let pool: Pool;
let db: TenantDb;
let client: Client;
const raw = (q: string, p: unknown[] = []) => pool.query(q, p as never[]);
const compte = async (table: string, tenant = tenantId) =>
  (
    (await raw(`SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1`, [tenant]))
      .rows[0] as {
      n: number;
    }
  ).n;

const COLONNES = [
  'Matricule',
  'Prénom',
  'Nom',
  'Sexe',
  'Poste occupé',
  'Direction',
  'Type de contrat',
  "Date d'entrée",
];
const fichier = (lignes: string[][]) => {
  const rang = (v: string[], r: number) =>
    `<row r="${r}">${v.map((x, i) => `<c r="${'ABCDEFGH'[i]}${r}" t="inlineStr"><is><t>${x}</t></is></c>`).join('')}</row>`;
  return classeur(
    `<sheetData>${[COLONNES, ...lignes].map((l, i) => rang(l, i + 1)).join('')}</sheetData>`,
  );
};

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  pool = new Pool({ connectionString: env.DATABASE_URL, max: 2 });
  client = new Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  db = new TenantDb();
  const crypto = new EncryptionService();
  const imports = new ImportEmployesService(db, new PeopleService(db, crypto), crypto);

  await raw(
    `INSERT INTO users (id, email, password_hash, given_name, family_name)
     VALUES ($1,$2,'x','Admin','Test'), ($3,$4,'x','Agent','Test')`,
    [adminId, `admin-${adminId}@test.local`, agentUserId, `agent-${agentUserId}@test.local`],
  );
  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1,'Vidage',$2), ($3,'Voisine',$4)`, [
    tenantId,
    `vidage-${tenantId.slice(0, 8)}`,
    voisinId,
    `voisine-${voisinId.slice(0, 8)}`,
  ]);
  await raw(
    `INSERT INTO user_tenant_memberships (id, tenant_id, user_id, role)
     VALUES ($1,$3,$4,'admin'), ($2,$3,$5,'employee')`,
    [randomUUID(), randomUUID(), tenantId, adminId, agentUserId],
  );
  const dg = randomUUID();
  await raw(
    `INSERT INTO org_units (id, tenant_id, unit_type, name, short_name, parent_id)
     VALUES ($1,$3,'direction','Direction Générale','DG',NULL),
            ($2,$3,'direction','Direction du Capital Humain','DCH',$1)`,
    [dg, randomUUID(), tenantId],
  );
  await imports.importer(
    admin,
    fichier([
      ['1', 'CHEIKH', 'MBAYE', 'M', 'DIRECTEUR GENERAL', 'DG', 'CDI', '01/01/2015'],
      ['2', 'AWA', 'DIOP', 'F', "CHARGEE D'ETUDES", 'DCH', 'CDI', '01/03/2020'],
    ]),
    true,
  );
  // Le compte de l'agent, relié à son dossier.
  await raw(`UPDATE persons SET user_id = $1 WHERE tenant_id = $2 AND given_name = 'Awa'`, [
    agentUserId,
    tenantId,
  ]);
  // L'organisation voisine a son propre agent.
  const personne = randomUUID();
  await raw(
    `INSERT INTO persons (id, tenant_id, given_name, family_name) VALUES ($1,$2,'Voisin','Test')`,
    [personne, voisinId],
  );
  await raw(
    `INSERT INTO employees (id, tenant_id, person_id, employee_number, hired_on)
     VALUES ($1,$2,$3,'V-1','2020-01-01')`,
    [randomUUID(), voisinId, personne],
  );
});

afterAll(async () => {
  for (const t of [tenantId, voisinId]) {
    await raw(`UPDATE org_units SET manager_employee_id = NULL WHERE tenant_id = $1`, [t]);
    for (const table of [
      'assignments',
      'contracts',
      'employees',
      'persons',
      'org_units',
      'user_tenant_memberships',
    ]) {
      await raw(`DELETE FROM ${table} WHERE tenant_id = $1`, [t]);
    }
    await raw(`DELETE FROM audit_log WHERE tenant_id = $1`, [t]);
    await raw(`DELETE FROM tenants WHERE id = $1`, [t]);
  }
  await raw(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[adminId, agentUserId]]);
  await client.end();
  await db.pool.end();
  await pool.end();
});

describe('vider le personnel', () => {
  it('à blanc, dit ce qui partirait et ne touche à rien', async () => {
    const bilan = await viderLePersonnel(client, tenantId, { appliquer: false });
    expect(bilan.applique).toBe(false);
    expect(bilan.effaces).toContainEqual({ libelle: 'dossiers du personnel', nombre: 2 });
    expect(bilan.effaces).toContainEqual({ libelle: 'responsables retirés des unités', nombre: 1 });
    expect(bilan.comptesSupprimes).toEqual([`agent-${agentUserId}@test.local`]);
    expect(bilan.comptesGardes).toEqual([`admin-${adminId}@test.local`]);
    expect(await compte('employees')).toBe(2);
  });

  it('confirmé, efface les agents et ce qui leur est rattaché, et garde le reste', async () => {
    const bilan = await viderLePersonnel(client, tenantId, { appliquer: true });
    expect(bilan.applique).toBe(true);
    for (const table of ['employees', 'persons', 'assignments', 'contracts']) {
      expect(await compte(table)).toBe(0);
    }
    expect(await compte('org_units')).toBe(2);
    const tetes = await raw(
      `SELECT count(*)::int AS n FROM org_units WHERE tenant_id = $1 AND manager_employee_id IS NOT NULL`,
      [tenantId],
    );
    expect((tetes.rows[0] as { n: number }).n).toBe(0);
    const comptes = await raw(`SELECT id FROM users WHERE id = ANY($1::uuid[])`, [
      [adminId, agentUserId],
    ]);
    expect(comptes.rows).toEqual([{ id: adminId }]);
    expect(await compte('user_tenant_memberships')).toBe(1);
    // L'organisation voisine garde son agent.
    expect(await compte('employees', voisinId)).toBe(1);
  });
});
