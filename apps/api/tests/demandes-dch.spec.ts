/**
 * Documents, changements d'informations, pièces : tout va à la DCH.
 *
 * Décidé avec l'APIX : par défaut, le directeur du Capital Humain traite
 * toutes les demandes. Il peut en confier chaque type à des membres de sa
 * direction (habilitation), ou une demande à la fois. Les membres habilités
 * sont appelés — pas lui ; il voit tout, et garde la main. Personne ne
 * traite sa propre demande.
 *
 * Le bac d'essai : la DG ; la DCH, dirigée par Mariama, avec Awa et Khady ;
 * la DSID, où travaille Moussa ; l'administrateur.
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Capacite, SessionUser } from '@teranga/contracts';
import { ProblemException } from '../src/common/problem';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import { HabilitationsService } from '../src/modules/acces/habilitations.service';
import { confierLaDemande } from '../src/modules/acces/demandes';
import { DocumentRequestsService } from '../src/modules/docs/document-requests.service';
import { EmployeeDocumentsService } from '../src/modules/docs/employee-documents.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { ProfileChangesService } from '../src/modules/profile/profile-changes.service';
import { reconcilierLeCircuit } from '../src/modules/time/visas';

const env = loadEnv();
const tenantId = randomUUID();

let ownerPool: Pool;
let db: TenantDb;
let documents: DocumentRequestsService;
let informations: ProfileChangesService;
let pieces: EmployeeDocumentsService;
let habilitations: HabilitationsService;

const raw = (q: string, p: unknown[] = []) => ownerPool.query(q, p as never[]);

async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'AUCUNE ERREUR';
  } catch (err) {
    if (err instanceof ProblemException) return err.problem.code;
    return `NON-PROBLEM: ${(err as Error).message}`;
  }
}

interface Agent {
  employeeId: string;
  session: SessionUser;
}

async function compte(prenom: string, role: string): Promise<SessionUser> {
  const userId = randomUUID();
  await raw(
    `INSERT INTO users (id, email, password_hash, given_name, family_name)
     VALUES ($1,$2,'x',$3,'Test')`,
    [userId, `${prenom.toLowerCase()}-${userId}@test.local`, prenom],
  );
  await raw(
    `INSERT INTO user_tenant_memberships (id, tenant_id, user_id, role) VALUES ($1,$2,$3,$4)`,
    [randomUUID(), tenantId, userId, role],
  );
  return { userId, tenantId, role, givenName: prenom, familyName: 'Test' } as SessionUser;
}

async function agent(prenom: string, unite: string): Promise<Agent> {
  const session = await compte(prenom, 'employee');
  const personId = randomUUID();
  const employeeId = randomUUID();
  await raw(
    `INSERT INTO persons (id, tenant_id, user_id, given_name, family_name) VALUES ($1,$2,$3,$4,'Test')`,
    [personId, tenantId, session.userId, prenom],
  );
  await raw(
    `INSERT INTO employees (id, tenant_id, person_id, employee_number, hired_on)
     VALUES ($1,$2,$3,$4,'2024-01-01')`,
    [employeeId, tenantId, personId, `DD-${prenom}`],
  );
  await raw(
    `INSERT INTO assignments (id, tenant_id, employee_id, org_unit_id, position_title, validity)
     VALUES ($1,$2,$3,$4,'Agent', daterange('2024-01-01', NULL))`,
    [randomUUID(), tenantId, employeeId, unite],
  );
  return { employeeId, session };
}

async function unite(nom: string, parent: string | null, dch = false): Promise<string> {
  const id = randomUUID();
  await raw(
    `INSERT INTO org_units (id, tenant_id, unit_type, name, parent_id, direction_du_personnel)
     VALUES ($1,$2,'direction',$3,$4,$5)`,
    [id, tenantId, nom, parent, dch],
  );
  return id;
}

let uDCH: string;
let mariama: Agent;
let awa: Agent;
let khady: Agent;
let moussa: Agent;
let admin: SessionUser;

/** Qui a reçu un appel pour cette demande (`document`, `information`, `piece`). */
async function appels(prefixe: string, id: string): Promise<string[]> {
  const { rows } = await raw(
    `SELECT u.given_name AS qui, split_part(n.dedupe_key, ':', 4) AS etape
       FROM notifications n JOIN users u ON u.id = n.recipient_user_id
      WHERE n.dedupe_key LIKE $1 ORDER BY 2, 1`,
    [`${prefixe}:${id}:appel:%`],
  );
  return rows.map((r) => `${r.etape}:${r.qui}`);
}

const habiliter = (qui: Agent, capacite: Capacite, accordee = true) =>
  habilitations.accorder(mariama.session, { employeeId: qui.employeeId, capacite, accordee });

const reconcilier = () =>
  db.withTenant({ tenantId, userId: admin.userId }, (tx) => reconcilierLeCircuit(tx, tenantId));

const PDF = Buffer.from('%PDF-1.4 essai').toString('base64');

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 3 });
  db = new TenantDb();
  const notifications = new NotificationsService(db);
  documents = new DocumentRequestsService(db, notifications);
  informations = new ProfileChangesService(db, notifications);
  pieces = new EmployeeDocumentsService(db, notifications);
  habilitations = new HabilitationsService(db);
  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1,'Demandes',$2)`, [
    tenantId,
    `demandes-${tenantId.slice(0, 8)}`,
  ]);
  admin = await compte('Ibrahima', 'admin');
  const uDG = await unite('Direction Générale', null);
  uDCH = await unite('Direction du Capital Humain', uDG, true);
  const uDSID = await unite('Direction des Systèmes', uDG);
  mariama = await agent('Mariama', uDCH);
  awa = await agent('Awa', uDCH);
  khady = await agent('Khady', uDCH);
  moussa = await agent('Moussa', uDSID);
});

beforeEach(async () => {
  for (const table of [
    'notifications',
    'document_requests',
    'profile_change_requests',
    'employee_documents',
    'habilitations',
  ]) {
    await raw(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  }
  await raw(`UPDATE org_units SET manager_employee_id = $2 WHERE id = $1`, [
    uDCH,
    mariama.employeeId,
  ]);
});

afterAll(async () => {
  for (const table of [
    'notifications',
    'document_requests',
    'profile_change_requests',
    'employee_documents',
    'habilitations',
  ]) {
    await raw(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  }
  await raw(`UPDATE org_units SET manager_employee_id = NULL WHERE tenant_id = $1`, [tenantId]);
  for (const table of [
    'assignments',
    'org_units',
    'employees',
    'persons',
    'user_tenant_memberships',
  ]) {
    await raw(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  }
  await raw(`DELETE FROM audit_log WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  await db?.pool.end();
  await ownerPool?.end();
});

describe('les demandes de documents', () => {
  it('par défaut, le directeur du Capital Humain : lui seul est appelé, lui seul traite', async () => {
    const { id } = await documents.create(moussa.session, { docTypes: ['attestation_travail'] });
    expect(await appels('document', id)).toEqual(['dch:Mariama']);
    expect(await codeOf(() => documents.advance(admin, id, { status: 'processing' }))).toBe(
      'demandes.pas_traitant',
    );
    expect(await codeOf(() => documents.advance(awa.session, id, { status: 'processing' }))).toBe(
      'demandes.pas_traitant',
    );
    await documents.advance(mariama.session, id, { status: 'processing' });
    await documents.advance(mariama.session, id, { status: 'ready' });
    expect(await appels('document', id)).toEqual([]);
  });

  it('confiées à deux membres : les deux sont appelés ; qui la prend en charge la garde', async () => {
    const { id } = await documents.create(moussa.session, { docTypes: ['attestation_travail'] });
    await habiliter(awa, 'demandes.documents');
    await habiliter(khady, 'demandes.documents');
    expect(await appels('document', id)).toEqual(['dch:Awa', 'dch:Khady']);
    await documents.advance(awa.session, id, { status: 'processing' });
    expect(await appels('document', id)).toEqual(['dch:Awa']);
    expect(await codeOf(() => documents.advance(khady.session, id, { status: 'ready' }))).toBe(
      'demandes.pas_traitant',
    );
    // Le directeur garde la main.
    await documents.advance(mariama.session, id, { status: 'ready' });
    expect(await appels('document', id)).toEqual([]);
  });

  it('chacun voit les siennes ; la file entière, qui la traite ou consulte les dossiers', async () => {
    const { id } = await documents.create(moussa.session, { docTypes: ['attestation_travail'] });
    await habiliter(awa, 'demandes.documents');
    expect((await documents.list(moussa.session, {})).map((r) => r.id)).toEqual([id]);
    expect(await documents.list(khady.session, {})).toEqual([]);
    const [vueAwa] = await documents.list(awa.session, {});
    expect(vueAwa).toMatchObject({
      canAdvance: true,
      traitement: { traitants: 'Awa Test', peutConfier: false, aConfier: false },
    });
    const [vueAdmin] = await documents.list(admin, {});
    expect(vueAdmin).toMatchObject({ canAdvance: false });
    const [vueDirecteur] = await documents.list(mariama.session, {});
    expect(vueDirecteur).toMatchObject({ canAdvance: true, traitement: { peutConfier: true } });
  });

  it('la demande du directeur lui-même : à lui de la confier, jamais de la traiter', async () => {
    const { id } = await documents.create(mariama.session, { docTypes: ['attestation_travail'] });
    expect(await appels('document', id)).toEqual(['a-confier:Mariama']);
    expect(
      await codeOf(() => documents.advance(mariama.session, id, { status: 'processing' })),
    ).toBe('demandes.la_sienne');
    const r = await db.withTenant({ tenantId, userId: mariama.session.userId }, (tx) =>
      confierLaDemande(tx, mariama.session, 'documents', id, khady.employeeId),
    );
    expect(r.proposerHabilitation).toBe(true);
    expect(await appels('document', id)).toEqual(['dch:Khady']);
    await documents.advance(khady.session, id, { status: 'processing' });
  });

  it('une demande en attente depuis plus de deux jours ouvrés : un rappel à qui la traite', async () => {
    const { id } = await documents.create(moussa.session, { docTypes: ['attestation_travail'] });
    await raw(
      `UPDATE notifications SET created_at = now() - interval '10 days' WHERE dedupe_key = $1`,
      [`document:${id}:appel:dch`],
    );
    await reconcilier();
    const { rows } = await raw(
      `SELECT u.given_name AS qui FROM notifications n
         JOIN users u ON u.id = n.recipient_user_id WHERE n.dedupe_key = $1`,
      [`document:${id}:rappel:dch`],
    );
    expect(rows).toEqual([{ qui: 'Mariama' }]);
  });

  it('personne à la DCH pour la traiter : l’administrateur est prévenu', async () => {
    await raw(`UPDATE org_units SET manager_employee_id = NULL WHERE id = $1`, [uDCH]);
    const { id } = await documents.create(moussa.session, { docTypes: ['attestation_travail'] });
    await reconcilier();
    expect(await appels('document', id)).toEqual([]);
    const { rows } = await raw(
      `SELECT recipient_user_id FROM notifications WHERE dedupe_key = 'dch:vacante' AND tenant_id = $1`,
      [tenantId],
    );
    expect(rows).toEqual([{ recipient_user_id: admin.userId }]);
  });
});

describe('les changements d’informations', () => {
  it('vont au directeur, puis au membre habilité — qui tranche', async () => {
    const { id } = await informations.create(moussa.session, { changes: { city: 'Thiès' } });
    expect(await appels('information', id)).toEqual(['dch:Mariama']);
    await habiliter(khady, 'demandes.informations');
    expect(await appels('information', id)).toEqual(['dch:Khady']);
    expect(await codeOf(() => informations.decide(admin, id, { decision: 'approve' }))).toBe(
      'demandes.pas_traitant',
    );
    await informations.decide(khady.session, id, { decision: 'approve' });
    expect(await appels('information', id)).toEqual([]);
  });

  it('retirée, l’habilitation rend la demande au directeur', async () => {
    const { id } = await informations.create(moussa.session, { changes: { city: 'Saint-Louis' } });
    await habiliter(khady, 'demandes.informations');
    await habiliter(khady, 'demandes.informations', false);
    expect(await appels('information', id)).toEqual(['dch:Mariama']);
  });
});

describe('les pièces justificatives', () => {
  const deposer = () =>
    pieces.upload(moussa.session, moussa.employeeId, {
      category: 'diplome',
      label: 'Master',
      filename: 'master.pdf',
      contentType: 'application/pdf',
      contentBase64: PDF,
    });

  it('déposée par l’agent : la DCH la vérifie — le membre habilité, dans sa file', async () => {
    const { id } = await deposer();
    expect(await appels('piece', id)).toEqual(['dch:Mariama']);
    expect(await codeOf(() => pieces.review(awa.session, id, { decision: 'approved' }))).toBe(
      'documents.forbidden_scope',
    );
    expect(await pieces.file(awa.session)).toEqual([]);
    await habiliter(awa, 'demandes.pieces');
    const file = await pieces.file(awa.session);
    expect(file.map((p) => `${p.employeeName}:${p.label}:${p.canReview}`)).toEqual([
      'Moussa Test:Master:true',
    ]);
    await pieces.review(awa.session, id, { decision: 'approved' });
    expect(await appels('piece', id)).toEqual([]);
  });

  it('le contenu : le titulaire, et qui vérifie les pièces — pas un autre agent', async () => {
    const { id } = await deposer();
    expect(await codeOf(() => pieces.content(khady.session, id))).toBe('documents.forbidden_scope');
    await habiliter(khady, 'demandes.pieces');
    expect((await pieces.content(khady.session, id)).filename).toBe('master.pdf');
    expect((await pieces.content(moussa.session, id)).filename).toBe('master.pdf');
  });
});
