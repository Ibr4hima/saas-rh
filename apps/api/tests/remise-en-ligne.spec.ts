/**
 * La remise en ligne d'un document demandé (ADR-0040).
 *
 * Qui traite la demande y dépose le document ; l'agent le télécharge depuis
 * son espace, sans passer au bureau. Le fichier est chiffré au repos, ne se
 * montre à l'agent qu'une fois la demande prête, et ne s'ouvre, côté DCH,
 * qu'à qui traite ce document-là.
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  deposerFichierSchema,
  type DeposerFichierInput,
  type SessionUser,
} from '@teranga/contracts';
import { EncryptionService } from '../src/common/encryption.service';
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
const khadyUserId = randomUUID();
const dchId = randomUUID();

const session = (userId: string, givenName: string, familyName: string) =>
  ({ userId, tenantId, role: 'employee', givenName, familyName }) as SessionUser;
const rh = session(rhUserId, 'Ibrahima', 'Ba');
const awa = session(awaUserId, 'Awa', 'Diop');
const moussa = session(moussaUserId, 'Moussa', 'Ndiaye');
const khady = session(khadyUserId, 'Khady', 'Fall');

let ownerPool: Pool;
let db: TenantDb;
let service: DocumentRequestsService;
let khadyEmployeeId: string;

const PDF = Buffer.from('%PDF-1.7 bulletin de septembre');
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('scan'),
]);
const fichier = (
  contenu: Buffer,
  filename = 'bulletin-septembre.pdf',
  contentType: DeposerFichierInput['contentType'] = 'application/pdf',
): DeposerFichierInput => ({ filename, contentType, contentBase64: contenu.toString('base64') });

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

const demander = async (
  user: SessionUser,
  docType: 'attestation_travail' | 'bulletin_salaire' = 'attestation_travail',
) =>
  (
    await service.create(
      user,
      docType === 'bulletin_salaire'
        ? { docTypes: [docType], bulletin: { type: 'derniers', nombre: 3 } }
        : { docTypes: [docType] },
    )
  ).ids[0] as string;

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 3 });
  db = new TenantDb();
  service = new DocumentRequestsService(db, new NotificationsService(db), new EncryptionService());

  for (const [id, nom] of [
    [rhUserId, 'rh'],
    [awaUserId, 'awa'],
    [moussaUserId, 'moussa'],
    [khadyUserId, 'khady'],
  ] as const) {
    await raw(
      `INSERT INTO users (id, email, password_hash, given_name, family_name)
       VALUES ($1,$2,'x','Test',$3)`,
      [id, `${nom}-${id}@test.local`, nom],
    );
  }
  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1,'Remise',$2)`, [
    tenantId,
    `remise-${tenantId.slice(0, 8)}`,
  ]);
  for (const userId of [rhUserId, awaUserId, moussaUserId, khadyUserId]) {
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
  await raw(`DELETE FROM habilitations WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM assignments WHERE tenant_id = $1`, [tenantId]);
  await raw(`UPDATE org_units SET manager_employee_id = NULL WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM employees WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM persons WHERE tenant_id = $1`, [tenantId]);

  const rhEmployeeId = randomUUID();
  khadyEmployeeId = randomUUID();
  for (const [employeeId, userId, prenom, nom, matricule] of [
    [randomUUID(), awaUserId, 'Awa', 'Diop', 'EMP-001'],
    [randomUUID(), moussaUserId, 'Moussa', 'Ndiaye', 'EMP-002'],
    [rhEmployeeId, rhUserId, 'Ibrahima', 'Ba', 'EMP-003'],
    [khadyEmployeeId, khadyUserId, 'Khady', 'Fall', 'EMP-004'],
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
  // Ibrahima dirige la DCH ; Khady y traite les attestations de travail.
  for (const [employeeId, poste] of [
    [rhEmployeeId, 'Directeur'],
    [khadyEmployeeId, 'Chargée RH'],
  ] as const) {
    await raw(
      `INSERT INTO assignments (id, tenant_id, employee_id, org_unit_id, position_title, validity)
       VALUES ($1,$2,$3,$4,$5, daterange('2024-01-01', NULL))`,
      [randomUUID(), tenantId, employeeId, dchId, poste],
    );
  }
  await raw(`UPDATE org_units SET manager_employee_id = $2 WHERE id = $1`, [dchId, rhEmployeeId]);
  await raw(
    `INSERT INTO habilitations (id, tenant_id, capacite, employee_id)
     VALUES ($1,$2,'demandes.documents.attestation_travail',$3)`,
    [randomUUID(), tenantId, khadyEmployeeId],
  );
});

afterAll(async () => {
  await raw(`UPDATE org_units SET manager_employee_id = NULL WHERE tenant_id = $1`, [tenantId]);
  for (const table of [
    'document_requests',
    'notifications',
    'habilitations',
    'assignments',
    'org_units',
    'employees',
    'persons',
    'user_tenant_memberships',
  ]) {
    await raw(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  }
  await raw(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  await raw(`DELETE FROM users WHERE id IN ($1,$2,$3,$4)`, [
    rhUserId,
    awaUserId,
    moussaUserId,
    khadyUserId,
  ]);
  await db?.pool.end();
  await ownerPool?.end();
});

describe('déposer', () => {
  it('chiffre le document au repos, nom compris', async () => {
    const id = await demander(awa);
    const f = await service.deposer(rh, id, fichier(PDF, 'attestation Awa.pdf'));
    expect(f).toMatchObject({ filename: 'attestation Awa.pdf', sizeBytes: PDF.length });
    const { rows } = await raw(
      `SELECT filename, data, cle_version FROM document_request_files WHERE id = $1`,
      [f.id],
    );
    const enBase = rows[0] as { filename: string; data: Buffer; cle_version: number };
    expect(enBase.cle_version).not.toBeNull();
    expect(enBase.filename).not.toContain('attestation');
    expect(enBase.data.includes(Buffer.from('%PDF'))).toBe(false);
  });

  it('est réservé à qui traite la demande, et jamais la sienne', async () => {
    const id = await demander(awa);
    expect(await codeOf(() => service.deposer(moussa, id, fichier(PDF)))).toBe(
      'demandes.pas_traitant',
    );
    expect(await codeOf(() => service.deposer(awa, id, fichier(PDF)))).toBe(
      'demandes.pas_traitant',
    );
    // Sa propre demande de bulletin, Khady ne la traite pas : elle revient à
    // la direction de la DCH.
    const sienne = await demander(khady, 'bulletin_salaire');
    expect(await codeOf(() => service.deposer(khady, sienne, fichier(PDF)))).toBe(
      'demandes.pas_traitant',
    );
  });

  it('vérifie ce que le fichier est, et sa taille', async () => {
    const id = await demander(awa);
    expect(await codeOf(() => service.deposer(rh, id, fichier(Buffer.from('pas un pdf'))))).toBe(
      'documents.bad_format',
    );
    expect(await codeOf(() => service.deposer(rh, id, fichier(PDF, 'scan.png', 'image/png')))).toBe(
      'documents.bad_format',
    );
    expect(await codeOf(() => service.deposer(rh, id, fichier(PNG, 'scan.png', 'image/png')))).toBe(
      'AUCUNE ERREUR',
    );
    expect(
      deposerFichierSchema.safeParse({ ...fichier(PDF), contentType: 'application/zip' }).success,
    ).toBe(false);
  });

  it('refuse une demande close', async () => {
    const id = await demander(awa);
    await service.advance(rh, id, { status: 'rejected', message: 'Dossier incomplet' });
    expect(await codeOf(() => service.deposer(rh, id, fichier(PDF)))).toBe(
      'documents.deja_traitee',
    );
  });
});

describe('ce que voit l’agent', () => {
  it('ne voit le document qu’une fois la demande prête', async () => {
    const id = await demander(awa);
    const f = await service.deposer(rh, id, fichier(PDF));
    expect((await vue(awa, id, 'mine')).fichiers).toEqual([]);
    expect(await codeOf(() => service.fichier(awa, id, f.id))).toBe(
      'documents.fichier_introuvable',
    );
    // Qui traite voit ce qui va partir.
    expect((await vue(rh, id)).fichiers.map((x) => x.id)).toEqual([f.id]);

    await service.batchAdvance(rh, { ids: [id], status: 'ready' });
    expect((await vue(awa, id, 'mine')).fichiers.map((x) => x.filename)).toEqual([
      'bulletin-septembre.pdf',
    ]);
    const telecharge = await service.fichier(awa, id, f.id);
    expect(telecharge.data.equals(PDF)).toBe(true);
    expect(telecharge.contentType).toBe('application/pdf');
  });

  it('n’a pas à passer au bureau : pas de point de retrait par défaut', async () => {
    const id = await demander(awa);
    await service.deposer(rh, id, fichier(PDF));
    await service.batchAdvance(rh, { ids: [id], status: 'ready' });
    expect((await vue(awa, id, 'mine')).pickupContact).toBeNull();
    expect(await titresDe(awaUserId)).toEqual([
      'Votre attestation de travail est déposée dans votre espace',
    ]);

    // Sans document, le retrait se fait toujours auprès de qui a traité.
    const autre = await demander(moussa);
    await service.batchAdvance(rh, { ids: [autre], status: 'ready' });
    expect((await vue(moussa, autre, 'mine')).pickupContact).toBe('Ibrahima Ba');
  });

  it('nomme les bulletins déposés, l’original à retirer s’il est dit', async () => {
    const id = await demander(awa, 'bulletin_salaire');
    await service.deposer(rh, id, fichier(PDF, 'juillet.pdf'));
    await service.deposer(rh, id, fichier(PDF, 'aout.pdf'));
    await service.batchAdvance(rh, { ids: [id], status: 'ready', pickupContact: 'Ibrahima Ba' });
    expect(await titresDe(awaUserId)).toEqual([
      'Vos 3 derniers bulletins de salaire sont déposés dans votre espace, l’original à retirer auprès d’Ibrahima Ba',
    ]);
  });

  it('ne lit pas le document d’un autre', async () => {
    const id = await demander(awa);
    const f = await service.deposer(rh, id, fichier(PDF));
    await service.batchAdvance(rh, { ids: [id], status: 'ready' });
    expect(await codeOf(() => service.fichier(moussa, id, f.id))).toBe('documents.forbidden_scope');
  });
});

describe('côté DCH', () => {
  it('ouvre le document à qui traite ce type, pas aux autres', async () => {
    const attestation = await demander(awa);
    const a = await service.deposer(khady, attestation, fichier(PDF));
    const bulletin = await demander(moussa, 'bulletin_salaire');
    const b = await service.deposer(rh, bulletin, fichier(PDF));
    expect(await codeOf(() => service.fichier(khady, attestation, a.id))).toBe('AUCUNE ERREUR');
    // Khady traite les attestations : un bulletin de salaire ne s'ouvre pas à elle.
    expect(await codeOf(() => service.fichier(khady, bulletin, b.id))).toBe(
      'documents.forbidden_scope',
    );
    expect(await codeOf(() => service.fichier(rh, bulletin, b.id))).toBe('AUCUNE ERREUR');
  });

  it('prête, ses documents restent à qui traite ce type de document', async () => {
    const bulletin = await demander(moussa, 'bulletin_salaire');
    const b = await service.deposer(rh, bulletin, fichier(PDF, 'juillet.pdf'));
    const attestation = await demander(awa);
    await service.deposer(khady, attestation, fichier(PDF));
    await service.batchAdvance(rh, { ids: [bulletin, attestation], status: 'ready' });

    // Khady corrige les attestations remises, pas les bulletins de salaire.
    expect(await codeOf(() => service.deposer(khady, bulletin, fichier(PDF)))).toBe(
      'documents.forbidden_scope',
    );
    expect(await codeOf(() => service.retirerFichier(khady, bulletin, b.id))).toBe(
      'documents.forbidden_scope',
    );
    expect(await codeOf(() => service.deposer(khady, attestation, fichier(PDF)))).toBe(
      'AUCUNE ERREUR',
    );
    // L'écran le sait d'avance : il ne propose que ce que le serveur accepte.
    expect((await vue(khady, bulletin)).canHandleFiles).toBe(false);
    expect((await vue(khady, attestation)).canHandleFiles).toBe(true);
    expect((await vue(rh, bulletin)).canHandleFiles).toBe(true);
    expect((await vue(moussa, bulletin, 'mine')).canHandleFiles).toBe(false);
  });

  it('retire un mauvais fichier, mais garde le dernier d’une demande prête', async () => {
    const id = await demander(awa);
    const mauvais = await service.deposer(rh, id, fichier(PDF, 'mauvais.pdf'));
    await service.batchAdvance(rh, { ids: [id], status: 'ready' });
    expect(await codeOf(() => service.retirerFichier(rh, id, mauvais.id))).toBe(
      'documents.dernier_fichier',
    );
    // Le bon d'abord, et un nouvel avis part ; puis le mauvais s'en va.
    await raw(`DELETE FROM notifications WHERE tenant_id = $1`, [tenantId]);
    await service.deposer(rh, id, fichier(PDF, 'bon.pdf'));
    expect(await titresDe(awaUserId)).toEqual([
      'Votre attestation de travail est déposée dans votre espace',
    ]);
    await service.retirerFichier(rh, id, mauvais.id);
    expect((await vue(awa, id, 'mine')).fichiers.map((x) => x.filename)).toEqual(['bon.pdf']);
  });

  it('n’en garde aucun d’une demande refusée ou annulée', async () => {
    const refusee = await demander(awa);
    await service.deposer(rh, refusee, fichier(PDF));
    await service.advance(rh, refusee, { status: 'rejected', message: 'Doublon' });
    const annulee = await demander(moussa);
    await service.deposer(rh, annulee, fichier(PDF));
    await service.cancel(moussa, annulee);
    const { rows } = await raw(
      `SELECT count(*)::int AS n FROM document_request_files WHERE request_id IN ($1, $2)`,
      [refusee, annulee],
    );
    expect((rows[0] as { n: number }).n).toBe(0);
  });

  it('plafonne à douze fichiers par demande', async () => {
    const id = await demander(awa);
    for (let i = 0; i < 12; i++) await service.deposer(rh, id, fichier(PDF, `p${i}.pdf`));
    expect(await codeOf(() => service.deposer(rh, id, fichier(PDF)))).toBe(
      'documents.trop_de_fichiers',
    );
  });
});
