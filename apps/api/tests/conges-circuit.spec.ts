/**
 * Le circuit d'une demande de congé : le N+1, puis la DCH.
 *
 * Décidé avec l'APIX : le N+1 de l'agent vise d'abord ; une fois visée, la
 * demande passe au directeur du Capital Humain — le responsable de la
 * direction du personnel —, qui la traite ou la confie à un membre de sa
 * direction. Chaque règle a son test : qui peut viser, qui est prévenu, ce
 * que le demandeur apprend.
 *
 * Le bac d'essai : la Direction Générale et son DG (Cheikh) ; la DCH, dirigée
 * par Mariama, avec Awa, Khady et Binta (N+1 : Awa) ; la DSID, où Moussa
 * relève d'Ousmane, et Fatou d'un N+1 sans accès au portail ; la RH (rôle,
 * sans dossier) et l'administrateur.
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '@teranga/contracts';
import { EncryptionService } from '../src/common/encryption.service';
import { ProblemException } from '../src/common/problem';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import { OrgUnitsService } from '../src/modules/people/org-units.service';
import { PeopleService } from '../src/modules/people/people.service';
import { AbsencesService } from '../src/modules/time/absences.service';
import { reconcilierLeCircuit } from '../src/modules/time/visas';

const env = loadEnv();
const tenantId = randomUUID();

let ownerPool: Pool;
let db: TenantDb;
let absences: AbsencesService;
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
let rh: SessionUser;
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
    `SELECT n.body FROM notifications n JOIN users u ON u.id = n.recipient_user_id
      WHERE u.given_name = $1 AND n.tenant_id = $2 AND n.dedupe_key LIKE $3`,
    [prenom, tenantId, cle],
  );
  return rows[0]?.body ?? null;
}

const viser = (
  qui: Agent | SessionUser,
  id: string,
  decision: 'approved' | 'rejected' = 'approved',
) => absences.decide('session' in qui ? qui.session : qui, id, { decision });
const reconcilier = () =>
  db.withTenant({ tenantId, userId: admin.userId }, (tx) => reconcilierLeCircuit(tx, tenantId));

/** Un congé approuvé qui couvre aujourd'hui : l'agent est absent. */
async function enConge(qui: Agent) {
  await raw(
    `INSERT INTO absence_requests (id, tenant_id, employee_id, absence_type_id, start_date, end_date, days_count, status)
     VALUES ($1,$2,$3,$4, CURRENT_DATE - 1, CURRENT_DATE + 3, 3, 'approved')`,
    [randomUUID(), tenantId, qui.employeeId, typeId],
  );
}

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 3 });
  db = new TenantDb();
  absences = new AbsencesService(db);
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
  rh = await compte('Rokhaya', 'hr');
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
  await raw(`DELETE FROM absence_approvals WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM absence_requests WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM delegations WHERE tenant_id = $1`, [tenantId]);
  // L'organigramme d'origine : Mariama dirige la DCH, chacun à sa place.
  await raw(
    `UPDATE org_units SET manager_employee_id = $2, direction_du_personnel = true WHERE id = $1`,
    [uDCH, mariama.employeeId],
  );
  await raw(`UPDATE employees SET status = 'active' WHERE tenant_id = $1`, [tenantId]);
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
    'delegations',
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
  await raw(`DELETE FROM audit_log WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  await db?.pool.end();
  await ownerPool?.end();
});

describe('le N+1 d’abord, puis la DCH', () => {
  it('la demande attend le N+1, seul prévenu ; ni la RH ni l’administrateur ne visent à sa place', async () => {
    const id = await poser(moussa);
    expect(await circuit(id)).toEqual(['n1:attendue:Ousmane Test', 'dch:a_venir:']);
    expect(await appels(id)).toEqual(['n1:Ousmane']);
    expect(await codeOf(() => viser(rh, id))).toBe('absence.reservee_au_n1');
    expect(await codeOf(() => viser(admin, id))).toBe('absence.reservee_au_n1');
    expect(await codeOf(() => viser(mariama, id))).toBe('absence.reservee_au_n1');
  });

  it('visée par le N+1, elle passe au directeur du Capital Humain — pas à un rôle', async () => {
    const id = await poser(moussa);
    await viser(ousmane, id);
    expect(await circuit(id)).toEqual(['n1:visee:Ousmane Test', 'dch:attendue:Mariama Test']);
    expect(await appels(id)).toEqual(['dch:Mariama']);
    expect(await codeOf(() => viser(rh, id))).toBe('absence.reservee_a_la_dch');
    expect(await codeOf(() => viser(admin, id))).toBe('absence.reservee_a_la_dch');
    await viser(mariama, id);
    expect((await vue(id)).status).toBe('approved');
    expect(await appels(id)).toEqual([]);
    expect(await notif('Moussa', `conge:${id}:verdict`)).toContain('Mariama Test (DCH)');
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

  it('un N+1 en congé aujourd’hui — la DCH, pas le N+2', async () => {
    await enConge(ousmane);
    const id = await poser(moussa);
    expect(await circuit(id)).toEqual(['n1:passee:', 'dch:attendue:Mariama Test']);
    expect(await codeOf(() => viser(dg, id))).toBe('absence.reservee_a_la_dch');
  });

  it('le DG : directement à la DCH', async () => {
    const id = await poser(dg);
    expect((await vue(id)).etapeAttendue).toBe('dch');
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
    await absences.choisirDelegation(mariama.session, {
      typeDemande: 'conges',
      delegueEmployeeId: awa.employeeId,
    });
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
    expect(r.proposerRegle).toBe(true);
    expect(await appels(id)).toEqual(['dch:Awa']);
    expect((await vue(id)).traitant?.nom).toBe('Awa Test');
    expect((await vue(id)).confiee).toBe(true);
    await viser(awa, id);
    expect(await circuit(id)).toEqual(['n1:visee:Ousmane Test', 'dch:visee:Awa Test/Mariama Test']);
    expect(await notif('Moussa', `conge:${id}:verdict`)).toContain('Awa Test, pour la DCH');
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

describe('le directeur confie toutes les demandes', () => {
  it('elles vont directement au délégué ; le directeur n’est plus prévenu, mais voit tout', async () => {
    await absences.choisirDelegation(mariama.session, {
      typeDemande: 'conges',
      delegueEmployeeId: awa.employeeId,
    });
    expect(await notif('Awa', '%')).toContain('vous confie les demandes de congé');
    const id = await poser(moussa);
    await viser(ousmane, id);
    expect(await appels(id)).toEqual(['dch:Awa']);
    expect((await vue(id, mariama.session)).canDecide).toBe(true);
    const etat = await absences.etatDelegation(mariama.session);
    expect(etat).toMatchObject({ estDirecteur: true, choix: 'delegue', delegueIndisponible: null });
    expect(etat.membres.map((m) => m.nom)).toEqual(['Awa Test', 'Binta Test', 'Khady Test']);
  });

  it('le délégué en congé : les demandes reviennent au directeur le temps de son absence', async () => {
    await absences.choisirDelegation(mariama.session, {
      typeDemande: 'conges',
      delegueEmployeeId: khady.employeeId,
    });
    await enConge(khady);
    const id = await poser(moussa);
    await viser(ousmane, id);
    expect(await appels(id)).toEqual(['dch:Mariama']);
    expect((await absences.etatDelegation(mariama.session)).delegueIndisponible).toBe('absent');
  });

  it('le délégué ne traite pas sa propre demande : elle revient au directeur', async () => {
    await absences.choisirDelegation(mariama.session, {
      typeDemande: 'conges',
      delegueEmployeeId: binta.employeeId,
    });
    const id = await poser(binta);
    await viser(awa, id);
    expect(await appels(id)).toEqual(['dch:Mariama']);
  });

  it('le délégué quitte la DCH : ses demandes reviennent au directeur, qui est prévenu', async () => {
    await absences.choisirDelegation(mariama.session, {
      typeDemande: 'conges',
      delegueEmployeeId: awa.employeeId,
    });
    const id = await poser(moussa);
    await viser(ousmane, id);
    expect(await appels(id)).toEqual(['dch:Awa']);
    await raw(`UPDATE assignments SET org_unit_id = $2 WHERE employee_id = $1`, [
      awa.employeeId,
      uDSID,
    ]);
    await reconcilier();
    expect(await appels(id)).toEqual(['dch:Mariama']);
    expect(await notif('Mariama', 'delegation:%:rompue')).toContain(
      'ne fait plus partie de la Direction du Capital Humain',
    );
    expect((await absences.etatDelegation(mariama.session)).delegueIndisponible).toBe('parti');
  });

  it('un nouveau directeur ne reprend pas le choix de l’ancien ; ce qui était confié le reste', async () => {
    await absences.choisirDelegation(mariama.session, {
      typeDemande: 'conges',
      delegueEmployeeId: awa.employeeId,
    });
    const dejaConfiee = await poser(moussa);
    await viser(ousmane, dejaConfiee);
    // Khady prend la tête de la DCH.
    await organigramme.update(admin, uDCH, { managerEmployeeId: khady.employeeId });
    expect(await appels(dejaConfiee)).toEqual(['dch:Awa']);
    const nouvelle = await poser(fatou);
    expect(await appels(nouvelle)).toEqual(['dch:Khady']);
    expect((await absences.etatDelegation(khady.session)).choix).toBe('aucun');
  });

  it('seul le directeur choisit, et seulement parmi les membres de sa direction', async () => {
    expect(
      await codeOf(() =>
        absences.choisirDelegation(awa.session, { typeDemande: 'conges', delegueEmployeeId: null }),
      ),
    ).toBe('absence.reserve_au_directeur_dch');
    expect(
      await codeOf(() =>
        absences.choisirDelegation(mariama.session, {
          typeDemande: 'conges',
          delegueEmployeeId: moussa.employeeId,
        }),
      ),
    ).toBe('absence.pas_membre_dch');
  });
});

describe('le poste de directeur vacant', () => {
  it('l’administrateur est prévenu, et l’intérimaire désigné reçoit la demande', async () => {
    await raw(`UPDATE org_units SET manager_employee_id = NULL WHERE id = $1`, [uDCH]);
    const id = await poser(moussa);
    await viser(ousmane, id);
    expect(await appels(id)).toEqual([]);
    expect(await notif('Ibrahima', 'dch:vacante')).toContain('Désignez le responsable');
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
      traitement: true,
      aTraiter: 1,
    });
    expect(await absences.compteurs(moussa.session)).toMatchObject({
      traitement: false,
      aTraiter: 0,
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
      `SELECT u.given_name AS qui, n.title FROM notifications n
         JOIN users u ON u.id = n.recipient_user_id WHERE n.dedupe_key = $1`,
      [`conge:${id}:rappel:n1`],
    );
    expect(rows).toEqual([{ qui: 'Ousmane', title: 'Rappel — Congé à valider : Moussa Test' }]);
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
