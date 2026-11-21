/**
 * Le fuseau des connexions : CURRENT_DATE est le jour de Dakar, quel que
 * soit le réglage du serveur de base de données.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { FUSEAU_HORAIRE, TenantDb } from '../src/db/tenant-db';

const db = new TenantDb();

afterAll(async () => {
  await db.pool.end();
});

describe('le fuseau de la base', () => {
  it('chaque connexion de l’API est réglée sur Dakar', async () => {
    const { rows } = await db.withTenant({ tenantId: randomUUID() }, (tx) =>
      tx.execute<{ fuseau: string; ecart: string }>(
        sql`SELECT current_setting('TimeZone') AS fuseau,
                   (now() AT TIME ZONE 'UTC')::date - CURRENT_DATE AS ecart`,
      ),
    );
    expect(rows[0]?.fuseau).toBe(FUSEAU_HORAIRE);
    // Dakar est à UTC+0 : le jour de la base est le jour UTC.
    expect(Number(rows[0]?.ecart)).toBe(0);
  });
});
