/**
 * L'import d'un classeur, jusqu'à la base.
 *
 * `import-employes.spec.ts` éprouve la lecture et la traduction — ce que la
 * plateforme COMPREND d'un classeur. Ici, ce qu'elle en FAIT : les dossiers
 * écrits, les rattachements, et les trois règles décidées avec la RH.
 *
 *   1. un matricule déjà présent est ignoré, jamais écrasé ;
 *   2. un abrégé d'unité inconnu crée l'agent sans rattachement ;
 *   3. une ligne fautive n'arrête pas les autres.
 *
 * Le test qui compte le plus est celui de la règle 1 : c'est lui qui interdit
 * qu'un second envoi du même fichier — geste que tout le monde fait un jour —
 * écrase des dossiers enrichis depuis.
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
let dchId: string;

async function raw(q: string, params: unknown[] = []) {
  return ownerPool.query(q, params as never[]);
}

/* ——— Le classeur, écrit comme la RH l'écrit ——— */

const COLONNES = [
  'Prénom',
  'Nom',
  'Matricule',
  'Poste',
  'Direction affectée',
  'Type de contrat',
  'Début du contrat',
  'Durée (mois)',
  'Sexe',
  'Matricule du responsable',
] as const;

type Ligne = Partial<Record<(typeof COLONNES)[number], string>>;

/** Échappe ce qui doit l'être dans une cellule en chaîne littérale. */
const xml = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');

const COL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Un classeur à partir de lignes nommées.
 *
 * Tout part en `inlineStr`, dates comprises : c'est le cas le plus courant
 * dans un fichier tenu à la main, et la lecture des dates sérielles a déjà
 * ses tests ailleurs. Une valeur absente laisse un TROU dans la ligne, comme
 * un tableur le fait — la cellule n'est pas écrite du tout.
 */
function classeurDe(lignes: Ligne[], entetes: readonly string[] = COLONNES): Buffer {
  const ligneXml = (valeurs: (string | undefined)[], r: number) =>
    `<row r="${r}">` +
    valeurs
      .map((v, i) =>
        v === undefined ? '' : `<c r="${COL[i]}${r}" t="inlineStr"><is><t>${xml(v)}</t></is></c>`,
      )
      .join('') +
    `</row>`;
  const corps = lignes.map((l, i) =>
    ligneXml(
      entetes.map((e) => l[e as keyof Ligne]),
      i + 2,
    ),
  );
  return classeur(`<sheetData>${ligneXml([...entetes], 1)}${corps.join('')}</sheetData>`);
}

const AGENT = (n: number, plus: Ligne = {}): Ligne => ({
  Prénom: `Agent${n}`,
  Nom: 'Diop',
  Matricule: `APIX-${String(n).padStart(4, '0')}`,
  Poste: 'Analyste',
  'Direction affectée': 'DCH',
  'Type de contrat': 'CDI',
  'Début du contrat': '01/03/2024',
  ...plus,
});

/** Ce que la base porte pour un matricule — le dossier tel qu'il est écrit. */
async function dossier(matricule: string) {
  const r = await raw(
    `SELECT p.given_name, p.family_name, p.gender, e.hired_on,
            a.position_title, a.org_unit_id, c.contract_type, c.start_date, c.end_date,
            (SELECT rp.given_name || ' ' || rp.family_name
               FROM employees re JOIN persons rp ON rp.id = re.person_id
              WHERE re.id = e.manager_employee_id) AS responsable
       FROM employees e
       JOIN persons p ON p.id = e.person_id
       LEFT JOIN assignments a ON a.employee_id = e.id
       LEFT JOIN contracts c ON c.employee_id = e.id
      WHERE e.tenant_id = $1 AND e.employee_number = $2`,
    [tenantId, matricule],
  );
  return r.rows[0] as
    | {
        given_name: string;
        family_name: string;
        gender: string | null;
        hired_on: Date;
        position_title: string | null;
        org_unit_id: string | null;
        contract_type: string | null;
        start_date: Date | null;
        end_date: Date | null;
        responsable: string | null;
      }
    | undefined;
}

const jour = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

const compteDossiers = async (): Promise<number> => {
  const r = await raw(`SELECT count(*)::int AS n FROM employees WHERE tenant_id = $1`, [tenantId]);
  return (r.rows[0] as { n: number }).n;
};

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 3 });
  db = new TenantDb();
  imports = new ImportEmployesService(db, new PeopleService(db, new EncryptionService()));
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
  await raw(`UPDATE org_units SET manager_employee_id = NULL WHERE tenant_id = $1`, [tenantId]);
  for (const table of [
    'assignments',
    'contracts',
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
  dchId = randomUUID();
  await raw(
    `INSERT INTO org_units (id, tenant_id, unit_type, name, short_name)
     VALUES ($1,$2,'direction','Direction du Capital Humain','DCH')`,
    [dchId, tenantId],
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
  it('rend le compte rendu SANS rien écrire', async () => {
    const r = await imports.importer(admin, classeurDe([AGENT(1), AGENT(2)]), false);
    expect(r.applique).toBe(false);
    expect(r.aCreer).toBe(2);
    expect(r.crees).toBe(0);
    expect(await compteDossiers()).toBe(0);
  });

  it('s’arrête sur une colonne obligatoire absente, sans parler des lignes', async () => {
    const sansMatricule = ['Prénom', 'Nom', 'Poste', 'Début du contrat'] as const;
    const r = await imports.importer(
      admin,
      classeurDe([AGENT(1), AGENT(2)], sansMatricule),
      // Même en mode écriture : une colonne obligatoire absente n'écrit rien.
      true,
    );
    expect(r.colonnesManquantes).toEqual(['Matricule']);
    expect(r.lignes).toEqual([]);
    expect(r.applique).toBe(false);
    expect(await compteDossiers()).toBe(0);
  });

  it('signale les colonnes qu’elle ne sait pas lire, et importe quand même', async () => {
    const avecIntrus = [...COLONNES, 'Groupe sanguin'] as const;
    const r = await imports.importer(
      admin,
      classeurDe([{ ...AGENT(1), 'Groupe sanguin': 'O+' } as Ligne], avecIntrus),
      true,
    );
    expect(r.colonnesInconnues).toEqual(['Groupe sanguin']);
    expect(r.crees).toBe(1);
  });
});

describe('l’écriture', () => {
  it('crée le dossier complet : personne, employé, affectation, contrat', async () => {
    const r = await imports.importer(
      admin,
      classeurDe([AGENT(1, { Sexe: 'Féminin', Prénom: 'Awa' })]),
      true,
    );
    expect(r.applique).toBe(true);
    expect(r.crees).toBe(1);

    const d = await dossier('APIX-0001');
    expect(d?.given_name).toBe('Awa');
    expect(d?.family_name).toBe('Diop');
    expect(d?.gender).toBe('female');
    expect(jour(d?.hired_on ?? null)).toBe('2024-03-01');
    expect(d?.position_title).toBe('Analyste');
    expect(d?.org_unit_id).toBe(dchId);
    expect(d?.contract_type).toBe('cdi');
    expect(jour(d?.start_date ?? null)).toBe('2024-03-01');
    expect(d?.end_date).toBeNull();
  });

  it('datte la fin d’un CDD à la VEILLE du jour anniversaire', async () => {
    await imports.importer(
      admin,
      classeurDe([
        AGENT(1, {
          'Type de contrat': 'CDD',
          'Début du contrat': '20/05/2024',
          'Durée (mois)': '12',
        }),
      ]),
      true,
    );
    const d = await dossier('APIX-0001');
    expect(d?.contract_type).toBe('cdd');
    expect(jour(d?.end_date ?? null)).toBe('2025-05-19');
  });

  it('rattache par le NOM COMPLET de la direction, pas seulement par l’abrégé', async () => {
    await imports.importer(
      admin,
      classeurDe([AGENT(1, { 'Direction affectée': 'direction du capital humain' })]),
      true,
    );
    expect((await dossier('APIX-0001'))?.org_unit_id).toBe(dchId);
  });

  it('crée l’agent SANS rattachement quand l’abrégé est inconnu, et le signale', async () => {
    const r = await imports.importer(
      admin,
      classeurDe([AGENT(1, { 'Direction affectée': 'DGUPLI' }), AGENT(2)]),
      true,
    );
    expect(r.crees).toBe(2);
    expect(r.sansUnite).toBe(1);
    const ligne = r.lignes.find((l) => l.matricule === 'APIX-0001');
    // Un abrégé inconnu n'est pas un refus : la ligne reste « à créer » et
    // porte un AVERTISSEMENT — ce qui manquera au dossier, pas pourquoi il
    // n'existe pas. `motif` est réservé aux lignes refusées ou ignorées.
    expect(ligne?.motif).toBeNull();
    expect(ligne?.avertissements).toEqual([
      {
        colonne: 'Direction affectée',
        texte: 'Abrégé inconnu dans l’organigramme : dossier sans rattachement',
      },
    ]);
    expect(ligne?.uniteResolue).toBeNull();
    expect((await dossier('APIX-0001'))?.org_unit_id).toBeNull();
    // L'agent entre quand même avec son poste : c'est le dossier qui compte.
    expect((await dossier('APIX-0001'))?.position_title).toBe('Analyste');
    expect((await dossier('APIX-0002'))?.org_unit_id).toBe(dchId);
  });
});

describe('les doublons', () => {
  it('ignore un matricule DÉJÀ EN BASE sans toucher au dossier existant', async () => {
    await imports.importer(admin, classeurDe([AGENT(1)]), true);
    // Le dossier vit sa vie après l'import : il change de poste.
    await raw(`UPDATE assignments SET position_title = 'Directrice' WHERE tenant_id = $1`, [
      tenantId,
    ]);

    const r = await imports.importer(admin, classeurDe([AGENT(1), AGENT(2)]), true);
    expect(r.crees).toBe(1);
    expect(r.ignores).toBe(1);
    const ignoree = r.lignes.find((l) => l.matricule === 'APIX-0001');
    expect(ignoree?.etat).toBe('ignore');
    expect(ignoree?.colonne).toBe('Matricule');
    expect(ignoree?.motif).toContain('existe déjà');
    // Le poste n'a pas été réécrit par le second envoi.
    expect((await dossier('APIX-0001'))?.position_title).toBe('Directrice');
    expect(await compteDossiers()).toBe(2);
  });

  it('dit ce qu’il a COMPRIS de la direction d’une ligne ignorée', async () => {
    await imports.importer(admin, classeurDe([AGENT(1)]), true);
    const r = await imports.importer(admin, classeurDe([AGENT(1)]), false);
    // Le rejeu d'un fichier déjà importé affichait tous ses abrégés comme
    // introuvables : la résolution se faisait APRÈS le test de doublon.
    expect(r.lignes[0]?.uniteAbrege).toBe('DCH');
    expect(r.lignes[0]?.uniteResolue).toBe('Direction du Capital Humain');
    expect(r.sansUnite).toBe(0);
  });

  it('ignore la seconde ligne d’un doublon INTERNE au fichier, en nommant la première', async () => {
    const r = await imports.importer(
      admin,
      classeurDe([AGENT(1), AGENT(2), AGENT(1, { Prénom: 'Sosie' })]),
      true,
    );
    expect(r.crees).toBe(2);
    expect(r.ignores).toBe(1);
    const sosie = r.lignes.find((l) => l.ligne === 4);
    expect(sosie?.etat).toBe('ignore');
    expect(sosie?.motif).toContain('ligne 2');
    // C'est la PREMIÈRE occurrence qui est entrée.
    expect((await dossier('APIX-0001'))?.given_name).toBe('Agent1');
  });
});

describe('une ligne fautive', () => {
  it('n’arrête pas les autres, et nomme sa ligne et sa colonne', async () => {
    const r = await imports.importer(
      admin,
      classeurDe([AGENT(1), AGENT(2, { 'Début du contrat': 'le mois dernier' }), AGENT(3)]),
      true,
    );
    expect(r.crees).toBe(2);
    expect(r.erreurs).toBe(1);
    const fautive = r.lignes.find((l) => l.ligne === 3);
    expect(fautive?.etat).toBe('erreur');
    expect(fautive?.colonne).toBe('Début du contrat');
    expect(await compteDossiers()).toBe(2);
    expect(await dossier('APIX-0002')).toBeUndefined();
    expect(await dossier('APIX-0003')).toBeDefined();
  });

  it('refuse un fichier qui n’est pas un classeur, sans rien écrire', async () => {
    const erreur = await imports
      .importer(admin, Buffer.from('ceci n’est pas une archive zip'), true)
      .catch((e: unknown) => e);
    expect(erreur).toBeInstanceOf(ProblemException);
    expect((erreur as ProblemException).problem.code).toBe('import.illisible');
    expect(await compteDossiers()).toBe(0);
  });
});

describe('le responsable hiérarchique', () => {
  it('rattache à un agent DÉJÀ en base, par son matricule', async () => {
    const chef = await imports.importer(admin, classeurDe([AGENT(1)]), true);
    expect(chef.crees).toBe(1);

    const r = await imports.importer(
      admin,
      classeurDe([AGENT(2, { 'Matricule du responsable': 'APIX-0001' })]),
      true,
    );
    expect(r.rattaches).toBe(1);
    expect(r.sansResponsable).toBe(0);
    expect((await dossier('APIX-0002'))?.responsable).toBe('Agent1 Diop');
  });

  it('rattache à un agent créé PLUS BAS dans le même fichier', async () => {
    // Le fichier du RH n'est pas trié : le chef peut venir après ses équipes.
    const r = await imports.importer(
      admin,
      classeurDe([AGENT(1, { 'Matricule du responsable': 'APIX-0009' }), AGENT(9)]),
      true,
    );
    expect(r.crees).toBe(2);
    expect(r.rattaches).toBe(1);
    expect((await dossier('APIX-0001'))?.responsable).toBe('Agent9 Diop');
  });

  it('retrouve le matricule malgré la casse et les séparateurs', async () => {
    await imports.importer(admin, classeurDe([AGENT(1)]), true);
    const r = await imports.importer(
      admin,
      classeurDe([AGENT(2, { 'Matricule du responsable': ' apix0001 ' })]),
      true,
    );
    expect(r.rattaches).toBe(1);
    expect((await dossier('APIX-0002'))?.responsable).toBe('Agent1 Diop');
  });

  it('sans direction affectée, crée le dossier SANS n+1 — l’affectation vient d’abord', async () => {
    const r = await imports.importer(
      admin,
      classeurDe([
        AGENT(1),
        AGENT(2, { 'Direction affectée': '', 'Matricule du responsable': 'APIX-0001' }),
      ]),
      true,
    );
    expect(r.crees).toBe(2);
    expect(r.rattaches).toBe(0);
    expect(r.lignes[1]?.avertissements).toEqual([
      {
        colonne: 'Matricule du responsable',
        texte: 'Sans direction affectée : dossier créé sans n+1 — affectez-le d’abord',
      },
    ]);
    expect((await dossier('APIX-0002'))?.responsable).toBeNull();
  });

  it('crée le dossier SANS n+1 quand le matricule est introuvable, et le dit', async () => {
    const r = await imports.importer(
      admin,
      classeurDe([AGENT(1, { 'Matricule du responsable': 'APIX-9999' })]),
      true,
    );
    expect(r.crees).toBe(1);
    expect(r.sansResponsable).toBe(1);
    expect(r.rattaches).toBe(0);
    const ligne = r.lignes[0];
    expect(ligne?.etat).toBe('a-creer');
    expect(ligne?.avertissements).toEqual([
      {
        colonne: 'Matricule du responsable',
        texte: 'Matricule « APIX-9999 » introuvable : dossier créé sans n+1',
      },
    ]);
    expect((await dossier('APIX-0001'))?.responsable).toBeNull();
  });

  it('refuse qu’un agent soit son propre responsable', async () => {
    const r = await imports.importer(
      admin,
      classeurDe([AGENT(1, { 'Matricule du responsable': 'APIX-0001' })]),
      true,
    );
    expect(r.crees).toBe(1);
    expect(r.sansResponsable).toBe(1);
    expect(r.lignes[0]?.avertissements[0]?.texte).toContain('son propre responsable');
    expect((await dossier('APIX-0001'))?.responsable).toBeNull();
  });

  it('garde le dossier quand la RÈGLE DE DIRECTION refuse le rattachement', async () => {
    // Le n+1 est à la DCH, l'agent à la DIPE : la règle de l'APIX l'interdit.
    // Le dossier entre quand même — c'est le rattachement qui échoue.
    const dipe = randomUUID();
    await raw(
      `INSERT INTO org_units (id, tenant_id, unit_type, name, short_name)
       VALUES ($1,$2,'direction','Direction de l’Intelligence','DIPE')`,
      [dipe, tenantId],
    );
    // Un directeur en place à la DCH et à la DIPE : sans tête, le chemin
    // « rattachement au DG » resterait ouvert et la règle ne mordrait pas.
    const r1 = await imports.importer(
      admin,
      classeurDe([AGENT(1), AGENT(5, { 'Direction affectée': 'DIPE' })]),
      true,
    );
    expect(r1.crees).toBe(2);
    const chefDCH = (await raw(`SELECT id FROM employees WHERE employee_number = 'APIX-0001'`))
      .rows[0] as { id: string };
    const chefDIPE = (await raw(`SELECT id FROM employees WHERE employee_number = 'APIX-0005'`))
      .rows[0] as { id: string };
    await raw(`UPDATE org_units SET manager_employee_id = $2 WHERE id = $1`, [dchId, chefDCH.id]);
    await raw(`UPDATE org_units SET manager_employee_id = $2 WHERE id = $1`, [dipe, chefDIPE.id]);

    const r = await imports.importer(
      admin,
      classeurDe([
        AGENT(2, { 'Direction affectée': 'DIPE', 'Matricule du responsable': 'APIX-0001' }),
      ]),
      true,
    );
    expect(r.crees).toBe(1);
    expect(r.sansResponsable).toBe(1);
    expect(r.lignes[0]?.avertissements[0]?.texte).toContain('même direction');
    expect((await dossier('APIX-0002'))?.responsable).toBeNull();
  });

  it('cumule DEUX avertissements : direction inconnue et responsable introuvable', async () => {
    const r = await imports.importer(
      admin,
      classeurDe([
        AGENT(1, { 'Direction affectée': 'XYZ', 'Matricule du responsable': 'APIX-9999' }),
      ]),
      false,
    );
    expect(r.lignes[0]?.avertissements.map((a) => a.colonne)).toEqual([
      'Direction affectée',
      'Matricule du responsable',
    ]);
  });

  it('annonce les rattachements DÈS L’APERÇU, sans rien écrire', async () => {
    const r = await imports.importer(
      admin,
      classeurDe([AGENT(1), AGENT(2, { 'Matricule du responsable': 'APIX-0001' })]),
      false,
    );
    expect(r.applique).toBe(false);
    expect(r.rattaches).toBe(1);
    expect(r.sansResponsable).toBe(1);
    expect(r.lignes[1]?.responsableResolu).toBe('Agent1 Diop');
    expect(await compteDossiers()).toBe(0);
  });

  it('compte comme sans responsable une colonne laissée vide', async () => {
    const r = await imports.importer(admin, classeurDe([AGENT(1), AGENT(2)]), true);
    expect(r.sansResponsable).toBe(2);
    expect(r.rattaches).toBe(0);
    expect(r.lignes.every((l) => l.responsable === null)).toBe(true);
  });
});
