/**
 * La porte des corps : un fichier ne se lit que sur la route qui l'attend,
 * à sa taille, et une fois l'envoyeur reconnu. Les refus partent AVANT le
 * corps : le client n'a rien envoyé quand il reçoit sa réponse.
 *
 * Et l'anti-abus en base : partagé, il compte au-delà d'une instance.
 */
import { randomUUID } from 'node:crypto';
import { request as http, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SessionUser } from '@teranga/contracts';
import { porteDesCorps } from '../src/common/corps';
import { Limiteur, adresseDuClient, type Regle } from '../src/common/limiteur';
import { envSchema } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { TenantDb } from '../src/db/tenant-db';
import { loadEnv } from '../src/config/env';

const env = loadEnv();
let db: TenantDb;
let limiteur: Limiteur;
let server: Server;
let port: number;

const SESSION_RH = { userId: 'rh', role: 'employee', capacites: ['personnel.gerer'] };
const SESSION_AGENT = { userId: 'agent', role: 'employee', capacites: [] };

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  db = new TenantDb();
  limiteur = new Limiteur(db);
  await db.global.execute(
    // Les compteurs d'un essai précédent ne comptent pas.
    (await import('drizzle-orm')).sql`DELETE FROM rate_limit_counters
            WHERE subject LIKE '%essai-%' OR bucket = 'candidature_ip'`,
  );
  const app = express();
  app.set('trust proxy', 'loopback');
  app.use(cookieParser());
  app.use(
    porteDesCorps({
      limiteur,
      cookie: 'tg_session',
      session: async (jeton) =>
        (jeton === 'rh'
          ? SESSION_RH
          : jeton === 'agent'
            ? SESSION_AGENT
            : null) as SessionUser | null,
    }),
  );
  app.all('/{*chemin}', (req: Request, res: Response) => {
    res.json({
      lu: Buffer.isBuffer(req.body) ? req.body.length : JSON.stringify(req.body ?? null).length,
    });
  });
  app.use(
    (
      err: { problem?: { status: number; code: string }; status?: number },
      _req: Request,
      res: Response,
      _n: NextFunction,
    ) => {
      res
        .status(err.problem?.status ?? err.status ?? 500)
        .json({ code: err.problem?.code ?? 'autre' });
    },
  );
  server = app.listen(0);
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.close();
  await db.onModuleDestroy();
});

/**
 * Une requête qui ANNONCE `longueur` octets et n'en envoie que `envoyes` :
 * si le serveur attendait le corps, la réponse ne viendrait jamais.
 */
function envoyer(
  methode: string,
  chemin: string,
  options: {
    longueur?: number;
    envoyes?: string;
    cookie?: string;
    type?: string;
    ip?: string;
    port?: number;
  },
): Promise<{ status: number; code?: string; lu?: number }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      'content-type': options.type ?? 'application/json',
    };
    if (options.longueur !== undefined) headers['content-length'] = String(options.longueur);
    else headers['transfer-encoding'] = 'chunked';
    if (options.cookie) headers.cookie = `tg_session=${options.cookie}`;
    if (options.ip) headers['x-forwarded-for'] = options.ip;
    const cible = { host: '127.0.0.1', port: options.port ?? port, method: methode, path: chemin };
    const req = http({ ...cible, headers }, (res) => {
      let corps = '';
      res.on('data', (c) => (corps += c));
      res.on('end', () => resolve({ status: res.statusCode!, ...JSON.parse(corps || '{}') }));
    });
    req.on('error', (e) =>
      String(e).includes('EPIPE') || String(e).includes('ECONNRESET') ? undefined : reject(e),
    );
    // Les en-têtes partent seuls : le corps annoncé ne suivra peut-être jamais.
    req.flushHeaders();
    if (options.envoyes) req.write(options.envoyes);
    if (options.longueur === undefined || options.envoyes?.length === options.longueur) req.end();
  });
}

const JSON_PETIT = '{"a":1}';
const UUID = randomUUID();

describe('la porte des corps', () => {
  it('trop gros pour la route : refusé avant d’en lire un octet', async () => {
    const r = await envoyer('POST', `/v1/employees/${UUID}/documents`, {
      longueur: 80 * 1024 * 1024,
      cookie: 'agent',
    });
    expect(r).toMatchObject({ status: 413, code: 'request.payload_too_large' });
  });

  it('sans taille annoncée, un fichier ne se lit pas', async () => {
    const r = await envoyer('POST', `/v1/absence-requests/${UUID}/document`, {
      envoyes: JSON_PETIT,
      cookie: 'agent',
    });
    expect(r).toMatchObject({ status: 411, code: 'request.length_required' });
  });

  it('sans session, même un petit fichier attend dehors', async () => {
    const r = await envoyer('POST', '/v1/reference-texts/code-du-travail/pdf', {
      longueur: 1024,
      type: 'application/pdf',
    });
    expect(r).toMatchObject({ status: 401, code: 'auth.session_required' });
  });

  it('les gros envois demandent aussi l’habilitation de la route', async () => {
    const r = await envoyer('POST', '/v1/reference-texts/code-du-travail/pdf', {
      longueur: 50 * 1024 * 1024,
      type: 'application/pdf',
      cookie: 'agent',
    });
    expect(r).toMatchObject({ status: 403, code: 'auth.forbidden' });
  });

  it('reconnu, à sa taille : le corps se lit', async () => {
    const r = await envoyer('POST', `/v1/employees/${UUID}/documents`, {
      longueur: JSON_PETIT.length,
      envoyes: JSON_PETIT,
      cookie: 'agent',
    });
    expect(r).toMatchObject({ status: 200, lu: JSON_PETIT.length });
  });

  it('ailleurs, un mégaoctet au plus, quelle que soit la route', async () => {
    for (const chemin of ['/v1/reference-texts/code-du-travail/autre', '/v1/employees']) {
      const r = await envoyer('POST', chemin, { longueur: 50 * 1024 * 1024, cookie: 'rh' });
      expect(r).toMatchObject({ status: 413, code: 'request.payload_too_large' });
    }
  });

  it('la vidéo d’une leçon passe en flux, après la session et l’habilitation', async () => {
    const chemin = `/v1/academy/lessons/${UUID}/video/fichier`;
    const sansDroit = await envoyer('PUT', chemin, {
      longueur: 500 * 1024 * 1024,
      type: 'video/mp4',
      cookie: 'agent',
    });
    expect(sansDroit).toMatchObject({ status: 403 });
  });

  it('la candidature publique : dix par adresse et par offre, puis 429', async () => {
    const offre = `/v1/public/jobs/essai-${randomUUID().slice(0, 8)}/apply`;
    const ip = '203.0.113.7';
    for (let i = 0; i < 10; i++) {
      const r = await envoyer('POST', offre, {
        longueur: JSON_PETIT.length,
        envoyes: JSON_PETIT,
        ip,
      });
      expect(r.status).toBe(200);
    }
    const onzieme = await envoyer('POST', offre, { longueur: 30 * 1024 * 1024, ip });
    expect(onzieme).toMatchObject({ status: 429, code: 'recruitment.too_many_requests' });
    // Une autre adresse n'en pâtit pas : c'est l'adresse du client qui compte, pas celle du proxy.
    const autre = await envoyer('POST', offre, {
      longueur: JSON_PETIT.length,
      envoyes: JSON_PETIT,
      ip: '203.0.113.8',
    });
    expect(autre.status).toBe(200);
  });
});

describe('la candidature publique, toutes offres confondues (ADR-0290)', () => {
  it('trente par adresse et par heure : changer d’offre ne rend pas d’essais', async () => {
    const ip = '203.0.113.11';
    for (let i = 0; i < 30; i++) {
      const offre = `/v1/public/jobs/essai-${randomUUID().slice(0, 8)}/apply`;
      const r = await envoyer('POST', offre, {
        longueur: JSON_PETIT.length,
        envoyes: JSON_PETIT,
        ip,
      });
      expect(r.status).toBe(200);
    }
    const encore = await envoyer(
      'POST',
      `/v1/public/jobs/essai-${randomUUID().slice(0, 8)}/apply`,
      {
        longueur: 30 * 1024 * 1024,
        ip,
      },
    );
    expect(encore).toMatchObject({ status: 429, code: 'recruitment.too_many_requests' });
  });

  it('une seule candidature à la fois par adresse : un envoi lent ne bloque pas les autres', async () => {
    const offre = `/v1/public/jobs/essai-${randomUUID().slice(0, 8)}/apply`;
    const ip = '203.0.113.13';
    // Le premier envoi annonce 1 Mo et n'en envoie qu'un octet : il reste en cours.
    const lent = http({
      host: '127.0.0.1',
      port,
      method: 'POST',
      path: offre,
      headers: {
        'content-type': 'application/json',
        'content-length': String(1024 * 1024),
        'x-forwarded-for': ip,
      },
    });
    lent.on('error', () => undefined);
    lent.flushHeaders();
    lent.write('{');
    try {
      await new Promise((r) => setTimeout(r, 300));
      const second = await envoyer('POST', offre, {
        longueur: JSON_PETIT.length,
        envoyes: JSON_PETIT,
        ip,
      });
      expect(second).toMatchObject({ status: 429, code: 'recruitment.envoi_en_cours' });
      // Une autre adresse passe.
      const autre = await envoyer('POST', offre, {
        longueur: JSON_PETIT.length,
        envoyes: JSON_PETIT,
        ip: '203.0.113.14',
      });
      expect(autre.status).toBe(200);
    } finally {
      lent.destroy();
    }
  });

  it('une offre qui ne reçoit pas de candidatures : refusée avant de lire le dossier', async () => {
    const ouverte = `essai-${randomUUID().slice(0, 8)}`;
    const app = express();
    app.set('trust proxy', 'loopback');
    app.use(
      porteDesCorps({
        limiteur,
        cookie: 'tg_session',
        session: async () => null,
        offreOuverte: async (slug) => slug === ouverte,
      }),
    );
    app.all('/{*chemin}', (_req: Request, res: Response) => {
      res.json({ lu: 1 });
    });
    app.use(
      (
        err: { problem?: { status: number; code: string } },
        _q: Request,
        res: Response,
        _n: NextFunction,
      ) => {
        res.status(err.problem?.status ?? 500).json({ code: err.problem?.code ?? 'autre' });
      },
    );
    const autre = app.listen(0);
    try {
      const sonPort = (autre.address() as AddressInfo).port;
      const ip = '203.0.113.12';
      // Annoncé à 30 Mo, jamais envoyé : la réponse vient sans attendre le corps.
      const fermee = await envoyer('POST', `/v1/public/jobs/essai-fermee1/apply`, {
        longueur: 30 * 1024 * 1024,
        ip,
        port: sonPort,
      });
      expect(fermee).toMatchObject({ status: 410, code: 'recruitment.job_unavailable' });
      const r = await envoyer('POST', `/v1/public/jobs/${ouverte}/apply`, {
        longueur: JSON_PETIT.length,
        envoyes: JSON_PETIT,
        ip,
        port: sonPort,
      });
      expect(r.status).toBe(200);
    } finally {
      autre.close();
    }
  });
});

describe('la porte lit le chemin comme Express (audit)', () => {
  it('une barre finale ou des capitales ne contournent pas la limite des candidatures', async () => {
    const slug = `essai-${randomUUID().slice(0, 8)}`;
    const ip = '203.0.113.9';
    const variantes = [
      `/v1/public/jobs/${slug}/apply/`,
      `/v1/public/jobs/${slug}/APPLY`,
      `/V1/Public/Jobs/${slug}/apply//`,
    ];
    for (let i = 0; i < 10; i++) {
      const r = await envoyer('POST', variantes[i % variantes.length]!, {
        longueur: JSON_PETIT.length,
        envoyes: JSON_PETIT,
        ip,
      });
      expect(r.status).toBe(200);
    }
    const onzieme = await envoyer('POST', variantes[0]!, { longueur: 30 * 1024 * 1024, ip });
    expect(onzieme).toMatchObject({ status: 429, code: 'recruitment.too_many_requests' });
  });
});

describe('le compteur partagé', () => {
  const regle: Regle = { bucket: 'essai', fenetreSecondes: 600, max: 3 };

  it('compte, consulte sans compter, oublie', async () => {
    const sujet = `essai-${randomUUID()}`;
    for (let i = 0; i < 3; i++) expect((await limiteur.compter(regle, sujet)).bloque).toBe(false);
    expect((await limiteur.consulter(regle, sujet)).bloque).toBe(true);
    expect((await limiteur.compter(regle, sujet)).bloque).toBe(true);
    // Une autre instance lit le même compte : il est en base.
    expect((await new Limiteur(db).consulter(regle, sujet)).bloque).toBe(true);
    await limiteur.oublier(regle, sujet);
    expect((await limiteur.consulter(regle, sujet)).bloque).toBe(false);
  });

  it('l’adresse du client : IPv4 telle quelle, IPv6 à son /64', () => {
    expect(adresseDuClient({ ip: '::ffff:41.82.10.3' })).toBe('41.82.10.3');
    expect(adresseDuClient({ ip: '2001:db8:1:2:3:4:5:6' })).toBe('2001:db8:1:2::/64');
    expect(adresseDuClient({ ip: undefined })).toBe('inconnue');
  });
});

describe('la vérification publique d’un certificat (audit)', () => {
  it('une adresse qui essaie des numéros à la chaîne s’arrête à soixante', async () => {
    const { PublicCertificatsController } =
      await import('../src/modules/academy/academy.controller');
    const { ProblemException } = await import('../src/common/problem');
    const controleur = new PublicCertificatsController(
      { verifier: async () => ({}) } as never,
      limiteur,
    );
    const req = { ip: `essai-${randomUUID()}` } as Request;
    for (let i = 0; i < 60; i++) await controleur.verifier('APX-AAAA-0000', req);
    const refus = await controleur.verifier('APX-AAAA-0000', req).catch((e: unknown) => e);
    expect(refus).toBeInstanceOf(ProblemException);
    expect((refus as InstanceType<typeof ProblemException>).problem).toMatchObject({
      status: 429,
      code: 'academy.trop_de_verifications',
    });
  });
});

describe('TRUST_PROXY', () => {
  const base = {
    DATABASE_URL: 'x',
    APP_DATABASE_URL: 'x',
    DATA_ENCRYPTION_KEY: 'k'.repeat(44),
  };
  const lire = (e: Record<string, string>) => envSchema.safeParse({ ...base, ...e });

  it('un nombre de sauts, une liste, ou false ; jamais true', () => {
    expect(lire({ TRUST_PROXY: '2' }).data?.TRUST_PROXY).toBe(2);
    expect(lire({ TRUST_PROXY: 'loopback, 10.0.0.0/8' }).data?.TRUST_PROXY).toBe(
      'loopback,10.0.0.0/8',
    );
    expect(lire({ TRUST_PROXY: 'false' }).data?.TRUST_PROXY).toBe(false);
    expect(lire({ TRUST_PROXY: 'true' }).success).toBe(false);
  });

  it('un réseau qui couvre tout Internet est refusé (ADR-0288)', () => {
    for (const large of ['0.0.0.0/0', '::/0', '128.0.0.0/1', '10.0.0.0/33', '10.0.0.0/8/1']) {
      expect(lire({ TRUST_PROXY: large }).success, large).toBe(false);
    }
    for (const juste of ['10.0.0.0/8', '172.16.0.0/12', 'fc00::/7', '203.0.113.7', 'loopback']) {
      expect(lire({ TRUST_PROXY: juste }).success, juste).toBe(true);
    }
  });

  it('la clé publiée est refusée dès que le site est public, NODE_ENV oublié ou non', () => {
    const publiee = 'mfM8qEsFfS1lIiWvm8hrM8zqi+O/PFhzPku1whgaMoU=';
    const avec = (url: string) =>
      lire({ DATA_ENCRYPTION_KEY: publiee, PUBLIC_WEB_URL: url }).success;
    expect(avec('https://rh.apix.sn')).toBe(false);
    expect(avec('http://203.0.113.7:3000')).toBe(false);
    expect(avec('http://localhost:3000')).toBe(true);
    expect(avec('http://192.168.1.20:3000')).toBe(true);
    expect(avec('http://[::1]:3000')).toBe(true);
  });

  it('en production, il se règle, et la clé publiée est refusée', () => {
    // Le reste d'une production bien réglée (cf. securite.spec.ts) : HTTPS.
    const https = { COOKIE_SECURE: 'true', PUBLIC_WEB_URL: 'https://rh.apix.sn' };
    expect(lire({ NODE_ENV: 'production', ...https }).success).toBe(false);
    expect(lire({ NODE_ENV: 'production', TRUST_PROXY: '2', ...https }).success).toBe(true);
    expect(
      lire({
        NODE_ENV: 'production',
        TRUST_PROXY: '2',
        ...https,
        DATA_ENCRYPTION_KEY: 'mfM8qEsFfS1lIiWvm8hrM8zqi+O/PFhzPku1whgaMoU=',
      }).success,
    ).toBe(false);
  });
});
