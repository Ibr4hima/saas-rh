/**
 * Demandes de correction des informations personnelles.
 *
 * Le point sensible est l'APPLICATION : confirmer écrit dans `persons` à partir
 * d'un jsonb qui a transité par le disque. Rien ne garantit qu'il porte encore
 * la forme attendue, et une recopie naïve des clés serait une affectation de
 * masse — le chemin par lequel un employé écrirait son propre matricule ou son
 * statut. D'où la revalidation et la liste blanche, testées ici.
 */
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '@teranga/contracts';
import { ProblemException } from '../src/common/problem';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import * as t from '../src/db/schema';
import { TenantDb } from '../src/db/tenant-db';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { ProfileChangesService } from '../src/modules/profile/profile-changes.service';

const env = loadEnv();

const tenantId = randomUUID();
const rhUserId = randomUUID();
const agentUserId = randomUUID();
let personId: string;
let employeeId: string;

const rh = { userId: rhUserId, tenantId, role: 'hr' } as SessionUser;
const agent = { userId: agentUserId, tenantId, role: 'employee' } as SessionUser;

let ownerPool: Pool;
let db: TenantDb;
let service: ProfileChangesService;

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

/** Le dossier tel qu'il est en base, après décision. */
async function dossier() {
  const { rows } = await raw(
    `SELECT city, address_line, marital_status, personal_email, given_name, family_name
     FROM persons WHERE id = $1`,
    [personId],
  );
  return rows[0] as Record<string, string | null>;
}

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 3 });
  db = new TenantDb();
  service = new ProfileChangesService(db, new NotificationsService(db));

  for (const [id, mail] of [
    [rhUserId, 'rh'],
    [agentUserId, 'agent'],
  ] as const) {
    await raw(
      `INSERT INTO users (id, email, password_hash, given_name, family_name)
       VALUES ($1,$2,'x','Test',$3)`,
      [id, `${mail}-${id}@test.local`, mail],
    );
  }
  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1,'Profil',$2)`, [
    tenantId,
    `profil-${tenantId.slice(0, 8)}`,
  ]);
  // Le membre RH doit exister comme destinataire du fan-out de notifications.
  await raw(
    `INSERT INTO user_tenant_memberships (id, tenant_id, user_id, role)
     VALUES ($1,$2,$3,'hr')`,
    [randomUUID(), tenantId, rhUserId],
  );
});

beforeEach(async () => {
  await raw(`DELETE FROM profile_change_requests WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM notifications WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM employees WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM persons WHERE tenant_id = $1`, [tenantId]);
  personId = randomUUID();
  employeeId = randomUUID();
  await raw(
    `INSERT INTO persons (id, tenant_id, user_id, given_name, family_name, gender, city)
     VALUES ($1,$2,$3,'Awa','Diop','female','Dakar')`,
    [personId, tenantId, agentUserId],
  );
  await raw(
    `INSERT INTO employees (id, tenant_id, person_id, employee_number, hired_on)
     VALUES ($1,$2,$3,'AG-1','2024-01-01')`,
    [employeeId, tenantId, personId],
  );
});

afterAll(async () => {
  for (const table of [
    'profile_change_requests',
    'notifications',
    'employees',
    'persons',
    'user_tenant_memberships',
  ]) {
    await raw(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  }
  await raw(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  await raw(`DELETE FROM users WHERE id IN ($1,$2)`, [rhUserId, agentUserId]);
  await db?.pool.end();
  await ownerPool?.end();
});

describe('signalement par l’employé', () => {
  it('enregistre les champs modifiés avec leur valeur précédente', async () => {
    await service.create(agent, { changes: { city: 'Thiès' }, note: 'Déménagement' });
    const [vue] = await service.list(rh, {});
    if (!vue) throw new Error('demande absente');
    expect(vue.status).toBe('pending');
    expect(vue.fields).toEqual([
      { field: 'city', label: 'Ville', previous: 'Dakar', next: 'Thiès' },
    ]);
  });

  it('accorde le libellé de situation matrimoniale au sexe', async () => {
    await service.create(agent, { changes: { maritalStatus: 'married' } });
    const [vue] = await service.list(rh, {});
    if (!vue) throw new Error('demande absente');
    expect(vue.fields[0]!.next).toBe('Mariée');
  });

  it('refuse une demande qui ne change rien', async () => {
    expect(await codeOf(() => service.create(agent, { changes: { city: 'Dakar' } }))).toBe(
      'profile.no_change',
    );
  });

  it('refuse une seconde demande tant que la première attend', async () => {
    await service.create(agent, { changes: { city: 'Thiès' } });
    expect(await codeOf(() => service.create(agent, { changes: { city: 'Saint-Louis' } }))).toBe(
      'profile.request_already_pending',
    );
  });

  it('prévient la RH', async () => {
    await service.create(agent, { changes: { city: 'Thiès' } });
    const { rows } = await raw(
      `SELECT title, link FROM notifications WHERE recipient_user_id = $1 AND type = 'profile_change_request'`,
      [rhUserId],
    );
    expect(rows).toHaveLength(1);
    expect((rows[0] as { title: string }).title).toContain('Awa Diop');
  });
});

describe('décision de la RH', () => {
  it('confirmer applique les valeurs au dossier', async () => {
    await service.create(agent, {
      changes: { city: 'Thiès', addressLine: 'Cité Malick Sy', maritalStatus: 'married' },
    });
    const [vue] = await service.list(rh, {});
    if (!vue) throw new Error('demande absente');
    await service.decide(rh, vue.id, { decision: 'approve' });
    expect(await dossier()).toMatchObject({
      city: 'Thiès',
      address_line: 'Cité Malick Sy',
      marital_status: 'married',
    });
  });

  it('refuser laisse le dossier intact et exige un motif', async () => {
    await service.create(agent, { changes: { city: 'Thiès' } });
    const [vue] = await service.list(rh, {});
    if (!vue) throw new Error('demande absente');
    expect(await codeOf(() => service.decide(rh, vue.id, { decision: 'reject' }))).toBe(
      'profile.reject_reason_required',
    );
    await service.decide(rh, vue.id, { decision: 'reject', message: 'Justificatif attendu' });
    expect((await dossier()).city).toBe('Dakar');
  });

  it('refuse de traiter deux fois la même demande', async () => {
    await service.create(agent, { changes: { city: 'Thiès' } });
    const [vue] = await service.list(rh, {});
    if (!vue) throw new Error('demande absente');
    await service.decide(rh, vue.id, { decision: 'approve' });
    expect(await codeOf(() => service.decide(rh, vue.id, { decision: 'approve' }))).toBe(
      'profile.request_already_handled',
    );
  });

  it('prévient l’employé de la décision', async () => {
    await service.create(agent, { changes: { city: 'Thiès' } });
    const [vue] = await service.list(rh, {});
    if (!vue) throw new Error('demande absente');
    await service.decide(rh, vue.id, { decision: 'approve' });
    const { rows } = await raw(
      `SELECT type FROM notifications WHERE recipient_user_id = $1 AND type LIKE 'profile_change_%'`,
      [agentUserId],
    );
    expect(rows).toHaveLength(1);
    expect((rows[0] as { type: string }).type).toBe('profile_change_approve');
  });
});

describe('affectation de masse', () => {
  it('N’ÉCRIT QUE les champs de la liste blanche, même si le jsonb en porte d’autres', async () => {
    await service.create(agent, { changes: { city: 'Thiès' } });
    const [vue] = await service.list(rh, {});
    if (!vue) throw new Error('demande absente');
    // On simule un jsonb corrompu en base : clés hors périmètre injectées
    // directement. Confirmer ne doit toucher NI le nom, NI rien d'autre.
    await raw(
      `UPDATE profile_change_requests
         SET changes = '{"city":"Thiès","familyName":"Pirate","givenName":"Pirate"}'::jsonb
       WHERE id = $1`,
      [vue.id],
    );
    await service.decide(rh, vue.id, { decision: 'approve' });
    const apres = await dossier();
    expect(apres.city).toBe('Thiès');
    expect(apres.family_name).toBe('Diop');
    expect(apres.given_name).toBe('Awa');
  });
});

describe('périmètre de lecture', () => {
  it('scope=mine reste personnel même pour un rôle RH', async () => {
    await service.create(agent, { changes: { city: 'Thiès' } });
    // Le membre RH n'a pas de dossier employé : son espace personnel est vide.
    expect(await service.list(rh, { scope: 'mine' })).toEqual([]);
    expect(await service.list(rh, {})).toHaveLength(1);
  });

  it('un employé ne voit que ses propres demandes et ne peut rien trancher', async () => {
    await service.create(agent, { changes: { city: 'Thiès' } });
    const vues = await service.list(agent, {});
    expect(vues).toHaveLength(1);
    expect(vues[0]!.canDecide).toBe(false);
  });
});
