/**
 * Les transitions de la chaîne hiérarchique, de bout en bout (ADR-0147).
 *
 * L'organigramme bouge : un DG succède à un autre, une direction reçoit sa
 * tête, une unité se déplace ou se dissout, un agent change d'unité. Le N+1
 * hiérarchique se recalcule à chaque geste : rien n'est à confier ni à
 * choisir, et ce que le geste change est dit AVANT de valider, puis fait.
 *
 * Le bac d'essai : la Direction Générale (le sommet), la DSID et la DCH sous
 * elle, un département Études dans la DSID.
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

let uDG: string;
let uDSID: string;
let uDCH: string;
let uEtudes: string;

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

/** Un agent, affecté : son N+1 découle de l'organigramme. */
async function agent(matricule: string, uniteId: string): Promise<string> {
  const input = {
    person: { givenName: matricule, familyName: 'Test' },
    employee: { employeeNumber: matricule, hiredOn: '2024-01-01' },
    assignment: { positionTitle: 'Analyste', startDate: '2024-01-01', orgUnitId: uniteId },
  } as CreateEmployeeInput;
  return (await people.create(user, input)).id;
}

/** La personne remplacée, s'il y en a une, reste dans l'unité comme conseiller. */
const nommer = (uniteId: string, employeeId: string | null, depuis?: string) =>
  organigramme.update(user, uniteId, {
    managerEmployeeId: employeeId,
    posteDeLAncien: 'Conseiller',
    ...(depuis ? { depuis } : {}),
  });
const n1 = async (id: string) => (await people.detail(user, id)).managerId;
const anomalies = async () =>
  (await hierarchie.controle(user)).anomalies.map((a) => `${a.matricule}:${a.type}`);
const muter = (id: string, orgUnitId: string | null, plus: Record<string, string> = {}) =>
  people.newAssignment(user, id, {
    positionTitle: 'Nouveau poste',
    orgUnitId,
    startDate: '2025-06-01',
    ...plus,
  } as never);

/** Le DG, affecté à la Direction Générale puis nommé à sa tête. */
async function leDG(matricule = 'DG'): Promise<string> {
  const id = await agent(matricule, uDG);
  await nommer(uDG, id, '2024-01-01');
  return id;
}

/** Une tête de direction : affectée dans sa direction, puis nommée. */
async function uneTete(matricule: string, direction: string): Promise<string> {
  const id = await agent(matricule, direction);
  await nommer(direction, id, '2024-01-01');
  return id;
}

async function unite(nom: string, type: string, parentId: string | null): Promise<string> {
  const id = randomUUID();
  await raw(
    `INSERT INTO org_units (id, tenant_id, parent_id, unit_type, name) VALUES ($1,$2,$3,$4,$5)`,
    [id, tenantId, parentId, type, nom],
  );
  return id;
}

async function vider() {
  await raw(
    `UPDATE org_units SET manager_employee_id = NULL, adjoint_employee_id = NULL
      WHERE tenant_id = $1`,
    [tenantId],
  );
  await raw(
    `UPDATE employees SET manager_employee_id = NULL, n1_fonctionnel_employee_id = NULL,
                          n1_unite_id = NULL, n1_dga = false
      WHERE tenant_id = $1`,
    [tenantId],
  );
  for (const table of ['assignments', 'contracts', 'employees', 'persons', 'org_units']) {
    await raw(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  }
  await raw(`DELETE FROM audit_log WHERE tenant_id = $1`, [tenantId]);
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
    [userId, `transitions-${userId}@test.local`],
  );
  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1,'Transitions',$2)`, [
    tenantId,
    `transitions-${tenantId.slice(0, 8)}`,
  ]);
});

beforeEach(async () => {
  await vider();
  uDG = await unite('Direction Générale', 'direction', null);
  uDSID = await unite('Direction des Systèmes', 'direction', uDG);
  uDCH = await unite('Direction du Capital Humain', 'direction', uDG);
  uEtudes = await unite('Département Études', 'department', uDSID);
});

afterAll(async () => {
  await vider();
  await raw(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  await raw(`DELETE FROM users WHERE id = $1`, [userId]);
  await db?.pool.end();
  await ownerPool?.end();
});

describe('le DG', () => {
  it('se nomme parmi les agents de la Direction Générale, pas ailleurs', async () => {
    const ailleurs = await agent('AILLEURS', uDSID);
    expect(await codeOf(() => nommer(uDG, ailleurs))).toBe('org.dg_hors_direction_generale');
  });

  it('ne se retire pas : se remplace', async () => {
    await leDG();
    expect(await codeOf(() => nommer(uDG, null))).toBe('org.dg_requis');
  });

  it('un nouveau DG reprend tout ce qui relevait du DG précédent, et ce DG aussi', async () => {
    const ancien = await leDG('ANCIEN');
    const dsid = await uneTete('DSID', uDSID);
    const dch = await uneTete('DCH', uDCH);
    const assistant = await agent('ASSISTANT', uDG);
    const adjoint = await agent('ADJOINT', uDG);

    const r = await nommer(uDG, adjoint);

    expect(await n1(adjoint)).toBeNull();
    for (const id of [dsid, dch, assistant, ancien]) expect(await n1(id)).toBe(adjoint);
    expect(r.changements.map((c) => `${c.nom}:${c.motif}`).sort()).toEqual([
      'ADJOINT Test:dg',
      'ANCIEN Test:direction_generale',
      'ASSISTANT Test:direction_generale',
      'DCH Test:tete_de_direction',
      'DSID Test:tete_de_direction',
    ]);
    expect(r.aRevoir).toEqual([]);
    expect(await anomalies()).toEqual([]);
  });

  it('l’aperçu dit tout ce que ferait la succession, et n’écrit rien', async () => {
    const ancien = await leDG('ANCIEN');
    const dsid = await uneTete('DSID', uDSID);
    const adjoint = await agent('ADJOINT', uDG);

    const apercu = await organigramme.apercu(user, uDG, {
      managerEmployeeId: adjoint,
      posteDeLAncien: 'Conseiller',
    });
    expect(apercu.changements).toHaveLength(3);
    // Rien n'a bougé.
    expect((await hierarchie.controle(user)).directeurGeneral?.employeeId).toBe(ancien);
    expect(await n1(dsid)).toBe(ancien);
    expect(await n1(adjoint)).toBe(ancien);

    // Et la vraie succession fait exactement ce que l'aperçu annonçait.
    const r = await nommer(uDG, adjoint);
    expect(r.changements).toEqual(apercu.changements);
  });

  it('ne quitte pas la Direction Générale tant que la place est la sienne', async () => {
    const dg = await leDG();
    expect(await codeOf(() => muter(dg, uDSID))).toBe('people.dg_quitte_la_dg');
    // Une mutation DANS la Direction Générale reste possible.
    await muter(dg, uDG);
  });

  it('une tête de direction se nomme avant le DG : sans N+1 jusqu’à son arrivée', async () => {
    const chef = await agent('CHEF', uDSID);
    await nommer(uDSID, chef);
    expect(await n1(chef)).toBeNull();
    expect(await anomalies()).toEqual(['CHEF:sans_dg']);
    const dg = await leDG();
    expect(await n1(chef)).toBe(dg);
    expect(await anomalies()).toEqual([]);
  });
});

describe('les têtes de direction', () => {
  it('nommée, une tête de direction relève du DG', async () => {
    const dg = await leDG();
    const chef = await agent('CHEF', uDSID);
    await nommer(uDSID, chef);
    expect(await n1(chef)).toBe(dg);
  });

  it('une direction sans tête : ses agents relèvent du DG en attendant, et c’est en règle', async () => {
    const dg = await leDG();
    const a = await agent('A', uDSID);
    const b = await agent('B', uEtudes);
    expect([await n1(a), await n1(b)]).toEqual([dg, dg]);
    expect(await anomalies()).toEqual([]);
  });

  it('dès qu’elle a sa tête, les agents qu’attendait le DG passent dessous', async () => {
    const dg = await leDG();
    const a = await agent('A', uDSID);
    const b = await agent('B', uEtudes);
    const chef = await agent('CHEF', uDSID);

    const r = await nommer(uDSID, chef);

    expect(await n1(a)).toBe(chef);
    expect(await n1(b)).toBe(chef);
    expect(await n1(chef)).toBe(dg);
    expect(r.changements.map((c) => `${c.nom}:${c.motif}`).sort()).toEqual([
      'A Test:tete_de_son_unite',
      'B Test:niveau_au_dessus',
    ]);
    expect(await anomalies()).toEqual([]);
  });

  it('une nouvelle tête : la précédente, restée dans la direction, passe dessous, l’équipe aussi', async () => {
    const dg = await leDG();
    const ancien = await uneTete('ANCIEN', uDSID);
    const equipier = await agent('EQUIPIER', uDSID);
    const nouveau = await agent('NOUVEAU', uDSID);

    const r = await nommer(uDSID, nouveau);

    expect(await n1(nouveau)).toBe(dg);
    expect(await n1(ancien)).toBe(nouveau);
    expect(await n1(equipier)).toBe(nouveau);
    expect(r.changements.map((c) => `${c.nom}:${c.motif}`).sort()).toEqual([
      'ANCIEN Test:tete_de_son_unite',
      'EQUIPIER Test:tete_de_son_unite',
      'NOUVEAU Test:tete_de_direction',
    ]);
    expect(await anomalies()).toEqual([]);
  });

  it('l’ancienne tête part dans une autre direction : l’équipe ne suit pas', async () => {
    await leDG();
    const ancien = await uneTete('ANCIEN', uDSID);
    const equipier = await agent('EQUIPIER', uDSID);
    const nouveau = await agent('NOUVEAU', uDSID);
    await nommer(uDSID, nouveau, '2024-01-01');
    // Conseiller à la DSID, l'ancienne tête rejoint ensuite la DCH, qui a la sienne.
    const dch = await uneTete('DCH', uDCH);
    await muter(ancien, uDCH);
    expect(await n1(equipier)).toBe(nouveau);
    expect(await n1(ancien)).toBe(dch);
    expect(await anomalies()).toEqual([]);
  });

  it('une tête retirée sans successeur : la direction retombe sous le DG, en règle', async () => {
    const dg = await leDG();
    await uneTete('CHEF', uDSID);
    const a = await agent('A', uDSID);
    await nommer(uDSID, null);
    expect(await n1(a)).toBe(dg);
    expect(await anomalies()).toEqual([]);
  });
});

describe('un départ ne demande personne pour reprendre une équipe', () => {
  it('une tête d’unité ne part pas sans successeur', async () => {
    await leDG();
    await uneTete('DSID', uDSID);
    const chef = await agent('CHEF', uEtudes);
    await nommer(uEtudes, chef);
    const refus = await people.archive(user, { ids: [chef], archived: true, motif: 'demission' });
    expect(refus.done).toBe(0);
    expect(refus.skipped[0]?.reason).toBe(
      "Dirige « Département Études » : nommez d'abord un successeur",
    );
  });

  it('l’unité retirée à sa tête, son équipe passe au niveau au-dessus, et la tête peut partir', async () => {
    await leDG();
    const dsid = await uneTete('DSID', uDSID);
    const chef = await agent('CHEF', uEtudes);
    await nommer(uEtudes, chef);
    const a = await agent('A', uEtudes);
    expect(await n1(a)).toBe(chef);
    await nommer(uEtudes, null);
    expect(await n1(a)).toBe(dsid);
    const r = await people.archive(user, { ids: [chef], archived: true, motif: 'demission' });
    expect(r.done).toBe(1);
    expect(await anomalies()).toEqual([]);
  });

  it('un lot de départs : rien à confier', async () => {
    await leDG();
    const dsid = await uneTete('DSID', uDSID);
    const a = await agent('A', uDSID);
    const b = await agent('B', uDSID);
    const r = await people.archive(user, { ids: [a, b], archived: true, motif: 'demission' });
    expect(r.done).toBe(2);
    expect((await people.detail(user, dsid)).team).toEqual([]);
  });

  it('effacé, de même', async () => {
    await leDG();
    await uneTete('DSID', uDSID);
    const a = await agent('A', uDSID);
    expect((await people.remove(user, { ids: [a] })).done).toBe(1);
  });
});

describe('les réorganisations', () => {
  it('un seul sommet : ni création, ni re-rattachement d’un second', async () => {
    expect(
      await codeOf(() =>
        organigramme.create(user, { name: 'Autre sommet', unitType: 'direction', shortName: 'AS' }),
      ),
    ).toBe('org.sommet_unique');
    expect(await codeOf(() => organigramme.update(user, uDSID, { parentId: null }))).toBe(
      'org.sommet_unique',
    );
  });

  it('déplacer une unité : la chaîne suit, et l’aperçu le dit d’abord', async () => {
    await leDG();
    const dsid = await uneTete('DSID', uDSID);
    const dch = await uneTete('DCH', uDCH);
    const a = await agent('A', uEtudes);
    expect(await n1(a)).toBe(dsid);

    const apercu = await organigramme.apercu(user, uEtudes, { parentId: uDCH });
    expect(apercu.changements.map((c) => `${c.nom}:${c.avant}:${c.apres}`)).toEqual([
      'A Test:DSID Test:DCH Test',
    ]);
    expect(apercu.aRevoir).toEqual([]);
    expect(await n1(a)).toBe(dsid);

    const r = await organigramme.update(user, uEtudes, { parentId: uDCH });
    expect(r.changements).toEqual(apercu.changements);
    expect(await n1(a)).toBe(dch);
  });

  it('dissoudre sans unité d’accueil : l’aperçu dit qui se retrouvera sans unité', async () => {
    await leDG();
    await uneTete('DSID', uDSID);
    await agent('A', uEtudes);
    const apercu = await organigramme.apercuSuppression(user, uEtudes, {});
    expect(apercu.aRevoir.map((a) => `${a.matricule}:${a.type}`)).toEqual(['A:sans_unite']);
    // Avec une unité d'accueil, rien ne se casse.
    const avecAccueil = await organigramme.apercuSuppression(user, uEtudes, { reassignTo: uDSID });
    expect(avecAccueil.aRevoir).toEqual([]);
  });

  it('une direction ne se crée et ne se forme que sous la Direction Générale', async () => {
    await leDG();
    expect(
      await codeOf(() =>
        organigramme.update(user, uEtudes, { unitType: 'direction', shortName: 'DE' }),
      ),
    ).toBe('org.direction_hors_dg');
  });

  it('un département rattaché à la Direction Générale devenu direction : sa tête relève du DG', async () => {
    const dg = await leDG();
    const cab = await unite('Cabinet', 'department', uDG);
    const chef = await agent('CHEF', cab);
    await nommer(cab, chef);
    expect(await n1(chef)).toBe(dg);
    await organigramme.update(user, cab, { unitType: 'direction', shortName: 'CAB' });
    expect(await n1(chef)).toBe(dg);
    expect(await anomalies()).toEqual([]);
  });
});

describe('les mutations', () => {
  it('la tête d’une unité ne la quitte pas par une mutation', async () => {
    await leDG();
    await uneTete('DSID', uDSID);
    const chef = await agent('CHEF', uEtudes);
    await nommer(uEtudes, chef);
    await agent('A', uEtudes);
    expect(await codeOf(() => muter(chef, uDCH))).toBe('people.manager_cannot_leave_unit');
  });

  it('une mutation PROGRAMMÉE vers une autre direction s’enregistre ; le N+1 attend le jour venu', async () => {
    await leDG();
    const dsid = await uneTete('DSID', uDSID);
    await uneTete('DCH', uDCH);
    const a = await agent('A', uDSID);
    await people.newAssignment(user, a, {
      positionTitle: 'Chargé RH',
      orgUnitId: uDCH,
      startDate: '2099-01-01',
    } as never);
    expect(await n1(a)).toBe(dsid);
    expect(await anomalies()).toEqual([]);
  });

  it('une mutation programmée DANS la même direction, de même', async () => {
    await leDG();
    const dsid = await uneTete('DSID', uDSID);
    const a = await agent('A', uDSID);
    await people.newAssignment(user, a, {
      positionTitle: 'Analyste principal',
      orgUnitId: uEtudes,
      startDate: '2099-01-01',
    } as never);
    expect(await n1(a)).toBe(dsid);
    expect(await anomalies()).toEqual([]);
  });

  it('le DG reste N+1 d’un agent qui passe d’une direction sans tête à une autre', async () => {
    const dg = await leDG();
    const a = await agent('A', uDSID);
    const r = await muter(a, uDCH);
    expect(await n1(a)).toBe(dg);
    expect(r.aRevoir).toEqual([]);
  });

  it('placé dans une direction pourvue, un agent sans unité relève de sa tête', async () => {
    await leDG();
    const dsid = await uneTete('DSID', uDSID);
    const { id } = await people.create(user, {
      person: { givenName: 'A', familyName: 'Test' },
      employee: { employeeNumber: 'A', hiredOn: '2024-01-01' },
    } as CreateEmployeeInput);
    expect(await anomalies()).toEqual(['A:sans_unite']);
    const r = await muter(id, uDSID);
    expect(await n1(id)).toBe(dsid);
    expect(r.aRevoir).toEqual([]);
    expect(await anomalies()).toEqual([]);
  });

  it('rend ce que la mutation laisse à faire, sans attendre le contrôle', async () => {
    await leDG();
    const a = await agent('A', uDSID);
    const r = await muter(a, null);
    expect(r.aRevoir.map((x) => `${x.matricule}:${x.type}`)).toEqual(['A:sans_unite']);
  });
});

describe('une tête coiffe son unité', () => {
  it('une tête nommée reprend toute son unité, départements sans tête compris', async () => {
    const dg = await leDG();
    const d = await agent('D', uDSID);
    const a = await agent('A', uEtudes);
    const c = await agent('C', uDSID);
    expect([await n1(a), await n1(c)]).toEqual([dg, dg]);

    const r = await nommer(uDSID, d);
    expect(await n1(d)).toBe(dg);
    expect(await n1(a)).toBe(d);
    expect(await n1(c)).toBe(d);
    expect(r.changements.map((x) => `${x.nom}:${x.motif}`).sort()).toEqual([
      'A Test:niveau_au_dessus',
      'C Test:tete_de_son_unite',
    ]);
    expect(await anomalies()).toEqual([]);
  });

  it('un agent créé dans une direction pourvue relève de sa tête, dans un département aussi', async () => {
    await leDG();
    const dsid = await uneTete('DSID', uDSID);
    expect(await n1(await agent('A', uDSID))).toBe(dsid);
    expect(await n1(await agent('B', uEtudes))).toBe(dsid);
  });

  it('à la Direction Générale, le DG reprend qui y est rattaché', async () => {
    const x = await agent('X', uDG);
    const dg = await leDG();
    expect(await n1(x)).toBe(dg);
    expect(await n1(await agent('Y', uDG))).toBe(dg);
  });
});

describe('les retours', () => {
  it('rouvrir un dossier : la chaîne le reprend tout de suite', async () => {
    await leDG();
    const dsid = await uneTete('DSID', uDSID);
    const a = await agent('A', uDSID);
    await people.archive(user, { ids: [a], archived: true, motif: 'demission' });
    const r = await people.archive(user, { ids: [a], archived: false });
    expect(r.done).toBe(1);
    expect(r.aRevoir).toEqual([]);
    expect(await n1(a)).toBe(dsid);
  });

  it('le nombre d’agents d’une tête ne compte jamais le DG', async () => {
    // Une donnée d'avant la règle : le DG rattaché à un agent.
    const dg = await leDG();
    const dsid = await uneTete('DSID', uDSID);
    await raw(`UPDATE employees SET manager_employee_id = $1 WHERE id = $2`, [dsid, dg]);
    const page = await people.list(user, {
      limit: 50,
      offset: 0,
      sort: 'name',
      dir: 'asc',
    } as never);
    expect(page.items.find((i) => i.id === dsid)?.teamSize).toBe(0);
    expect((await people.detail(user, dsid)).team).toEqual([]);
  });
});

describe('le contrôle, avec les définitions de l’écriture', () => {
  it('compte un agent pas encore arrivé dans la direction qu’il rejoint', async () => {
    await leDG();
    await uneTete('DSID', uDSID);
    const futur = await people.create(user, {
      person: { givenName: 'Futur', familyName: 'Test' },
      employee: { employeeNumber: 'FUTUR', hiredOn: '2099-01-01' },
      assignment: { positionTitle: 'Analyste', startDate: '2099-01-01', orgUnitId: uDSID },
    } as CreateEmployeeInput);
    expect(futur.id).toBeTruthy();
    expect(await anomalies()).toEqual([]);
  });

  it('signale un DG affecté hors de la Direction Générale', async () => {
    const dg = await leDG();
    await raw(`UPDATE assignments SET org_unit_id = $1 WHERE employee_id = $2`, [uDSID, dg]);
    expect(await anomalies()).toEqual(['DG:dg_hors_direction_generale']);
  });

  it('signale un agent sans affectation, et cet agent seul', async () => {
    await leDG();
    await uneTete('DSID', uDSID);
    const a = await agent('A', uDSID);
    await agent('B', uDSID);
    await raw(`DELETE FROM assignments WHERE employee_id = $1`, [a]);
    expect(await anomalies()).toEqual(['A:sans_unite']);
  });

  it('survit à une boucle d’unités d’avant la règle', async () => {
    // Deux départements qui se contiennent l'un l'autre : impossible par
    // l'application, possible dans une vieille base. Rien ne doit tourner
    // sans fin.
    const dg = await leDG();
    const x = await unite('Boucle X', 'department', uDSID);
    const y = await unite('Boucle Y', 'department', x);
    await raw(`UPDATE org_units SET parent_id = $1 WHERE id = $2`, [y, x]);
    const a = await agent('A', y);
    expect(await n1(a)).toBe(dg);
    expect(await anomalies()).toEqual([]);
    expect(
      await codeOf(() =>
        people.list(user, { limit: 5, offset: 0, sort: 'name', dir: 'asc' } as never),
      ),
    ).toBe('AUCUNE ERREUR');
    await raw(`UPDATE org_units SET parent_id = $1 WHERE id = $2`, [uDSID, x]);
  });
});

describe('deux gestes simultanés', () => {
  it('A N+1 fonctionnel de B pendant que B le devient de A : un seul passe, pas de boucle', async () => {
    await leDG();
    await uneTete('DSID', uDSID);
    const a = await agent('A', uDSID);
    const b = await agent('B', uDSID);
    const resultats = await Promise.allSettled([
      people.update(user, a, { employee: { n1FonctionnelId: b } }),
      people.update(user, b, { employee: { n1FonctionnelId: a } }),
    ]);
    expect(resultats.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await anomalies()).toEqual([]);
  });
});
