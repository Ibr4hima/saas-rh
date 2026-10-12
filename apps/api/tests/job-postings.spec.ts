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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CreateJobPostingInput, SessionUser } from '@teranga/contracts';
import { createJobPostingSchema } from '@teranga/contracts';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import { JobsService } from '../src/modules/recruitment/jobs.service';
import { EncryptionService } from '../src/common/encryption.service';
import { pourLeJournal } from '../src/common/problem';
import { chiffrerLesCandidatures } from '../src/db/chiffrer-candidatures';
import { ApplyService } from '../src/modules/recruitment/apply.service';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccesGuard } from '../src/modules/auth/acces.guard';
import { ExpediteurCourriels } from '../src/modules/courriels/expediteur';
import { RecruitmentController } from '../src/modules/recruitment/recruitment.controller';
import type { Courriel, Transport } from '../src/modules/courriels/transports';

const env = loadEnv();

const tenantId = randomUUID();
const autreTenantId = randomUUID();
const rhUserId = randomUUID();

const rh = { userId: rhUserId, tenantId, role: 'admin' } as SessionUser;
const rhAilleurs = { userId: rhUserId, tenantId: autreTenantId, role: 'admin' } as SessionUser;

let ownerPool: Pool;
let db: TenantDb;
let service: JobsService;

async function raw(q: string, params: unknown[] = []) {
  return ownerPool.query(q, params as never[]);
}

const offre = (titre: string): CreateJobPostingInput => ({
  title: titre,
  description: 'Description de poste suffisamment longue pour passer la validation.',
  contractType: 'cdi',
  requiredDocuments: ['cv'],
  niveauEtudes: 'bac3',
  experienceMin: 2,
  langues: ['en'],
});

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 3 });
  db = new TenantDb();
  service = new JobsService(db, new EncryptionService());

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
       VALUES ($1,$2,$3,'admin')`,
      [randomUUID(), id, rhUserId],
    );
  }
});

beforeEach(async () => {
  for (const id of [tenantId, autreTenantId]) {
    await raw(`DELETE FROM outbound_emails WHERE tenant_id = $1`, [id]);
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
      'outbound_emails',
      'application_access_log',
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
        reason: '1 candidature déposée : fermez l’offre plutôt',
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

describe('profil recherché', () => {
  it('enregistre et relit niveau, expérience et langues', async () => {
    const { id } = await service.create(rh, {
      ...offre('Analyste'),
      niveauEtudes: 'bac5plus',
      experienceMin: 10,
      langues: ['en', 'zh'],
    });
    const lue = await service.detail(rh, id);
    expect(lue.niveauEtudes).toBe('bac5plus');
    expect(lue.experienceMin).toBe(10);
    expect(lue.langues).toEqual(['en', 'zh']);
    expect(lue.dureeMois).toBeNull();
  });

  it('exige la durée d’un CDD ou d’un stage, et l’ignore pour un CDI', async () => {
    await expect(
      service.create(rh, { ...offre('CDD sans durée'), contractType: 'cdd' }),
    ).rejects.toMatchObject({ problem: { code: 'recruitment.duree_requise' } });

    const stage = await service.create(rh, {
      ...offre('Stage'),
      contractType: 'stage',
      dureeMois: 6,
    });
    expect((await service.detail(rh, stage.id)).dureeMois).toBe(6);

    const cdi = await service.create(rh, { ...offre('CDI'), dureeMois: 12 });
    expect((await service.detail(rh, cdi.id)).dureeMois).toBeNull();
  });

  it('juge la durée sur l’état final de l’offre modifiée', async () => {
    const { id } = await service.create(rh, offre('Poste'));
    // CDI → CDD sans durée : refusé.
    await expect(service.update(rh, id, { contractType: 'cdd' })).rejects.toMatchObject({
      problem: { code: 'recruitment.duree_requise' },
    });
    // CDI → CDD avec durée : accepté.
    await service.update(rh, id, { contractType: 'cdd', dureeMois: 12 });
    expect((await service.detail(rh, id)).dureeMois).toBe(12);
    // Changer la durée seule d'un CDD : accepté.
    await service.update(rh, id, { dureeMois: 24 });
    expect((await service.detail(rh, id)).dureeMois).toBe(24);
    // Retour en CDI : la durée disparaît.
    await service.update(rh, id, { contractType: 'cdi' });
    expect((await service.detail(rh, id)).dureeMois).toBeNull();
  });

  it('refuse une valeur hors liste et dédoublonne les langues', () => {
    const base = { ...offre('Poste'), langues: ['en', 'en', 'it'] };
    expect(createJobPostingSchema.parse(base).langues).toEqual(['en', 'it']);
    // Le français, le wolof, le portugais ne sont plus proposés ; ni le
    // consultant ou le détachement comme contrat d'offre.
    expect(createJobPostingSchema.safeParse({ ...base, langues: ['fr'] }).success).toBe(false);
    expect(createJobPostingSchema.safeParse({ ...base, contractType: 'consultant' }).success).toBe(
      false,
    );
    expect(createJobPostingSchema.safeParse({ ...base, niveauEtudes: 'bac6' }).success).toBe(false);
    expect(createJobPostingSchema.safeParse({ ...base, experienceMin: 4 }).success).toBe(false);
    expect(createJobPostingSchema.safeParse({ ...base, langues: ['de'] }).success).toBe(false);
    const { niveauEtudes: _n, ...sansNiveau } = base;
    expect(createJobPostingSchema.safeParse(sansNiveau).success).toBe(false);
  });
});

describe('statut et date limite', () => {
  const jour = async (decalage: number) =>
    ((await raw(`SELECT (CURRENT_DATE + $1::int)::text AS d`, [decalage])).rows[0] as { d: string })
      .d;
  const code = async (geste: () => Promise<unknown>) => {
    try {
      await geste();
      return 'ok';
    } catch (err) {
      return (err as { problem?: { code: string } }).problem?.code ?? String(err);
    }
  };

  it('date la publication, pas le brouillon', async () => {
    const { id } = await service.create(rh, { ...offre('Juriste'), deadline: await jour(20) });
    expect((await service.detail(rh, id)).publishedAt).toBeNull();
    await service.update(rh, id, { status: 'published' });
    expect((await service.detail(rh, id)).publishedAt).not.toBeNull();
  });

  it('une date limite se fixe à venir ; passée, elle n’empêche ni de publier ni de modifier', async () => {
    expect(
      await code(async () =>
        service.create(rh, { ...offre('Comptable'), deadline: await jour(-1) }),
      ),
    ).toBe('recruitment.date_limite_passee');
    const { id } = await service.create(rh, { ...offre('Comptable'), deadline: await jour(3) });
    await raw(`UPDATE job_postings SET deadline = CURRENT_DATE - 1 WHERE id = $1`, [id]);
    expect(await code(() => service.update(rh, id, { status: 'published' }))).toBe('ok');
    // La fenêtre de modification renvoie la date telle qu'elle est.
    const passee = await jour(-1);
    expect(
      await code(() => service.update(rh, id, { title: 'Comptable confirmé', deadline: passee })),
    ).toBe('ok');
    // Une NOUVELLE date, elle, se fixe à venir.
    expect(await code(async () => service.update(rh, id, { deadline: await jour(-2) }))).toBe(
      'recruitment.date_limite_passee',
    );
    expect(await service.detail(rh, id)).toMatchObject({
      title: 'Comptable confirmé',
      status: 'published',
      deadline: passee,
    });
  });

  it('reste ouverte après sa date limite ; archivée, elle se ferme à tout moment, et se rouvre', async () => {
    const candidat = new ApplyService(db, new EncryptionService());
    const dossier = (email: string) => ({
      givenName: 'Amadou Way',
      familyName: 'Samb',
      email,
      documents: [
        {
          label: 'cv',
          filename: 'CV.pdf',
          contentType: 'application/pdf',
          contentBase64: Buffer.from('%PDF-1.4 cv').toString('base64'),
        },
      ],
    });

    // Sa date limite passée, l'offre publiée reçoit encore des dossiers.
    const auditeur = await service.create(rh, { ...offre('Auditeur'), deadline: await jour(5) });
    await service.update(rh, auditeur.id, { status: 'published' });
    await raw(`UPDATE job_postings SET deadline = CURRENT_DATE - 1 WHERE id = $1`, [auditeur.id]);
    expect((await service.list(rh)).find((o) => o.id === auditeur.id)?.status).toBe('published');
    expect(await candidat.info(auditeur.publicSlug)).toMatchObject({ valid: true });
    await candidat.apply(auditeur.publicSlug, dossier('amadou.samb@exemple.sn'));
    expect(await service.applications(rh, auditeur.id)).toHaveLength(1);

    // Archivée avant sa date limite : son lien ne mène plus à rien.
    const juriste = await service.create(rh, { ...offre('Juriste'), deadline: await jour(30) });
    await service.update(rh, juriste.id, { status: 'published' });
    await service.update(rh, juriste.id, { status: 'closed' });
    expect(await candidat.info(juriste.publicSlug)).toEqual({ valid: false, reason: 'not_found' });
    expect(
      await code(() => candidat.apply(juriste.publicSlug, dossier('awa.ndiaye@exemple.sn'))),
    ).toBe('recruitment.job_unavailable');

    // Rouverte, même sa date passée, elle reprend les dossiers.
    await raw(`UPDATE job_postings SET deadline = CURRENT_DATE - 1 WHERE id = $1`, [juriste.id]);
    expect(await code(() => service.update(rh, juriste.id, { status: 'published' }))).toBe('ok');
    expect(await candidat.info(juriste.publicSlug)).toMatchObject({ valid: true });
  });

  it('les offres closes par le système à leur date limite se rouvrent, pas celles archivées par la RH (0105)', async () => {
    const fermee = await service.create(rh, { ...offre('Statisticien'), deadline: await jour(5) });
    const archivee = await service.create(rh, { ...offre('Traducteur'), deadline: await jour(5) });
    for (const o of [fermee, archivee]) await service.update(rh, o.id, { status: 'published' });
    await raw(`UPDATE job_postings SET deadline = CURRENT_DATE - 1 WHERE tenant_id = $1`, [
      tenantId,
    ]);
    // Comme le faisait le système le lendemain de la date limite : sans auteur.
    await raw(`UPDATE job_postings SET status = 'closed' WHERE id = $1`, [fermee.id]);
    await service.update(rh, archivee.id, { status: 'closed' });

    const migration = readFileSync(
      join(__dirname, '../src/db/sql/0105_offres_ouvertes_apres_la_date_limite.sql'),
      'utf8',
    );
    await raw(migration);
    expect((await service.detail(rh, fermee.id)).status).toBe('published');
    expect((await service.detail(rh, archivee.id)).status).toBe('closed');
  });
});

describe('une candidature supprimée', () => {
  it('ne laisse au journal que la trace des gestes, pas la personne', async () => {
    const { id: offreId } = await service.create(rh, offre('Analyste'));
    const id = randomUUID();
    await db.withTenant({ tenantId, userId: rhUserId }, (tx) =>
      tx.execute(sql`
        INSERT INTO applications (id, tenant_id, job_posting_id, given_name, family_name, email)
        VALUES (${id}, ${tenantId}, ${offreId}, 'Ndeye', 'Candidate', 'ndeye.candidate@exemple.sn')`),
    );
    await service.updateStage(rh, id, 'interview');
    await service.updateStage(rh, id, 'rejected');
    expect(await service.deleteApplications(rh, { ids: [id] })).toEqual({ deleted: 1 });
    const { rows } = await raw(
      `SELECT action, old_data IS NULL AND new_data IS NULL AS vide
         FROM audit_log WHERE row_id = $1 ORDER BY occurred_at, action`,
      [id],
    );
    expect(rows.map((r) => r.action).sort()).toEqual(['DELETE', 'INSERT', 'UPDATE', 'UPDATE']);
    expect(rows.every((r) => r.vide)).toBe(true);
  });
});

/** Un transport qui garde ce qu'on lui confie. */
class TransportDeTest implements Transport {
  readonly nom = 'test';
  envoyes: Courriel[] = [];
  async envoyer(c: Courriel): Promise<void> {
    this.envoyes.push(c);
  }
}

describe('une candidature déposée', () => {
  const enc = new EncryptionService();
  const PDF = Buffer.from('%PDF-1.4 cv').toString('base64');

  it('vaut au candidat un accusé de réception, sans que son adresse s’écrive en clair', async () => {
    const transport = new TransportDeTest();
    const expediteur = new ExpediteurCourriels(
      db,
      enc,
      transport,
      'Capital Humain <rh@apix.test>',
      'http://localhost:3002',
      async () => null,
    );
    try {
      const { id: offreId } = await service.create(rh, offre('Analyste Marketing'));
      await service.update(rh, offreId, { status: 'published' });
      const { rows } = await raw(`SELECT public_slug FROM job_postings WHERE id = $1`, [offreId]);
      const deposer = new ApplyService(db, enc, expediteur);
      const slug = rows[0].public_slug as string;

      // Un dépôt refusé n'accuse rien.
      const refus = await deposer
        .apply(slug, {
          givenName: 'Awa',
          familyName: 'Ndiaye',
          email: 'awa.ndiaye@exemple.sn',
          documents: [],
        })
        .catch((e) => e.problem);
      expect(refus).toMatchObject({ code: 'recruitment.documents_missing' });

      await deposer.apply(slug, {
        givenName: 'Amadou Way',
        familyName: 'Samb',
        email: 'amadou.samb@exemple.sn',
        documents: [
          { label: 'cv', filename: 'CV.pdf', contentType: 'application/pdf', contentBase64: PDF },
        ],
      });
      const enFile = async () =>
        (
          await raw(
            `SELECT kind, recipient, subject, body_encrypted, status FROM outbound_emails
              WHERE tenant_id = $1 ORDER BY created_at`,
            [tenantId],
          )
        ).rows;
      const [accuse, ...autres] = await enFile();
      expect(autres).toEqual([]);
      expect(accuse).toMatchObject({
        kind: 'candidature_recue',
        recipient: null,
        subject: 'Nous avons bien reçu votre candidature au poste d’Analyste Marketing',
        status: 'pending',
      });
      expect(JSON.stringify(accuse)).not.toMatch(/amadou|samb|exemple\.sn/i);

      await expediteur.envoyerCeQuiAttend();
      expect(transport.envoyes).toHaveLength(1);
      const [parti] = transport.envoyes;
      expect(parti!.to).toBe('amadou.samb@exemple.sn');
      expect(parti!.text).toContain('Bonjour Amadou,');
      expect(parti!.text).toContain(
        'Nous accusons bonne réception de votre candidature au poste d’Analyste Marketing',
      );
      expect(parti!.text).toContain('l’intérêt que vous portez à APIX S.A.');
      expect(parti!.html).toContain('Candidature reçue');
      expect(parti!.html).not.toContain('Copiez ce');
      expect(await enFile()).toEqual([
        expect.objectContaining({ status: 'sent', recipient: null, body_encrypted: null }),
      ]);
    } finally {
      await expediteur.onModuleDestroy();
    }
  });
});

describe('une candidature rejetée', () => {
  const enc = new EncryptionService();
  /** La première page, comme l'écran la demande. */
  const PAGE = { offset: 0, limit: 15 };

  /** Le dossier d'Amadou Way Samb, déposé à cette offre. */
  const postuler = (slug: string, expediteur?: ExpediteurCourriels) =>
    new ApplyService(db, enc, expediteur).apply(slug, {
      givenName: 'Amadou Way',
      familyName: 'Samb',
      email: 'amadou.samb@exemple.sn',
      documents: [
        {
          label: 'cv',
          filename: 'CV.pdf',
          contentType: 'application/pdf',
          contentBase64: Buffer.from('%PDF-1.4 cv').toString('base64'),
        },
      ],
    });

  /** Une offre publiée, et la candidature d'Amadou Way Samb, chiffrée comme au dépôt. */
  async function candidature(rh2: JobsService, expediteur?: ExpediteurCourriels) {
    const { id: offreId } = await rh2.create(rh, offre('Économiste'));
    await rh2.update(rh, offreId, { status: 'published' });
    const { rows } = await raw(`SELECT public_slug FROM job_postings WHERE id = $1`, [offreId]);
    await postuler(rows[0].public_slug as string, expediteur);
    const [dossier] = await rh2.applications(rh, offreId);
    return dossier!.id;
  }
  /** L'offre d'une candidature, et le lien où l'on y postule. */
  const offreDe = async (applicationId: string) => {
    const { rows } = await raw(
      `SELECT p.id, p.public_slug FROM applications a
         JOIN job_postings p ON p.id = a.job_posting_id WHERE a.id = $1`,
      [applicationId],
    );
    return { offreId: rows[0].id as string, slug: rows[0].public_slug as string };
  };
  const expediteurDeTest = (transport: TransportDeTest) =>
    new ExpediteurCourriels(
      db,
      enc,
      transport,
      'Capital Humain <rh@apix.test>',
      'http://localhost:3002',
      async () => null,
    );
  const courriels = async (applicationId: string) =>
    (
      await raw(
        `SELECT kind, recipient, subject, body_encrypted, status FROM outbound_emails
          WHERE tenant_id = $1 AND subject_id = $2`,
        [tenantId, applicationId],
      )
    ).rows;

  it('vaut au candidat un courriel de refus, sans que son adresse s’écrive en clair', async () => {
    const transport = new TransportDeTest();
    const expediteur = new ExpediteurCourriels(
      db,
      enc,
      transport,
      'Capital Humain <rh@apix.test>',
      'http://localhost:3002',
      async () => null,
    );
    const jobs = new JobsService(db, enc, expediteur);
    try {
      const id = await candidature(jobs);
      await jobs.updateStage(rh, id, 'rejected');

      const [enFile] = await courriels(id);
      expect(enFile).toMatchObject({
        kind: 'candidature_refusee',
        recipient: null,
        subject: 'Votre candidature au poste d’Économiste',
        status: 'pending',
      });
      expect(JSON.stringify(enFile)).not.toMatch(/amadou|samb|exemple\.sn/i);

      // Rejetée deux fois : un seul courriel. Rouverte : refusé, la réponse est partie.
      await jobs.updateStage(rh, id, 'rejected');
      const rouvrir = await jobs.updateStage(rh, id, 'screening').catch((e) => e.problem);
      expect(rouvrir).toMatchObject({ code: 'recruitment.candidature_rejetee' });
      expect(await courriels(id)).toHaveLength(1);

      await expediteur.envoyerCeQuiAttend();
      expect(transport.envoyes).toHaveLength(1);
      const [parti] = transport.envoyes;
      expect(parti).toMatchObject({
        to: 'amadou.samb@exemple.sn',
        subject: 'Votre candidature au poste d’Économiste',
      });
      expect(parti!.text).toContain('Bonjour Amadou,');
      expect(parti!.text).toContain('l’intérêt que vous portez à APIX S.A et');
      expect(parti!.text).toContain('il n’a pas été retenu');
      expect(parti!.text).toContain('La Direction du Capital Humain');
      expect(parti!.html).toContain('Votre candidature');
      // Aucun geste attendu du candidat : ni bouton, ni lien de secours.
      expect(parti!.html).not.toContain('Copiez ce');

      // Parti, il ne garde rien du candidat.
      expect(await courriels(id)).toEqual([
        expect.objectContaining({ status: 'sent', recipient: null, body_encrypted: null }),
      ]);
    } finally {
      await expediteur.onModuleDestroy();
    }
  });

  it('quitte la liste de son offre pour celle des rejetées', async () => {
    const jobs = new JobsService(db, enc);
    const id = await candidature(jobs);
    const [{ job_posting_id: offreId }] = (
      await raw(`SELECT job_posting_id FROM applications WHERE id = $1`, [id])
    ).rows;
    expect(await jobs.nombreDeRejetees(rh)).toEqual({ count: 0 });
    expect(await jobs.rejetees(rh, PAGE)).toEqual({ items: [], total: 0 });

    await jobs.updateStage(rh, id, 'rejected');
    expect(await jobs.applications(rh, offreId)).toEqual([]);
    expect(await jobs.nombreDeRejetees(rh)).toEqual({ count: 1 });
    const {
      items: [rejetee],
      total,
    } = await jobs.rejetees(rh, PAGE);
    expect(total).toBe(1);
    expect(rejetee).toMatchObject({
      id,
      givenName: 'Amadou Way',
      familyName: 'Samb',
      email: 'amadou.samb@exemple.sn',
      stage: 'rejected',
      jobTitle: 'Économiste',
      jobReference: expect.stringMatching(/^OFF-\d{4}-\d{3}$/),
      documents: [{ label: 'cv', filename: 'CV.pdf' }],
    });
    // Une autre organisation n'en voit rien.
    expect(await jobs.nombreDeRejetees(rhAilleurs)).toEqual({ count: 0 });
    expect(await jobs.rejetees(rhAilleurs, PAGE)).toEqual({ items: [], total: 0 });
    // Lue, la liste se trace comme celle de l'offre.
    const { rows: traces } = await raw(
      `SELECT action, job_posting_id FROM application_access_log
        WHERE tenant_id = $1 AND job_posting_id = $2 ORDER BY occurred_at`,
      [tenantId, offreId],
    );
    expect(traces.at(-1)).toEqual({ action: 'list', job_posting_id: offreId });
  });

  it('se lisent une page à la fois, et la recherche trouve les noms chiffrés', async () => {
    const jobs = new JobsService(db, enc);
    const { id: offreId } = await jobs.create(rh, offre('Juriste'));
    await jobs.update(rh, offreId, { status: 'published' });
    const { rows } = await raw(`SELECT public_slug FROM job_postings WHERE id = $1`, [offreId]);
    const noms = [
      ['Awa', 'Ndiaye'],
      ['Mamadou', 'Diop'],
      ['Fatou', 'Ndiaye'],
      ['Aïssatou', 'Fall'],
    ];
    for (const [i, [givenName, familyName]] of noms.entries()) {
      await new ApplyService(db, enc).apply(rows[0].public_slug as string, {
        givenName: givenName!,
        familyName: familyName!,
        email: `candidat.${i}@exemple.sn`,
        documents: [
          {
            label: 'cv',
            filename: 'CV.pdf',
            contentType: 'application/pdf',
            contentBase64: Buffer.from('%PDF-1.4 cv').toString('base64'),
          },
        ],
      });
    }
    for (const dossier of await jobs.applications(rh, offreId)) {
      await jobs.updateStage(rh, dossier.id, 'rejected');
    }
    // Les noms ne sont lisibles qu'une fois déchiffrés.
    const { rows: stockes } = await raw(
      `SELECT given_name FROM applications WHERE job_posting_id = $1`,
      [offreId],
    );
    expect(JSON.stringify(stockes)).not.toMatch(/Awa|Mamadou|Fatou|Fall/);

    // Sans recherche, la base pagine : deux par page, aucune ligne deux fois.
    const premiere = await jobs.rejetees(rh, { offset: 0, limit: 2 });
    const seconde = await jobs.rejetees(rh, { offset: 2, limit: 2 });
    expect(premiere.total).toBe(4);
    expect(seconde.total).toBe(4);
    const vus = [...premiere.items, ...seconde.items].map((a) => a.id);
    expect(new Set(vus).size).toBe(4);
    expect((await jobs.rejetees(rh, { offset: 4, limit: 2 })).items).toEqual([]);

    // La recherche, comme à l'écran : casse, accents et ordre des mots indifférents.
    const ndiaye = await jobs.rejetees(rh, { q: 'NDIAYE', offset: 0, limit: 15 });
    expect(ndiaye.total).toBe(2);
    expect(ndiaye.items.map((a) => a.givenName).sort()).toEqual(['Awa', 'Fatou']);
    expect((await jobs.rejetees(rh, { q: 'diop mamadou', ...PAGE })).items).toEqual([
      expect.objectContaining({ givenName: 'Mamadou', familyName: 'Diop' }),
    ]);
    expect((await jobs.rejetees(rh, { q: 'aissatou', ...PAGE })).total).toBe(1);
    // L'intitulé de l'offre se cherche aussi, et la page suit la recherche.
    const juristes = await jobs.rejetees(rh, { q: 'juriste', offset: 3, limit: 2 });
    expect(juristes).toMatchObject({ total: 4, items: [expect.anything()] });
    expect((await jobs.rejetees(rh, { q: 'personne', ...PAGE })).total).toBe(0);
  });

  it('les non retenues se lisent, se reconsidèrent et s’effacent par qui a les dossiers de candidature, et personne d’autre', () => {
    const garde = new AccesGuard(new Reflector());
    const ouvre = (handler: object, sessionUser: object) => {
      try {
        return garde.canActivate({
          getHandler: () => handler,
          getClass: () => RecruitmentController,
          switchToHttp: () => ({ getRequest: () => ({ sessionUser }) }),
        } as unknown as ExecutionContext);
      } catch {
        return false;
      }
    };
    const { rejetees, nombreDeRejetees, reconsider, deleteApplications } =
      RecruitmentController.prototype;
    for (const route of [rejetees, nombreDeRejetees, reconsider, deleteApplications]) {
      // Déléguée « Dossiers de candidature » : oui.
      expect(ouvre(route, { role: 'employee', capacites: ['recrutement.candidatures'] })).toBe(
        true,
      );
      // Les offres seules, l'administrateur (qui n'a pas les dossiers), un agent : non.
      expect(ouvre(route, { role: 'employee', capacites: ['recrutement.offres'] })).toBe(false);
      expect(ouvre(route, { role: 'admin', capacites: [] })).toBe(false);
      expect(ouvre(route, { role: 'employee', capacites: [] })).toBe(false);
    }
  });

  it('supprimée avant le départ, rien ne part, et son refus s’efface avec elle', async () => {
    const transport = new TransportDeTest();
    const expediteur = new ExpediteurCourriels(
      db,
      enc,
      transport,
      'Capital Humain <rh@apix.test>',
      'http://localhost:3002',
      async () => null,
    );
    const jobs = new JobsService(db, enc, expediteur);
    try {
      const id = await candidature(jobs);
      await jobs.updateStage(rh, id, 'rejected');
      await jobs.deleteApplications(rh, { ids: [id] });
      await expediteur.envoyerCeQuiAttend();
      expect(transport.envoyes).toHaveLength(0);
      expect(await courriels(id)).toEqual([]);
    } finally {
      await expediteur.onModuleDestroy();
    }
  });

  it('reconsidérée, elle retrouve son offre à l’étape où elle était, et son refus en attente ne part pas', async () => {
    const transport = new TransportDeTest();
    const expediteur = expediteurDeTest(transport);
    const jobs = new JobsService(db, enc, expediteur);
    try {
      const id = await candidature(jobs);
      const { offreId } = await offreDe(id);
      await jobs.updateStage(rh, id, 'interview');
      await jobs.updateStage(rh, id, 'rejected');
      expect(await jobs.reconsider(rh, { ids: [id] })).toEqual({ reconsidered: 1 });

      expect(await jobs.applications(rh, offreId)).toEqual([
        expect.objectContaining({ id, stage: 'interview', refusalSent: false }),
      ]);
      expect(await jobs.rejetees(rh, PAGE)).toEqual({ items: [], total: 0 });
      expect(await jobs.nombreDeRejetees(rh)).toEqual({ count: 0 });
      await expediteur.envoyerCeQuiAttend();
      expect(transport.envoyes).toHaveLength(0);
      expect(await courriels(id)).toEqual([
        expect.objectContaining({ kind: 'candidature_refusee', status: 'cancelled' }),
      ]);

      // Rejetée de nouveau : rien n'était parti, le refus part.
      await jobs.updateStage(rh, id, 'rejected');
      await expediteur.envoyerCeQuiAttend();
      expect(transport.envoyes).toHaveLength(1);

      // Reconsidérée puis rejetée encore : le refus est parti, aucun second.
      await jobs.reconsider(rh, { ids: [id] });
      expect(await jobs.applications(rh, offreId)).toEqual([
        expect.objectContaining({ id, stage: 'interview', refusalSent: true }),
      ]);
      await jobs.updateStage(rh, id, 'rejected');
      await expediteur.envoyerCeQuiAttend();
      expect(transport.envoyes).toHaveLength(1);
      expect((await courriels(id)).map((c) => c.status).sort()).toEqual(['cancelled', 'sent']);
    } finally {
      await expediteur.onModuleDestroy();
    }
  });

  it('reconsidérer et supprimer ne touchent qu’aux non retenues de l’organisation', async () => {
    const jobs = new JobsService(db, enc);
    const enLice = await candidature(jobs);
    const rejetee = await candidature(jobs);
    await jobs.updateStage(rh, rejetee, 'rejected');
    // Rejetée sans trace de l'étape d'avant : elle reviendra « reçue ».
    const sansTrace = randomUUID();
    const { offreId } = await offreDe(rejetee);
    await db.withTenant({ tenantId, userId: rhUserId }, (tx) =>
      tx.execute(sql`
        INSERT INTO applications (id, tenant_id, job_posting_id, given_name, family_name, email, stage)
        VALUES (${sansTrace}, ${tenantId}, ${offreId}, 'Ndeye', 'Candidate', 'ndeye.candidate@exemple.sn', 'rejected')`),
    );

    // Une autre organisation ne les voit pas : rien ne bouge.
    expect(await jobs.reconsider(rhAilleurs, { ids: [rejetee] })).toEqual({ reconsidered: 0 });
    expect(await jobs.deleteApplications(rhAilleurs, { ids: [rejetee] })).toEqual({ deleted: 0 });
    // Celle encore en lice ne s'efface pas ; un identifiant inconnu ne fait pas échouer le lot.
    expect(await jobs.deleteApplications(rh, { ids: [enLice, randomUUID()] })).toEqual({
      deleted: 0,
    });
    expect(await jobs.reconsider(rh, { ids: [enLice, rejetee, sansTrace, randomUUID()] })).toEqual({
      reconsidered: 2,
    });
    const { rows } = await raw(`SELECT id, stage FROM applications WHERE tenant_id = $1`, [
      tenantId,
    ]);
    expect(Object.fromEntries(rows.map((r) => [r.id, r.stage]))).toEqual({
      [enLice]: 'received',
      [rejetee]: 'received',
      [sansTrace]: 'received',
    });
  });

  it('supprimée définitivement, il ne reste rien de la personne, et son adresse peut postuler de nouveau', async () => {
    const transport = new TransportDeTest();
    const expediteur = expediteurDeTest(transport);
    const jobs = new JobsService(db, enc, expediteur);
    try {
      // Déposée : l'accusé de réception part. Consultée : sa lecture se trace.
      const id = await candidature(jobs, expediteur);
      const { offreId, slug } = await offreDe(id);
      await expediteur.envoyerCeQuiAttend();
      const [dossier] = await jobs.applications(rh, offreId);
      const pieces = dossier!.documents.map((d) => d.id);
      await jobs.document(rh, pieces[0]!);
      // Rejetée : le refus attend son départ.
      await jobs.updateStage(rh, id, 'rejected');

      expect(await jobs.deleteApplications(rh, { ids: [id] })).toEqual({ deleted: 1 });

      expect((await raw(`SELECT 1 FROM applications WHERE id = $1`, [id])).rows).toEqual([]);
      expect(
        (await raw(`SELECT 1 FROM application_documents WHERE application_id = $1`, [id])).rows,
      ).toEqual([]);
      // L'accusé parti comme le refus en attente : plus aucune ligne.
      expect(await courriels(id)).toEqual([]);
      await expediteur.envoyerCeQuiAttend();
      expect(transport.envoyes.map((c) => c.subject)).toEqual([
        'Nous avons bien reçu votre candidature au poste d’Économiste',
      ]);
      // Le journal garde la trace des gestes, plus leur contenu.
      const { rows: journal } = await raw(
        `SELECT old_data, new_data FROM audit_log WHERE row_id = ANY($1::uuid[])`,
        [[id, ...pieces]],
      );
      expect(journal.length).toBeGreaterThan(0);
      expect(journal.every((l) => l.old_data === null && l.new_data === null)).toBe(true);
      // Celui des consultations ne porte que des identifiants.
      const { rows: lectures } = await raw(
        `SELECT * FROM application_access_log WHERE application_id = $1`,
        [id],
      );
      expect(lectures).toHaveLength(1);
      expect(JSON.stringify(lectures)).not.toMatch(/amadou|samb|exemple\.sn|cv\.pdf/i);
      expect(await jobs.rejetees(rh, PAGE)).toEqual({ items: [], total: 0 });
      expect(await jobs.nombreDeRejetees(rh)).toEqual({ count: 0 });

      // L'adresse est libre : la même personne postule de nouveau à l'offre.
      await postuler(slug);
      expect(await jobs.applications(rh, offreId)).toEqual([
        expect.objectContaining({ givenName: 'Amadou Way', stage: 'received' }),
      ]);
    } finally {
      await expediteur.onModuleDestroy();
    }
  });
});

describe('les candidatures, gardées au repos', () => {
  const enc = new EncryptionService();
  const PDF = Buffer.from('%PDF-1.4 curriculum vitae de Ndeye');
  const deposer = async (slug: string, email: string) =>
    new ApplyService(db, enc).apply(slug, {
      givenName: 'Ndeye',
      familyName: 'Candidate',
      email,
      phone: '+221770000000',
      documents: [
        {
          label: 'cv',
          filename: 'CV Ndeye Candidate.pdf',
          contentType: 'application/pdf',
          contentBase64: PDF.toString('base64'),
        },
      ],
    });
  const publiee = async () => {
    const { id } = await service.create(rh, offre('Chargé de recrutement'));
    await service.update(rh, id, { status: 'published' });
    const { rows } = await raw(`SELECT public_slug FROM job_postings WHERE id = $1`, [id]);
    return { id, slug: rows[0].public_slug as string };
  };

  it('en base, rien du candidat ne se lit en clair ; la RH le lit, et sa lecture se trace', async () => {
    const { id, slug } = await publiee();
    await deposer(slug, 'Ndeye.Candidate@exemple.sn');

    const { rows: lignes } = await raw(
      `SELECT a.id, a.given_name, a.family_name, a.email, a.phone, a.cle_version,
              d.filename, d.data, d.cle_version AS piece_version
         FROM applications a JOIN application_documents d ON d.application_id = a.id
        WHERE a.job_posting_id = $1`,
      [id],
    );
    const l = lignes[0];
    for (const champ of [l.given_name, l.family_name, l.email, l.phone, l.filename]) {
      expect(champ).toMatch(/^c1:/);
    }
    expect(JSON.stringify(l)).not.toMatch(/Ndeye|exemple\.sn|770000000/);
    expect((l.data as Buffer).subarray(0, 5).toString()).not.toBe('%PDF-');
    expect([l.cle_version, l.piece_version]).toEqual([1, 1]);

    const [vue] = await service.applications(rh, id);
    expect(vue).toMatchObject({
      givenName: 'Ndeye',
      email: 'Ndeye.Candidate@exemple.sn',
      phone: '+221770000000',
      documents: [{ filename: 'CV Ndeye Candidate.pdf' }],
    });
    const piece = await service.document(rh, vue!.documents[0]!.id);
    expect(piece.data.equals(PDF)).toBe(true);
    const { rows: traces } = await raw(
      `SELECT action, actor_user_id FROM application_access_log
        WHERE tenant_id = $1 AND (job_posting_id = $2 OR application_id = $3)
        ORDER BY occurred_at`,
      [tenantId, id, vue!.id],
    );
    expect(traces).toEqual([
      { action: 'list', actor_user_id: rhUserId },
      { action: 'document', actor_user_id: rhUserId },
    ]);

    // Le journal d'audit garde les gestes, pas la personne ni la pièce.
    const { rows: audit } = await raw(
      `SELECT table_name, new_data FROM audit_log
        WHERE row_id IN (SELECT id FROM applications WHERE job_posting_id = $1
                         UNION SELECT d.id FROM application_documents d
                           JOIN applications a ON a.id = d.application_id
                          WHERE a.job_posting_id = $1)`,
      [id],
    );
    expect(audit.map((a) => a.table_name).sort()).toEqual([
      'application_documents',
      'applications',
    ]);
    for (const a of audit) {
      expect(Object.keys(a.new_data)).not.toEqual(expect.arrayContaining(['given_name']));
      for (const cle of ['given_name', 'family_name', 'email', 'phone', 'filename', 'data']) {
        expect(a.new_data).not.toHaveProperty(cle);
      }
    }
  });

  it('une adresse ne candidate qu’une fois par offre, même chiffrée, quelle que soit la casse', async () => {
    const { slug } = await publiee();
    await deposer(slug, 'awa.ndiaye@exemple.sn');
    await expect(deposer(slug, '  AWA.Ndiaye@exemple.sn ')).rejects.toMatchObject({
      problem: { code: 'recruitment.already_applied' },
    });
  });

  it('un chiffré ne se lit qu’à sa place', () => {
    const ici = `${tenantId}:applications:${randomUUID()}:email`;
    const chiffre = enc.chiffrerTexte('ndeye@exemple.sn', ici);
    expect(enc.dechiffrerTexte(chiffre, ici)).toBe('ndeye@exemple.sn');
    expect(() => enc.dechiffrerTexte(chiffre, `${autreTenantId}${ici.slice(36)}`)).toThrow();
    expect(() => enc.dechiffrerTexte(chiffre, ici.replace(':email', ':given_name'))).toThrow();
  });

  it('une candidature d’avant se lit, puis le migrateur la chiffre', async () => {
    const { id: offreId } = await service.create(rh, offre('Archiviste'));
    const id = randomUUID();
    const pieceId = randomUUID();
    await raw(
      `INSERT INTO applications (id, tenant_id, job_posting_id, given_name, family_name, email)
       VALUES ($1, $2, $3, 'Moussa', 'Ancien', 'moussa.ancien@exemple.sn')`,
      [id, tenantId, offreId],
    );
    await raw(
      `INSERT INTO application_documents (id, tenant_id, application_id, label, filename, content_type, size_bytes, data)
       VALUES ($1, $2, $3, 'cv', 'cv-ancien.pdf', 'application/pdf', $4, $5)`,
      [pieceId, tenantId, id, PDF.length, PDF],
    );
    expect((await service.applications(rh, offreId))[0]).toMatchObject({
      givenName: 'Moussa',
      documents: [{ filename: 'cv-ancien.pdf' }],
    });
    const client = new Client({ connectionString: env.DATABASE_URL });
    await client.connect();
    try {
      expect(await chiffrerLesCandidatures(client)).toBeGreaterThanOrEqual(2);
    } finally {
      await client.end();
    }
    const { rows } = await raw(`SELECT given_name, cle_version FROM applications WHERE id = $1`, [
      id,
    ]);
    expect(rows[0]).toMatchObject({ cle_version: 1, given_name: expect.stringMatching(/^c1:/) });
    expect((await service.applications(rh, offreId))[0]).toMatchObject({
      givenName: 'Moussa',
      email: 'moussa.ancien@exemple.sn',
      documents: [{ filename: 'cv-ancien.pdf' }],
    });
    expect((await service.document(rh, pieceId)).data.equals(PDF)).toBe(true);
  });

  it('une erreur de base ne journalise jamais les valeurs de la requête', () => {
    const erreur = Object.assign(
      new Error('Failed query: insert into applications …\nparams: Ndeye,ndeye@exemple.sn'),
      {
        name: 'DrizzleQueryError',
        query: 'insert into applications …',
        params: ['Ndeye', 'ndeye@exemple.sn'],
        cause: { code: '55P03', message: 'lock timeout' },
      },
    );
    const journal = JSON.stringify(pourLeJournal(erreur));
    expect(journal).not.toMatch(/Ndeye|exemple/);
    expect(journal).toContain('55P03');
  });
});
