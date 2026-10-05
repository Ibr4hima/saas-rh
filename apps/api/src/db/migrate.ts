/**
 * Migrateur SQL minimal (ADR-0010) : applique les fichiers de src/db/sql dans
 * l'ordre lexicographique, chacun dans une transaction, et journalise dans
 * schema_migrations. S'exécute avec le rôle PROPRIÉTAIRE (DATABASE_URL) — le
 * seul endroit du système autorisé à bypasser la RLS.
 *
 * Ses garde-fous :
 *  - un verrou : deux démarrages simultanés (deux instances, deux suites de
 *    tests) ne migrent pas en même temps ; le second trouve le travail fait ;
 *  - une empreinte par fichier appliqué : un fichier réécrit après coup, ou
 *    disparu, arrête tout, au lieu de laisser des bases qui divergent ;
 *  - un délai d'attente des verrous : une migration qui attend une table
 *    occupée échoue au bout de cinq secondes, sans bloquer l'application ;
 *  - un consentement pour ce qui détruit : un fichier qui se déclare
 *    « Destructif » ne s'applique à une base déjà en service que si on le
 *    nomme dans MIGRATIONS_DESTRUCTIVES, une fois la sauvegarde faite.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { loadEnv } from '../config/env';
import { chiffrerLesCandidatures } from './chiffrer-candidatures';
import { OPTIONS_CONNEXION } from './tenant-db';

/** La clé du verrou consultatif des migrations, propre à ce migrateur. */
const VERROU_MIGRATIONS = 7_204_118_301;

/** Un fichier qui détruit des données le dit dans son en-tête. */
export const DECLARATION_DESTRUCTIVE = /^--\s*Destructif\s*:/im;

export interface OptionsMigration {
  /** Le dossier des fichiers SQL (les tests du migrateur en donnent un autre). */
  dossier?: string;
  /** Les fichiers destructifs consentis (par défaut : MIGRATIONS_DESTRUCTIVES). */
  destructivesPermises?: string[];
}

const empreinte = (contenu: string) => createHash('sha256').update(contenu).digest('hex');

export async function runMigrations(
  databaseUrl?: string,
  options: OptionsMigration = {},
): Promise<void> {
  const url = databaseUrl ?? loadEnv().DATABASE_URL;
  const dir = options.dossier ?? join(__dirname, 'sql');
  const permises = new Set(
    options.destructivesPermises ??
      (process.env.MIGRATIONS_DESTRUCTIVES ?? '')
        .split(',')
        .map((f) => f.trim())
        .filter(Boolean),
  );
  const client = new Client({ connectionString: url, options: OPTIONS_CONNEXION });
  await client.connect();

  try {
    // Le verrou d'abord : tout ce qui suit se lit et s'écrit seul. Il tombe
    // avec la connexion, même si le processus s'arrête en route.
    await client.query('SELECT pg_advisory_lock($1)', [VERROU_MIGRATIONS]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum text');

    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const contenus = new Map(files.map((f) => [f, readFileSync(join(dir, f), 'utf8')]));

    const { rows } = await client.query<{ name: string; checksum: string | null }>(
      'SELECT name, checksum FROM schema_migrations',
    );
    const applied = new Set(rows.map((r) => r.name));

    // Un fichier appliqué puis supprimé ou renommé : renommé, il passerait
    // pour nouveau et s'appliquerait une seconde fois.
    const disparus = rows.map((r) => r.name).filter((n) => !contenus.has(n));
    if (disparus.length > 0) {
      throw new Error(
        `Migrations appliquées introuvables sur le disque : ${disparus.join(', ')}. ` +
          'Une migration appliquée ne se renomme ni ne se supprime.',
      );
    }

    // L'empreinte de ce qui a été appliqué : relevée la première fois, puis
    // vérifiée. Une migration appliquée ne se corrige pas, on en écrit une autre.
    const modifiees: string[] = [];
    for (const r of rows) {
      const actuelle = empreinte(contenus.get(r.name)!);
      if (r.checksum === null) {
        await client.query('UPDATE schema_migrations SET checksum = $1 WHERE name = $2', [
          actuelle,
          r.name,
        ]);
      } else if (r.checksum !== actuelle) {
        modifiees.push(r.name);
      }
    }
    if (modifiees.length > 0) {
      throw new Error(
        `Migrations modifiées après leur application : ${modifiees.join(', ')}. ` +
          'Remettez-les telles quelles et écrivez une nouvelle migration.',
      );
    }

    // Garde anti-trou : si une migration appliquée est PLUS RÉCENTE qu'une
    // migration en attente, la base a été construite dans le désordre (ex. un
    // checkout ancien migré puis remis à jour). Appliquer la suite produirait
    // un schéma incohérent et silencieusement cassé — on refuse et on nomme
    // les fichiers manquants.
    const pending = files.filter((f) => !applied.has(f));
    const lastApplied = files.filter((f) => applied.has(f)).pop();
    const outOfOrder = lastApplied ? pending.filter((f) => f < lastApplied) : [];
    if (outOfOrder.length > 0) {
      throw new Error(
        `Migrations manquantes antérieures à ${lastApplied} : ${outOfOrder.join(', ')}. ` +
          "La base a été migrée dans le désordre. Repartez d'une base vierge " +
          '(pnpm db:reset) ou appliquez ces fichiers manuellement avant de continuer.',
      );
    }

    // Ce qui détruit des données ne passe pas sur une base en service sans
    // qu'on l'ait nommé. Une base vierge n'a rien à perdre.
    const enService = applied.size > 0;
    const refusees = pending.filter(
      (f) => enService && DECLARATION_DESTRUCTIVE.test(contenus.get(f)!) && !permises.has(f),
    );
    if (refusees.length > 0) {
      throw new Error(
        `Migrations destructives en attente : ${refusees.join(', ')}. ` +
          'Faites une sauvegarde, puis relancez avec ' +
          `MIGRATIONS_DESTRUCTIVES=${refusees.join(',')}.`,
      );
    }

    for (const file of pending) {
      const sql = contenus.get(file)!;
      process.stdout.write(`Applying ${file}… `);
      try {
        await client.query('BEGIN');
        // Par défaut ; un fichier peut le fixer autrement pour lui-même.
        await client.query("SET LOCAL lock_timeout = '5s'");
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [
          file,
          empreinte(sql),
        ]);
        await client.query('COMMIT');
        process.stdout.write('ok\n');
      } catch (err) {
        await client.query('ROLLBACK');
        process.stdout.write('FAILED\n');
        throw err;
      }
    }
    // Ce que le SQL ne sait pas faire, faute de clé : chiffrer les
    // candidatures déposées avant 0079.
    if (!options.dossier) {
      const chiffrees = await chiffrerLesCandidatures(client);
      if (chiffrees > 0) process.stdout.write(`Candidatures chiffrées : ${chiffrees}\n`);
    }
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  runMigrations().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
