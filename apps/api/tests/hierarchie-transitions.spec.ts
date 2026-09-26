/**
 * Les transitions de la chaîne hiérarchique, de bout en bout.
 *
 * L'organigramme bouge : un DG succède à un autre, une direction reçoit sa
 * tête, un chef d'équipe part ou change de direction, une unité se déplace
 * ou se dissout. À chaque geste, la chaîne doit rester en règle — soit parce
 * que la règle s'applique d'elle-même (les CASCADES, annoncées), soit parce
 * que le geste est refusé avec son motif, soit parce que ce qu'il rend faux
 * est dit AVANT de valider, puis signalé.
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

/** Un agent, affecté, et rattaché s'il le faut — par le service, sous la règle. */
async function agent(matricule: string, uniteId: string, n1?: string): Promise<string> {
  const input = {
    person: { givenName: matricule, familyName: 'Test' },
    employee: {
      employeeNumber: matricule,
      hiredOn: '2024-01-01',
      ...(n1 ? { managerEmployeeId: n1 } : {}),
    },
    assignment: { positionTitle: 'Analyste', startDate: '2024-01-01', orgUnitId: uniteId },
  } as CreateEmployeeInput;
  return (await people.create(user, input)).id;
}

const nommer = (uniteId: string, employeeId: string | null) =>
  organigramme.update(user, uniteId, { managerEmployeeId: employeeId });
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
  await nommer(uDG, id);
  return id;
}

/** Un directeur : affecté dans sa direction, puis nommé — il passe sous le DG. */
async function unDirecteur(matricule: string, direction: string): Promise<string> {
  const id = await agent(matricule, direction);
  await nommer(direction, id);
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
  await raw(`UPDATE org_units SET manager_employee_id = NULL WHERE tenant_id = $1`, [tenantId]);
  await raw(`UPDATE employees SET manager_employee_id = NULL WHERE tenant_id = $1`, [tenantId]);
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

describe('le directeur général', () => {
  it('se nomme parmi les agents de la Direction Générale — pas ailleurs', async () => {
    const ailleurs = await agent('AILLEURS', uDSID);
    expect(await codeOf(() => nommer(uDG, ailleurs))).toBe('org.dg_hors_direction_generale');
  });

  it('ne se retire pas : il se remplace', async () => {
    await leDG();
    expect(await codeOf(() => nommer(uDG, null))).toBe('org.dg_requis');
  });

  it('un nouveau DG reprend tout ce qui relevait de l’ancien, et l’ancien passe sous lui', async () => {
    const ancien = await leDG('ANCIEN');
    const dsid = await unDirecteur('DSID', uDSID);
    const dch = await unDirecteur('DCH', uDCH);
    const assistant = await agent('ASSISTANT', uDG, ancien);
    const adjoint = await agent('ADJOINT', uDG, ancien);

    const r = await nommer(uDG, adjoint);

    expect(await n1(adjoint)).toBeNull();
    for (const id of [dsid, dch, assistant, ancien]) expect(await n1(id)).toBe(adjoint);
    expect(r.changements.map((c) => `${c.nom}:${c.motif}`).sort()).toEqual([
      'ADJOINT Test:devient_dg',
      'ANCIEN Test:ancien_dg',
      'ASSISTANT Test:suit_le_dg',
      'DCH Test:suit_le_dg',
      'DSID Test:suit_le_dg',
    ]);
    expect(r.aRevoir).toEqual([]);
    expect(await anomalies()).toEqual([]);
  });

  it('l’aperçu dit tout ce que ferait la succession — et n’écrit rien', async () => {
    const ancien = await leDG('ANCIEN');
    const dsid = await unDirecteur('DSID', uDSID);
    const adjoint = await agent('ADJOINT', uDG, ancien);

    const apercu = await organigramme.apercu(user, uDG, { managerEmployeeId: adjoint });
    expect(apercu.changements).toHaveLength(3);
    // Rien n'a bougé.
    expect((await hierarchie.controle(user)).directeurGeneral?.employeeId).toBe(ancien);
    expect(await n1(dsid)).toBe(ancien);
    expect(await n1(adjoint)).toBe(ancien);

    // Et la vraie succession fait exactement ce que l'aperçu annonçait.
    const r = await nommer(uDG, adjoint);
    expect(r.changements).toEqual(apercu.changements);
  });

  it('ne quitte pas la Direction Générale tant qu’il en est le DG', async () => {
    const dg = await leDG();
    expect(await codeOf(() => muter(dg, uDSID))).toBe('people.dg_quitte_la_dg');
    // Une mutation DANS la Direction Générale reste possible.
    await muter(dg, uDG);
  });

  it('pas de directeur avant le DG', async () => {
    const chef = await agent('CHEF', uDSID);
    expect(await codeOf(() => nommer(uDSID, chef))).toBe('org.aucun_directeur_general');
  });
});

describe('les directeurs', () => {
  it('un directeur nommé passe sous le DG', async () => {
    const dg = await leDG();
    const chef = await agent('CHEF', uDSID);
    const r = await nommer(uDSID, chef);
    expect(await n1(chef)).toBe(dg);
    expect(r.changements).toEqual([
      expect.objectContaining({ nom: 'CHEF Test', apres: 'DG Test', motif: 'directeur' }),
    ]);
  });

  it('une direction sans tête : ses agents relèvent du DG en attendant — et c’est en règle', async () => {
    const dg = await leDG();
    await agent('A', uDSID, dg);
    await agent('B', uEtudes, dg);
    expect(await anomalies()).toEqual([]);
  });

  it('dès qu’elle a sa tête, ceux qu’attendait le DG passent sous le directeur', async () => {
    const dg = await leDG();
    const a = await agent('A', uDSID, dg);
    const b = await agent('B', uEtudes, dg);
    const chef = await agent('CHEF', uDSID, dg);

    const r = await nommer(uDSID, chef);

    expect(await n1(a)).toBe(chef);
    expect(await n1(b)).toBe(chef);
    expect(await n1(chef)).toBe(dg);
    expect(r.changements.map((c) => `${c.nom}:${c.motif}`).sort()).toEqual([
      'A Test:direction_pourvue',
      'B Test:direction_pourvue',
    ]);
    expect(await anomalies()).toEqual([]);
  });

  it('un nouveau directeur : l’ancien, resté dans la direction, passe sous lui ; son équipe le garde', async () => {
    const dg = await leDG();
    const ancien = await unDirecteur('ANCIEN', uDSID);
    const equipier = await agent('EQUIPIER', uDSID, ancien);
    const nouveau = await agent('NOUVEAU', uDSID, ancien);

    const r = await nommer(uDSID, nouveau);

    expect(await n1(nouveau)).toBe(dg);
    expect(await n1(ancien)).toBe(nouveau);
    expect(await n1(equipier)).toBe(ancien);
    expect(r.changements.map((c) => `${c.nom}:${c.motif}`).sort()).toEqual([
      'ANCIEN Test:ancien_directeur',
      'NOUVEAU Test:directeur',
    ]);
    expect(await anomalies()).toEqual([]);
  });

  it('un directeur retiré sans successeur : la direction retombe sous le DG, en règle', async () => {
    await leDG();
    const chef = await unDirecteur('CHEF', uDSID);
    await agent('A', uDSID, chef);
    await nommer(uDSID, null);
    expect(await anomalies()).toEqual([]);
  });
});

describe('qui part avec une équipe la confie', () => {
  it('muté dans une autre direction : refusé sans repreneur', async () => {
    await leDG();
    const dsid = await unDirecteur('DSID', uDSID);
    const dch = await unDirecteur('DCH', uDCH);
    const chef = await agent('CHEF', uDSID, dsid);
    await agent('A', uDSID, chef);
    expect(await codeOf(() => muter(chef, uDCH, { managerEmployeeId: dch }))).toBe(
      'people.equipe_sans_repreneur',
    );
  });

  it('le repreneur pris dans l’équipe prend la place ; les autres passent sous lui', async () => {
    await leDG();
    const dsid = await unDirecteur('DSID', uDSID);
    const dch = await unDirecteur('DCH', uDCH);
    const chef = await agent('CHEF', uDSID, dsid);
    const a = await agent('A', uDSID, chef);
    const b = await agent('B', uDSID, chef);

    const r = await muter(chef, uDCH, { managerEmployeeId: dch, repreneurEquipeId: a });

    expect(await n1(a)).toBe(dsid);
    expect(await n1(b)).toBe(a);
    expect(await n1(chef)).toBe(dch);
    expect(r.changements.map((c) => `${c.nom}:${c.motif}`).sort()).toEqual([
      'A Test:prend_la_place',
      'B Test:reprise_equipe',
    ]);
    expect(await anomalies()).toEqual([]);
  });

  it('un repreneur d’une autre direction est refusé : rien ne bouge', async () => {
    await leDG();
    const dsid = await unDirecteur('DSID', uDSID);
    const dch = await unDirecteur('DCH', uDCH);
    const chef = await agent('CHEF', uDSID, dsid);
    const a = await agent('A', uDSID, chef);
    expect(
      await codeOf(() => muter(chef, uDCH, { managerEmployeeId: dch, repreneurEquipeId: dch })),
    ).toBe('people.manager_autre_direction');
    expect(await n1(a)).toBe(chef);
  });

  it('muté DANS sa direction, il garde son équipe sans rien demander', async () => {
    await leDG();
    const dsid = await unDirecteur('DSID', uDSID);
    const chef = await agent('CHEF', uDSID, dsid);
    const a = await agent('A', uDSID, chef);
    await muter(chef, uEtudes);
    expect(await n1(a)).toBe(chef);
  });

  it('archivé : sans repreneur il reste, avec repreneur son équipe passe', async () => {
    await leDG();
    const dsid = await unDirecteur('DSID', uDSID);
    const chef = await agent('CHEF', uDSID, dsid);
    const a = await agent('A', uDSID, chef);

    const refus = await people.archive(user, { ids: [chef], archived: true });
    expect(refus.done).toBe(0);
    expect(refus.skipped[0]?.reason).toBe('Encadre un agent — choisissez qui reprend son équipe');

    const fait = await people.archive(user, {
      ids: [chef],
      archived: true,
      repreneurs: { [chef]: dsid },
    });
    expect(fait.done).toBe(1);
    expect(await n1(a)).toBe(dsid);
    expect(fait.changements?.map((c) => c.motif)).toEqual(['reprise_equipe']);
  });

  it('archivé avec toute son équipe dans le même lot : rien à confier', async () => {
    await leDG();
    const dsid = await unDirecteur('DSID', uDSID);
    const chef = await agent('CHEF', uDSID, dsid);
    const a = await agent('A', uDSID, chef);
    const r = await people.archive(user, { ids: [chef, a], archived: true });
    expect(r.done).toBe(2);
  });

  it('effacé : même règle que l’archivage', async () => {
    await leDG();
    const dsid = await unDirecteur('DSID', uDSID);
    const chef = await agent('CHEF', uDSID, dsid);
    const a = await agent('A', uDSID, chef);
    expect((await people.remove(user, { ids: [chef] })).done).toBe(0);
    const r = await people.remove(user, { ids: [chef], repreneurs: { [chef]: dsid } });
    expect(r.done).toBe(1);
    expect(await n1(a)).toBe(dsid);
  });
});

describe('les réorganisations', () => {
  it('un seul sommet : ni création, ni re-rattachement d’un second', async () => {
    expect(
      await codeOf(() =>
        organigramme.create(user, { name: 'Autre sommet', unitType: 'direction' }),
      ),
    ).toBe('org.sommet_unique');
    expect(await codeOf(() => organigramme.update(user, uDSID, { parentId: null }))).toBe(
      'org.sommet_unique',
    );
  });

  it('déplacer une unité est permis ; l’aperçu dit d’abord les rattachements qu’il rend faux', async () => {
    await leDG();
    const dsid = await unDirecteur('DSID', uDSID);
    await unDirecteur('DCH', uDCH);
    await agent('A', uEtudes, dsid);

    const apercu = await organigramme.apercu(user, uEtudes, { parentId: uDCH });
    expect(apercu.aRevoir.map((a) => `${a.matricule}:${a.type}`)).toEqual(['A:hors_direction']);
    expect(await anomalies()).toEqual([]);

    const r = await organigramme.update(user, uEtudes, { parentId: uDCH });
    expect(r.aRevoir).toEqual(apercu.aRevoir);
    expect(await anomalies()).toEqual(['A:hors_direction']);
  });

  it('dissoudre sans unité d’accueil : l’aperçu dit qui se retrouvera sans direction', async () => {
    await leDG();
    const dsid = await unDirecteur('DSID', uDSID);
    await agent('A', uEtudes, dsid);
    const apercu = await organigramme.apercuSuppression(user, uEtudes, {});
    expect(apercu.aRevoir.map((a) => `${a.matricule}:${a.type}`)).toEqual(['A:sans_direction']);
    // Avec une unité d'accueil dans la même direction, rien ne se casse.
    const avecAccueil = await organigramme.apercuSuppression(user, uEtudes, { reassignTo: uDSID });
    expect(avecAccueil.aRevoir).toEqual([]);
  });

  it('un département devenu direction : son responsable devient directeur, sous le DG', async () => {
    const dg = await leDG();
    const dsid = await unDirecteur('DSID', uDSID);
    const chef = await agent('CHEF', uEtudes, dsid);
    await nommer(uEtudes, chef);
    const r = await organigramme.update(user, uEtudes, { unitType: 'direction' });
    expect(await n1(chef)).toBe(dg);
    expect(r.changements.map((c) => c.motif)).toEqual(['directeur']);
  });
});
