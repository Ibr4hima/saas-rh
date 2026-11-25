/**
 * Les clés d'accès (ADR-0247), avec la base : créer une clé, session
 * ouverte ; ouvrir une session avec elle, sans code.
 *
 * Ce qui compte : le défi sert une fois, et seulement au compte qui l'a
 * demandé ; une clé inconnue, ou qui ne porte pas son compte, n'ouvre rien ;
 * un compte coupé ne s'ouvre pas, clé ou non ; les clés d'un agent parti
 * depuis plus de trente jours s'effacent.
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '@teranga/contracts';
import { EncryptionService } from '../src/common/encryption.service';
import { ProblemException } from '../src/common/problem';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import { AuthService } from '../src/modules/auth/auth.service';
import { ClesDAccesService } from '../src/modules/auth/cles-d-acces.service';
import { ConnexionParCodeService } from '../src/modules/auth/connexion-par-code.service';
import { effacerLesMotsDePasseEchus } from '../src/modules/people/en-activite';
import { hashToken } from '../src/modules/portal/invitation';
import { Appareil, ORIGINE, RP_ID } from './appareil-de-test';

const env = loadEnv();
const tenantId = randomUUID();
const marque = tenantId.slice(0, 8);
const meta = { ip: '10.0.0.2', userAgent: 'test' };

let ownerPool: Pool;
let db: TenantDb;
let auth: AuthService;
let service: ClesDAccesService;
const enc = new EncryptionService();
/** Les jetons des défis donnés pendant le test : ils s'effacent à la fin. */
const jetons = new Set<string>();

async function raw(q: string, params: unknown[] = []) {
  return ownerPool.query(q, params as never[]);
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

/** Un compte de l'organisation, sa session ouverte. */
async function creerCompte(
  prenom: string,
): Promise<{ userId: string; user: SessionUser; jeton: string }> {
  const userId = randomUUID();
  await raw(
    `INSERT INTO users (id, email, password_hash, given_name, family_name)
     VALUES ($1, $2, NULL, $3, 'Ndiaye')`,
    [userId, `${prenom.toLowerCase()}-${marque}@apix.sn`, prenom],
  );
  await raw(
    `INSERT INTO user_tenant_memberships (id, tenant_id, user_id, role) VALUES ($1,$2,$3,'employee')`,
    [randomUUID(), tenantId, userId],
  );
  const session = await auth.issueSession(userId, tenantId, meta);
  return { userId, user: session.user, jeton: session.token };
}

/** Le dossier du compte, parti depuis tant de jours (une démission). */
async function partir(userId: string, prenom: string, jours: number): Promise<void> {
  const personId = randomUUID();
  await raw(
    `INSERT INTO persons (id, tenant_id, given_name, family_name, user_id)
     VALUES ($1,$2,$3,'Ndiaye',$4)`,
    [personId, tenantId, prenom, userId],
  );
  await raw(
    `INSERT INTO employees (id, tenant_id, person_id, employee_number, hired_on, work_email,
                            status, inactivite_motif, archived_at, fin_activite)
     VALUES ($1,$2,$3,$4, CURRENT_DATE - 900, $5, 'archived', 'demission', now(),
             CURRENT_DATE - $6::int)`,
    [
      randomUUID(),
      tenantId,
      personId,
      `K-${prenom.toUpperCase()}-${marque}`,
      `${prenom.toLowerCase()}-${marque}@apix.sn`,
      jours,
    ],
  );
}

/** Une clé créée sur cet appareil, pour ce compte. */
async function creerUneCle(user: SessionUser, appareil = new Appareil()): Promise<Appareil> {
  const d = await service.optionsDeCreation(user);
  jetons.add(d.jeton);
  await service.creer(d.jeton, user, appareil.creer(d.options.challenge));
  return appareil;
}

/** Un défi de connexion, et sa réponse par l'appareil. */
async function seConnecter(appareil: Appareil, userHandle?: string) {
  const d = await service.optionsDeConnexion();
  jetons.add(d.jeton);
  return service.seConnecter(
    d.jeton,
    appareil.presenter(d.options.challenge, { userHandle: userHandle ?? null }),
    meta,
  );
}

async function vider() {
  const { rows } = await raw(`SELECT id FROM users WHERE email LIKE $1`, [`%-${marque}@apix.sn`]);
  const ids = rows.map((r: { id: string }) => r.id);
  for (const table of ['employees', 'persons', 'audit_log']) {
    await raw(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  }
  await raw(`DELETE FROM user_tenant_memberships WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM sessions WHERE user_id = ANY($1::uuid[])`, [ids]);
  await raw(`DELETE FROM defis_de_cle WHERE jeton_hash = ANY($1::text[])`, [
    [...jetons].map(hashToken),
  ]);
  await raw(`DELETE FROM cles_d_acces WHERE user_id = ANY($1::uuid[])`, [ids]);
  await raw(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [ids]);
  jetons.clear();
}

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 3 });
  db = new TenantDb();
  auth = new AuthService(db);
  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1,'APIX Test',$2)`, [
    tenantId,
    `cles-${marque}`,
  ]);
});

beforeEach(async () => {
  await vider();
  service = new ClesDAccesService(db, enc, auth, new ConnexionParCodeService(db, enc, auth));
  service.site = () => ({ rpId: RP_ID, origines: [ORIGINE] });
});

afterAll(async () => {
  await vider();
  await raw(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  await db?.pool.end();
  await ownerPool?.end();
});

describe('la création d’une clé', () => {
  it('demande une clé sur l’appareil, la personne vérifiée, sans attestation', async () => {
    const { userId, user } = await creerCompte('Awa');
    const d = await service.optionsDeCreation(user);
    jetons.add(d.jeton);
    expect(d.options).toMatchObject({
      rp: { id: 'localhost', name: 'APIX Test' },
      user: { id: service.poignee(userId), name: user.email, displayName: 'Awa Ndiaye' },
      attestation: 'none',
      authenticatorSelection: {
        residentKey: 'required',
        requireResidentKey: true,
        userVerification: 'required',
      },
      excludeCredentials: [],
    });
    expect(d.options.pubKeyCredParams.map((p) => p.alg)).toEqual([-7, -8, -257]);
    // La poignée ne dit rien du compte.
    expect(d.options.user.id).not.toContain(userId);
    expect(Buffer.from(d.options.challenge, 'base64url')).toHaveLength(32);

    const appareil = new Appareil();
    await service.creer(d.jeton, user, appareil.creer(d.options.challenge));
    const { rows } = await raw(
      `SELECT identifiant, algorithme, compteur, transports FROM cles_d_acces WHERE user_id = $1`,
      [userId],
    );
    expect(rows).toEqual([
      {
        identifiant: appareil.identifiant.toString('base64url'),
        algorithme: -7,
        compteur: '10',
        transports: ['internal', 'hybrid'],
      },
    ]);
    // La clé de cet appareil ne s'y crée pas deux fois.
    const encore = await service.optionsDeCreation(user);
    jetons.add(encore.jeton);
    expect(encore.options.excludeCredentials).toEqual([
      {
        type: 'public-key',
        id: appareil.identifiant.toString('base64url'),
        transports: ['internal', 'hybrid'],
      },
    ]);
    expect(
      await refus(service.creer(encore.jeton, user, appareil.creer(encore.options.challenge))),
    ).toEqual({ status: 409, code: 'auth.cle_deja_enregistree' });
  });

  it('le défi sert une fois, et seulement au compte qui l’a demandé', async () => {
    const awa = await creerCompte('Awa');
    const moussa = await creerCompte('Moussa');
    const d = await service.optionsDeCreation(awa.user);
    jetons.add(d.jeton);
    const reponse = new Appareil().creer(d.options.challenge);
    expect(await refus(service.creer(d.jeton, moussa.user, reponse))).toEqual({
      status: 410,
      code: 'auth.cle_expiree',
    });
    // Pris par la tentative, il ne sert plus, même à son compte.
    expect(await refus(service.creer(d.jeton, awa.user, reponse))).toEqual({
      status: 410,
      code: 'auth.cle_expiree',
    });
    expect(await refus(service.creer(undefined, awa.user, reponse))).toEqual({
      status: 410,
      code: 'auth.cle_expiree',
    });
  });

  it('une clé ne se crée que dans le quart d’heure qui suit la connexion (ADR-0288)', async () => {
    const { jeton } = await creerCompte('Awa');
    await expect(service.exigerUneConnexionRecente(jeton)).resolves.toBeUndefined();
    const refusee = { status: 403, code: 'auth.connexion_recente' };
    expect(await refus(service.exigerUneConnexionRecente(undefined))).toEqual(refusee);
    expect(await refus(service.exigerUneConnexionRecente('inconnu'))).toEqual(refusee);
    // Une session restée ouverte sur un poste ne pose pas de clé.
    await raw(
      `UPDATE sessions SET created_at = now() - interval '16 minutes' WHERE token_hash = $1`,
      [hashToken(jeton)],
    );
    expect(await refus(service.exigerUneConnexionRecente(jeton))).toEqual(refusee);
  });

  it('une clé que la vérification refuse ne s’ajoute pas', async () => {
    const { userId, user } = await creerCompte('Awa');
    const d = await service.optionsDeCreation(user);
    jetons.add(d.jeton);
    const reponse = new Appareil().creer(d.options.challenge, { origine: 'https://apix.example' });
    expect(await refus(service.creer(d.jeton, user, reponse))).toEqual({
      status: 400,
      code: 'auth.cle_refusee',
    });
    const { rows } = await raw(`SELECT 1 FROM cles_d_acces WHERE user_id = $1`, [userId]);
    expect(rows).toHaveLength(0);
  });
});

describe('la connexion par clé', () => {
  it('la clé ouvre la session de son compte, sans code', async () => {
    const { userId, user } = await creerCompte('Awa');
    const appareil = await creerUneCle(user);

    const d = await service.optionsDeConnexion();
    jetons.add(d.jeton);
    // Aucune clé nommée : rien ne dit quels comptes existent.
    expect(d.options).toMatchObject({
      rpId: 'localhost',
      userVerification: 'required',
      allowCredentials: [],
    });
    const session = await service.seConnecter(
      d.jeton,
      appareil.presenter(d.options.challenge, { userHandle: service.poignee(userId) }),
      meta,
    );
    expect(session.user).toMatchObject({ userId, tenantId });
    const { rows } = await raw(
      `SELECT compteur, derniere_utilisation IS NOT NULL AS servie FROM cles_d_acces
        WHERE user_id = $1`,
      [userId],
    );
    expect(rows).toEqual([{ compteur: '11', servie: true }]);

    // Rejouée, la même réponse ne trouve plus son défi.
    expect(
      await refus(service.seConnecter(d.jeton, appareil.presenter(d.options.challenge), meta)),
    ).toEqual({ status: 410, code: 'auth.cle_expiree' });
  });

  it('une clé synchronisée, au compteur à 0, ouvre la session chaque fois', async () => {
    const { userId, user } = await creerCompte('Awa');
    const appareil = await creerUneCle(user, new Appareil(-8, { synchronisee: true }));
    expect((await seConnecter(appareil)).user.userId).toBe(userId);
    expect((await seConnecter(appareil)).user.userId).toBe(userId);
  });

  it('une clé inconnue, ou qui ne porte pas son compte, n’ouvre rien', async () => {
    const awa = await creerCompte('Awa');
    const moussa = await creerCompte('Moussa');
    const appareil = await creerUneCle(awa.user);
    expect(await refus(seConnecter(new Appareil()))).toEqual({
      status: 401,
      code: 'auth.cle_inconnue',
    });
    expect(await refus(seConnecter(appareil, service.poignee(moussa.userId)))).toEqual({
      status: 401,
      code: 'auth.cle_refusee',
    });
  });

  it('le défi d’une création ne sert pas à une connexion', async () => {
    const { user } = await creerCompte('Awa');
    const appareil = await creerUneCle(user);
    const d = await service.optionsDeCreation(user);
    jetons.add(d.jeton);
    expect(
      await refus(service.seConnecter(d.jeton, appareil.presenter(d.options.challenge), meta)),
    ).toEqual({ status: 410, code: 'auth.cle_expiree' });
  });

  it('un compte coupé ne s’ouvre pas, clé ou non', async () => {
    const { userId, user } = await creerCompte('Awa');
    const appareil = await creerUneCle(user);
    await raw(
      `UPDATE user_tenant_memberships SET acces_coupe_le = now()
        WHERE user_id = $1 AND tenant_id = $2`,
      [userId, tenantId],
    );
    expect(await refus(seConnecter(appareil))).toEqual({ status: 403, code: 'auth.acces_ferme' });
  });
});

describe('le départ', () => {
  it('parti depuis plus de trente jours, ses clés s’effacent ; avant, elles restent', async () => {
    const parti = await creerCompte('Awa');
    const recent = await creerCompte('Moussa');
    await creerUneCle(parti.user);
    await creerUneCle(recent.user);
    await partir(parti.userId, 'Awa', 40);
    await partir(recent.userId, 'Moussa', 10);
    await db.withTenant({ tenantId }, (tx) => effacerLesMotsDePasseEchus(tx));
    const { rows } = await raw(`SELECT user_id FROM cles_d_acces WHERE user_id = ANY($1::uuid[])`, [
      [parti.userId, recent.userId],
    ]);
    expect(rows.map((r: { user_id: string }) => r.user_id)).toEqual([recent.userId]);
  });
});
