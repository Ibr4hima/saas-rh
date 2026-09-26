/**
 * Le circuit d'une demande de congé : le n+1, puis la RH.
 *
 * Décidé avec l'APIX : le n+1 de l'agent vise d'abord ; une fois visée, la
 * RH est prévenue et vise à son tour. Chaque cas limite a son test — sans n+1
 * (le DG), n+1 sans compte, n+1 parti en cours de route, n+1 qui est aussi
 * RH, changement de n+1, annulation, départ du demandeur —, et chacun dit
 * qui peut viser, qui est prévenu, et ce que le demandeur apprend.
 *
 * Le bac d'essai : la Direction Générale et son DG ; un chef et son agent A ;
 * un n+1 sans accès au portail et son agent B ; une agente RH et son agent C ;
 * la RH (sans dossier) et l'administrateur.
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
import { PeopleService } from '../src/modules/people/people.service';
import { AbsencesService } from '../src/modules/time/absences.service';

const env = loadEnv();
const tenantId = randomUUID();

let ownerPool: Pool;
let db: TenantDb;
let absences: AbsencesService;
let people: PeopleService;
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

/** Un compte, et son appartenance à l'organisation. */
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

/** Un dossier, avec son portail (et son rôle) quand il en a un. */
async function agent(
  prenom: string,
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
  // Tout le monde siège à la Direction Générale : la règle de direction ne
  // se met pas en travers d'un changement de n+1.
  await raw(
    `INSERT INTO assignments (id, tenant_id, employee_id, org_unit_id, position_title, validity)
     VALUES ($1,$2,$3,$4,'Agent', daterange('2024-01-01', NULL))`,
    [randomUUID(), tenantId, employeeId, racine],
  );
  return { employeeId, session: session ?? ({} as SessionUser) };
}

let dg: Agent;
let chef: Agent;
let a: Agent;
let sansCompte: Agent;
let b: Agent;
let agenteRH: Agent;
let c: Agent;
let rh: SessionUser;
let admin: SessionUser;
let racine: string;

/** Une semaine de congé, un peu plus loin à chaque appel : pas de chevauchement. */
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

async function vue(session: SessionUser, id: string, equipe = false) {
  const liste = await absences.listRequests(session, { limit: 100, equipe } as never);
  const r = liste.find((x) => x.id === id);
  if (!r) throw new Error('demande invisible pour cet utilisateur');
  return r;
}
const vueRH = (id: string) => vue(rh, id);

/** Qui a reçu quel appel, pour cette demande. */
async function appels(id: string): Promise<string[]> {
  const { rows } = await raw(
    `SELECT u.given_name AS qui, split_part(n.dedupe_key, ':', 3) AS etape
       FROM notifications n JOIN users u ON u.id = n.recipient_user_id
      WHERE n.dedupe_key LIKE $1 ORDER BY 2, 1`,
    [`conge:${id}:%`],
  );
  return rows.map((r) => `${r.etape}:${r.qui}`);
}

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 3 });
  db = new TenantDb();
  absences = new AbsencesService(db);
  people = new PeopleService(db, new EncryptionService());
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
  racine = randomUUID();
  await raw(
    `INSERT INTO org_units (id, tenant_id, unit_type, name) VALUES ($1,$2,'direction','Direction Générale')`,
    [racine, tenantId],
  );
  dg = await agent('Cheikh', null);
  await raw(`UPDATE org_units SET manager_employee_id = $2 WHERE id = $1`, [racine, dg.employeeId]);
  chef = await agent('Awa', dg.employeeId);
  a = await agent('Moussa', chef.employeeId);
  sansCompte = await agent('Ousmane', dg.employeeId, null);
  b = await agent('Fatou', sansCompte.employeeId);
  agenteRH = await agent('Mariama', dg.employeeId, 'hr');
  c = await agent('Khady', agenteRH.employeeId);
});

beforeEach(async () => {
  await raw(`DELETE FROM notifications WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM absence_approvals WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM absence_requests WHERE tenant_id = $1`, [tenantId]);
  await raw(`UPDATE employees SET status = 'active', manager_employee_id = $2 WHERE id = $1`, [
    a.employeeId,
    chef.employeeId,
  ]);
});

afterAll(async () => {
  await raw(`DELETE FROM notifications WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM absence_approvals WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM absence_requests WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM absence_types WHERE tenant_id = $1`, [tenantId]);
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

describe('le n+1 d’abord, puis la RH', () => {
  it('la demande attend le n+1, qui est seul prévenu', async () => {
    const id = await poser(a);
    const r = await vueRH(id);
    expect(r.etapeAttendue).toBe('n1');
    expect(r.circuit.map((e) => `${e.etape}:${e.etat}:${e.qui ?? ''}`)).toEqual([
      'n1:attendue:Awa Test',
      'rh:a_venir:',
    ]);
    expect(r.canDecide).toBe(false);
    expect(await appels(id)).toEqual(['n1:Awa']);
  });

  it('ni la RH ni l’administrateur ne visent à la place du n+1', async () => {
    const id = await poser(a);
    const attendu = { decision: 'approved' } as const;
    expect(await codeOf(() => absences.decide(rh, id, attendu))).toBe('absence.reservee_au_n1');
    expect(await codeOf(() => absences.decide(admin, id, attendu))).toBe('absence.reservee_au_n1');
  });

  it('visée par le n+1, elle passe à la RH, qui est prévenue — l’appel du n+1 s’en va', async () => {
    const id = await poser(a);
    expect((await vue(chef.session, id, true)).canDecide).toBe(true);
    await absences.decide(chef.session, id, { decision: 'approved' });
    const r = await vueRH(id);
    expect(r.status).toBe('pending');
    expect(r.etapeAttendue).toBe('rh');
    expect(r.canDecide).toBe(true);
    expect(r.circuit[0]).toMatchObject({ etat: 'visee', qui: 'Awa Test' });
    // Toute la RH — la RH, l'administrateur, l'agente RH — et plus le n+1.
    expect(await appels(id)).toEqual(['rh:Ibrahima', 'rh:Mariama', 'rh:Rokhaya']);
  });

  it('la RH vise : la demande est approuvée, le demandeur l’apprend', async () => {
    const id = await poser(a);
    await absences.decide(chef.session, id, { decision: 'approved' });
    await absences.decide(rh, id, { decision: 'approved' });
    const r = await vueRH(id);
    expect(r.status).toBe('approved');
    expect(r.circuit.map((e) => `${e.etape}:${e.etat}:${e.qui}`)).toEqual([
      'n1:visee:Awa Test',
      'rh:visee:Rokhaya Test',
    ]);
    expect(await appels(id)).toEqual(['verdict:Moussa']);
  });

  it('refusée par le n+1, elle s’arrête là : la RH n’est jamais appelée', async () => {
    const id = await poser(a);
    await absences.decide(chef.session, id, {
      decision: 'rejected',
      comment: 'Clôture du trimestre',
    });
    const r = await vueRH(id);
    expect(r.status).toBe('rejected');
    expect(r.circuit.map((e) => e.etat)).toEqual(['refusee', 'sans_objet']);
    expect(await appels(id)).toEqual(['verdict:Moussa']);
    const { rows } = await raw(`SELECT body FROM notifications WHERE dedupe_key = $1`, [
      `conge:${id}:verdict`,
    ]);
    expect(rows[0].body).toContain('« Clôture du trimestre »');
  });

  it('personne ne vise sa propre demande', async () => {
    // Mariama est RH ; sa demande, visée par son n+1 (le DG), revient à la
    // RH — sans elle.
    const id = await poser(agenteRH);
    await absences.decide(dg.session, id, { decision: 'approved' });
    expect(await appels(id)).toEqual(['rh:Ibrahima', 'rh:Rokhaya']);
    expect(
      await codeOf(() => absences.decide(agenteRH.session, id, { decision: 'approved' })),
    ).toBe('absence.propre_demande');
    expect((await vue(agenteRH.session, id)).canDecide).toBe(false);
  });
});

describe('quand il n’y a pas de n+1 qui puisse viser', () => {
  it('le directeur général : directement à la RH', async () => {
    const id = await poser(dg);
    const r = await vueRH(id);
    expect(r.etapeAttendue).toBe('rh');
    expect(r.circuit.map((e) => e.etat)).toEqual(['passee', 'attendue']);
    expect(await appels(id)).toEqual(['rh:Ibrahima', 'rh:Mariama', 'rh:Rokhaya']);
  });

  it('un n+1 sans accès au portail : directement à la RH', async () => {
    const id = await poser(b);
    expect((await vueRH(id)).etapeAttendue).toBe('rh');
    await absences.decide(rh, id, { decision: 'approved' });
    expect((await vueRH(id)).circuit.map((e) => e.etat)).toEqual(['passee', 'visee']);
  });

  it('un n+1 parti en cours de route : la demande revient à la RH, elle n’attend pas', async () => {
    const id = await poser(a);
    await raw(`UPDATE employees SET status = 'archived' WHERE id = $1`, [chef.employeeId]);
    try {
      const r = await vueRH(id);
      expect(r.etapeAttendue).toBe('rh');
      expect(r.canDecide).toBe(true);
      await absences.decide(rh, id, { decision: 'approved' });
      expect((await vueRH(id)).status).toBe('approved');
    } finally {
      await raw(`UPDATE employees SET status = 'active' WHERE id = $1`, [chef.employeeId]);
    }
  });
});

describe('un n+1 qui est aussi RH', () => {
  it('vise les deux étapes d’un coup', async () => {
    const id = await poser(c);
    expect(await appels(id)).toEqual(['n1:Mariama']);
    await absences.decide(agenteRH.session, id, { decision: 'approved' });
    const r = await vueRH(id);
    expect(r.status).toBe('approved');
    expect(r.circuit.map((e) => `${e.etat}:${e.qui}`)).toEqual([
      'visee:Mariama Test',
      'visee:Mariama Test',
    ]);
    expect(await appels(id)).toEqual(['verdict:Khady']);
  });
});

describe('la demande suit le n+1', () => {
  it('un nouveau n+1 reprend la demande, et il est prévenu ; l’ancien n’a plus rien à viser', async () => {
    const id = await poser(a);
    await people.update(admin, a.employeeId, {
      employee: { managerEmployeeId: agenteRH.employeeId },
    });
    expect(await appels(id)).toEqual(['n1:Mariama']);
    expect(await codeOf(() => absences.decide(chef.session, id, { decision: 'approved' }))).toBe(
      'absence.reservee_au_n1',
    );
    expect((await vueRH(id)).circuit[0]).toMatchObject({ etat: 'attendue', qui: 'Mariama Test' });
  });

  it('plus de n+1 du tout : la demande passe à la RH, qui est prévenue', async () => {
    const id = await poser(a);
    await people.update(admin, a.employeeId, { employee: { managerEmployeeId: null } });
    expect(await appels(id)).toEqual(['rh:Ibrahima', 'rh:Mariama', 'rh:Rokhaya']);
    expect((await vueRH(id)).etapeAttendue).toBe('rh');
  });
});

describe('ce qui clôt la demande', () => {
  it('annulée par le demandeur : les appels à viser s’en vont', async () => {
    const id = await poser(a);
    await absences.decide(chef.session, id, { decision: 'approved' });
    await absences.cancel(a.session, id);
    expect(await appels(id)).toEqual([]);
  });

  it('un agent désactivé : ses demandes en attente sont annulées', async () => {
    const id = await poser(a);
    const r = await people.archive(admin, { ids: [a.employeeId], archived: true });
    expect(r.done).toBe(1);
    expect((await vueRH(id)).status).toBe('cancelled');
    expect(await appels(id)).toEqual([]);
  });
});

describe('qui voit quoi', () => {
  it('le n+1 voit les demandes de ses agents directs, pas celles des autres', async () => {
    const pourChef = await poser(a);
    const pourAutre = await poser(c);
    const equipe = await absences.listRequests(chef.session, { limit: 100, equipe: true } as never);
    expect(equipe.map((r) => r.id)).toEqual([pourChef]);
    // Sans le filtre d'équipe, un agent ne voit que les siennes.
    const siennes = await absences.listRequests(chef.session, { limit: 100 } as never);
    expect(siennes.map((r) => r.id)).not.toContain(pourAutre);
    expect(siennes.map((r) => r.id)).not.toContain(pourChef);
  });

  it('les compteurs du n+1 : son équipe, et ce qui attend son visa', async () => {
    await poser(a);
    expect(await absences.compteurs(chef.session)).toEqual({ equipe: 1, aViser: 1 });
    expect(await absences.compteurs(a.session)).toEqual({ equipe: 0, aViser: 0 });
  });
});
