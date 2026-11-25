/**
 * La connexion par code : le nom de famille et l'adresse professionnelle,
 * puis un code de six caractères reçu par courriel (ADR-0204).
 *
 * Ce qui compte : rien ne dit à qui demande si le couple nom et adresse est
 * juste ; le code ne part qu'à un compte qui se connecte encore ; il sert
 * une fois, et le premier qui sert fait tomber les autres ; cinq essais par
 * connexion ; trois codes par quart d'heure pour un même couple.
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { codeSaisi } from '@teranga/contracts';
import { EncryptionService } from '../src/common/encryption.service';
import { Limiteur } from '../src/common/limiteur';
import { ProblemException } from '../src/common/problem';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import { ATTENTE_COOKIE, SESSION_COOKIE } from '../src/modules/auth/auth.constants';
import { AuthService } from '../src/modules/auth/auth.service';
import { ConnexionParCodeController } from '../src/modules/auth/connexion-par-code.controller';
import {
  ConnexionParCodeService,
  masquerEmail,
  nomCompare,
  type Demande,
} from '../src/modules/auth/connexion-par-code.service';
import { ExpediteurCourriels } from '../src/modules/courriels/expediteur';
import type { Courriel, Transport } from '../src/modules/courriels/transports';
import { hashToken } from '../src/modules/portal/invitation';

const env = loadEnv();
const tenantId = randomUUID();
/** La marque des adresses de ce test : toutes en @apix.sn, le domaine imposé. */
const marque = tenantId.slice(0, 8);

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
    if (c.to.includes(`-${marque}@`)) this.envoyes.push(c);
  }
}

let transport: TransportDeTest;
let expediteur: ExpediteurCourriels;
let service: ConnexionParCodeService;
/** Les couples demandés pendant le test : leurs connexions et leurs codes s'effacent à la fin. */
const compteurs = new Set<string>();

/** Un compte de l'organisation, son dossier, et son adresse. */
async function creerCompte(
  prenom: string,
  nom: string,
  o: {
    dossier?: 'actif' | 'licencie';
    motDePasse?: boolean;
    nomDuDossier?: string;
  } = {},
): Promise<{ userId: string; email: string; locale: string }> {
  const userId = randomUUID();
  const locale = `${prenom.toLowerCase()}-${marque}`;
  const email = `${locale}@apix.sn`;
  await raw(
    `INSERT INTO users (id, email, password_hash, given_name, family_name)
     VALUES ($1,$2,$3,$4,$5)`,
    [userId, email, o.motDePasse === false ? null : 'haché', prenom, nom],
  );
  await raw(
    `INSERT INTO user_tenant_memberships (id, tenant_id, user_id, role) VALUES ($1,$2,$3,'employee')`,
    [randomUUID(), tenantId, userId],
  );
  if (!o.dossier) return { userId, email, locale };
  const personId = randomUUID();
  await raw(
    `INSERT INTO persons (id, tenant_id, given_name, family_name, user_id) VALUES ($1,$2,$3,$4,$5)`,
    [personId, tenantId, prenom, o.nomDuDossier ?? nom, userId],
  );
  const licencie = o.dossier === 'licencie';
  await raw(
    `INSERT INTO employees (id, tenant_id, person_id, employee_number, hired_on, work_email,
                            status, inactivite_motif, archived_at, fin_activite)
     VALUES ($1,$2,$3,$4, CURRENT_DATE - 400, $5, $6, $7, $8, $9)`,
    [
      randomUUID(),
      tenantId,
      personId,
      `C-${prenom.toUpperCase()}-${marque}`,
      email,
      licencie ? 'archived' : 'active',
      licencie ? 'licenciement' : null,
      licencie ? new Date() : null,
      licencie ? new Date(Date.now() - 86_400_000).toISOString().slice(0, 10) : null,
    ],
  );
  return { userId, email, locale };
}

/** La connexion en cours derrière un jeton, telle que la base la garde. */
async function attente(jeton: string) {
  const { rows } = await raw(
    `SELECT id, compteur, email_masque, user_id, tenant_id, employee_id, essais
       FROM connexions_en_attente WHERE jeton_hash = $1`,
    [hashToken(jeton)],
  );
  return rows[0] as
    | {
        compteur: string;
        email_masque: string;
        user_id: string | null;
        tenant_id: string | null;
        employee_id: string | null;
        essais: number;
      }
    | undefined;
}

/**
 * Un dossier de l'organisation et son adresse professionnelle, relié à un
 * compte ou non ; parti, si on le dit.
 */
async function creerDossier(
  prenom: string,
  nom: string,
  o: { userId?: string; parti?: boolean; locale?: string } = {},
): Promise<{ email: string; locale: string; personId: string; employeeId: string }> {
  const locale = o.locale ?? `${prenom.toLowerCase()}.dossier-${marque}`;
  const email = `${locale}@apix.sn`;
  const personId = randomUUID();
  const employeeId = randomUUID();
  await raw(
    `INSERT INTO persons (id, tenant_id, given_name, family_name, user_id) VALUES ($1,$2,$3,$4,$5)`,
    [personId, tenantId, prenom, nom, o.userId ?? null],
  );
  await raw(
    `INSERT INTO employees (id, tenant_id, person_id, employee_number, hired_on, work_email,
                            status, inactivite_motif, archived_at, fin_activite)
     VALUES ($1,$2,$3,$4, CURRENT_DATE - 400, $5, $6, $7, $8, $9)`,
    [
      employeeId,
      tenantId,
      personId,
      `D-${employeeId.slice(0, 8)}-${marque}`,
      email,
      o.parti ? 'archived' : 'active',
      o.parti ? 'demission' : null,
      o.parti ? new Date() : null,
      o.parti ? new Date(Date.now() - 40 * 86_400_000).toISOString().slice(0, 10) : null,
    ],
  );
  return { email, locale, personId, employeeId };
}

/** Demande un code, et attend que le travail d'après la réponse soit fait. */
async function demander(nom: string, email: string, precedent?: string): Promise<Demande> {
  const d = await service.demander({ nom, email }, precedent);
  await d.enFond;
  const a = await attente(d.jeton);
  if (a) compteurs.add(a.compteur);
  return d;
}

const codeDe = (c: Courriel) => /Votre code de vérification : ([0-9A-Z]{6})/.exec(c.text)![1]!;

/** Envoie ce qui attend : le code reçu dans la boîte, le dernier arrivé. */
async function recevoir(): Promise<string> {
  await expediteur.envoyerCeQuiAttend();
  return codeDe(transport.envoyes.at(-1)!);
}

/** Les codes de connexion mis en file pour l'organisation de ce test. */
const enFile = async () =>
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

/** Recule les codes d'un couple dans le temps : le délai entre deux envois est passé. */
async function reculer(jeton: string, secondes: number) {
  const a = await attente(jeton);
  await raw(
    `UPDATE codes_de_connexion SET created_at = created_at - make_interval(secs => $2)
      WHERE compteur = $1`,
    [a!.compteur, secondes],
  );
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

const meta = { ip: '10.0.0.1', userAgent: 'test' };

async function vider() {
  const { rows } = await raw(`SELECT id FROM users WHERE email LIKE $1`, [`%-${marque}@apix.sn`]);
  const ids = rows.map((r: { id: string }) => r.id);
  for (const table of ['outbound_emails', 'employees', 'persons', 'audit_log']) {
    await raw(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  }
  await raw(`DELETE FROM user_tenant_memberships WHERE tenant_id = $1`, [tenantId]);
  await raw(`DELETE FROM sessions WHERE user_id = ANY($1::uuid[])`, [ids]);
  await raw(`DELETE FROM connexions_en_attente WHERE compteur = ANY($1::text[])`, [[...compteurs]]);
  await raw(`DELETE FROM codes_de_connexion WHERE compteur = ANY($1::text[])`, [[...compteurs]]);
  await raw(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [ids]);
  compteurs.clear();
}

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  ownerPool = new Pool({ connectionString: env.DATABASE_URL, max: 3 });
  db = new TenantDb();
  await raw(`INSERT INTO tenants (id, name, slug) VALUES ($1,'APIX Test',$2)`, [
    tenantId,
    `code-${marque}`,
  ]);
});

beforeEach(async () => {
  await vider();
  // Les codes faux d'une personne se comptent d'une connexion à l'autre :
  // chaque test repart d'un compteur vide (ADR-0288).
  await raw(`DELETE FROM rate_limit_counters WHERE bucket = 'code_echec_couple'`);
  transport = new TransportDeTest();
  expediteur = new ExpediteurCourriels(
    db,
    enc,
    transport,
    'Capital Humain <rh@apix.test>',
    'http://localhost:3002',
    async () => null,
  );
  // Les envois partent quand le test le dit, pas d'eux-mêmes.
  expediteur.bientot = () => undefined;
  service = new ConnexionParCodeService(db, enc, new AuthService(db), expediteur);
});

afterEach(async () => {
  await expediteur.onModuleDestroy();
});

afterAll(async () => {
  await vider();
  await raw(`DELETE FROM rate_limit_counters WHERE bucket LIKE 'code\\_%'`);
  await raw(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  await db?.pool.end();
  await ownerPool?.end();
});

describe('la saisie', () => {
  it('le nom se compare sans accents, majuscules, espaces, tirets ni apostrophes', () => {
    expect(nomCompare('N’Diaye-Touré')).toBe('NDIAYETOURE');
    expect(nomCompare("n'diaye toure")).toBe(nomCompare('NDIAYE TOURÉ'));
    expect(nomCompare(' - ')).toBe('');
  });

  it('le code saisi se ramène au code envoyé : O se lit 0, I et L se lisent 1', () => {
    expect(codeSaisi(' ab-c o1l ')).toBe('ABC011');
    expect(codeSaisi('7k3m 9q')).toBe('7K3M9Q');
  });

  it('l’adresse se cache à demi', () => {
    expect(masquerEmail('moussa.sarr@apix.sn')).toBe('mo•••••••••@apix.sn');
    expect(masquerEmail('ab@apix.sn')).toBe('ab••@apix.sn');
  });

  it('les deux champs sont requis, et l’adresse est celle de l’APIX', async () => {
    expect(await refus(service.demander({ nom: '', email: 'awa' }))).toEqual({
      status: 400,
      code: 'auth.champs_manquants',
    });
    expect(await refus(service.demander({ nom: "' -", email: 'awa' }))).toEqual({
      status: 400,
      code: 'auth.champs_manquants',
    });
    expect(await refus(service.demander({ nom: 'Diop', email: ' @apix.sn' }))).toEqual({
      status: 400,
      code: 'auth.champs_manquants',
    });
    expect(await refus(service.demander({ nom: 'Diop', email: 'awa@gmail.com' }))).toEqual({
      status: 400,
      code: 'auth.adresse_non_professionnelle',
    });
  });
});

describe('la demande', () => {
  it('un couple juste reçoit son code ; un couple faux, la même réponse et rien d’autre', async () => {
    const awa = await creerCompte('Awa', 'Diop', { dossier: 'actif' });

    const juste = await demander('Diop', awa.locale);
    const mauvaisNom = await demander('Sarr', awa.locale);
    const inconnue = await demander('Diop', `personne-${marque}`);

    expect(juste.attente).toEqual({ email: masquerEmail(awa.email) });
    expect(mauvaisNom.attente).toEqual(juste.attente);
    expect(inconnue.attente).toEqual({ email: masquerEmail(`personne-${marque}@apix.sn`) });

    expect(await attente(juste.jeton)).toMatchObject({ user_id: awa.userId, tenant_id: tenantId });
    expect(await attente(mauvaisNom.jeton)).toMatchObject({ user_id: null, tenant_id: null });
    expect(await attente(inconnue.jeton)).toMatchObject({ user_id: null, tenant_id: null });

    // Un code par demande, mais un seul courriel : celui du couple juste.
    const { rows } = await raw(
      `SELECT count(*)::int AS n FROM codes_de_connexion WHERE compteur = ANY($1::text[])`,
      [[...compteurs]],
    );
    expect(rows[0].n).toBe(3);
    const [courriel] = await enFile();
    expect(await enFile()).toHaveLength(1);
    expect(courriel).toMatchObject({
      kind: 'code_connexion',
      recipient: awa.email,
      subject: 'Votre code de vérification',
      status: 'pending',
    });

    const code = await recevoir();
    const [parti] = transport.envoyes;
    expect(parti!.to).toBe(awa.email);
    expect(parti!.text).toContain('Bonjour Awa,');
    expect(parti!.text).toContain('Ne le communiquez à personne.');
    // Le code est dans le message, ni dans l'objet ni dans l'aperçu ; aucun lien.
    expect(parti!.subject).not.toContain(code);
    expect(parti!.html).toContain(code);
    expect(parti!.html).toContain('Ouvrez ce message pour lire votre code.');
    expect(parti!.html).not.toMatch(/<a\s/);
    expect((await enFile())[0]).toMatchObject({ status: 'sent', body_encrypted: null });
  });

  it('le nom se reconnaît quelle que soit la saisie, celui du compte comme celui du dossier', async () => {
    const awa = await creerCompte('Awa', 'N’Diaye-Touré', { dossier: 'actif' });
    await demander('ndiaye toure', `${awa.locale.toUpperCase()}@APIX.SN`);
    expect(await recevoir()).toMatch(/^[0-9A-Z]{6}$/);

    // Le dossier porte un autre nom que le compte : les deux ouvrent.
    const moussa = await creerCompte('Moussa', 'Sarr', { dossier: 'actif', nomDuDossier: 'Fall' });
    const parLeDossier = await demander('Fall', moussa.locale);
    expect(await attente(parLeDossier.jeton)).toMatchObject({ user_id: moussa.userId });
    const parLeCompte = await demander('Sarr', moussa.locale);
    expect(await attente(parLeCompte.jeton)).toMatchObject({ user_id: moussa.userId });
  });

  it('un compte sans mot de passe reçoit son code ; fermé, coupé ou licencié, rien', async () => {
    const sansMotDePasse = await creerCompte('Awa', 'Diop', {
      dossier: 'actif',
      motDePasse: false,
    });
    await demander('Diop', sansMotDePasse.locale);
    expect(await enFile()).toHaveLength(1);

    const suspendu = await creerCompte('Suspendu', 'Ba');
    await raw(`UPDATE users SET status = 'suspended' WHERE id = $1`, [suspendu.userId]);
    const coupe = await creerCompte('Coupe', 'Ba');
    await raw(`UPDATE user_tenant_memberships SET acces_coupe_le = now() WHERE user_id = $1`, [
      coupe.userId,
    ]);
    const licencie = await creerCompte('Licencie', 'Ba', { dossier: 'licencie' });
    for (const c of [suspendu, coupe, licencie]) {
      const d = await demander('Ba', c.locale);
      expect(await attente(d.jeton)).toMatchObject({ user_id: null });
    }
    expect(await enFile()).toHaveLength(1);
  });

  it('trois codes par quart d’heure pour un même couple, quarante-cinq secondes entre deux', async () => {
    const awa = await creerCompte('Awa', 'Diop', { dossier: 'actif' });
    const d = await demander('Diop', awa.locale);
    const premier = await recevoir();

    expect((await service.renvoyer(d.jeton)).info).toBe('trop_tot');
    // Une nouvelle demande pour le même couple partage le même compteur.
    expect((await demander('DIOP', awa.locale)).attente.info).toBe('trop_tot');

    await reculer(d.jeton, 50);
    const deuxieme = await service.renvoyer(d.jeton);
    await deuxieme.enFond;
    expect(deuxieme.info).toBe('renvoye');
    await reculer(d.jeton, 50);
    const troisieme = await service.renvoyer(d.jeton);
    await troisieme.enFond;
    expect(troisieme.info).toBe('renvoye');
    await reculer(d.jeton, 50);
    expect((await service.renvoyer(d.jeton)).info).toBe('quota');

    await expediteur.envoyerCeQuiAttend();
    // Le deuxième code, remplacé par le troisième avant de partir, ne part
    // plus : seuls le premier, déjà reçu, et le dernier sont envoyés.
    expect(transport.envoyes).toHaveLength(2);
    // Seul le dernier code reçu sert : les précédents sont tombés (ADR-0288).
    expect((await refus(service.verifier(d.jeton, premier, meta))).code).toBe(
      'auth.code_incorrect',
    );
    const dernier = codeDe(transport.envoyes.at(-1)!);
    const session = await service.verifier(d.jeton, dernier, meta);
    expect(session.user.userId).toBe(awa.userId);
  });

  it('un couple faux redemande comme un juste, et rien ne part', async () => {
    await creerCompte('Awa', 'Diop', { dossier: 'actif' });
    const d = await demander('Sarr', `awa-${marque}`);
    await reculer(d.jeton, 50);
    const r = await service.renvoyer(d.jeton);
    await r.enFond;
    expect(r.info).toBe('renvoye');
    expect(await enFile()).toHaveLength(0);
  });
});

describe('le code', () => {
  it('ouvre la session une fois ; tous les codes de la personne tombent', async () => {
    const awa = await creerCompte('Awa', 'Diop', { dossier: 'actif' });
    const d = await demander('Diop', awa.locale);
    const code = await recevoir();
    expect(await service.etat(d.jeton)).toEqual({
      enAttente: true,
      email: masquerEmail(awa.email),
    });

    // Saisi en minuscules, avec des espaces : il passe.
    const saisie = `${code.slice(0, 3)} ${code.slice(3)}`.toLowerCase();
    const session = await service.verifier(d.jeton, saisie, meta);
    expect(session.user).toMatchObject({ userId: awa.userId, tenantId });
    expect(await attente(d.jeton)).toBeUndefined();
    expect(await service.etat(d.jeton)).toEqual({ enAttente: false });
    const { rows } = await raw(
      `SELECT count(*)::int AS n FROM codes_de_connexion
        WHERE compteur = ANY($1::text[]) AND used_at IS NULL`,
      [[...compteurs]],
    );
    expect(rows[0].n).toBe(0);

    // La connexion terminée, le même code ne rouvre rien.
    expect(await refus(service.verifier(d.jeton, code, meta))).toEqual({
      status: 410,
      code: 'auth.connexion_expiree',
    });
    // Une nouvelle connexion : celui qui a servi ne vaut plus, et un nouveau
    // code part aussitôt (une connexion réussie remet le compteur à zéro).
    const encore = await demander('Diop', awa.locale);
    expect(encore.attente.info).toBeUndefined();
    expect(await refus(service.verifier(encore.jeton, code, meta))).toEqual({
      status: 400,
      code: 'auth.code_incorrect',
    });
    const nouveau = await recevoir();
    expect(nouveau).not.toBe(code);
    expect((await service.verifier(encore.jeton, nouveau, meta)).user.userId).toBe(awa.userId);
  });

  it('un code reçu pour une connexion sert à une autre de la même personne', async () => {
    const awa = await creerCompte('Awa', 'Diop', { dossier: 'actif' });
    await demander('Diop', awa.locale);
    const code = await recevoir();
    const ailleurs = await demander('diop', awa.locale);
    expect(ailleurs.attente.info).toBe('trop_tot');
    expect((await service.verifier(ailleurs.jeton, code, meta)).user.userId).toBe(awa.userId);
  });

  it('cinq essais par connexion, puis on reprend depuis le début', async () => {
    const awa = await creerCompte('Awa', 'Diop', { dossier: 'actif' });
    const d = await demander('Diop', awa.locale);
    const code = await recevoir();
    const faux = code.startsWith('2') ? '3ZZZZZ' : '2ZZZZZ';
    for (let i = 0; i < 4; i += 1) {
      expect((await refus(service.verifier(d.jeton, faux, meta))).code).toBe('auth.code_incorrect');
    }
    expect((await refus(service.verifier(d.jeton, 'n’importe', meta))).code).toBe(
      'auth.code_bloque',
    );
    // Bloquée, la connexion ne prend plus même le bon code.
    expect((await refus(service.verifier(d.jeton, code, meta))).code).toBe('auth.code_bloque');
    expect((await attente(d.jeton))!.essais).toBe(5);

    // Reprise depuis le début : la connexion d'avant laisse sa place, le code reçu sert.
    const reprise = await demander('Diop', awa.locale, d.jeton);
    expect(await attente(d.jeton)).toBeUndefined();
    expect((await service.verifier(reprise.jeton, code, meta)).user.userId).toBe(awa.userId);
  });

  it('des saisies simultanées : cinq au plus sont comparées (ADR-0288)', async () => {
    const awa = await creerCompte('Awa', 'Diop', { dossier: 'actif' });
    const d = await demander('Diop', awa.locale);
    const code = await recevoir();
    const faux = code.startsWith('2') ? '3ZZZZZ' : '2ZZZZZ';
    const reponses = await Promise.all(
      Array.from({ length: 12 }, () => refus(service.verifier(d.jeton, faux, meta))),
    );
    expect(reponses.filter((r) => r.code === 'auth.code_incorrect')).toHaveLength(4);
    expect(reponses.filter((r) => r.code === 'auth.code_bloque')).toHaveLength(8);
    expect((await attente(d.jeton))!.essais).toBe(5);
  });

  it('dix codes faux par heure pour une personne, toutes connexions confondues (ADR-0288)', async () => {
    const awa = await creerCompte('Awa', 'Diop', { dossier: 'actif' });
    const premiere = await demander('Diop', awa.locale);
    const code = await recevoir();
    const faux = code.startsWith('2') ? '3ZZZZZ' : '2ZZZZZ';
    // Chaque nouvelle connexion ouvre cinq essais, mais la personne n'en a que dix.
    let d = premiere;
    for (let i = 0; i < 10; i += 1) {
      if (i % 4 === 0 && i > 0) d = await demander('Diop', awa.locale);
      expect((await refus(service.verifier(d.jeton, faux, meta))).code).toBe('auth.code_incorrect');
    }
    const encore = await demander('Diop', awa.locale);
    expect((await refus(service.verifier(encore.jeton, code, meta))).code).toBe('auth.code_bloque');
  });

  it('douze codes par jour au plus pour une même personne (ADR-0288)', async () => {
    const awa = await creerCompte('Awa', 'Diop', { dossier: 'actif' });
    const d = await demander('Diop', awa.locale);
    await recevoir();
    const { compteur } = (await attente(d.jeton))!;
    // Onze codes de plus dans la journée, envoyés il y a plus d'un quart d'heure.
    for (let i = 0; i < 11; i += 1) {
      await raw(
        `INSERT INTO codes_de_connexion (id, compteur, code_hash, expires_at, created_at)
         VALUES ($1, $2, 'x', now() - interval '1 minute', now() - interval '2 hours')`,
        [randomUUID(), compteur],
      );
    }
    await reculer(d.jeton, 50);
    expect((await service.renvoyer(d.jeton)).info).toBe('quota');
  });

  it('un couple faux n’ouvre rien, même avec un code bien formé', async () => {
    await creerCompte('Awa', 'Diop', { dossier: 'actif' });
    const d = await demander('Sarr', `awa-${marque}`);
    expect((await refus(service.verifier(d.jeton, 'ABC123', meta))).code).toBe(
      'auth.code_incorrect',
    );
  });

  it('expiré ou déjà utilisé, le code le dit ; son courriel ne part plus', async () => {
    const awa = await creerCompte('Awa', 'Diop', { dossier: 'actif' });
    const d = await demander('Diop', awa.locale);
    await raw(
      `UPDATE codes_de_connexion SET expires_at = now() - interval '1 second'
                WHERE compteur = $1`,
      [(await attente(d.jeton))!.compteur],
    );
    expect((await refus(service.verifier(d.jeton, 'ABC123', meta))).code).toBe('auth.code_expire');
    await expediteur.envoyerCeQuiAttend();
    expect(transport.envoyes).toHaveLength(0);
    expect((await enFile())[0]).toMatchObject({ status: 'cancelled', body_encrypted: null });
  });

  it('un accès coupé entre l’envoi et la saisie n’ouvre pas de session', async () => {
    const awa = await creerCompte('Awa', 'Diop', { dossier: 'actif' });
    const d = await demander('Diop', awa.locale);
    const code = await recevoir();
    await raw(`UPDATE user_tenant_memberships SET acces_coupe_le = now() WHERE user_id = $1`, [
      awa.userId,
    ]);
    expect(await refus(service.verifier(d.jeton, code, meta))).toEqual({
      status: 403,
      code: 'auth.acces_ferme',
    });
  });

  it('sans connexion en cours, rien à valider ni à renvoyer', async () => {
    expect((await refus(service.verifier(undefined, 'ABC123', meta))).status).toBe(410);
    expect((await refus(service.verifier('inconnu', 'ABC123', meta))).status).toBe(410);
    expect((await refus(service.renvoyer(undefined))).status).toBe(410);
    expect(await service.etat(undefined)).toEqual({ enAttente: false });
  });
});

describe('les routes', () => {
  /** Une réponse qui note les cookies posés et effacés. */
  function reponse() {
    const poses: Record<string, string> = {};
    const effaces: string[] = [];
    return {
      poses,
      effaces,
      res: {
        setHeader: () => undefined,
        cookie: (nom: string, valeur: string) => void (poses[nom] = valeur),
        clearCookie: (nom: string) => void effaces.push(nom),
      } as never,
    };
  }
  const requete = (cookies: Record<string, string> = {}) =>
    ({
      ip: `10.${Math.floor(Math.random() * 250)}.3.${Math.floor(Math.random() * 250)}`,
      headers: {},
      cookies,
    }) as never;

  it('la demande pose le cookie de la connexion ; le code, celui de la session', async () => {
    const awa = await creerCompte('Awa', 'Diop', { dossier: 'actif' });
    const ctrl = new ConnexionParCodeController(service, new Limiteur(db));

    const demande = reponse();
    expect(await ctrl.demander({ nom: 'Diop', email: awa.locale }, requete(), demande.res)).toEqual(
      { email: masquerEmail(awa.email) },
    );
    const jeton = demande.poses[ATTENTE_COOKIE]!;
    const a = await attente(jeton);
    compteurs.add(a!.compteur);
    // Le code part après la réponse : on attend qu'il soit en file.
    for (let i = 0; i < 50 && (await enFile()).length === 0; i += 1) {
      await new Promise((r) => setTimeout(r, 20));
    }
    const code = await recevoir();

    expect(await ctrl.etat(requete({ [ATTENTE_COOKIE]: jeton }))).toEqual({
      enAttente: true,
      email: masquerEmail(awa.email),
    });
    const saisie = reponse();
    const { user } = await ctrl.valider({ code }, requete({ [ATTENTE_COOKIE]: jeton }), saisie.res);
    expect(user.userId).toBe(awa.userId);
    expect(saisie.poses[SESSION_COOKIE]).toBeTruthy();
    expect(saisie.effaces).toEqual([ATTENTE_COOKIE]);
  });
});

describe('en campagne, le dossier reçoit son code (ADR-0246)', () => {
  beforeEach(() => {
    service.campagne = () => 2026;
  });

  it('un agent sans compte reçoit son code, et son compte s’ouvre au premier code juste', async () => {
    const ibou = await creerDossier('Ibou', 'Ndiaye');
    const d = await demander('NDIAYE', ibou.locale);
    expect(await attente(d.jeton)).toMatchObject({
      user_id: null,
      tenant_id: tenantId,
      employee_id: ibou.employeeId,
    });
    const code = await recevoir();
    expect(transport.envoyes.at(-1)!.to).toBe(ibou.email);
    expect(transport.envoyes.at(-1)!.text).toContain('Bonjour Ibou,');

    const session = await service.verifier(d.jeton, code, meta);
    expect(session.user.email).toBe(ibou.email);
    const { rows } = await raw(
      `SELECT p.user_id, u.password_hash, u.given_name, u.family_name, u.status, m.role
         FROM persons p
         JOIN users u ON u.id = p.user_id
         JOIN user_tenant_memberships m ON m.user_id = u.id AND m.tenant_id = p.tenant_id
        WHERE p.id = $1`,
      [ibou.personId],
    );
    expect(rows).toEqual([
      {
        user_id: session.user.userId,
        password_hash: null,
        given_name: 'Ibou',
        family_name: 'Ndiaye',
        status: 'active',
        role: 'employee',
      },
    ]);

    // La fois suivante, le compte existe : il reçoit son code comme tout compte.
    const encore = await demander('Ndiaye', ibou.locale);
    expect(await attente(encore.jeton)).toMatchObject({
      user_id: session.user.userId,
      employee_id: null,
    });
  });

  it('un compte à une autre adresse : le code part à celle du dossier, et ce compte s’ouvre', async () => {
    const awa = await creerCompte('Awa', 'Diop');
    const dossier = await creerDossier('Awa', 'Diop', { userId: awa.userId });
    const d = await demander('Diop', dossier.locale);
    expect(await attente(d.jeton)).toMatchObject({
      user_id: awa.userId,
      employee_id: dossier.employeeId,
    });
    const code = await recevoir();
    expect(transport.envoyes.at(-1)!.to).toBe(dossier.email);

    // Redemandé, le code repart à la même adresse.
    await reculer(d.jeton, 60);
    const renvoi = await service.renvoyer(d.jeton);
    await renvoi.enFond;
    expect((await enFile()).map((c) => c.recipient)).toEqual([dossier.email, dossier.email]);

    // Le nouveau code remplace le premier (ADR-0288).
    const nouveau = await recevoir();
    expect(nouveau).not.toBe(code);
    const session = await service.verifier(d.jeton, nouveau, meta);
    expect(session.user.userId).toBe(awa.userId);
  });

  it('un compte d’administration à une autre adresse : rien ne part (ADR-0288)', async () => {
    const awa = await creerCompte('Awa', 'Diop');
    await raw(`UPDATE user_tenant_memberships SET role = 'admin' WHERE user_id = $1`, [awa.userId]);
    const dossier = await creerDossier('Awa', 'Diop', { userId: awa.userId });
    const d = await demander('Diop', dossier.locale);
    expect(await attente(d.jeton)).toMatchObject({ user_id: null, employee_id: null });
    expect((await enFile()).map((c) => c.recipient)).not.toContain(dossier.email);
  });

  it('l’adresse d’un autre compte portée par un dossier : rien ne part (ADR-0288)', async () => {
    // Quelqu'un met sa propre adresse sur le dossier d'une autre personne.
    const cheikh = await creerCompte('Cheikh', 'Mbaye');
    const awa = await creerCompte('Awa', 'Diop');
    await creerDossier('Awa', 'Diop', { userId: awa.userId, locale: cheikh.locale });
    const d = await demander('Diop', cheikh.locale);
    expect(await attente(d.jeton)).toMatchObject({ user_id: null, employee_id: null });
    expect(await enFile()).toHaveLength(0);
  });

  it('hors campagne, un dossier sans compte ne reçoit rien', async () => {
    service.campagne = () => null;
    const ibou = await creerDossier('Ibou', 'Ndiaye');
    const d = await demander('Ndiaye', ibou.locale);
    expect(await attente(d.jeton)).toMatchObject({
      user_id: null,
      tenant_id: null,
      employee_id: null,
    });
    expect(await enFile()).toHaveLength(0);
  });

  it('un autre nom, un dossier parti, deux dossiers au même nom, une adresse prise : rien', async () => {
    const ibou = await creerDossier('Ibou', 'Ndiaye');
    await demander('Sarr', ibou.locale);
    const lamine = await creerDossier('Lamine', 'Ba', { parti: true });
    await demander('Ba', lamine.locale);
    const fatou = await creerDossier('Fatou', 'Sall');
    await creerDossier('Fatou', 'Sall', { locale: fatou.locale });
    await demander('Sall', fatou.locale);
    // L'adresse du dossier est celle du compte d'une autre personne.
    const cheikh = await creerCompte('Cheikh', 'Mbaye');
    await creerDossier('Ousmane', 'Fall', { locale: cheikh.locale });
    await demander('Fall', cheikh.locale);
    expect(await enFile()).toHaveLength(0);
  });

  it('un code juste ouvre la session même si le dossier a été relié entre-temps', async () => {
    const ibou = await creerDossier('Ibou', 'Ndiaye');
    const d = await demander('Ndiaye', ibou.locale);
    const code = await recevoir();
    // Une invitation acceptée pendant ce temps relie le dossier à un compte.
    const compte = await creerCompte('Ibou', 'Ndiaye');
    await raw(`UPDATE persons SET user_id = $1 WHERE id = $2`, [compte.userId, ibou.personId]);
    const session = await service.verifier(d.jeton, code, meta);
    expect(session.user.userId).toBe(compte.userId);
  });
});
