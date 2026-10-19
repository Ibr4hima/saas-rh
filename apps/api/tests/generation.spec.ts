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
import { CAPACITES_DELEGABLES, estGenere, requestableDocSchema } from '@teranga/contracts';
import { ProblemException } from '../src/common/problem';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import { AttestationService } from '../src/modules/documents/attestation.service';
import { GenerationService } from '../src/modules/documents/generation.service';
import { AbsencesService } from '../src/modules/time/absences.service';

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
  service = new GenerationService(db, new AttestationService(db), new AbsencesService(db));

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
  // activité, à l'âge de la retraite, un dossier inactif.
  for (const [cle, numero, statut, userId, naissance] of [
    ['dch', 'GEN-001', 'active', ids.dch, null],
    ['actif', 'GEN-002', 'active', null, '1960-04-12'],
    ['archive', 'GEN-003', 'archived', null, null],
  ] as const) {
    const personId = randomUUID();
    await raw(
      `INSERT INTO persons (id, tenant_id, user_id, given_name, family_name, birth_date)
       VALUES ($1, $2, $3, 'Agent', $4, $5)`,
      [personId, tenantId, userId, cle, naissance],
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
  // L'attestation de congé sème les fériés de la période, comme une demande de congé.
  await raw('DELETE FROM holidays WHERE tenant_id = $1', [tenantId]);
  await raw('DELETE FROM holiday_seeds WHERE tenant_id = $1', [tenantId]);
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
  it('chaque document de la liste a son modèle : aucun ne reste à configurer', () => {
    expect(requestableDocSchema.options.filter((doc) => !estGenere(doc))).toEqual([]);
  });

  it('un document hors de la liste, ou retiré, est inconnu', async () => {
    for (const type of ['bulletin_salaire', 'autre', 'n_importe_quoi']) {
      expect(await codeOf(() => service.pdf(dch, type, employes.actif))).toBe('documents.inconnu');
    }
  });

  it('l’attestation de revenu, avec le salaire saisi ; sans lui, refusée en le disant', async () => {
    const { filename } = await service.pdf(dch, 'attestation_revenu', employes.actif, {
      salaire: 250_000,
    });
    expect(filename).toBe('attestation-revenu-GEN-002.pdf');
    const err = await service.pdf(dch, 'attestation_revenu', employes.actif).catch((e) => e);
    expect((err as ProblemException).problem).toMatchObject({
      status: 400,
      code: 'documents.salaire',
      title: 'Salaire net mensuel à saisir',
    });
  });

  it('l’attestation de stage cite un stage du dossier ; sans stage, refusée', async () => {
    expect(await codeOf(() => service.pdf(dch, 'attestation_stage', employes.actif))).toBe(
      'documents.sans_stage',
    );
  });

  it('le certificat de travail, avec la catégorie saisie, pour un dossier inactif seulement', async () => {
    const { filename } = await service.pdf(dch, 'certificat_travail', employes.archive, {
      categorie: '7B',
    });
    expect(filename).toBe('certificat-travail-GEN-003.pdf');
    expect(await codeOf(() => service.pdf(dch, 'certificat_travail', employes.archive))).toBe(
      'documents.categorie',
    );
    expect(
      await codeOf(() =>
        service.pdf(dch, 'certificat_travail', employes.actif, { categorie: '7B' }),
      ),
    ).toBe('documents.en_activite');
  });

  it('l’attestation de congé, avec les dates saisies ; sans elles, ou à rebours, refusée', async () => {
    const { filename } = await service.pdf(dch, 'attestation_conge', employes.actif, {
      debut: '2026-08-03',
      fin: '2026-08-28',
    });
    expect(filename).toBe('attestation-conge-GEN-002.pdf');
    for (const saisies of [
      {},
      { debut: '2026-08-03' },
      { debut: '2026-08-28', fin: '2026-08-03' },
    ]) {
      expect(
        await codeOf(() => service.pdf(dch, 'attestation_conge', employes.actif, saisies)),
      ).toBe('documents.dates');
    }
  });

  it('l’attestation de départ à la retraite, avec la date saisie ; sans elle, refusée', async () => {
    const { filename } = await service.pdf(dch, 'attestation_depart_retraite', employes.actif, {
      depart: '2027-03-31',
    });
    expect(filename).toBe('attestation-depart-retraite-GEN-002.pdf');
    expect(
      await codeOf(() => service.pdf(dch, 'attestation_depart_retraite', employes.actif)),
    ).toBe('documents.depart');
  });

  it('le modèle garde ses règles : l’attestation de travail, pas pour un dossier inactif', async () => {
    expect(await codeOf(() => service.pdf(dch, 'attestation_travail', employes.archive))).toBe(
      'documents.not_active',
    );
  });
});
