/**
 * Les notifications réglées par chacun : sujet par sujet, la plateforme, le
 * courriel, WhatsApp.
 *
 * Ce qui compte : sans réglage, rien ne change (plateforme et courriel) ;
 * chaque canal décoché se tient ; un sujet ne s'offre qu'à qui peut le
 * recevoir ; WhatsApp ne part que vers un numéro prouvé par un code ; un
 * message WhatsApp attend les heures ouvrées, dit des mots neutres quand le
 * sujet peut porter un motif, et ne part plus s'il n'a plus lieu d'être (lu,
 * décoché, numéro retiré) ; en congé, qui l'a voulu n'est dérangé ni par
 * courriel ni par WhatsApp.
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  creneauWhatsApp,
  numeroMasque,
  numeroWhatsApp,
  type ProfilDeNotification,
  type SessionUser,
  sujetsDe,
  texteWhatsApp,
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
import { ExpediteurWhatsApp } from '../src/modules/whatsapp/expediteur';
import type { MessageWhatsApp, TransportWhatsApp } from '../src/modules/whatsapp/transports';

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
let whatsapp: TransportWhatsAppDeTest;
let expediteurCourriels: ExpediteurCourriels;
let expediteurWhatsApp: ExpediteurWhatsApp;
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

class TransportWhatsAppDeTest implements TransportWhatsApp {
  readonly nom = 'test';
  envoyes: MessageWhatsApp[] = [];
  async envoyer(m: MessageWhatsApp): Promise<void> {
    this.envoyes.push(m);
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

const toutPart = async () => {
  await expediteurCourriels.envoyerCeQuiAttend();
  await expediteurWhatsApp.envoyerCeQuiAttend();
};

/** Le numéro d'Awa, prouvé par le code reçu sur WhatsApp. */
async function verifierLeNumero(saisie = '77 123 45 67') {
  await reglages.demanderCode(awa, saisie);
  await expediteurWhatsApp.envoyerCeQuiAttend();
  const message = whatsapp.envoyes.at(-1);
  if (message?.modele !== 'code') throw new Error('Aucun code parti');
  await reglages.verifierCode(awa, message.code);
  whatsapp.envoyes = [];
}

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
    'outbound_whatsapp',
    'whatsapp_verifications',
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
  whatsapp = new TransportWhatsAppDeTest();
  expediteurCourriels = new ExpediteurCourriels(
    db,
    enc,
    courriels,
    'Capital Humain <rh@apix.test>',
    'http://localhost:3002',
    async () => null,
  );
  expediteurWhatsApp = new ExpediteurWhatsApp(db, enc, whatsapp);
  expediteurCourriels.brancher();
  expediteurWhatsApp.brancher();
  reglages = new NotificationsReglagesService(db, enc, expediteurWhatsApp);
});

afterEach(async () => {
  await expediteurCourriels.onModuleDestroy();
  await expediteurWhatsApp.onModuleDestroy();
});

afterAll(async () => {
  for (const table of [
    'outbound_whatsapp',
    'whatsapp_verifications',
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

describe('le numéro WhatsApp', () => {
  it('se saisit comme on le dit, se garde au format international', () => {
    expect(numeroWhatsApp('77 123 45 67')).toBe('+221771234567');
    expect(numeroWhatsApp('00221 78 123 45 67')).toBe('+221781234567');
    expect(numeroWhatsApp('+33 6 12 34 56 78')).toBe('+33612345678');
    expect(numeroMasque('+221771234567')).toBe('+221 77 ••• •• 67');
  });

  it('refuse ce qui ne reçoit pas WhatsApp : un fixe, un numéro trop court', () => {
    expect(numeroWhatsApp('33 821 00 00')).toBeNull();
    expect(numeroWhatsApp('+221 33 821 00 00')).toBeNull();
    expect(numeroWhatsApp('12345')).toBeNull();
  });
});

describe('les heures calmes', () => {
  const a = (iso: string) => new Date(iso);
  const sansFerie = new Set<string>();

  it('un jour ouvré, de 8 h à 19 h : tout de suite', () => {
    const mercredi = a('2026-10-07T10:30:00Z');
    expect(creneauWhatsApp(mercredi, sansFerie)).toBe(mercredi);
  });

  it('le soir : le lendemain à 8 h ; tôt le matin : le jour même à 8 h', () => {
    expect(creneauWhatsApp(a('2026-10-07T20:00:00Z'), sansFerie).toISOString()).toBe(
      '2026-10-08T08:00:00.000Z',
    );
    expect(creneauWhatsApp(a('2026-10-07T06:15:00Z'), sansFerie).toISOString()).toBe(
      '2026-10-07T08:00:00.000Z',
    );
  });

  it('le vendredi soir et le week-end : le lundi, ou le mardi si le lundi est férié', () => {
    expect(creneauWhatsApp(a('2026-10-09T19:00:00Z'), sansFerie).toISOString()).toBe(
      '2026-10-12T08:00:00.000Z',
    );
    expect(creneauWhatsApp(a('2026-10-10T11:00:00Z'), new Set(['2026-10-12'])).toISOString()).toBe(
      '2026-10-13T08:00:00.000Z',
    );
  });
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

  it('sur WhatsApp, un sujet qui peut porter un motif dit des mots neutres', () => {
    expect(texteWhatsApp('dch.conges', 'Moussa Ndiaye demande un congé maladie')).toBe(
      'Une demande de congé attend votre traitement',
    );
    expect(texteWhatsApp('documents', 'Votre attestation de travail est prête')).toBe(
      'Votre attestation de travail est prête',
    );
  });
});

describe('les canaux d’un sujet', () => {
  it('sans réglage : dans la plateforme et par courriel, pas sur WhatsApp', async () => {
    await notifie(comptes.awa);
    await toutPart();
    expect((await boite.list(awa, 'inbox')).items).toHaveLength(1);
    expect(courriels.envoyes).toHaveLength(1);
    expect(whatsapp.envoyes).toHaveLength(0);
    const r = await reglages.lire(awa);
    expect(r.sujets.find((s) => s.sujet === 'conges')).toMatchObject({
      plateforme: true,
      courriel: true,
      whatsapp: false,
    });
  });

  it('par courriel seulement : absente de la plateforme, le courriel part', async () => {
    await reglages.changerSujets(awa, {
      sujets: [{ sujet: 'conges', plateforme: false, courriel: true, whatsapp: false }],
    });
    await notifie(comptes.awa);
    await toutPart();
    expect((await boite.list(awa, 'inbox')).items).toHaveLength(0);
    expect(courriels.envoyes).toHaveLength(1);
  });

  it('tout décoché : rien nulle part, et les autres sujets n’en sont pas touchés', async () => {
    await reglages.changerSujets(awa, {
      sujets: [{ sujet: 'conges', plateforme: false, courriel: false, whatsapp: false }],
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

  it('un sujet qui ne le concerne pas ne se règle pas ; WhatsApp attend un numéro vérifié', async () => {
    expect(
      await codeDe(() =>
        reglages.changerSujets(awa, {
          sujets: [{ sujet: 'dch.conges', plateforme: false, courriel: false, whatsapp: false }],
        }),
      ),
    ).toBe('notifications.sujet_hors_profil');
    expect(
      await codeDe(() =>
        reglages.changerSujets(awa, {
          sujets: [{ sujet: 'conges', plateforme: true, courriel: true, whatsapp: true }],
        }),
      ),
    ).toBe('notifications.whatsapp_non_verifie');
  });

  it('les sujets suivent le profil : le N+1 règle son équipe, l’agent non', async () => {
    const sujetsDuChef = (await reglages.lire(chef)).sujets.map((s) => s.sujet);
    const sujetsDAwa = (await reglages.lire(awa)).sujets.map((s) => s.sujet);
    expect(sujetsDuChef).toContain('equipe.conges');
    expect(sujetsDAwa).not.toContain('equipe.conges');
  });
});

describe('le numéro WhatsApp se prouve par un code', () => {
  it('le mobile du dossier est proposé ; le code part sur WhatsApp, une fois par minute', async () => {
    const avant = await reglages.lire(awa);
    expect(avant.whatsapp.numeroDuDossier).toBe('+221 77 123 45 67');
    const apres = await reglages.demanderCode(awa, '77 123 45 67');
    expect(apres.whatsapp.codeEnvoyeA).toBe('+221 77 ••• •• 67');
    await expediteurWhatsApp.envoyerCeQuiAttend();
    expect(whatsapp.envoyes).toEqual([
      { modele: 'code', to: '+221771234567', code: expect.stringMatching(/^\d{6}$/) },
    ]);
    expect(await codeDe(() => reglages.demanderCode(awa, '77 123 45 67'))).toBe(
      'notifications.code_trop_tot',
    );
    // Parti, le code ne se garde plus, même chiffré.
    const { rows } = await raw(
      `SELECT code_chiffre FROM whatsapp_verifications WHERE user_id = $1`,
      [comptes.awa],
    );
    expect(rows[0].code_chiffre).toBeNull();
  });

  it('un mauvais code compte un essai ; le bon rend le numéro vérifié, chiffré en base', async () => {
    await reglages.demanderCode(awa, '+221 77 123 45 67');
    await expediteurWhatsApp.envoyerCeQuiAttend();
    const bon = (whatsapp.envoyes[0] as { code: string }).code;
    const faux = bon === '000000' ? '111111' : '000000';
    expect(await codeDe(() => reglages.verifierCode(awa, faux))).toBe(
      'notifications.code_incorrect',
    );
    const r = await reglages.verifierCode(awa, bon);
    expect(r.whatsapp.numero).toBe('+221 77 ••• •• 67');
    expect(r.whatsapp.codeEnvoyeA).toBeNull();
    const { rows } = await raw(
      `SELECT whatsapp_numero_chiffre FROM notification_reglages WHERE user_id = $1`,
      [comptes.awa],
    );
    expect(rows[0].whatsapp_numero_chiffre).not.toContain('771234567');
  });

  it('cinq essais, pas un de plus', async () => {
    await reglages.demanderCode(awa, '77 123 45 67');
    await expediteurWhatsApp.envoyerCeQuiAttend();
    const bon = (whatsapp.envoyes[0] as { code: string }).code;
    const faux = bon === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await codeDe(() => reglages.verifierCode(awa, faux));
    expect(await codeDe(() => reglages.verifierCode(awa, bon))).toBe('notifications.code_expire');
  });
});

describe('ce qui part sur WhatsApp', () => {
  beforeEach(async () => {
    await verifierLeNumero();
    await reglages.changerReglages(awa, { heuresCalmes: false });
  });

  it('les sujets cochés seulement, et en mots neutres quand le sujet peut porter un motif', async () => {
    await reglages.changerSujets(awa, {
      sujets: [
        { sujet: 'conges', plateforme: true, courriel: true, whatsapp: true },
        { sujet: 'documents', plateforme: true, courriel: true, whatsapp: true },
      ],
    });
    await notifie(comptes.awa);
    await notifie(comptes.awa, {
      type: 'document_request_ready',
      sujet: 'documents',
      title: 'Votre attestation de travail est prête',
      link: '/moi/documents/suivi',
    });
    await notifie(comptes.awa, {
      type: 'objectif',
      sujet: 'objectifs',
      title: 'Mariama a fixé vos objectifs',
    });
    await toutPart();
    expect(whatsapp.envoyes).toEqual([
      {
        modele: 'notification',
        to: '+221771234567',
        prenom: 'Awa',
        texte: 'Votre demande de congé a du nouveau',
        chemin: 'moi/conges/historique',
      },
      {
        modele: 'notification',
        to: '+221771234567',
        prenom: 'Awa',
        texte: 'Votre attestation de travail est prête',
        chemin: 'moi/documents/suivi',
      },
    ]);
  });

  it('lue dans la plateforme, décochée ou numéro retiré entre-temps : elle ne part pas', async () => {
    await reglages.changerSujets(awa, {
      sujets: [{ sujet: 'conges', plateforme: true, courriel: false, whatsapp: true }],
    });
    await notifie(comptes.awa, { dedupeKey: 'lue' });
    await raw(`UPDATE notifications SET read_at = now() WHERE dedupe_key = 'lue'`);
    await expediteurWhatsApp.envoyerCeQuiAttend();
    expect(whatsapp.envoyes).toHaveLength(0);

    await notifie(comptes.awa, { dedupeKey: 'decochee' });
    await reglages.changerSujets(awa, {
      sujets: [{ sujet: 'conges', plateforme: true, courriel: false, whatsapp: false }],
    });
    await expediteurWhatsApp.envoyerCeQuiAttend();
    expect(whatsapp.envoyes).toHaveLength(0);

    await reglages.changerSujets(awa, {
      sujets: [{ sujet: 'conges', plateforme: true, courriel: false, whatsapp: true }],
    });
    await notifie(comptes.awa, { dedupeKey: 'retire' });
    const r = await reglages.retirerNumero(awa);
    expect(r.whatsapp.numero).toBeNull();
    expect(r.sujets.find((s) => s.sujet === 'conges')?.whatsapp).toBe(false);
    await expediteurWhatsApp.envoyerCeQuiAttend();
    expect(whatsapp.envoyes).toHaveLength(0);
    const { rows } = await raw(
      `SELECT status, count(*)::int AS n FROM outbound_whatsapp
        WHERE tenant_id = $1 AND kind = 'notification' GROUP BY status`,
      [tenantId],
    );
    expect(rows).toEqual([{ status: 'cancelled', n: 3 }]);
  });

  it('avec les heures calmes, le message attend le prochain créneau ouvré', async () => {
    await reglages.changerReglages(awa, { heuresCalmes: true });
    await reglages.changerSujets(awa, {
      sujets: [{ sujet: 'conges', plateforme: true, courriel: true, whatsapp: true }],
    });
    await notifie(comptes.awa);
    const { rows } = await raw(
      `SELECT next_attempt_at FROM outbound_whatsapp WHERE tenant_id = $1 AND kind = 'notification'`,
      [tenantId],
    );
    const prevu = creneauWhatsApp(new Date(), new Set());
    expect(Math.abs(new Date(rows[0].next_attempt_at).getTime() - prevu.getTime())).toBeLessThan(
      5_000,
    );
  });
});

describe('en congé', () => {
  it('avec la pause, ni courriel ni WhatsApp : la notification attend dans la plateforme', async () => {
    await verifierLeNumero();
    await reglages.changerReglages(awa, { heuresCalmes: false, pauseConges: true });
    await reglages.changerSujets(awa, {
      sujets: [{ sujet: 'documents', plateforme: true, courriel: true, whatsapp: true }],
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
    expect(whatsapp.envoyes).toHaveLength(0);
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
    expect(whatsapp.envoyes).toHaveLength(1);
  });
});

describe('un rappel', () => {
  it('suit le sujet de l’appel qu’il rappelle, et ses canaux', async () => {
    await reglages.changerSujets(chef, {
      sujets: [{ sujet: 'equipe.conges', plateforme: true, courriel: false, whatsapp: false }],
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
