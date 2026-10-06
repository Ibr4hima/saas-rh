/**
 * Mot de passe oublié : un lien par courriel, valable une heure, qui sert une
 * fois.
 *
 * Ce qui compte : rien ne dit à qui demande si l'adresse a un compte ; le
 * lien ne part qu'à un compte qui se connecte encore, et ne rouvre jamais un
 * compte fermé ; un nouveau lien remplace l'ancien, dont le courriel ne part
 * plus ; le mot de passe changé ferme toutes les sessions.
 */
import { randomUUID } from 'node:crypto';
import { verify as argonVerify } from '@node-rs/argon2';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EncryptionService } from '../src/common/encryption.service';
import { Limiteur } from '../src/common/limiteur';
import { ProblemException } from '../src/common/problem';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import { AuthController } from '../src/modules/auth/auth.controller';
import { AuthService } from '../src/modules/auth/auth.service';
import { ReinitialisationService } from '../src/modules/auth/reinitialisation.service';
import { ExpediteurCourriels } from '../src/modules/courriels/expediteur';
import type { Courriel, Transport } from '../src/modules/courriels/transports';
import { effacerLesMotsDePasseEchus } from '../src/modules/people/en-activite';

const env = loadEnv();
const tenantId = randomUUID();
const domaine = `oubli-${tenantId.slice(0, 8)}.test.local`;

let ownerPool: Pool;
let db: TenantDb;
const enc = new EncryptionService();

async function raw(q: string, params: unknown[] = []) {
  return ownerPool.query(q, params as never[]);
}

/** Garde les courriels de ce test ; ceux qui attendaient ailleurs dans la base passent outre. */
class TransportDeTest implements Transport {
  readonly nom = 'test';
  envoyes: Courriel[] = [];
  async envoyer(c: Courriel): Promise<void> {
    if (c.to.endsWith(`@${domaine}`)) this.envoyes.push(c);
  }
}

let transport: TransportDeTest;
let expediteur: ExpediteurCourriels;
let service: ReinitialisationService;

/** Un compte de l'organisation, avec son mot de passe, et son dossier s'il en a un. */
async function creerCompte(
  prenom: string,
  o: { dossier?: 'actif' | 'licencie'; motDePasse?: boolean } = {},
): Promise<{ userId: string; email: string; employeeId: string | null }> {
  const userId = randomUUID();
  const email = `${prenom.toLowerCase()}@${domaine}`;
  await raw(
    `INSERT INTO users (id, email, password_hash, given_name, family_name)
     VALUES ($1,$2,$3,$4,'Test')`,
    [userId, email, o.motDePasse === false ? null : 'ancien-haché', prenom],
  );
  await raw(
    `INSERT INTO user_tenant_memberships (id, tenant_id, user_id, role) VALUES ($1,$2,$3,'employee')`,
    [randomUUID(), tenantId, userId],
  );
  if (!o.dossier) return { userId, email, employeeId: null };
  const personId = randomUUID();
  const employeeId = randomUUID();
  await raw(
    `INSERT INTO persons (id, tenant_id, given_name, family_name, user_id) VALUES ($1,$2,$3,'Test',$4)`,
    [personId, tenantId, prenom, userId],
  );
  await raw(
    `INSERT INTO employees (id, tenant_id, person_id, employee_number, hired_on, work_email,
                            status, inactivite_motif, archived_at, fin_activite)
     VALUES ($1,$2,$3,$4, CURRENT_DATE - 400, $5, $6, $7, $8, $9)`,
    o.dossier === 'licencie'
      ? [
          employeeId,
          tenantId,
          personId,
          `O-${prenom.toUpperCase()}`,
          email,
          'archived',
          'licenciement',
          new Date(),
          new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
        ]
      : [
          employeeId,
          tenantId,
          personId,
          `O-${prenom.toUpperCase()}`,
          email,
          'active',
          null,
          null,
          null,
        ],
  );
  return { userId, email, employeeId };
}

const liens = async (userId: string) =>
  (
    await raw(
      `SELECT id, token_hash, used_at, expires_at > now() AS vivant,
              extract(epoch FROM expires_at - created_at)::int AS duree
         FROM password_resets WHERE user_id = $1 ORDER BY created_at`,
      [userId],
    )
  ).rows as Array<{ id: string; used_at: Date | null; vivant: boolean; duree: number }>;

const courriels = async () =>
  (
    await raw(
      `SELECT kind, subject_id, recipient, subject, body_encrypted, status
         FROM outbound_emails WHERE tenant_id = $1 ORDER BY created_at`,
      [tenantId],
    )
  ).rows as Array<{
    kind: string;
    subject_id: string;
    recipient: string;
    subject: string;
    body_encrypted: string | null;
    status: string;
  }>;

/** Le jeton que porte le dernier courriel parti. */
const jetonDuCourriel = (c: Courriel) => /\/reinitialisation\/([A-Za-z0-9_-]+)/.exec(c.text)![1]!;

/** Demande un lien et l'envoie : le jeton reçu dans la boîte. */
async function recevoirUnLien(email: string): Promise<string> {
  await service.demander(email);
  await expediteur.envoyerCeQuiAttend();
  return jetonDuCourriel(transport.envoyes.at(-1)!);
}

async function refus(p: Promise<unknown>): Promise<{ status: number; code: string }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ProblemException) return { status: e.problem.status, code: e.problem.code };
    throw e;
  }
  throw new Error('Aucun refus');
}

async function vider() {
  const { rows } = await raw(`SELECT id FROM users WHERE email LIKE $1`, [`%@${domaine}`]);
  const ids = rows.map((r: { id: string }) => r.id);
  for (const table of ['outbound_emails', 'employees', 'persons', 'audit_log']) {
    await raw(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  }
  await raw(`DELETE FROM user_tenant_memberships WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM sessions WHERE user_id = ANY($1::uuid[])`, [ids]);
  await raw(`DELETE FROM password_resets WHERE user_id = ANY($1::uuid[])`, [ids]);
  await raw(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [ids]);
}

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 3 });
  db = new TenantDb();
  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1,'APIX Test',$2)`, [
    tenantId,
    `oubli-${tenantId.slice(0, 8)}`,
  ]);
});

beforeEach(async () => {
  await vider();
  transport = new TransportDeTest();
  expediteur = new ExpediteurCourriels(
    db,
    enc,
    transport,
    'Capital Humain <rh@apix.test>',
    'http://localhost:3002',
    async () => null,
  );
  service = new ReinitialisationService(db, expediteur);
});

afterEach(async () => {
  await expediteur.onModuleDestroy();
});

afterAll(async () => {
  await vider();
  await raw(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  await db?.pool.end();
  await ownerPool?.end();
});

describe('la demande', () => {
  it('une adresse sans compte ne laisse aucune trace', async () => {
    await service.demander(`personne@${domaine}`);
    expect(await courriels()).toHaveLength(0);
    const { rows } = await raw(
      `SELECT count(*)::int AS n FROM password_resets r JOIN users u ON u.id = r.user_id
        WHERE u.email LIKE $1`,
      [`%@${domaine}`],
    );
    expect(rows[0].n).toBe(0);
  });

  it('le lien part à l’adresse du compte, chiffré, valable une heure', async () => {
    const awa = await creerCompte('Awa', { dossier: 'actif' });
    // L'adresse se reconnaît quelle que soit sa casse.
    await service.demander(awa.email.toUpperCase());

    const [lien] = await liens(awa.userId);
    expect(lien).toMatchObject({ used_at: null, vivant: true, duree: 3600 });
    const [enFile] = await courriels();
    expect(enFile).toMatchObject({
      kind: 'reinitialisation',
      subject_id: lien!.id,
      recipient: awa.email,
      subject: 'APIX Test : votre mot de passe',
      status: 'pending',
    });
    expect(enFile!.body_encrypted).not.toContain('reinitialisation');

    await expediteur.envoyerCeQuiAttend();
    const [parti] = transport.envoyes;
    expect(parti!.to).toBe(awa.email);
    expect(parti!.text).toContain('Bonjour Awa,');
    expect(parti!.text).toContain('Ce lien vous est personnel et vaut une heure.');
    expect(parti!.html).toContain('Mot de passe oublié');
    const jeton = jetonDuCourriel(parti!);
    expect(await service.lien(jeton)).toEqual({ valide: true, email: awa.email });
    expect((await courriels())[0]).toMatchObject({ status: 'sent', body_encrypted: null });
  });

  it('un nouveau lien remplace l’ancien, dont le courriel ne part plus', async () => {
    const awa = await creerCompte('Awa');
    await service.demander(awa.email);
    await service.demander(awa.email);
    await expediteur.envoyerCeQuiAttend();

    expect(transport.envoyes).toHaveLength(1);
    expect((await courriels()).map((c) => c.status)).toEqual(['cancelled', 'sent']);
    const [ancien, nouveau] = await liens(awa.userId);
    expect(ancien!.vivant).toBe(false);
    expect(nouveau!.vivant).toBe(true);
    expect(await service.lien(jetonDuCourriel(transport.envoyes[0]!))).toMatchObject({
      valide: true,
    });
  });

  it('un compte fermé, coupé ou licencié ne reçoit rien', async () => {
    const ferme = await creerCompte('Ferme', { motDePasse: false });
    const coupe = await creerCompte('Coupe');
    await raw(`UPDATE user_tenant_memberships SET acces_coupe_le = now() WHERE user_id = $1`, [
      coupe.userId,
    ]);
    const licencie = await creerCompte('Licencie', { dossier: 'licencie' });

    for (const c of [ferme, coupe, licencie]) await service.demander(c.email);
    expect(await courriels()).toHaveLength(0);
    for (const c of [ferme, coupe, licencie]) expect(await liens(c.userId)).toHaveLength(0);
  });

  it('sans serveur de courrier, rien n’est créé', async () => {
    const awa = await creerCompte('Awa');
    await new ReinitialisationService(
      db,
      new ExpediteurCourriels(db, enc, null, 'rh@apix.test'),
    ).demander(awa.email);
    expect(await liens(awa.userId)).toHaveLength(0);
  });
});

describe('le nouveau mot de passe', () => {
  it('remplace l’ancien, ferme toutes les sessions, et le lien ne sert qu’une fois', async () => {
    const awa = await creerCompte('Awa', { dossier: 'actif' });
    for (let i = 0; i < 2; i += 1) {
      await raw(
        `INSERT INTO sessions (id, user_id, tenant_id, token_hash, expires_at)
         VALUES ($1,$2,$3,$4, now() + interval '1 day')`,
        [randomUUID(), awa.userId, tenantId, randomUUID()],
      );
    }
    const jeton = await recevoirUnLien(awa.email);

    expect(await service.enregistrer(jeton, 'UnNouveauSecret2026!')).toEqual({ email: awa.email });

    const { rows } = await raw(`SELECT password_hash FROM users WHERE id = $1`, [awa.userId]);
    expect(await argonVerify(rows[0].password_hash, 'UnNouveauSecret2026!')).toBe(true);
    const { rows: ouvertes } = await raw(
      `SELECT count(*)::int AS n FROM sessions WHERE user_id = $1 AND revoked_at IS NULL`,
      [awa.userId],
    );
    expect(ouvertes[0].n).toBe(0);
    expect((await liens(awa.userId))[0]!.used_at).not.toBeNull();

    expect(await service.lien(jeton)).toEqual({ valide: false });
    expect(await refus(service.enregistrer(jeton, 'EncoreUnAutre2026!'))).toEqual({
      status: 410,
      code: 'auth.lien_invalide',
    });
    // Le nouveau mot de passe ouvre la session.
    const session = await new AuthService(db).login(
      { email: awa.email, password: 'UnNouveauSecret2026!' },
      {},
    );
    expect(session.user.userId).toBe(awa.userId);
  });

  it('un mot de passe faible ou qui reprend l’adresse est refusé, le lien reste valable', async () => {
    const awa = await creerCompte('Awa');
    const jeton = await recevoirUnLien(awa.email);
    expect(await refus(service.enregistrer(jeton, 'court'))).toMatchObject({
      status: 422,
      code: 'auth.weak_password',
    });
    expect(await refus(service.enregistrer(jeton, 'Awa@Mot2passe!'))).toMatchObject({
      status: 422,
      code: 'auth.password_reprend_l_adresse',
    });
    expect(await service.lien(jeton)).toMatchObject({ valide: true });
  });

  it('un lien expiré ne sert plus', async () => {
    const awa = await creerCompte('Awa');
    const jeton = await recevoirUnLien(awa.email);
    await raw(
      `UPDATE password_resets SET expires_at = now() - interval '1 second'
                WHERE user_id = $1`,
      [awa.userId],
    );
    expect(await service.lien(jeton)).toEqual({ valide: false });
    expect((await refus(service.enregistrer(jeton, 'UnNouveauSecret2026!'))).status).toBe(410);
  });

  it('un lien parti ne rouvre pas un compte fermé ou coupé depuis', async () => {
    const coupe = await creerCompte('Coupe');
    const jetonCoupe = await recevoirUnLien(coupe.email);
    await raw(`UPDATE user_tenant_memberships SET acces_coupe_le = now() WHERE user_id = $1`, [
      coupe.userId,
    ]);
    expect(await service.lien(jetonCoupe)).toEqual({ valide: false });
    expect((await refus(service.enregistrer(jetonCoupe, 'UnNouveauSecret2026!'))).status).toBe(410);

    // Parti depuis plus de trente jours : son mot de passe s'efface au
    // passage de minuit. Le lien reçu avant ne lui en redonne pas un.
    const parti = await creerCompte('Parti', { dossier: 'actif' });
    const jetonParti = await recevoirUnLien(parti.email);
    await raw(
      `UPDATE employees SET status = 'archived', inactivite_motif = 'demission',
              archived_at = now() - interval '40 days', fin_activite = CURRENT_DATE - 40
        WHERE id = $1`,
      [parti.employeeId],
    );
    await db.withTenant({ tenantId }, (tx) => effacerLesMotsDePasseEchus(tx, parti.employeeId!));
    expect((await refus(service.enregistrer(jetonParti, 'UnNouveauSecret2026!'))).status).toBe(410);
    const { rows } = await raw(`SELECT password_hash FROM users WHERE id = $1`, [parti.userId]);
    expect(rows[0].password_hash).toBeNull();
  });
});

describe('la route', () => {
  /** Le contrôleur, avec un service qui note ce qu'on lui demande. */
  function controleur() {
    const demandes: string[] = [];
    const reinit = {
      demander: async (email: string) => void demandes.push(email),
    } as unknown as ReinitialisationService;
    return {
      demandes,
      ctrl: new AuthController(new AuthService(db), new Limiteur(db), reinit),
    };
  }
  const requete = (ip: string) => ({ ip }) as never;
  const reponse = () => ({ setHeader: () => undefined }) as never;

  it('répond pareil pour une adresse connue ou non, puis limite les demandes', async () => {
    const awa = await creerCompte('Awa');
    const { ctrl, demandes } = controleur();
    const ip = `10.${Math.floor(Math.random() * 250)}.1.${Math.floor(Math.random() * 250)}`;

    expect(
      await ctrl.motDePasseOublie({ email: awa.email }, requete(ip), reponse()),
    ).toBeUndefined();
    expect(
      await ctrl.motDePasseOublie({ email: `personne@${domaine}` }, requete(ip), reponse()),
    ).toBeUndefined();

    // Trois liens par heure pour une même adresse : le quatrième attend.
    await ctrl.motDePasseOublie({ email: awa.email }, requete(ip), reponse());
    await ctrl.motDePasseOublie({ email: awa.email }, requete(ip), reponse());
    expect(
      await refus(ctrl.motDePasseOublie({ email: awa.email }, requete(ip), reponse())),
    ).toEqual({ status: 429, code: 'auth.trop_de_demandes' });
    expect(demandes).toEqual([awa.email, `personne@${domaine}`, awa.email, awa.email]);

    await raw(`DELETE FROM rate_limit_counters WHERE bucket IN ('oubli_ip', 'oubli_compte')`);
  });

  it('un jeton mal formé n’ouvre rien', async () => {
    const { ctrl } = controleur();
    expect(await ctrl.lienDeReinitialisation('court')).toEqual({ valide: false });
    expect((await refus(ctrl.reinitialiser('court', { password: 'x' }))).status).toBe(410);
  });
});
