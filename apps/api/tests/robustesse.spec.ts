/**
 * La robustesse (ADR-0067) : une base saturée ou absente répond 503,
 * réessayable, jamais 500 ; la santé le dit ; la mémoire d'un calcul ne lit
 * qu'une fois, et seulement dans sa portée.
 */
import type { ArgumentsHost } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { avecMemoire, memoriser } from '../src/common/memoire';
import { indisponibilitePassagere, ProblemFilter } from '../src/common/problem';
import type { TenantDb } from '../src/db/tenant-db';
import { HealthController } from '../src/modules/health/health.controller';

/** Ce que le filtre renvoie pour une exception : statut, en-têtes, corps. */
function reponse(exception: unknown) {
  let corps: Record<string, unknown> = {};
  let statut = 0;
  const entetes: Record<string, string> = {};
  const res = {
    status: (s: number) => {
      statut = s;
      return res;
    },
    type: () => res,
    setHeader: (nom: string, valeur: string) => {
      entetes[nom] = valeur;
      return res;
    },
    json: (c: Record<string, unknown>) => {
      corps = c;
      return res;
    },
  };
  const host = { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost;
  const erreur = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  new ProblemFilter().catch(exception, host);
  erreur.mockRestore();
  return { statut, entetes, corps };
}

describe('une base saturée ou absente : 503, réessayable', () => {
  it('délai de requête, verrou, connexion perdue, pool plein : passagers', () => {
    for (const code of ['57014', '55P03', '57P01', '53300', '08006', 'ECONNREFUSED']) {
      expect(indisponibilitePassagere(Object.assign(new Error('x'), { code }))).toBe(true);
    }
    expect(indisponibilitePassagere(new Error('timeout exceeded when trying to connect'))).toBe(
      true,
    );
    // Drizzle enveloppe l'erreur du pilote : la cause suffit.
    const enveloppe = Object.assign(new Error('Failed query'), {
      cause: Object.assign(new Error('canceling statement due to statement timeout'), {
        code: '57014',
      }),
    });
    expect(indisponibilitePassagere(enveloppe)).toBe(true);
  });

  it('une vraie faute (contrainte, bogue) reste une erreur interne', () => {
    expect(indisponibilitePassagere(Object.assign(new Error('x'), { code: '23505' }))).toBe(false);
    expect(indisponibilitePassagere(new TypeError('undefined is not a function'))).toBe(false);
    expect(reponse(new TypeError('boum')).statut).toBe(500);
  });

  it('le filtre répond 503 en français, avec Retry-After', () => {
    const r = reponse(Object.assign(new Error('lock timeout'), { code: '55P03' }));
    expect(r.statut).toBe(503);
    expect(r.entetes['Retry-After']).toBe('5');
    expect(r.corps).toMatchObject({
      status: 503,
      code: 'service.indisponible',
      title: 'Service momentanément indisponible',
      detail: 'Réessayez dans un instant.',
    });
  });
});

describe('la santé', () => {
  afterEach(() => vi.useRealTimers());

  const sante = (query: () => Promise<unknown>) => {
    let statut = 200;
    const res = { status: (s: number) => (statut = s) };
    const controleur = new HealthController({ pool: { query } } as unknown as TenantDb);
    return { appel: () => controleur.health(res as never), statut: () => statut };
  };

  it('200 quand la base répond', async () => {
    const s = sante(() => Promise.resolve({ rows: [] }));
    expect(await s.appel()).toMatchObject({ status: 'ok', db: 'ok' });
    expect(s.statut()).toBe(200);
  });

  it('503 quand la base refuse', async () => {
    const s = sante(() =>
      Promise.reject(Object.assign(new Error('refus'), { code: 'ECONNREFUSED' })),
    );
    expect(await s.appel()).toMatchObject({ status: 'degraded', db: 'down' });
    expect(s.statut()).toBe(503);
  });

  it('503 quand la base ne répond pas : la sonde ne pend pas', async () => {
    vi.useFakeTimers();
    const s = sante(() => new Promise(() => undefined));
    const resultat = s.appel();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await resultat).toMatchObject({ status: 'degraded', db: 'down' });
    expect(s.statut()).toBe(503);
  });
});

describe('la mémoire d’un calcul', () => {
  it('dans la portée, une lecture se fait une fois ; hors portée, à chaque appel', async () => {
    let lectures = 0;
    const lire = () => memoriser('cle', async () => ++lectures);
    await lire();
    await lire();
    expect(lectures).toBe(2);
    await avecMemoire(async () => {
      expect(await lire()).toBe(3);
      expect(await lire()).toBe(3);
      // Une portée ouverte dans une autre la prolonge : ce qui est lu sert.
      await avecMemoire(async () => expect(await lire()).toBe(3));
    });
    expect(lectures).toBe(3);
    // Une nouvelle portée repart de zéro.
    await avecMemoire(async () => expect(await lire()).toBe(4));
  });
});
