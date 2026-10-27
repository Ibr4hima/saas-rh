/**
 * Les envois lents (ADR-0069) : la vidéo d'une leçon va à son terme si elle
 * avance, même lentement, et s'abandonne quand plus rien n'arrive ; les
 * autres corps gardent leur délai, et répondent 408 quand il est passé.
 */
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bornerLeCorps } from '../src/common/corps';
import { EnvoiAbandonne, StockageVideoLocal } from '../src/modules/academy/stockage-local';

const attendre = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/** Un envoi qui livre ses morceaux un à un, avec une pause entre chacun. */
function envoi(morceaux: number, pauseMs: number, arretApres?: number): Readable {
  let i = 0;
  return new Readable({
    read() {
      if (arretApres !== undefined && i >= arretApres) return; // plus rien ne vient
      if (i >= morceaux) {
        this.push(null);
        return;
      }
      i += 1;
      setTimeout(() => this.push(Buffer.alloc(1024, i)), pauseMs);
    },
  });
}

describe('la vidéo d’une leçon, envoyée lentement', () => {
  let racine: string;
  let stockage: StockageVideoLocal;
  const tenantId = randomUUID();

  beforeAll(async () => {
    racine = await mkdtemp(join(tmpdir(), 'envois-lents-'));
    stockage = new StockageVideoLocal(racine);
  });
  afterAll(() => rm(racine, { recursive: true, force: true }));

  it('va à son terme tant qu’elle avance, même au-delà du délai d’inactivité', async () => {
    const debut = Date.now();
    const temporaire = await stockage.recevoir(tenantId, randomUUID(), envoi(10, 30), {
      inactiviteMs: 100,
      totalMs: 5_000,
    });
    // Trois cents millisecondes en tout, jamais plus de trente sans un octet.
    expect(Date.now() - debut).toBeGreaterThan(250);
    expect(temporaire).toMatch(/\.part$/);
  });

  it('s’abandonne quand plus rien n’arrive, sans laisser de fichier', async () => {
    const uid = randomUUID();
    const recu = stockage.recevoir(tenantId, uid, envoi(10, 10, 3), {
      inactiviteMs: 100,
      totalMs: 5_000,
    });
    await expect(recu).rejects.toBeInstanceOf(EnvoiAbandonne);
    expect(await readdir(join(racine, tenantId))).not.toContain(`${uid}.mp4.part`);
  });

  it('s’abandonne aussi au-delà de sa durée totale', async () => {
    const recu = stockage.recevoir(tenantId, randomUUID(), envoi(100, 20), {
      inactiviteMs: 100,
      totalMs: 200,
    });
    await expect(recu).rejects.toThrow('Envoi trop long');
  });
});

describe('les autres corps, bornés dans le temps', () => {
  let serveur: http.Server;
  let port: number;

  beforeAll(async () => {
    const app = express();
    app.use((req, res, suite) => {
      bornerLeCorps(req, res, 150);
      suite();
    });
    app.post('/json', express.json(), (req, res) => {
      res.json({ recu: req.body as unknown });
    });
    serveur = app.listen(0);
    await new Promise((ok) => serveur.once('listening', ok));
    port = (serveur.address() as AddressInfo).port;
  });
  afterAll(() => new Promise((ok) => serveur.close(ok)));

  /** Un corps annoncé, livré en `parts` morceaux espacés de `pauseMs` (ou laissé en plan). */
  const poster = (corps: string, pauseMs: number, enPlan = false) =>
    new Promise<{ status: number; corps: string }>((resolve) => {
      const req = http.request(
        {
          port,
          path: '/json',
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': corps.length },
        },
        (res) => {
          let texte = '';
          res.on('data', (m: Buffer) => (texte += m.toString()));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, corps: texte }));
        },
      );
      req.on('error', () => resolve({ status: 0, corps: '' }));
      const moitie = Math.floor(corps.length / 2);
      req.write(corps.slice(0, moitie));
      if (enPlan) return;
      void attendre(pauseMs).then(() => req.end(corps.slice(moitie)));
    });

  it('arrivé à temps, il est lu', async () => {
    expect(await poster('{"a":1}', 50)).toEqual({ status: 200, corps: '{"recu":{"a":1}}' });
  });

  it('laissé en plan, la requête répond 408 et ne retient pas la connexion', async () => {
    const r = await poster('{"a":1}', 0, true);
    expect(r.status).toBe(408);
    expect(JSON.parse(r.corps)).toMatchObject({ status: 408, code: 'request.timeout' });
  });
});
