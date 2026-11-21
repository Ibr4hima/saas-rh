/**
 * Le migrateur et ses garde-fous, sur une base jetable : verrou, empreintes,
 * délai d'attente des verrous, consentement pour ce qui détruit. Et, sur les
 * fichiers du dépôt, la règle : une migration qui détruit des données le
 * déclare.
 */
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';
import { DECLARATION_DESTRUCTIVE, runMigrations } from '../src/db/migrate';

const env = loadEnv();
const DOSSIER_DU_DEPOT = join(__dirname, '..', 'src', 'db', 'sql');

/** Ce qui détruit des données, hors commentaires et corps de fonctions. */
const DESTRUCTIF =
  /\b(DROP\s+TABLE|DROP\s+COLUMN|DELETE\s+FROM|TRUNCATE|ALTER\s+COLUMN\s+\w+\s+(SET\s+DATA\s+)?TYPE)\b/i;

/**
 * Les migrations destructives d'avant la règle, appliquées partout : elles ne
 * se réécrivent plus (leur empreinte est relevée). La liste est close.
 */
const HISTORIQUES = new Set([
  '0022_reseed_incomplete_future_years.sql',
  '0030_circuit_conges.sql',
  '0032_habilitations.sql',
  '0035_academy_administrateur.sql',
  '0039_sans_ville.sql',
  '0045_objectifs_commentaires.sql',
  '0046_objectifs_statuts.sql',
  '0053_sans_avis_de_delegation.sql',
  '0057_offres_sans_nombre_de_postes.sql',
  '0065_matricules_majuscules.sql',
]);

describe('les fichiers du dépôt', () => {
  it('une migration qui détruit des données le déclare en tête', () => {
    const sansDeclaration = readdirSync(DOSSIER_DU_DEPOT)
      .filter((f) => f.endsWith('.sql') && !HISTORIQUES.has(f))
      .filter((f) => {
        const sql = readFileSync(join(DOSSIER_DU_DEPOT, f), 'utf8');
        const code = sql.replace(/--[^\n]*/g, '').replace(/\$\$[\s\S]*?\$\$/g, '');
        return DESTRUCTIF.test(code) && !DECLARATION_DESTRUCTIVE.test(sql);
      });
    expect(sansDeclaration).toEqual([]);
  });

  it('la liste des historiques est close : elles existent toutes, et précèdent la règle', () => {
    const fichiers = new Set(readdirSync(DOSSIER_DU_DEPOT));
    for (const f of HISTORIQUES) {
      expect(fichiers.has(f)).toBe(true);
      expect(f < '0071').toBe(true);
    }
  });
});

describe('le migrateur, sur une base jetable', () => {
  const nomBase = `teranga_migr_${randomUUID().slice(0, 8)}`;
  const url = (() => {
    const u = new URL(env.DATABASE_URL);
    u.pathname = `/${nomBase}`;
    return u.toString();
  })();
  let dossier: string;
  const ecrire = (nom: string, sql: string) => writeFileSync(join(dossier, nom), sql);
  const lire = async (q: string) => {
    const c = new Client({ connectionString: url });
    await c.connect();
    try {
      return (await c.query(q)).rows;
    } finally {
      await c.end();
    }
  };
  const proprietaire = async (q: string) => {
    const c = new Client({ connectionString: env.DATABASE_URL });
    await c.connect();
    try {
      await c.query(q);
    } finally {
      await c.end();
    }
  };
  const echec = async (fn: () => Promise<unknown>): Promise<string> => {
    try {
      await fn();
      return 'AUCUNE ERREUR';
    } catch (err) {
      return (err as Error).message;
    }
  };

  beforeAll(async () => {
    await proprietaire(`CREATE DATABASE ${nomBase}`);
    dossier = mkdtempSync(join(tmpdir(), 'migrations-'));
  });
  afterAll(async () => {
    rmSync(dossier, { recursive: true, force: true });
    await proprietaire(`DROP DATABASE IF EXISTS ${nomBase} WITH (FORCE)`);
  });

  it('applique dans l’ordre, avec un délai d’attente des verrous, et relève l’empreinte', async () => {
    ecrire('0001_table.sql', 'CREATE TABLE essai (id int PRIMARY KEY);');
    ecrire(
      '0002_delai.sql',
      `CREATE TABLE delai AS SELECT current_setting('lock_timeout') AS valeur;`,
    );
    await runMigrations(url, { dossier });
    expect(await lire('SELECT valeur FROM delai')).toEqual([{ valeur: '5s' }]);
    const journal = await lire('SELECT name, checksum FROM schema_migrations ORDER BY name');
    expect(journal.map((r) => r.name)).toEqual(['0001_table.sql', '0002_delai.sql']);
    expect(journal.every((r) => /^[0-9a-f]{64}$/.test(r.checksum))).toBe(true);
    // Rejouer ne fait rien.
    await runMigrations(url, { dossier });
  });

  it('deux migrateurs lancés ensemble : un seul applique, l’autre trouve le travail fait', async () => {
    ecrire('0003_ligne.sql', 'INSERT INTO essai VALUES (1);');
    await Promise.all([runMigrations(url, { dossier }), runMigrations(url, { dossier })]);
    expect(await lire('SELECT id FROM essai')).toEqual([{ id: 1 }]);
  });

  it('une migration appliquée puis réécrite arrête tout', async () => {
    const origine = readFileSync(join(dossier, '0001_table.sql'), 'utf8');
    ecrire('0001_table.sql', 'CREATE TABLE essai (id bigint PRIMARY KEY);');
    expect(await echec(() => runMigrations(url, { dossier }))).toMatch(
      /modifiées après leur application : 0001_table\.sql/,
    );
    ecrire('0001_table.sql', origine);
    await runMigrations(url, { dossier });
  });

  it('une migration appliquée puis renommée ou supprimée arrête tout', async () => {
    const origine = readFileSync(join(dossier, '0003_ligne.sql'), 'utf8');
    unlinkSync(join(dossier, '0003_ligne.sql'));
    ecrire('0004_ligne.sql', origine);
    expect(await echec(() => runMigrations(url, { dossier }))).toMatch(
      /introuvables sur le disque : 0003_ligne\.sql/,
    );
    expect(await lire('SELECT id FROM essai')).toEqual([{ id: 1 }]);
    unlinkSync(join(dossier, '0004_ligne.sql'));
    ecrire('0003_ligne.sql', origine);
  });

  it('ce qui détruit ne passe sur une base en service que nommé', async () => {
    ecrire('0005_retrait.sql', '-- Destructif : la table d’essai part.\nDROP TABLE essai;');
    expect(await echec(() => runMigrations(url, { dossier }))).toMatch(
      /destructives en attente : 0005_retrait\.sql.*MIGRATIONS_DESTRUCTIVES=0005_retrait\.sql/,
    );
    expect(await lire('SELECT id FROM essai')).toEqual([{ id: 1 }]);
    await runMigrations(url, { dossier, destructivesPermises: ['0005_retrait.sql'] });
    expect(await lire(`SELECT to_regclass('essai') AS t`)).toEqual([{ t: null }]);
  });

  it('une base vierge n’a rien à perdre : tout s’applique', async () => {
    await proprietaire(`DROP DATABASE ${nomBase} WITH (FORCE)`);
    await proprietaire(`CREATE DATABASE ${nomBase}`);
    await runMigrations(url, { dossier });
    expect((await lire('SELECT count(*)::int AS n FROM schema_migrations'))[0]?.n).toBe(4);
  });
});
