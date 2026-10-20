/**
 * Le N+1 d'un agent, lu dans son dossier et dans la liste (ADR-0147).
 *
 * À ne pas confondre avec le responsable d'unité : le premier désigne qui
 * dirige une unité, le second de qui un agent relève. Le N+1 hiérarchique se
 * calcule à partir des têtes d'unité ; le N+1 fonctionnel se choisit, et une
 * boucle (A choisit B pendant que B relève de A) ferait tourner sans fin
 * toute remontée de chaîne : elle se refuse.
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ListEmployeesQuery, SessionUser } from '@teranga/contracts';
import { EncryptionService } from '../src/common/encryption.service';
import { ProblemException } from '../src/common/problem';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import { PeopleService } from '../src/modules/people/people.service';
import { recalculerLaChaine } from '../src/modules/people/recalcul-de-la-chaine';

const env = loadEnv();

const tenantId = randomUUID();
const userId = randomUUID();
const user = { userId, tenantId, role: 'admin' } as SessionUser;

let ownerPool: Pool;
let db: TenantDb;
let people: PeopleService;
let alice: string;
let bruno: string;
let carla: string;

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

async function creerEmploye(numero: string): Promise<string> {
  const personId = randomUUID();
  const employeeId = randomUUID();
  await raw(
    `INSERT INTO persons (id, tenant_id, given_name, family_name) VALUES ($1,$2,$3,'Test')`,
    [personId, tenantId, numero],
  );
  await raw(
    `INSERT INTO employees (id, tenant_id, person_id, employee_number, hired_on)
     VALUES ($1,$2,$3,$4,'2024-01-01')`,
    [employeeId, tenantId, personId, numero],
  );
  return employeeId;
}

const choisirLeFonctionnel = (id: string, n1FonctionnelId: string | null) =>
  people.update(user, id, { employee: { n1FonctionnelId } });

/** La direction des trois dossiers du test, sous une Direction Générale. */
let uDET: string;

/** Les trois dossiers placés dans la même direction, sous la Direction Générale. */
async function affecterDansUneDirection(...ids: string[]) {
  const sommet = randomUUID();
  uDET = randomUUID();
  await raw(
    `INSERT INTO org_units (id, tenant_id, name, unit_type, short_name)
     VALUES ($1,$2,'Direction Générale','direction','DG')`,
    [sommet, tenantId],
  );
  await raw(
    `INSERT INTO org_units (id, tenant_id, parent_id, name, unit_type, short_name)
     VALUES ($1,$2,$3,'Direction des Études','direction','DET')`,
    [uDET, tenantId, sommet],
  );
  for (const id of ids) {
    await raw(
      `INSERT INTO assignments (id, tenant_id, employee_id, org_unit_id, position_title, validity)
       VALUES ($1,$2,$3,$4,'Analyste','[2024-01-01,)')`,
      [randomUUID(), tenantId, id, uDET],
    );
  }
}

/** Une tête posée en SQL, puis la chaîne recalculée. */
async function diriger(uniteId: string, employeeId: string): Promise<void> {
  await raw(`UPDATE org_units SET manager_employee_id = $2 WHERE id = $1`, [uniteId, employeeId]);
  await db.withTenant({ tenantId, userId }, (tx) => recalculerLaChaine(tx, tenantId));
}

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 3 });
  db = new TenantDb();
  people = new PeopleService(db, new EncryptionService());
  await raw(
    `INSERT INTO users (id, email, password_hash, given_name, family_name)
     VALUES ($1,$2,'x','Test','Admin')`,
    [userId, `mgr-${userId}@test.local`],
  );
  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1,'Mgr',$2)`, [
    tenantId,
    `mgr-${tenantId.slice(0, 8)}`,
  ]);
});

beforeEach(async () => {
  await raw(`UPDATE org_units SET manager_employee_id = NULL WHERE tenant_id = $1`, [tenantId]);
  await raw(
    `UPDATE employees SET manager_employee_id = NULL, n1_fonctionnel_employee_id = NULL
      WHERE tenant_id = $1`,
    [tenantId],
  );
  await raw(`DELETE FROM assignments WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM contracts WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM employees WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM persons WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM org_units WHERE tenant_id = $1`, [tenantId]);
  alice = await creerEmploye('ALICE');
  bruno = await creerEmploye('BRUNO');
  carla = await creerEmploye('CARLA');
});

afterAll(async () => {
  await raw(`UPDATE org_units SET manager_employee_id = NULL WHERE tenant_id = $1`, [tenantId]);
  await raw(
    `UPDATE employees SET manager_employee_id = NULL, n1_fonctionnel_employee_id = NULL
      WHERE tenant_id = $1`,
    [tenantId],
  );
  await raw(`DELETE FROM assignments WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM contracts WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM employees WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM persons WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM org_units WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  await raw(`DELETE FROM users WHERE id = $1`, [userId]);
  await db?.pool.end();
  await ownerPool?.end();
});

describe('le N+1 hiérarchique, dans le dossier', () => {
  beforeEach(() => affecterDansUneDirection(alice, bruno, carla));

  it('la tête de la direction est le N+1 de ses agents', async () => {
    await diriger(uDET, alice);
    const detail = await people.detail(user, bruno);
    expect(detail.managerId).toBe(alice);
    expect(detail.managerName).toBe('ALICE Test');
    // Le matricule, que les listes de choix écrivent après le nom.
    expect(detail.managerNumber).toBe('ALICE');
  });

  it('sans tête ni DG au-dessus, pas de N+1 : le contrôle le signale, rien ne se refuse', async () => {
    const detail = await people.detail(user, bruno);
    expect(detail.managerId).toBeNull();
    expect(detail.managerNumber).toBeNull();
  });

  it('un N+1 saisi est ignoré : l’organigramme le donne', async () => {
    await diriger(uDET, alice);
    expect(
      await codeOf(() =>
        people.update(user, bruno, { employee: { managerEmployeeId: carla } as never }),
      ),
    ).toBe('AUCUNE ERREUR');
    expect((await people.detail(user, bruno)).managerId).toBe(alice);
  });
});

describe('le N+1 fonctionnel, contre les boucles', () => {
  beforeEach(async () => {
    await affecterDansUneDirection(alice, bruno, carla);
    await diriger(uDET, alice);
  });

  it('refuse soi-même, un dossier archivé, un agent inexistant', async () => {
    expect(await codeOf(() => choisirLeFonctionnel(bruno, bruno))).toBe('people.n1_soi_meme');
    await raw(`UPDATE employees SET status = 'archived' WHERE id = $1`, [carla]);
    expect(await codeOf(() => choisirLeFonctionnel(bruno, carla))).toBe('people.agent_inactif');
    expect(await codeOf(() => choisirLeFonctionnel(bruno, randomUUID()))).toBe(
      'people.n1_introuvable',
    );
  });

  it('refuse une boucle directe : A choisit B, qui relève de A', async () => {
    expect(await codeOf(() => choisirLeFonctionnel(alice, bruno))).toBe('people.n1_boucle');
  });

  it('refuse une boucle indirecte A → B → C → A', async () => {
    await choisirLeFonctionnel(bruno, carla);
    expect(await codeOf(() => choisirLeFonctionnel(alice, bruno))).toBe('people.n1_boucle');
  });

  it('accepte une chaîne profonde', async () => {
    await choisirLeFonctionnel(carla, bruno);
    expect((await people.detail(user, carla)).n1Fonctionnel?.id).toBe(bruno);
    expect((await people.detail(user, carla)).managerId).toBe(alice);
  });
});

describe('liste des employés', () => {
  beforeEach(() => affecterDansUneDirection(alice, bruno, carla));

  it('remonte le MATRICULE du manager, et son nom pour l’infobulle', async () => {
    // C'est le matricule que la colonne affiche : il est unique, là où deux
    // agents peuvent porter le même nom. Le nom reste disponible pour
    // l'infobulle.
    await diriger(uDET, alice);
    const page = await people.list(user, { limit: 25, sort: 'recent', dir: 'desc', offset: 0 });
    const ligne = page.items.find((i) => i.employeeNumber === 'BRUNO')!;
    expect(ligne.managerNumber).toBe('ALICE');
    expect(ligne.managerName).toBe('ALICE Test');
    expect(ligne.managerId).toBe(alice);
  });

  it('nomme ET numérote les managers dans la liste de filtre', async () => {
    // Deux homonymes y étaient indiscernables : c'est le défaut même qu'on
    // corrige en affichant le matricule.
    await diriger(uDET, alice);
    const page = await people.list(user, { limit: 25, sort: 'recent', dir: 'desc', offset: 0 });
    expect(page.facets.managers).toEqual([{ id: alice, name: 'ALICE Test (ALICE)' }]);
  });

  it('laisse le manager vide quand il n’y en a pas', async () => {
    const page = await people.list(user, { limit: 25, sort: 'recent', dir: 'desc', offset: 0 });
    const ligne = page.items.find((i) => i.employeeNumber === 'ALICE')!;
    expect(ligne.managerName).toBeNull();
    expect(ligne.managerNumber).toBeNull();
  });
});

describe('tri, filtres et effectifs', () => {
  const lister = (q: Partial<ListEmployeesQuery> = {}) =>
    people.list(user, { limit: 25, sort: 'recent', dir: 'desc', offset: 0, ...q });

  /** Affecte l'agent à une unité, avec un intitulé de poste. */
  async function affecter(employeeId: string, poste: string, uniteId: string | null) {
    await raw(
      `INSERT INTO assignments (id, tenant_id, employee_id, org_unit_id, position_title, validity)
       VALUES ($1,$2,$3,$4,$5,'[2024-01-01,)')`,
      [randomUUID(), tenantId, employeeId, uniteId, poste],
    );
  }

  it('trie par nom, dans les deux sens', async () => {
    const asc = await lister({ sort: 'name', dir: 'asc' });
    expect(asc.items.map((i) => i.employeeNumber)).toEqual(['ALICE', 'BRUNO', 'CARLA']);
    const desc = await lister({ sort: 'name', dir: 'desc' });
    expect(desc.items.map((i) => i.employeeNumber)).toEqual(['CARLA', 'BRUNO', 'ALICE']);
  });

  it('trie par date de contrat, et renvoie les dossiers sans date en dernier', async () => {
    await raw(
      `INSERT INTO contracts (id, tenant_id, employee_id, contract_type, start_date, end_date)
       VALUES ($1,$2,$3,'cdd','2025-06-01','2026-06-01')`,
      [randomUUID(), tenantId, bruno],
    );
    await raw(
      `INSERT INTO contracts (id, tenant_id, employee_id, contract_type, start_date, end_date)
       VALUES ($1,$2,$3,'cdi','2024-02-01',NULL)`,
      [randomUUID(), tenantId, alice],
    );

    const asc = await lister({ sort: 'contractStart', dir: 'asc' });
    expect(asc.items.map((i) => i.employeeNumber)).toEqual(['ALICE', 'BRUNO', 'CARLA']);

    // Une fin de contrat absente n'est pas « la plus ancienne » : elle n'existe
    // pas, et sa place est en bas quel que soit le sens du tri.
    for (const dir of ['asc', 'desc'] as const) {
      const page = await lister({ sort: 'contractEnd', dir });
      expect(page.items.at(-1)!.employeeNumber).not.toBe('BRUNO');
      expect(page.items.at(-1)!.contractEndDate).toBeNull();
    }
  });

  it('filtre par poste, par manager et par unité', async () => {
    const uniteId = randomUUID();
    await raw(
      `INSERT INTO org_units (id, tenant_id, name, unit_type, short_name)
       VALUES ($1,$2,'Direction Financière','direction','DFC')`,
      [uniteId, tenantId],
    );
    await affecter(alice, 'Comptable', uniteId);
    await affecter(bruno, 'Comptable', null);
    await affecter(carla, 'Analyste', uniteId);
    // Bruno n'a pas d'unité : aucun N+1. Carla relève de la
    // tête de sa direction.
    await diriger(uniteId, alice);

    expect((await lister({ positionTitle: 'Comptable' })).items).toHaveLength(2);
    expect((await lister({ managerId: alice })).items.map((i) => i.employeeNumber)).toEqual([
      'CARLA',
    ]);
    // L'unité se filtre sur ce que la colonne AFFICHE — l'abrégé de la direction.
    expect((await lister({ unit: ['DFC'] })).items.map((i) => i.employeeNumber).sort()).toEqual([
      'ALICE',
      'CARLA',
    ]);
  });

  it('filtre sur plusieurs unités à la fois', async () => {
    const dfc = randomUUID();
    const dch = randomUUID();
    // Un seul sommet par organigramme : la seconde direction se rattache à la première.
    await raw(
      `INSERT INTO org_units (id, tenant_id, name, unit_type, short_name)
       VALUES ($1,$2,'Direction Financière','direction','DFC')`,
      [dfc, tenantId],
    );
    await raw(
      `INSERT INTO org_units (id, tenant_id, name, unit_type, short_name, parent_id)
       VALUES ($1,$2,'Direction du Capital Humain','direction','DCH',$3)`,
      [dch, tenantId, dfc],
    );
    await affecter(alice, 'Comptable', dfc);
    await affecter(bruno, 'Chargé de paie', dch);
    await affecter(carla, 'Analyste', null);

    const numeros = async (unit: string[]) =>
      (await lister({ unit })).items.map((i) => i.employeeNumber).sort();
    expect(await numeros(['DFC'])).toEqual(['ALICE']);
    expect(await numeros(['DFC', 'DCH'])).toEqual(['ALICE', 'BRUNO']);
    // Le total suit le filtre : c'est lui qui donne le nombre de pages.
    expect((await lister({ unit: ['DFC', 'DCH'] })).total).toBe(2);
  });

  it('propose en filtre exactement ce que l’onglet contient', async () => {
    const uniteId = randomUUID();
    await raw(
      `INSERT INTO org_units (id, tenant_id, name, unit_type, short_name)
       VALUES ($1,$2,'Direction Générale','direction','DG')`,
      [uniteId, tenantId],
    );
    await affecter(alice, 'Comptable', uniteId);
    await affecter(carla, 'Analyste', null);
    await raw(`UPDATE employees SET status = 'archived' WHERE id = $1`, [carla]);

    const actifs = await lister({ status: 'active' });
    expect(actifs.facets.positions).toEqual(['Comptable']);
    expect(actifs.facets.units).toEqual(['DG']);

    const archives = await lister({ status: 'archived' });
    expect(archives.facets.positions).toEqual(['Analyste']);
  });

  it('compte les deux onglets, quel que soit celui qu’on regarde', async () => {
    await raw(`UPDATE employees SET status = 'archived' WHERE id = $1`, [carla]);
    for (const status of [undefined, 'active', 'archived'] as const) {
      const page = await lister({ status });
      expect(page.counts).toEqual({ active: 2, archived: 1 });
    }
  });

  it('compte ce que la RECHERCHE trouve — c’est ce qui dit dans quel onglet chercher', async () => {
    await raw(`UPDATE employees SET status = 'archived' WHERE id = $1`, [carla]);
    const page = await lister({ q: 'CARLA', status: 'active' });
    expect(page.items).toHaveLength(0);
    expect(page.counts).toEqual({ active: 0, archived: 1 });
  });

  it('trouve « Prénom Nom » dans les deux ordres, sans tenir compte des accents', async () => {
    await raw(
      `UPDATE persons SET given_name = 'Mariama', family_name = 'Cissé'
                WHERE id = (SELECT person_id FROM employees WHERE id = $1)`,
      [carla],
    );
    for (const q of ['Mariama Cissé', 'cisse mariama', 'MARIAMA CISSE', 'cis', 'carl']) {
      const page = await lister({ q });
      expect(
        page.items.map((i) => i.employeeNumber),
        q,
      ).toEqual(['CARLA']);
    }
    expect((await lister({ q: 'Mariama Diop' })).items).toHaveLength(0);
    // Un joker tapé se cherche tel quel.
    expect((await lister({ q: '%' })).items).toHaveLength(0);
  });

  it('pagine par décalage', async () => {
    const p1 = await lister({ sort: 'name', dir: 'asc', limit: 2, offset: 0 });
    expect(p1.items.map((i) => i.employeeNumber)).toEqual(['ALICE', 'BRUNO']);
    expect(p1.nextOffset).toBe(2);
    const p2 = await lister({ sort: 'name', dir: 'asc', limit: 2, offset: 2 });
    expect(p2.items.map((i) => i.employeeNumber)).toEqual(['CARLA']);
    expect(p2.nextOffset).toBeNull();
    // Le total ne bouge pas d'une page à l'autre : c'est le nombre de pages.
    expect([p1.total, p2.total]).toEqual([3, 3]);
  });

  it('donne un TOTAL qui tient compte de l’onglet et des filtres', async () => {
    // `counts` répond à « combien de l'autre côté ? » et ignore donc l'onglet
    // comme les filtres. `total` répond à « combien de pages ? » et doit
    // suivre la requête exactement — sinon la liste propose des pages vides.
    await affecter(alice, 'Comptable', null);
    await affecter(bruno, 'Comptable', null);
    await affecter(carla, 'Analyste', null);
    await raw(`UPDATE employees SET status = 'archived' WHERE id = $1`, [carla]);

    const actifs = await lister({ status: 'active' });
    expect(actifs.total).toBe(2);
    expect(actifs.counts).toEqual({ active: 2, archived: 1 });

    const comptables = await lister({ status: 'active', positionTitle: 'Comptable' });
    expect(comptables.total).toBe(2);

    const analystes = await lister({ status: 'active', positionTitle: 'Analyste' });
    expect(analystes.total).toBe(0);
    // Les effectifs, eux, n'ont pas bougé : ils ignorent le filtre.
    expect(analystes.counts).toEqual({ active: 2, archived: 1 });

    const cherche = await lister({ q: 'CARLA', status: 'archived' });
    expect(cherche.total).toBe(1);

    // Une page au-delà de la fin rend zéro ligne, mais toujours le bon total :
    // c'est ce qui permet à la liste de renvoyer vers la dernière page.
    const trop = await lister({ status: 'active', offset: 50 });
    expect(trop.items).toHaveLength(0);
    expect(trop.total).toBe(2);
  });
});

describe('le matricule', () => {
  const matricule = async (id: string) =>
    (await raw(`SELECT employee_number FROM employees WHERE id = $1`, [id])).rows[0]
      ?.employee_number as string;

  it('s’écrit en capitales, quelle que soit la frappe', async () => {
    await people.update(user, bruno, { employee: { employeeNumber: ' apix-0009 ' } });
    expect(await matricule(bruno)).toBe('APIX-0009');
  });

  it('ne se prend pas deux fois, même en changeant la casse', async () => {
    expect(
      await codeOf(() => people.update(user, bruno, { employee: { employeeNumber: 'alice' } })),
    ).toBe('people.employee_number_taken');
    // Même une écriture faite hors de l'API bute sur la base.
    await expect(creerEmploye('alice')).rejects.toThrow(/employees_matricule_sans_casse/);
  });
});
