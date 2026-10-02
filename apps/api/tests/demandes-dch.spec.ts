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
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
  pieces = new EmployeeDocumentsService(db, notifications);
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

  it('chacun voit les siennes ; la file entière, qui la traite ou consulte les dossiers', async () => {
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

  it('vont à qui les suit, jamais à l’agent dont c’est le contrat ; sans personne, au directeur', async () => {
    await cdd(moussa, 20);
    await cdd(awa, 15);
    try {
      // Rien de confié : qui dirige la DCH.
      await relever();
      expect(await alertes()).toEqual(['Awa→Mariama', 'Moussa→Mariama']);

      // Confié à Awa et Khady : elles seules — et Awa pas pour son propre contrat.
      await recommencer();
      await habiliter(awa, 'contrats.echeances');
      await habiliter(khady, 'contrats.echeances');
      await relever();
      expect(await alertes()).toEqual(['Awa→Khady', 'Moussa→Awa', 'Moussa→Khady']);

      // Awa seule à les suivre : son propre contrat revient au directeur.
      await recommencer();
      await habiliter(khady, 'contrats.echeances', false);
      await relever();
      expect(await alertes()).toEqual(['Awa→Mariama', 'Moussa→Awa']);
    } finally {
      await raw(`DELETE FROM contracts WHERE tenant_id = $1`, [tenantId]);
    }
  });

  it('qui dirige la DCH tient les nouvelles délégations, et peut les confier une à une', async () => {
    const { capacites } = await db.withTenant({ tenantId, userId: mariama.session.userId }, (tx) =>
      capacitesDe(tx, mariama.session.userId, mariama.session.role),
    );
    for (const c of [
      'contrats.echeances',
      'feries',
      'recrutement.offres',
      'recrutement.candidatures',
    ] as const) {
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

  it('l’Academy est à l’administrateur : ni le directeur ni une délégation ne la donnent', async () => {
    const directeur = await session(mariama);
    expect(directeur.dirigeLaDCH).toBe(true);
    expect(directeur.capacites).toContain('pilotage');
    expect(directeur.capacites).not.toContain('academy');
    expect(await codeOf(() => habiliter(awa, 'academy'))).toBe('habilitations.reservee_admin');
    // Une délégation d'avant la règle ne donne plus rien.
    await raw(
      `INSERT INTO habilitations (id, tenant_id, capacite, employee_id, accordee_par_employee_id)
       VALUES ($1,$2,'academy',$3,$4)`,
      [randomUUID(), tenantId, awa.employeeId, mariama.employeeId],
    );
    expect((await session(awa)).capacites).not.toContain('academy');
    const etat = await habilitations.etat(admin);
    expect(etat.membres.every((m) => !m.capacites.includes('academy'))).toBe(true);
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
    await habiliter(awa, 'demandes.pieces');
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
