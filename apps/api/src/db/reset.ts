/**
 * Base vierge, puis migrations à neuf. C'est le remède que le migrateur
 * conseille quand il détecte un schéma construit dans le désordre.
 *
 * Détruit TOUTES les données de la base pointée par DATABASE_URL : réservé au
 * développement et à la CI. Les extensions et les rôles (app_user) survivent —
 * seuls les objets créés par les migrations sont supprimés, puis recréés.
 *
 * Deux garde-fous, parce qu'un seul ne suffit pas : NODE_ENV décrit le PROCESSUS
 * (une console de développement pointée sur la base de prod le laisse à
 * « development »), pas la base visée. On refuse donc aussi toute base
 * distante sans confirmation explicite du nom de la base.
 */
import { Client } from 'pg';
import { loadEnv } from '../config/env';
import { runMigrations } from './migrate';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '', 'db', 'postgres']);

/** Refuse tout ce qui n'est pas manifestement une base jetable. */
function assertDisposable(url: string, nodeEnv: string): void {
  if (nodeEnv === 'production') {
    throw new Error('db:reset est interdit quand NODE_ENV=production.');
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      "DATABASE_URL n'est pas une URL exploitable : db:reset refuse d'agir à l'aveugle.",
    );
  }
  const host = parsed.hostname;
  const dbName = parsed.pathname.replace(/^\//, '');
  if (LOCAL_HOSTS.has(host)) return;

  // Base distante : on exige que l'appelant écrive lui-même le nom de la base.
  if (process.env.DB_RESET_CONFIRM !== dbName) {
    throw new Error(
      `db:reset viserait la base « ${dbName} » sur l'hôte distant « ${host} » et détruirait ` +
        "toutes ses données. Si c'est bien voulu, relancez avec " +
        `DB_RESET_CONFIRM=${dbName} en variable d'environnement.`,
    );
  }
}

export async function resetDatabase(databaseUrl?: string): Promise<void> {
  const env = loadEnv();
  const url = databaseUrl ?? env.DATABASE_URL;
  assertDisposable(url, env.NODE_ENV);
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    // Tables d'abord (CASCADE emporte vues, index, contraintes et triggers),
    // puis les fonctions restées orphelines (audit_row…).
    await client.query(`
      DO $$
      DECLARE r record;
      BEGIN
        FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
          EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', r.tablename);
        END LOOP;
        FOR r IN
          SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public'
            -- Les fonctions appartenant à une extension (btree_gist…) ne se
            -- suppriment pas une par une : elles suivent leur extension.
            AND NOT EXISTS (
              SELECT 1 FROM pg_depend d
              WHERE d.objid = p.oid AND d.deptype = 'e'
            )
        LOOP
          EXECUTE format('DROP FUNCTION IF EXISTS public.%I(%s) CASCADE', r.proname, r.args);
        END LOOP;
      END $$;
    `);
    process.stdout.write('Base vidée.\n');
  } finally {
    await client.end();
  }
  await runMigrations(url);
}

if (require.main === module) {
  resetDatabase().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
