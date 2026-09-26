/**
 * La règle hiérarchique de l'APIX, éprouvée en base.
 *
 *   1. Chaque agent a un responsable (n+1). Seule exception : le directeur
 *      général, qui est le responsable de l'unité RACINE.
 *   2. Ce responsable appartient à la même direction que l'agent. Seule
 *      exception : un directeur, qui relève du directeur général.
 *
 * Ce que ces tests protègent surtout, c'est ce que la règle NE fait PAS : elle
 * ne touche jamais aux dossiers déjà créés sans n+1. Ils restent en place, le
 * contrôle les signale, et l'évaluation les laisse de côté jusqu'à correction.
 *
 * L'ORDRE de construction compte, et ce n'est pas un artifice de test : on ne
 * désigne le responsable d'une unité qu'une fois son dossier créé. Tant que la
 * racine n'a personne, nul n'est « le directeur général » aux yeux de la
 * règle — d'où `creerLeDG` et `creerUnDirecteur`, qui font les deux gestes
 * dans le bon ordre.
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

const env = loadEnv();

const tenantId = randomUUID();
const userId = randomUUID();
const user = { userId, tenantId, role: 'admin' } as SessionUser;

let ownerPool: Pool;
let db: TenantDb;
let people: PeopleService;
let hierarchie: HierarchieService;
let organigramme: OrgUnitsService;

/** L'organigramme du bac d'essai : la DG, et deux directions sous elle. */
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

/** Un dossier tel que le SERVICE le crée — c'est ce chemin que la règle garde. */
function dossier(
  matricule: string,
  uniteId: string | null,
  responsableId?: string,
): CreateEmployeeInput {
  return {
    person: { givenName: matricule, familyName: 'Test' },
    employee: {
      employeeNumber: matricule,
      hiredOn: '2024-01-01',
      ...(responsableId ? { managerEmployeeId: responsableId } : {}),
    },
    assignment: { positionTitle: 'Analyste', startDate: '2024-01-01', orgUnitId: uniteId },
  } as CreateEmployeeInput;
}

/** Un dossier posé en SQL, comme un import en a laissé : sans n+1. */
async function dossierBrut(matricule: string, uniteId: string | null): Promise<string> {
  const personId = randomUUID();
  const employeeId = randomUUID();
  await raw(
    `INSERT INTO persons (id, tenant_id, given_name, family_name) VALUES ($1,$2,$3,'Test')`,
    [personId, tenantId, matricule],
  );
  await raw(
    `INSERT INTO employees (id, tenant_id, person_id, employee_number, hired_on)
     VALUES ($1,$2,$3,$4,'2024-01-01')`,
    [employeeId, tenantId, personId, matricule],
  );
  if (uniteId) {
    await raw(
      `INSERT INTO assignments (id, tenant_id, employee_id, org_unit_id, position_title, validity)
       VALUES ($1,$2,$3,$4,'Analyste','[2024-01-01,)')`,
      [randomUUID(), tenantId, employeeId, uniteId],
    );
  }
  return employeeId;
}

const dirigerUnite = (uniteId: string, employeeId: string | null) =>
  raw(`UPDATE org_units SET manager_employee_id = $2 WHERE id = $1`, [uniteId, employeeId]);

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

/** Le directeur général : son dossier, puis sa désignation sur la racine. */
async function creerLeDG(): Promise<string> {
  const { id } = await people.create(user, dossier('DG', uDG));
  await dirigerUnite(uDG, id);
  return id;
}

/**
 * Un directeur : rattaché au DG pendant que sa direction est sans tête, puis
 * désigné à la tête de celle-ci. C'est le seul ordre possible, et le produit
 * l'autorise explicitement — une direction sans directeur n'a personne
 * d'autre au-dessus que le directeur général.
 */
async function creerUnDirecteur(matricule: string, direction: string, dg: string): Promise<string> {
  const { id } = await people.create(user, dossier(matricule, direction, dg));
  await dirigerUnite(direction, id);
  return id;
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
});

async function vider() {
  await raw(`UPDATE org_units SET manager_employee_id = NULL WHERE tenant_id = $1`, [tenantId]);
  await raw(`UPDATE employees SET manager_employee_id = NULL WHERE tenant_id = $1`, [tenantId]);
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
  await raw(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  await raw(`DELETE FROM users WHERE id = $1`, [userId]);
  await db?.pool.end();
  await ownerPool?.end();
});

describe('le rattachement peut venir plus tard', () => {
  it('crée un dossier sans responsable — on le rattachera ensuite', async () => {
    await creerLeDG();
    const { id } = await people.create(user, dossier('A', uDSID));
    expect((await people.detail(user, id)).managerId).toBeNull();
  });

  it('accepte de RETIRER un responsable : c’est le contrôle qui le signale', async () => {
    const dg = await creerLeDG();
    const chef = await creerUnDirecteur('CHEF', uDSID, dg);
    const a = (await people.create(user, dossier('A', uDSID, chef))).id;
    await people.update(user, a, { employee: { managerEmployeeId: null } });
    expect((await people.detail(user, a)).managerId).toBeNull();
    // Rien n'est perdu : l'agent réapparaît dans les anomalies, et sort du
    // champ de l'évaluation jusqu'à ce qu'on lui redésigne un n+1.
    const c = await hierarchie.controle(user);
    expect(c.anomalies.map((x) => `${x.matricule}:${x.type}`)).toEqual(['A:sans_responsable']);
    expect(c.nonEvaluables).toBe(1);
  });

  it('rattache un dossier créé sans n+1, une fois le responsable connu', async () => {
    const dg = await creerLeDG();
    const chef = await creerUnDirecteur('CHEF', uDSID, dg);
    const a = (await people.create(user, dossier('A', uDSID))).id;
    await people.update(user, a, { employee: { managerEmployeeId: chef } });
    expect((await people.detail(user, a)).managerId).toBe(chef);
    expect((await hierarchie.controle(user)).anomalies).toEqual([]);
  });
});

describe('le responsable est dans la même direction', () => {
  it('accepte un responsable de la même direction', async () => {
    const dg = await creerLeDG();
    const chef = await creerUnDirecteur('CHEF', uDSID, dg);
    const { id } = await people.create(user, dossier('A', uDSID, chef));
    expect((await people.detail(user, id)).managerId).toBe(chef);
  });

  it('accepte un responsable d’une SOUS-UNITÉ de la même direction', async () => {
    // Chef de service et agent ne sont pas dans la même unité, mais bien dans
    // la même direction : c'est la direction qui fait la règle, pas l'unité.
    const dg = await creerLeDG();
    const directeur = await creerUnDirecteur('DIR', uDSID, dg);
    const service = await unite('Service Dév', 'service', uDSID);
    const chefDeService = (await people.create(user, dossier('CHEFSERV', service, directeur))).id;
    const { id } = await people.create(user, dossier('A', uDSID, chefDeService));
    expect((await people.detail(user, id)).managerId).toBe(chefDeService);
  });

  it('refuse un responsable d’une AUTRE direction', async () => {
    const dg = await creerLeDG();
    const rh = await creerUnDirecteur('RH', uDCH, dg);
    await creerUnDirecteur('DIR', uDSID, dg);
    expect(await codeOf(() => people.create(user, dossier('A', uDSID, rh)))).toBe(
      'people.manager_autre_direction',
    );
  });

  it('refuse un n+1 à un agent qui n’est affecté à aucune direction', async () => {
    const dg = await creerLeDG();
    const rh = await creerUnDirecteur('RH', uDCH, dg);
    expect(await codeOf(() => people.create(user, dossier('A', null, rh)))).toBe(
      'people.sans_affectation',
    );
    // Le dossier, lui, se crée sans n+1 — on le rattachera une fois affecté.
    const { id } = await people.create(user, dossier('A', null));
    expect(
      await codeOf(() => people.update(user, id, { employee: { managerEmployeeId: rh } })),
    ).toBe('people.sans_affectation');
  });

  it('refuse un n+1 qui n’est lui-même affecté à aucune direction', async () => {
    await creerLeDG();
    const sansAffectation = await dossierBrut('SANS', null);
    expect(await codeOf(() => people.create(user, dossier('A', uDCH, sansAffectation)))).toBe(
      'people.responsable_sans_affectation',
    );
  });

  it('refuse de sortir de toute direction un agent qui a un n+1, ou qui en est un', async () => {
    const dg = await creerLeDG();
    const chef = await creerUnDirecteur('CHEF', uDCH, dg);
    const encadrant = (await people.create(user, dossier('ENC', uDCH, chef))).id;
    const agent = (await people.create(user, dossier('A', uDCH, encadrant))).id;
    const sortir = (id: string) =>
      people.newAssignment(user, id, {
        positionTitle: 'Chargé de mission',
        orgUnitId: null,
        startDate: '2025-06-01',
      } as never);
    expect(await codeOf(() => sortir(agent))).toBe('people.mutation_sans_direction');
    // Sans son n+1, Encadrant reste celui d'A : son équipe ne le suit pas.
    await people.update(user, encadrant, { employee: { managerEmployeeId: null } });
    expect(await codeOf(() => sortir(encadrant))).toBe('people.equipe_sans_repreneur');
  });

  it('accepte le directeur général pendant qu’une direction est sans tête, puis refuse', async () => {
    const dg = await creerLeDG();
    // La DSID n'a pas de directeur : son premier agent se rattache au DG.
    const premier = (await people.create(user, dossier('PREMIER', uDSID, dg))).id;
    await dirigerUnite(uDSID, premier);
    // La tête est désignée : le chemin se referme.
    expect(await codeOf(() => people.create(user, dossier('SECOND', uDSID, dg)))).toBe(
      'people.manager_autre_direction',
    );
  });
});

describe('le cas des directeurs', () => {
  it('rattache un directeur au directeur général, hors de sa direction', async () => {
    const dg = await creerLeDG();
    const directeur = await creerUnDirecteur('DIR', uDSID, dg);
    // Le rattachement est relu MAINTENANT qu'il dirige la DSID : il tient, et
    // il traverse deux directions.
    await people.update(user, directeur, { employee: { managerEmployeeId: dg } });
    expect((await people.detail(user, directeur)).managerId).toBe(dg);
  });

  it('refuse qu’un directeur relève de quelqu’un d’autre que le directeur général', async () => {
    const dg = await creerLeDG();
    const directeur = await creerUnDirecteur('DIR', uDSID, dg);
    // Un autre directeur, donc pas de boucle : sa chaîne monte au DG.
    const rh = await creerUnDirecteur('RH', uDCH, dg);
    expect(
      await codeOf(() => people.update(user, directeur, { employee: { managerEmployeeId: rh } })),
    ).toBe('people.directeur_hors_dg');
  });

  it('refuse un directeur quand AUCUN directeur général n’est désigné', async () => {
    // Personne ne coiffe la racine : nul n'est « le DG ».
    const premier = (await people.create(user, dossier('PREMIER', uDG))).id;
    const directeur = (await people.create(user, dossier('DIR', uDSID))).id;
    await dirigerUnite(uDSID, directeur);
    expect(
      await codeOf(() =>
        people.update(user, directeur, { employee: { managerEmployeeId: premier } }),
      ),
    ).toBe('people.aucun_directeur_general');
  });
});

describe('le directeur général ne relève de personne', () => {
  it('refuse de lui donner un n+1 depuis sa fiche', async () => {
    const dg = await creerLeDG();
    // Un agent sans lien avec lui : aucune boucle ne peut expliquer le refus.
    const agent = await dossierBrut('A', uDSID);
    expect(
      await codeOf(() => people.update(user, dg, { employee: { managerEmployeeId: agent } })),
    ).toBe('people.dg_sans_responsable');
  });

  it('laisse RETIRER le n+1 qu’une donnée ancienne lui a donné', async () => {
    const dg = await creerLeDG();
    const agent = await dossierBrut('A', uDSID);
    await raw(`UPDATE employees SET manager_employee_id = $2 WHERE id = $1`, [dg, agent]);
    await people.update(user, dg, { employee: { managerEmployeeId: null } });
    expect((await people.detail(user, dg)).managerId).toBeNull();
  });

  it('nommer à la racine quelqu’un qui a un n+1 le lui retire : il ne relève plus de personne', async () => {
    const futur = await dossierBrut('FUTUR', uDG);
    const autre = await dossierBrut('AUTRE', uDG);
    await raw(`UPDATE employees SET manager_employee_id = $2 WHERE id = $1`, [futur, autre]);
    const r = await organigramme.update(user, uDG, { managerEmployeeId: futur });
    expect(r.changements).toEqual([
      expect.objectContaining({
        employeeId: futur,
        avant: 'AUTRE Test',
        apres: null,
        motif: 'devient_dg',
      }),
    ]);
    expect((await hierarchie.controle(user)).directeurGeneral?.employeeId).toBe(futur);
    expect((await people.detail(user, futur)).managerId).toBeNull();
  });

  it('ne gêne pas la nomination d’un directeur, qui, lui, relève du DG', async () => {
    const dg = await creerLeDG();
    const directeur = (await people.create(user, dossier('DIR', uDSID, dg))).id;
    await organigramme.update(user, uDSID, { managerEmployeeId: directeur });
    expect((await people.detail(user, directeur)).managerId).toBe(dg);
  });

  it('le contrôle signale un DG rattaché — et lui seul, même s’il ferme une boucle', async () => {
    const dg = await creerLeDG();
    const agent = await dossierBrut('A', uDG);
    await raw(`UPDATE employees SET manager_employee_id = $2 WHERE id = $1`, [agent, dg]);
    await raw(`UPDATE employees SET manager_employee_id = $2 WHERE id = $1`, [dg, agent]);
    // A relève du DG, qui relève de A : la boucle n'existe que par le n+1 du
    // DG. C'est ce lien qu'il faut retirer, et c'est lui qu'on montre.
    const c = await hierarchie.controle(user);
    expect(c.anomalies.map((a) => `${a.matricule}:${a.type}`)).toEqual(['DG:dg_rattache']);
    expect(c.anomalies[0]?.responsable).toBe('A Test');

    await people.update(user, dg, { employee: { managerEmployeeId: null } });
    expect((await hierarchie.controle(user)).anomalies).toEqual([]);
  });
});

describe('la mutation d’une direction à l’autre', () => {
  it('refuse de laisser l’agent avec un responsable de son ancienne direction', async () => {
    const dg = await creerLeDG();
    const chefDSID = await creerUnDirecteur('CHEF', uDSID, dg);
    await creerUnDirecteur('RH', uDCH, dg);
    const a = (await people.create(user, dossier('A', uDSID, chefDSID))).id;
    expect(
      await codeOf(() =>
        people.newAssignment(user, a, {
          positionTitle: 'Juriste',
          orgUnitId: uDCH,
          startDate: '2025-01-01',
        }),
      ),
    ).toBe('people.responsable_hors_nouvelle_direction');
  });

  it('accepte la mutation quand elle porte le nouveau responsable', async () => {
    const dg = await creerLeDG();
    const chefDSID = await creerUnDirecteur('CHEF', uDSID, dg);
    const chefDCH = await creerUnDirecteur('RH', uDCH, dg);
    const a = (await people.create(user, dossier('A', uDSID, chefDSID))).id;
    await people.newAssignment(user, a, {
      positionTitle: 'Juriste',
      orgUnitId: uDCH,
      startDate: '2025-01-01',
      managerEmployeeId: chefDCH,
    });
    const detail = await people.detail(user, a);
    expect(detail.managerId).toBe(chefDCH);
    expect(detail.assignments[0]?.orgUnitId).toBe(uDCH);
  });

  it('refuse un nouveau responsable qui n’est pas dans la direction d’arrivée', async () => {
    const dg = await creerLeDG();
    const chefDSID = await creerUnDirecteur('CHEF', uDSID, dg);
    await creerUnDirecteur('RH', uDCH, dg);
    const a = (await people.create(user, dossier('A', uDSID, chefDSID))).id;
    expect(
      await codeOf(() =>
        people.newAssignment(user, a, {
          positionTitle: 'Juriste',
          orgUnitId: uDCH,
          startDate: '2025-01-01',
          managerEmployeeId: chefDSID,
        }),
      ),
    ).toBe('people.manager_autre_direction');
  });

  it('accepte une mutation DANS la même direction sans rien redemander', async () => {
    const dg = await creerLeDG();
    const chef = await creerUnDirecteur('CHEF', uDSID, dg);
    const service = await unite('Service Dév', 'service', uDSID);
    const a = (await people.create(user, dossier('A', uDSID, chef))).id;
    await people.newAssignment(user, a, {
      positionTitle: 'Développeur',
      orgUnitId: service,
      startDate: '2025-01-01',
    });
    expect((await people.detail(user, a)).managerId).toBe(chef);
  });
});

describe('le contrôle de la chaîne', () => {
  it('ne signale rien sur une agence en règle', async () => {
    const dg = await creerLeDG();
    const directeur = await creerUnDirecteur('DIR', uDSID, dg);
    await people.create(user, dossier('A', uDSID, directeur));

    const c = await hierarchie.controle(user);
    expect(c.directeurGeneral?.employeeId).toBe(dg);
    expect(c.effectif).toBe(3);
    expect(c.anomalies).toEqual([]);
    expect(c.nonEvaluables).toBe(0);
  });

  it('liste les dossiers laissés sans responsable par un import', async () => {
    await creerLeDG();
    await dossierBrut('IMPORTE-1', uDSID);
    await dossierBrut('IMPORTE-2', null);

    const c = await hierarchie.controle(user);
    expect(c.parType.sans_responsable).toBe(2);
    // Les deux sont hors du champ de l'évaluation — pas supprimés.
    expect(c.nonEvaluables).toBe(2);
    expect(c.effectif).toBe(3);
    expect(c.anomalies.map((a) => a.matricule)).toEqual(['IMPORTE-1', 'IMPORTE-2']);
    expect(c.anomalies[0]?.direction).toBe('Direction des Systèmes');
  });

  it('signale un rattachement hors direction, sans le compter comme bloquant', async () => {
    const dg = await creerLeDG();
    const rh = await creerUnDirecteur('RH', uDCH, dg);
    const a = await dossierBrut('A', uDSID);
    await raw(`UPDATE employees SET manager_employee_id = $2 WHERE id = $1`, [a, rh]);

    const c = await hierarchie.controle(user);
    expect(c.parType.hors_direction).toBe(1);
    expect(c.nonEvaluables).toBe(0);
    const anomalie = c.anomalies.find((x) => x.matricule === 'A');
    expect(anomalie?.responsable).toBe('RH Test');
    expect(anomalie?.directionDuResponsable).toBe('Direction du Capital Humain');
  });

  it('signale l’absence de directeur général', async () => {
    await dossierBrut('A', uDSID);
    const c = await hierarchie.controle(user);
    expect(c.directeurGeneral).toBeNull();
    expect(c.parType.sans_responsable).toBe(1);
  });

  it('signale un responsable dont le dossier est archivé', async () => {
    const dg = await creerLeDG();
    const chef = await creerUnDirecteur('CHEF', uDSID, dg);
    const a = (await people.create(user, dossier('A', uDSID, chef))).id;
    await raw(`UPDATE employees SET status = 'archived' WHERE id = $1`, [chef]);

    const c = await hierarchie.controle(user);
    expect(c.anomalies.find((x) => x.employeeId === a)?.type).toBe('responsable_archive');
    expect(c.nonEvaluables).toBe(1);
  });

  it('signale les agents restés rattachés au DG après la nomination d’un directeur', async () => {
    // Le chemin toléré à la création — une direction sans tête — laisse une
    // trace dès qu'un directeur est nommé : ces agents relèvent d'une autre
    // direction que la leur, et le contrôle est plus strict que l'écriture.
    const dg = await creerLeDG();
    const premier = (await people.create(user, dossier('PREMIER', uDSID, dg))).id;
    const second = (await people.create(user, dossier('SECOND', uDSID, dg))).id;
    await dirigerUnite(uDSID, premier);

    const c = await hierarchie.controle(user);
    expect(c.anomalies.map((a) => `${a.matricule}:${a.type}`)).toEqual(['SECOND:hors_direction']);
    expect(second).toBeTruthy();
  });
});
