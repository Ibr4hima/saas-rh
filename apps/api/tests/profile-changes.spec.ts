/**
 * Demandes de correction des informations personnelles.
 *
 * Le point sensible est l'APPLICATION : confirmer écrit dans `persons` à partir
 * d'un jsonb qui a transité par le disque. Rien ne garantit qu'il porte encore
 * la forme attendue, et une recopie naïve des clés serait une affectation de
 * masse — le chemin par lequel un employé écrirait son propre matricule ou son
 * statut. D'où la revalidation et la liste blanche, testées ici.
 *
 * Celui qui tranche dirige la Direction du Capital Humain : c'est
 * l'organigramme, pas un rôle, qui lui donne la file.
 */
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createProfileChangeRequestSchema, type SessionUser } from '@teranga/contracts';
import { EncryptionService } from '../src/common/encryption.service';
import { ProblemException } from '../src/common/problem';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import * as t from '../src/db/schema';
import { TenantDb } from '../src/db/tenant-db';
import { EmployeeDocumentsService } from '../src/modules/docs/employee-documents.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { ProfileChangesService } from '../src/modules/profile/profile-changes.service';

const env = loadEnv();

const tenantId = randomUUID();
const rhUserId = randomUUID();
const agentUserId = randomUUID();
const collegueUserId = randomUUID();
let personId: string;
let employeeId: string;

const rh = { userId: rhUserId, tenantId, role: 'employee' } as SessionUser;
const dchId = randomUUID();
const agent = { userId: agentUserId, tenantId, role: 'employee' } as SessionUser;
/** Un agent hors de la DCH, sans habilitation : ni la file, ni les dossiers. */
const collegue = { userId: collegueUserId, tenantId, role: 'employee' } as SessionUser;

let ownerPool: Pool;
let db: TenantDb;
let service: ProfileChangesService;
let pieces: EmployeeDocumentsService;

/** Un certificat de mariage : un PDF, tel que la mairie le délivre. */
const PDF = Buffer.from('%PDF-1.4\n% Certificat de mariage\n%%EOF\n');
const CERTIFICAT = {
  filename: 'certificat-mariage.pdf',
  contentType: 'application/pdf' as const,
  contentBase64: PDF.toString('base64'),
};

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
    `SELECT address_line, marital_status, personal_email, given_name, family_name,
            emergency_contact_name
     FROM persons WHERE id = $1`,
    [personId],
  );
  return rows[0] as Record<string, string | null>;
}

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 3 });
  db = new TenantDb();
  const enc = new EncryptionService();
  service = new ProfileChangesService(db, new NotificationsService(db), enc);
  pieces = new EmployeeDocumentsService(db, new NotificationsService(db), enc);

  for (const [id, mail] of [
    [rhUserId, 'rh'],
    [agentUserId, 'agent'],
    [collegueUserId, 'collegue'],
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
  for (const userId of [rhUserId, agentUserId, collegueUserId]) {
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
  await raw(`DELETE FROM profile_change_requests WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM employee_documents WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM notifications WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM assignments WHERE tenant_id = $1`, [tenantId]);
  await raw(`UPDATE org_units SET manager_employee_id = NULL WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM employees WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM persons WHERE tenant_id = $1`, [tenantId]);
  // Qui dirige la DCH : il a un dossier, rattaché à la direction du personnel.
  const rhPersonId = randomUUID();
  const rhEmployeeId = randomUUID();
  await raw(
    `INSERT INTO persons (id, tenant_id, user_id, given_name, family_name)
     VALUES ($1,$2,$3,'Mariama','Cissé')`,
    [rhPersonId, tenantId, rhUserId],
  );
  await raw(
    `INSERT INTO employees (id, tenant_id, person_id, employee_number, hired_on)
     VALUES ($1,$2,$3,'DCH-1','2020-01-01')`,
    [rhEmployeeId, tenantId, rhPersonId],
  );
  await raw(
    `INSERT INTO assignments (id, tenant_id, employee_id, org_unit_id, position_title, validity)
     VALUES ($1,$2,$3,$4,'Directrice', daterange('2020-01-01', NULL))`,
    [randomUUID(), tenantId, rhEmployeeId, dchId],
  );
  await raw(`UPDATE org_units SET manager_employee_id = $2 WHERE id = $1`, [dchId, rhEmployeeId]);
  personId = randomUUID();
  employeeId = randomUUID();
  await raw(
    `INSERT INTO persons (id, tenant_id, user_id, given_name, family_name, gender, address_line)
     VALUES ($1,$2,$3,'Awa','Diop','female','Sicap Liberté')`,
    [personId, tenantId, agentUserId],
  );
  await raw(
    `INSERT INTO employees (id, tenant_id, person_id, employee_number, hired_on)
     VALUES ($1,$2,$3,'AG-1','2024-01-01')`,
    [employeeId, tenantId, personId],
  );
  const colleguePersonId = randomUUID();
  await raw(
    `INSERT INTO persons (id, tenant_id, user_id, given_name, family_name)
     VALUES ($1,$2,$3,'Ousmane','Fall')`,
    [colleguePersonId, tenantId, collegueUserId],
  );
  await raw(
    `INSERT INTO employees (id, tenant_id, person_id, employee_number, hired_on)
     VALUES ($1,$2,$3,'AG-2','2024-01-01')`,
    [randomUUID(), tenantId, colleguePersonId],
  );
});

afterAll(async () => {
  await raw(`UPDATE org_units SET manager_employee_id = NULL WHERE tenant_id = $1`, [tenantId]);
  for (const table of [
    'profile_change_requests',
    'employee_documents',
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
  await raw(`DELETE FROM users WHERE id IN ($1,$2,$3)`, [rhUserId, agentUserId, collegueUserId]);
  await db?.pool.end();
  await ownerPool?.end();
});

describe('signalement par l’employé', () => {
  it('enregistre les champs modifiés avec leur valeur précédente', async () => {
    await service.create(agent, {
      changes: { addressLine: 'Cité Malick Sy' },
      note: 'Déménagement',
    });
    const [vue] = await service.list(rh, {});
    if (!vue) throw new Error('demande absente');
    expect(vue.status).toBe('pending');
    expect(vue.fields).toEqual([
      {
        field: 'addressLine',
        label: 'Adresse',
        previous: 'Sicap Liberté',
        next: 'Cité Malick Sy',
        // Le dossier n'a pas bougé depuis : rien à signaler.
        actuel: 'Sicap Liberté',
        modifieDepuis: false,
      },
    ]);
  });

  it('accorde le libellé de situation matrimoniale au sexe', async () => {
    await service.create(agent, { changes: { maritalStatus: 'married' }, certificat: CERTIFICAT });
    const [vue] = await service.list(rh, {});
    if (!vue) throw new Error('demande absente');
    expect(vue.fields[0]!.next).toBe('Mariée');
  });

  it('refuse une demande qui ne change rien', async () => {
    expect(
      await codeOf(() => service.create(agent, { changes: { addressLine: 'Sicap Liberté' } })),
    ).toBe('profile.no_change');
  });

  it('refuse une seconde demande tant que la première attend', async () => {
    await service.create(agent, { changes: { addressLine: 'Cité Malick Sy' } });
    expect(await codeOf(() => service.create(agent, { changes: { addressLine: 'Mermoz' } }))).toBe(
      'profile.request_already_pending',
    );
  });

  it('prévient la DCH — qui la dirige, faute de membre habilité', async () => {
    await service.create(agent, { changes: { addressLine: 'Cité Malick Sy' } });
    const { rows } = await raw(
      `SELECT title, link FROM notifications WHERE recipient_user_id = $1 AND type = 'demande_a_traiter'`,
      [rhUserId],
    );
    expect(rows).toHaveLength(1);
    expect((rows[0] as { title: string }).title).toContain('Awa Diop');
    expect((rows[0] as { link: string }).link).toBe('/demandes/informations');
  });
});

describe('décision de la RH', () => {
  it('confirmer applique les valeurs au dossier', async () => {
    await service.create(agent, {
      changes: {
        addressLine: 'Cité Malick Sy',
        maritalStatus: 'married',
        personalEmail: 'awa.diop@exemple.sn',
      },
      certificat: CERTIFICAT,
    });
    const [vue] = await service.list(rh, {});
    if (!vue) throw new Error('demande absente');
    await service.decide(rh, vue.id, { decision: 'approve' });
    expect(await dossier()).toMatchObject({
      address_line: 'Cité Malick Sy',
      marital_status: 'married',
      personal_email: 'awa.diop@exemple.sn',
    });
  });

  it('refuser laisse le dossier intact et exige un motif', async () => {
    await service.create(agent, { changes: { addressLine: 'Cité Malick Sy' } });
    const [vue] = await service.list(rh, {});
    if (!vue) throw new Error('demande absente');
    expect(await codeOf(() => service.decide(rh, vue.id, { decision: 'reject' }))).toBe(
      'profile.reject_reason_required',
    );
    await service.decide(rh, vue.id, { decision: 'reject', message: 'Justificatif attendu' });
    expect((await dossier()).address_line).toBe('Sicap Liberté');
  });

  it('refuse de traiter deux fois la même demande', async () => {
    await service.create(agent, { changes: { addressLine: 'Cité Malick Sy' } });
    const [vue] = await service.list(rh, {});
    if (!vue) throw new Error('demande absente');
    await service.decide(rh, vue.id, { decision: 'approve' });
    expect(await codeOf(() => service.decide(rh, vue.id, { decision: 'approve' }))).toBe(
      'profile.request_already_handled',
    );
  });

  it('prévient l’employé de la décision', async () => {
    await service.create(agent, { changes: { addressLine: 'Cité Malick Sy' } });
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

  it('refusée, l’avis mène au suivi des demandes, sur elle (ADR-0081)', async () => {
    await service.create(agent, { changes: { addressLine: 'Sacré-Cœur 3' } });
    const [vue] = await service.list(rh, {});
    if (!vue) throw new Error('demande absente');
    await service.decide(rh, vue.id, { decision: 'reject', message: 'Précisez la villa.' });
    const { rows } = await raw(
      `SELECT type, title, link FROM notifications
        WHERE recipient_user_id = $1 AND type LIKE 'profile_change_%'`,
      [agentUserId],
    );
    expect(rows).toEqual([
      {
        type: 'profile_change_reject',
        title: 'Votre demande de mise à jour est refusée',
        link: `/moi/documents/suivi?traitee=${vue.id}`,
      },
    ]);
    // Le motif se lit dans le suivi de l'agent.
    const [suivi] = await service.list(agent, { scope: 'mine' });
    expect(suivi).toMatchObject({
      id: vue.id,
      status: 'rejected',
      hrMessage: 'Précisez la villa.',
    });
  });
});

describe('le certificat de mariage (ADR-0080)', () => {
  /** Les pièces du dossier de l'agent, telles qu'en base. */
  async function piecesDuDossier() {
    const { rows } = await raw(
      `SELECT id, category, label, status, uploaded_by_user_id, uploaded_by_side,
              reviewed_by_user_id
         FROM employee_documents WHERE employee_id = $1`,
      [employeeId],
    );
    return rows as Record<string, string>[];
  }
  async function certificatsEnAttente() {
    const { rows } = await raw(
      `SELECT count(*)::int AS n FROM profile_change_documents WHERE tenant_id = $1`,
      [tenantId],
    );
    return (rows[0] as { n: number }).n;
  }

  it('passer à « Marié(e) » l’exige ; il n’accompagne que ce changement-là, en PDF', async () => {
    expect(
      await codeOf(() => service.create(agent, { changes: { maritalStatus: 'married' } })),
    ).toBe('profile.certificat_requis');
    expect(
      await codeOf(() =>
        service.create(agent, {
          changes: { addressLine: 'Mermoz' },
          certificat: CERTIFICAT,
        }),
      ),
    ).toBe('profile.certificat_sans_mariage');
    expect(
      await codeOf(() =>
        service.create(agent, {
          changes: { maritalStatus: 'married' },
          certificat: {
            ...CERTIFICAT,
            contentBase64: Buffer.from('pas un pdf').toString('base64'),
          },
        }),
      ),
    ).toBe('documents.bad_format');
    // Un autre état civil se déclare comme avant.
    await service.create(agent, { changes: { maritalStatus: 'divorced' } });
    expect(await certificatsEnAttente()).toBe(0);
  });

  it('chiffré au repos, il se lit par qui l’a envoyé et qui traite la file, pas au-delà', async () => {
    await service.create(agent, { changes: { maritalStatus: 'married' }, certificat: CERTIFICAT });
    const { rows } = await raw(
      `SELECT filename, data FROM profile_change_documents WHERE tenant_id = $1`,
      [tenantId],
    );
    const stocke = rows[0] as { filename: string; data: Buffer };
    expect(stocke.filename).not.toBe(CERTIFICAT.filename);
    expect(stocke.data.subarray(0, 5).toString()).not.toBe('%PDF-');

    const [mienne] = await service.list(agent, { scope: 'mine' });
    expect(mienne!.certificat).toEqual({ filename: CERTIFICAT.filename, sizeBytes: PDF.length });
    const [aTraiter] = await service.list(rh, {});
    expect(aTraiter!.certificat).toEqual(mienne!.certificat);

    for (const lecteur of [agent, rh]) {
      const lu = await service.certificat(lecteur, mienne!.id);
      expect(lu).toMatchObject({ filename: CERTIFICAT.filename, contentType: 'application/pdf' });
      expect(lu.data.equals(PDF)).toBe(true);
    }
    expect(await codeOf(() => service.certificat(collegue, mienne!.id))).toBe(
      'profile.forbidden_scope',
    );
  });

  it('validée, la demande le verse au dossier, et la situation change', async () => {
    await service.create(agent, { changes: { maritalStatus: 'married' }, certificat: CERTIFICAT });
    const [vue] = await service.list(rh, {});
    const { rows: joints } = await raw(
      `SELECT id FROM profile_change_documents WHERE request_id = $1`,
      [vue!.id],
    );
    await service.decide(rh, vue!.id, { decision: 'approve' });

    expect((await dossier()).marital_status).toBe('married');
    const [piece, ...autres] = await piecesDuDossier();
    expect(autres).toEqual([]);
    expect(piece).toMatchObject({
      category: 'certificat_mariage',
      label: 'Certificat de mariage',
      status: 'approved',
      uploaded_by_user_id: agentUserId,
      uploaded_by_side: 'employee',
      reviewed_by_user_id: rhUserId,
    });
    // Le même fichier, déchiffré à sa nouvelle place : l'agent le lit dans ses pièces.
    const lu = await pieces.content(agent, piece!.id!);
    expect(lu.filename).toBe(CERTIFICAT.filename);
    expect(lu.data.equals(PDF)).toBe(true);
    // La demande ne le garde plus ; le journal garde le dépôt et le retrait, sans le contenu.
    expect(await certificatsEnAttente()).toBe(0);
    expect((await service.list(agent, { scope: 'mine' }))[0]!.certificat).toBeNull();
    const { rows: journal } = await raw(
      `SELECT action, old_data ? 'data' AS ancien, new_data ? 'data' AS nouveau
         FROM audit_log WHERE table_name = 'profile_change_documents' AND row_id = $1
        ORDER BY occurred_at`,
      [(joints[0] as { id: string }).id],
    );
    expect(journal).toEqual([
      { action: 'INSERT', ancien: null, nouveau: false },
      { action: 'DELETE', ancien: false, nouveau: null },
    ]);
  });

  it('refusée ou annulée, la demande l’emporte : rien au dossier', async () => {
    await service.create(agent, { changes: { maritalStatus: 'married' }, certificat: CERTIFICAT });
    const [refusee] = await service.list(rh, {});
    await service.decide(rh, refusee!.id, { decision: 'reject', message: 'Illisible' });
    expect(await certificatsEnAttente()).toBe(0);

    await service.create(agent, { changes: { maritalStatus: 'married' }, certificat: CERTIFICAT });
    const enAttente = (await service.list(agent, { scope: 'mine' })).find(
      (r) => r.status === 'pending',
    );
    await service.cancel(agent, enAttente!.id);
    expect(await certificatsEnAttente()).toBe(0);

    expect(await piecesDuDossier()).toEqual([]);
    expect((await dossier()).marital_status).toBeNull();
  });
});

describe('affectation de masse', () => {
  it('N’ÉCRIT QUE les champs de la liste blanche, même si le jsonb en porte d’autres', async () => {
    await service.create(agent, { changes: { addressLine: 'Cité Malick Sy' } });
    const [vue] = await service.list(rh, {});
    if (!vue) throw new Error('demande absente');
    // On simule un jsonb corrompu en base : clés hors périmètre injectées
    // directement. Confirmer ne doit toucher NI le nom, NI rien d'autre.
    await raw(
      `UPDATE profile_change_requests
         SET changes = '{"addressLine":"Cité Malick Sy","familyName":"Pirate","givenName":"Pirate"}'::jsonb
       WHERE id = $1`,
      [vue.id],
    );
    await service.decide(rh, vue.id, { decision: 'approve' });
    const apres = await dossier();
    expect(apres.address_line).toBe('Cité Malick Sy');
    expect(apres.family_name).toBe('Diop');
    expect(apres.given_name).toBe('Awa');
  });

  it('applique ENTIÈRE une demande portant un champ qu’on ne propose plus', async () => {
    // Le contact d'urgence a quitté les formulaires, mais une demande déposée
    // avant ce retrait dort peut-être encore dans le circuit. Elle doit rester
    // lisible par la RH ET s'appliquer sans être amputée en silence : c'est
    // tout l'intérêt de garder sa validation et sa colonne.
    await service.create(agent, { changes: { addressLine: 'Mermoz' } });
    const [vue] = await service.list(rh, {});
    if (!vue) throw new Error('demande absente');
    await raw(
      `UPDATE profile_change_requests
         SET changes = '{"addressLine":"Mermoz","emergencyContactName":"Fatou Ba"}'::jsonb
       WHERE id = $1`,
      [vue.id],
    );

    const relue = (await service.list(rh, {})).find((r) => r.id === vue.id);
    const champs = relue!.fields.map((c) => c.label);
    expect(champs).toContain('Contact d’urgence');

    await service.decide(rh, vue.id, { decision: 'approve' });
    const apres = await dossier();
    expect(apres.address_line).toBe('Mermoz');
    expect(apres.emergency_contact_name).toBe('Fatou Ba');
  });
});

describe('périmètre de lecture', () => {
  it('scope=mine reste personnel même pour qui dirige la DCH', async () => {
    await service.create(agent, { changes: { addressLine: 'Cité Malick Sy' } });
    // Elle n'a rien demandé pour elle-même : son espace personnel est vide.
    expect(await service.list(rh, { scope: 'mine' })).toEqual([]);
    expect(await service.list(rh, {})).toHaveLength(1);
  });

  it('un employé ne voit que ses propres demandes et ne peut rien trancher', async () => {
    await service.create(agent, { changes: { addressLine: 'Cité Malick Sy' } });
    const vues = await service.list(agent, {});
    expect(vues).toHaveLength(1);
    expect(vues[0]!.canDecide).toBe(false);
  });
});

describe('la ville ne fait plus partie du dossier', () => {
  it('ne se demande plus : seule, la demande est vide et refusée', () => {
    const seule = createProfileChangeRequestSchema.safeParse({ changes: { city: 'Thiès' } });
    expect(seule.success).toBe(false);
    const avec = createProfileChangeRequestSchema.parse({
      changes: { city: 'Thiès', addressLine: 'Mermoz' },
    });
    expect(avec.changes).toEqual({ addressLine: 'Mermoz' });
  });

  it('n’existe plus dans la base', async () => {
    const { rows } = await raw(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'persons' AND column_name = 'city'`,
    );
    expect(rows).toHaveLength(0);
  });
});
