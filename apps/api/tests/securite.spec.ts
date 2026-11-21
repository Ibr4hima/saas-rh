/**
 * La sécurité de l'API, réglage par réglage : ce que la production refuse
 * au démarrage, qui peut appeler l'API, ce qu'un autre site ne peut pas
 * faire, et ce que chaque réponse dit au navigateur.
 */
import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it } from 'vitest';
import { controleDOrigine, entetesDeSecurite, originesAutorisees } from '../src/common/securite';
import { envSchema } from '../src/config/env';
import { optionsDuCookie } from '../src/modules/auth/auth.constants';

const base = {
  DATABASE_URL: 'postgres://x',
  APP_DATABASE_URL: 'postgres://x',
  DATA_ENCRYPTION_KEY: 'q'.repeat(43) + '=',
};
const production = {
  ...base,
  NODE_ENV: 'production',
  TRUST_PROXY: 'loopback',
  COOKIE_SECURE: 'true',
  PUBLIC_WEB_URL: 'https://rh.apix.sn',
};
const refus = (env: Record<string, string>) => {
  const r = envSchema.safeParse(env);
  return r.success ? [] : r.error.issues.map((i) => String(i.path[0]));
};

describe('la production refuse de démarrer mal réglée', () => {
  it('bien réglée, elle démarre', () => {
    expect(refus(production)).toEqual([]);
  });

  it('sans HTTPS, avec l’inscription ouverte ou une origine en clair : non', () => {
    expect(refus({ ...production, COOKIE_SECURE: 'false' })).toContain('COOKIE_SECURE');
    expect(refus({ ...production, PUBLIC_WEB_URL: 'http://rh.apix.sn' })).toContain(
      'PUBLIC_WEB_URL',
    );
    expect(refus({ ...production, INSCRIPTION_OUVERTE: 'true' })).toContain('INSCRIPTION_OUVERTE');
    expect(refus({ ...production, CORS_ORIGINS: 'http://autre.apix.sn' })).toContain(
      'CORS_ORIGINS',
    );
  });

  it('le développement garde ses réglages de confort', () => {
    expect(refus({ ...base, COOKIE_SECURE: 'false', INSCRIPTION_OUVERTE: 'true' })).toEqual([]);
  });

  it('une origine se donne entière, sans chemin', () => {
    expect(refus({ ...base, CORS_ORIGINS: 'https://a.apix.sn/chemin' })).toContain('CORS_ORIGINS');
  });
});

describe('qui peut appeler l’API', () => {
  it('en production : le portail, et ce qu’on nomme ; rien de local', () => {
    const env = envSchema.parse({ ...production, CORS_ORIGINS: 'https://intranet.apix.sn' });
    expect(originesAutorisees(env).sort()).toEqual([
      'https://intranet.apix.sn',
      'https://rh.apix.sn',
    ]);
  });

  it('en développement : les ports locaux en plus', () => {
    expect(originesAutorisees(envSchema.parse(base))).toEqual(
      expect.arrayContaining(['http://localhost:3002', 'http://localhost:3000']),
    );
  });
});

/** Une requête, et ce que le contrôle en fait : `suite` ou un refus. */
function passer(method: string, headers: Record<string, string>) {
  let statut = 0;
  let suite = false;
  const res = {
    status(s: number) {
      statut = s;
      return res;
    },
    type: () => res,
    json: () => res,
  } as unknown as Response;
  controleDOrigine(['https://rh.apix.sn'])({ method, headers } as Request, res, (() => {
    suite = true;
  }) as NextFunction);
  return suite ? 'passe' : statut;
}

describe('un autre site ne fait pas agir une session', () => {
  it('un geste venu du portail passe', () => {
    expect(passer('POST', { origin: 'https://rh.apix.sn', 'sec-fetch-site': 'same-site' })).toBe(
      'passe',
    );
  });

  it('un geste venu d’ailleurs est refusé, quelle que soit la méthode', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(passer(method, { origin: 'https://attaquant.example' })).toBe(403);
    }
    expect(passer('POST', { 'sec-fetch-site': 'cross-site' })).toBe(403);
    expect(passer('POST', { origin: 'null' })).toBe(403);
  });

  it('une lecture passe : elle ne change rien', () => {
    expect(passer('GET', { origin: 'https://attaquant.example' })).toBe('passe');
  });

  it('un outil sans navigateur passe : il ne porte le cookie de personne', () => {
    expect(passer('POST', {})).toBe('passe');
  });
});

describe('ce que chaque réponse dit au navigateur', () => {
  const entetes = (secure: boolean) => {
    const poses: Record<string, string> = {};
    entetesDeSecurite({ COOKIE_SECURE: secure })(
      {} as Request,
      { setHeader: (k: string, v: string) => (poses[k.toLowerCase()] = v) } as unknown as Response,
      (() => undefined) as NextFunction,
    );
    return poses;
  };

  it('ni cadre, ni devinette, ni cache, ni référent', () => {
    expect(entetes(false)).toMatchObject({
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'cross-origin-resource-policy': 'same-site',
    });
    expect(entetes(false)['content-security-policy']).toContain("frame-ancestors 'none'");
  });

  it('en HTTPS, le navigateur ne revient jamais en clair', () => {
    expect(entetes(false)).not.toHaveProperty('strict-transport-security');
    expect(entetes(true)['strict-transport-security']).toMatch(/max-age=\d{8}; includeSubDomains/);
  });

  it('le cookie de session : illisible par la page, envoyé par le seul site', () => {
    expect(optionsDuCookie()).toMatchObject({ httpOnly: true, sameSite: 'strict', path: '/' });
  });
});
