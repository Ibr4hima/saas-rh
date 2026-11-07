/**
 * L'import du fichier du personnel de la DCH, jusqu'à la base (ADR-0159).
 *
 * `import-employes.spec.ts` éprouve la lecture : ce que la plateforme
 * comprend du fichier. Ici, ce qu'elle en fait : les fiches créées et mises
 * à jour, les unités et les responsables que les postes désignent, les N+1
 * retrouvés par leur nom, et l'aperçu qui joue tout puis annule.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RapportImportEmployes, SessionUser } from '@teranga/contracts';
import { EncryptionService } from '../src/common/encryption.service';
import { ProblemException } from '../src/common/problem';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import { ImportEmployesService } from '../src/modules/people/import.service';
import { PeopleService } from '../src/modules/people/people.service';
import { classeur } from './fabrique-xlsx';

const env = loadEnv();

const tenantId = randomUUID();
const adminUserId = randomUUID();
const admin = { userId: adminUserId, tenantId, role: 'admin' } as SessionUser;

let ownerPool: Pool;
let db: TenantDb;
let crypto: EncryptionService;
let imports: ImportEmployesService;
const unites: Record<'dg' | 'dfc' | 'dch' | 'dsid', string> = {
  dg: '',
  dfc: '',
  dch: '',
  dsid: '',
};

async function raw(q: string, params: unknown[] = []) {
  return ownerPool.query(q, params as never[]);
}

/* ─── Le fichier, écrit comme la DCH l'écrit ─── */

const COLONNES = [
  'Matricule',
  'Prénom',
  'Nom',
  'Sexe',
  'Date de naissance',
  'Numero CNI',
  'Situation Matrimoniale',
  'Region ',
  'Adresse mail professionnel ',
  'Poste occupé ',
  'Responsable Hierarchique\n(N+1)',
  'Responsable Fonctionnel',
  'Statut',
  'Direction',
  'Département ',
  'Type de contrat',
  "Date d'entrée",
  'Date de fin (si CDD)',
  'Ancienneté (années)',
  'Prime de transport',
] as const;

type Ligne = Partial<Record<(typeof COLONNES)[number], string | number>>;

const xml = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const COL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Un classeur : le texte en chaînes, les nombres en nombres, comme Excel les garde. */
function fichier(lignes: Ligne[], entetes: readonly string[] = COLONNES): Buffer {
  const rang = (valeurs: (string | number | undefined)[], r: number) =>
    `<row r="${r}">` +
    valeurs
      .map((v, i) =>
        v === undefined
          ? ''
          : typeof v === 'number'
            ? `<c r="${COL[i]}${r}" t="n"><v>${v}</v></c>`
            : `<c r="${COL[i]}${r}" t="inlineStr"><is><t>${xml(v)}</t></is></c>`,
      )
      .join('') +
    `</row>`;
  const corps = lignes.map((l, i) =>
    rang(
      entetes.map((e) => l[e as keyof Ligne]),
      i + 2,
    ),
  );
  return classeur(`<sheetData>${rang([...entetes], 1)}${corps.join('')}</sheetData>`);
}

const AGENT = (n: number, plus: Ligne = {}): Ligne => ({
  Matricule: String(100 + n),
  Prénom: `AGENT${n}`,
  Nom: 'DIOP',
  Sexe: 'F',
  'Date de naissance': `0${(n % 9) + 1}/03/1990`,
  'Poste occupé ': "CHARGE D'ETUDES",
  Statut: 'Non cadre',
  Direction: 'DCH',
  'Type de contrat': 'CDI',
  "Date d'entrée": '01/03/2024',
  ...plus,
});

const DG: Ligne = {
  Matricule: '001',
  Prénom: 'CHEIKH',
  Nom: 'MBAYE',
  Sexe: 'M',
  'Date de naissance': '12/01/1970',
  'Poste occupé ': 'DIRECTEUR GENERAL',
  Statut: 'Cadre',
  Direction: 'DG',
  'Type de contrat': 'CDI',
  "Date d'entrée": '01/01/2015',
};

const importer = (
  lignes: Ligne[],
  appliquer = true,
  choix: Record<string, string> = {},
  noms: Record<string, string> = {},
  rattachements: Record<string, string> = {},
  reglages: {
    placements?: Record<string, number[]>;
    responsables?: Record<string, string>;
  } = {},
) => imports.importer(admin, fichier(lignes), appliquer, choix, noms, rattachements, reglages);

const ligne = (r: RapportImportEmployes, n: number) => r.lignes.find((l) => l.ligne === n)!;

/** La fiche telle que la base la porte. */
async function fiche(matricule: string) {
  const r = await raw(
    `SELECT e.id, e.employee_number, e.matricule_provisoire, e.hired_on::text AS hired_on,
            e.entree_au_mois, e.personnel, e.work_email,
            p.given_name, p.family_name, p.gender, p.region, p.national_id_encrypted,
            a.position_title, a.org_unit_id, lower(a.validity)::text AS affecte_le,
            c.contract_type, c.start_date::text AS contrat_le, c.end_date::text AS fin,
            (SELECT rp.given_name || ' ' || rp.family_name FROM employees re
               JOIN persons rp ON rp.id = re.person_id WHERE re.id = e.manager_employee_id) AS n1,
            (SELECT rp.given_name || ' ' || rp.family_name FROM employees re
               JOIN persons rp ON rp.id = re.person_id
              WHERE re.id = e.responsable_fonctionnel_id) AS fonctionnel
       FROM employees e
       JOIN persons p ON p.id = e.person_id
       LEFT JOIN assignments a ON a.employee_id = e.id AND a.validity @> CURRENT_DATE
       LEFT JOIN contracts c ON c.employee_id = e.id
      WHERE e.tenant_id = $1 AND e.employee_number = $2`,
    [tenantId, matricule],
  );
  return r.rows[0] as Record<string, unknown> | undefined;
}

const compte = async (table: string): Promise<number> => {
  const r = await raw(`SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  return (r.rows[0] as { n: number }).n;
};

async function chefDe(uniteId: string) {
  const r = await raw(
    `SELECT p.given_name || ' ' || p.family_name AS nom FROM org_units o
       JOIN employees e ON e.id = o.manager_employee_id JOIN persons p ON p.id = e.person_id
      WHERE o.id = $1`,
    [uniteId],
  );
  return (r.rows[0] as { nom: string } | undefined)?.nom ?? null;
}

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 3 });
  db = new TenantDb();
  crypto = new EncryptionService();
  imports = new ImportEmployesService(db, new PeopleService(db, crypto), crypto);
  await raw(
    `INSERT INTO users (id, email, password_hash, given_name, family_name)
     VALUES ($1,$2,'x','Test','Import')`,
    [adminUserId, `import-${adminUserId}@test.local`],
  );
  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1,'Import',$2)`, [
    tenantId,
    `import-${tenantId.slice(0, 8)}`,
  ]);
  await raw(
    `INSERT INTO user_tenant_memberships (id, tenant_id, user_id, role) VALUES ($1,$2,$3,'admin')`,
    [randomUUID(), tenantId, adminUserId],
  );
});

async function vider() {
  await raw(
    `UPDATE org_units SET manager_employee_id = NULL, adjoint_employee_id = NULL
              WHERE tenant_id = $1`,
    [tenantId],
  );
  await raw(
    `UPDATE employees SET manager_employee_id = NULL, responsable_fonctionnel_id = NULL
              WHERE tenant_id = $1`,
    [tenantId],
  );
  for (const table of [
    'assignments',
    'contracts',
    'remunerations',
    'invitations',
    'notifications',
    'employees',
    'persons',
    'org_units',
  ]) {
    await raw(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  }
  await raw(`DELETE FROM audit_log WHERE tenant_id = $1`, [tenantId]);
}

beforeEach(async () => {
  await vider();
  unites.dg = randomUUID();
  unites.dfc = randomUUID();
  unites.dch = randomUUID();
  unites.dsid = randomUUID();
  await raw(
    `INSERT INTO org_units (id, tenant_id, unit_type, name, short_name, parent_id, created_at)
     VALUES ($1,$5,'direction','Direction Générale','DG',NULL, now() - interval '1 day'),
            ($2,$5,'direction','Direction Financière et Comptable','DFC',$1, now()),
            ($3,$5,'direction','Direction du Capital Humain','DCH',$1, now()),
            ($4,$5,'direction','Direction des Systèmes d''information et de la Digitalisation','DSID',$1, now())`,
    [unites.dg, unites.dfc, unites.dch, unites.dsid, tenantId],
  );
});

afterAll(async () => {
  await vider();
  await raw(`DELETE FROM user_tenant_memberships WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  await raw(`DELETE FROM users WHERE id = $1`, [adminUserId]);
  await db?.pool.end();
  await ownerPool.end();
});

describe('l’aperçu', () => {
  it('joue l’import puis l’annule : rien n’est écrit', async () => {
    const r = await importer([DG, AGENT(1), AGENT(2)], false);
    expect(r.applique).toBe(false);
    expect(r.aCreer).toBe(3);
    expect(r.designations).toEqual([{ poste: 'Directeur général', nom: 'Cheikh Mbaye' }]);
    expect(await compte('employees')).toBe(0);
    expect(await compte('persons')).toBe(0);
    expect(await chefDe(unites.dg)).toBeNull();
  });

  it('dit dès l’aperçu ce que l’écriture refusera', async () => {
    // Sans DG, une direction ne reçoit pas de directeur : l'organigramme le refuse.
    const directeur = AGENT(1, {
      'Poste occupé ': 'DIRECTEUR FINANCIER ET COMPTABLE',
      Direction: 'DFC',
    });
    const r = await importer([directeur], false);
    expect(ligne(r, 2).avertissements).toContainEqual({
      colonne: 'Poste occupé',
      texte:
        'Désignation impossible : Les responsables de direction ont le DG pour N+1 : le DG doit être désigné en premier.',
    });
    expect(r.designations).toEqual([]);
  });

  it('trouve les intitulés sous un titre, et cite les vraies lignes du tableur', async () => {
    const titre = `<row r="1"><c r="A1" t="inlineStr"><is><t>PERSONNEL APIX 2026</t></is></c></row>`;
    const entetes = ['Matricule', 'Prénom', 'Nom', 'Date d’entrée'];
    const cellule = (v: string, c: number, r: number) =>
      `<c r="${'ABCD'[c]}${r}" t="inlineStr"><is><t>${v}</t></is></c>`;
    const rang = (vs: string[], r: number) =>
      `<row r="${r}">${vs.map((v, i) => cellule(v, i, r)).join('')}</row>`;
    const r = await imports.importer(
      admin,
      classeur(
        `<sheetData>${titre}${rang(entetes, 3)}${rang(['301', 'AWA', 'DIOP', '01/03/2024'], 4)}` +
          `${rang(['302', '', 'FALL', '01/03/2024'], 6)}</sheetData>`,
      ),
      false,
    );
    expect(r.colonnesManquantes).toEqual([]);
    expect(r.lignes.map((l) => [l.ligne, l.etat])).toEqual([
      [4, 'a-creer'],
      [6, 'erreur'],
    ]);
  });

  it('s’arrête sur une colonne indispensable absente', async () => {
    const r = await imports.importer(
      admin,
      fichier([{ Prénom: 'AWA', Nom: 'DIOP' }], ['Prénom', 'Nom']),
      false,
    );
    expect(r.colonnesManquantes).toEqual(['Matricule', 'Date d’entrée']);
    expect(r.lignes).toEqual([]);
  });
});

describe('la création', () => {
  it('crée la fiche complète : personne, emploi, contrat, affectation', async () => {
    const r = await importer([
      AGENT(1, {
        'Numero CNI': '2 751 1990 01234',
        'Situation Matrimoniale': 'Célib',
        'Region ': 'St Louis',
        'Adresse mail professionnel ': 'A.Diop@apix.com',
      }),
    ]);
    expect(r.applique).toBe(true);
    expect(r.aCreer).toBe(1);
    expect(ligne(r, 2).corrections).toEqual(
      expect.arrayContaining([
        { colonne: 'Region', lu: 'St Louis', retenu: 'Saint-Louis' },
        { colonne: 'Adresse mail professionnel', lu: 'A.Diop@apix.com', retenu: 'a.diop@apix.sn' },
      ]),
    );
    const f = await fiche('101');
    expect(f).toMatchObject({
      given_name: 'Agent1',
      family_name: 'Diop',
      gender: 'female',
      region: 'saint_louis',
      personnel: 'non_cadre',
      work_email: 'a.diop@apix.sn',
      hired_on: '2024-03-01',
      entree_au_mois: false,
      // Agent1 est une femme : le poste s'accorde.
      position_title: "Chargée d'études",
      org_unit_id: unites.dch,
      contract_type: 'cdi',
      contrat_le: '2024-03-01',
    });
    expect(f?.national_id_encrypted).toBeTruthy();
  });

  it('déduit de l’ancienneté le mois d’entrée, et le marque', async () => {
    await importer([AGENT(1, { "Date d'entrée": 'à voir', 'Ancienneté (années)': 2 })]);
    const f = await fiche('101');
    expect(f?.entree_au_mois).toBe(true);
    expect(String(f?.hired_on)).toMatch(/-01$/);
  });

  it('lit une date d’entrée gardée en nombre par Excel', async () => {
    const r = await importer([AGENT(1, { "Date d'entrée": 44452 })]);
    expect((await fiche('101'))?.hired_on).toBe('2021-09-13');
    expect(ligne(r, 2).corrections).toContainEqual({
      colonne: "Date d'entrée",
      lu: '44452',
      retenu: '13/09/2021',
    });
  });

  it('donne 50A et 50B à un matricule en double, provisoires', async () => {
    const r = await importer([AGENT(1, { Matricule: '50' }), AGENT(2, { Matricule: '50' })]);
    expect(r.aCreer).toBe(2);
    expect(ligne(r, 2).matricule).toBe('50A');
    expect(ligne(r, 3)).toMatchObject({ matricule: '50B', matriculeProvisoire: true });
    expect((await fiche('50A'))?.matricule_provisoire).toBe(true);
    expect((await fiche('50B'))?.given_name).toBe('Agent2');
  });

  it('donne le A à la personne entrée la première, même par son ancienneté', async () => {
    const r = await importer([
      AGENT(1, { Matricule: '50' }),
      AGENT(2, { Matricule: '50', "Date d'entrée": '15/06/2010' }),
      AGENT(3, { Matricule: '50', "Date d'entrée": undefined, 'Ancienneté (années)': 30 }),
    ]);
    expect(ligne(r, 4).matricule).toBe('50A');
    expect(ligne(r, 3).matricule).toBe('50B');
    expect(ligne(r, 2).matricule).toBe('50C');
    expect((await fiche('50A'))?.given_name).toBe('Agent3');
  });

  it('saute la lettre qui donnerait le matricule d’une autre personne', async () => {
    const r = await importer([
      AGENT(1, { Matricule: '50A' }),
      AGENT(2, { Matricule: '50' }),
      AGENT(3, { Matricule: '50' }),
    ]);
    expect(ligne(r, 2)).toMatchObject({ matricule: '50A', matriculeProvisoire: false });
    expect(ligne(r, 3).matricule).toBe('50B');
    expect(ligne(r, 4).matricule).toBe('50C');
  });

  it('n’arrête pas les autres lignes sur une ligne fautive, et la nomme', async () => {
    const r = await importer([AGENT(1, { Prénom: undefined }), AGENT(2)]);
    expect(r.erreurs).toBe(1);
    expect(r.aCreer).toBe(1);
    expect(ligne(r, 2)).toMatchObject({
      etat: 'erreur',
      motif: 'Le prénom manque',
      colonne: 'Prénom',
    });
    expect(await compte('employees')).toBe(1);
  });

  it('refuse un fichier qui n’est pas un classeur, sans rien écrire', async () => {
    await expect(
      imports.importer(admin, Buffer.from('nom;prenom\nDiop;Awa'), true),
    ).rejects.toBeInstanceOf(ProblemException);
    expect(await compte('employees')).toBe(0);
  });
});

describe('le poste place l’agent', () => {
  it('désigne le DG et le directeur, crée le département du chef et l’y met à sa tête', async () => {
    const chef = AGENT(2, {
      Prénom: 'FATOU',
      Nom: 'SALL',
      'Poste occupé ': 'CHEF DE DEPARTEMENT DIGITALISATION',
      Statut: 'Cadre',
      Direction: 'DSID',
    });
    const directeur = AGENT(3, {
      Prénom: 'OUSMANE',
      Nom: 'FALL',
      Sexe: 'M',
      'Poste occupé ': "DIRECTEUR DES SYSTEMES D'INFORMATION",
      Statut: 'Cadre',
      Direction: 'DSID',
    });
    const agent = AGENT(4, {
      Direction: 'DSID',
      'Département ': 'Digitalisation',
      'Responsable Hierarchique\n(N+1)': 'SALL Fatou',
    });
    // Le chef d'abord, le DG en dernier : l'ordre du fichier ne compte pas.
    const r = await importer([chef, agent, directeur, DG]);
    expect(r.erreurs).toBe(0);
    expect(r.unitesCreees).toEqual([
      {
        cle: expect.any(String),
        nom: 'Département Digitalisation',
        propose: 'Département Digitalisation',
        parent: 'DSID',
      },
    ]);
    expect(r.designations.map((d) => d.poste)).toEqual([
      'Directeur général',
      'Directeur de la DSID',
      'Cheffe du département Digitalisation',
    ]);
    expect(await chefDe(unites.dg)).toBe('Cheikh Mbaye');
    expect(await chefDe(unites.dsid)).toBe('Ousmane Fall');
    const dep = await raw(
      `SELECT id, unit_type, parent_id FROM org_units WHERE tenant_id = $1 AND name = 'Département Digitalisation'`,
      [tenantId],
    );
    expect(dep.rows[0]).toMatchObject({ unit_type: 'department', parent_id: unites.dsid });
    expect(await chefDe((dep.rows[0] as { id: string }).id)).toBe('Fatou Sall');
    expect(await fiche('104')).toMatchObject({
      org_unit_id: (dep.rows[0] as { id: string }).id,
      n1: 'Fatou Sall',
    });
    // Le directeur relève du DG, la cheffe de son directeur.
    expect((await fiche('103'))?.n1).toBe('Cheikh Mbaye');
    expect((await fiche('102'))?.n1).toBe('Ousmane Fall');
    expect(ligne(r, 3).responsable).toBe('Fatou Sall');
  });

  it('crée l’unité sous le nom corrigé à l’aperçu, et le poste du responsable suit ce nom', async () => {
    const cheffe = AGENT(2, {
      Prénom: 'FATOU',
      Nom: 'SALL',
      'Poste occupé ': 'CHEF DU DEPARTEMENT RECOUVREMEN',
      Statut: 'Cadre',
      Direction: 'DFC',
    });
    const apercu = await importer([cheffe], false);
    const unite = apercu.unitesCreees[0]!;
    expect(unite).toMatchObject({
      nom: 'Département Recouvremen',
      propose: 'Département Recouvremen',
      parent: 'DFC',
    });
    const noms = { [unite.cle]: 'Département Recouvrement' };
    // L'aperçu rejoué garde la clé, prend le nom, et le poste de la cheffe suit.
    const revu = await importer([cheffe], false, {}, noms);
    expect(revu.unitesCreees).toMatchObject([
      { cle: unite.cle, nom: 'Département Recouvrement', propose: 'Département Recouvremen' },
    ]);
    expect(revu.designations).toEqual([
      { poste: 'Cheffe du département Recouvrement', nom: 'Fatou Sall' },
    ]);
    const r = await importer([cheffe], true, {}, noms);
    expect(r.erreurs).toBe(0);
    const deps = await raw(
      `SELECT name FROM org_units WHERE tenant_id = $1 AND unit_type = 'department'`,
      [tenantId],
    );
    expect(deps.rows).toEqual([{ name: 'Département Recouvrement' }]);
    expect((await fiche('102'))?.position_title).toBe('Cheffe du département Recouvrement');
  });

  it('dit pourquoi une unité renommée comme sa voisine n’est pas créée', async () => {
    await raw(
      `INSERT INTO org_units (id, tenant_id, unit_type, name, parent_id)
       VALUES ($1,$2,'department','Département Trésorerie',$3)`,
      [randomUUID(), tenantId, unites.dfc],
    );
    const cheffe = AGENT(2, {
      'Poste occupé ': 'CHEF DU DEPARTEMENT RECOUVREMENT',
      Statut: 'Cadre',
      Direction: 'DFC',
    });
    const cle = (await importer([cheffe], false)).unitesCreees[0]!.cle;
    const r = await importer([cheffe], false, {}, { [cle]: 'Département Trésorerie' });
    expect(r.unitesCreees).toEqual([
      {
        cle,
        nom: 'Département Trésorerie',
        propose: 'Département Recouvrement',
        parent: 'DFC',
        echec: 'une unité porte déjà ce nom à ce niveau',
      },
    ]);
    expect(ligne(r, 2).avertissements).toContainEqual({
      colonne: 'Poste occupé',
      texte:
        'Création de « Département Trésorerie » impossible (une unité porte déjà ce nom à ce niveau) : agent affecté à DFC',
    });
  });

  it('ne remplace pas un responsable déjà en place', async () => {
    await importer([DG]);
    const r = await importer([
      AGENT(1, {
        Prénom: 'MODOU',
        Nom: 'GUEYE',
        Sexe: 'M',
        'Poste occupé ': 'DIRECTEUR GENERAL',
        Direction: 'DG',
      }),
    ]);
    expect(ligne(r, 2).avertissements).toContainEqual({
      colonne: 'Poste occupé',
      texte: 'Cheikh Mbaye dirige déjà DG : désignation non faite',
    });
    expect(await chefDe(unites.dg)).toBe('Cheikh Mbaye');
  });
});

/* ─── Les services se rangent sous un département (ADR-0178) ─── */

const DIRECTEUR_DSID = AGENT(3, {
  Prénom: 'OUSMANE',
  Nom: 'FALL',
  Sexe: 'M',
  'Poste occupé ': "DIRECTEUR DES SYSTEMES D'INFORMATION",
  Statut: 'Cadre',
  Direction: 'DSID',
});
const cheffeDeDepartement = (n: number, prenom: string, nom: string, departement: string) =>
  AGENT(n, {
    Prénom: prenom,
    Nom: nom,
    'Poste occupé ': `CHEF DE DEPARTEMENT ${departement}`,
    Statut: 'Cadre',
    Direction: 'DSID',
  });
const CHEF_MAINTENANCE = AGENT(6, {
  Prénom: 'MODOU',
  Nom: 'GUEYE',
  Sexe: 'M',
  'Poste occupé ': 'CHEF DU SERVICE MAINTENANCE',
  Statut: 'Cadre',
  Direction: 'DSID',
  'Responsable Hierarchique\n(N+1)': 'FALL Ousmane',
});

/** Le parent d'une unité, par son nom. */
async function parentDe(nom: string): Promise<string | null> {
  const r = await raw(
    `SELECT p.name FROM org_units u JOIN org_units p ON p.id = u.parent_id
      WHERE u.tenant_id = $1 AND u.name = $2 AND u.deleted_at IS NULL`,
    [tenantId, nom],
  );
  return (r.rows[0] as { name: string } | undefined)?.name ?? null;
}

describe('les services se rangent sous un département', () => {
  it('sous le seul département de la direction, et le chef relève du chef de département', async () => {
    // Le service avant son département : l'ordre du fichier ne compte pas.
    const r = await importer([
      CHEF_MAINTENANCE,
      DIRECTEUR_DSID,
      cheffeDeDepartement(2, 'FATOU', 'SALL', 'DIGITALISATION'),
      DG,
    ]);
    expect(r.erreurs).toBe(0);
    expect(r.rattachements).toEqual([]);
    expect(r.unitesCreees).toContainEqual(
      expect.objectContaining({
        nom: 'Service Maintenance',
        parent: 'Département Digitalisation',
      }),
    );
    expect(await parentDe('Service Maintenance')).toBe('Département Digitalisation');
    // Le fichier donnait le directeur pour N+1 au chef du service : la
    // règle 3 bis corrige.
    expect((await fiche('106'))?.n1).toBe('Fatou Sall');
    expect(ligne(r, 2).corrections).toContainEqual(
      expect.objectContaining({
        lu: 'FALL Ousmane',
        retenu: 'Fatou Sall, responsable de « Département Digitalisation »',
      }),
    );
    expect(ligne(r, 2).avertissements.filter((a) => a.colonne.startsWith('Responsable'))).toEqual(
      [],
    );
  });

  it('dans une direction sans département, le service reste sous la direction', async () => {
    const r = await importer([DIRECTEUR_DSID, CHEF_MAINTENANCE, DG]);
    expect(r.rattachements).toEqual([]);
    expect(await parentDe('Service Maintenance')).toBe(
      "Direction des Systèmes d'information et de la Digitalisation",
    );
    expect((await fiche('106'))?.n1).toBe('Ousmane Fall');
  });

  it('avec deux départements, l’aperçu demande lequel, puis l’import y range le service', async () => {
    const lignes = [
      DG,
      DIRECTEUR_DSID,
      cheffeDeDepartement(2, 'FATOU', 'SALL', 'DIGITALISATION'),
      cheffeDeDepartement(4, 'AWA', 'NDIAYE', 'INFRASTRUCTURES'),
      CHEF_MAINTENANCE,
    ];
    const apercu = await importer(lignes, false);
    expect(apercu.rattachements).toEqual([
      {
        cle: expect.any(String),
        service: 'Service Maintenance',
        direction: 'DSID',
        lignes: [6],
        departements: [
          { cle: expect.any(String), nom: 'Département Digitalisation' },
          { cle: expect.any(String), nom: 'Département Infrastructures' },
        ],
        retenu: null,
      },
    ]);
    expect(ligne(apercu, 6).avertissements).toContainEqual({
      colonne: 'Poste occupé',
      texte: 'Choisissez le département auquel rattacher « Service Maintenance »',
    });
    const question = apercu.rattachements[0]!;
    const choix = { [question.cle]: question.departements[1]!.cle };
    const revu = await importer(lignes, false, {}, {}, choix);
    expect(revu.rattachements[0]?.retenu).toBe(question.departements[1]!.cle);
    expect(revu.unitesCreees).toContainEqual(
      expect.objectContaining({
        nom: 'Service Maintenance',
        parent: 'Département Infrastructures',
      }),
    );
    expect(ligne(revu, 6).avertissements).not.toContainEqual(
      expect.objectContaining({ texte: expect.stringContaining('Choisissez le département') }),
    );

    const r = await importer(lignes, true, {}, {}, choix);
    expect(r.erreurs).toBe(0);
    expect(await parentDe('Service Maintenance')).toBe('Département Infrastructures');
    expect((await fiche('106'))?.n1).toBe('Awa Ndiaye');
  });

  it('au réimport, le service d’un import précédent se range sous le département arrivé depuis', async () => {
    await importer([DG, DIRECTEUR_DSID, CHEF_MAINTENANCE]);
    const lignes = [
      DG,
      DIRECTEUR_DSID,
      CHEF_MAINTENANCE,
      cheffeDeDepartement(2, 'FATOU', 'SALL', 'DIGITALISATION'),
    ];
    const apercu = await importer(lignes, false);
    expect(apercu.servicesRanges).toEqual([
      { service: 'Service Maintenance', departement: 'Département Digitalisation' },
    ]);
    const r = await importer(lignes);
    expect(r.servicesRanges).toEqual(apercu.servicesRanges);
    expect(await parentDe('Service Maintenance')).toBe('Département Digitalisation');
    expect((await fiche('106'))?.n1).toBe('Fatou Sall');
  });

  it('un service saisi à la main reste où la DCH l’a mis', async () => {
    await raw(
      `INSERT INTO org_units (id, tenant_id, unit_type, name, parent_id)
       VALUES ($1,$2,'service','Service Maintenance',$3)`,
      [randomUUID(), tenantId, unites.dsid],
    );
    const r = await importer([
      DG,
      DIRECTEUR_DSID,
      cheffeDeDepartement(2, 'FATOU', 'SALL', 'DIGITALISATION'),
      CHEF_MAINTENANCE,
    ]);
    expect(r.servicesRanges).toEqual([]);
    expect(await parentDe('Service Maintenance')).toBe(
      "Direction des Systèmes d'information et de la Digitalisation",
    );
  });
});

/* ─── L'organigramme de l'aperçu (ADR-0179) ─── */

const ANALYSTE = (n: number, plus: Ligne = {}) =>
  AGENT(n, { Prénom: `ANALYSTE${n}`, Nom: 'NDOYE', Direction: 'DSID', ...plus });

describe('l’organigramme de l’aperçu', () => {
  it('rend l’organigramme que l’import laisse, avec ses agents', async () => {
    const r = await importer(
      [
        DG,
        DIRECTEUR_DSID,
        cheffeDeDepartement(2, 'FATOU', 'SALL', 'DIGITALISATION'),
        CHEF_MAINTENANCE,
        ANALYSTE(7),
      ],
      false,
    );
    const noeud = (nom: string) => r.organigramme.find((n) => n.nom === nom)!;
    const dsid = noeud("Direction des Systèmes d'information et de la Digitalisation");
    const dep = noeud('Département Digitalisation');
    const service = noeud('Service Maintenance');
    expect(dep).toMatchObject({ parent: dsid.cle, creee: true, type: 'department' });
    expect(dep.responsable?.nom).toBe('Fatou Sall');
    expect(service.parent).toBe(dep.cle);
    expect(r.agents.find((a) => a.ligne === 6)).toMatchObject({
      nom: 'Analyste7 Ndoye',
      unite: dsid.cle,
      modifiable: true,
    });
    // Le responsable que l'import désigne reste à la tête de son unité.
    expect(r.agents.find((a) => a.ligne === 5)?.modifiable).toBe(false);
    // Les clés restent les mêmes d'un aperçu à l'autre.
    const revu = await importer(
      [
        DG,
        DIRECTEUR_DSID,
        cheffeDeDepartement(2, 'FATOU', 'SALL', 'DIGITALISATION'),
        CHEF_MAINTENANCE,
        ANALYSTE(7),
      ],
      false,
    );
    expect(revu.organigramme.map((n) => n.cle).sort()).toEqual(
      r.organigramme.map((n) => n.cle).sort(),
    );
  });

  it('place un agent dans un service de sa direction : son N+1 est le chef du service', async () => {
    const lignes = [
      DG,
      DIRECTEUR_DSID,
      cheffeDeDepartement(2, 'FATOU', 'SALL', 'DIGITALISATION'),
      CHEF_MAINTENANCE,
      ANALYSTE(7),
    ];
    const apercu = await importer(lignes, false);
    const service = apercu.organigramme.find((n) => n.nom === 'Service Maintenance')!;
    const placements = { [service.cle]: [6] };
    const revu = await importer(lignes, false, {}, {}, {}, { placements });
    expect(revu.agents.find((a) => a.ligne === 6)?.unite).toBe(service.cle);
    expect(ligne(revu, 6).unite).toBe('Service Maintenance');

    const r = await importer(lignes, true, {}, {}, {}, { placements });
    expect(r.erreurs).toBe(0);
    const s = await raw(
      `SELECT id FROM org_units WHERE tenant_id = $1 AND name = 'Service Maintenance'`,
      [tenantId],
    );
    expect(await fiche('107')).toMatchObject({
      org_unit_id: (s.rows[0] as { id: string }).id,
      n1: 'Modou Gueye',
    });
  });

  it('ne place pas un agent hors de sa direction', async () => {
    const lignes = [DG, DIRECTEUR_DSID, ANALYSTE(7)];
    const apercu = await importer(lignes, false);
    const dch = apercu.organigramme.find((n) => n.sigle === 'DCH')!;
    const revu = await importer(lignes, false, {}, {}, {}, { placements: { [dch.cle]: [4] } });
    const dsid = revu.organigramme.find((n) => n.sigle === 'DSID')!;
    expect(revu.agents.find((a) => a.ligne === 4)?.unite).toBe(dsid.cle);
  });

  it('demande le responsable d’une unité qui reçoit des agents sans en avoir, puis le désigne', async () => {
    const lignes = [DG, ANALYSTE(7), ANALYSTE(8)];
    const apercu = await importer(lignes, false);
    expect(apercu.unitesSansResponsable).toEqual([
      {
        cle: expect.any(String),
        unite: "Direction des Systèmes d'information et de la Digitalisation",
        direction: 'DSID',
        effectif: 2,
        candidats: [
          expect.objectContaining({ cle: 'l:3', nom: 'Analyste7 Ndoye' }),
          expect.objectContaining({ cle: 'l:4', nom: 'Analyste8 Ndoye' }),
        ],
        retenu: null,
      },
    ]);
    const cle = apercu.unitesSansResponsable[0]!.cle;
    const r = await importer(lignes, true, {}, {}, {}, { responsables: { [cle]: 'l:3' } });
    expect(r.erreurs).toBe(0);
    expect(r.unitesSansResponsable[0]?.retenu).toBe('l:3');
    expect(r.designations).toContainEqual({
      poste: 'Directrice de la DSID',
      nom: 'Analyste7 Ndoye',
    });
    expect(await chefDe(unites.dsid)).toBe('Analyste7 Ndoye');
    // L'autre agent de la direction relève d'office de la directrice.
    expect((await fiche('108'))?.n1).toBe('Analyste7 Ndoye');
    expect((await fiche('107'))?.n1).toBe('Cheikh Mbaye');
  });

  it('accepte « Non désigné » : l’unité reste sans responsable', async () => {
    const lignes = [DG, ANALYSTE(7)];
    const cle = (await importer(lignes, false)).unitesSansResponsable[0]!.cle;
    const r = await importer(lignes, true, {}, {}, {}, { responsables: { [cle]: 'aucun' } });
    expect(r.unitesSansResponsable[0]?.retenu).toBe('aucun');
    expect(await chefDe(unites.dsid)).toBeNull();
  });
});

describe('le N+1 par son nom', () => {
  it('demande de qui il s’agit quand deux personnes portent le nom, puis rattache', async () => {
    const awa1 = AGENT(1, { Prénom: 'AWA', Nom: 'NDIAYE', 'Date de naissance': '01/01/1985' });
    const awa2 = AGENT(2, { Prénom: 'AWA', Nom: 'NDIAYE', 'Date de naissance': '02/02/1986' });
    const agent = AGENT(3, { 'Responsable Hierarchique\n(N+1)': 'AWA NDIAYE' });
    const apercu = await importer([awa1, awa2, agent], false);
    expect(apercu.choix).toHaveLength(1);
    const choix = apercu.choix[0]!;
    expect(choix).toMatchObject({ role: 'n1', nom: 'AWA NDIAYE', lignes: [4], retenu: null });
    expect(choix.candidats.map((c) => c.cle)).toEqual(['l:2', 'l:3']);
    expect(ligne(apercu, 4).avertissements).toContainEqual({
      colonne: 'Responsable Hierarchique (N+1)',
      texte: '2 personnes s’appellent « AWA NDIAYE » : choisissez laquelle',
    });

    const r = await importer([awa1, awa2, agent], true, { [choix.cle]: 'l:3' });
    expect(r.choix[0]?.retenu).toBe('l:3');
    const n1 = await raw(
      `SELECT p.birth_date::text AS naissance FROM employees e
         JOIN employees m ON m.id = e.manager_employee_id JOIN persons p ON p.id = m.person_id
        WHERE e.tenant_id = $1 AND e.employee_number = '103'`,
      [tenantId],
    );
    expect(n1.rows[0]).toEqual({ naissance: '1986-02-02' });
  });

  it('ne redemande pas au réimport le choix déjà fait', async () => {
    const awa1 = AGENT(1, { Prénom: 'AWA', Nom: 'NDIAYE', 'Date de naissance': '01/01/1985' });
    const awa2 = AGENT(2, { Prénom: 'AWA', Nom: 'NDIAYE', 'Date de naissance': '02/02/1986' });
    const agent = AGENT(3, { 'Responsable Hierarchique\n(N+1)': 'AWA NDIAYE' });
    const apercu = await importer([awa1, awa2, agent], false);
    await importer([awa1, awa2, agent], true, { [apercu.choix[0]!.cle]: 'l:3' });
    const r = await importer([awa1, awa2, agent], false);
    expect(r.choix).toEqual([]);
    expect(ligne(r, 4)).toMatchObject({ etat: 'inchange', responsable: 'Awa Ndiaye' });
  });

  it('propose un nom à une faute près, sans le deviner', async () => {
    const r = await importer(
      [
        AGENT(1, { Prénom: 'AWA', Nom: 'NDIAYE' }),
        AGENT(2, { 'Responsable Hierarchique\n(N+1)': 'AWA NDIAY' }),
      ],
      false,
    );
    expect(r.choix[0]?.candidats.map((c) => c.nom)).toEqual(['Awa Ndiaye']);
    expect(ligne(r, 3).avertissements).toContainEqual({
      colonne: 'Responsable Hierarchique (N+1)',
      texte: '« AWA NDIAY » ne se retrouve pas tel quel : choisissez la personne',
    });
  });

  it('retient le responsable fonctionnel pour information', async () => {
    await importer([
      AGENT(1, { Prénom: 'OUMAR', Nom: 'SECK', Sexe: 'M', Direction: 'DFC' }),
      AGENT(2, { 'Responsable Fonctionnel': 'Oumar Seck' }),
    ]);
    expect((await fiche('102'))?.fonctionnel).toBe('Oumar Seck');
  });
});

describe('la prime de transport', () => {
  it('se reprend sur la fiche, puis se met à jour au réimport', async () => {
    await importer([AGENT(1, { 'Prime de transport': 26000 })]);
    const prime = async () =>
      (
        await raw(
          `SELECT r.prime_transport FROM remunerations r JOIN employees e ON e.id = r.employee_id
            WHERE e.tenant_id = $1 AND e.employee_number = '101'`,
          [tenantId],
        )
      ).rows[0]?.prime_transport;
    expect(await prime()).toBe(26000);
    const r = await importer([AGENT(1, { 'Prime de transport': '30 000' })]);
    expect(ligne(r, 2).changements).toContainEqual({
      champ: 'Prime de transport',
      avant: '26 000 F CFA',
      apres: '30 000 F CFA',
    });
    expect(await prime()).toBe(30000);
    // Une case vide n'efface rien.
    await importer([AGENT(1)]);
    expect(await prime()).toBe(30000);
  });
});

describe('la rémunération, la banque, l’IPRES et la filiation', () => {
  /** Le fichier entier compte soixante colonnes : celles-ci suffisent. */
  const ENTETES = [
    'Matricule',
    'Prénom',
    'Nom',
    'Sexe',
    'Poste occupé ',
    'Statut',
    'Direction',
    'Type de contrat',
    "Date d'entrée",
    'Fils/Fille',
    'Salaire de base ',
    'Sursalaire ',
    'Nombre de part Sociale',
    'Banque',
    "Relevé d'Identité Bancaire",
    'Domiciliation',
    'Numero IPRES',
  ];
  const AWA = (plus: Record<string, string | number> = {}) =>
    ({
      ...AGENT(1),
      'Fils/Fille': 'Fille de Moussa Diop et de Awa Sarr',
      'Salaire de base ': 450000,
      'Sursalaire ': '50 000',
      'Nombre de part Sociale': '1,5',
      Banque: 'CBAO',
      "Relevé d'Identité Bancaire": 'SN012 01201 036182616901 96',
      Domiciliation: 'Agence Plateau',
      'Numero IPRES': '1234567',
      ...plus,
    }) as Ligne;
  const envoyer = (l: Ligne, appliquer = true, user: SessionUser = admin) =>
    imports.importer(user, fichier([l], ENTETES), appliquer);
  const enBase = async () =>
    (
      await raw(
        `SELECT r.salaire_de_base, r.sursalaire, r.nombre_de_parts::text AS parts, r.banque,
                r.rib_chiffre, r.domiciliation, r.numero_ipres,
                p.prenom_du_pere, p.prenom_de_la_mere, p.nom_de_la_mere
           FROM employees e JOIN persons p ON p.id = e.person_id
           LEFT JOIN remunerations r ON r.employee_id = e.id
          WHERE e.tenant_id = $1 AND e.employee_number = '101'`,
        [tenantId],
      )
    ).rows[0] as Record<string, unknown>;

  it('se reprennent sur la fiche, puis se mettent à jour au réimport', async () => {
    await envoyer(AWA());
    const f = await enBase();
    expect(f).toMatchObject({
      salaire_de_base: 450000,
      sursalaire: 50000,
      parts: '1.5',
      banque: 'cbao',
      domiciliation: 'Agence Plateau',
      numero_ipres: '1234567',
      prenom_du_pere: 'Moussa',
      prenom_de_la_mere: 'Awa',
      nom_de_la_mere: 'Sarr',
    });
    expect(crypto.decrypt(f.rib_chiffre as string)).toBe('SN0120120103618261690196');

    expect(ligne(await envoyer(AWA(), false), 2).etat).toBe('inchange');
    const r = await envoyer(
      AWA({
        'Salaire de base ': 500000,
        Banque: 'Ecobank',
        "Relevé d'Identité Bancaire": 'SN0120120103618261690197',
        'Fils/Fille': 'Fille de Moussa et de Awa Ndiaye',
      }),
    );
    expect(ligne(r, 2).changements).toEqual([
      { champ: 'Nom de la mère', avant: 'Sarr', apres: 'Ndiaye' },
      { champ: 'Salaire de base', avant: '450 000 F CFA', apres: '500 000 F CFA' },
      { champ: 'Banque', avant: 'CBAO', apres: 'Ecobank' },
      {
        champ: 'RIB',
        avant: 'SN012 01201 036182616901 96',
        apres: 'SN012 01201 036182616901 97',
      },
    ]);
    expect(await enBase()).toMatchObject({ salaire_de_base: 500000, banque: 'ecobank' });
  });

  it('attendent l’accès aux données sensibles : l’aperçu nomme leurs colonnes', async () => {
    const gestion = { ...admin, role: 'employee', capacites: ['personnel.gerer'] } as SessionUser;
    const r = await envoyer(AWA(), true, gestion);
    expect(r.colonnesNonImportees).toEqual([
      'Salaire de base',
      'Sursalaire',
      'Nombre de part Sociale',
      'Banque',
      "Relevé d'Identité Bancaire",
      'Domiciliation',
      'Numero IPRES',
    ]);
    expect(ligne(r, 2).avertissements).toEqual([]);
    // La filiation n'est pas une donnée sensible : elle s'importe.
    expect(await enBase()).toMatchObject({ salaire_de_base: null, prenom_du_pere: 'Moussa' });
    expect((await envoyer(AWA(), false)).colonnesNonImportees).toEqual([]);
  });
});

describe('le réimport', () => {
  it('ne change rien au second envoi du même fichier', async () => {
    const lignes = [DG, AGENT(1, { 'Region ': 'Thiès', 'Numero CNI': '2751199001234' }), AGENT(2)];
    await importer(lignes);
    const r = await importer(lignes, false);
    expect(r).toMatchObject({ aCreer: 0, aModifier: 0, inchanges: 3, erreurs: 0 });
  });

  it('met à jour ce qui change, et le liste', async () => {
    await importer([AGENT(1, { 'Region ': 'Thiès', Statut: 'Non cadre' })]);
    const r = await importer([AGENT(1, { 'Region ': 'Dakar', Statut: 'Cadre' })], false);
    expect(ligne(r, 2)).toMatchObject({
      etat: 'a-modifier',
      changements: [
        { champ: 'Région', avant: 'Thiès', apres: 'Dakar' },
        { champ: 'Statut', avant: 'Non-cadre', apres: 'Cadre' },
      ],
    });
    expect((await fiche('101'))?.region).toBe('thies');
    await importer([AGENT(1, { 'Region ': 'Dakar', Statut: 'Cadre' })]);
    expect(await fiche('101')).toMatchObject({ region: 'dakar', personnel: 'cadre' });
  });

  it('donne son contrat au dossier qui n’en a pas, déduit quand le fichier ne le dit pas', async () => {
    // Le premier import d'un fichier sans type de contrat n'en créait pas.
    await importer([AGENT(1, { 'Type de contrat': undefined })]);
    await raw(`DELETE FROM contracts WHERE tenant_id = $1`, [tenantId]);
    const r = await importer([AGENT(1, { 'Type de contrat': undefined })]);
    expect(ligne(r, 2).changements).toContainEqual({ champ: 'Contrat', avant: null, apres: 'CDI' });
    expect(await fiche('101')).toMatchObject({ contract_type: 'cdi', contrat_le: '2024-03-01' });
  });

  it('n’efface rien avec une case vide', async () => {
    await importer([AGENT(1, { 'Region ': 'Thiès' })]);
    const r = await importer([AGENT(1, { 'Region ': undefined })]);
    expect(ligne(r, 2).etat).toBe('inchange');
    expect((await fiche('101'))?.region).toBe('thies');
  });

  it('retrouve la fiche provisoire par la personne quand le vrai matricule arrive', async () => {
    await importer([AGENT(1, { Matricule: '50' }), AGENT(2, { Matricule: '50' })]);
    // Les lignes ont changé d'ordre, et chacune a son vrai matricule.
    const r = await importer([AGENT(2, { Matricule: '51' }), AGENT(1, { Matricule: '50' })]);
    expect(ligne(r, 2).changements).toContainEqual({
      champ: 'Matricule',
      avant: '50B',
      apres: '51',
    });
    expect(ligne(r, 3).changements).toContainEqual({
      champ: 'Matricule',
      avant: '50A',
      apres: '50',
    });
    expect(await fiche('51')).toMatchObject({ given_name: 'Agent2', matricule_provisoire: false });
    expect(await fiche('50')).toMatchObject({ given_name: 'Agent1', matricule_provisoire: false });
    expect(await compte('employees')).toBe(2);
  });

  it('retrouve une fiche provisoire écrite avec un tiret, 50-A', async () => {
    await importer([AGENT(1, { Matricule: '50' }), AGENT(2, { Matricule: '50' })]);
    await raw(
      `UPDATE employees SET employee_number = '50-' || right(employee_number, 1)
        WHERE tenant_id = $1 AND matricule_provisoire`,
      [tenantId],
    );
    const r = await importer([AGENT(1, { Matricule: '50' }), AGENT(2, { Matricule: '50' })], false);
    expect(r.aCreer).toBe(0);
    expect(ligne(r, 2).matricule).toBe('50-A');
    expect(ligne(r, 3).matricule).toBe('50-B');
  });

  it('laisse son propre dossier tel quel, et refuse de le modifier', async () => {
    await importer([DG]);
    // Le compte qui importe est celui du DG.
    await raw(`UPDATE persons SET user_id = $1 WHERE tenant_id = $2 AND given_name = 'Cheikh'`, [
      adminUserId,
      tenantId,
    ]);
    const meme = await importer([DG], false);
    expect(ligne(meme, 2).etat).toBe('inchange');
    const change = await importer([{ ...DG, 'Region ': 'Thiès' }], false);
    expect(ligne(change, 2)).toMatchObject({
      etat: 'erreur',
      motif:
        'Votre propre dossier ne se modifie pas par l’import : une autre personne de la DCH s’en charge',
    });
    await raw(`UPDATE persons SET user_id = NULL WHERE tenant_id = $1`, [tenantId]);
  });

  it('refuse un matricule qui est celui d’une autre personne', async () => {
    await importer([
      AGENT(1, { Matricule: '77', Prénom: 'AWA', 'Date de naissance': '01/01/1985' }),
    ]);
    const r = await importer([
      AGENT(2, {
        Matricule: '77',
        Prénom: 'MOUSSA',
        Nom: 'NDIAYE',
        'Date de naissance': '05/05/1980',
      }),
    ]);
    expect(ligne(r, 2)).toMatchObject({
      etat: 'erreur',
      motif: 'Le matricule 77 est celui de Awa Diop sur la plateforme',
    });
    expect((await fiche('77'))?.given_name).toBe('Awa');
  });

  it('précise une date d’entrée connue au mois : le contrat et l’affectation suivent', async () => {
    await importer([AGENT(1, { "Date d'entrée": undefined, 'Ancienneté (années)': 2 })]);
    const avant = await fiche('101');
    const exacte = `${String(avant?.hired_on).slice(0, 8)}17`;
    const [a, m, j] = exacte.split('-');
    const r = await importer([AGENT(1, { "Date d'entrée": `${j}/${m}/${a}` })]);
    expect(ligne(r, 2).changements[0]?.champ).toBe('Date d’entrée');
    expect(await fiche('101')).toMatchObject({
      hired_on: exacte,
      entree_au_mois: false,
      contrat_le: exacte,
      affecte_le: exacte,
    });
  });
});

describe('la migration 0131', () => {
  it('écrit les matricules provisoires sans tiret, la lettre selon l’ancienneté', async () => {
    const migration = readFileSync(
      join(__dirname, '../src/db/sql/0131_matricules_provisoires_sans_tiret.sql'),
      'utf8',
    )
      .split('\n')
      .filter((l) => !l.startsWith('SET '))
      .join('\n');
    // Un import d'avant la règle : les lettres dans l'ordre du fichier, avec
    // un tiret. Agent2, entrée en 2010, avait reçu 50-B.
    await importer([
      AGENT(1, { Matricule: '50' }),
      AGENT(2, { Matricule: '50', "Date d'entrée": '15/06/2010' }),
      AGENT(3, { Matricule: '60A' }),
      AGENT(4, { Matricule: '60' }),
      AGENT(5, { Matricule: '60' }),
    ]);
    const renommer = (de: string, vers: string) =>
      raw(
        `UPDATE employees SET employee_number = $3 WHERE tenant_id = $1 AND employee_number = $2`,
        [tenantId, de, vers],
      );
    await renommer('50B', '50-A');
    await renommer('50A', '50-B');
    await renommer('60B', '60-A');
    await renommer('60C', '60-B');

    await raw(migration);

    expect(await fiche('50A')).toMatchObject({ given_name: 'Agent2', matricule_provisoire: true });
    expect(await fiche('50B')).toMatchObject({ given_name: 'Agent1', matricule_provisoire: true });
    // 60A est le vrai matricule d'Agent3 : la famille 60 garde ses matricules.
    expect((await fiche('60A'))?.given_name).toBe('Agent3');
    expect((await fiche('60-A'))?.given_name).toBe('Agent4');
    expect((await fiche('60-B'))?.given_name).toBe('Agent5');
  });
});
