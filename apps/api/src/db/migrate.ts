/**
 * Migrateur SQL minimal (ADR-0010) : applique les fichiers de src/db/sql dans
 * l'ordre lexicographique, chacun dans une transaction, et journalise dans
 * schema_migrations. S'exécute avec le rôle PROPRIÉTAIRE (DATABASE_URL) — le
 * seul endroit du système autorisé à bypasser la RLS.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { loadEnv } from '../config/env';

export async function runMigrations(databaseUrl?: string): Promise<void> {
  const url = databaseUrl ?? loadEnv().DATABASE_URL;
  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const dir = join(__dirname, 'sql');
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.name));

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = readFileSync(join(dir, file), 'utf8');
      process.stdout.write(`Applying ${file}… `);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        process.stdout.write('ok\n');
      } catch (err) {
        await client.query('ROLLBACK');
        process.stdout.write('FAILED\n');
        throw err;
      }
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
