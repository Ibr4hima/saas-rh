/**
 * Documents, changements d'informations, pièces : tout va à la DCH.
 *
 * Décidé avec l'APIX : par défaut, le directeur du Capital Humain traite
 * toutes les demandes. Il peut en confier chaque type à des membres de sa
 * direction (habilitation) — les documents, type de document par type de
 * document —, ou une demande à la fois. Les membres habilités
 * sont appelés — pas lui ; il voit tout, et garde la main. Personne ne
 * traite sa propre demande.
 *
 * Le bac d'essai : la DG ; la DCH, dirigée par Mariama, avec Awa et Khady ;
 * la DSID, où travaille Moussa ; l'administrateur.
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Capacite, SessionUser } from '@teranga/contracts';
import { EncryptionService } from '../src/common/encryption.service';
import { ProblemException } from '../src/common/problem';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import { capacitesDe } from '../src/modules/acces/dch';
import { HabilitationsService } from '../src/modules/acces/habilitations.service';
import { AttestationService } from '../src/modules/documents/attestation.service';
import { OrgUnitsService } from '../src/modules/people/org-units.service';
import { PeopleService } from '../src/modules/people/people.service';
import { AbsencesService } from '../src/modules/time/absences.service';
import { aTraiterPar, confierLaDemande } from '../src/modules/acces/demandes';
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
let people: PeopleService;
let organigramme: OrgUnitsService;
let absences: AbsencesService;
let attestations: AttestationService;
let uDSID: string;

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
  pieces = new EmployeeDocumentsService(db, notifications, new EncryptionService());
  habilitations = new HabilitationsService(db);
  people = new PeopleService(db, new EncryptionService());
  organigramme = new OrgUnitsService(db);
  absences = new AbsencesService(db);
  attestations = new AttestationService(db);
  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1,'Demandes',$2)`, [
    tenantId,
    `demandes-${tenantId.slice(0, 8)}`,
  ]);
  admin = await compte('Ibrahima', 'admin');
  const uDG = await unite('Direction Générale', null);
  uDCH = await unite('Direction du Capital Humain', uDG, true);
  uDSID = await unite('Direction des Systèmes', uDG);
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
    'contracts',
    'notifications',
    'document_requests',
    'profile_change_requests',
    'employee_documents',
    'habilitations',
    'absence_balances',
    'absence_types',
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
    const [id] = (await documents.create(moussa.session, { docTypes: ['attestation_travail'] }))
      .ids as [string];
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
    const [id] = (await documents.create(moussa.session, { docTypes: ['attestation_travail'] }))
      .ids as [string];
    await habiliter(awa, 'demandes.documents.attestation_travail');
    await habiliter(khady, 'demandes.documents.attestation_travail');
    expect(await appels('document', id)).toEqual(['dch:Awa', 'dch:Khady']);
    // Déléguer n'ôte rien au directeur : la demande reste dans son compteur.
    const aTraiter = (qui: Agent) =>
      db.withTenant({ tenantId, userId: qui.session.userId }, (tx) =>
        aTraiterPar(tx, qui.employeeId),
      );
    expect((await aTraiter(mariama)).documents).toBe(1);
    expect((await aTraiter(awa)).documents).toBe(1);
    await documents.advance(awa.session, id, { status: 'processing' });
    expect(await appels('document', id)).toEqual(['dch:Awa']);
    expect(await codeOf(() => documents.advance(khady.session, id, { status: 'ready' }))).toBe(
      'demandes.pas_traitant',
    );
    // Le directeur garde la main.
    await documents.advance(mariama.session, id, { status: 'ready' });
    expect(await appels('document', id)).toEqual([]);
  });

  it('les documents se confient type par type : chaque document demandé va à qui le traite', async () => {
    await habiliter(awa, 'demandes.documents.attestation_travail');
    await habiliter(khady, 'demandes.documents.bulletin_salaire');
    const ids = (
      await documents.create(moussa.session, {
        docTypes: ['attestation_travail', 'bulletin_salaire', 'certificat_travail'],
        note: 'Dossier de visa',
      })
    ).ids;
    expect(ids).toHaveLength(3);
    const [attestation, bulletin, certificat] = ids as [string, string, string];
    expect(await appels('document', attestation)).toEqual(['dch:Awa']);
    expect(await appels('document', bulletin)).toEqual(['dch:Khady']);
    // Personne n'est habilité aux certificats : ils restent au directeur.
    expect(await appels('document', certificat)).toEqual(['dch:Mariama']);
    expect(
      await codeOf(() => documents.advance(awa.session, bulletin, { status: 'processing' })),
    ).toBe('demandes.pas_traitant');
    await documents.advance(awa.session, attestation, { status: 'processing' });
    const { rows } = await raw(
      `SELECT doc_types, note FROM document_requests WHERE id = ANY($1) ORDER BY doc_types`,
      [ids],
    );
    expect(rows).toEqual([
      { doc_types: ['attestation_travail'], note: 'Dossier de visa' },
      { doc_types: ['bulletin_salaire'], note: 'Dossier de visa' },
      { doc_types: ['certificat_travail'], note: 'Dossier de visa' },
    ]);
  });

  it('un document déjà demandé, et encore en cours, ne se redemande pas', async () => {
    await documents.create(moussa.session, { docTypes: ['attestation_travail'] });
    expect(
      await codeOf(() =>
        documents.create(moussa.session, { docTypes: ['bulletin_salaire', 'attestation_travail'] }),
      ),
    ).toBe('documents.deja_en_cours');
    // Rien n'est parti : le refus vaut pour tout l'envoi.
    const { rows } = await raw(
      `SELECT count(*)::int AS n FROM document_requests WHERE tenant_id = $1`,
      [tenantId],
    );
    expect(rows[0].n).toBe(1);
    // Quatre documents d'un coup : aucun plafond ne s'y oppose.
    const r = await documents.create(moussa.session, {
      docTypes: ['bulletin_salaire', 'attestation_salaire', 'certificat_travail', 'autre'],
    });
    expect(r.ids).toHaveLength(4);
  });

  it('chacun voit les siennes ; la file entière, qui la traite (l’administrateur la lit)', async () => {
    const [id] = (await documents.create(moussa.session, { docTypes: ['attestation_travail'] }))
      .ids as [string];
    await habiliter(awa, 'demandes.documents.attestation_travail');
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
    const [id] = (await documents.create(mariama.session, { docTypes: ['attestation_travail'] }))
      .ids as [string];
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
    const [id] = (await documents.create(moussa.session, { docTypes: ['attestation_travail'] }))
      .ids as [string];
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
    const [id] = (await documents.create(moussa.session, { docTypes: ['attestation_travail'] }))
      .ids as [string];
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
    const { id } = await informations.create(moussa.session, {
      changes: { addressLine: 'Cité Malick Sy' },
    });
    expect(await appels('information', id)).toEqual(['dch:Mariama']);
    await habiliter(khady, 'demandes.informations');
    expect(await appels('information', id)).toEqual(['dch:Khady']);
    // Le directeur la garde dans son compteur : il peut toujours trancher.
    const aTraiter = (qui: Agent) =>
      db.withTenant({ tenantId, userId: qui.session.userId }, (tx) =>
        aTraiterPar(tx, qui.employeeId),
      );
    expect((await aTraiter(mariama)).informations).toBe(1);
    expect((await aTraiter(khady)).informations).toBe(1);
    expect(
      (await informations.list(mariama.session, {} as never)).find((r) => r.id === id)?.canDecide,
    ).toBe(true);
    expect(await codeOf(() => informations.decide(admin, id, { decision: 'approve' }))).toBe(
      'demandes.pas_traitant',
    );
    await informations.decide(khady.session, id, { decision: 'approve' });
    expect(await appels('information', id)).toEqual([]);
  });

  it('retirée, l’habilitation rend la demande au directeur', async () => {
    const { id } = await informations.create(moussa.session, {
      changes: { addressLine: 'Mermoz' },
    });
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
  /** Un titre de Moussa — CNI, passeport, CV —, et sa date d'expiration s'il en a une. */
  const titre = (category: 'cni' | 'passeport' | 'cv', label: string, expiresOn?: string) =>
    pieces.upload(moussa.session, moussa.employeeId, {
      category,
      label,
      filename: `${label}.pdf`,
      contentType: 'application/pdf',
      contentBase64: PDF,
      ...(expiresOn ? { expiresOn } : {}),
    });
  /** La date dans `jours` jours, à l'horloge de la base. */
  const dans = async (jours: number): Promise<string> => {
    const { rows } = await raw(`SELECT (CURRENT_DATE + $1::int)::text AS d`, [jours]);
    return rows[0]!.d as string;
  };
  const fichier = (label: string) => ({
    label,
    filename: `${label}.pdf`,
    contentType: 'application/pdf' as const,
    contentBase64: PDF,
  });
  const dossier = async () =>
    (await pieces.list(moussa.session, moussa.employeeId)).map((d) => `${d.label}:${d.status}`);
  /** Les informations d'une pièce, telles que qui la valide les saisit. */
  const infos = async () => ({
    numero: 'X0000001',
    delivreLe: '2020-01-01',
    expireLe: await dans(3000),
  });
  // La fiche de Moussa sans pièce d'identité, d'un test à l'autre.
  afterEach(() =>
    raw(
      `UPDATE persons SET id_document_type = NULL, national_id_encrypted = NULL,
              id_document_issued_on = NULL, id_document_expires_on = NULL
        WHERE id = (SELECT person_id FROM employees WHERE id = $1)`,
      [moussa.employeeId],
    ),
  );

  it('déposée par l’agent : la DCH la vérifie — le membre habilité, dans sa file', async () => {
    const { id } = await deposer();
    expect(await appels('piece', id)).toEqual(['dch:Mariama']);
    expect(await codeOf(() => pieces.review(awa.session, id, { decision: 'approved' }))).toBe(
      'documents.forbidden_scope',
    );
    expect(await pieces.file(awa.session)).toEqual([]);
    await habiliter(awa, 'demandes.pieces.diplome');
    const file = await pieces.file(awa.session);
    expect(file.map((p) => `${p.employeeName}:${p.label}:${p.canReview}`)).toEqual([
      'Moussa Test:Master:true',
    ]);
    // Le directeur la garde dans sa file et son compteur : il peut toujours la vérifier.
    expect((await pieces.file(mariama.session)).map((p) => p.canReview)).toEqual([true]);
    const aTraiter = (qui: Agent) =>
      db.withTenant({ tenantId, userId: qui.session.userId }, (tx) =>
        aTraiterPar(tx, qui.employeeId),
      );
    expect((await aTraiter(mariama)).pieces).toBe(1);
    expect((await aTraiter(awa)).pieces).toBe(1);
    await pieces.review(awa.session, id, { decision: 'approved' });
    expect(await appels('piece', id)).toEqual([]);
  });

  it('les documents officiels se vérifient type par type : chaque dépôt va à qui vérifie le sien', async () => {
    await habiliter(awa, 'demandes.pieces.diplome');
    await habiliter(khady, 'demandes.pieces.cni');
    const { id: diplome } = await deposer();
    const { id: cni } = await titre('cni', 'CNI recto-verso', await dans(800));
    expect(await appels('piece', diplome)).toEqual(['dch:Awa']);
    expect(await appels('piece', cni)).toEqual(['dch:Khady']);
    // Awa ne vérifie pas les pièces d'identité ; le directeur, si.
    expect(await codeOf(() => pieces.review(awa.session, cni, { decision: 'approved' }))).toBe(
      'demandes.pas_traitant',
    );
    await pieces.review(mariama.session, cni, { decision: 'approved', titre: await infos() });
    await pieces.review(awa.session, diplome, { decision: 'approved' });
    expect(await appels('piece', diplome)).toEqual([]);
  });

  it('le contenu : le titulaire, et qui vérifie les pièces — pas un autre agent', async () => {
    const { id } = await deposer();
    expect(await codeOf(() => pieces.content(khady.session, id))).toBe('documents.forbidden_scope');
    await habiliter(khady, 'demandes.pieces.diplome');
    expect((await pieces.content(khady.session, id)).filename).toBe('master.pdf');
    expect((await pieces.content(moussa.session, id)).filename).toBe('master.pdf');
  });

  it('en vérification, son titulaire le remplace ou l’annule ; vérifié, il ne se change plus', async () => {
    const { id } = await deposer();
    expect(await codeOf(() => pieces.replace(awa.session, id, fichier('Autre')))).toBe(
      'documents.forbidden_scope',
    );
    await pieces.replace(moussa.session, id, fichier('Master 2'));
    const [vue] = await pieces.list(moussa.session, moussa.employeeId);
    expect(vue).toMatchObject({ label: 'Master 2', status: 'pending', canReplace: true });
    expect(await appels('piece', id)).toEqual(['dch:Mariama']);
    // Annulé : il quitte le dossier et la file de la DCH.
    await pieces.remove(moussa.session, id);
    expect(await appels('piece', id)).toEqual([]);
    expect(await dossier()).toEqual([]);
    // Vérifié : plus de remplacement.
    const { id: verifie } = await deposer();
    await pieces.review(mariama.session, verifie, { decision: 'approved' });
    expect(await codeOf(() => pieces.replace(moussa.session, verifie, fichier('Master 3')))).toBe(
      'documents.already_reviewed',
    );
    expect((await pieces.list(moussa.session, moussa.employeeId))[0]).toMatchObject({
      canReplace: false,
    });
  });

  it('CNI, passeport, CV : un seul au dossier — le nouveau, vérifié, prend la place de l’ancien', async () => {
    const { id: ancien } = await titre('passeport', 'Passeport 2019', await dans(400));
    await pieces.review(mariama.session, ancien, { decision: 'approved', titre: await infos() });
    const { id: nouveau } = await titre('passeport', 'Passeport 2026', await dans(3000));
    // Un seul en vérification à la fois : on change celui-là.
    expect(await codeOf(async () => titre('passeport', 'Encore un', await dans(3000)))).toBe(
      'documents.deja_en_verification',
    );
    // Tant que le nouveau n'est pas vérifié, l'ancien reste au dossier.
    expect(await dossier()).toEqual(['Passeport 2026:pending', 'Passeport 2019:approved']);
    await pieces.review(mariama.session, nouveau, { decision: 'approved' });
    expect(await dossier()).toEqual(['Passeport 2026:approved']);
    // Le CV de même ; les autres types s'ajoutent sans limite.
    const { id: cv1 } = await titre('cv', 'CV 2024');
    await pieces.review(mariama.session, cv1, { decision: 'approved' });
    const { id: cv2 } = await titre('cv', 'CV 2026');
    await pieces.review(mariama.session, cv2, { decision: 'approved' });
    const { id: d1 } = await deposer();
    const { id: d2 } = await deposer();
    await pieces.review(mariama.session, d1, { decision: 'approved' });
    await pieces.review(mariama.session, d2, { decision: 'approved' });
    expect((await dossier()).sort()).toEqual([
      'CV 2026:approved',
      'Master:approved',
      'Master:approved',
      'Passeport 2026:approved',
    ]);
  });

  it('CNI et passeport : la date d’expiration est exigée, pas passée — et ne sert qu’au titulaire', async () => {
    expect(await codeOf(() => titre('cni', 'CNI'))).toBe('documents.expiration_requise');
    expect(await codeOf(async () => titre('cni', 'CNI', await dans(-1)))).toBe('documents.expire');
    const date = await dans(800);
    await titre('cni', 'CNI', date);
    expect((await pieces.list(moussa.session, moussa.employeeId))[0]?.expiresOn).toBe(date);
    expect((await pieces.list(mariama.session, moussa.employeeId))[0]?.expiresOn).toBeNull();
    // Un CV n'en a pas.
    await titre('cv', 'CV', date);
    expect((await pieces.list(moussa.session, moussa.employeeId))[0]?.expiresOn).toBeNull();
  });

  describe('le titre de la fiche : qui vérifie compare, ou saisit la nouvelle pièce', () => {
    const crypto = new EncryptionService();
    /** La pièce d'identité que porte la fiche de Moussa. */
    const ficheDeMoussa = (
      type: 'passport' | 'cni' | null,
      numero: string | null = null,
      delivreLe: string | null = null,
      expireLe: string | null = null,
    ) =>
      raw(
        `UPDATE persons SET id_document_type = $2, national_id_encrypted = $3,
                id_document_issued_on = $4, id_document_expires_on = $5
          WHERE id = (SELECT person_id FROM employees WHERE id = $1)`,
        [moussa.employeeId, type, numero ? crypto.encrypt(numero) : null, delivreLe, expireLe],
      );
    const fiche = async () => {
      const { rows } = await raw(
        `SELECT p.id_document_type AS type, p.national_id_encrypted AS n,
                p.id_document_issued_on::text AS d, p.id_document_expires_on::text AS e
           FROM persons p JOIN employees e ON e.person_id = p.id WHERE e.id = $1`,
        [moussa.employeeId],
      );
      const r = rows[0]!;
      return `${r.type}:${r.n ? crypto.decrypt(r.n as string) : null}:${r.d}:${r.e}`;
    };
    const vueDCH = async (id: string) =>
      (await pieces.file(mariama.session)).find((p) => p.id === id)!;
    const passeport = async (renouvellement = false) =>
      pieces.upload(moussa.session, moussa.employeeId, {
        category: 'passeport',
        label: 'Passeport',
        filename: 'passeport.pdf',
        contentType: 'application/pdf',
        contentBase64: PDF,
        expiresOn: await dans(2000),
        renouvellement,
      });
    afterEach(() => ficheDeMoussa(null));

    it('la même pièce : le document doit porter le numéro et les dates de la fiche', async () => {
      await ficheDeMoussa('passport', 'A0123456', '2019-12-05', '2029-12-05');
      const { id } = await passeport();
      expect((await vueDCH(id)).controle).toEqual({
        mode: 'conformite',
        fiche: {
          type: 'passeport',
          numero: 'A0123456',
          delivreLe: '2019-12-05',
          expireLe: '2029-12-05',
        },
      });
      // L'agent ne voit pas ce contrôle : il est pour qui vérifie.
      expect((await pieces.list(moussa.session, moussa.employeeId))[0]?.controle).toBeNull();
      await pieces.review(mariama.session, id, { decision: 'approved' });
      expect(await fiche()).toBe('passport:A0123456:2019-12-05:2029-12-05');
    });

    it('un renouvellement : qui valide saisit la nouvelle pièce — la fiche suit, l’ancien document part', async () => {
      await ficheDeMoussa('passport', 'A0123456', '2019-12-05', '2029-12-05');
      const { id: ancien } = await passeport();
      await pieces.review(mariama.session, ancien, { decision: 'approved' });
      const { id } = await passeport(true);
      const vue = await vueDCH(id);
      expect(vue).toMatchObject({ renouvellement: true, controle: { mode: 'saisie' } });
      expect(await codeOf(() => pieces.review(mariama.session, id, { decision: 'approved' }))).toBe(
        'documents.titre_requis',
      );
      expect(
        await codeOf(async () =>
          pieces.review(mariama.session, id, {
            decision: 'approved',
            titre: { numero: 'B999', delivreLe: '2015-01-01', expireLe: await dans(-1) },
          }),
        ),
      ).toBe('documents.expire');
      const expireLe = await dans(3650);
      await pieces.review(mariama.session, id, {
        decision: 'approved',
        titre: { numero: 'B7654321', delivreLe: '2026-09-01', expireLe },
      });
      expect(await fiche()).toBe(`passport:B7654321:2026-09-01:${expireLe}`);
      expect(await dossier()).toEqual(['Passeport:approved']);
    });

    it('une fiche sans pièce : la première se saisit, et la fiche en prend le type', async () => {
      const { id } = await titre('cni', 'CNI', await dans(2000));
      expect((await vueDCH(id)).controle?.mode).toBe('saisie');
      const expireLe = await dans(3000);
      await pieces.review(mariama.session, id, {
        decision: 'approved',
        titre: { numero: '1751198501234', delivreLe: '2024-03-01', expireLe },
      });
      expect(await fiche()).toBe(`cni:1751198501234:2024-03-01:${expireLe}`);
    });

    it('l’autre titre : validé à part, ou devenu la pièce de la fiche si qui vérifie le choisit', async () => {
      await ficheDeMoussa('passport', 'A0123456', '2019-12-05', '2029-12-05');
      const { id } = await titre('cni', 'CNI', await dans(2000));
      expect((await vueDCH(id)).controle).toEqual({
        mode: 'autre',
        fiche: {
          type: 'passeport',
          numero: 'A0123456',
          delivreLe: '2019-12-05',
          expireLe: '2029-12-05',
        },
      });
      // Validée à part : la fiche garde son passeport.
      await pieces.review(mariama.session, id, { decision: 'approved' });
      expect(await fiche()).toBe('passport:A0123456:2019-12-05:2029-12-05');

      // Une autre fois, qui vérifie en fait la pièce de la fiche.
      const { id: cni } = await titre('cni', 'CNI 2026', await dans(2000));
      const expireLe = await dans(3000);
      await pieces.review(mariama.session, cni, {
        decision: 'approved',
        titre: { numero: '1751198501234', delivreLe: '2026-01-15', expireLe },
      });
      expect(await fiche()).toBe(`cni:1751198501234:2026-01-15:${expireLe}`);
      // Une seule CNI au dossier : la nouvelle a pris la place de la première.
      expect((await dossier()).sort()).toEqual(['CNI 2026:approved']);
    });

    it('un document qui n’est pas un titre ne touche jamais à la fiche', async () => {
      const { id } = await deposer();
      expect((await vueDCH(id)).controle).toBeNull();
      expect(
        await codeOf(async () =>
          pieces.review(mariama.session, id, {
            decision: 'approved',
            titre: { numero: 'X', delivreLe: '2024-01-01', expireLe: await dans(100) },
          }),
        ),
      ).toBe('documents.pas_le_titre');
    });
  });

  it('l’expiration : un rappel quinze jours avant, un le jour même — au titulaire, une fois chacun', async () => {
    const { id } = await titre('passeport', 'Passeport', await dans(10));
    const relever = (qui: Agent) => new NotificationsService(db).list(qui.session);
    const rappels = async (qui: Agent) =>
      (
        await raw(
          `SELECT title FROM notifications
            WHERE type = 'document_expiry' AND recipient_user_id = $1 ORDER BY created_at`,
          [qui.session.userId],
        )
      ).rows.map((r) => r.title as string);
    await relever(moussa);
    await relever(moussa);
    expect(await rappels(moussa)).toEqual(['Passeport : expiration proche']);
    // Le jour J.
    await raw(`UPDATE employee_documents SET expires_on = CURRENT_DATE WHERE id = $1`, [id]);
    await relever(moussa);
    expect(await rappels(moussa)).toEqual([
      'Passeport : expiration proche',
      'Passeport : expire aujourd’hui',
    ]);
    // Personne d'autre : ni la DCH, ni un collègue.
    await relever(mariama);
    expect(await rappels(mariama)).toEqual([]);

    // Un nouveau passeport déposé : l'ancien, même expiré, ne rappelle plus rien.
    await pieces.review(mariama.session, id, { decision: 'approved', titre: await infos() });
    await raw(`DELETE FROM notifications WHERE type = 'document_expiry'`);
    await raw(`UPDATE employee_documents SET expires_on = CURRENT_DATE - 3 WHERE id = $1`, [id]);
    await titre('passeport', 'Nouveau passeport', await dans(3000));
    await relever(moussa);
    expect(await rappels(moussa)).toEqual([]);
  });
});

describe('les échéances de contrat', () => {
  /** Qui a reçu l'alerte, pour le contrat de qui. */
  async function alertes(): Promise<string[]> {
    const { rows } = await raw(
      `SELECT u.given_name AS qui, p.given_name AS de
         FROM notifications n
         JOIN users u ON u.id = n.recipient_user_id
         JOIN contracts c ON n.dedupe_key = 'contract_deadline:' || c.id
         JOIN employees e ON e.id = c.employee_id
         JOIN persons p ON p.id = e.person_id
        WHERE n.tenant_id = $1 AND n.type = 'contract_deadline'
        ORDER BY 2, 1`,
      [tenantId],
    );
    return rows.map((r) => `${r.de as string}→${r.qui as string}`);
  }
  const cdd = (qui: Agent, jours: number) =>
    raw(
      `INSERT INTO contracts (id, tenant_id, employee_id, contract_type, start_date, end_date)
       VALUES ($1,$2,$3,'cdd', CURRENT_DATE - 200, CURRENT_DATE + $4::int)`,
      [randomUUID(), tenantId, qui.employeeId, jours],
    );
  /** L'alerte naît quand un gestionnaire relève ses notifications. */
  const relever = () => new NotificationsService(db).list(admin);
  const recommencer = () =>
    raw(`DELETE FROM notifications WHERE tenant_id = $1 AND type = 'contract_deadline'`, [
      tenantId,
    ]);

  it('vont à qui gère le personnel, jamais à l’agent dont c’est le contrat ; sans délégué présent, au directeur', async () => {
    const typeConge = randomUUID();
    await cdd(moussa, 20);
    await cdd(awa, 15);
    try {
      // Rien de confié : qui dirige la DCH.
      await relever();
      expect(await alertes()).toEqual(['Awa→Mariama', 'Moussa→Mariama']);

      // Elles mènent au dossier de l'agent, où l'on renouvelle ou l'on clôt.
      const { rows: liens } = await raw(
        `SELECT DISTINCT n.link FROM notifications n
          WHERE n.tenant_id = $1 AND n.type = 'contract_deadline' ORDER BY 1`,
        [tenantId],
      );
      expect(liens.map((l) => l.link)).toEqual(
        [awa, moussa].map((a) => `/employees/${a.employeeId}`).sort(),
      );

      // La gestion du personnel confiée à Awa et Khady : elles seules — et Awa
      // pas pour son propre contrat.
      await recommencer();
      await habiliter(awa, 'personnel.gerer');
      await habiliter(khady, 'personnel.gerer');
      await relever();
      expect(await alertes()).toEqual(['Awa→Khady', 'Moussa→Awa', 'Moussa→Khady']);

      // Awa seule à gérer le personnel : son propre contrat revient au directeur.
      await recommencer();
      await habiliter(khady, 'personnel.gerer', false);
      await relever();
      expect(await alertes()).toEqual(['Awa→Mariama', 'Moussa→Awa']);

      // Awa, la seule déléguée, en congé : le directeur, faute de délégué présent.
      await recommencer();
      await raw(
        `INSERT INTO absence_types (id, tenant_id, name, deducts_balance, allowance_days, frequency)
         VALUES ($1,$2,'Congé de test',false,30,'annual')`,
        [typeConge, tenantId],
      );
      await raw(
        `INSERT INTO absence_requests (id, tenant_id, employee_id, absence_type_id, start_date, end_date, days_count, status)
         VALUES ($1,$2,$3,$4, CURRENT_DATE - 1, CURRENT_DATE + 3, 3, 'approved')`,
        [randomUUID(), tenantId, awa.employeeId, typeConge],
      );
      await relever();
      expect(await alertes()).toEqual(['Awa→Mariama', 'Moussa→Mariama']);
    } finally {
      await habiliter(awa, 'personnel.gerer', false);
      await habiliter(khady, 'personnel.gerer', false);
      await raw(`DELETE FROM absence_requests WHERE absence_type_id = $1`, [typeConge]);
      await raw(`DELETE FROM absence_types WHERE id = $1`, [typeConge]);
      await raw(`DELETE FROM contracts WHERE tenant_id = $1`, [tenantId]);
    }
  });

  it('qui dirige la DCH tient les nouvelles délégations, et peut les confier une à une', async () => {
    const { capacites } = await db.withTenant({ tenantId, userId: mariama.session.userId }, (tx) =>
      capacitesDe(tx, mariama.session.userId, mariama.session.role),
    );
    // Les échéances de contrat suivent la gestion du personnel : plus de délégation à part.
    expect(capacites).not.toContain('contrats.echeances');
    for (const c of ['feries', 'recrutement.offres', 'recrutement.candidatures'] as const) {
      expect(capacites).toContain(c);
    }
    expect(capacites).not.toContain('recrutement');
    await habiliter(khady, 'recrutement.offres');
    const khadySeule = await db.withTenant({ tenantId, userId: khady.session.userId }, (tx) =>
      capacitesDe(tx, khady.session.userId, khady.session.role),
    );
    expect(khadySeule.capacites).toEqual(['recrutement.offres']);
  });
});

describe('on ne contourne pas le système : rien sur soi-même', () => {
  /** La session telle que le serveur la construit : avec les habilitations. */
  const session = async (qui: Agent): Promise<SessionUser> => ({
    ...qui.session,
    ...(await db.withTenant({ tenantId, userId: qui.session.userId }, (tx) =>
      capacitesDe(tx, qui.session.userId, qui.session.role),
    )),
  });

  it('l’Academy se gère à la DCH : le directeur la tient et la délègue ; les textes restent à l’administrateur', async () => {
    const directeur = await session(mariama);
    expect(directeur.dirigeLaDCH).toBe(true);
    expect(directeur.capacites).toContain('academy');
    expect(directeur.capacites).not.toContain('textes');
    expect((await session(awa)).capacites).not.toContain('academy');
    await habiliter(awa, 'academy');
    try {
      expect((await session(awa)).capacites).toContain('academy');
      // Déléguer ne se notifie pas.
      const { rows } = await raw(
        `SELECT n.id FROM notifications n JOIN users u ON u.id = n.recipient_user_id
          WHERE u.given_name = 'Awa' AND n.dedupe_key LIKE 'habilitation:%'`,
      );
      expect(rows).toEqual([]);
      const etat = await habilitations.etat(admin);
      expect(etat.membres.find((m) => m.employeeId === awa.employeeId)?.capacites).toContain(
        'academy',
      );
    } finally {
      await habiliter(awa, 'academy', false);
    }
    expect((await session(awa)).capacites).not.toContain('academy');
    expect(await codeOf(() => habiliter(awa, 'textes'))).toBe('habilitations.reservee_admin');
    expect(
      (
        await db.withTenant({ tenantId, userId: admin.userId }, (tx) =>
          capacitesDe(tx, admin.userId, 'admin'),
        )
      ).capacites,
    ).toContain('academy');
  });

  it('qui gère les dossiers ne touche pas au sien — celui d’un collègue, si', async () => {
    await habiliter(awa, 'personnel.gerer');
    const s = await session(awa);
    expect(
      await codeOf(() => people.update(s, awa.employeeId, { person: { phone: '770000001' } })),
    ).toBe('acces.son_propre_dossier');
    await people.update(s, moussa.employeeId, { person: { phone: '770000002' } });
    expect((await people.detail(s, awa.employeeId)).soi).toBe(true);
    expect((await people.detail(s, moussa.employeeId)).soi).toBe(false);
  });

  it('ni ses propres soldes de congés, ni sa propre attestation', async () => {
    await habiliter(awa, 'conges.soldes');
    await habiliter(awa, 'personnel.gerer');
    const s = await session(awa);
    const typeId = randomUUID();
    await raw(
      `INSERT INTO absence_types (id, tenant_id, name, deducts_balance, allowance_days, frequency)
       VALUES ($1,$2,'Congé annuel',true,30,'annual')`,
      [typeId, tenantId],
    );
    const solde = (employeeId: string) =>
      absences.setBalance(s, { employeeId, absenceTypeId: typeId, year: 2027, entitledDays: 60 });
    expect(await codeOf(() => solde(awa.employeeId))).toBe('acces.son_propre_dossier');
    await solde(moussa.employeeId);
    expect(await codeOf(() => attestations.forEmployee(s, awa.employeeId))).toBe(
      'acces.son_propre_dossier',
    );
  });

  it('personne ne se désigne responsable ; qui dirige la DCH, seul l’administrateur le désigne', async () => {
    await habiliter(awa, 'organigramme');
    const s = await session(awa);
    const { id: service } = await organigramme.create(admin, {
      name: 'Service Paie',
      unitType: 'service',
      parentId: uDCH,
    });
    expect(
      await codeOf(() => organigramme.update(s, service, { managerEmployeeId: awa.employeeId })),
    ).toBe('acces.son_propre_dossier');
    expect(
      await codeOf(() => organigramme.update(s, uDCH, { managerEmployeeId: khady.employeeId })),
    ).toBe('org.dch_reservee_admin');
    expect(await codeOf(() => organigramme.update(s, uDSID, { directionDuPersonnel: true }))).toBe(
      'org.dch_reservee_admin',
    );
    await raw(`DELETE FROM org_units WHERE id = $1`, [service]);
  });

  it('les pièces : l’agent dépose les siennes ; qui les vérifie ne vérifie pas les siennes', async () => {
    await habiliter(awa, 'demandes.pieces.diplome');
    const piece = {
      category: 'diplome' as const,
      label: 'Licence',
      filename: 'licence.pdf',
      contentType: 'application/pdf' as const,
      contentBase64: PDF,
    };
    // Personne ne dépose sur le dossier d'un autre — pas même qui dirige la DCH.
    expect(await codeOf(() => pieces.upload(mariama.session, moussa.employeeId, piece))).toBe(
      'documents.self_only',
    );
    const { id, status } = await pieces.upload(awa.session, awa.employeeId, piece);
    expect(status).toBe('pending');
    // Awa vérifie les pièces… mais pas les siennes : elles vont à Mariama.
    expect(await appels('piece', id)).toEqual(['dch:Mariama']);
    expect(await codeOf(() => pieces.review(awa.session, id, { decision: 'approved' }))).toBe(
      'documents.wrong_reviewer',
    );
    const [vue] = await pieces.list(awa.session, awa.employeeId);
    expect(vue).toMatchObject({ canReview: false });
    await pieces.review(mariama.session, id, { decision: 'approved' });
  });
});

describe('gérer les dossiers du personnel n’ouvre aucune file', () => {
  it('ni les congés, ni les documents, ni les informations, ni les pièces : la fiche de chacun, oui', async () => {
    const gestion = {
      ...khady.session,
      capacites: ['personnel.consulter', 'personnel.gerer', 'personnel.sensible', 'conges.soldes'],
    } as SessionUser;
    await documents.create(moussa.session, { docTypes: ['attestation_travail'] });
    await informations.create(moussa.session, { changes: { addressLine: 'Cité Keur Gorgui' } });
    const typeConge = randomUUID();
    await raw(
      `INSERT INTO absence_types (id, tenant_id, name, deducts_balance, allowance_days, frequency)
       VALUES ($1,$2,'Congé de test',false,30,'annual')`,
      [typeConge, tenantId],
    );
    await raw(
      `INSERT INTO absence_requests (id, tenant_id, employee_id, absence_type_id, start_date, end_date, days_count, status)
       VALUES ($1,$2,$3,$4, CURRENT_DATE + 10, CURRENT_DATE + 12, 3, 'pending')`,
      [randomUUID(), tenantId, moussa.employeeId, typeConge],
    );
    try {
      expect(await documents.list(gestion, {})).toEqual([]);
      expect(await informations.list(gestion, {})).toEqual([]);
      expect(await pieces.file(gestion)).toEqual([]);
      expect(await absences.listRequests(gestion, { limit: 100 } as never)).toEqual([]);
      // Sur la fiche de Moussa : ses signalements, ses absences.
      expect(await informations.list(gestion, { employeeId: moussa.employeeId })).toHaveLength(1);
      expect(
        await absences.listRequests(gestion, {
          limit: 100,
          employeeId: moussa.employeeId,
        } as never),
      ).toHaveLength(1);
      // L'administrateur, lui, lit les files sans les traiter.
      expect(await absences.listRequests(admin, { limit: 100 } as never)).toHaveLength(1);
    } finally {
      await raw(`DELETE FROM absence_requests WHERE absence_type_id = $1`, [typeConge]);
      await raw(`DELETE FROM absence_types WHERE id = $1`, [typeConge]);
    }
  });
});
