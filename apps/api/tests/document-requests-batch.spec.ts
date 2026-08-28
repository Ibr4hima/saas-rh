/**
 * Traitement par LOT des demandes de documents.
 *
 * Le point sensible n'est pas la boucle : c'est ce qui se passe quand le lot
 * n'est plus à jour. La RH coche cinq lignes, part chercher le parapheur, et
 * pendant ce temps un collègue en traite une. Valider ne doit ni écraser le
 * travail du collègue, ni abandonner les quatre autres — d'où l'écart nommé
 * plutôt qu'une erreur globale. Le reste vérifie que le circuit de l'ADR-0012
 * est respecté (une demande « reçue » n'atterrit pas « prête » sans avoir été
 * traitée) et que l'employé n'est prévenu QU'UNE fois.
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '@teranga/contracts';
import { ProblemException } from '../src/common/problem';
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

const rh = {
  userId: rhUserId,
  tenantId,
  role: 'hr',
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

/** L'état brut en base, sans repasser par la vue. */
async function enBase(id: string) {
  const { rows } = await raw(
    `SELECT status, pickup_contact, hr_message, processing_at, ready_at
     FROM document_requests WHERE id = $1`,
    [id],
  );
  return rows[0] as Record<string, unknown>;
}

async function avisDe(userId: string): Promise<string[]> {
  const { rows } = await raw(
    `SELECT type FROM notifications WHERE tenant_id = $1 AND recipient_user_id = $2 ORDER BY created_at`,
    [tenantId, userId],
  );
  return rows.map((r) => (r as { type: string }).type);
}

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 3 });
  db = new TenantDb();
  service = new DocumentRequestsService(db, new NotificationsService(db));

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
  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1,'Lot',$2)`, [
    tenantId,
    `lot-${tenantId.slice(0, 8)}`,
  ]);
  await raw(
    `INSERT INTO user_tenant_memberships (id, tenant_id, user_id, role)
     VALUES ($1,$2,$3,'hr')`,
    [randomUUID(), tenantId, rhUserId],
  );
});

let awaEmployeeId: string;
let moussaEmployeeId: string;

beforeEach(async () => {
  await raw(`DELETE FROM document_requests WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM notifications WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM employees WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM persons WHERE tenant_id = $1`, [tenantId]);

  awaEmployeeId = randomUUID();
  moussaEmployeeId = randomUUID();
  for (const [personId, employeeId, userId, prenom, nom, matricule] of [
    [randomUUID(), awaEmployeeId, awaUserId, 'Awa', 'Diop', 'EMP-001'],
    [randomUUID(), moussaEmployeeId, moussaUserId, 'Moussa', 'Ndiaye', 'EMP-002'],
  ] as const) {
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
});

afterAll(async () => {
  for (const table of [
    'document_requests',
    'notifications',
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

describe('validation en lot', () => {
  it('fait passer plusieurs demandes de « reçue » à « prête » en une fois', async () => {
    const { id: a } = await service.create(awa, { docTypes: ['attestation_travail'] });
    const { id: b } = await service.create(moussa, { docTypes: ['contrat_travail'] });

    const res = await service.batchAdvance(rh, {
      ids: [a, b],
      status: 'ready',
      pickupContact: 'Mme Fatou Sall',
      message: 'bureau 204',
    });

    expect(res).toEqual({ advanced: 2, skipped: [] });
    for (const id of [a, b]) {
      const row = await enBase(id);
      expect(row.status).toBe('ready');
      expect(row.pickup_contact).toBe('Mme Fatou Sall');
      expect(row.hr_message).toBe('bureau 204');
      expect(row.ready_at).not.toBeNull();
    }
  });

  it('horodate le passage en traitement même quand la demande saute l’étape', async () => {
    // Le circuit de l'ADR-0012 reste vrai : une demande validée d'un coup a
    // bien été traitée, et la durée de traitement garde une borne de départ.
    const { id } = await service.create(awa, { docTypes: ['attestation_travail'] });
    await service.batchAdvance(rh, { ids: [id], status: 'ready' });
    const row = await enBase(id);
    expect(row.processing_at).not.toBeNull();
  });

  it('ne prévient l’employé qu’une seule fois', async () => {
    const { id } = await service.create(awa, { docTypes: ['attestation_travail'] });
    await service.batchAdvance(rh, { ids: [id], status: 'ready' });
    // Deux avis dans la même seconde — « en traitement » puis « disponibles » —
    // n'informeraient de rien : seul l'avis final part.
    expect(await avisDe(awaUserId)).toEqual(['document_request_ready']);
  });

  it('reprend le nom du valideur quand aucun point de retrait n’est précisé', async () => {
    const { id } = await service.create(awa, { docTypes: ['attestation_travail'] });
    await service.batchAdvance(rh, { ids: [id], status: 'ready' });
    expect((await enBase(id)).pickup_contact).toBe('Ibrahima Ba');
  });

  it('accepte une demande déjà prise en traitement', async () => {
    const { id } = await service.create(awa, { docTypes: ['attestation_travail'] });
    await service.advance(rh, id, { status: 'processing' });
    const res = await service.batchAdvance(rh, { ids: [id], status: 'ready' });
    expect(res.advanced).toBe(1);
  });
});

describe('lot qui n’est plus à jour', () => {
  it('écarte la demande déjà traitée et laisse partir les autres', async () => {
    const { id: a } = await service.create(awa, { docTypes: ['attestation_travail'] });
    const { id: b } = await service.create(moussa, { docTypes: ['contrat_travail'] });
    // Un collègue clôt la première pendant que l'écran est ouvert.
    await service.advance(rh, a, { status: 'processing' });
    await service.advance(rh, a, { status: 'ready' });

    const res = await service.batchAdvance(rh, { ids: [a, b], status: 'ready' });

    expect(res.advanced).toBe(1);
    expect(res.skipped).toEqual([
      { id: a, employeeName: 'Awa Diop', reason: 'Déjà « Prête à retirer »' },
    ]);
    expect((await enBase(b)).status).toBe('ready');
  });

  it('n’écrase pas le point de retrait posé par le collègue', async () => {
    const { id } = await service.create(awa, { docTypes: ['attestation_travail'] });
    await service.advance(rh, id, { status: 'processing' });
    await service.advance(rh, id, { status: 'ready', pickupContact: 'M. Sow' });
    await service.batchAdvance(rh, { ids: [id], status: 'ready', pickupContact: 'Mme Fall' });
    expect((await enBase(id)).pickup_contact).toBe('M. Sow');
  });

  it('écarte un identifiant inconnu sans faire échouer le lot', async () => {
    const { id } = await service.create(awa, { docTypes: ['attestation_travail'] });
    const fantome = randomUUID();
    const res = await service.batchAdvance(rh, { ids: [fantome, id], status: 'ready' });
    expect(res.advanced).toBe(1);
    expect(res.skipped).toEqual([{ id: fantome, employeeName: '', reason: 'Demande introuvable' }]);
  });
});

describe('refus en lot', () => {
  it('exige un motif', async () => {
    const { id } = await service.create(awa, { docTypes: ['bulletin_salaire'] });
    expect(await codeOf(() => service.batchAdvance(rh, { ids: [id], status: 'rejected' }))).toBe(
      'documents.reject_reason_required',
    );
    // Rien ne doit avoir bougé : le lot est refusé en bloc, avant toute écriture.
    expect((await enBase(id)).status).toBe('received');
  });

  it('enregistre le motif et le transmet à chaque employé', async () => {
    const { id: a } = await service.create(awa, { docTypes: ['bulletin_salaire'] });
    const { id: b } = await service.create(moussa, { docTypes: ['bulletin_salaire'] });
    const res = await service.batchAdvance(rh, {
      ids: [a, b],
      status: 'rejected',
      message: 'Le bulletin est délivré par le service paie.',
    });
    expect(res.advanced).toBe(2);
    expect((await enBase(a)).hr_message).toBe('Le bulletin est délivré par le service paie.');
    expect(await avisDe(awaUserId)).toEqual(['document_request_rejected']);
    expect(await avisDe(moussaUserId)).toEqual(['document_request_rejected']);
  });
});

describe('durée de traitement', () => {
  it('date la clôture d’une demande validée', async () => {
    const { id } = await service.create(awa, { docTypes: ['attestation_travail'] });
    await service.batchAdvance(rh, { ids: [id], status: 'ready' });
    const [vue] = await service.list(rh, {});
    expect(vue?.handledAt).not.toBeNull();
  });

  it('date la clôture d’une demande refusée', async () => {
    // Le refus n'a pas de colonne d'horodatage : c'est `updated_at` qui fait
    // foi, et rien ne suit un refus, donc il ne dérive pas.
    const { id } = await service.create(awa, { docTypes: ['bulletin_salaire'] });
    await service.batchAdvance(rh, { ids: [id], status: 'rejected', message: 'Hors périmètre.' });
    const [vue] = await service.list(rh, {});
    expect(vue?.status).toBe('rejected');
    expect(vue?.handledAt).not.toBeNull();
  });

  it('laisse la demande ouverte sans date de clôture', async () => {
    await service.create(awa, { docTypes: ['attestation_travail'] });
    const [vue] = await service.list(rh, {});
    expect(vue?.handledAt).toBeNull();
  });

  it('ne rajeunit pas une demande dont on corrige le point de retrait', async () => {
    const { id } = await service.create(awa, { docTypes: ['attestation_travail'] });
    await service.batchAdvance(rh, { ids: [id], status: 'ready' });
    const [avant] = await service.list(rh, {});
    await service.advance(rh, id, { status: 'ready', pickupContact: 'M. Diallo' });
    const [apres] = await service.list(rh, {});
    expect(apres?.handledAt).toBe(avant?.handledAt);
  });
});
