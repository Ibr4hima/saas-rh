/**
 * Garde-fou d'idempotence des rappels de jours fériés.
 *
 * Ce test existe à cause d'un défaut RÉEL et INVISIBLE en boîte noire : la
 * sous-requête corrélée interrogeait `notifications.id` au lieu de
 * `holidays.id`, parce que Drizzle rend les colonnes interpolées en
 * identifiants NUS et que Postgres résout d'abord la portée interne du
 * sous-SELECT. Résultat : le garde-fou était toujours faux et l'endpoint
 * `/notifications` — sondé par chaque session ouverte — retentait un INSERT à
 * chaque appel, silencieusement absorbé par l'index unique partiel.
 *
 * On teste donc le SQL RÉELLEMENT généré par le code de production, contre un
 * Postgres réel avec le rôle applicatif soumis à la RLS.
 */
import { randomUUID } from 'node:crypto';
import { and, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import * as t from '../src/db/schema';
import {
  holidayAlreadySentSql,
  holidayDedupeKey,
} from '../src/modules/notifications/notifications.service';

const env = loadEnv();

const tenantId = randomUUID();
const userId = randomUUID();
const holidayId = randomUUID();
/** Un jour franchement dans la fenêtre lue par le service. */
const DAY = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);

let ownerPool: Pool;
let appPool: Pool;

/** Reproduit le helper de production : contexte RLS transactionnel. */
async function withTenant<T>(fn: (db: NodePgDatabase) => Promise<T>): Promise<T> {
  const client = await appPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)`,
      [tenantId, userId],
    );
    const result = await fn(drizzle(client));
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Rejoue la lecture du service : le férié, avec son drapeau « déjà notifié ». */
async function readFlag(): Promise<boolean> {
  return withTenant(async (db) => {
    const rows = await db
      .select({ alreadySent: holidayAlreadySentSql(userId) })
      .from(t.holidays)
      .where(and(sql`${t.holidays.id} = ${holidayId}`));
    expect(rows).toHaveLength(1);
    return rows[0]!.alreadySent;
  });
}

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 2 });
  appPool = new Pool({ connectionString: env.APP_DATABASE_URL, max: 5 });

  await withTenant(async (db) => {
    await db.execute(
      sql`INSERT INTO users (id, email, password_hash, given_name, family_name)
          VALUES (${userId}, ${`ferie-${userId}@test.local`}, 'x', 'Test', 'Férié')`,
    );
    await db.execute(
      sql`INSERT INTO tenants (id, name, slug)
          VALUES (${tenantId}, 'Fériés', ${`feries-${tenantId.slice(0, 8)}`})`,
    );
    await db.execute(
      sql`INSERT INTO holidays (id, tenant_id, day, label)
          VALUES (${holidayId}, ${tenantId}, ${DAY}, 'Fête de démonstration')`,
    );
  });
});

afterAll(async () => {
  await ownerPool?.query(`DELETE FROM notifications WHERE tenant_id = $1`, [tenantId]);
  await ownerPool?.query(`DELETE FROM holidays WHERE tenant_id = $1`, [tenantId]);
  await ownerPool?.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  await ownerPool?.query(`DELETE FROM users WHERE id = $1`, [userId]);
  await appPool?.end();
  await ownerPool?.end();
});

describe('idempotence des rappels de jours fériés', () => {
  it('vaut false tant qu’aucun rappel n’a été envoyé', async () => {
    expect(await readFlag()).toBe(false);
  });

  it('bascule à true dès que le rappel existe — sinon on réécrit à chaque sondage', async () => {
    await withTenant(async (db) => {
      await db.insert(t.notifications).values({
        id: randomUUID(),
        tenantId,
        recipientUserId: userId,
        type: 'holiday_reminder',
        title: 'Jour férié à venir : Fête de démonstration',
        body: 'corps',
        link: '/calendrier',
        dedupeKey: holidayDedupeKey(holidayId, DAY),
      });
    });

    expect(await readFlag()).toBe(true);
  });

  it('reste false pour un AUTRE destinataire : le fan-out est par utilisateur', async () => {
    const autre = randomUUID();
    const flag = await withTenant(async (db) => {
      const rows = await db
        .select({ alreadySent: holidayAlreadySentSql(autre) })
        .from(t.holidays)
        .where(and(sql`${t.holidays.id} = ${holidayId}`));
      return rows[0]!.alreadySent;
    });
    expect(flag).toBe(false);
  });

  it('la clé de dédoublonnage porte l’identifiant du FÉRIÉ, pas celui de la notification', async () => {
    const [row] = (
      await ownerPool.query<{ dedupe_key: string; id: string }>(
        `SELECT id::text, dedupe_key FROM notifications WHERE tenant_id = $1`,
        [tenantId],
      )
    ).rows;
    expect(row!.dedupe_key).toBe(`holiday:${holidayId}:${DAY}`);
    expect(row!.dedupe_key).not.toContain(row!.id);
  });
});
