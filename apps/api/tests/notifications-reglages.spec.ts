/**
 * Les notifications réglées par chacun : sujet par sujet, la plateforme et
 * le courriel (ADR-0074).
 *
 * Ce qui compte : sans réglage, rien ne change (plateforme et courriel) ;
 * chaque canal décoché se tient ; un sujet ne s'offre qu'à qui peut le
 * recevoir ; WhatsApp n'existe plus, ni à la lecture ni à l'écriture ; en
 * congé, qui l'a voulu n'est pas dérangé par courriel.
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  changerReglagesSchema,
  changerSujetsSchema,
  type ProfilDeNotification,
  type SessionUser,
  sujetsDe,
} from '@teranga/contracts';
import { EncryptionService } from '../src/common/encryption.service';
import { ProblemException } from '../src/common/problem';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import { relancer } from '../src/modules/acces/appels';
import { ExpediteurCourriels } from '../src/modules/courriels/expediteur';
import type { Courriel, Transport } from '../src/modules/courriels/transports';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { notifier, type NotificationDraft } from '../src/modules/notifications/notifier';
import { NotificationsReglagesService } from '../src/modules/notifications/reglages.service';

const env = loadEnv();
const tenantId = randomUUID();
const comptes = { awa: randomUUID(), chef: randomUUID() };
const agents = { awa: randomUUID(), chef: randomUUID() };

const session = (userId: string): SessionUser =>
  ({
    userId,
    tenantId,
    role: 'employee',
    capacites: [],
    estAgent: true,
    estDG: false,
    dirigeLaDCH: false,
  }) as unknown as SessionUser;
const awa = session(comptes.awa);
const chef = session(comptes.chef);

let ownerPool: Pool;
let db: TenantDb;
const enc = new EncryptionService();
let courriels: TransportCourrielDeTest;
let expediteurCourriels: ExpediteurCourriels;
let reglages: NotificationsReglagesService;
let boite: NotificationsService;

const raw = (q: string, p: unknown[] = []) => ownerPool.query(q, p as never[]);

class TransportCourrielDeTest implements Transport {
  readonly nom = 'test';
  envoyes: Courriel[] = [];
  async envoyer(c: Courriel): Promise<void> {
    this.envoyes.push(c);
  }
}

async function codeDe(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'AUCUNE ERREUR';
  } catch (e) {
    if (e instanceof ProblemException) return e.problem.code;
    throw e;
  }
}

const notifie = (userId: string, draft: Partial<NotificationDraft> = {}) =>
  db.withTenant({ tenantId }, (tx) =>
    notifier(tx, tenantId, userId, {
      type: 'conge_approuve',
      sujet: 'conges',
      title: 'Votre congé maladie du 10 au 12 mai 2027 est approuvé',
      link: '/moi/conges/historique',
      ...draft,
    }),
  );

const toutPart = () => expediteurCourriels.envoyerCeQuiAttend();

async function agent(
  id: string,
  compte: string,
  prenom: string,
  n1: string | null,
  phone: string | null,
) {
  await raw(
    `INSERT INTO users (id, email, password_hash, given_name, family_name)
     VALUES ($1,$2,'x',$3,'Test')`,
    [compte, `reglages-${compte}@test.local`, prenom],
  );
  await raw(
    `INSERT INTO user_tenant_memberships (id, tenant_id, user_id, role) VALUES ($1,$2,$3,'employee')`,
    [randomUUID(), tenantId, compte],
  );
  const personne = randomUUID();
  await raw(
    `INSERT INTO persons (id, tenant_id, user_id, given_name, family_name, phone)
     VALUES ($1,$2,$3,$4,'Test',$5)`,
    [personne, tenantId, compte, prenom, phone],
  );
  await raw(
    `INSERT INTO employees (id, tenant_id, person_id, employee_number, hired_on, status, manager_employee_id)
     VALUES ($1,$2,$3,$4,'2024-01-01','active',$5)`,
    [id, tenantId, personne, `RG-${id.slice(0, 4)}`, n1],
  );
}

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 3 });
  db = new TenantDb();
  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1,'Réglages',$2)`, [
    tenantId,
    `reglages-${tenantId.slice(0, 8)}`,
  ]);
  await agent(agents.chef, comptes.chef, 'Mariama', null, null);
  await agent(agents.awa, comptes.awa, 'Awa', agents.chef, '77 123 45 67');
  boite = new NotificationsService(db);
});

beforeEach(async () => {
  for (const table of [
    'notification_preferences',
    'notification_reglages',
    'outbound_emails',
    'notifications',
    'absence_requests',
    'absence_types',
  ]) {
    await raw(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  }
  courriels = new TransportCourrielDeTest();
  expediteurCourriels = new ExpediteurCourriels(
    db,
    enc,
    courriels,
    'Capital Humain <rh@apix.test>',
    'http://localhost:3002',
    async () => null,
  );
  expediteurCourriels.brancher();
  reglages = new NotificationsReglagesService(db);
});

afterEach(async () => {
  await expediteurCourriels.onModuleDestroy();
});

afterAll(async () => {
  for (const table of [
    'notification_preferences',
    'notification_reglages',
    'outbound_emails',
    'notifications',
    'absence_requests',
    'absence_types',
  ]) {
    await raw(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  }
  await raw(`UPDATE employees SET manager_employee_id = NULL WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM employees WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM persons WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM user_tenant_memberships WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM audit_log WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  await raw(`DELETE FROM users WHERE id = ANY($1)`, [Object.values(comptes)]);
  await db?.pool.end();
  await ownerPool?.end();
});

describe('les sujets selon le profil', () => {
  const profil = (p: Partial<ProfilDeNotification>): ProfilDeNotification => ({
    role: 'employee',
    capacites: [],
    estAgent: true,
    estDG: false,
    dirigeLaDCH: false,
    aUneEquipe: false,
    ...p,
  });

  it('un agent : ce qui le concerne, sans équipe ni gestion', () => {
    const s = sujetsDe(profil({}));
    expect(s).toContain('conges');
    expect(s).toContain('objectifs');
    expect(s.some((x) => x.startsWith('equipe.') || x.startsWith('dch.'))).toBe(false);
  });

  it('un N+1 : les congés et auto-évaluations de son équipe', () => {
    expect(sujetsDe(profil({ aUneEquipe: true }))).toEqual(
      expect.arrayContaining(['equipe.conges', 'equipe.objectifs']),
    );
  });

  it('un membre de la DCH : ce que ses délégations lui confient, rien de plus', () => {
    const s = sujetsDe(profil({ capacites: ['demandes.conges', 'demandes.pieces.cni'] }));
    expect(s).toEqual(expect.arrayContaining(['dch.conges', 'dch.pieces']));
    expect(s).not.toContain('dch.documents');
    expect(s).not.toContain('dch.delegations');
  });

  it('l’administrateur : les fins de contrat et les demandes sans responsable, pas les demandes', () => {
    const s = sujetsDe(profil({ role: 'admin', estAgent: false }));
    expect(s).toEqual(expect.arrayContaining(['dch.contrats', 'admin.dch', 'feries']));
    expect(s).not.toContain('dch.conges');
    expect(s).not.toContain('conges');
  });

  it('le DG n’a pas d’objectifs à recevoir : il les fixe', () => {
    expect(sujetsDe(profil({ estDG: true }))).not.toContain('objectifs');
  });
});

describe('les canaux d’un sujet', () => {
  it('sans réglage : dans la plateforme et par courriel', async () => {
    await notifie(comptes.awa);
    await toutPart();
    expect((await boite.list(awa, 'inbox')).items).toHaveLength(1);
    expect(courriels.envoyes).toHaveLength(1);
    const r = await reglages.lire(awa);
    expect(r.sujets.find((s) => s.sujet === 'conges')).toMatchObject({
      plateforme: true,
      courriel: true,
    });
  });

  it('WhatsApp n’existe plus : ni lu, ni accepté (ADR-0074)', async () => {
    const r = await reglages.lire(awa);
    expect(Object.keys(r).sort()).toEqual(['pauseConges', 'sujets']);
    expect(Object.keys(r.sujets[0]!).sort()).toEqual([
      'courriel',
      'groupe',
      'icone',
      'libelle',
      'plateforme',
      'sujet',
    ]);
    // Un écran d'avant qui enverrait encore sa case WhatsApp : elle tombe à l'entrée.
    const recu = changerSujetsSchema.parse({
      sujets: [{ sujet: 'conges', plateforme: true, courriel: false, whatsapp: true }],
    });
    expect(recu.sujets).toEqual([{ sujet: 'conges', plateforme: true, courriel: false }]);
    await reglages.changerSujets(awa, recu);
    const { rows } = await raw(
      `SELECT plateforme, courriel FROM notification_preferences WHERE user_id = $1`,
      [comptes.awa],
    );
    expect(rows).toEqual([{ plateforme: true, courriel: false }]);
    // Les heures calmes ne servaient qu'à WhatsApp : elles ne se règlent plus.
    expect(changerReglagesSchema.safeParse({ heuresCalmes: false }).success).toBe(false);
  });

  it('par courriel seulement : absente de la plateforme, le courriel part', async () => {
    await reglages.changerSujets(awa, {
      sujets: [{ sujet: 'conges', plateforme: false, courriel: true }],
    });
    await notifie(comptes.awa);
    await toutPart();
    expect((await boite.list(awa, 'inbox')).items).toHaveLength(0);
    expect(courriels.envoyes).toHaveLength(1);
  });

  it('tout décoché : rien nulle part, et les autres sujets n’en sont pas touchés', async () => {
    await reglages.changerSujets(awa, {
      sujets: [{ sujet: 'conges', plateforme: false, courriel: false }],
    });
    await notifie(comptes.awa);
    await notifie(comptes.awa, {
      type: 'document_request_ready',
      sujet: 'documents',
      title: 'Votre attestation de travail est prête',
    });
    await toutPart();
    const items = (await boite.list(awa, 'inbox')).items;
    expect(items.map((n) => n.title)).toEqual(['Votre attestation de travail est prête']);
    expect(courriels.envoyes.map((c) => c.subject)).toEqual([
      'Votre attestation de travail est prête',
    ]);
  });

  it('un sujet qui ne le concerne pas ne se règle pas', async () => {
    expect(
      await codeDe(() =>
        reglages.changerSujets(awa, {
          sujets: [{ sujet: 'dch.conges', plateforme: false, courriel: false }],
        }),
      ),
    ).toBe('notifications.sujet_hors_profil');
  });

  it('les sujets suivent le profil : le N+1 règle son équipe, l’agent non', async () => {
    const sujetsDuChef = (await reglages.lire(chef)).sujets.map((s) => s.sujet);
    const sujetsDAwa = (await reglages.lire(awa)).sujets.map((s) => s.sujet);
    expect(sujetsDuChef).toContain('equipe.conges');
    expect(sujetsDAwa).not.toContain('equipe.conges');
  });
});

describe('en congé', () => {
  it('avec la pause, pas de courriel : la notification attend dans la plateforme', async () => {
    await reglages.changerReglages(awa, { pauseConges: true });
    await reglages.changerSujets(awa, {
      sujets: [{ sujet: 'documents', plateforme: true, courriel: true }],
    });
    const type = randomUUID();
    await raw(
      `INSERT INTO absence_types (id, tenant_id, name, deducts_balance, allowance_days, frequency)
       VALUES ($1,$2,'Congé annuel',true,30,'annual')`,
      [type, tenantId],
    );
    await raw(
      `INSERT INTO absence_requests (id, tenant_id, employee_id, absence_type_id, start_date, end_date, days_count, status)
       VALUES ($1,$2,$3,$4, CURRENT_DATE - 1, CURRENT_DATE + 3, 4, 'approved')`,
      [randomUUID(), tenantId, agents.awa, type],
    );
    await notifie(comptes.awa, {
      type: 'document_request_ready',
      sujet: 'documents',
      title: 'Votre attestation de travail est prête',
    });
    await toutPart();
    expect(courriels.envoyes).toHaveLength(0);
    expect((await boite.list(awa, 'inbox')).items).toHaveLength(1);

    // Sans la pause, le congé ne change rien.
    await reglages.changerReglages(awa, { pauseConges: false });
    await notifie(comptes.awa, {
      type: 'document_request_ready',
      sujet: 'documents',
      title: 'Votre attestation de salaire est prête',
    });
    await toutPart();
    expect(courriels.envoyes).toHaveLength(1);
  });

  it('quelques heures d’absence ne mettent rien en pause : l’agent est là dans la journée', async () => {
    await reglages.changerReglages(awa, { pauseConges: true });
    await reglages.changerSujets(awa, {
      sujets: [{ sujet: 'documents', plateforme: true, courriel: true }],
    });
    const type = randomUUID();
    await raw(
      `INSERT INTO absence_types (id, tenant_id, name, allows_hours, max_days_per_request)
       VALUES ($1,$2,'Absence ponctuelle',true,3)`,
      [type, tenantId],
    );
    await raw(
      `INSERT INTO absence_requests (id, tenant_id, employee_id, absence_type_id, start_date, end_date,
                                     start_time, end_time, days_count, status)
       VALUES ($1,$2,$3,$4, CURRENT_DATE, CURRENT_DATE, '00:00', '23:59', 1, 'approved')`,
      [randomUUID(), tenantId, agents.awa, type],
    );
    await notifie(comptes.awa, {
      type: 'document_request_ready',
      sujet: 'documents',
      title: 'Votre attestation de travail est prête',
    });
    await toutPart();
    expect(courriels.envoyes).toHaveLength(1);
  });
});

describe('un rappel', () => {
  it('suit le sujet de l’appel qu’il rappelle, et ses canaux', async () => {
    await reglages.changerSujets(chef, {
      sujets: [{ sujet: 'equipe.conges', plateforme: true, courriel: false }],
    });
    await notifie(comptes.chef, {
      type: 'conge_a_viser',
      sujet: 'equipe.conges',
      title: 'Awa Test demande un congé annuel du 10 au 12 mai 2027',
      link: '/moi/equipe',
      dedupeKey: 'conge:x:appel:n1',
    });
    await raw(
      `UPDATE notifications SET created_at = now() - interval '10 days' WHERE dedupe_key = 'conge:x:appel:n1'`,
    );
    await db.withTenant({ tenantId }, (tx) => relancer(tx, tenantId));
    const { rows } = await raw(
      `SELECT sujet FROM notifications WHERE tenant_id = $1 AND dedupe_key = 'conge:x:rappel:n1'`,
      [tenantId],
    );
    expect(rows).toEqual([{ sujet: 'equipe.conges' }]);
    await toutPart();
    expect(courriels.envoyes).toHaveLength(0);
  });
});
