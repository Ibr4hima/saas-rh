/**
 * Le bulletin de salaire ne se demande plus (ADR-0084). Une demande faite
 * avant, avec ses mois (ADR-0039), se lit toujours avec eux, dans la file de
 * la DCH comme dans le suivi de l'agent, et ses avis les nomment jusqu'au
 * bout du traitement.
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { documentDemande, type SessionUser } from '@teranga/contracts';
import { EncryptionService } from '../src/common/encryption.service';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import { reconcilierUneDemande } from '../src/modules/acces/demandes';
import { DocumentRequestsService } from '../src/modules/docs/document-requests.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';

const env = loadEnv();

const tenantId = randomUUID();
const rhUserId = randomUUID();
const awaUserId = randomUUID();
const dchId = randomUUID();

const rh = {
  userId: rhUserId,
  tenantId,
  role: 'employee',
  givenName: 'Ibrahima',
  familyName: 'Ba',
} as SessionUser;
const awa = { userId: awaUserId, tenantId, role: 'employee' } as SessionUser;

let ownerPool: Pool;
let db: TenantDb;
let service: DocumentRequestsService;
let awaEmployeeId: string;

async function raw(q: string, params: unknown[] = []) {
  return ownerPool.query(q, params as never[]);
}

async function titresDe(userId: string): Promise<string[]> {
  const { rows } = await raw(
    `SELECT title FROM notifications
      WHERE tenant_id = $1 AND recipient_user_id = $2 AND remplacee_le IS NULL
      ORDER BY created_at`,
    [tenantId, userId],
  );
  return rows.map((r) => (r as { title: string }).title);
}

async function vue(user: SessionUser, id: string, scope?: 'mine') {
  const r = (await service.list(user, scope ? { scope } : {})).find((d) => d.id === id);
  if (!r) throw new Error(`demande ${id} introuvable`);
  return r;
}

/** Une demande de bulletin faite avant l'ADR-0084, telle qu'elle est restée en base. */
async function demandeDAvant(mois: {
  du?: string;
  au?: string;
  derniers?: number;
}): Promise<string> {
  const id = randomUUID();
  await raw(
    `INSERT INTO document_requests (id, tenant_id, employee_id, doc_types, requested_by_user_id,
                                    payslip_from, payslip_to, payslip_last_months)
     VALUES ($1,$2,$3,ARRAY['bulletin_salaire'],$4,$5,$6,$7)`,
    [
      id,
      tenantId,
      awaEmployeeId,
      awaUserId,
      mois.du ?? null,
      mois.au ?? null,
      mois.derniers ?? null,
    ],
  );
  // La DCH en avait reçu l'avis à l'époque.
  await db.withTenant({ tenantId, userId: rhUserId }, (tx) =>
    reconcilierUneDemande(tx, 'documents', id),
  );
  return id;
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
  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1,'Bulletins',$2)`, [
    tenantId,
    `bulletins-${tenantId.slice(0, 8)}`,
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
  await raw(`DELETE FROM document_request_files WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM document_requests WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM notifications WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM assignments WHERE tenant_id = $1`, [tenantId]);
  await raw(`UPDATE org_units SET manager_employee_id = NULL WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM employees WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM persons WHERE tenant_id = $1`, [tenantId]);

  const rhEmployeeId = randomUUID();
  awaEmployeeId = randomUUID();
  for (const [employeeId, userId, prenom, nom, matricule] of [
    [awaEmployeeId, awaUserId, 'Awa', 'Diop', 'EMP-001'],
    [rhEmployeeId, rhUserId, 'Ibrahima', 'Ba', 'EMP-003'],
  ] as const) {
    const personId = randomUUID();
    await raw(
      `INSERT INTO persons (id, tenant_id, user_id, given_name, family_name)
       VALUES ($1,$2,$3,$4,$5)`,
      [personId, tenantId, userId, prenom, nom],
    );
    await raw(
      `INSERT INTO employees (id, tenant_id, person_id, employee_number, hired_on, status)
       VALUES ($1,$2,$3,$4,'2020-01-01','active')`,
      [employeeId, tenantId, personId, matricule],
    );
  }
  await raw(
    `INSERT INTO assignments (id, tenant_id, employee_id, org_unit_id, position_title, validity)
     VALUES ($1,$2,$3,$4,'Directeur', daterange('2020-01-01', NULL))`,
    [randomUUID(), tenantId, rhEmployeeId, dchId],
  );
  await raw(`UPDATE org_units SET manager_employee_id = $2 WHERE id = $1`, [dchId, rhEmployeeId]);
});

afterAll(async () => {
  await raw(`UPDATE org_units SET manager_employee_id = NULL WHERE tenant_id = $1`, [tenantId]);
  for (const table of [
    'document_request_files',
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

describe('une demande d’avant', () => {
  it('se relit avec ses mois : un mois, les derniers mois, une période', async () => {
    const cas = [
      { mois: { du: '2025-04-01', au: '2025-04-01' }, lu: 'Bulletin de salaire · avril 2025' },
      { mois: { derniers: 3 }, lu: 'Bulletin de salaire · 3 derniers mois' },
      {
        mois: { du: '2025-08-01', au: '2025-10-01' },
        lu: 'Bulletin de salaire · août à octobre 2025',
      },
    ];
    for (const c of cas) {
      const id = await demandeDAvant(c.mois);
      for (const v of [await vue(awa, id, 'mine'), await vue(rh, id)]) {
        expect(documentDemande('bulletin_salaire', v.bulletin)).toBe(c.lu);
      }
      await raw(`DELETE FROM document_requests WHERE id = $1`, [id]);
    }
  });

  it('se relit sans mois si elle n’en avait pas', async () => {
    const id = await demandeDAvant({});
    expect((await vue(awa, id, 'mine')).bulletin).toBeNull();
  });

  it('ne donne des mois qu’à un bulletin, jusqu’en base', async () => {
    const [id] = (await service.create(awa, { docTypes: ['attestation_travail'] })).ids as [string];
    await expect(
      raw(`UPDATE document_requests SET payslip_last_months = 3 WHERE id = $1`, [id]),
    ).rejects.toThrow(/document_requests_payslip_only/);
  });
});

describe('ses avis nomment les bulletins', () => {
  it('à la DCH, qui l’a reçue', async () => {
    await demandeDAvant({ derniers: 3 });
    expect(await titresDe(rhUserId)).toEqual([
      'Awa Diop demande ses 3 derniers bulletins de salaire',
    ]);
  });

  it('à l’agent, jusqu’au retrait', async () => {
    const id = await demandeDAvant({ du: '2025-04-01', au: '2025-04-01' });
    expect(await titresDe(rhUserId)).toEqual([
      'Awa Diop demande son bulletin de salaire d’avril 2025',
    ]);
    await service.advance(rh, id, { status: 'processing' });
    expect(await titresDe(awaUserId)).toEqual([
      'Votre bulletin de salaire d’avril 2025 est en préparation',
    ]);
    await service.advance(rh, id, { status: 'ready', pickupContact: 'Ibrahima Ba' });
    expect(await titresDe(awaUserId)).toEqual([
      'Votre bulletin de salaire d’avril 2025 est prêt, à retirer auprès de Ibrahima Ba',
    ]);
  });

  it('au pluriel pour une période, jusqu’au refus', async () => {
    const id = await demandeDAvant({ du: '2025-08-01', au: '2025-10-01' });
    expect(await titresDe(rhUserId)).toEqual([
      'Awa Diop demande ses bulletins de salaire d’août à octobre 2025',
    ]);
    await service.advance(rh, id, { status: 'rejected', message: 'Paie d’août en reprise' });
    expect(await titresDe(awaUserId)).toEqual([
      'Votre demande des bulletins de salaire d’août à octobre 2025 a été refusée',
    ]);
  });

  it('déposés en ligne, l’original à retirer s’il est dit', async () => {
    const id = await demandeDAvant({ derniers: 3 });
    await service.deposer(rh, id, {
      filename: 'juillet.pdf',
      contentType: 'application/pdf',
      contentBase64: Buffer.from('%PDF-1.7 juillet').toString('base64'),
    });
    await service.batchAdvance(rh, { ids: [id], status: 'ready', pickupContact: 'Ibrahima Ba' });
    expect(await titresDe(awaUserId)).toEqual([
      'Vos 3 derniers bulletins de salaire sont déposés dans votre espace, l’original à retirer auprès de Ibrahima Ba',
    ]);
  });

  it('à qui la préparait, quand l’agent l’annule', async () => {
    const id = await demandeDAvant({ derniers: 3 });
    await service.advance(rh, id, { status: 'processing' });
    await service.cancel(awa, id);
    expect(await titresDe(rhUserId)).toContain(
      'Awa Diop a annulé sa demande des 3 derniers bulletins de salaire',
    );
  });
});
