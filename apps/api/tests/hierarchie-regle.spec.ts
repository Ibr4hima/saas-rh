/**
 * Les deux N+1 (ADR-0147), éprouvés en base.
 *
 *   1. Le N+1 HIÉRARCHIQUE se calcule à partir de l'organigramme : la tête de
 *      l'unité de l'agent, la tête de l'unité au-dessus pour qui dirige, le DG
 *      pour les têtes de direction et le DGA. Ce N+1 ne se saisit pas, et suit
 *      chaque geste : une désignation, une mutation, un départ, le jour qui
 *      vient.
 *   2. À la Direction Générale seulement, la place dont relève un agent
 *      rattaché directement se choisit : le DGA, ou la tête d'une autre unité.
 *   3. Le N+1 FONCTIONNEL se choisit librement, dans toute direction, hors
 *      stage ; quand ce N+1 ne peut plus l'être, l'agent revient au hiérarchique
 *      et la DCH en est prévenue.
 *
 * Le bac d'essai : la Direction Générale au sommet, la DSID et la DCH sous
 * elle.
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CreateEmployeeInput, SessionUser } from '@teranga/contracts';
import { EncryptionService } from '../src/common/encryption.service';
import { ProblemException } from '../src/common/problem';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import { HierarchieService } from '../src/modules/people/hierarchie.service';
import { OrgUnitsService } from '../src/modules/people/org-units.service';
import { PeopleService } from '../src/modules/people/people.service';
import { recalculerLaChaine } from '../src/modules/people/recalcul-de-la-chaine';

const env = loadEnv();

const tenantId = randomUUID();
const userId = randomUUID();
const user = { userId, tenantId, role: 'admin' } as SessionUser;

let ownerPool: Pool;
let db: TenantDb;
let people: PeopleService;
let hierarchie: HierarchieService;
let organigramme: OrgUnitsService;

let uDG: string;
let uDSID: string;
let uDCH: string;

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

function dossier(matricule: string, uniteId: string | null): CreateEmployeeInput {
  return {
    person: { givenName: matricule, familyName: 'Test' },
    employee: { employeeNumber: matricule, hiredOn: '2024-01-01' },
    contract: { contractType: 'cdi', startDate: '2024-01-01' },
    assignment: { positionTitle: 'Analyste', startDate: '2024-01-01', orgUnitId: uniteId },
  } as CreateEmployeeInput;
}

const agent = async (matricule: string, uniteId: string | null) =>
  (await people.create(user, dossier(matricule, uniteId))).id;

async function unite(
  nom: string,
  type: 'direction' | 'department' | 'service',
  parentId: string | null,
): Promise<string> {
  const id = randomUUID();
  await raw(
    `INSERT INTO org_units (id, tenant_id, parent_id, unit_type, name) VALUES ($1,$2,$3,$4,$5)`,
    [id, tenantId, parentId, type, nom],
  );
  return id;
}

/** Ce que fait la veille : la chaîne se recalcule. */
const recalculer = () =>
  db.withTenant({ tenantId, userId }, (tx) => recalculerLaChaine(tx, tenantId));

/** Une tête posée en SQL, puis la chaîne recalculée. */
async function diriger(uniteId: string, employeeId: string | null): Promise<void> {
  await raw(`UPDATE org_units SET manager_employee_id = $2 WHERE id = $1`, [uniteId, employeeId]);
  await recalculer();
}

async function designerLeDGA(employeeId: string | null): Promise<void> {
  await raw(`UPDATE org_units SET adjoint_employee_id = $2 WHERE id = $1`, [uDG, employeeId]);
  await recalculer();
}

const n1 = async (id: string) => (await people.detail(user, id)).managerId;
const fonctionnel = async (id: string) => (await people.detail(user, id)).n1Fonctionnel?.id ?? null;

/** Un contrat, daté par rapport à aujourd'hui : `fin` null, sans terme. */
async function contrat(
  employeeId: string,
  type: 'cdi' | 'cdd' | 'stage',
  debut: number,
  fin: number | null,
): Promise<void> {
  await raw(`DELETE FROM contracts WHERE employee_id = $1`, [employeeId]);
  await raw(
    `INSERT INTO contracts (id, tenant_id, employee_id, contract_type, start_date, end_date)
     VALUES ($1,$2,$3,$4, CURRENT_DATE + $5::int,
             CASE WHEN $6::int IS NULL THEN NULL ELSE CURRENT_DATE + $6::int END)`,
    [randomUUID(), tenantId, employeeId, type, debut, fin],
  );
}

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 3 });
  db = new TenantDb();
  people = new PeopleService(db, new EncryptionService());
  hierarchie = new HierarchieService(db);
  organigramme = new OrgUnitsService(db);
  await raw(
    `INSERT INTO users (id, email, password_hash, given_name, family_name)
     VALUES ($1,$2,'x','Test','Admin')`,
    [userId, `hier-${userId}@test.local`],
  );
  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1,'Hier',$2)`, [
    tenantId,
    `hier-${tenantId.slice(0, 8)}`,
  ]);
  // L'administration reçoit ce que la DCH apprendrait : le bac n'a pas de DCH.
  await raw(
    `INSERT INTO user_tenant_memberships (id, user_id, tenant_id, role)
     VALUES ($1,$2,$3,'admin')`,
    [randomUUID(), userId, tenantId],
  );
});

async function vider() {
  await raw(
    `UPDATE org_units SET manager_employee_id = NULL, adjoint_employee_id = NULL
      WHERE tenant_id = $1`,
    [tenantId],
  );
  await raw(
    `UPDATE employees SET manager_employee_id = NULL, n1_fonctionnel_employee_id = NULL,
                          n1_unite_id = NULL, n1_dga = false, n1_avant_la_regle = NULL
      WHERE tenant_id = $1`,
    [tenantId],
  );
  await raw(`DELETE FROM notifications WHERE tenant_id = $1`, [tenantId]);
  for (const table of ['assignments', 'contracts', 'employees', 'persons', 'org_units']) {
    await raw(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  }
  await raw(`DELETE FROM audit_log WHERE tenant_id = $1`, [tenantId]);
}

beforeEach(async () => {
  await vider();
  uDG = await unite('Direction Générale', 'direction', null);
  uDSID = await unite('Direction des Systèmes', 'direction', uDG);
  uDCH = await unite('Direction du Capital Humain', 'direction', uDG);
});

afterAll(async () => {
  await vider();
  await raw(`DELETE FROM user_tenant_memberships WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  await raw(`DELETE FROM users WHERE id = $1`, [userId]);
  await db?.pool.end();
  await ownerPool?.end();
});

/** Le DG, et une tête à la DSID. */
async function bac(): Promise<{ dg: string; dsid: string }> {
  const dg = await agent('DG', uDG);
  await diriger(uDG, dg);
  const dsid = await agent('DSID', uDSID);
  await diriger(uDSID, dsid);
  return { dg, dsid };
}

describe('le N+1 hiérarchique se calcule', () => {
  it('à la création : la tête de son unité, le DG pour une tête de direction', async () => {
    const { dg, dsid } = await bac();
    const a = await agent('A', uDSID);
    expect(await n1(a)).toBe(dsid);
    expect(await n1(dsid)).toBe(dg);
    expect(await n1(dg)).toBeNull();
  });

  it('une direction sans tête laisse ses agents au DG', async () => {
    const { dg } = await bac();
    const a = await agent('A', uDCH);
    expect(await n1(a)).toBe(dg);
    expect((await hierarchie.controle(user)).anomalies).toEqual([]);
  });

  it('une tête désignée reprend son unité ; partie, le niveau au-dessus reprend', async () => {
    const { dg } = await bac();
    const a = await agent('A', uDCH);
    const rh = await agent('RH', uDCH);
    await diriger(uDCH, rh);
    expect(await n1(a)).toBe(rh);
    expect(await n1(rh)).toBe(dg);
    await diriger(uDCH, null);
    expect(await n1(a)).toBe(dg);
  });

  it('la tête d’un service relève du département qui le contient', async () => {
    const { dsid } = await bac();
    const dep = await unite('Département Études', 'department', uDSID);
    const srv = await unite('Service Dév', 'service', dep);
    const chefDep = await agent('DEP', dep);
    await diriger(dep, chefDep);
    const chefSrv = await agent('SRV', srv);
    await diriger(srv, chefSrv);
    const a = await agent('A', srv);
    expect(await n1(a)).toBe(chefSrv);
    expect(await n1(chefSrv)).toBe(chefDep);
    expect(await n1(chefDep)).toBe(dsid);
  });

  it('une mutation vers une autre direction se programme : le N+1 change le jour venu', async () => {
    const { dsid } = await bac();
    const rh = await agent('RH', uDCH);
    await diriger(uDCH, rh);
    const a = await agent('A', uDSID);
    const demain = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    await people.newAssignment(user, a, {
      orgUnitId: uDCH,
      positionTitle: 'Chargé RH',
      startDate: demain,
    });
    expect(await n1(a)).toBe(dsid);
    // Le jour venu : l'affectation commence, la veille recalcule.
    await raw(
      `UPDATE assignments SET validity = daterange(lower(validity), CURRENT_DATE)
        WHERE employee_id = $1 AND org_unit_id = $2`,
      [a, uDSID],
    );
    await raw(
      `UPDATE assignments SET validity = daterange(CURRENT_DATE, NULL)
        WHERE employee_id = $1 AND org_unit_id = $2`,
      [a, uDCH],
    );
    await recalculer();
    expect(await n1(a)).toBe(rh);
  });

  it('le N+1 hiérarchique ne se saisit pas', async () => {
    const { dsid } = await bac();
    const a = await agent('A', uDSID);
    const rh = await agent('RH', uDCH);
    await people.update(user, a, { employee: { managerEmployeeId: rh } as never });
    expect(await n1(a)).toBe(dsid);
  });
});

describe('à la Direction Générale, la place se choisit', () => {
  /** Un département rattaché à la Direction Générale, et sa tête. */
  async function cabinet(): Promise<{ cab: string; chefCab: string }> {
    const cab = await unite('Cabinet', 'department', uDG);
    const chefCab = await agent('CAB', cab);
    await diriger(cab, chefCab);
    return { cab, chefCab };
  }

  it('le DG par défaut, puis le DGA ou la tête d’une autre unité', async () => {
    const { dg, dsid } = await bac();
    const { chefCab } = await cabinet();
    const dga = await agent('DGA', uDG);
    await designerLeDGA(dga);
    expect(await n1(chefCab)).toBe(dg);
    expect((await people.detail(user, chefCab)).rattachementAuChoix).toBe(true);

    await people.update(user, chefCab, { employee: { rattachementChoisi: { type: 'dga' } } });
    expect(await n1(chefCab)).toBe(dga);
    await people.update(user, chefCab, {
      employee: { rattachementChoisi: { type: 'unite', uniteId: uDSID } },
    });
    expect(await n1(chefCab)).toBe(dsid);
    expect((await people.detail(user, chefCab)).rattachementChoisi).toMatchObject({
      type: 'unite',
      uniteId: uDSID,
    });
    await people.update(user, chefCab, { employee: { rattachementChoisi: null } });
    expect(await n1(chefCab)).toBe(dg);
  });

  it('le choix désigne une place : il suit qui la tient, le DG reprend pendant la vacance', async () => {
    const { dg } = await bac();
    const { chefCab } = await cabinet();
    await people.update(user, chefCab, {
      employee: { rattachementChoisi: { type: 'unite', uniteId: uDSID } },
    });
    const autre = await agent('DSID2', uDSID);
    await diriger(uDSID, autre);
    expect(await n1(chefCab)).toBe(autre);
    await diriger(uDSID, null);
    expect(await n1(chefCab)).toBe(dg);
    expect((await people.detail(user, chefCab)).rattachementChoisi).toMatchObject({
      uniteId: uDSID,
    });
  });

  it('un agent rattaché directement à la Direction Générale choisit aussi', async () => {
    const { dsid } = await bac();
    const a = await agent('A', uDG);
    await people.update(user, a, {
      employee: { rattachementChoisi: { type: 'unite', uniteId: uDSID } },
    });
    expect(await n1(a)).toBe(dsid);
  });

  it('refusé ailleurs, sans DGA, vers une unité sans tête, et quand il bouclerait', async () => {
    await bac();
    const { cab, chefCab } = await cabinet();
    const a = await agent('A', uDSID);
    expect(
      await codeOf(() =>
        people.update(user, a, { employee: { rattachementChoisi: { type: 'dga' } } }),
      ),
    ).toBe('people.rattachement_non_choisi');
    expect(
      await codeOf(() =>
        people.update(user, chefCab, { employee: { rattachementChoisi: { type: 'dga' } } }),
      ),
    ).toBe('people.sans_dga');
    expect(
      await codeOf(() =>
        people.update(user, chefCab, {
          employee: { rattachementChoisi: { type: 'unite', uniteId: uDCH } },
        }),
      ),
    ).toBe('people.unite_sans_tete');
    // Un service sous le cabinet : sa tête relève de la tête du cabinet.
    const scab = await unite('Service du cabinet', 'service', cab);
    const chefScab = await agent('SCAB', scab);
    await diriger(scab, chefScab);
    expect(
      await codeOf(() =>
        people.update(user, chefCab, {
          employee: { rattachementChoisi: { type: 'unite', uniteId: scab } },
        }),
      ),
    ).toBe('people.n1_boucle');
  });

  it('muté hors de la Direction Générale, le choix s’efface', async () => {
    const { dsid } = await bac();
    const a = await agent('A', uDG);
    const rh = await agent('RH', uDCH);
    await diriger(uDCH, rh);
    await people.update(user, a, {
      employee: { rattachementChoisi: { type: 'unite', uniteId: uDCH } },
    });
    await people.newAssignment(user, a, {
      orgUnitId: uDSID,
      positionTitle: 'Analyste',
      startDate: new Date().toISOString().slice(0, 10),
    });
    expect(await n1(a)).toBe(dsid);
    expect((await people.detail(user, a)).rattachementChoisi).toBeNull();
  });
});

describe('le N+1 fonctionnel se choisit librement', () => {
  it('tout agent actif, d’une autre direction ; le hiérarchique ne bouge pas', async () => {
    const { dsid } = await bac();
    const a = await agent('A', uDSID);
    const b = await agent('B', uDCH);
    await people.update(user, a, { employee: { n1FonctionnelId: b } });
    expect(await fonctionnel(a)).toBe(b);
    expect(await n1(a)).toBe(dsid);
    await people.update(user, a, { employee: { n1FonctionnelId: null } });
    expect(await fonctionnel(a)).toBeNull();
  });

  it('se choisit dès la création', async () => {
    await bac();
    const b = await agent('B', uDCH);
    const { id } = await people.create(user, {
      ...dossier('A', uDSID),
      employee: { employeeNumber: 'A', hiredOn: '2024-01-01', n1FonctionnelId: b },
    } as CreateEmployeeInput);
    expect(await fonctionnel(id)).toBe(b);
  });

  it('refusé : soi-même, le DG, une personne en stage, un agent inactif, une boucle', async () => {
    const { dg, dsid } = await bac();
    const a = await agent('A', uDSID);
    const choisir = (pour: string, n1Id: string) =>
      codeOf(() => people.update(user, pour, { employee: { n1FonctionnelId: n1Id } }));
    expect(await choisir(a, a)).toBe('people.n1_soi_meme');
    expect(await choisir(dg, a)).toBe('people.dg_sans_n1');
    const stage = await agent('STAGE', uDCH);
    await contrat(stage, 'stage', -30, 60);
    expect(await choisir(a, stage)).toBe('people.n1_stagiaire');
    const bientot = await agent('BIENTOT', uDCH);
    await contrat(bientot, 'stage', 10, 100);
    expect(await choisir(a, bientot)).toBe('people.n1_stagiaire');
    const parti = await agent('PARTI', uDCH);
    await people.archive(user, { ids: [parti], archived: true, motif: 'demission' });
    expect(await choisir(a, parti)).toBe('people.agent_inactif');
    // A relève de la tête de la DSID : que A soit son N+1 bouclerait.
    expect(await choisir(dsid, a)).toBe('people.n1_boucle');
    expect(await fonctionnel(a)).toBeNull();
  });

  it('parti, l’agent revient au N+1 hiérarchique, et la DCH en est prévenue', async () => {
    const { dsid } = await bac();
    const a = await agent('A', uDSID);
    const b = await agent('B', uDCH);
    await people.update(user, a, { employee: { n1FonctionnelId: b } });
    await people.archive(user, { ids: [b], archived: true, motif: 'demission' });
    expect(await fonctionnel(a)).toBeNull();
    expect(await n1(a)).toBe(dsid);
    const { rows } = await raw(
      `SELECT title FROM notifications WHERE tenant_id = $1 AND type = 'n1_fonctionnel_retire'`,
      [tenantId],
    );
    expect(rows.map((r) => r.title)).toEqual(['B Test n’est plus le N+1 fonctionnel de A Test']);
  });

  it('passé en stage, de même, au passage de la veille', async () => {
    await bac();
    const a = await agent('A', uDSID);
    const b = await agent('B', uDCH);
    await people.update(user, a, { employee: { n1FonctionnelId: b } });
    await contrat(b, 'stage', 0, 90);
    await recalculer();
    expect(await fonctionnel(a)).toBeNull();
  });
});

describe('le contrôle ne signale que ce qui empêche le calcul', () => {
  it('un agent sans unité, des têtes sans DG au-dessus, un DG hors de la Direction Générale', async () => {
    const dsid = await agent('DSID', uDSID);
    await diriger(uDSID, dsid);
    const seul = await agent('SEUL', null);
    let c = await hierarchie.controle(user);
    expect(c.anomalies.map((x) => `${x.matricule}:${x.type}`)).toEqual([
      'DSID:sans_dg',
      'SEUL:sans_unite',
    ]);
    expect(c.nonEvaluables).toBe(2);
    // Un N+1 fonctionnel choisi rend l'évaluation possible.
    await people.update(user, seul, { employee: { n1FonctionnelId: dsid } });
    c = await hierarchie.controle(user);
    expect(c.nonEvaluables).toBe(1);
    // Le DG affecté hors de la Direction Générale.
    const dg = await agent('DG', uDCH);
    await diriger(uDG, dg);
    c = await hierarchie.controle(user);
    expect(c.anomalies.map((x) => `${x.matricule}:${x.type}`)).toEqual([
      'DG:dg_hors_direction_generale',
      'SEUL:sans_unite',
    ]);
  });

  it('une direction se rattache à la Direction Générale', async () => {
    await bac();
    expect(
      await codeOf(() =>
        organigramme.create(user, {
          name: 'Direction perdue',
          unitType: 'direction',
          parentId: uDSID,
          shortName: 'DP',
        }),
      ),
    ).toBe('org.direction_hors_dg');
  });
});

describe('le passage à la règle se revoit une fois', () => {
  it('les N+1 qu’elle a changés : garder l’ancien comme N+1 fonctionnel, ou valider', async () => {
    const { dsid } = await bac();
    const rh = await agent('RH', uDCH);
    await diriger(uDCH, rh);
    const a = await agent('A', uDSID);
    const b = await agent('B', uDSID);
    const c = await agent('C', uDSID);
    // Avant la règle, A et B relevaient de RH ; C, de la tête de la DSID.
    await raw(`UPDATE employees SET n1_avant_la_regle = $2 WHERE id = ANY($1)`, [[a, b], rh]);
    await raw(`UPDATE employees SET n1_avant_la_regle = $2 WHERE id = $1`, [c, dsid]);
    await recalculer();
    let controle = await hierarchie.controle(user);
    expect(controle.changesParLaRegle.map((x) => [x.matricule, x.avant.id, x.apres?.id])).toEqual([
      ['A', rh, dsid],
      ['B', rh, dsid],
    ]);
    await hierarchie.revoir(user, a, true);
    await hierarchie.revoir(user, b, false);
    expect(await fonctionnel(a)).toBe(rh);
    expect(await fonctionnel(b)).toBeNull();
    expect(await n1(a)).toBe(dsid);
    controle = await hierarchie.controle(user);
    expect(controle.changesParLaRegle).toEqual([]);
  });
});

describe('l’ordre des désignations ne compte plus', () => {
  it('un DGA se désigne avant le DG ; la chaîne se complète à l’arrivée du DG', async () => {
    const dga = await agent('DGA', uDG);
    await organigramme.update(user, uDG, { adjointEmployeeId: dga });
    expect(await n1(dga)).toBeNull();
    const dg = await agent('DG', uDG);
    await organigramme.update(user, uDG, { managerEmployeeId: dg });
    expect(await n1(dga)).toBe(dg);
  });
});
