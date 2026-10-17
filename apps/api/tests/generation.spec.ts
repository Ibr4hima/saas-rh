/**
 * « Générer des documents » (ADR-0085) : qui dirige la DCH génère, à sa
 * guise, les documents dont le modèle est configuré, pour tout agent sauf
 * soi. Personne d'autre : ni un membre de la DCH à qui ce document est
 * délégué, ni le compte d'administration, ni un agent.
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SessionUser } from '@teranga/contracts';
import { CAPACITES_DELEGABLES } from '@teranga/contracts';
import { ProblemException } from '../src/common/problem';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import { AttestationService } from '../src/modules/documents/attestation.service';
import { GenerationService } from '../src/modules/documents/generation.service';

const env = loadEnv();
const tenantId = randomUUID();
const ids = { dch: randomUUID(), membre: randomUUID(), admin: randomUUID(), agent: randomUUID() };
const employes: Record<'dch' | 'actif' | 'archive', string> = {
  dch: randomUUID(),
  actif: randomUUID(),
  archive: randomUUID(),
};

const session = (userId: string, s: Partial<SessionUser>) =>
  ({ userId, tenantId, role: 'employee', capacites: [], ...s }) as SessionUser;
const dch = session(ids.dch, { dirigeLaDCH: true, capacites: [...CAPACITES_DELEGABLES] });
const membre = session(ids.membre, { capacites: ['demandes.documents.attestation_travail'] });
const admin = session(ids.admin, { role: 'admin' });
const agent = session(ids.agent, {});

let ownerPool: Pool;
let db: TenantDb;
let service: GenerationService;

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

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 2 });
  db = new TenantDb();
  service = new GenerationService(db, new AttestationService(db));

  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1, 'APIX', $2)`, [
    tenantId,
    `gen-${tenantId.slice(0, 8)}`,
  ]);
  for (const [cle, userId] of Object.entries(ids)) {
    await raw(
      `INSERT INTO users (id, email, password_hash, given_name, family_name)
       VALUES ($1, $2, 'x', $3, 'Generation')`,
      [userId, `gen-${cle}-${userId}@test.local`, cle],
    );
  }
  // Le dossier de qui dirige la DCH (relié à son compte), un dossier en
  // activité, un dossier inactif.
  for (const [cle, numero, statut, userId] of [
    ['dch', 'GEN-001', 'active', ids.dch],
    ['actif', 'GEN-002', 'active', null],
    ['archive', 'GEN-003', 'archived', null],
  ] as const) {
    const personId = randomUUID();
    await raw(
      `INSERT INTO persons (id, tenant_id, user_id, given_name, family_name)
       VALUES ($1, $2, $3, 'Agent', $4)`,
      [personId, tenantId, userId, cle],
    );
    await raw(
      `INSERT INTO employees (id, tenant_id, person_id, employee_number, hired_on, status)
       VALUES ($1, $2, $3, $4, '2024-03-01', $5)`,
      [employes[cle], tenantId, personId, numero, statut],
    );
  }
});

afterAll(async () => {
  await raw('DELETE FROM employees WHERE tenant_id = $1', [tenantId]);
  await raw('DELETE FROM persons WHERE tenant_id = $1', [tenantId]);
  await raw('DELETE FROM tenants WHERE id = $1', [tenantId]);
  await raw('DELETE FROM users WHERE id = ANY($1)', [Object.values(ids)]);
  await db?.pool.end();
  await ownerPool?.end();
});

describe('qui génère', () => {
  it('qui dirige la DCH, sans demande, un PDF nommé d’après le matricule', async () => {
    const { filename, pdf } = await service.pdf(dch, 'attestation_travail', employes.actif);
    expect(filename).toBe('attestation-travail-GEN-002.pdf');
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('personne d’autre : ni un membre de la DCH à qui le document est délégué, ni le compte d’administration, ni un agent', async () => {
    for (const s of [membre, admin, agent]) {
      expect(await codeOf(() => service.pdf(s, 'attestation_travail', employes.actif))).toBe(
        'auth.forbidden',
      );
    }
  });

  it('jamais pour soi', async () => {
    expect(await codeOf(() => service.pdf(dch, 'attestation_travail', employes.dch))).toBe(
      'acces.son_propre_dossier',
    );
  });
});

describe('quoi', () => {
  it('un document de la liste dont le modèle reste à configurer est refusé, en le disant', async () => {
    const err = await service.pdf(dch, 'certificat_travail', employes.actif).catch((e) => e);
    expect(err).toBeInstanceOf(ProblemException);
    expect((err as ProblemException).problem).toMatchObject({
      status: 422,
      code: 'documents.modele_a_configurer',
      title: 'Certificat de travail : modèle à configurer',
    });
  });

  it('un document hors de la liste, ou retiré, est inconnu', async () => {
    for (const type of ['bulletin_salaire', 'autre', 'n_importe_quoi']) {
      expect(await codeOf(() => service.pdf(dch, type, employes.actif))).toBe('documents.inconnu');
    }
  });

  it('le modèle garde ses règles : l’attestation de travail, pas pour un dossier inactif', async () => {
    expect(await codeOf(() => service.pdf(dch, 'attestation_travail', employes.archive))).toBe(
      'documents.not_active',
    );
  });
});
