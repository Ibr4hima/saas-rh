/**
 * Référence d'offre et suppression.
 *
 * Deux points sensibles. La RÉFÉRENCE d'abord : elle sert à désigner une offre
 * dans un courrier ou une archive, donc deux offres ne peuvent jamais porter
 * la même — y compris après suppression, sinon le numéro rendu désignerait
 * deux campagnes différentes. La SUPPRESSION ensuite : les candidatures
 * déposées appartiennent à des personnes, une offre qui en porte ne doit pas
 * les emporter en partant.
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '@teranga/contracts';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import { JobsService } from '../src/modules/recruitment/jobs.service';

const env = loadEnv();

const tenantId = randomUUID();
const autreTenantId = randomUUID();
const rhUserId = randomUUID();

const rh = { userId: rhUserId, tenantId, role: 'hr' } as SessionUser;
const rhAilleurs = { userId: rhUserId, tenantId: autreTenantId, role: 'hr' } as SessionUser;

let ownerPool: Pool;
let db: TenantDb;
let service: JobsService;

async function raw(q: string, params: unknown[] = []) {
  return ownerPool.query(q, params as never[]);
}

const offre = (titre: string) => ({
  title: titre,
  description: 'Description de poste suffisamment longue pour passer la validation.',
  contractType: 'cdi' as const,
  requiredDocuments: ['cv'] as string[],
});

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 3 });
  db = new TenantDb();
  service = new JobsService(db);

  await raw(
    `INSERT INTO users (id, email, password_hash, given_name, family_name)
     VALUES ($1,$2,'x','Test','RH')`,
    [rhUserId, `rh-${rhUserId}@test.local`],
  );
  for (const [id, nom] of [
    [tenantId, 'Offres'],
    [autreTenantId, 'Offres bis'],
  ] as const) {
    await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1,$2,$3)`, [
      id,
      nom,
      `${nom.toLowerCase().replace(/\s/g, '-')}-${id.slice(0, 8)}`,
    ]);
    await raw(
      `INSERT INTO user_tenant_memberships (id, tenant_id, user_id, role)
       VALUES ($1,$2,$3,'hr')`,
      [randomUUID(), id, rhUserId],
    );
  }
});

beforeEach(async () => {
  for (const id of [tenantId, autreTenantId]) {
    await raw(
      `DELETE FROM application_documents WHERE application_id IN
         (SELECT id FROM applications WHERE tenant_id = $1)`,
      [id],
    );
    await raw(`DELETE FROM applications WHERE tenant_id = $1`, [id]);
    await raw(`DELETE FROM job_postings WHERE tenant_id = $1`, [id]);
    // Le compteur ne recule JAMAIS en production — c'est tout son objet. Entre
    // deux tests il faut donc le remettre à zéro à la main, sinon chaque cas
    // hériterait des numéros du précédent.
    await raw(`DELETE FROM job_posting_counters WHERE tenant_id = $1`, [id]);
  }
});

afterAll(async () => {
  for (const id of [tenantId, autreTenantId]) {
    for (const table of [
      'applications',
      'job_postings',
      'job_posting_counters',
      'user_tenant_memberships',
    ]) {
      await raw(`DELETE FROM ${table} WHERE tenant_id = $1`, [id]);
    }
    await raw(`DELETE FROM tenants WHERE id = $1`, [id]);
  }
  await raw(`DELETE FROM users WHERE id = $1`, [rhUserId]);
  await db?.pool.end();
  await ownerPool?.end();
});

async function referenceDe(id: string): Promise<string> {
  const { rows } = await raw(`SELECT reference FROM job_postings WHERE id = $1`, [id]);
  return (rows[0] as { reference: string }).reference;
}

describe('référence d’offre', () => {
  it('numérote à partir de 001, préfixée par l’année', async () => {
    const { id } = await service.create(rh, offre('Ingénieur des données'));
    expect(await referenceDe(id)).toBe(`OFF-${new Date().getFullYear()}-001`);
  });

  it('incrémente d’une offre à l’autre', async () => {
    const a = await service.create(rh, offre('Poste A'));
    const b = await service.create(rh, offre('Poste B'));
    const annee = new Date().getFullYear();
    expect(await referenceDe(a.id)).toBe(`OFF-${annee}-001`);
    expect(await referenceDe(b.id)).toBe(`OFF-${annee}-002`);
  });

  it('ne rend PAS le numéro d’une offre supprimée', async () => {
    // Sans quoi deux campagnes différentes porteraient la même référence dans
    // les archives — et un courrier citant OFF-2026-002 deviendrait ambigu.
    const a = await service.create(rh, offre('Poste A'));
    const b = await service.create(rh, offre('Poste B'));
    await service.remove(rh, { ids: [b.id] });
    const c = await service.create(rh, offre('Poste C'));
    const annee = new Date().getFullYear();
    expect(await referenceDe(a.id)).toBe(`OFF-${annee}-001`);
    expect(await referenceDe(c.id)).toBe(`OFF-${annee}-003`);
  });

  it('numérote indépendamment dans chaque organisation', async () => {
    const ici = await service.create(rh, offre('Poste ici'));
    const ailleurs = await service.create(rhAilleurs, offre('Poste ailleurs'));
    const annee = new Date().getFullYear();
    expect(await referenceDe(ici.id)).toBe(`OFF-${annee}-001`);
    expect(await referenceDe(ailleurs.id)).toBe(`OFF-${annee}-001`);
  });

  it('expose la référence dans la liste', async () => {
    await service.create(rh, offre('Ingénieur des données'));
    const [vue] = await service.list(rh);
    expect(vue?.reference).toMatch(/^OFF-\d{4}-\d{3}$/);
  });
});

describe('suppression d’offres', () => {
  it('supprime une offre sans candidature', async () => {
    const { id } = await service.create(rh, offre('Poste A'));
    expect(await service.remove(rh, { ids: [id] })).toEqual({ deleted: 1, skipped: [] });
    expect(await service.list(rh)).toEqual([]);
  });

  it('supprime plusieurs offres en une fois', async () => {
    const a = await service.create(rh, offre('Poste A'));
    const b = await service.create(rh, offre('Poste B'));
    const res = await service.remove(rh, { ids: [a.id, b.id] });
    expect(res.deleted).toBe(2);
    expect(await service.list(rh)).toEqual([]);
  });

  it('écarte l’offre qui porte des candidatures et garde les autres', async () => {
    const avec = await service.create(rh, offre('Poste convoité'));
    const sans = await service.create(rh, offre('Poste désert'));
    await raw(
      `INSERT INTO applications (id, tenant_id, job_posting_id, given_name, family_name, email)
       VALUES ($1,$2,$3,'Mariama','Ba','mariama@test.local')`,
      [randomUUID(), tenantId, avec.id],
    );

    const res = await service.remove(rh, { ids: [avec.id, sans.id] });

    expect(res.deleted).toBe(1);
    expect(res.skipped).toEqual([
      {
        id: avec.id,
        title: 'Poste convoité',
        reason: '1 candidature déposée — fermez l’offre plutôt',
      },
    ]);
    // Le dossier de la candidate est toujours là : c'est tout l'objet du garde-fou.
    const { rows } = await raw(`SELECT count(*)::int AS n FROM applications WHERE tenant_id = $1`, [
      tenantId,
    ]);
    expect((rows[0] as { n: number }).n).toBe(1);
    expect((await service.list(rh)).map((o) => o.title)).toEqual(['Poste convoité']);
  });

  it('écarte un identifiant inconnu sans faire échouer le lot', async () => {
    const { id } = await service.create(rh, offre('Poste A'));
    const fantome = randomUUID();
    const res = await service.remove(rh, { ids: [fantome, id] });
    expect(res.deleted).toBe(1);
    expect(res.skipped).toEqual([{ id: fantome, title: '', reason: 'Offre introuvable' }]);
  });

  it('ne touche pas à l’offre d’une autre organisation', async () => {
    const ailleurs = await service.create(rhAilleurs, offre('Poste ailleurs'));
    const res = await service.remove(rh, { ids: [ailleurs.id] });
    expect(res.deleted).toBe(0);
    expect(res.skipped[0]?.reason).toBe('Offre introuvable');
    expect((await service.list(rhAilleurs)).length).toBe(1);
  });
});
