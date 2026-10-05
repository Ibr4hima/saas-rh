/**
 * Le circuit d'une demande de congé : le N+1, puis la DCH.
 *
 * Décidé avec l'APIX : le N+1 de l'agent vise d'abord ; une fois visée, la
 * demande passe au directeur du Capital Humain — le responsable de la
 * direction du personnel —, qui la traite ou la confie à un membre de sa
 * direction — une demande à la main, ou toutes, en habilitant des membres.
 * Chaque règle a son test : qui peut viser, qui est prévenu, ce que le
 * demandeur apprend.
 *
 * Le bac d'essai : la Direction Générale et son DG (Cheikh) ; la DCH, dirigée
 * par Mariama, avec Awa, Khady et Binta (N+1 : Awa) ; la DSID, où Moussa
 * relève d'Ousmane, et Fatou d'un N+1 sans accès au portail ; un compte sans
 * dossier, et l'administrateur.
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CAPACITES_DELEGABLES,
  CAPACITES_GESTION,
  type Capacite,
  type SessionUser,
} from '@teranga/contracts';
import { EncryptionService } from '../src/common/encryption.service';
import { ProblemException } from '../src/common/problem';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import { capacitesDe } from '../src/modules/acces/dch';
import { HabilitationsService } from '../src/modules/acces/habilitations.service';
import { OrgUnitsService } from '../src/modules/people/org-units.service';
import { PeopleService } from '../src/modules/people/people.service';
import { AbsencesService } from '../src/modules/time/absences.service';
import { DashboardController } from '../src/modules/analytics/dashboard.controller';
import type { AuthenticatedRequest } from '../src/modules/auth/session.guard';
import { reconcilierLeCircuit } from '../src/modules/time/visas';
import { countWorkdays } from '../src/modules/time/workdays';

const env = loadEnv();
const tenantId = randomUUID();

let ownerPool: Pool;
let db: TenantDb;
let absences: AbsencesService;
let habilitations: HabilitationsService;
let people: PeopleService;
let organigramme: OrgUnitsService;
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
  prenom: string;
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

async function agent(
  prenom: string,
  unite: string,
  n1: string | null,
  portail: string | null = 'employee',
): Promise<Agent> {
  const session = portail ? await compte(prenom, portail) : null;
  const personId = randomUUID();
  const employeeId = randomUUID();
  await raw(
    `INSERT INTO persons (id, tenant_id, user_id, given_name, family_name) VALUES ($1,$2,$3,$4,'Test')`,
    [personId, tenantId, session?.userId ?? null, prenom],
  );
  await raw(
    `INSERT INTO employees (id, tenant_id, person_id, employee_number, hired_on, manager_employee_id)
     VALUES ($1,$2,$3,$4,'2024-01-01',$5)`,
    [employeeId, tenantId, personId, `CC-${prenom}`, n1],
  );
  await raw(
    `INSERT INTO assignments (id, tenant_id, employee_id, org_unit_id, position_title, validity)
     VALUES ($1,$2,$3,$4,'Agent', daterange('2024-01-01', NULL))`,
    [randomUUID(), tenantId, employeeId, unite],
  );
  return { employeeId, session: session ?? ({} as SessionUser), prenom };
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

let uDG: string;
let uDCH: string;
let uDSID: string;
let dg: Agent;
let mariama: Agent;
let awa: Agent;
let khady: Agent;
let binta: Agent;
let ousmane: Agent;
let moussa: Agent;
let sansCompte: Agent;
let fatou: Agent;
let sansDossier: SessionUser;
let missionId: string;
let maladieId: string;
let admin: SessionUser;

let semaine = 0;
function periode() {
  const lundi = new Date(Date.UTC(2027, 0, 4 + 7 * semaine++));
  const vendredi = new Date(lundi);
  vendredi.setUTCDate(lundi.getUTCDate() + 4);
  return {
    startDate: lundi.toISOString().slice(0, 10),
    endDate: vendredi.toISOString().slice(0, 10),
  };
}

const poser = async (qui: Agent) =>
  (
    await absences.createRequest(qui.session, {
      employeeId: qui.employeeId,
      absenceTypeId: typeId,
      ...periode(),
    })
  ).id;

/** La demande, telle que l'administrateur la voit (il voit tout). */
async function vue(id: string, session: SessionUser = admin) {
  const r = (await absences.listRequests(session, { limit: 100 } as never)).find(
    (x) => x.id === id,
  );
  if (!r) throw new Error('demande invisible pour cet utilisateur');
  return r;
}
const circuit = async (id: string) =>
  (await vue(id)).circuit.map(
    (e) => `${e.etape}:${e.etat}:${e.qui ?? ''}${e.parDelegationDe ? `/${e.parDelegationDe}` : ''}`,
  );

/** Qui a reçu un appel à viser, pour cette demande. */
async function appels(id: string): Promise<string[]> {
  const { rows } = await raw(
    `SELECT u.given_name AS qui, split_part(n.dedupe_key, ':', 4) AS etape
       FROM notifications n JOIN users u ON u.id = n.recipient_user_id
      WHERE n.dedupe_key LIKE $1 ORDER BY 2, 1`,
    [`conge:${id}:appel:%`],
  );
  return rows.map((r) => `${r.etape}:${r.qui}`);
}
async function notif(prenom: string, cle: string): Promise<string | null> {
  const { rows } = await raw(
    `SELECT n.title FROM notifications n JOIN users u ON u.id = n.recipient_user_id
      WHERE u.given_name = $1 AND n.tenant_id = $2 AND n.dedupe_key LIKE $3
        AND n.remplacee_le IS NULL`,
    [prenom, tenantId, cle],
  );
  return rows[0]?.title ?? null;
}

/** Mariama, qui dirige la DCH, confie les demandes de congé à ce membre. */
const habiliter = (qui: Agent, accordee = true, capacite: Capacite = 'demandes.conges') =>
  habilitations.accorder(mariama.session, { employeeId: qui.employeeId, capacite, accordee });

const viser = (
  qui: Agent | SessionUser,
  id: string,
  decision: 'approved' | 'rejected' = 'approved',
) => absences.decide('session' in qui ? qui.session : qui, id, { decision });
const reconcilier = () =>
  db.withTenant({ tenantId, userId: admin.userId }, (tx) => reconcilierLeCircuit(tx, tenantId));

/** Un congé approuvé qui couvre aujourd'hui, jusqu'à J+`fin` : l'agent est absent. */
async function enConge(qui: Agent, type = typeId, fin = 3): Promise<string> {
  const id = randomUUID();
  await raw(
    `INSERT INTO absence_requests (id, tenant_id, employee_id, absence_type_id, start_date, end_date, days_count, status)
     VALUES ($1,$2,$3,$4, CURRENT_DATE - 1, CURRENT_DATE + $5::int, 3, 'approved')`,
    [id, tenantId, qui.employeeId, type, fin],
  );
  return id;
}

/** Une demande de J+`debut` à J+`fin`, à l'horloge de la base. */
async function poserDu(qui: Agent, debut: number, fin: number): Promise<string> {
  const { rows } = await raw(
    `SELECT (CURRENT_DATE + $1::int)::text AS d, (CURRENT_DATE + $2::int)::text AS f`,
    [debut, fin],
  );
  return (
    await absences.createRequest(qui.session, {
      employeeId: qui.employeeId,
      absenceTypeId: typeId,
      startDate: rows[0]!.d as string,
      endDate: rows[0]!.f as string,
    })
  ).id;
}

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 3 });
  db = new TenantDb();
  absences = new AbsencesService(db);
  habilitations = new HabilitationsService(db);
  people = new PeopleService(db, new EncryptionService());
  organigramme = new OrgUnitsService(db);
  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1,'Circuit',$2)`, [
    tenantId,
    `circuit-${tenantId.slice(0, 8)}`,
  ]);
  typeId = randomUUID();
  await raw(
    `INSERT INTO absence_types (id, tenant_id, name, deducts_balance, allowance_days, frequency)
     VALUES ($1,$2,'Congé annuel',true,300,'annual')`,
    [typeId, tenantId],
  );
  maladieId = randomUUID();
  await raw(
    `INSERT INTO absence_types (id, tenant_id, name, deducts_balance, frequency, requires_document)
     VALUES ($1,$2,'Maladie',false,'none',true)`,
    [maladieId, tenantId],
  );
  missionId = randomUUID();
  await raw(
    `INSERT INTO absence_types (id, tenant_id, name, deducts_balance, frequency, reste_joignable)
     VALUES ($1,$2,'Mission',false,'none',true)`,
    [missionId, tenantId],
  );
  sansDossier = await compte('Rokhaya', 'employee');
  admin = await compte('Ibrahima', 'admin');

  uDG = await unite('Direction Générale', null);
  uDCH = await unite('Direction du Capital Humain', uDG, true);
  uDSID = await unite('Direction des Systèmes', uDG);
  dg = await agent('Cheikh', uDG, null);
  await raw(`UPDATE org_units SET manager_employee_id = $2 WHERE id = $1`, [uDG, dg.employeeId]);
  mariama = await agent('Mariama', uDCH, dg.employeeId);
  await raw(`UPDATE org_units SET manager_employee_id = $2 WHERE id = $1`, [
    uDCH,
    mariama.employeeId,
  ]);
  awa = await agent('Awa', uDCH, mariama.employeeId);
  khady = await agent('Khady', uDCH, mariama.employeeId);
  binta = await agent('Binta', uDCH, awa.employeeId);
  ousmane = await agent('Ousmane', uDSID, dg.employeeId);
  moussa = await agent('Moussa', uDSID, ousmane.employeeId);
  sansCompte = await agent('Sans', uDSID, dg.employeeId, null);
  fatou = await agent('Fatou', uDSID, sansCompte.employeeId);
});

beforeEach(async () => {
  await raw(`DELETE FROM notifications WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM absence_documents WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM absence_approvals WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM absence_requests WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM habilitations WHERE tenant_id = $1`, [tenantId]);
  // L'organigramme d'origine : Mariama dirige la DCH, chacun à sa place.
  await raw(
    `UPDATE org_units SET manager_employee_id = $2, direction_du_personnel = true WHERE id = $1`,
    [uDCH, mariama.employeeId],
  );
  await raw(
    `UPDATE employees SET status = 'active', fin_activite = NULL, inactivite_motif = NULL
      WHERE tenant_id = $1`,
    [tenantId],
  );
  await raw(`UPDATE employees SET manager_employee_id = $2 WHERE id = $1`, [
    moussa.employeeId,
    ousmane.employeeId,
  ]);
  await raw(`UPDATE employees SET manager_employee_id = $2 WHERE id = $1`, [
    mariama.employeeId,
    dg.employeeId,
  ]);
  await raw(`UPDATE employees SET manager_employee_id = $2 WHERE id = $1`, [
    khady.employeeId,
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
    'absence_approvals',
    'absence_requests',
    'absence_types',
    'habilitations',
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
  await raw(`DELETE FROM holidays WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM holiday_seeds WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM audit_log WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  await db?.pool.end();
  await ownerPool?.end();
});

describe('le N+1 d’abord, puis la DCH', () => {
  it('la demande attend le N+1, seul prévenu ; ni un autre compte ni l’administrateur ne visent à sa place', async () => {
    const id = await poser(moussa);
    expect(await circuit(id)).toEqual(['n1:attendue:Ousmane Test', 'dch:a_venir:']);
    expect(await appels(id)).toEqual(['n1:Ousmane']);
    expect(await codeOf(() => viser(sansDossier, id))).toBe('absence.reservee_au_n1');
    expect(await codeOf(() => viser(admin, id))).toBe('absence.reservee_au_n1');
    expect(await codeOf(() => viser(mariama, id))).toBe('absence.reservee_au_n1');
  });

  it('visée par le N+1, elle passe au directeur du Capital Humain — pas à un rôle', async () => {
    const id = await poser(moussa);
    await viser(ousmane, id);
    expect(await circuit(id)).toEqual(['n1:visee:Ousmane Test', 'dch:attendue:Mariama Test']);
    expect(await appels(id)).toEqual(['dch:Mariama']);
    expect(await codeOf(() => viser(sansDossier, id))).toBe('absence.reservee_a_la_dch');
    expect(await codeOf(() => viser(admin, id))).toBe('absence.reservee_a_la_dch');
    await viser(mariama, id);
    expect((await vue(id)).status).toBe('approved');
    expect(await appels(id)).toEqual([]);
    expect(await notif('Moussa', `conge:${id}:verdict`)).toMatch(
      /^Votre congé annuel du \d+ au \d+ \S+ 2027 est approuvé$/,
    );
  });

  it('refusée par le N+1, elle s’arrête là : la DCH n’est jamais appelée', async () => {
    const id = await poser(moussa);
    await viser(ousmane, id, 'rejected');
    expect(await circuit(id)).toEqual(['n1:refusee:Ousmane Test', 'dch:sans_objet:']);
    expect(await appels(id)).toEqual([]);
  });

  it('personne ne vise sa propre demande', async () => {
    const id = await poser(ousmane);
    expect(await codeOf(() => viser(ousmane, id))).toBe('absence.propre_demande');
  });
});

describe('quand le N+1 ne peut pas viser, la demande va directement à la DCH', () => {
  it('un N+1 sans accès au portail', async () => {
    const id = await poser(fatou);
    expect(await circuit(id)).toEqual(['n1:passee:', 'dch:attendue:Mariama Test']);
    expect(await appels(id)).toEqual(['dch:Mariama']);
  });

  it('un N+1 en congé qui rentre avant le congé demandé : il garde la main', async () => {
    await enConge(ousmane);
    const id = await poser(moussa);
    expect(await appels(id)).toEqual(['n1:Ousmane']);
    expect(await circuit(id)).toEqual(['n1:attendue:Ousmane Test', 'dch:a_venir:']);
  });

  it('un N+1 qui ne rentre pas à temps : la DCH, pas le N+2, le temps de son absence', async () => {
    const absence = await enConge(ousmane);
    // Ousmane rentre dans quatre jours ; le congé commence dans trois.
    const id = await poserDu(moussa, 3, 10);
    expect(await circuit(id)).toEqual(['n1:passee:', 'dch:attendue:Mariama Test']);
    expect(await codeOf(() => viser(dg, id))).toBe('absence.reservee_a_la_dch');
    expect(await appels(id)).toEqual(['dch:Mariama']);
    // Il écourte son congé : la demande lui revient, la DCH n'est plus appelée.
    await raw(`UPDATE absence_requests SET end_date = CURRENT_DATE - 1 WHERE id = $1`, [absence]);
    await reconcilier();
    expect(await appels(id)).toEqual(['n1:Ousmane']);
    expect(await circuit(id)).toEqual(['n1:attendue:Ousmane Test', 'dch:a_venir:']);
  });

  it('pendant l’absence du N+1, la DCH vise : la demande est approuvée', async () => {
    await enConge(ousmane);
    const id = await poserDu(moussa, 2, 9);
    await viser(mariama, id);
    expect((await vue(id)).status).toBe('approved');
    expect(await circuit(id)).toEqual(['n1:passee:', 'dch:visee:Mariama Test']);
  });

  it('en mission, le N+1 reste joignable : il garde la main', async () => {
    await enConge(ousmane, missionId, 30);
    const id = await poserDu(moussa, 2, 9);
    expect(await appels(id)).toEqual(['n1:Ousmane']);
    expect((await vue(id)).etapeAttendue).toBe('n1');
  });

  it('le DG : directement à la DCH', async () => {
    const id = await poser(dg);
    expect((await vue(id)).etapeAttendue).toBe('dch');
  });
});

describe('la DCH saisit pour un agent ; le justificatif suit', () => {
  const PDF = Buffer.from('%PDF-1.4 certificat').toString('base64');
  const certificat = { filename: 'certificat.pdf', contentBase64: PDF };
  /** Un arrêt maladie, du lundi d'une semaine au vendredi, sans justificatif. */
  const arret = (par: Agent, pour: Agent) =>
    absences.createRequest(par.session, {
      employeeId: pour.employeeId,
      absenceTypeId: maladieId,
      ...periode(),
    });

  it('un agent sans portail : la DCH saisit, la demande suit le même circuit', async () => {
    const { id } = await absences.createRequest(mariama.session, {
      employeeId: sansCompte.employeeId,
      absenceTypeId: typeId,
      ...periode(),
    });
    // Son N+1 est le DG : il vise d'abord, comme pour toute demande.
    expect(await appels(id)).toEqual(['n1:Cheikh']);
    expect((await vue(id)).saisiePar).toBe('Mariama Test');
  });

  it('un agent hospitalisé : il apprend la saisie ; un autre agent ne saisit pas pour lui', async () => {
    const { id } = await arret(mariama, moussa);
    expect(await notif('Moussa', `conge:${id}:saisie`)).toMatch(
      /^La DCH a saisi pour vous un congé maladie du /,
    );
    expect(await codeOf(() => arret(fatou, moussa))).toBe('absence.self_only');
    expect(await codeOf(() => absences.agentsPourSaisie(moussa.session))).toBe(
      'absence.reserve_a_la_dch',
    );
    const agents = (await absences.agentsPourSaisie(mariama.session)).map((a) => a.nom);
    expect(agents).toContain('Moussa Test');
    expect(agents).not.toContain('Mariama Test');
  });

  it('le justificatif arrive après coup : la DCH ne valide qu’avec lui', async () => {
    const { id } = await arret(moussa, moussa);
    expect(await vue(id)).toMatchObject({ justificatifAttendu: true, documentName: null });
    await viser(ousmane, id);
    expect(await codeOf(() => viser(mariama, id))).toBe('absence.justificatif_attendu');
    // Ni un collègue ; l'agent, oui.
    expect(await codeOf(() => absences.joindreJustificatif(fatou.session, id, certificat))).toBe(
      'absence.document_forbidden',
    );
    await absences.joindreJustificatif(moussa.session, id, certificat);
    expect(await vue(id)).toMatchObject({
      justificatifAttendu: false,
      documentName: 'certificat.pdf',
    });
    await viser(mariama, id);
    expect((await vue(id)).status).toBe('approved');
    // Traitée avec celui-ci : il ne se remplace plus.
    expect(await codeOf(() => absences.joindreJustificatif(moussa.session, id, certificat))).toBe(
      'absence.justificatif_clos',
    );
  });

  it('qui a saisi pour l’agent joint son justificatif ; le refus, lui, n’en a pas besoin', async () => {
    const { id } = await arret(mariama, sansCompte);
    await absences.joindreJustificatif(mariama.session, id, certificat);
    expect((await vue(id)).documentName).toBe('certificat.pdf');
    const { id: autre } = await arret(mariama, moussa);
    await viser(ousmane, autre);
    await viser(mariama, autre, 'rejected');
    expect((await vue(autre)).status).toBe('rejected');
  });
});

describe('les cas où une seule signature suffit', () => {
  it('la demande du directeur du Capital Humain : le visa du DG suffit', async () => {
    const id = await poser(mariama);
    expect(await appels(id)).toEqual(['n1:Cheikh']);
    await viser(dg, id);
    expect((await vue(id)).status).toBe('approved');
    expect(await circuit(id)).toEqual(['n1:visee:Cheikh Test', 'dch:sans_objet:']);
  });

  it('le N+1 est le directeur du Capital Humain : un seul visa', async () => {
    const id = await poser(khady);
    await viser(mariama, id);
    expect((await vue(id)).status).toBe('approved');
    expect(await circuit(id)).toEqual(['n1:visee:Mariama Test', 'dch:visee:Mariama Test']);
  });

  it('le N+1 est le membre qui traite pour la DCH : un seul visa', async () => {
    await habiliter(awa);
    const id = await poser(binta);
    await viser(awa, id);
    expect((await vue(id)).status).toBe('approved');
    expect(await circuit(id)).toEqual(['n1:visee:Awa Test', 'dch:visee:Awa Test/Mariama Test']);
  });
});

describe('le directeur confie une demande', () => {
  it('confiée à Awa : elle est prévenue, elle traite par délégation', async () => {
    const id = await poser(moussa);
    await viser(ousmane, id);
    const r = await absences.confier(mariama.session, id, awa.employeeId);
    expect(r.proposerHabilitation).toBe(true);
    expect(await appels(id)).toEqual(['dch:Awa']);
    expect((await vue(id)).traitement).toMatchObject({
      traitants: 'Awa Test',
      confiee: { nom: 'Awa Test' },
    });
    await viser(awa, id);
    expect(await circuit(id)).toEqual(['n1:visee:Ousmane Test', 'dch:visee:Awa Test/Mariama Test']);
    expect(await notif('Moussa', `conge:${id}:verdict`)).toMatch(/est approuvé$/);
  });

  it('le directeur garde la main : il vise lui-même une demande confiée, ou la reprend', async () => {
    const id = await poser(moussa);
    await viser(ousmane, id);
    await absences.confier(mariama.session, id, awa.employeeId);
    expect((await vue(id, mariama.session)).canDecide).toBe(true);
    await absences.confier(mariama.session, id, null);
    expect(await appels(id)).toEqual(['dch:Mariama']);
  });

  it('ne se confie qu’à un membre de la DCH, présent, qui n’est pas le demandeur', async () => {
    const id = await poser(moussa);
    await viser(ousmane, id);
    expect(await codeOf(() => absences.confier(mariama.session, id, ousmane.employeeId))).toBe(
      'absence.pas_membre_dch',
    );
    expect(await codeOf(() => absences.confier(awa.session, id, khady.employeeId))).toBe(
      'absence.reserve_au_directeur_dch',
    );
    await enConge(khady);
    expect(await codeOf(() => absences.confier(mariama.session, id, khady.employeeId))).toBe(
      'absence.membre_absent',
    );
  });
});

describe('le directeur habilite des membres de sa direction', () => {
  it('les demandes vont directement au membre ; le directeur n’est plus prévenu, mais voit tout', async () => {
    await habiliter(awa);
    // La délégation ne se notifie pas : la demande qui arrive, si.
    expect(await notif('Awa', 'habilitation:%')).toBeNull();
    const id = await poser(moussa);
    await viser(ousmane, id);
    expect(await appels(id)).toEqual(['dch:Awa']);
    expect((await vue(id, mariama.session)).canDecide).toBe(true);
    // Déléguer n'ôte rien : la demande reste dans sa file, et dans celle d'Awa.
    expect(await absences.compteurs(mariama.session)).toMatchObject({ aTraiter: { conges: 1 } });
    expect(await absences.compteurs(awa.session)).toMatchObject({ aTraiter: { conges: 1 } });
    const etat = await habilitations.etat(mariama.session);
    expect(etat.estDirecteur).toBe(true);
    expect(etat.membres.map((m) => `${m.nom}:${m.capacites.join(',')}`)).toEqual([
      'Awa Test:demandes.conges',
      'Binta Test:',
      'Khady Test:',
    ]);
  });

  it('deux membres habilités : les deux sont appelés, le premier qui vise l’emporte', async () => {
    await habiliter(awa);
    await habiliter(khady);
    const id = await poser(moussa);
    await viser(ousmane, id);
    expect(await appels(id)).toEqual(['dch:Awa', 'dch:Khady']);
    expect(await circuit(id)).toEqual([
      'n1:visee:Ousmane Test',
      'dch:attendue:Awa Test ou Khady Test',
    ]);
    await viser(khady, id);
    expect(await circuit(id)).toEqual([
      'n1:visee:Ousmane Test',
      'dch:visee:Khady Test/Mariama Test',
    ]);
    expect(await appels(id)).toEqual([]);
  });

  it('le membre en congé : les demandes vont aux autres, sinon au directeur', async () => {
    await habiliter(khady);
    await enConge(khady);
    const id = await poser(moussa);
    await viser(ousmane, id);
    expect(await appels(id)).toEqual(['dch:Mariama']);
    await habiliter(awa);
    expect(await appels(id)).toEqual(['dch:Awa']);
    const etat = await habilitations.etat(mariama.session);
    expect(etat.membres.find((m) => m.nom === 'Khady Test')?.absent).toBe(true);
  });

  it('le membre ne traite pas sa propre demande : elle revient au directeur', async () => {
    await habiliter(binta);
    const id = await poser(binta);
    await viser(awa, id);
    expect(await appels(id)).toEqual(['dch:Mariama']);
  });

  it('le membre quitte la DCH : ses habilitations tombent, le directeur est prévenu', async () => {
    await habiliter(awa);
    const id = await poser(moussa);
    await viser(ousmane, id);
    expect(await appels(id)).toEqual(['dch:Awa']);
    await raw(`UPDATE assignments SET org_unit_id = $2 WHERE employee_id = $1`, [
      awa.employeeId,
      uDSID,
    ]);
    await reconcilier();
    expect(await appels(id)).toEqual(['dch:Mariama']);
    expect(await notif('Mariama', 'habilitations:%:partie:%')).toBe(
      'Awa Test a quitté la DCH, ses délégations sont retirées',
    );
    const { rows } = await raw(`SELECT fin_motif FROM habilitations WHERE employee_id = $1`, [
      awa.employeeId,
    ]);
    expect(rows).toEqual([{ fin_motif: 'partie' }]);
  });

  it('retirée par le directeur : sans notification, les demandes reviennent', async () => {
    await habiliter(awa);
    const id = await poser(moussa);
    await viser(ousmane, id);
    await habiliter(awa, false);
    expect(await appels(id)).toEqual(['dch:Mariama']);
    expect(await notif('Awa', 'habilitation:%')).toBeNull();
  });

  it('un nouveau directeur trouve les délégations en place (elles sont à la DCH), sans avis', async () => {
    await habiliter(awa);
    const dejaConfiee = await poser(moussa);
    await viser(ousmane, dejaConfiee);
    // Khady prend la tête de la DCH.
    await organigramme.update(admin, uDCH, { managerEmployeeId: khady.employeeId });
    expect(await appels(dejaConfiee)).toEqual(['dch:Awa']);
    const nouvelle = await poser(fatou);
    expect(await appels(nouvelle)).toEqual(['dch:Awa']);
    expect(await notif('Khady', 'dch:directeur:%')).toBeNull();
    expect((await habilitations.etat(khady.session)).estDirecteur).toBe(true);
  });

  it('seul le directeur habilite, et seulement les membres de sa direction', async () => {
    expect(
      await codeOf(() =>
        habilitations.accorder(awa.session, {
          employeeId: khady.employeeId,
          capacite: 'demandes.conges',
          accordee: true,
        }),
      ),
    ).toBe('habilitations.reserve_au_directeur_dch');
    expect(await codeOf(() => habiliter(moussa))).toBe('habilitations.pas_membre_dch');
    expect(await codeOf(() => habilitations.etat(awa.session))).toBe(
      'habilitations.reserve_au_directeur_dch',
    );
  });
});

describe('les accès se lisent dans l’organigramme', () => {
  const de = (qui: SessionUser) =>
    db.withTenant({ tenantId, userId: qui.userId }, (tx) => capacitesDe(tx, qui.userId, qui.role));

  it('le directeur a tout, sauf les textes ; l’administrateur, la gestion sans les demandes ; un agent, rien', async () => {
    expect((await de(mariama.session)).capacites.sort()).toEqual([...CAPACITES_DELEGABLES].sort());
    expect((await de(mariama.session)).capacites).toContain('academy');
    expect((await de(mariama.session)).capacites).not.toContain('textes');
    expect((await de(admin)).capacites.sort()).toEqual([...CAPACITES_GESTION].sort());
    expect(await de(moussa.session)).toEqual({
      capacites: [],
      estAgent: true,
      dirigeLaDCH: false,
      estDG: false,
    });
    expect(await de(sansDossier)).toEqual({
      capacites: [],
      estAgent: false,
      dirigeLaDCH: false,
      estDG: false,
    });
  });

  it('un membre a ce qui lui est confié — tant qu’il est à la DCH', async () => {
    await habiliter(awa, true, 'personnel.consulter');
    expect((await de(awa.session)).capacites).toEqual(['personnel.consulter']);
    await raw(`UPDATE assignments SET org_unit_id = $2 WHERE employee_id = $1`, [
      awa.employeeId,
      uDSID,
    ]);
    // Sans attendre la réconciliation : la session ne l'accorde plus.
    expect((await de(awa.session)).capacites).toEqual([]);
  });
});

describe('le poste de directeur vacant', () => {
  it('l’administrateur est prévenu, et l’intérimaire désigné reçoit la demande', async () => {
    await raw(`UPDATE org_units SET manager_employee_id = NULL WHERE id = $1`, [uDCH]);
    const id = await poser(moussa);
    await viser(ousmane, id);
    expect(await appels(id)).toEqual([]);
    expect(await notif('Ibrahima', 'dch:vacante')).toBe(
      'Une demande attend un responsable à la Direction du Capital Humain',
    );
    // L'intérim : l'administrateur désigne Khady à la tête de la DCH.
    await organigramme.update(admin, uDCH, { managerEmployeeId: khady.employeeId });
    expect(await appels(id)).toEqual(['dch:Khady']);
    expect(await notif('Ibrahima', 'dch:vacante')).toBeNull();
  });
});

describe('la demande suit le N+1, et se clôt proprement', () => {
  it('un nouveau N+1 reprend la demande, et il est prévenu', async () => {
    const id = await poser(moussa);
    await people.update(admin, moussa.employeeId, {
      employee: { managerEmployeeId: sansCompte.employeeId },
    });
    // Le nouveau N+1 n'a pas d'accès : la demande va à la DCH.
    expect(await appels(id)).toEqual(['dch:Mariama']);
  });

  it('annulée par le demandeur : les appels à viser s’en vont', async () => {
    const id = await poser(moussa);
    await absences.cancel(moussa.session, id);
    expect(await appels(id)).toEqual([]);
  });

  it('un agent désactivé : ses demandes en attente sont annulées', async () => {
    const id = await poser(moussa);
    await people.archive(admin, { ids: [moussa.employeeId], archived: true });
    expect((await vue(id)).status).toBe('cancelled');
    expect(await appels(id)).toEqual([]);
  });
});

describe('qui voit quoi', () => {
  it('le directeur du Capital Humain voit tout ; un agent, les siennes', async () => {
    const id = await poser(moussa);
    expect((await vue(id, mariama.session)).employeeName).toBe('Moussa Test');
    const siennes = await absences.listRequests(fatou.session, { limit: 100 } as never);
    expect(siennes.map((r) => r.id)).not.toContain(id);
  });

  it('le N+1 voit son équipe, et ses compteurs ; le directeur, ce qu’il traite', async () => {
    const id = await poser(moussa);
    expect(await absences.compteurs(ousmane.session)).toMatchObject({ equipe: 1, aViser: 1 });
    await viser(ousmane, id);
    expect(await absences.compteurs(mariama.session)).toMatchObject({
      aTraiter: { conges: 1 },
    });
    expect(await absences.compteurs(moussa.session)).toMatchObject({
      aTraiter: { conges: 0 },
    });
  });
});

describe('l’organigramme tient la direction du personnel', () => {
  it('une seule : la marquer la retire à l’autre', async () => {
    await organigramme.update(admin, uDSID, { directionDuPersonnel: true });
    const { rows } = await raw(
      `SELECT name FROM org_units WHERE tenant_id = $1 AND direction_du_personnel`,
      [tenantId],
    );
    expect(rows.map((r) => r.name)).toEqual(['Direction des Systèmes']);
    await raw(`UPDATE org_units SET direction_du_personnel = false WHERE id = $1`, [uDSID]);
  });

  it('elle ne se dissout pas', async () => {
    expect(await codeOf(() => organigramme.remove(admin, uDCH, {}))).toBe('org.dch_indissoluble');
  });
});

describe('les relances', () => {
  it('attendue depuis plus de deux jours ouvrés : la personne attendue reçoit un rappel, une fois', async () => {
    const id = await poser(moussa);
    // L'appel du N+1 date d'il y a dix jours.
    await raw(
      `UPDATE notifications SET created_at = now() - interval '10 days' WHERE dedupe_key = $1`,
      [`conge:${id}:appel:n1`],
    );
    await reconcilier();
    await reconcilier();
    const { rows } = await raw(
      `SELECT u.given_name AS qui, n.title, n.remplacee_le IS NOT NULL AS remplacee
         FROM notifications n JOIN users u ON u.id = n.recipient_user_id
        WHERE n.dedupe_key LIKE $1 ORDER BY n.created_at`,
      [`conge:${id}:%:n1`],
    );
    // Le rappel prend la place de l'appel dans la boîte.
    expect(rows).toEqual([
      { qui: 'Ousmane', title: expect.stringMatching(/^Moussa Test demande/), remplacee: true },
      {
        qui: 'Ousmane',
        title: expect.stringMatching(/^Rappel : Moussa Test demande un congé annuel du /),
        remplacee: false,
      },
    ]);
  });

  it('pas de rappel avant le délai', async () => {
    const id = await poser(moussa);
    await reconcilier();
    expect(await notif('Ousmane', `conge:${id}:rappel:%`)).toBeNull();
  });

  it('l’étape passée, le rappel s’en va avec l’appel ; le délai repart pour le suivant', async () => {
    const id = await poser(moussa);
    await raw(
      `UPDATE notifications SET created_at = now() - interval '10 days' WHERE dedupe_key = $1`,
      [`conge:${id}:appel:n1`],
    );
    await reconcilier();
    await viser(ousmane, id);
    expect(await notif('Ousmane', `conge:${id}:rappel:%`)).toBeNull();
    expect(await notif('Mariama', `conge:${id}:rappel:%`)).toBeNull();
  });
});

describe('la file ne se coupe pas', () => {
  it('une demande ancienne en attente reste dans la file, derrière plus de cent traitées plus récentes', async () => {
    const id = await poser(moussa);
    await raw(`UPDATE absence_requests SET created_at = now() - interval '1 year' WHERE id = $1`, [
      id,
    ]);
    await raw(
      `INSERT INTO absence_requests (id, tenant_id, employee_id, absence_type_id, start_date, end_date, days_count, status)
       SELECT gen_random_uuid(), $1, $2, $3, DATE '2029-01-01' + g, DATE '2029-01-01' + g, 1, 'rejected'
         FROM generate_series(1, 110) g`,
      [tenantId, awa.employeeId, typeId],
    );
    try {
      const liste = await absences.listRequests(admin, { limit: 100 } as never);
      expect(liste.some((r) => r.id === id)).toBe(true);
      expect(liste.filter((r) => r.status === 'rejected').length).toBe(100);
    } finally {
      await raw(`DELETE FROM absence_requests WHERE employee_id = $1 AND status = 'rejected'`, [
        awa.employeeId,
      ]);
    }
  });
});

describe('l’échéance', () => {
  /** Les rappels de cette demande, chez cette personne : la date et s'ils sont dans la boîte. */
  async function rappels(id: string, prenom: string) {
    const { rows } = await raw(
      `SELECT n.created_at > now() - interval '1 hour' AS recent
         FROM notifications n JOIN users u ON u.id = n.recipient_user_id
        WHERE u.given_name = $1 AND n.dedupe_key LIKE $2`,
      [prenom, `conge:${id}:rappel:%`],
    );
    return rows.map((r) => (r.recent ? 'recent' : 'ancien'));
  }

  it('le N+1 est rappelé tous les deux jours ouvrés ; un seul rappel à la fois dans sa boîte', async () => {
    const id = await poser(moussa);
    await raw(
      `UPDATE notifications SET created_at = now() - interval '10 days' WHERE dedupe_key = $1`,
      [`conge:${id}:appel:n1`],
    );
    await reconcilier();
    expect(await rappels(id, 'Ousmane')).toEqual(['recent']);
    // Le rappel date d'une semaine : un nouveau prend sa place.
    await raw(
      `UPDATE notifications SET created_at = now() - interval '7 days' WHERE dedupe_key = $1`,
      [`conge:${id}:rappel:n1`],
    );
    await reconcilier();
    expect(await rappels(id, 'Ousmane')).toEqual(['recent']);
    expect(await notif('Ousmane', `conge:${id}:rappel:n1`)).toMatch(/^Rappel : Moussa Test/);
  });

  it('à la DCH, le rappel reste unique', async () => {
    const id = await poser(moussa);
    await viser(ousmane, id);
    await raw(
      `UPDATE notifications SET created_at = now() - interval '10 days' WHERE dedupe_key = $1`,
      [`conge:${id}:appel:dch`],
    );
    await reconcilier();
    await raw(
      `UPDATE notifications SET created_at = now() - interval '7 days' WHERE dedupe_key = $1`,
      [`conge:${id}:rappel:dch`],
    );
    await reconcilier();
    expect(await rappels(id, 'Mariama')).toEqual(['ancien']);
  });

  it('cinq jours ouvrés sans visa du N+1 : la demande passe à la DCH, qui décide', async () => {
    const id = await poser(moussa);
    await raw(`UPDATE absence_requests SET created_at = now() - interval '14 days' WHERE id = $1`, [
      id,
    ]);
    await reconcilier();
    expect(await circuit(id)).toEqual(['n1:sans_reponse:', 'dch:attendue:Mariama Test']);
    expect(await appels(id)).toEqual(['dch:Mariama']);
    // Le N+1 n'a plus la main : elle est à la DCH.
    expect(await codeOf(() => viser(ousmane, id))).toBe('absence.reservee_a_la_dch');
    await viser(mariama, id);
    expect(await circuit(id)).toEqual(['n1:sans_reponse:', 'dch:visee:Mariama Test']);
    expect((await vue(id)).status).toBe('approved');
  });

  it('avant le délai, elle reste au N+1', async () => {
    const id = await poser(moussa);
    await raw(`UPDATE absence_requests SET created_at = now() - interval '1 day' WHERE id = $1`, [
      id,
    ]);
    await reconcilier();
    expect(await circuit(id)).toEqual(['n1:attendue:Ousmane Test', 'dch:a_venir:']);
  });

  /** Une demande déposée il y a trois jours, qui commence aujourd'hui. */
  async function arriveeASonPremierJour(): Promise<string> {
    const id = await poser(moussa);
    await raw(
      `UPDATE absence_requests SET start_date = CURRENT_DATE, end_date = CURRENT_DATE + 4,
              created_at = now() - interval '3 days' WHERE id = $1`,
      [id],
    );
    return id;
  }

  it('son premier jour arrivé sans réponse, elle expire : l’agent, son N+1 et la DCH le savent', async () => {
    const id = await arriveeASonPremierJour();
    expect(await codeOf(() => viser(ousmane, id))).toBe('absence.expiree');
    const r = await vue(id);
    expect(r.status).toBe('expired');
    expect(r.gestes.annuler).toBe(false);
    expect(await circuit(id)).toEqual(['n1:sans_reponse:', 'dch:sans_objet:']);
    expect(await appels(id)).toEqual([]);
    expect(await notif('Moussa', `conge:${id}:expiree`)).toMatch(
      /^Votre demande de congé annuel du .+ a expiré sans réponse$/,
    );
    for (const qui of ['Ousmane', 'Mariama']) {
      expect(await notif(qui, `conge:${id}:expiree`)).toMatch(
        /^La demande de congé annuel de Moussa Test du .+ a expiré sans réponse$/,
      );
    }
    expect(await codeOf(() => viser(ousmane, id))).toBe('absence.already_decided');
  });

  it('expirée, elle ne retient plus de jours : l’agent en dépose une autre sur la même période', async () => {
    const id = await arriveeASonPremierJour();
    await reconcilier();
    expect((await vue(id)).status).toBe('expired');
    const { rows } = await raw(
      `SELECT start_date::text AS du, end_date::text AS au FROM absence_requests WHERE id = $1`,
      [id],
    );
    const nouvelle = await absences.createRequest(moussa.session, {
      employeeId: moussa.employeeId,
      absenceTypeId: typeId,
      startDate: rows[0].du,
      endDate: rows[0].au,
    });
    // Déposée le jour même : elle n'expire pas, elle attend le N+1.
    await reconcilier();
    expect((await vue(nouvelle.id)).status).toBe('pending');
  });
});

describe('un agent de la DCH qui n’a pas encore activé son compte', () => {
  it('on lui délègue déjà ; il traite dès qu’il active son compte', async () => {
    const nogaye = await agent('Nogaye', uDCH, mariama.employeeId, null);
    try {
      const etat = await habilitations.etat(mariama.session);
      expect(etat.membres.find((m) => m.nom === 'Nogaye Test')).toMatchObject({ compte: false });
      await habiliter(nogaye);
      const id = await poser(moussa);
      await viser(ousmane, id);
      // Sans compte, personne à prévenir : la demande va au directeur.
      expect(await appels(id)).toEqual(['dch:Mariama']);
      await reconcilier();
      // La délégation l'attend.
      const { rows } = await raw(`SELECT fin_at FROM habilitations WHERE employee_id = $1`, [
        nogaye.employeeId,
      ]);
      expect(rows).toEqual([{ fin_at: null }]);
      // Il active son compte : la demande lui arrive.
      const session = await compte('Nogaye', 'employee');
      await raw(
        `UPDATE persons SET user_id = $2 WHERE id = (SELECT person_id FROM employees WHERE id = $1)`,
        [nogaye.employeeId, session.userId],
      );
      await reconcilier();
      expect(await appels(id)).toEqual(['dch:Nogaye']);
      expect((await vue(id, session)).canDecide).toBe(true);
    } finally {
      await raw(`UPDATE assignments SET org_unit_id = $2 WHERE employee_id = $1`, [
        nogaye.employeeId,
        uDSID,
      ]);
    }
  });
});

describe('un congé validé qui change', () => {
  /** Une date à `n` jours d'aujourd'hui, en ISO. */
  const jour = (n: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  /** Un congé déjà validé pour cet agent, de `debut` à `fin` jours d'aujourd'hui. */
  async function congeValide(qui: Agent, debut: number, fin: number): Promise<string> {
    const id = randomUUID();
    await raw(
      `INSERT INTO absence_requests (id, tenant_id, employee_id, absence_type_id, start_date, end_date,
         days_count, status, current_level, requested_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'approved',1,$8)`,
      [id, tenantId, qui.employeeId, typeId, jour(debut), jour(fin), 9, qui.session.userId],
    );
    return id;
  }
  const jourApres = (iso: string, n: number) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  /** Le problème renvoyé : son code, son titre, son détail. */
  async function refus(fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch (err) {
      if (err instanceof ProblemException) return err.problem;
    }
    throw new Error('aucun refus');
  }
  /** Le congé tel que son N+1 le voit, sur l'écran de son équipe. */
  async function vueEquipe(id: string, n1: Agent) {
    const r = (await absences.listRequests(n1.session, { limit: 100, equipe: true } as never)).find(
      (x) => x.id === id,
    );
    if (!r) throw new Error('congé invisible pour ce N+1');
    return r;
  }
  async function appelsReprise(id: string): Promise<string[]> {
    const { rows } = await raw(
      `SELECT u.given_name AS qui, split_part(n.dedupe_key, ':', 4) AS etape
         FROM notifications n JOIN users u ON u.id = n.recipient_user_id
        WHERE n.dedupe_key LIKE $1 ORDER BY 2, 1`,
      [`reprise:${id}:appel:%`],
    );
    return rows.map((r) => `${r.etape}:${r.qui}`);
  }

  it('l’agent annule un congé validé à venir : sans validation, N+1 et DCH sont prévenus', async () => {
    const id = await poser(moussa);
    await viser(ousmane, id);
    await viser(mariama, id);
    expect((await vue(id, moussa.session)).gestes.annuler).toBe(true);
    await absences.cancel(moussa.session, id);
    const v = await vue(id);
    expect(v.status).toBe('cancelled');
    expect(v.annulation).toBeNull();
    expect(await notif('Ousmane', `conge:${id}:annule`)).toMatch(
      /^Le congé annuel de Moussa Test .* est annulé$/,
    );
    expect(await notif('Mariama', `conge:${id}:annule`)).not.toBeNull();
    // L'avis « approuvé » ne dit plus vrai : il a quitté sa boîte.
    expect(await notif('Moussa', `conge:${id}:verdict`)).toBeNull();
  });

  it('un congé commencé ne s’annule plus : il s’écourte', async () => {
    const id = await congeValide(moussa, -2, 6);
    const v = await vue(id, moussa.session);
    expect(v.gestes).toMatchObject({ annuler: false, demanderReprise: true });
    expect(await codeOf(() => absences.cancel(moussa.session, id))).toBe('absence.not_cancellable');
  });

  it('la DCH annule un congé à venir avec un motif ; ni le N+1, ni l’administrateur', async () => {
    const id = await poser(moussa);
    await viser(ousmane, id);
    await viser(mariama, id);
    expect(await codeOf(() => absences.cancel(ousmane.session, id, { motif: 'x' }))).toBe(
      'absence.cancel_forbidden',
    );
    expect(await codeOf(() => absences.cancel(admin, id, { motif: 'x' }))).toBe(
      'absence.cancel_forbidden',
    );
    expect(await codeOf(() => absences.cancel(mariama.session, id))).toBe('absence.motif_requis');
    await absences.cancel(mariama.session, id, { motif: 'Audit de fin d’année' });
    expect((await vue(id)).annulation).toEqual({
      par: 'Mariama Test',
      motif: 'Audit de fin d’année',
    });
    expect(await notif('Moussa', `conge:${id}:annule`)).toMatch(
      /^Votre congé annuel .* est annulé$/,
    );
    expect(await notif('Ousmane', `conge:${id}:annule`)).not.toBeNull();
  });

  it('l’agent revient plus tôt : son N+1 confirme, les jours sont recomptés', async () => {
    const id = await congeValide(moussa, -3, 7);
    await absences.demanderReprise(moussa.session, id, { reprise: jour(1) });
    expect(await appelsReprise(id)).toEqual(['n1:Ousmane']);
    expect(await absences.compteurs(ousmane.session)).toMatchObject({ aViser: 1 });
    expect((await vueEquipe(id, ousmane)).gestes.confirmerReprise).toBe(true);
    expect(
      await codeOf(() => absences.deciderReprise(khady.session, id, { decision: 'approved' })),
    ).toBe('absence.reprise_reservee');
    await absences.deciderReprise(ousmane.session, id, { decision: 'approved' });
    const v = await vue(id);
    expect(v).toMatchObject({
      endDate: jour(0),
      finInitiale: jour(7),
      repriseDemandee: null,
      daysCount: countWorkdays(jour(-3), jour(0), new Set()).workingDays,
      ecourtement: { nature: 'retour', par: 'Ousmane Test', motif: null },
    });
    expect(await appelsReprise(id)).toEqual([]);
    expect(await notif('Moussa', `conge:${id}:ecourte:%`)).toMatch(
      /^Votre reprise le .* est confirmée$/,
    );
    expect(await notif('Mariama', `conge:${id}:ecourte:%`)).toMatch(/est écourté : reprise le/);
  });

  it('le N+1 absent : la DCH confirme le retour', async () => {
    await enConge(ousmane);
    const id = await congeValide(moussa, -3, 7);
    await absences.demanderReprise(moussa.session, id, { reprise: jour(2) });
    expect(await appelsReprise(id)).toEqual(['dch:Mariama']);
    expect(await absences.compteurs(mariama.session)).toMatchObject({ aTraiter: { conges: 1 } });
    await absences.deciderReprise(mariama.session, id, { decision: 'approved' });
    expect((await vue(id)).endDate).toBe(jour(1));
  });

  it('retour refusé, ou retiré : le congé reste tel quel', async () => {
    const id = await congeValide(moussa, -3, 7);
    await absences.demanderReprise(moussa.session, id, { reprise: jour(1) });
    await absences.deciderReprise(ousmane.session, id, { decision: 'rejected' });
    expect(await vue(id)).toMatchObject({
      endDate: jour(7),
      repriseDemandee: null,
      ecourtement: null,
    });
    expect(await notif('Moussa', `conge:${id}:reprise-refusee:%`)).toMatch(/n’est pas confirmée$/);
    await absences.demanderReprise(moussa.session, id, { reprise: jour(2) });
    await absences.retirerReprise(moussa.session, id);
    expect(await appelsReprise(id)).toEqual([]);
    expect((await vue(id)).endDate).toBe(jour(7));
  });

  it('la reprise tombe entre aujourd’hui et la fin prévue, exclue', async () => {
    const id = await congeValide(moussa, -3, 7);
    for (const reprise of [jour(-1), jour(7), jour(8)]) {
      expect(await codeOf(() => absences.demanderReprise(moussa.session, id, { reprise }))).toBe(
        'absence.reprise_hors_conge',
      );
      expect(
        await codeOf(() => absences.rappeler(ousmane.session, id, { reprise, motif: 'x' })),
      ).toBe('absence.reprise_hors_conge');
    }
    // Aujourd'hui, et la veille de la fin prévue : les deux bornes passent.
    await absences.demanderReprise(moussa.session, id, { reprise: jour(0) });
    await absences.demanderReprise(moussa.session, id, { reprise: jour(6) });
    expect((await vue(id)).repriseDemandee).toBe(jour(6));
    await absences.retirerReprise(moussa.session, id);
    const avenir = await poser(moussa);
    expect(
      await codeOf(() => absences.demanderReprise(moussa.session, avenir, { reprise: jour(1) })),
    ).toBe('absence.pas_validee');
    // Un congé fini ne s'écourte plus.
    const fini = await congeValide(moussa, -20, -12);
    expect((await vue(fini, moussa.session)).gestes.demanderReprise).toBe(false);
    expect(
      await codeOf(() => absences.demanderReprise(moussa.session, fini, { reprise: jour(-14) })),
    ).toBe('absence.termine');
  });

  it('le N+1 rappelle un agent en congé, avec un motif ; un collègue ne le peut pas', async () => {
    const id = await congeValide(moussa, -3, 7);
    expect((await vueEquipe(id, ousmane)).gestes.rappeler).toBe(true);
    expect(
      await codeOf(() => absences.rappeler(khady.session, id, { reprise: jour(1), motif: 'x' })),
    ).toBe('absence.rappel_reserve');
    expect(
      await codeOf(() => absences.rappeler(moussa.session, id, { reprise: jour(1), motif: 'x' })),
    ).toBe('absence.propre_demande');
    await absences.rappeler(ousmane.session, id, {
      reprise: jour(1),
      motif: 'Incident en production',
    });
    expect(await vue(id)).toMatchObject({
      endDate: jour(0),
      ecourtement: { nature: 'rappel', par: 'Ousmane Test', motif: 'Incident en production' },
    });
    expect(await notif('Moussa', `conge:${id}:ecourte:%`)).toMatch(
      /^Votre congé annuel est écourté : reprise le/,
    );
    expect(await notif('Mariama', `conge:${id}:ecourte:%`)).not.toBeNull();
    expect(await notif('Ousmane', `conge:${id}:ecourte:%`)).toBeNull();
  });

  it('un chevauchement dit quel congé, et le jour où commencer', async () => {
    const id = await poser(moussa);
    await viser(ousmane, id);
    await viser(mariama, id);
    const v = await vue(id);
    const p = await refus(() =>
      absences.createRequest(moussa.session, {
        employeeId: moussa.employeeId,
        absenceTypeId: typeId,
        startDate: v.endDate,
        endDate: jourApres(v.endDate, 5),
      }),
    );
    expect(p.code).toBe('absence.overlap');
    expect(p.title).toMatch(/^Cette période chevauche votre congé annuel du /);
    expect(p.detail).toMatch(/^Votre congé annuel va jusqu’au .* : commencez celle-ci le .*\.$/);
  });
});

describe('les envois simultanés', () => {
  it('deux demandes au même instant ne dépassent pas le solde', async () => {
    const court = randomUUID();
    await raw(
      `INSERT INTO absence_types (id, tenant_id, name, deducts_balance, allowance_days, frequency)
       VALUES ($1,$2,'Congé court',true,5,'annual')`,
      [court, tenantId],
    );
    try {
      // Deux demandes de 3 jours, chacune possible seule, pas les deux.
      const envoyer = (debut: string, fin: string) =>
        codeOf(() =>
          absences.createRequest(moussa.session, {
            employeeId: moussa.employeeId,
            absenceTypeId: court,
            startDate: debut,
            endDate: fin,
          }),
        );
      const codes = await Promise.all([
        envoyer('2027-03-01', '2027-03-03'),
        envoyer('2027-03-08', '2027-03-10'),
      ]);
      expect(codes.sort()).toEqual(['AUCUNE ERREUR', 'absence.insufficient_balance']);
    } finally {
      await raw(`DELETE FROM absence_requests WHERE absence_type_id = $1`, [court]);
      await raw(`DELETE FROM absence_types WHERE id = $1`, [court]);
    }
  });

  it('le même férié ajouté deux fois au même instant n’est inscrit qu’une fois', async () => {
    try {
      const ajouter = () =>
        codeOf(() =>
          absences.createHoliday(mariama.session, { year: 2027, label: 'Fête de l’agence' }),
        );
      const codes = await Promise.all([ajouter(), ajouter()]);
      expect(codes.sort()).toEqual(['AUCUNE ERREUR', 'absence.holiday_label_exists']);
    } finally {
      await raw(`DELETE FROM holidays WHERE tenant_id = $1`, [tenantId]);
    }
  });
});

describe('le tableau de bord compte ce que ses listes montrent', () => {
  const tableau = () => new DashboardController(db, absences);
  const chiffres = (session: SessionUser) =>
    tableau().stats({ sessionUser: session } as AuthenticatedRequest);

  it('les congés à valider : la file de qui regarde, celle de « Congés à traiter »', async () => {
    await habiliter(awa);
    const id = await poser(moussa);
    await viser(ousmane, id);
    // Une demande dont le début est passé sans visa : échue, elle ne compte plus.
    const echue = await poser(moussa);
    await raw(
      `UPDATE absence_requests SET start_date = CURRENT_DATE - 1, end_date = CURRENT_DATE
        WHERE id = $1`,
      [echue],
    );
    for (const qui of [mariama, awa]) {
      const file = (await absences.compteurs(qui.session)).aTraiter.conges;
      expect((await chiffres(qui.session)).pendingRequests).toBe(file);
      expect(file).toBe(1);
    }
    // Qui ne traite pas les congés lit ce qui attend la DCH, pour l'agence.
    expect((await chiffres(admin)).pendingRequests).toBe(1);
  });

  it('absents aujourd’hui et à venir : les lignes du calendrier, sur trente jours', async () => {
    await enConge(moussa);
    const validee = async (debut: number) => {
      const id = randomUUID();
      await raw(
        `INSERT INTO absence_requests (id, tenant_id, employee_id, absence_type_id, start_date, end_date, days_count, status)
         VALUES ($1,$2,$3,$4, CURRENT_DATE + $5::int, CURRENT_DATE + $5::int + 1, 2, 'approved')`,
        [id, tenantId, ousmane.employeeId, typeId, debut],
      );
      return id;
    };
    await validee(10);
    const tard = await validee(40);
    const d = await chiffres(admin);
    expect([d.absentToday, d.upcomingAbsences]).toEqual([1, 1]);
    const calendrier = await absences.upcoming(admin);
    expect(calendrier.map((r) => r.id)).not.toContain(tard);
    expect(calendrier).toHaveLength(d.absentToday + d.upcomingAbsences);
  });
});

describe('un motif confidentiel', () => {
  const PDF = Buffer.from('%PDF-1.4 certificat').toString('base64');
  beforeAll(() =>
    raw(`UPDATE absence_types SET motif_confidentiel = true WHERE id = $1`, [maladieId]),
  );
  afterAll(() =>
    raw(`UPDATE absence_types SET motif_confidentiel = false WHERE id = $1`, [maladieId]),
  );
  const arret = async () =>
    (
      await absences.createRequest(moussa.session, {
        employeeId: moussa.employeeId,
        absenceTypeId: maladieId,
        ...periode(),
        reason: 'Grippe',
        document: { filename: 'certificat-medical.pdf', contentBase64: PDF },
      })
    ).id;
  const avec = (qui: Agent, ...capacites: Capacite[]) =>
    ({ ...qui.session, capacites }) as SessionUser;

  it('le N+1 vise une absence : ni le type, ni le motif, ni le certificat', async () => {
    const id = await arret();
    const equipe = await absences.listRequests(ousmane.session, {
      equipe: true,
      limit: 100,
    } as never);
    expect(equipe.find((r) => r.id === id)).toMatchObject({
      absenceTypeId: null,
      absenceTypeName: 'Absence',
      reason: null,
      documentName: null,
      justificatifAttendu: false,
      canDecide: true,
    });
    expect(await notif('Ousmane', `conge:${id}:appel:%`)).toMatch(
      /^Moussa Test demande une absence du /,
    );
    expect(await codeOf(() => absences.document(ousmane.session, id))).toBe(
      'absence.document_forbidden',
    );
    // L'agent et la DCH lisent tout.
    for (const qui of [moussa, mariama]) {
      expect(await vue(id, qui.session)).toMatchObject({
        absenceTypeId: maladieId,
        absenceTypeName: 'Maladie',
        reason: 'Grippe',
        documentName: 'certificat-medical.pdf',
      });
    }
    await viser(ousmane, id);
    expect(await notif('Mariama', `conge:${id}:appel:%`)).toMatch(
      /^Moussa Test demande un congé maladie du /,
    );
  });

  it('le calendrier du N+1 et du tableau de bord : une absence', async () => {
    const id = await enConge(moussa, maladieId);
    const type = async (session: SessionUser) =>
      (await absences.upcoming(session)).find((r) => r.id === id)?.absenceTypeName;
    expect(await type(ousmane.session)).toBe('Absence');
    expect(await type(avec(dg, 'pilotage'))).toBe('Absence');
    expect(await type(avec(dg, 'pilotage', 'personnel.sensible'))).toBe('Maladie');
    expect(await type(moussa.session)).toBe('Maladie');
  });

  it('l’annulation : le N+1 apprend qu’une absence est annulée, la DCH lit le motif', async () => {
    const id = randomUUID();
    await raw(
      `INSERT INTO absence_requests (id, tenant_id, employee_id, absence_type_id, start_date, end_date, days_count, status)
       VALUES ($1,$2,$3,$4, CURRENT_DATE + 20, CURRENT_DATE + 21, 2, 'approved')`,
      [id, tenantId, moussa.employeeId, maladieId],
    );
    await absences.cancel(moussa.session, id);
    expect(await notif('Ousmane', `conge:${id}:annule`)).toMatch(
      /^L’absence de Moussa Test du .* est annulée$/,
    );
    expect(await notif('Mariama', `conge:${id}:annule`)).toMatch(
      /^Le congé maladie de Moussa Test du .* est annulé$/,
    );
  });

  it('les soldes : la ligne de la maladie reste à l’agent et aux données sensibles', async () => {
    await enConge(moussa, maladieId);
    const annee = new Date().getFullYear();
    const types = async (session: SessionUser) =>
      (await absences.balances(session, moussa.employeeId, annee)).map((b) => b.absenceTypeName);
    expect(await types(avec(khady, 'personnel.consulter'))).not.toContain('Maladie');
    expect(await types(avec(khady, 'personnel.consulter', 'personnel.sensible'))).toContain(
      'Maladie',
    );
    expect(await types(moussa.session)).toContain('Maladie');
  });

  it('un type modifié sans le dire garde son motif confidentiel', async () => {
    await absences.updateType(avec(mariama, 'conges.parametres'), maladieId, {
      name: 'Maladie',
      deductsBalance: false,
      frequency: 'none',
      requiresDocument: true,
    });
    const { rows } = await raw(`SELECT motif_confidentiel FROM absence_types WHERE id = $1`, [
      maladieId,
    ]);
    expect(rows[0]?.motif_confidentiel).toBe(true);
  });
});

describe('un subordonné ne traite pas la demande de son chef', () => {
  it('Binta, habilitée, s’efface devant la demande d’Awa, sa N+1 : le directeur la traite', async () => {
    await habiliter(binta);
    // Mariama, N+1 d'Awa, ne rentre pas à temps : la demande passe à la DCH.
    await enConge(mariama);
    const id = await poserDu(awa, 3, 10);
    expect((await vue(id)).etapeAttendue).toBe('dch');
    expect(await appels(id)).toEqual(['dch:Mariama']);
    expect(await codeOf(() => viser(binta, id))).toBe('absence.reservee_a_la_dch');
    // Un autre membre habilité, qui ne relève pas d'Awa, la reçoit.
    await habiliter(khady);
    await reconcilier();
    expect(await appels(id)).toEqual(['dch:Khady']);
  });

  it('le directeur ne la confie pas à qui relève du demandeur', async () => {
    await enConge(mariama);
    const id = await poserDu(awa, 3, 10);
    expect(await codeOf(() => absences.confier(mariama.session, id, binta.employeeId))).toBe(
      'absence.confiee_au_subordonne',
    );
    await absences.confier(mariama.session, id, khady.employeeId);
    expect(await appels(id)).toEqual(['dch:Khady']);
  });

  it('la demande du directeur, DG absent, reste à ses membres habilités', async () => {
    await habiliter(awa);
    await enConge(dg);
    const id = await poserDu(mariama, 3, 10);
    expect(await appels(id)).toEqual(['dch:Awa']);
  });
});
