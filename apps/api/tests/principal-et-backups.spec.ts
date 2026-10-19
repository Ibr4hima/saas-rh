/**
 * Principal et backups (ADR-0128).
 *
 * Décidé avec l'APIX : une délégation de demandes confiée à plusieurs
 * personnes a sa personne principale, qui traite seule pendant 48 heures
 * ouvrées ; les backups voient la demande sans pouvoir la traiter. Quinze
 * heures avant la fin, la personne principale reçoit un rappel ; à la fin,
 * les backups reçoivent la demande et la traitent aussi, le premier geste
 * l'emportant. La personne principale peut la leur confier plus tôt. Les
 * week-ends et les jours fériés ne comptent pas.
 *
 * Le bac d'essai : la DG (Cheikh) ; la DCH, dirigée par Mariama, avec Awa,
 * Khady et Binta ; la DSID, où Moussa relève d'Ousmane.
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FENETRE_DU_PRINCIPAL_HEURES, type Capacite, type SessionUser } from '@teranga/contracts';
import { EncryptionService } from '../src/common/encryption.service';
import { ProblemException } from '../src/common/problem';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import { confierLaDemande, ouvrirAuxBackups, type TypeDCH } from '../src/modules/acces/demandes';
import { HabilitationsService } from '../src/modules/acces/habilitations.service';
import { DocumentRequestsService } from '../src/modules/docs/document-requests.service';
import { EmployeeDocumentsService } from '../src/modules/docs/employee-documents.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { ProfileChangesService } from '../src/modules/profile/profile-changes.service';
import { AbsencesService } from '../src/modules/time/absences.service';
import { ajouterHeuresOuvrees, retirerHeuresOuvrees } from '../src/modules/time/heures-ouvrees';
import { reconcilierLeCircuit } from '../src/modules/time/visas';

const env = loadEnv();
const tenantId = randomUUID();

let ownerPool: Pool;
let db: TenantDb;
let habilitations: HabilitationsService;
let documents: DocumentRequestsService;
let informations: ProfileChangesService;
let pieces: EmployeeDocumentsService;
let absences: AbsencesService;
let typeId: string;

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

async function agent(prenom: string, unite: string, n1: string | null): Promise<Agent> {
  const session = await compte(prenom, 'employee');
  const personId = randomUUID();
  const employeeId = randomUUID();
  await raw(
    `INSERT INTO persons (id, tenant_id, user_id, given_name, family_name) VALUES ($1,$2,$3,$4,'Test')`,
    [personId, tenantId, session.userId, prenom],
  );
  await raw(
    `INSERT INTO employees (id, tenant_id, person_id, employee_number, hired_on, manager_employee_id)
     VALUES ($1,$2,$3,$4,'2024-01-01',$5)`,
    [employeeId, tenantId, personId, `PB-${prenom}`, n1],
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
let uDSID: string;
let mariama: Agent;
let awa: Agent;
let khady: Agent;
let binta: Agent;
let ousmane: Agent;
let moussa: Agent;
let admin: SessionUser;

const ATTESTATION: Capacite = 'demandes.documents.attestation_travail';

const habiliter = (qui: Agent, capacite: Capacite, accordee = true) =>
  habilitations.accorder(mariama.session, { employeeId: qui.employeeId, capacite, accordee });
const designer = (qui: Agent, capacite: Capacite, par: Agent = mariama) =>
  habilitations.designerLePrincipal(par.session, { employeeId: qui.employeeId, capacite });

const reconcilier = () =>
  db.withTenant({ tenantId, userId: admin.userId }, (tx) => reconcilierLeCircuit(tx, tenantId));

/** Les jours fériés de l'organisation d'essai : les heures ouvrées se comptent avec eux. */
async function feries(): Promise<Set<string>> {
  const { rows } = await raw(
    `SELECT day::text AS jour FROM holidays WHERE tenant_id = $1 AND day IS NOT NULL`,
    [tenantId],
  );
  return new Set(rows.map((r) => r.jour as string));
}

/** La demande attend depuis tant d'heures ouvrées. */
async function vieillir(table: string, id: string, heures: number, colonne = 'created_at') {
  const depuis = retirerHeuresOuvrees(new Date(), heures, await feries());
  await raw(`UPDATE ${table} SET ${colonne} = $2 WHERE id = $1`, [id, depuis.toISOString()]);
}

/** Qui a reçu un appel pour cette demande, à quelle étape : `dch:Awa`, `backup:Khady`. */
async function appels(prefixe: string, id: string): Promise<string[]> {
  const { rows } = await raw(
    `SELECT u.given_name AS qui, split_part(n.dedupe_key, ':', 4) AS etape
       FROM notifications n JOIN users u ON u.id = n.recipient_user_id
      WHERE n.dedupe_key LIKE $1 ORDER BY 2, 1`,
    [`${prefixe}:${id}:appel:%`],
  );
  return rows.map((r) => `${r.etape}:${r.qui}`);
}

/** Les titres des notifications de cette clé, chez cette personne. */
async function titres(qui: Agent, cle: string): Promise<string[]> {
  const { rows } = await raw(
    `SELECT n.title FROM notifications n
      WHERE n.recipient_user_id = $1 AND n.dedupe_key = $2 ORDER BY n.created_at`,
    [qui.session.userId, cle],
  );
  return rows.map((r) => r.title as string);
}

/** Traiter la demande de document : la refuser, avec un motif, la clôt. */
const CLORE = { status: 'rejected', message: 'Pièce manquante' } as const;

const ouvrir = (qui: Agent, type: TypeDCH, id: string) =>
  db.withTenant({ tenantId: qui.session.tenantId, userId: qui.session.userId }, (tx) =>
    ouvrirAuxBackups(tx, qui.session, type, id),
  );

async function demanderUneAttestation(qui: Agent = moussa): Promise<string> {
  const [id] = (await documents.create(qui.session, { docTypes: ['attestation_travail'] })).ids as [
    string,
  ];
  return id;
}

/** La demande de document, telle que cette personne la voit dans la file. */
async function vueDocument(qui: Agent, id: string) {
  const r = (await documents.list(qui.session, {})).find((x) => x.id === id);
  if (!r) throw new Error('demande invisible pour cette personne');
  return r;
}

/** Un congé approuvé qui couvre aujourd'hui : la personne est absente. */
async function enConge(qui: Agent): Promise<void> {
  await raw(
    `INSERT INTO absence_requests (id, tenant_id, employee_id, absence_type_id, start_date, end_date, days_count, status)
     VALUES ($1,$2,$3,$4, CURRENT_DATE - 1, CURRENT_DATE + 3, 3, 'approved')`,
    [randomUUID(), tenantId, qui.employeeId, typeId],
  );
}

let semaine = 0;
async function poserUnConge(qui: Agent): Promise<string> {
  const lundi = new Date(Date.UTC(2027, 2, 1 + 7 * semaine++));
  const vendredi = new Date(lundi);
  vendredi.setUTCDate(lundi.getUTCDate() + 4);
  return (
    await absences.createRequest(qui.session, {
      employeeId: qui.employeeId,
      absenceTypeId: typeId,
      startDate: lundi.toISOString().slice(0, 10),
      endDate: vendredi.toISOString().slice(0, 10),
    })
  ).id;
}

const PDF = Buffer.from('%PDF-1.4 essai').toString('base64');

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 3 });
  db = new TenantDb();
  const notifications = new NotificationsService(db);
  habilitations = new HabilitationsService(db);
  documents = new DocumentRequestsService(db, notifications, new EncryptionService());
  informations = new ProfileChangesService(db, notifications, new EncryptionService());
  pieces = new EmployeeDocumentsService(db, notifications, new EncryptionService());
  absences = new AbsencesService(db);
  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1,'Principal',$2)`, [
    tenantId,
    `principal-${tenantId.slice(0, 8)}`,
  ]);
  typeId = randomUUID();
  await raw(
    `INSERT INTO absence_types (id, tenant_id, name, deducts_balance, allowance_days, frequency)
     VALUES ($1,$2,'Congé annuel',true,300,'annual')`,
    [typeId, tenantId],
  );
  admin = await compte('Ibrahima', 'admin');
  const uDG = await unite('Direction Générale', null);
  uDCH = await unite('Direction du Capital Humain', uDG, true);
  uDSID = await unite('Direction des Systèmes', uDG);
  const cheikh = await agent('Cheikh', uDG, null);
  await raw(`UPDATE org_units SET manager_employee_id = $2 WHERE id = $1`, [
    uDG,
    cheikh.employeeId,
  ]);
  mariama = await agent('Mariama', uDCH, cheikh.employeeId);
  awa = await agent('Awa', uDCH, mariama.employeeId);
  khady = await agent('Khady', uDCH, mariama.employeeId);
  binta = await agent('Binta', uDCH, mariama.employeeId);
  ousmane = await agent('Ousmane', uDSID, cheikh.employeeId);
  moussa = await agent('Moussa', uDSID, ousmane.employeeId);
});

beforeEach(async () => {
  for (const table of [
    'notifications',
    'document_requests',
    'profile_change_requests',
    'employee_documents',
    'absence_approvals',
    'absence_requests',
    'habilitations',
    'holidays',
  ]) {
    await raw(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  }
  await raw(`UPDATE org_units SET manager_employee_id = $2 WHERE id = $1`, [
    uDCH,
    mariama.employeeId,
  ]);
  await raw(`UPDATE assignments SET org_unit_id = $2 WHERE employee_id = $1`, [
    awa.employeeId,
    uDCH,
  ]);
});

afterAll(async () => {
  for (const table of [
    'notifications',
    'document_requests',
    'profile_change_requests',
    'employee_documents',
    'absence_approvals',
    'absence_requests',
    'absence_balances',
    'absence_types',
    'habilitations',
    'holidays',
  ]) {
    await raw(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  }
  await raw(`UPDATE org_units SET manager_employee_id = NULL WHERE tenant_id = $1`, [tenantId]);
  await raw(`UPDATE employees SET manager_employee_id = NULL WHERE tenant_id = $1`, [tenantId]);
  for (const table of [
    'assignments',
    'org_units',
    'employees',
    'persons',
    'user_tenant_memberships',
  ]) {
    await raw(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  }
  await raw(`DELETE FROM holiday_seeds WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM audit_log WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  await db?.pool.end();
  await ownerPool?.end();
});

/** Les demandes de chaque personne principale, comme « Déléguer des tâches » les montre. */
async function principaux(): Promise<Record<string, Capacite[]>> {
  const etat = await habilitations.etat(mariama.session);
  return Object.fromEntries(
    etat.membres.filter((m) => m.principal.length > 0).map((m) => [m.prenom, m.principal]),
  );
}

describe('désigner la personne principale', () => {
  it('la première personne déléguée est principale ; les suivantes sont ses backups', async () => {
    await habiliter(awa, ATTESTATION);
    expect(await principaux()).toEqual({ Awa: [ATTESTATION] });
    await habiliter(khady, ATTESTATION);
    await habiliter(binta, ATTESTATION);
    expect(await principaux()).toEqual({ Awa: [ATTESTATION] });
  });

  it('qui dirige la DCH désigne une autre personne principale ; retirée, la personne principale laisse la place à la personne déléguée la plus ancienne', async () => {
    await habiliter(awa, ATTESTATION);
    await habiliter(khady, ATTESTATION);
    await habiliter(binta, ATTESTATION);
    await designer(binta, ATTESTATION);
    expect(await principaux()).toEqual({ Binta: [ATTESTATION] });
    await habiliter(binta, ATTESTATION, false);
    expect(await principaux()).toEqual({ Awa: [ATTESTATION] });
  });

  it('la personne principale qui quitte la DCH est remplacée', async () => {
    await habiliter(awa, ATTESTATION);
    await habiliter(khady, ATTESTATION);
    await raw(`UPDATE assignments SET org_unit_id = $2 WHERE employee_id = $1`, [
      awa.employeeId,
      uDSID,
    ]);
    await reconcilier();
    expect(await principaux()).toEqual({ Khady: [ATTESTATION] });
  });

  it('la désignation revient à qui dirige la DCH, parmi les personnes déléguées, et pour les demandes seulement', async () => {
    await habiliter(awa, ATTESTATION);
    await habiliter(khady, ATTESTATION);
    expect(await codeOf(() => designer(khady, ATTESTATION, awa))).toBe(
      'habilitations.reserve_au_directeur_dch',
    );
    expect(await codeOf(() => designer(binta, ATTESTATION))).toBe(
      'habilitations.principal_non_delegue',
    );
    await habiliter(awa, 'acces');
    expect(await codeOf(() => designer(awa, 'acces'))).toBe('habilitations.sans_principal');
  });
});

describe('la fenêtre de 48 heures, sur une demande de document', () => {
  beforeEach(async () => {
    await habiliter(awa, ATTESTATION);
    await habiliter(khady, ATTESTATION);
  });

  it('à l’arrivée, l’appel va à la personne principale et l’avis aux backups ; seule la personne principale traite, qui dirige la DCH garde la main', async () => {
    const id = await demanderUneAttestation();
    expect(await appels('document', id)).toEqual(['backup:Khady', 'dch:Awa']);
    expect(await titres(khady, `document:${id}:appel:backup`)).toEqual([
      'Moussa Test demande une attestation de travail',
    ]);

    const pourKhady = await vueDocument(khady, id);
    expect(pourKhady.canAdvance).toBe(false);
    const { rows } = await raw(`SELECT created_at FROM document_requests WHERE id = $1`, [id]);
    const fin = ajouterHeuresOuvrees(
      rows[0]!.created_at as Date,
      FENETRE_DU_PRINCIPAL_HEURES,
      await feries(),
    );
    expect(pourKhady.traitement?.fenetre).toEqual({
      principal: 'Awa Test',
      jusquAu: fin.toISOString(),
      peutOuvrir: false,
      enAttente: true,
    });
    expect(await codeOf(() => documents.advance(khady.session, id, CLORE))).toBe(
      'demandes.au_principal',
    );

    const pourAwa = await vueDocument(awa, id);
    expect(pourAwa.canAdvance).toBe(true);
    expect(pourAwa.traitement?.fenetre?.peutOuvrir).toBe(true);
    expect((await vueDocument(mariama, id)).canAdvance).toBe(true);

    await documents.advance(awa.session, id, CLORE);
    expect(await appels('document', id)).toEqual([]);
  });

  it('quinze heures ouvrées avant la fin, la personne principale reçoit un rappel, une fois', async () => {
    const id = await demanderUneAttestation();
    await vieillir('document_requests', id, 30);
    await reconcilier();
    expect(await titres(awa, `document:${id}:rappel:dch`)).toEqual([]);

    await vieillir('document_requests', id, 34);
    await reconcilier();
    await reconcilier();
    expect(await titres(awa, `document:${id}:rappel:dch`)).toEqual([
      'Rappel : Moussa Test demande une attestation de travail',
    ]);
    expect(await titres(khady, `document:${id}:rappel:dch`)).toEqual([]);
    expect(await appels('document', id)).toEqual(['backup:Khady', 'dch:Awa']);
  });

  it('la fenêtre close, la demande va aussi aux backups : le premier geste l’emporte', async () => {
    const id = await demanderUneAttestation();
    await vieillir('document_requests', id, 49);
    await reconcilier();
    expect(await appels('document', id)).toEqual(['dch:Awa', 'dch:Khady']);
    expect(await titres(khady, `document:${id}:appel:dch`)).toEqual([
      'Vous pouvez traiter : Moussa Test demande une attestation de travail',
    ]);
    expect((await vueDocument(khady, id)).traitement?.fenetre).toBeNull();
    expect((await vueDocument(awa, id)).canAdvance).toBe(true);

    await documents.advance(khady.session, id, CLORE);
    expect(await appels('document', id)).toEqual([]);
    expect((await vueDocument(awa, id)).status).toBe('rejected');
  });

  it('la personne principale confie la demande aux backups avant la fin ; geste réservé, une fois', async () => {
    const id = await demanderUneAttestation();
    expect(await codeOf(() => ouvrir(khady, 'documents', id))).toBe(
      'demandes.ouverture_au_principal',
    );
    await ouvrir(awa, 'documents', id);
    expect(await appels('document', id)).toEqual(['dch:Awa', 'dch:Khady']);
    expect(await titres(khady, `document:${id}:appel:dch`)).toEqual([
      'Awa Test vous confie : Moussa Test demande une attestation de travail',
    ]);
    expect(await codeOf(() => ouvrir(awa, 'documents', id))).toBe('demandes.deja_ouverte');
    await documents.advance(khady.session, id, CLORE);
  });

  it('sans backup disponible, la personne principale n’a rien à confier', async () => {
    // La demande vient de Khady, unique backup : pas de traitement par qui la pose.
    const id = await demanderUneAttestation(khady);
    expect(await appels('document', id)).toEqual(['dch:Awa']);
    expect((await vueDocument(awa, id)).traitement?.fenetre?.peutOuvrir).toBe(false);
    expect(await codeOf(() => ouvrir(awa, 'documents', id))).toBe('demandes.sans_backup');
  });

  it('la demande d’un backup reste à la personne principale, la fenêtre close aussi ; un second backup la reçoit alors', async () => {
    const id = await demanderUneAttestation(khady);
    await vieillir('document_requests', id, 49);
    await reconcilier();
    expect(await appels('document', id)).toEqual(['dch:Awa']);
    expect(await codeOf(() => documents.advance(khady.session, id, CLORE))).toBe(
      'demandes.la_sienne',
    );
    await habiliter(binta, ATTESTATION);
    expect(await appels('document', id)).toEqual(['dch:Awa', 'dch:Binta']);
    await documents.advance(binta.session, id, CLORE);
  });

  it('une personne principale en congé, ou à l’origine de la demande : la personne suivante assure la suppléance et traite d’emblée (ADR-0129)', async () => {
    const sienne = await demanderUneAttestation(awa);
    expect(await appels('document', sienne)).toEqual(['dch:Khady']);
    expect((await vueDocument(khady, sienne)).canAdvance).toBe(true);

    await enConge(awa);
    const id = await demanderUneAttestation();
    expect(await appels('document', id)).toEqual(['dch:Khady']);
    const v = await vueDocument(khady, id);
    expect(v.canAdvance).toBe(true);
    expect(v.traitement?.fenetre).toMatchObject({
      principal: 'Khady Test',
      peutOuvrir: false,
      enAttente: false,
    });
  });

  it('les jours fériés ne comptent pas : soixante heures plus tard, la fenêtre court encore', async () => {
    // Les quatre derniers jours sont fériés : seule la journée en cours compte.
    for (let j = 1; j <= 4; j += 1) {
      await raw(
        `INSERT INTO holidays (id, tenant_id, year, day, label)
         VALUES ($1, $2, extract(year FROM CURRENT_DATE - $3::int)::int, CURRENT_DATE - $3::int, $4)`,
        [randomUUID(), tenantId, j, `Férié ${j}`],
      );
    }
    const id = await demanderUneAttestation();
    await raw(
      `UPDATE document_requests SET created_at = now() - interval '60 hours' WHERE id = $1`,
      [id],
    );
    await reconcilier();
    expect(await appels('document', id)).toEqual(['backup:Khady', 'dch:Awa']);
    expect(await codeOf(() => documents.advance(khady.session, id, CLORE))).toBe(
      'demandes.au_principal',
    );
  });

  it('confiée à la main par qui dirige la DCH, la demande n’a pas de fenêtre', async () => {
    const id = await demanderUneAttestation();
    await db.withTenant({ tenantId, userId: mariama.session.userId }, (tx) =>
      confierLaDemande(tx, mariama.session, 'documents', id, khady.employeeId),
    );
    expect(await appels('document', id)).toEqual(['dch:Khady']);
    expect((await vueDocument(khady, id)).canAdvance).toBe(true);
  });
});

describe('les autres demandes suivent la même règle', () => {
  it('un changement d’informations : les backups attendent la fin de la fenêtre', async () => {
    await habiliter(awa, 'demandes.informations');
    await habiliter(khady, 'demandes.informations');
    const { id } = await informations.create(moussa.session, {
      changes: { addressLine: 'Cité Keur Gorgui' },
    });
    expect(await appels('information', id)).toEqual(['backup:Khady', 'dch:Awa']);
    expect(
      await codeOf(() => informations.decide(khady.session, id, { decision: 'approve' })),
    ).toBe('demandes.au_principal');
    await vieillir('profile_change_requests', id, 50);
    await reconcilier();
    await informations.decide(khady.session, id, { decision: 'approve' });
  });

  it('une pièce à vérifier : confiée aux backups, sa vérification leur est ouverte', async () => {
    await habiliter(awa, 'demandes.pieces.cv');
    await habiliter(khady, 'demandes.pieces.cv');
    const { id } = await pieces.upload(moussa.session, moussa.employeeId, {
      category: 'cv',
      label: 'CV',
      filename: 'cv.pdf',
      contentType: 'application/pdf',
      contentBase64: PDF,
    });
    expect(await appels('piece', id)).toEqual(['backup:Khady', 'dch:Awa']);
    expect(
      await codeOf(() => pieces.review(khady.session, id, { version: 1, decision: 'approved' })),
    ).toBe('demandes.au_principal');
    await ouvrir(awa, 'pieces', id);
    await pieces.review(khady.session, id, { version: 1, decision: 'approved' });
  });

  it('un congé : la fenêtre court depuis son arrivée à la DCH, après le visa du N+1', async () => {
    await habiliter(awa, 'demandes.conges');
    await habiliter(khady, 'demandes.conges');
    const id = await poserUnConge(moussa);
    expect(await appels('conge', id)).toEqual(['n1:Ousmane']);
    await absences.decide(ousmane.session, id, { decision: 'approved' });
    expect(await appels('conge', id)).toEqual(['backup:Khady', 'dch:Awa']);
    const { rows } = await raw(`SELECT a_la_dch_le FROM absence_requests WHERE id = $1`, [id]);
    expect(rows[0]!.a_la_dch_le).not.toBeNull();

    const vue = async (qui: Agent) =>
      (await absences.listRequests(qui.session, { limit: 100 } as never)).find((r) => r.id === id)!;
    expect((await vue(khady)).canDecide).toBe(false);
    expect((await vue(khady)).traitement?.fenetre?.enAttente).toBe(true);
    expect(await codeOf(() => absences.decide(khady.session, id, { decision: 'approved' }))).toBe(
      'demandes.au_principal',
    );

    await vieillir('absence_requests', id, 49, 'a_la_dch_le');
    await reconcilier();
    expect(await appels('conge', id)).toEqual(['dch:Awa', 'dch:Khady']);
    expect((await vue(khady)).canDecide).toBe(true);
    await absences.decide(khady.session, id, { decision: 'approved' });
  });

  it('un congé : la personne principale le confie aux backups avant la fin', async () => {
    await habiliter(awa, 'demandes.conges');
    await habiliter(khady, 'demandes.conges');
    const id = await poserUnConge(moussa);
    expect(await codeOf(() => absences.ouvrirAuxBackups(awa.session, id))).toBe(
      'absence.pas_a_la_dch',
    );
    await absences.decide(ousmane.session, id, { decision: 'approved' });
    expect(await codeOf(() => absences.ouvrirAuxBackups(khady.session, id))).toBe(
      'demandes.ouverture_au_principal',
    );
    await absences.ouvrirAuxBackups(awa.session, id);
    expect(await appels('conge', id)).toEqual(['dch:Awa', 'dch:Khady']);
    const [titre] = await titres(khady, `conge:${id}:appel:dch`);
    expect(titre).toMatch(/^Awa Test vous confie : Moussa Test demande un congé annuel du /);
    await absences.decide(khady.session, id, { decision: 'approved' });
  });
});
