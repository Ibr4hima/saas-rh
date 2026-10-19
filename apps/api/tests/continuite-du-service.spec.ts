/**
 * La continuité du service (ADR-0129).
 *
 * Décidé avec l'APIX : une délégation de demandes confiée à plusieurs
 * personnes garde toujours quelqu'un, sauf force majeure. Une demande
 * d'absence qui la laisserait sans personne porte une alerte ; elle part
 * quand même, et qui traite les congés l'apprécie : un refus se motive.
 * La dernière personne à traiter les congés voit ses absences appréciées par
 * qui dirige la DCH. La personne principale indisponible, la personne
 * suivante dans l'ordre des délégations assure la suppléance.
 *
 * Le bac d'essai : la DG (Cheikh) ; la DCH, dirigée par Mariama, avec Awa et
 * Khady (N+1 : Mariama), Binta et Fatou (N+1 : Khady) ; la DSID, où Moussa
 * relève d'Ousmane.
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
import { HabilitationsService } from '../src/modules/acces/habilitations.service';
import { DocumentRequestsService } from '../src/modules/docs/document-requests.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { AbsencesService } from '../src/modules/time/absences.service';
import { reconcilierLeCircuit } from '../src/modules/time/visas';

const env = loadEnv();
const tenantId = randomUUID();

let ownerPool: Pool;
let db: TenantDb;
let habilitations: HabilitationsService;
let documents: DocumentRequestsService;
let absences: AbsencesService;
let congeId: string;
let maladieId: string;
let ponctuelleId: string;
let missionId: string;

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
    [employeeId, tenantId, personId, `CS-${prenom}`, n1],
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

async function type(nom: string, champs: Record<string, unknown>): Promise<string> {
  const id = randomUUID();
  const cles = Object.keys(champs);
  await raw(
    `INSERT INTO absence_types (id, tenant_id, name, ${cles.join(', ')})
     VALUES ($1, $2, $3, ${cles.map((_, i) => `$${i + 4}`).join(', ')})`,
    [id, tenantId, nom, ...Object.values(champs)],
  );
  return id;
}

let mariama: Agent;
let awa: Agent;
let khady: Agent;
let binta: Agent;
let fatou: Agent;
let ousmane: Agent;
let moussa: Agent;
let admin: SessionUser;

const ATTESTATION: Capacite = 'demandes.documents.attestation_travail';

const habiliter = (qui: Agent, capacite: Capacite, accordee = true) =>
  habilitations.accorder(mariama.session, { employeeId: qui.employeeId, capacite, accordee });

const reconcilier = () =>
  db.withTenant({ tenantId, userId: admin.userId }, (tx) => reconcilierLeCircuit(tx, tenantId));

const iso = (d: Date) => d.toISOString().slice(0, 10);
const plus = (jour: string, n: number) => {
  const d = new Date(`${jour}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};

/**
 * Le lundi d'une semaine à venir, à trois semaines au moins, sans férié à
 * date fixe : ses jours ouvrés se comptent sans surprise.
 */
function lundiAVenir(): string {
  const fixes = ['01-01', '04-04', '05-01', '08-15', '11-01', '12-25'];
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 21);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  for (;;) {
    const semaine = Array.from({ length: 7 }, (_, i) => plus(iso(d), i).slice(5));
    if (!semaine.some((j) => fixes.includes(j))) return iso(d);
    d.setUTCDate(d.getUTCDate() + 7);
  }
}
let LUNDI: string;

/** Une absence déjà là : validée, ou demandée. */
async function absence(
  qui: Agent,
  du: string,
  au: string,
  statut: 'approved' | 'pending' = 'approved',
  typeId = congeId,
): Promise<string> {
  const id = randomUUID();
  await raw(
    `INSERT INTO absence_requests (id, tenant_id, employee_id, absence_type_id, start_date, end_date,
                                   days_count, status, current_level)
     VALUES ($1,$2,$3,$4,$5,$6,1,$7,1)`,
    [id, tenantId, qui.employeeId, typeId, du, au, statut],
  );
  return id;
}

const poser = async (
  qui: Agent,
  du: string,
  au: string,
  typeId = congeId,
  heures?: { startTime: string; endTime: string },
) =>
  (
    await absences.createRequest(qui.session, {
      employeeId: qui.employeeId,
      absenceTypeId: typeId,
      startDate: du,
      endDate: au,
      ...heures,
    })
  ).id;

/** La demande, vue du compte d'administration. */
async function vue(id: string, session: SessionUser = admin) {
  const r = (await absences.listRequests(session, { limit: 100 } as never)).find(
    (x) => x.id === id,
  );
  if (!r) throw new Error('demande invisible');
  return r;
}

const prevue = (qui: Agent, du: string, au: string, typeId = congeId, aLHeure = false) =>
  absences.continuitePrevue(qui.session, {
    employeeId: qui.employeeId,
    absenceTypeId: typeId,
    startDate: du,
    endDate: au,
    aLHeure,
  });

async function appels(prefixe: string, id: string): Promise<string[]> {
  const { rows } = await raw(
    `SELECT u.given_name AS qui, split_part(n.dedupe_key, ':', 4) AS etape
       FROM notifications n JOIN users u ON u.id = n.recipient_user_id
      WHERE n.dedupe_key LIKE $1 ORDER BY 2, 1`,
    [`${prefixe}:${id}:appel:%`],
  );
  return rows.map((r) => `${r.etape}:${r.qui}`);
}

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 3 });
  db = new TenantDb();
  const notifications = new NotificationsService(db);
  habilitations = new HabilitationsService(db);
  documents = new DocumentRequestsService(db, notifications, new EncryptionService());
  absences = new AbsencesService(db);
  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1,'Continuité',$2)`, [
    tenantId,
    `continuite-${tenantId.slice(0, 8)}`,
  ]);
  congeId = await type('Congé annuel', {
    deducts_balance: true,
    allowance_days: 300,
    frequency: 'annual',
    continuite: 'toujours',
  });
  maladieId = await type('Maladie', { motif_confidentiel: true, continuite: 'jamais' });
  ponctuelleId = await type('Absence ponctuelle', {
    allows_hours: true,
    max_days_per_request: 3,
    continuite: 'au_dela_d_un_jour',
  });
  missionId = await type('Mission', { reste_joignable: true, continuite: 'jamais' });
  admin = await compte('Ibrahima', 'admin');
  const uDG = await unite('Direction Générale', null);
  const uDCH = await unite('Direction du Capital Humain', uDG, true);
  const uDSID = await unite('Direction des Systèmes', uDG);
  const cheikh = await agent('Cheikh', uDG, null);
  await raw(`UPDATE org_units SET manager_employee_id = $2 WHERE id = $1`, [
    uDG,
    cheikh.employeeId,
  ]);
  mariama = await agent('Mariama', uDCH, cheikh.employeeId);
  await raw(`UPDATE org_units SET manager_employee_id = $2 WHERE id = $1`, [
    uDCH,
    mariama.employeeId,
  ]);
  awa = await agent('Awa', uDCH, mariama.employeeId);
  khady = await agent('Khady', uDCH, mariama.employeeId);
  binta = await agent('Binta', uDCH, khady.employeeId);
  fatou = await agent('Fatou', uDCH, khady.employeeId);
  ousmane = await agent('Ousmane', uDSID, cheikh.employeeId);
  moussa = await agent('Moussa', uDSID, ousmane.employeeId);
  LUNDI = lundiAVenir();
});

beforeEach(async () => {
  for (const table of [
    'notifications',
    'document_requests',
    'absence_approvals',
    'absence_documents',
    'absence_requests',
    'habilitations',
  ]) {
    await raw(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  }
  await raw(`UPDATE employees SET manager_employee_id = $2 WHERE id = $1`, [
    khady.employeeId,
    mariama.employeeId,
  ]);
  // Les attestations : Binta, principale, et Fatou ; les congés : Awa,
  // principale, et Khady.
  await habiliter(binta, ATTESTATION);
  await habiliter(fatou, ATTESTATION);
  await habiliter(awa, 'demandes.conges');
  await habiliter(khady, 'demandes.conges');
});

afterAll(async () => {
  for (const table of [
    'notifications',
    'document_requests',
    'absence_approvals',
    'absence_documents',
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

describe('l’alerte', () => {
  it('l’autre personne déléguée en congé : la demande porte l’alerte, et part quand même', async () => {
    await absence(fatou, plus(LUNDI, 2), plus(LUNDI, 8));
    expect(await prevue(binta, LUNDI, plus(LUNDI, 4))).toEqual({
      trous: [
        {
          capacites: [ATTESTATION],
          du: plus(LUNDI, 2),
          au: plus(LUNDI, 4),
          absences: [
            { nom: 'Fatou Test', du: plus(LUNDI, 2), au: plus(LUNDI, 8), demandee: false },
          ],
        },
      ],
      auDirecteur: false,
    });
    const id = await poser(binta, LUNDI, plus(LUNDI, 4));
    expect((await vue(id)).continuite?.trous[0]?.capacites).toEqual([ATTESTATION]);
  });

  it('une absence demandée compte aussi', async () => {
    await absence(fatou, LUNDI, LUNDI, 'pending');
    const alerte = await prevue(binta, LUNDI, plus(LUNDI, 1));
    expect(alerte?.trous[0]?.absences).toEqual([
      { nom: 'Fatou Test', du: LUNDI, au: LUNDI, demandee: true },
    ]);
  });

  it('à trois, une personne reste : pas d’alerte', async () => {
    await habiliter(awa, ATTESTATION);
    await absence(fatou, LUNDI, plus(LUNDI, 4));
    expect(await prevue(binta, LUNDI, plus(LUNDI, 4))).toBeNull();
    // Les deux autres absents : plus personne.
    await absence(awa, plus(LUNDI, 3), plus(LUNDI, 4));
    const alerte = await prevue(binta, LUNDI, plus(LUNDI, 4));
    expect(alerte?.trous.map((t) => [t.capacites, t.du, t.au])).toEqual([
      [[ATTESTATION], plus(LUNDI, 3), plus(LUNDI, 4)],
    ]);
  });

  it('une délégation à une seule personne n’en porte pas : qui dirige la DCH la reprend', async () => {
    await habiliter(fatou, ATTESTATION, false);
    expect(await prevue(binta, LUNDI, plus(LUNDI, 4))).toBeNull();
  });

  it('les jours chômés ne comptent pas, ni une mission, qui laisse joignable', async () => {
    // Le congé de Fatou ne couvre que le week-end.
    await absence(fatou, plus(LUNDI, 5), plus(LUNDI, 6));
    expect(await prevue(binta, plus(LUNDI, 4), plus(LUNDI, 7))).toBeNull();
    await absence(fatou, LUNDI, plus(LUNDI, 4), 'approved', missionId);
    expect(await prevue(binta, LUNDI, plus(LUNDI, 4))).toBeNull();
  });

  it('la maladie n’y est pas soumise ; l’absence ponctuelle, au-delà d’un jour', async () => {
    await absence(fatou, LUNDI, plus(LUNDI, 4));
    expect(await prevue(binta, LUNDI, plus(LUNDI, 1), maladieId)).toBeNull();
    expect(await prevue(binta, LUNDI, LUNDI, ponctuelleId)).toBeNull();
    expect(await prevue(binta, LUNDI, LUNDI, ponctuelleId, true)).toBeNull();
    expect((await prevue(binta, LUNDI, plus(LUNDI, 1), ponctuelleId))?.trous).toHaveLength(1);
  });

  it('l’absence de l’autre personne déléguée, elle aussi, dit le trou : l’alerte va dans les deux sens', async () => {
    await absence(binta, LUNDI, plus(LUNDI, 4));
    const alerte = await prevue(fatou, plus(LUNDI, 1), plus(LUNDI, 2));
    expect(alerte?.trous[0]?.absences.map((a) => a.nom)).toEqual(['Binta Test']);
  });
});

describe('l’appréciation', () => {
  it('qui traite les congés apprécie : un refus se motive', async () => {
    await absence(fatou, LUNDI, plus(LUNDI, 4));
    const id = await poser(binta, LUNDI, plus(LUNDI, 4));
    await absences.decide(khady.session, id, { decision: 'approved' });
    expect((await vue(id)).circuit.map((e) => `${e.etape}:${e.etat}:${e.qui ?? ''}`)).toEqual([
      'n1:visee:Khady Test',
      'dch:attendue:Awa Test',
    ]);
    expect(await codeOf(() => absences.decide(awa.session, id, { decision: 'rejected' }))).toBe(
      'absence.motif_continuite',
    );
    await absences.decide(awa.session, id, {
      decision: 'rejected',
      comment: 'Fatou Test est déjà en congé cette semaine-là',
    });
    expect((await vue(id)).status).toBe('rejected');
  });

  it('validée par une personne déléguée, qui dirige la DCH apprend le trou', async () => {
    await absence(fatou, LUNDI, plus(LUNDI, 4));
    const id = await poser(binta, LUNDI, plus(LUNDI, 4));
    await absences.decide(khady.session, id, { decision: 'approved' });
    await absences.decide(awa.session, id, { decision: 'approved' });
    const { rows } = await raw(
      `SELECT n.title FROM notifications n
        WHERE n.recipient_user_id = $1 AND n.dedupe_key = $2`,
      [mariama.session.userId, `continuite:${id}`],
    );
    expect(rows[0]?.title).toMatch(
      /^Le congé annuel de Binta Test est validé : plus personne pour les attestations de travail du /,
    );
  });

  it('sans alerte, un refus se passe de motif', async () => {
    const id = await poser(binta, LUNDI, plus(LUNDI, 4));
    await absences.decide(khady.session, id, { decision: 'approved' });
    await absences.decide(awa.session, id, { decision: 'rejected' });
    expect((await vue(id)).status).toBe('rejected');
  });
});

describe('la dernière personne à traiter les congés', () => {
  beforeEach(async () => {
    // Le N+1 de Khady n'est pas qui dirige la DCH : l'étape de la DCH se voit.
    await raw(`UPDATE employees SET manager_employee_id = $2 WHERE id = $1`, [
      khady.employeeId,
      ousmane.employeeId,
    ]);
  });

  it('Awa en congé sur la période : la demande de Khady va à qui dirige la DCH, même si Awa travaille aujourd’hui', async () => {
    await absence(awa, plus(LUNDI, 1), plus(LUNDI, 3));
    const id = await poser(khady, LUNDI, plus(LUNDI, 2));
    await absences.decide(ousmane.session, id, { decision: 'approved' });
    const v = await vue(id);
    expect(v.circuit[1]).toMatchObject({ etape: 'dch', etat: 'attendue', qui: 'Mariama Test' });
    expect(v.continuite?.auDirecteur).toBe(true);
    expect(await codeOf(() => absences.decide(awa.session, id, { decision: 'approved' }))).toBe(
      'absence.reservee_a_la_dch',
    );
    await absences.decide(mariama.session, id, { decision: 'approved' });
  });

  it('quels que soient le type et la durée : la maladie, quelques heures', async () => {
    await absence(awa, LUNDI, plus(LUNDI, 4));
    const maladie = await poser(khady, LUNDI, plus(LUNDI, 1), maladieId);
    const heures = await poser(khady, plus(LUNDI, 3), plus(LUNDI, 3), ponctuelleId, {
      startTime: '10:00',
      endTime: '12:00',
    });
    for (const id of [maladie, heures]) {
      await absences.decide(ousmane.session, id, { decision: 'approved' });
      expect((await vue(id)).circuit[1]).toMatchObject({ etat: 'attendue', qui: 'Mariama Test' });
    }
  });

  it('Awa au travail sur la période : la demande suit la règle, la personne principale d’abord', async () => {
    await absence(awa, plus(LUNDI, 7), plus(LUNDI, 9));
    const id = await poser(khady, LUNDI, plus(LUNDI, 2));
    await absences.decide(ousmane.session, id, { decision: 'approved' });
    expect((await vue(id)).circuit[1]).toMatchObject({ etat: 'attendue', qui: 'Awa Test' });
    expect((await vue(id)).continuite).toBeNull();
  });
});

describe('la suppléance', () => {
  it('la personne principale en congé, la personne suivante dans l’ordre des délégations assure la suppléance ; au retour de la personne principale, la suppléance cesse', async () => {
    await habiliter(khady, ATTESTATION);
    const conge = await raw(
      `INSERT INTO absence_requests (id, tenant_id, employee_id, absence_type_id, start_date, end_date,
                                     days_count, status, current_level)
       VALUES ($1,$2,$3,$4, CURRENT_DATE - 1, CURRENT_DATE + 3, 3, 'approved', 1) RETURNING id`,
      [randomUUID(), tenantId, binta.employeeId, congeId],
    );
    const [id] = (await documents.create(moussa.session, { docTypes: ['attestation_travail'] }))
      .ids as [string];
    expect(await appels('document', id)).toEqual(['backup:Khady', 'dch:Fatou']);
    await raw(`DELETE FROM absence_requests WHERE id = $1`, [conge.rows[0]!.id]);
    await reconcilier();
    expect(await appels('document', id)).toEqual(['backup:Fatou', 'backup:Khady', 'dch:Binta']);
  });
});

describe('le réglage des types', () => {
  it('chaque type dit s’il est soumis à la continuité ; un nouveau ne l’est pas', async () => {
    const types = await absences.listTypes(mariama.session);
    expect(Object.fromEntries(types.map((t) => [t.name, t.continuite]))).toMatchObject({
      'Congé annuel': 'toujours',
      'Absence ponctuelle': 'au_dela_d_un_jour',
      Maladie: 'jamais',
      Mission: 'jamais',
    });
    const { id } = await absences.createType(admin, {
      name: 'Sans solde',
      deductsBalance: false,
      frequency: 'none',
      requiresDocument: false,
    });
    expect((await absences.listTypes(admin)).find((t) => t.id === id)?.continuite).toBe('jamais');
    await absences.updateType(admin, id, {
      name: 'Sans solde',
      deductsBalance: false,
      frequency: 'none',
      requiresDocument: false,
      continuite: 'toujours',
    });
    expect((await absences.listTypes(admin)).find((t) => t.id === id)?.continuite).toBe('toujours');
    await raw(`DELETE FROM absence_types WHERE id = $1`, [id]);
  });
});
