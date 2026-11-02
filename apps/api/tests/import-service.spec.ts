/**
 * L'import du fichier du personnel de la DCH, jusqu'à la base (ADR-0159).
 *
 * `import-employes.spec.ts` éprouve la lecture : ce que la plateforme
 * comprend du fichier. Ici, ce qu'elle en fait : les fiches créées et mises
 * à jour, les unités et les responsables que les postes désignent, les N+1
 * retrouvés par leur nom, et l'aperçu qui joue tout puis annule.
 */
import { randomUUID } from 'node:crypto';
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
) => imports.importer(admin, fichier(lignes), appliquer, choix, noms);

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
  const crypto = new EncryptionService();
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
      position_title: "Chargé d'études",
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

  it('donne 50-A et 50-B à un matricule en double, provisoires', async () => {
    const r = await importer([AGENT(1, { Matricule: '50' }), AGENT(2, { Matricule: '50' })]);
    expect(r.aCreer).toBe(2);
    expect(ligne(r, 2).matricule).toBe('50-A');
    expect(ligne(r, 3)).toMatchObject({ matricule: '50-B', matriculeProvisoire: true });
    expect((await fiche('50-A'))?.matricule_provisoire).toBe(true);
    expect((await fiche('50-B'))?.given_name).toBe('Agent2');
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
      avant: '50-B',
      apres: '51',
    });
    expect(ligne(r, 3).changements).toContainEqual({
      champ: 'Matricule',
      avant: '50-A',
      apres: '50',
    });
    expect(await fiche('51')).toMatchObject({ given_name: 'Agent2', matricule_provisoire: false });
    expect(await fiche('50')).toMatchObject({ given_name: 'Agent1', matricule_provisoire: false });
    expect(await compte('employees')).toBe(2);
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
