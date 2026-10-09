/**
 * Une demande de document annulée s'efface ; une demande identique à une
 * ancienne la remplace (ADR-0042).
 *
 * Identique : le même document, les mêmes mois de bulletin. « Les N derniers
 * mois » se comptent du mois de la demande : ils ne sont les mêmes que
 * demandés le même mois. Une demande en cours ne s'efface jamais.
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CreateDocumentRequestInput, SessionUser } from '@teranga/contracts';
import { EncryptionService } from '../src/common/encryption.service';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import { DocumentRequestsService } from '../src/modules/docs/document-requests.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';

const env = loadEnv();

const tenantId = randomUUID();
const rhUserId = randomUUID();
const awaUserId = randomUUID();
const dchId = randomUUID();

const session = (userId: string, givenName: string, familyName: string) =>
  ({ userId, tenantId, role: 'employee', givenName, familyName }) as SessionUser;
const rh = session(rhUserId, 'Ibrahima', 'Ba');
const awa = session(awaUserId, 'Awa', 'Diop');

let ownerPool: Pool;
let db: TenantDb;
let service: DocumentRequestsService;

const PDF = Buffer.from('%PDF-1.7 document remis').toString('base64');

async function raw(q: string, params: unknown[] = []) {
  return ownerPool.query(q, params as never[]);
}

const demander = async (input: CreateDocumentRequestInput) =>
  (await service.create(awa, input)).ids[0] as string;

/** Prête : la demande sort de la file, elle reste au suivi de l'agent. */
const prete = (id: string) => service.batchAdvance(rh, { ids: [id], status: 'ready' });

/** Les demandes d'Awa qui existent encore, parmi celles-ci. */
async function restantes(...ids: string[]): Promise<string[]> {
  const { rows } = await raw(`SELECT id FROM document_requests WHERE id = ANY($1)`, [ids]);
  const la = new Set(rows.map((r) => (r as { id: string }).id));
  return ids.filter((id) => la.has(id));
}

async function avisDe(id: string): Promise<number> {
  const { rows } = await raw(
    `SELECT count(*)::int AS n FROM notifications WHERE dedupe_key LIKE $1`,
    [`document:${id}:%`],
  );
  return (rows[0] as { n: number }).n;
}

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 3 });
  db = new TenantDb();
  service = new DocumentRequestsService(db, new NotificationsService(db), new EncryptionService());

  for (const [id, nom] of [
    [rhUserId, 'rh'],
    [awaUserId, 'awa'],
  ] as const) {
    await raw(
      `INSERT INTO users (id, email, password_hash, given_name, family_name)
       VALUES ($1,$2,'x','Test',$3)`,
      [id, `${nom}-${id}@test.local`, nom],
    );
  }
  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1,'Remplacees',$2)`, [
    tenantId,
    `remplacees-${tenantId.slice(0, 8)}`,
  ]);
  for (const userId of [rhUserId, awaUserId]) {
    await raw(
      `INSERT INTO user_tenant_memberships (id, tenant_id, user_id, role)
       VALUES ($1,$2,$3,'employee')`,
      [randomUUID(), tenantId, userId],
    );
  }
  await raw(
    `INSERT INTO org_units (id, tenant_id, unit_type, name, direction_du_personnel)
     VALUES ($1,$2,'direction','Direction du Capital Humain',true)`,
    [dchId, tenantId],
  );
});

beforeEach(async () => {
  await raw(`DELETE FROM document_requests WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM notifications WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM assignments WHERE tenant_id = $1`, [tenantId]);
  await raw(`UPDATE org_units SET manager_employee_id = NULL WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM employees WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM persons WHERE tenant_id = $1`, [tenantId]);

  const rhEmployeeId = randomUUID();
  for (const [employeeId, userId, prenom, nom, matricule] of [
    [randomUUID(), awaUserId, 'Awa', 'Diop', 'EMP-001'],
    [rhEmployeeId, rhUserId, 'Ibrahima', 'Ba', 'EMP-002'],
  ] as const) {
    const personId = randomUUID();
    await raw(
      `INSERT INTO persons (id, tenant_id, user_id, given_name, family_name)
       VALUES ($1,$2,$3,$4,$5)`,
      [personId, tenantId, userId, prenom, nom],
    );
    await raw(
      `INSERT INTO employees (id, tenant_id, person_id, employee_number, hired_on, status)
       VALUES ($1,$2,$3,$4,'2024-01-01','active')`,
      [employeeId, tenantId, personId, matricule],
    );
  }
  await raw(
    `INSERT INTO assignments (id, tenant_id, employee_id, org_unit_id, position_title, validity)
     VALUES ($1,$2,$3,$4,'Directeur', daterange('2024-01-01', NULL))`,
    [randomUUID(), tenantId, rhEmployeeId, dchId],
  );
  await raw(`UPDATE org_units SET manager_employee_id = $2 WHERE id = $1`, [dchId, rhEmployeeId]);
});

afterAll(async () => {
  await raw(`UPDATE org_units SET manager_employee_id = NULL WHERE tenant_id = $1`, [tenantId]);
  for (const table of [
    'document_requests',
    'notifications',
    'assignments',
    'org_units',
    'employees',
    'persons',
    'user_tenant_memberships',
  ]) {
    await raw(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  }
  await raw(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  await raw(`DELETE FROM users WHERE id IN ($1,$2)`, [rhUserId, awaUserId]);
  await db?.pool.end();
  await ownerPool?.end();
});

describe('une demande annulée', () => {
  it('s’efface, avec ses avis', async () => {
    const id = await demander({ docTypes: ['attestation_travail'] });
    await service.advance(rh, id, { status: 'processing' });
    expect(await avisDe(id)).toBeGreaterThan(0);
    await service.cancel(awa, id);
    expect(await restantes(id)).toEqual([]);
    // Seul reste l'avis à qui la préparait : elle est annulée.
    const { rows } = await raw(`SELECT dedupe_key FROM notifications WHERE dedupe_key LIKE $1`, [
      `document:${id}:%`,
    ]);
    expect(rows).toEqual([{ dedupe_key: `document:${id}:annulee` }]);
    expect((await service.list(awa, { scope: 'mine' })).map((r) => r.id)).toEqual([]);
  });
});

describe('une demande identique', () => {
  it('remplace l’ancienne : elle s’efface avec ses documents remis et ses avis', async () => {
    const ancienne = await demander({ docTypes: ['attestation_travail'] });
    await service.deposer(rh, ancienne, {
      filename: 'attestation.pdf',
      contentType: 'application/pdf',
      contentBase64: PDF,
    });
    await prete(ancienne);
    expect(await avisDe(ancienne)).toBeGreaterThan(0);

    const nouvelle = await demander({ docTypes: ['attestation_travail'] });
    expect(await restantes(ancienne, nouvelle)).toEqual([nouvelle]);
    expect(await avisDe(ancienne)).toBe(0);
    const { rows } = await raw(
      `SELECT count(*)::int AS n FROM document_request_files WHERE request_id = $1`,
      [ancienne],
    );
    expect((rows[0] as { n: number }).n).toBe(0);
  });

  it('refusée, elle s’efface aussi', async () => {
    const refusee = await demander({ docTypes: ['contrat_travail'] });
    await service.advance(rh, refusee, { status: 'rejected', message: 'Déjà remis' });
    const nouvelle = await demander({ docTypes: ['contrat_travail'] });
    expect(await restantes(refusee, nouvelle)).toEqual([nouvelle]);
  });

  it('un autre document ne remplace rien', async () => {
    const attestation = await demander({ docTypes: ['attestation_travail'] });
    await prete(attestation);
    const contrat = await demander({ docTypes: ['contrat_travail'] });
    expect(await restantes(attestation, contrat)).toEqual([attestation, contrat]);
  });

  it('d’autres mois de bulletin ne remplacent rien ; les mêmes, oui', async () => {
    const juilletSeptembre = await demander({
      docTypes: ['bulletin_salaire'],
      bulletin: { type: 'periode', du: '2026-07', au: '2026-09' },
    });
    await prete(juilletSeptembre);
    const juillet = await demander({
      docTypes: ['bulletin_salaire'],
      bulletin: { type: 'mois', mois: '2026-07' },
    });
    await prete(juillet);
    expect(await restantes(juilletSeptembre, juillet)).toEqual([juilletSeptembre, juillet]);

    const encore = await demander({
      docTypes: ['bulletin_salaire'],
      bulletin: { type: 'periode', du: '2026-07', au: '2026-09' },
    });
    expect(await restantes(juilletSeptembre, juillet, encore)).toEqual([juillet, encore]);
  });

  it('« les N derniers mois » : le même nombre, demandé le même mois', async () => {
    const ilYaDeuxMois = await demander({
      docTypes: ['bulletin_salaire'],
      bulletin: { type: 'derniers', nombre: 3 },
    });
    await prete(ilYaDeuxMois);
    // Demandée il y a deux mois : ses trois derniers mois ne sont pas ceux d'aujourd'hui.
    await raw(
      `UPDATE document_requests SET created_at = created_at - interval '2 months' WHERE id = $1`,
      [ilYaDeuxMois],
    );
    const ceMois = await demander({
      docTypes: ['bulletin_salaire'],
      bulletin: { type: 'derniers', nombre: 3 },
    });
    await prete(ceMois);
    expect(await restantes(ilYaDeuxMois, ceMois)).toEqual([ilYaDeuxMois, ceMois]);

    const six = await demander({
      docTypes: ['bulletin_salaire'],
      bulletin: { type: 'derniers', nombre: 6 },
    });
    await prete(six);
    expect(await restantes(ceMois, six)).toEqual([ceMois, six]);

    const memeMois = await demander({
      docTypes: ['bulletin_salaire'],
      bulletin: { type: 'derniers', nombre: 3 },
    });
    expect(await restantes(ilYaDeuxMois, ceMois, six, memeMois)).toEqual([
      ilYaDeuxMois,
      six,
      memeMois,
    ]);
  });
});
