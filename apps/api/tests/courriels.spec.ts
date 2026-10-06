/**
 * Les courriels : la file, l'expéditeur, l'invitation au portail.
 *
 * Ce qui compte : un courriel ne part que si le geste a eu lieu ; son corps
 * (un lien à usage unique) n'est jamais en clair en base, et n'y reste pas
 * après l'envoi ; un serveur qui ne répond pas ne fait rien perdre ; une
 * invitation remplacée ne laisse pas partir l'ancien lien ; l'effacement d'un
 * dossier emporte l'adresse. Toute notification part aussi par courriel, une
 * fois, sauf si elle a été lue ou remplacée avant, ou si l'accès est coupé.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '@teranga/contracts';
import { EncryptionService } from '../src/common/encryption.service';
import { envSchema, loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import { AuthService } from '../src/modules/auth/auth.service';
import { ESSAIS_MAX, ExpediteurCourriels } from '../src/modules/courriels/expediteur';
import { composer } from '../src/modules/courriels/gabarits';
import { sonderLogo } from '../src/modules/courriels/logo';
import {
  type Courriel,
  type Transport,
  TransportGraph,
  TransportSmtp,
  transportDepuisEnv,
} from '../src/modules/courriels/transports';
import { notifier, notifierChacun } from '../src/modules/notifications/notifier';
import { PeopleService } from '../src/modules/people/people.service';
import { InvitationsService } from '../src/modules/portal/invitations.service';

const env = loadEnv();

const tenantId = randomUUID();
const adminUserId = randomUUID();
const admin = { userId: adminUserId, tenantId, role: 'admin' } as SessionUser;

let ownerPool: Pool;
let db: TenantDb;
const enc = new EncryptionService();

async function raw(q: string, params: unknown[] = []) {
  return ownerPool.query(q, params as never[]);
}

/** Un transport qui garde ce qu'on lui confie, ou refuse tant qu'on le lui dit. */
class TransportDeTest implements Transport {
  readonly nom = 'test';
  envoyes: Courriel[] = [];
  panne: string | null = null;
  async envoyer(c: Courriel): Promise<void> {
    if (this.panne) throw new Error(this.panne);
    this.envoyes.push(c);
  }
}

let transport: TransportDeTest;
let expediteur: ExpediteurCourriels;
let invitations: InvitationsService;
let people: PeopleService;

async function creerAgent(prenom: string): Promise<{ employeeId: string; personId: string }> {
  const personId = randomUUID();
  const employeeId = randomUUID();
  await raw(
    `INSERT INTO persons (id, tenant_id, given_name, family_name) VALUES ($1,$2,$3,'Test')`,
    [personId, tenantId, prenom],
  );
  // Le portail s'ouvre avec l'adresse professionnelle : l'invitation y part.
  await raw(
    `INSERT INTO employees (id, tenant_id, person_id, employee_number, hired_on, work_email)
     VALUES ($1,$2,$3,$4, CURRENT_DATE, $5)`,
    [
      employeeId,
      tenantId,
      personId,
      `C-${prenom.toUpperCase()}`,
      `${prenom.toLowerCase()}@courriel.test.local`,
    ],
  );
  return { employeeId, personId };
}

const courriels = async () =>
  (
    await raw(
      `SELECT id, kind, subject_id, recipient, subject, body_encrypted, status, attempts,
              last_error, sent_at, next_attempt_at > now() + interval '30 seconds' AS repousse
         FROM outbound_emails WHERE tenant_id = $1 ORDER BY created_at`,
      [tenantId],
    )
  ).rows as Array<{
    id: string;
    kind: string;
    subject_id: string;
    recipient: string;
    subject: string;
    body_encrypted: string | null;
    status: string;
    attempts: number;
    last_error: string | null;
    sent_at: Date | null;
    repousse: boolean;
  }>;

/** Rend dû tout ce qui attend, comme si le délai était passé. */
const avancerLHorloge = () =>
  raw(`UPDATE outbound_emails SET next_attempt_at = now() WHERE tenant_id = $1`, [tenantId]);

async function vider() {
  const { rows: comptes } = await raw(
    `SELECT user_id FROM persons WHERE tenant_id = $1 AND user_id IS NOT NULL`,
    [tenantId],
  );
  for (const table of [
    'outbound_emails',
    'notifications',
    'invitations',
    'employees',
    'persons',
    'audit_log',
  ]) {
    await raw(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  }
  await raw(`DELETE FROM user_tenant_memberships WHERE tenant_id = $1 AND user_id <> $2`, [
    tenantId,
    adminUserId,
  ]);
  await raw(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [
    comptes.map((c: { user_id: string }) => c.user_id),
  ]);
}

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 3 });
  db = new TenantDb();
  await raw(
    `INSERT INTO users (id, email, password_hash, given_name, family_name)
     VALUES ($1,$2,'x','Test','Admin')`,
    [adminUserId, `courriels-${adminUserId}@test.local`],
  );
  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1,'APIX Test',$2)`, [
    tenantId,
    `courriels-${tenantId.slice(0, 8)}`,
  ]);
  await raw(
    `INSERT INTO user_tenant_memberships (id, tenant_id, user_id, role) VALUES ($1,$2,$3,'admin')`,
    [randomUUID(), tenantId, adminUserId],
  );
});

beforeEach(async () => {
  await vider();
  transport = new TransportDeTest();
  // Sans logo par défaut : le test ne dépend pas du site qui tourne à côté.
  expediteur = new ExpediteurCourriels(
    db,
    enc,
    transport,
    'Capital Humain <rh@apix.test>',
    'http://localhost:3002',
    async () => null,
  );
  invitations = new InvitationsService(db, new AuthService(db), expediteur);
  people = new PeopleService(db, enc, expediteur);
});

// Chaque expéditeur s'arrête avec son test : son envoi différé (`bientot`)
// partirait sinon pendant le suivant, vers le transport d'un autre.
afterEach(async () => {
  await expediteur.onModuleDestroy();
});

afterAll(async () => {
  await vider();
  await raw(`DELETE FROM user_tenant_memberships WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  await raw(`DELETE FROM users WHERE id = $1`, [adminUserId]);
  await db?.pool.end();
  await ownerPool?.end();
});

describe('invitation par courriel', () => {
  it('se met en file chiffrée, part, puis le corps s’efface', async () => {
    const awa = await creerAgent('Awa');
    const r = await invitations.invite(admin, awa.employeeId, 'employee');
    expect(r.courriel).toBe(true);
    const jeton = r.invitePath.split('/').pop()!;

    const [enFile] = await courriels();
    expect(enFile).toMatchObject({
      kind: 'invitation',
      recipient: 'awa@courriel.test.local',
      subject: 'APIX Test : votre accès au portail RH',
      status: 'pending',
      attempts: 0,
    });
    // Le lien ne se lit pas en base : chiffré, et lié à sa ligne.
    expect(enFile!.body_encrypted).toMatch(/^c1:/);
    expect(enFile!.body_encrypted).not.toContain(jeton);
    expect((await people.detail(admin, awa.employeeId)).portal.invitation?.courriel).toBe(
      'en_attente',
    );

    await expediteur.envoyerCeQuiAttend();

    expect(transport.envoyes).toHaveLength(1);
    const parti = transport.envoyes[0]!;
    expect(parti.to).toBe('awa@courriel.test.local');
    expect(parti.from).toBe('Capital Humain <rh@apix.test>');
    expect(parti.text).toContain('Bonjour Awa,');
    expect(parti.text).toContain(`/invitation/${jeton}`);
    expect(parti.html).toContain(`/invitation/${jeton}`);

    const [apres] = await courriels();
    expect(apres).toMatchObject({ status: 'sent', body_encrypted: null, attempts: 1 });
    expect(apres!.sent_at).not.toBeNull();

    const portail = (await people.detail(admin, awa.employeeId)).portal;
    expect(portail.parCourriel).toBe(true);
    expect(portail.invitation).toMatchObject({
      email: 'awa@courriel.test.local',
      courriel: 'envoye',
    });
    expect(portail.invitation?.envoyeLe).not.toBeNull();

    // Un second passage ne renvoie rien.
    await expediteur.envoyerCeQuiAttend();
    expect(transport.envoyes).toHaveLength(1);
  });

  it('serveur injoignable : réessaie plus tard, puis y renonce', async () => {
    const awa = await creerAgent('Awa');
    await invitations.invite(admin, awa.employeeId, 'employee');
    transport.panne = 'connect ECONNREFUSED 127.0.0.1:1025';

    await expediteur.envoyerCeQuiAttend();
    let [c] = await courriels();
    expect(c).toMatchObject({ status: 'pending', attempts: 1, last_error: transport.panne });
    expect(c!.body_encrypted).not.toBeNull();
    expect(c!.repousse).toBe(true);
    // La fiche le dit dès le premier essai manqué.
    expect((await people.detail(admin, awa.employeeId)).portal.invitation?.courriel).toBe('echec');

    // Pas avant l'heure : le passage suivant ne le reprend pas.
    await expediteur.envoyerCeQuiAttend();
    [c] = await courriels();
    expect(c!.attempts).toBe(1);

    for (let i = 2; i <= ESSAIS_MAX; i++) {
      await avancerLHorloge();
      await expediteur.envoyerCeQuiAttend();
    }
    [c] = await courriels();
    expect(c).toMatchObject({ status: 'failed', attempts: ESSAIS_MAX, body_encrypted: null });
    expect(transport.envoyes).toHaveLength(0);
    expect((await people.detail(admin, awa.employeeId)).portal.invitation?.courriel).toBe('echec');
  });

  it('le serveur revenu, le courriel part au passage suivant', async () => {
    const awa = await creerAgent('Awa');
    await invitations.invite(admin, awa.employeeId, 'employee');
    transport.panne = 'timeout';
    await expediteur.envoyerCeQuiAttend();
    transport.panne = null;
    await avancerLHorloge();
    await expediteur.envoyerCeQuiAttend();
    const [c] = await courriels();
    expect(c).toMatchObject({ status: 'sent', attempts: 2, body_encrypted: null });
    expect(transport.envoyes).toHaveLength(1);
  });

  it('une invitation renvoyée avant l’envoi ne laisse partir que le nouveau lien', async () => {
    const awa = await creerAgent('Awa');
    await invitations.invite(admin, awa.employeeId, 'employee');
    const seconde = await invitations.invite(admin, awa.employeeId, 'employee');

    await expediteur.envoyerCeQuiAttend();

    expect(transport.envoyes).toHaveLength(1);
    expect(transport.envoyes[0]!.text).toContain(seconde.invitePath);
    const lignes = await courriels();
    expect(lignes.map((l) => l.status)).toEqual(['cancelled', 'sent']);
    expect(lignes.every((l) => l.body_encrypted === null)).toBe(true);
  });

  it('un dossier archivé avant l’envoi ne reçoit pas son lien', async () => {
    const awa = await creerAgent('Awa');
    await invitations.invite(admin, awa.employeeId, 'employee');
    await people.archive(admin, { ids: [awa.employeeId], archived: true, motif: 'demission' });

    await expediteur.envoyerCeQuiAttend();

    expect(transport.envoyes).toHaveLength(0);
    expect((await courriels())[0]).toMatchObject({ status: 'cancelled', body_encrypted: null });
  });

  it('un geste annulé n’envoie rien', async () => {
    await expect(
      db.withTenant({ tenantId, userId: adminUserId }, async (tx) => {
        await expediteur.mettreEnFile(tx, {
          gabarit: {
            nom: 'invitation',
            prenom: 'Awa',
            organisation: 'APIX Test',
            lien: 'http://localhost/invitation/x',
            expireLe: new Date().toISOString(),
          },
          tenantId,
          kind: 'invitation',
          subjectId: randomUUID(),
          to: 'awa@courriel.test.local',
        });
        throw new Error('geste refusé');
      }),
    ).rejects.toThrow('geste refusé');
    expect(await courriels()).toHaveLength(0);
  });

  it('sans serveur de courrier : rien en file, le lien se transmet à la main', async () => {
    const sansServeur = new ExpediteurCourriels(db, enc, null, 'rh@apix.test');
    const service = new InvitationsService(db, new AuthService(db), sansServeur);
    const awa = await creerAgent('Awa');
    const r = await service.invite(admin, awa.employeeId, 'employee');
    expect(r.courriel).toBe(false);
    expect(r.invitePath).toMatch(/^\/invitation\//);
    expect(await courriels()).toHaveLength(0);
    const portail = (await new PeopleService(db, enc, sansServeur).detail(admin, awa.employeeId))
      .portal;
    expect(portail.parCourriel).toBe(false);
    expect(portail.invitation).toMatchObject({ courriel: null });
  });

  it('l’effacement définitif du dossier emporte ses courriels', async () => {
    const awa = await creerAgent('Awa');
    await invitations.invite(admin, awa.employeeId, 'employee');
    await expediteur.envoyerCeQuiAttend();
    expect(await courriels()).toHaveLength(1);

    const r = await people.remove(admin, { ids: [awa.employeeId] });
    expect(r).toMatchObject({ done: 1, skipped: [] });
    expect(await courriels()).toHaveLength(0);
  });

  it('une autre organisation ne voit pas ces courriels', async () => {
    const awa = await creerAgent('Awa');
    await invitations.invite(admin, awa.employeeId, 'employee');
    const ailleurs = await db.withTenant({ tenantId: randomUUID() }, (tx) =>
      tx.execute(sql`SELECT count(*)::int AS n FROM outbound_emails`),
    );
    expect((ailleurs.rows[0] as { n: number }).n).toBe(0);
  });
});

describe('notifications par courriel', () => {
  /** Un agent qui a son compte sur le portail. */
  async function agentAvecCompte(prenom: string) {
    const agent = await creerAgent(prenom);
    const userId = randomUUID();
    await raw(
      `INSERT INTO users (id, email, password_hash, given_name, family_name)
       VALUES ($1,$2,'x',$3,'Test')`,
      [userId, `${prenom.toLowerCase()}.compte@courriel.test.local`, prenom],
    );
    await raw(
      `INSERT INTO user_tenant_memberships (id, tenant_id, user_id, role)
       VALUES ($1,$2,$3,'employee')`,
      [randomUUID(), tenantId, userId],
    );
    await raw(`UPDATE persons SET user_id = $1 WHERE id = $2`, [userId, agent.personId]);
    return { ...agent, userId };
  }

  const notifie = (userId: string, title: string, extra: Record<string, string> = {}) =>
    db.withTenant({ tenantId, userId: adminUserId }, (tx) =>
      notifier(tx, tenantId, userId, { type: 'test', title, ...extra }),
    );

  beforeEach(() => expediteur.brancher());
  afterEach(() => expediteur.debrancher());

  it('part à l’adresse du compte, composée au départ, sans corps gardé', async () => {
    const awa = await agentAvecCompte('Awa');
    await notifie(awa.userId, 'Votre congé annuel du 2 au 6 mars est approuvé', {
      link: '/moi/conges',
    });

    const [enFile] = await courriels();
    expect(enFile).toMatchObject({
      kind: 'notification',
      recipient: 'awa.compte@courriel.test.local',
      subject: 'Votre congé annuel du 2 au 6 mars est approuvé',
      body_encrypted: null,
      status: 'pending',
    });

    await expediteur.envoyerCeQuiAttend();

    expect(transport.envoyes).toHaveLength(1);
    const parti = transport.envoyes[0]!;
    expect(parti.to).toBe('awa.compte@courriel.test.local');
    expect(parti.subject).toBe('Votre congé annuel du 2 au 6 mars est approuvé');
    expect(parti.text).toContain('Bonjour Awa,');
    expect(parti.text).toContain(`${env.PUBLIC_WEB_URL.replace(/\/$/, '')}/moi/conges`);
    expect(parti.html).toContain('>APIX TEST</div>');
    expect((await courriels())[0]).toMatchObject({ status: 'sent', body_encrypted: null });
  });

  it('une seule fois : la même notification reposée ne repart pas', async () => {
    const awa = await agentAvecCompte('Awa');
    await notifie(awa.userId, 'Rappel', { dedupeKey: 'rappel:1' });
    await notifie(awa.userId, 'Rappel', { dedupeKey: 'rappel:1' });
    expect(await courriels()).toHaveLength(1);
  });

  it('lue, rangée ou remplacée avant l’envoi : elle ne part pas', async () => {
    const awa = await agentAvecCompte('Awa');
    await notifie(awa.userId, 'Lue avant', { dedupeKey: 'a:1' });
    await notifie(awa.userId, 'Rangée avant', { dedupeKey: 'b:1' });
    await notifie(awa.userId, 'Échéance dans 15 jours', { dedupeKey: 'echeance:x:j15' });
    await notifie(awa.userId, 'Échéance aujourd’hui', {
      dedupeKey: 'echeance:x:j0',
      remplace: 'echeance:x:',
    });
    await raw(`UPDATE notifications SET read_at = now() WHERE title = 'Lue avant'`);
    await raw(`UPDATE notifications SET archived_at = now() WHERE title = 'Rangée avant'`);

    await expediteur.envoyerCeQuiAttend();

    expect(transport.envoyes.map((c) => c.subject)).toEqual(['Échéance aujourd’hui']);
    expect((await courriels()).map((c) => c.status)).toEqual([
      'cancelled',
      'cancelled',
      'cancelled',
      'sent',
    ]);
  });

  it('accès coupé : rien ne part', async () => {
    const awa = await agentAvecCompte('Awa');
    await notifie(awa.userId, 'Avant la coupure');
    await raw(`UPDATE user_tenant_memberships SET acces_coupe_le = now() WHERE user_id = $1`, [
      awa.userId,
    ]);
    await notifie(awa.userId, 'Après la coupure');

    await expediteur.envoyerCeQuiAttend();

    expect(transport.envoyes).toHaveLength(0);
    expect((await courriels()).map((c) => c.status)).toEqual(['cancelled']);
  });

  it('sans serveur de courrier, rien en file', async () => {
    const awa = await agentAvecCompte('Awa');
    expediteur.debrancher();
    await notifie(awa.userId, 'Sans serveur');
    expect(await courriels()).toHaveLength(0);
  });

  it('les rappels en nombre partent aussi, une fois chacun', async () => {
    const awa = await agentAvecCompte('Awa');
    const fatou = await agentAvecCompte('Fatou');
    const rappels = [awa, fatou].map((a) => ({
      userId: a.userId,
      type: 'holiday_reminder',
      title: 'Tabaski, férié le lundi 25 mai',
      link: '/calendrier',
      dedupeKey: 'holiday:2026-05-25',
    }));
    for (let i = 0; i < 2; i++) {
      await db.withTenant({ tenantId }, (tx) => notifierChacun(tx, tenantId, rappels));
    }
    await expediteur.envoyerCeQuiAttend();
    expect(transport.envoyes.map((c) => c.to).sort()).toEqual([
      'awa.compte@courriel.test.local',
      'fatou.compte@courriel.test.local',
    ]);
  });

  it('l’effacement définitif emporte ses courriels, et ceux qui le nomment', async () => {
    const awa = await agentAvecCompte('Awa');
    await notifie(awa.userId, 'Votre attestation est prête');
    await notifie(adminUserId, 'Awa Test demande des documents', {
      link: `/employees/${awa.employeeId}`,
    });
    await expediteur.envoyerCeQuiAttend();
    expect(transport.envoyes).toHaveLength(2);

    await people.remove(admin, { ids: [awa.employeeId] });

    const restants = await raw(
      `SELECT recipient, subject FROM outbound_emails
        WHERE recipient = 'awa.compte@courriel.test.local' OR subject LIKE '%Awa Test%'`,
    );
    expect(restants.rows).toEqual([]);
  });

  it('une notification ne naît qu’en un seul endroit, qui la double par courriel', () => {
    const fichiers: string[] = [];
    const parcourir = (dossier: string) => {
      for (const nom of readdirSync(dossier)) {
        const chemin = join(dossier, nom);
        if (statSync(chemin).isDirectory()) parcourir(chemin);
        else if (chemin.endsWith('.ts')) fichiers.push(chemin);
      }
    };
    parcourir(join(__dirname, '../src'));
    const createurs = fichiers.filter((f) =>
      /insert\(t\.notifications\)|INSERT\s+INTO\s+notifications\b/i.test(readFileSync(f, 'utf8')),
    );
    expect(createurs.map((f) => f.slice(f.indexOf('src/')))).toEqual([
      'src/modules/notifications/notifier.ts',
    ]);
  });
});

describe('le gabarit', () => {
  const rendu = { logo: null, portail: 'https://rh.apix.sn/', annee: 2026 };

  it('échappe ce qui vient de la fiche', () => {
    const c = composer(
      {
        nom: 'invitation',
        prenom: '<b>Awa</b>',
        organisation: 'A & B',
        lien: 'https://rh.apix.sn/invitation/abc"def',
        expireLe: '2026-10-13T10:00:00Z',
      },
      rendu,
    );
    expect(c.html).toContain('Bienvenue, &lt;b&gt;Awa&lt;/b&gt;');
    expect(c.html).not.toContain('<b>Awa</b>');
    expect(c.html).toContain('A &amp; B');
    expect(c.html).toContain('abc&quot;def');
    expect(c.text).toContain('13 octobre 2026');
    expect(c.subject).toBe('A & B : votre accès au portail RH');
  });

  it('accueille selon qui revient : un retour, un compte à relier', () => {
    const invitation = (accueil?: 'retour' | 'compte') =>
      composer(
        {
          nom: 'invitation',
          prenom: 'Fatou',
          organisation: 'APIX',
          lien: 'https://rh.apix.sn/invitation/abc',
          expireLe: '2026-10-13T10:00:00Z',
          ...(accueil ? { accueil } : {}),
        },
        rendu,
      );
    expect(invitation().html).toContain('Bienvenue, Fatou');
    expect(invitation('retour').html).toContain('Bon retour, Fatou');
    expect(invitation('retour').html).toContain('vous y retrouvez votre compte');
    expect(invitation('retour').text).toContain('Pour choisir votre nouveau mot de passe');
    expect(invitation('compte').html).toContain('Relier mon compte');
    expect(invitation('compte').html).not.toContain('Choisir mon mot de passe');
  });

  it('porte l’habit de l’écran de connexion : Google Sans du site, le nom à défaut de logo', () => {
    const c = composer(
      {
        nom: 'notification',
        prenom: 'Mariama',
        organisation: 'APIX',
        titre: 'Hawa Ba demande son contrat de travail',
        lien: 'https://rh.apix.sn/documents',
      },
      rendu,
    );
    expect(c.subject).toBe('Hawa Ba demande son contrat de travail');
    expect(c.html).toContain("url('https://rh.apix.sn/fonts/google-sans-latin.woff2')");
    expect(c.html).toContain('>Direction du Capital Humain</td>');
    expect(c.html).toContain(
      'Copiez ce <a href="https://rh.apix.sn/documents" target="_blank" style="color:#004f91;font-weight:700;text-decoration:none">lien</a>.',
    );
    expect(c.html).toContain('>APIX</div>');
    expect(c.html).not.toContain('cid:');
    expect(c.html).toContain('Voir sur le portail');
    expect(c.html).toContain('© 2026 APIX S.A · DCH. Tous droits réservés.');
    expect(c.html).not.toContain('\u2014');
  });
});

describe('le logo', () => {
  /** L'en-tête d'un PNG de 264 × 88 : le logo, deux fois plus fin que son affichage. */
  const png = () => {
    const b = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
    b.writeUInt32BE(13, 8);
    b.write('IHDR', 12, 'ascii');
    b.writeUInt32BE(264, 16);
    b.writeUInt32BE(88, 20);
    return b;
  };

  it('se charge du site : son adresse et ses dimensions d’affichage', async () => {
    const appels: string[] = [];
    const faux = (async (url: string) => {
      appels.push(url);
      return new Response(png(), { status: 200, headers: { 'content-type': 'image/png' } });
    }) as unknown as typeof fetch;
    expect(await sonderLogo('https://rh.apix.sn/', faux)).toEqual({
      src: 'https://rh.apix.sn/courriel/logo.png',
      largeur: 132,
      hauteur: 44,
    });
    expect(appels).toEqual(['https://rh.apix.sn/courriel/logo.png']);
  });

  it('absent, ou le site injoignable : le nom de l’organisation', async () => {
    const absent = (async () => new Response(null, { status: 404 })) as unknown as typeof fetch;
    const panne = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    expect(await sonderLogo('https://rh.apix.sn', absent)).toBeNull();
    expect(await sonderLogo('https://rh.apix.sn', panne)).toBeNull();
  });

  it('s’affiche depuis le site, sans aucune pièce jointe', async () => {
    let sondes = 0;
    const avecLogo = new ExpediteurCourriels(
      db,
      enc,
      transport,
      'Capital Humain <rh@apix.test>',
      'http://localhost:3002',
      async () => {
        sondes += 1;
        return { src: 'http://localhost:3002/courriel/logo.png', largeur: 132, hauteur: 44 };
      },
    );
    const service = new InvitationsService(db, new AuthService(db), avecLogo);
    const awa = await creerAgent('Awa');
    const fatou = await creerAgent('Fatou');
    await service.invite(admin, awa.employeeId, 'employee');
    await avecLogo.envoyerCeQuiAttend();
    await service.invite(admin, fatou.employeeId, 'employee');
    await avecLogo.envoyerCeQuiAttend();
    expect(transport.envoyes).toHaveLength(2);
    for (const parti of transport.envoyes) {
      expect(Object.keys(parti).sort()).toEqual(['from', 'html', 'subject', 'text', 'to']);
      expect(parti.html).toContain(
        '<img src="http://localhost:3002/courriel/logo.png" width="132" height="44" alt="APIX Test"',
      );
      expect(parti.html).not.toContain('cid:');
    }
    // Le site n'est interrogé qu'une fois pour les deux.
    expect(sondes).toBe(1);
    await avecLogo.onModuleDestroy();
  });
});

describe('transports', () => {
  const base = envSchema.parse({
    ...process.env,
    NODE_ENV: 'development',
    MAIL_TRANSPORT: undefined,
  });

  it('les tests n’envoient jamais rien ; le développement va à Mailpit ; ailleurs, rien par défaut', () => {
    expect(transportDepuisEnv({ ...base, NODE_ENV: 'test', MAIL_TRANSPORT: 'smtp' })).toBeNull();
    expect(transportDepuisEnv(base)).toBeInstanceOf(TransportSmtp);
    expect(transportDepuisEnv({ ...base, NODE_ENV: 'production' })).toBeNull();
    expect(transportDepuisEnv({ ...base, MAIL_TRANSPORT: 'aucun' })).toBeNull();
  });

  it('Microsoft 365 exige son application complète', () => {
    expect(() =>
      envSchema.parse({ ...process.env, NODE_ENV: 'development', MAIL_TRANSPORT: 'graph' }),
    ).toThrow(/GRAPH_TENANT_ID/);
  });

  it('Microsoft Graph : un jeton d’application, gardé, puis sendMail depuis la boîte RH', async () => {
    const appels: Array<{ url: string; init: RequestInit }> = [];
    let refusSuivant = false;
    const faux = (async (url: string, init: RequestInit) => {
      appels.push({ url, init });
      if (url.includes('/oauth2/v2.0/token')) {
        return new Response(
          JSON.stringify({ access_token: `jeton-${appels.length}`, expires_in: 3600 }),
          {
            status: 200,
          },
        );
      }
      if (refusSuivant) {
        refusSuivant = false;
        return new Response('{"error":{"code":"InvalidAuthenticationToken"}}', { status: 401 });
      }
      return new Response(null, { status: 202 });
    }) as unknown as typeof fetch;

    const graph = new TransportGraph(
      { tenantId: 'apix-tenant', clientId: 'app-id', clientSecret: 's3cret', sender: 'rh@apix.sn' },
      faux,
    );
    const message = {
      from: 'Capital Humain <rh@apix.sn>',
      to: 'awa@apix.sn',
      subject: 'APIX : votre accès au portail RH',
      text: 'texte',
      html: '<p>html</p>',
    };
    await graph.envoyer(message);
    await graph.envoyer(message);

    // Un seul jeton pour deux envois.
    expect(appels.map((a) => new URL(a.url).pathname)).toEqual([
      '/apix-tenant/oauth2/v2.0/token',
      '/v1.0/users/rh%40apix.sn/sendMail',
      '/v1.0/users/rh%40apix.sn/sendMail',
    ]);
    const demande = new URLSearchParams(appels[0]!.init.body as string);
    expect(Object.fromEntries(demande)).toEqual({
      client_id: 'app-id',
      client_secret: 's3cret',
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    });
    const envoi = appels[1]!;
    expect((envoi.init.headers as Record<string, string>).authorization).toBe('Bearer jeton-1');
    expect(JSON.parse(envoi.init.body as string)).toEqual({
      message: {
        subject: 'APIX : votre accès au portail RH',
        body: { contentType: 'HTML', content: '<p>html</p>' },
        toRecipients: [{ emailAddress: { address: 'awa@apix.sn' } }],
      },
      saveToSentItems: false,
    });

    // Jeton révoqué : l'envoi échoue (il réessaiera), et le suivant en redemande un.
    refusSuivant = true;
    await expect(graph.envoyer(message)).rejects.toThrow(/401/);
    await graph.envoyer(message);
    expect(appels.filter((a) => a.url.includes('/token'))).toHaveLength(2);
  });
});
