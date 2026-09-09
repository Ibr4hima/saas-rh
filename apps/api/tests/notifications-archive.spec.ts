/**
 * Archivage des notifications — contre un vrai Postgres, rôle applicatif
 * soumis à la RLS.
 *
 * Ce qu'on protège ici tient en une phrase de la demande : « libérer la place
 * aux nouvelles notifs SANS PERDRE les anciennes ». Trois invariants la
 * portent, et aucun ne se voit depuis l'interface :
 *
 * 1. Ranger ne marque pas lu. Ce sont deux gestes différents — on range pour
 *    dégager la vue, pas pour déclarer qu'on a lu. Confondre les deux ferait
 *    disparaître silencieusement l'information « je n'ai jamais ouvert ça ».
 * 2. Le compteur de la cloche ne compte QUE la boîte. Sans cela, ranger une
 *    non-lue laisserait une pastille qui ne correspond à rien de visible.
 * 3. L'idempotence des rappels générés survit au rangement : l'index unique
 *    sur `dedupe_key` couvre la table entière, archives comprises. Si le
 *    filtre d'archivage venait à s'y glisser, chaque ouverture du panneau
 *    recréerait le rappel de férié qu'on vient de ranger.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SessionUser } from '@teranga/contracts';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import { NotificationsService } from '../src/modules/notifications/notifications.service';

const env = loadEnv();

const tenantId = randomUUID();
const userId = randomUUID();
const autreUserId = randomUUID();

let ownerPool: Pool;
let appPool: Pool;
let tenantDb: TenantDb;
let service: NotificationsService;

const user: SessionUser = {
  userId,
  tenantId,
  role: 'employee',
  email: 'archive@test.local',
  givenName: 'Test',
  familyName: 'Archive',
} as SessionUser;

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

/** Pose une notification et rend son identifiant. */
async function poser(titre: string, options: { lue?: boolean; pour?: string } = {}) {
  const id = randomUUID();
  await withTenant((db) =>
    db.execute(
      sql`INSERT INTO notifications (id, tenant_id, recipient_user_id, type, title, read_at)
          VALUES (${id}, ${tenantId}, ${options.pour ?? userId}, 'test', ${titre},
                  ${options.lue ? sql`now()` : sql`NULL`})`,
    ),
  );
  return id;
}

async function etat(id: string) {
  const { rows } = await ownerPool.query<{ read_at: Date | null; archived_at: Date | null }>(
    `SELECT read_at, archived_at FROM notifications WHERE id = $1`,
    [id],
  );
  return rows[0]!;
}

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 2 });
  appPool = new Pool({ connectionString: env.APP_DATABASE_URL, max: 5 });
  tenantDb = new TenantDb();
  service = new NotificationsService(tenantDb);

  await withTenant(async (db) => {
    for (const id of [userId, autreUserId]) {
      await db.execute(
        sql`INSERT INTO users (id, email, password_hash, given_name, family_name)
            VALUES (${id}, ${`archive-${id}@test.local`}, 'x', 'Test', 'Archive')`,
      );
    }
    await db.execute(
      sql`INSERT INTO tenants (id, name, slug)
          VALUES (${tenantId}, 'Archives', ${`archives-${tenantId.slice(0, 8)}`})`,
    );
  });
});

afterAll(async () => {
  await ownerPool?.query(`DELETE FROM notifications WHERE tenant_id = $1`, [tenantId]);
  await ownerPool?.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  await ownerPool?.query(`DELETE FROM users WHERE id = ANY($1)`, [[userId, autreUserId]]);
  await tenantDb?.pool.end();
  await appPool?.end();
  await ownerPool?.end();
});

describe('ranger et ressortir', () => {
  it('sort la ligne de la boîte, la met dans les archives, sans rien effacer', async () => {
    const id = await poser('À ranger', { lue: true });
    await service.archive(user, [id]);

    const boite = await service.list(user, 'inbox');
    expect(boite.items.map((i) => i.id)).not.toContain(id);
    expect(boite.archivedCount).toBe(1);

    const archives = await service.list(user, 'archive');
    const rangee = archives.items.find((i) => i.id === id);
    expect(rangee).toBeDefined();
    expect(rangee!.title).toBe('À ranger');
    expect(rangee!.archivedAt).not.toBeNull();
  });

  it('la remet exactement où elle était quand on la ressort', async () => {
    const id = await poser('Aller-retour', { lue: true });
    await service.archive(user, [id]);
    await service.unarchive(user, [id]);
    expect((await etat(id)).archived_at).toBeNull();
    const boite = await service.list(user, 'inbox');
    expect(boite.items.map((i) => i.id)).toContain(id);
  });

  it('range plusieurs lignes en un seul geste', async () => {
    const ids = [await poser('Lot 1'), await poser('Lot 2'), await poser('Lot 3')];
    await service.archive(user, ids);
    const boite = await service.list(user, 'inbox');
    for (const id of ids) expect(boite.items.map((i) => i.id)).not.toContain(id);
    await service.unarchive(user, ids);
  });

  it("refuse un identifiant qui n'appartient pas à l'utilisateur", async () => {
    const id = await poser("Pour quelqu'un d'autre", { pour: autreUserId });
    await expect(service.archive(user, [id])).rejects.toThrow();
    expect((await etat(id)).archived_at).toBeNull();
  });

  it('ranger deux fois la même ligne ne lève pas', async () => {
    const id = await poser('Deux fois', { lue: true });
    await service.archive(user, [id]);
    await expect(service.archive(user, [id])).resolves.toBeUndefined();
  });
});

describe('ranger ≠ lire', () => {
  it("ne marque PAS lue la notification qu'on range", async () => {
    const id = await poser('Rangée sans être lue');
    await service.archive(user, [id]);
    expect((await etat(id)).read_at).toBeNull();
    const archives = await service.list(user, 'archive');
    expect(archives.items.find((i) => i.id === id)!.readAt).toBeNull();
  });

  it('la retire pourtant du compteur de la cloche', async () => {
    const id = await poser('Hors compteur');
    const avant = (await service.list(user, 'inbox')).unreadCount;
    await service.archive(user, [id]);
    expect((await service.list(user, 'inbox')).unreadCount).toBe(avant - 1);
  });

  it('« ranger les lues » épargne les non-lues', async () => {
    const lue = await poser('Déjà lue', { lue: true });
    const nonLue = await poser('Pas encore lue');
    await service.archiveRead(user);
    expect((await etat(lue)).archived_at).not.toBeNull();
    expect((await etat(nonLue)).archived_at).toBeNull();
    await service.archive(user, [nonLue]); // ménage
  });
});

describe('idempotence des rappels générés', () => {
  it('ne recrée pas un rappel rangé — la clé de dédoublonnage couvre les archives', async () => {
    const id = randomUUID();
    await withTenant((db) =>
      db.execute(
        sql`INSERT INTO notifications (id, tenant_id, recipient_user_id, type, title, dedupe_key)
            VALUES (${id}, ${tenantId}, ${userId}, 'holiday_reminder', 'Rappel', 'holiday:2030-01-01')`,
      ),
    );
    await service.archive(user, [id]);
    await service.list(user, 'inbox');

    const { rows } = await ownerPool.query<{ n: string }>(
      `SELECT count(*) AS n FROM notifications
       WHERE tenant_id = $1 AND dedupe_key = 'holiday:2030-01-01'`,
      [tenantId],
    );
    expect(Number(rows[0]!.n)).toBe(1);
  });
});
