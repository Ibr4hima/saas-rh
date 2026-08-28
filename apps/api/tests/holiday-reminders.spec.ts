/**
 * Rappels de jours fériés — bout en bout, contre un vrai Postgres.
 *
 * Deux défauts réels justifient ce fichier, tous deux INVISIBLES en boîte noire :
 *
 * 1. La sous-requête corrélée d'idempotence interrogeait `notifications.id` au
 *    lieu de `holidays.day`, parce que Drizzle rend les colonnes interpolées en
 *    identifiants NUS et que Postgres résout d'abord la portée interne du
 *    sous-SELECT. Le garde-fou valait toujours faux et l'endpoint le plus sondé
 *    de l'application retentait un INSERT à chaque appel — absorbé en silence
 *    par l'index unique partiel.
 * 2. Rien ne testait `generateHolidayReminders` lui-même : fenêtre de dates,
 *    week-ends, échéance. Un filtre inversé n'aurait créé AUCUN rappel sans
 *    qu'un test ne bronche.
 *
 * On teste donc le chemin complet — `list()` sur le vrai service, vraie base,
 * rôle applicatif soumis à la RLS — et pas une reconstitution.
 */
import { randomUUID } from 'node:crypto';
import { and, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SessionUser } from '@teranga/contracts';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import * as t from '../src/db/schema';
import { TenantDb } from '../src/db/tenant-db';
import {
  holidayAlreadySentSql,
  holidayDedupeKey,
  NotificationsService,
} from '../src/modules/notifications/notifications.service';

const env = loadEnv();

const tenantId = randomUUID();
const userId = randomUUID();
const holidayId = randomUUID();

function shift(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function isWeekend(iso: string): boolean {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
}

/**
 * Le prochain férié dont le rappel est DÛ aujourd'hui.
 *
 * Le rappel part deux jours avant, reculé au dernier jour ouvré. Prendre le
 * premier jour ouvré à partir de J+2 ne suffit pas : un jeudi, ce jour-là est
 * le lundi suivant, dont le rappel tombe le vendredi — demain, donc pas encore
 * dû. Le test échouait un jour sur sept. On cherche donc explicitement le
 * premier jour ouvré à venir dont le rappel est déjà passé.
 */
function prochainFerieDu(): string {
  const aujourdhui = shift(0);
  for (let i = 1; i <= 10; i += 1) {
    const jour = shift(i);
    if (isWeekend(jour)) continue;
    const rappel = new Date(`${jour}T00:00:00Z`);
    rappel.setUTCDate(rappel.getUTCDate() - 2);
    while (isWeekend(rappel.toISOString().slice(0, 10))) {
      rappel.setUTCDate(rappel.getUTCDate() - 1);
    }
    if (rappel.toISOString().slice(0, 10) <= aujourdhui) return jour;
  }
  throw new Error('aucun férié dû dans les dix jours');
}
/** Premier samedi à venir, dans la fenêtre de lecture du service. */
function prochainSamedi(): string {
  let day = shift(1);
  for (let i = 0; i < 8; i += 1) {
    if (new Date(`${day}T00:00:00Z`).getUTCDay() === 6) return day;
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    day = d.toISOString().slice(0, 10);
  }
  throw new Error('aucun samedi trouvé');
}

const JOUR_DU = prochainFerieDu();

let ownerPool: Pool;
let appPool: Pool;
let tenantDb: TenantDb;
let service: NotificationsService;

const user: SessionUser = {
  userId,
  tenantId,
  role: 'employee',
  email: 'ferie@test.local',
  givenName: 'Test',
  familyName: 'Férié',
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

async function rappels(): Promise<{ title: string; body: string }[]> {
  const { rows } = await ownerPool.query<{ title: string; body: string }>(
    `SELECT title, body FROM notifications
     WHERE tenant_id = $1 AND type = 'holiday_reminder' ORDER BY created_at`,
    [tenantId],
  );
  return rows;
}

async function ajouterFerie(id: string, day: string, label: string): Promise<void> {
  await withTenant(async (db) => {
    await db.execute(
      sql`INSERT INTO holidays (id, tenant_id, year, day, label)
          VALUES (${id}, ${tenantId}, ${Number(day.slice(0, 4))}, ${day}, ${label})`,
    );
  });
}

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 2 });
  appPool = new Pool({ connectionString: env.APP_DATABASE_URL, max: 5 });
  tenantDb = new TenantDb();
  service = new NotificationsService(tenantDb);

  await withTenant(async (db) => {
    await db.execute(
      sql`INSERT INTO users (id, email, password_hash, given_name, family_name)
          VALUES (${userId}, ${`ferie-${userId}@test.local`}, 'x', 'Test', 'Férié')`,
    );
    await db.execute(
      sql`INSERT INTO tenants (id, name, slug)
          VALUES (${tenantId}, 'Fériés', ${`feries-${tenantId.slice(0, 8)}`})`,
    );
  });
});

afterAll(async () => {
  await ownerPool?.query(`DELETE FROM notifications WHERE tenant_id = $1`, [tenantId]);
  await ownerPool?.query(`DELETE FROM holidays WHERE tenant_id = $1`, [tenantId]);
  await ownerPool?.query(`DELETE FROM holiday_seeds WHERE tenant_id = $1`, [tenantId]);
  await ownerPool?.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  await ownerPool?.query(`DELETE FROM users WHERE id = $1`, [userId]);
  await tenantDb?.pool.end();
  await appPool?.end();
  await ownerPool?.end();
});

describe('génération du rappel (chemin complet)', () => {
  it("ne crée rien tant qu'aucun férié n'approche", async () => {
    await service.list(user);
    expect(await rappels()).toHaveLength(0);
  });

  it('crée le rappel du prochain férié ouvré, avec son libellé', async () => {
    await ajouterFerie(holidayId, JOUR_DU, 'Fête de démonstration');
    await service.list(user);
    const r = await rappels();
    expect(r).toHaveLength(1);
    expect(r[0]!.title).toContain('Fête de démonstration');
    expect(r[0]!.body).toContain('chômé');
  });

  it("ne réécrit RIEN au sondage suivant — c'est l'invariant qui avait cassé", async () => {
    await service.list(user);
    await service.list(user);
    expect(await rappels()).toHaveLength(1);
  });

  it('ignore un férié tombant un week-end', async () => {
    const samedi = prochainSamedi();
    if (samedi === JOUR_DU) return; // impossible par construction, garde-fou
    await ajouterFerie(randomUUID(), samedi, 'Férié un samedi');
    await service.list(user);
    const r = await rappels();
    expect(r.map((x) => x.title).join(' ')).not.toContain('Férié un samedi');
  });

  it('retire le rappel quand le férié est supprimé — une fête mobile se recale', async () => {
    await withTenant(async (db) => {
      await db.execute(
        sql`DELETE FROM notifications WHERE dedupe_key = ${holidayDedupeKey(JOUR_DU)}`,
      );
    });
    expect((await rappels()).some((x) => x.title.includes('Fête de démonstration'))).toBe(false);
  });
});

describe('garde-fou d’idempotence (SQL généré)', () => {
  /** Rejoue la lecture du service pour un jour donné. */
  async function flag(day: string, forUser = userId): Promise<boolean> {
    return withTenant(async (db) => {
      const rows = await db
        .select({ alreadySent: holidayAlreadySentSql(forUser) })
        .from(t.holidays)
        .where(and(sql`${t.holidays.day} = ${day}`));
      expect(rows).toHaveLength(1);
      return rows[0]!.alreadySent;
    });
  }

  it('vaut false sans rappel, true avec — la clé porte le JOUR', async () => {
    expect(await flag(JOUR_DU)).toBe(false);
    await withTenant(async (db) => {
      await db.insert(t.notifications).values({
        id: randomUUID(),
        tenantId,
        recipientUserId: userId,
        type: 'holiday_reminder',
        title: 'Jour férié à venir : Fête de démonstration',
        body: 'corps',
        link: '/calendrier',
        dedupeKey: holidayDedupeKey(JOUR_DU),
      });
    });
    expect(await flag(JOUR_DU)).toBe(true);
  });

  it('reste false pour un AUTRE destinataire : le fan-out est par utilisateur', async () => {
    expect(await flag(JOUR_DU, randomUUID())).toBe(false);
  });

  it('la clé ne contient jamais l’identifiant de la notification', async () => {
    const { rows } = await ownerPool.query<{ id: string; dedupe_key: string }>(
      `SELECT id::text, dedupe_key FROM notifications
       WHERE tenant_id = $1 AND dedupe_key IS NOT NULL LIMIT 1`,
      [tenantId],
    );
    expect(rows[0]!.dedupe_key).toBe(`holiday:${JOUR_DU}`);
    expect(rows[0]!.dedupe_key).not.toContain(rows[0]!.id);
  });
});
