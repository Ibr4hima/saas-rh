/**
 * Une boîte par espace — contre un vrai Postgres, rôle applicatif soumis à la
 * RLS.
 *
 * Décision APIX : « l'espace perso a ses notifs, l'espace RH a ses notifs ».
 * Une notification va à l'espace de la page où elle mène (un congé approuvé
 * mène à « Mes congés » : Mon espace ; une demande à traiter mène à la
 * gestion : Gestion RH) ; celle qui mène à une page commune — un jour férié,
 * vers le calendrier — va aux deux.
 *
 * Deux choses à garder :
 * 1. Le filtre SQL dit la même chose que la règle des contrats, lien par lien.
 * 2. Tout lire, tout ranger ne touchent que la boîte de l'espace où l'on est :
 *    vider sa boîte de gestion ne doit pas faire disparaître, sans qu'on l'ait
 *    vu, l'avis de son propre congé.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { espaceDeLaNotification, type SessionUser } from '@teranga/contracts';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import {
  espaceDeLaNotificationSql,
  NotificationsService,
} from '../src/modules/notifications/notifications.service';

const env = loadEnv();

const tenantId = randomUUID();
const userId = randomUUID();

let ownerPool: Pool;
let appPool: Pool;
let tenantDb: TenantDb;
let service: NotificationsService;

const user: SessionUser = {
  userId,
  tenantId,
  role: 'employee',
  email: 'espaces@test.local',
  givenName: 'Test',
  familyName: 'Espaces',
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

/** Pose une notification non lue et rend son identifiant. */
async function poser(type: string, link: string | null) {
  const id = randomUUID();
  await withTenant((db) =>
    db.execute(
      sql`INSERT INTO notifications (id, tenant_id, recipient_user_id, type, title, link)
          VALUES (${id}, ${tenantId}, ${userId}, ${type}, ${`${type} ${link}`}, ${link})`,
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

async function viderLaBoite() {
  await ownerPool.query(`DELETE FROM notifications WHERE tenant_id = $1`, [tenantId]);
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
          VALUES (${userId}, ${`espaces-${userId}@test.local`}, 'x', 'Test', 'Espaces')`,
    );
    await db.execute(
      sql`INSERT INTO tenants (id, name, slug)
          VALUES (${tenantId}, 'Espaces', ${`espaces-${tenantId.slice(0, 8)}`})`,
    );
  });
});

afterAll(async () => {
  await ownerPool?.query(`DELETE FROM notifications WHERE tenant_id = $1`, [tenantId]);
  await ownerPool?.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  await ownerPool?.query(`DELETE FROM users WHERE id = $1`, [userId]);
  await tenantDb?.pool.end();
  await appPool?.end();
  await ownerPool?.end();
});

describe('la règle SQL dit la même chose que celle des contrats', () => {
  const LIENS = [
    null,
    '',
    '/moi',
    '/moi/conges',
    '/moi/equipe',
    '/moi/documents',
    '/moi/informations',
    '/moi?onglet=conges',
    '/moi/dch',
    '/moi/dch#demande',
    '/moi/delegations',
    '/moindre',
    '/documents',
    '/documents?statut=en_attente',
    '/demandes/informations',
    '/demandes/pieces',
    '/employees',
    '/employees/abc',
    '/contrats',
    '/absences/feries',
    '/recrutement/candidatures',
    '/calendrier',
    '/calendrier?annee=2026',
    '/organisation',
    '/organisation?unite=abc',
    '/academy',
    '/academy/formations/abc',
    '/academy/gerer',
    '/academy/gerer/abc',
    '/academyx',
    '/reglementations',
    '/reglementations/code-du-travail',
    '/reglementations/deposer',
    '/reglementations/code-du-travail/deposer',
    '/reglementations/code-du-travail/deposer?x=1',
    '/reglementations/xdeposer',
  ];
  const TYPES = [
    'holiday_reminder',
    'conge_a_viser',
    'delegation',
    'delegation_rompue',
    'dch_vacante',
  ];

  it('lien par lien, type par type', async () => {
    const ecarts: string[] = [];
    for (const link of LIENS) {
      for (const type of TYPES) {
        const lien = link === null ? sql`NULL::text` : sql`${link}::text`;
        const { rows } = await drizzle(ownerPool).execute<{ espace: string | null }>(
          sql`SELECT ${espaceDeLaNotificationSql(lien, sql`${type}::text`)} AS espace`,
        );
        const attendu = espaceDeLaNotification({ type, link });
        if (rows[0]!.espace !== attendu) {
          ecarts.push(`${type} → ${link} : SQL ${rows[0]!.espace}, contrats ${attendu}`);
        }
      }
    }
    expect(ecarts).toEqual([]);
  });

  it('range comme prévu les avis de chaque jour', () => {
    const ou = (type: string, link: string | null) => espaceDeLaNotification({ type, link });
    // Mon espace : ce qui arrive à l'agent lui-même, ce qu'il vise pour son équipe.
    expect(ou('conge_a_viser', '/moi/conges')).toBe('agent');
    expect(ou('conge_a_viser', '/moi/equipe')).toBe('agent');
    expect(ou('document_reviewed', '/moi/documents')).toBe('agent');
    // Gestion RH : ce qu'on traite pour les autres.
    expect(ou('conge_a_viser', '/moi/dch')).toBe('gestion');
    expect(ou('demande_a_traiter', '/documents')).toBe('gestion');
    expect(ou('contract_deadline', '/contrats')).toBe('gestion');
    expect(ou('delegation', '/moi/delegations')).toBe('gestion');
    expect(ou('delegation', '/organisation')).toBe('gestion');
    expect(ou('delegation', null)).toBe('gestion');
    // Les deux : un jour férié.
    expect(ou('holiday_reminder', '/calendrier')).toBeNull();
  });
});

describe('une boîte par espace', () => {
  async function poserLesTrois() {
    return {
      agent: await poser('conge_a_viser', '/moi/conges'),
      gestion: await poser('demande_a_traiter', '/documents'),
      habilitation: await poser('delegation', null),
      ferie: await poser('holiday_reminder', '/calendrier'),
    };
  }
  const ids = (page: { items: { id: string }[] }) => page.items.map((i) => i.id).sort();

  it('Mon espace : ses avis et les fériés ; Gestion RH : les siens et les fériés', async () => {
    await viderLaBoite();
    const n = await poserLesTrois();

    const perso = await service.list(user, 'inbox', 'agent');
    expect(ids(perso)).toEqual([n.agent, n.ferie].sort());
    expect(perso.unreadCount).toBe(2);

    const rh = await service.list(user, 'inbox', 'gestion');
    expect(ids(rh)).toEqual([n.gestion, n.habilitation, n.ferie].sort());
    expect(rh.unreadCount).toBe(3);

    // Qui n'a qu'un espace voit toute sa boîte.
    const tout = await service.list(user, 'inbox');
    expect(ids(tout)).toEqual(Object.values(n).sort());
    expect(tout.unreadCount).toBe(4);
  });

  it('« tout marquer lu » ne lit que la boîte de l’espace', async () => {
    await viderLaBoite();
    const n = await poserLesTrois();
    await service.markAllRead(user, 'agent');
    expect((await etat(n.agent)).read_at).not.toBeNull();
    expect((await etat(n.ferie)).read_at).not.toBeNull();
    expect((await etat(n.gestion)).read_at).toBeNull();
    expect((await etat(n.habilitation)).read_at).toBeNull();
    expect((await service.list(user, 'inbox', 'gestion')).unreadCount).toBe(2);
  });

  it('« tout archiver » ne range que la boîte de l’espace', async () => {
    await viderLaBoite();
    const n = await poserLesTrois();
    await service.archiveAll(user, 'gestion');
    expect((await etat(n.gestion)).archived_at).not.toBeNull();
    expect((await etat(n.habilitation)).archived_at).not.toBeNull();
    expect((await etat(n.ferie)).archived_at).not.toBeNull();
    expect((await etat(n.agent)).archived_at).toBeNull();

    // Les archives aussi se lisent par espace.
    expect(ids(await service.list(user, 'archive', 'agent'))).toEqual([n.ferie]);
    expect((await service.list(user, 'inbox', 'agent')).archivedCount).toBe(1);
    expect(ids(await service.list(user, 'inbox', 'agent'))).toEqual([n.agent]);
  });
});
