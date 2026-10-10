/**
 * Le bulletin de salaire se demande pour une période : un mois, les N
 * derniers mois, ou de tel mois à tel mois. La période s'écrit à part de la
 * précision libre, se relit telle quelle, et nomme les bulletins dans les
 * avis de la DCH comme dans ceux de l'agent.
 *
 * Elle reste possible : ni un mois à venir, ni un mois d'avant l'arrivée de
 * l'agent, ni plus de derniers bulletins que de mois passés à l'APIX.
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDocumentRequestSchema, type SessionUser } from '@teranga/contracts';
import { ProblemException } from '../src/common/problem';
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
const moussaUserId = randomUUID();
const dchId = randomUUID();

const rh = {
  userId: rhUserId,
  tenantId,
  role: 'employee',
  givenName: 'Ibrahima',
  familyName: 'Ba',
} as SessionUser;
const awa = { userId: awaUserId, tenantId, role: 'employee' } as SessionUser;
const moussa = { userId: moussaUserId, tenantId, role: 'employee' } as SessionUser;

let ownerPool: Pool;
let db: TenantDb;
let service: DocumentRequestsService;

async function raw(q: string, params: unknown[] = []) {
  return ownerPool.query(q, params as never[]);
}

async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'AUCUNE ERREUR';
  } catch (err) {
    if (err instanceof ProblemException) return err.problem.code;
    return `NON-PROBLEM: ${(err as Error).message}`;
  }
}

/** Le mois à `decalage` mois d'aujourd'hui, au calendrier de la base : « 2026-10 ». */
async function mois(decalage: number): Promise<string> {
  const { rows } = await raw(
    `SELECT to_char(CURRENT_DATE + make_interval(months => $1), 'YYYY-MM') AS m`,
    [decalage],
  );
  return (rows[0] as { m: string }).m;
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

async function colonnes(id: string) {
  const { rows } = await raw(
    `SELECT payslip_from::text AS du, payslip_to::text AS au, payslip_last_months AS derniers
       FROM document_requests WHERE id = $1`,
    [id],
  );
  return rows[0] as { du: string | null; au: string | null; derniers: number | null };
}

async function vue(user: SessionUser, id: string) {
  const r = (await service.list(user, { scope: 'mine' })).find((d) => d.id === id);
  if (!r) throw new Error(`demande ${id} introuvable`);
  return r;
}

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 3 });
  db = new TenantDb();
  service = new DocumentRequestsService(db, new NotificationsService(db), new EncryptionService());

  for (const [id, nom] of [
    [rhUserId, 'rh'],
    [awaUserId, 'awa'],
    [moussaUserId, 'moussa'],
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
  for (const userId of [rhUserId, awaUserId, moussaUserId]) {
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
  // Awa est là depuis 2024 ; Moussa est arrivé il y a deux mois.
  const arriveeMoussa = `${await mois(-2)}-01`;
  for (const [employeeId, userId, prenom, nom, matricule, arrivee] of [
    [randomUUID(), awaUserId, 'Awa', 'Diop', 'EMP-001', '2024-01-15'],
    [randomUUID(), moussaUserId, 'Moussa', 'Ndiaye', 'EMP-002', arriveeMoussa],
    [rhEmployeeId, rhUserId, 'Ibrahima', 'Ba', 'EMP-003', '2020-01-01'],
  ] as const) {
    const personId = randomUUID();
    await raw(
      `INSERT INTO persons (id, tenant_id, user_id, given_name, family_name)
       VALUES ($1,$2,$3,$4,$5)`,
      [personId, tenantId, userId, prenom, nom],
    );
    await raw(
      `INSERT INTO employees (id, tenant_id, person_id, employee_number, hired_on, status)
       VALUES ($1,$2,$3,$4,$5,'active')`,
      [employeeId, tenantId, personId, matricule, arrivee],
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
  await raw(`DELETE FROM users WHERE id IN ($1,$2,$3)`, [rhUserId, awaUserId, moussaUserId]);
  await db?.pool.end();
  await ownerPool?.end();
});

describe('la demande', () => {
  it('exige les mois d’un bulletin, et seulement pour lui', () => {
    const refus = (x: unknown) => {
      const r = createDocumentRequestSchema.safeParse(x);
      return r.success ? null : r.error.issues.map((i) => i.message);
    };
    expect(refus({ docTypes: ['bulletin_salaire'] })).toEqual([
      'Précisez les mois du bulletin de salaire',
    ]);
    expect(
      refus({ docTypes: ['attestation_travail'], bulletin: { type: 'mois', mois: '2025-04' } }),
    ).toEqual(['Des mois ne se précisent que pour un bulletin de salaire']);
    const bulletin = (b: unknown) => refus({ docTypes: ['bulletin_salaire'], bulletin: b });
    expect(bulletin({ type: 'mois', mois: '2025-04' })).toBeNull();
    expect(bulletin({ type: 'mois', mois: '2025-13' })).not.toBeNull();
    expect(bulletin({ type: 'derniers', nombre: 3 })).toBeNull();
    expect(bulletin({ type: 'derniers', nombre: 1 })).not.toBeNull();
    expect(bulletin({ type: 'derniers', nombre: 13 })).not.toBeNull();
    expect(bulletin({ type: 'periode', du: '2025-01', au: '2025-12' })).toBeNull();
    expect(bulletin({ type: 'periode', du: '2025-06', au: '2025-06' })).toEqual([
      'Le dernier mois vient après le premier',
    ]);
    expect(bulletin({ type: 'periode', du: '2025-01', au: '2026-01' })).toEqual([
      'Au plus 12 mois par demande',
    ]);
  });

  it('écrit et relit un mois, les derniers mois, une période', async () => {
    const cas = [
      { bulletin: { type: 'mois', mois: '2025-04' }, du: '2025-04-01', au: '2025-04-01', n: null },
      { bulletin: { type: 'derniers', nombre: 3 }, du: null, au: null, n: 3 },
      {
        bulletin: { type: 'periode', du: '2025-08', au: '2025-10' },
        du: '2025-08-01',
        au: '2025-10-01',
        n: null,
      },
    ] as const;
    for (const c of cas) {
      const [id] = (
        await service.create(awa, { docTypes: ['bulletin_salaire'], bulletin: c.bulletin })
      ).ids as [string];
      expect(await colonnes(id)).toEqual({ du: c.du, au: c.au, derniers: c.n });
      expect((await vue(awa, id)).bulletin).toEqual(c.bulletin);
      // Une seule demande de bulletin ouverte à la fois : on retire celle-ci.
      await service.cancel(awa, id);
    }
  });

  it('ne donne ses mois qu’au bulletin, pas aux autres documents demandés avec lui', async () => {
    const { ids } = await service.create(awa, {
      docTypes: ['attestation_travail', 'bulletin_salaire'],
      bulletin: { type: 'derniers', nombre: 6 },
    });
    const [attestation, bulletin] = ids as [string, string];
    expect(await colonnes(attestation)).toEqual({ du: null, au: null, derniers: null });
    expect((await vue(awa, attestation)).bulletin).toBeNull();
    expect((await vue(awa, bulletin)).bulletin).toEqual({ type: 'derniers', nombre: 6 });
  });

  it('relit sans mois un bulletin demandé avant', async () => {
    const [id] = (await service.create(awa, { docTypes: ['bulletin_salaire'] })).ids as [string];
    expect((await vue(awa, id)).bulletin).toBeNull();
  });

  it('refuse des mois à un autre document, jusqu’en base', async () => {
    const [id] = (await service.create(awa, { docTypes: ['attestation_travail'] })).ids as [string];
    await expect(
      raw(`UPDATE document_requests SET payslip_last_months = 3 WHERE id = $1`, [id]),
    ).rejects.toThrow(/document_requests_payslip_only/);
  });
});

describe('des mois possibles', () => {
  it('accepte le mois en cours, refuse un mois à venir', async () => {
    expect(
      await codeOf(() =>
        service.create(awa, {
          docTypes: ['bulletin_salaire'],
          bulletin: { type: 'mois', mois: '2099-01' },
        }),
      ),
    ).toBe('documents.bulletin_a_venir');
    expect(
      await codeOf(async () =>
        service.create(awa, {
          docTypes: ['bulletin_salaire'],
          bulletin: { type: 'periode', du: await mois(-1), au: await mois(1) },
        }),
      ),
    ).toBe('documents.bulletin_a_venir');
    expect(
      await codeOf(async () =>
        service.create(awa, {
          docTypes: ['bulletin_salaire'],
          bulletin: { type: 'mois', mois: await mois(0) },
        }),
      ),
    ).toBe('AUCUNE ERREUR');
  });

  it('refuse un mois d’avant l’arrivée de l’agent', async () => {
    expect(
      await codeOf(async () =>
        service.create(moussa, {
          docTypes: ['bulletin_salaire'],
          bulletin: { type: 'mois', mois: await mois(-3) },
        }),
      ),
    ).toBe('documents.bulletin_avant_arrivee');
    expect(
      await codeOf(async () =>
        service.create(moussa, {
          docTypes: ['bulletin_salaire'],
          bulletin: { type: 'periode', du: await mois(-3), au: await mois(-1) },
        }),
      ),
    ).toBe('documents.bulletin_avant_arrivee');
  });

  it('ne demande pas plus de derniers bulletins que de mois passés à l’APIX', async () => {
    // Arrivé il y a deux mois : trois mois de paie, celui-ci compris.
    expect(
      await codeOf(() =>
        service.create(moussa, {
          docTypes: ['bulletin_salaire'],
          bulletin: { type: 'derniers', nombre: 4 },
        }),
      ),
    ).toBe('documents.bulletins_trop_nombreux');
    expect(
      await codeOf(() =>
        service.create(moussa, {
          docTypes: ['bulletin_salaire'],
          bulletin: { type: 'derniers', nombre: 3 },
        }),
      ),
    ).toBe('AUCUNE ERREUR');
  });
});

describe('les avis nomment les bulletins', () => {
  it('à la DCH, qui reçoit la demande', async () => {
    await service.create(awa, {
      docTypes: ['bulletin_salaire'],
      bulletin: { type: 'derniers', nombre: 3 },
    });
    expect(await titresDe(rhUserId)).toEqual([
      'Awa Diop demande ses 3 derniers bulletins de salaire',
    ]);
  });

  it('à l’agent, d’un mois à l’autre de la demande', async () => {
    const [id] = (
      await service.create(awa, {
        docTypes: ['bulletin_salaire'],
        bulletin: { type: 'mois', mois: '2025-04' },
      })
    ).ids as [string];
    expect(await titresDe(rhUserId)).toEqual([
      'Awa Diop demande son bulletin de salaire d’avril 2025',
    ]);
    await service.advance(rh, id, { status: 'processing' });
    expect(await titresDe(awaUserId)).toEqual([
      'Votre bulletin de salaire d’avril 2025 est en préparation',
    ]);
    await service.advance(rh, id, { status: 'ready', pickupContact: 'Ibrahima Ba' });
    expect(await titresDe(awaUserId)).toEqual([
      'Votre bulletin de salaire d’avril 2025 est prêt, à retirer auprès d’Ibrahima Ba',
    ]);
  });

  it('au pluriel pour une période, jusqu’au refus', async () => {
    const [id] = (
      await service.create(awa, {
        docTypes: ['bulletin_salaire'],
        bulletin: { type: 'periode', du: '2025-08', au: '2025-10' },
      })
    ).ids as [string];
    expect(await titresDe(rhUserId)).toEqual([
      'Awa Diop demande ses bulletins de salaire d’août à octobre 2025',
    ]);
    await service.advance(rh, id, { status: 'rejected', message: 'Paie d’août en reprise' });
    expect(await titresDe(awaUserId)).toEqual([
      'Votre demande des bulletins de salaire d’août à octobre 2025 est refusée',
    ]);
  });

  it('à qui la préparait, quand l’agent l’annule', async () => {
    const [id] = (
      await service.create(awa, {
        docTypes: ['bulletin_salaire'],
        bulletin: { type: 'derniers', nombre: 3 },
      })
    ).ids as [string];
    await service.advance(rh, id, { status: 'processing' });
    await service.cancel(awa, id);
    expect(await titresDe(rhUserId)).toContain(
      'Awa Diop annule sa demande des 3 derniers bulletins de salaire',
    );
  });
});
