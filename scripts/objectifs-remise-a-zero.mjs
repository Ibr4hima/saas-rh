#!/usr/bin/env node
/**
 * Objectifs : tout remettre à zéro pour tester.
 *
 * Efface, dans chaque organisation de la base locale, tout ce qui touche aux
 * objectifs :
 *   - les orientations de l'APIX et les objectifs des directions ;
 *   - les fiches d'objectifs : les objectifs fixés par les n+1, les coches et
 *     les statuts, les auto-évaluations, les évaluations, les notes et les
 *     reports ;
 *   - les objectifs individuels de l'ancien modèle, fixés un à un ;
 *   - les notifications qui en parlaient. Un courriel encore en attente pour
 *     l'une d'elles ne part plus.
 *
 * Restent : la date d'évaluation, un réglage de la DCH, et le journal
 * d'audit, qui garde la trace de l'effacement.
 *
 * Le script écrit DIRECTEMENT en base. D'où ses garde-fous : il refuse de
 * tourner quand NODE_ENV vaut `production`, et sur toute base qui n'est pas
 * locale. L'adresse de la base se lit avec l'analyseur de pg, celui qui se
 * connectera, comme le fait `pnpm db:reset` (apps/api/src/db/reset.ts) : lue
 * par `new URL()`, `postgres://localhost/teranga?host=prod.example.com`
 * passerait pour locale, alors que pg ouvrirait la base distante.
 *
 * Usage :
 *   node scripts/objectifs-remise-a-zero.mjs
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = join(ICI, '..');
// pg, son analyseur d'adresses et dotenv sont des dépendances de l'API : on
// les prend chez elle.
const requireApi = createRequire(join(RACINE, 'apps', 'api', 'package.json'));
const pg = requireApi('pg');
const { parse } = requireApi('pg-connection-string');
const dotenv = requireApi('dotenv');

const fichierEnv = join(RACINE, '.env');
if (existsSync(fichierEnv)) dotenv.config({ path: fichierEnv, quiet: true });

function stop(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

if (process.argv.length > 2) {
  stop(`Argument inattendu : ${process.argv[2]}\nUsage : node scripts/objectifs-remise-a-zero.mjs`);
}

// Les garde-fous

if (process.env.NODE_ENV === 'production') {
  stop('NODE_ENV vaut « production » : ce script ne sert qu’à tester, en local.');
}
const url = process.env.DATABASE_URL;
if (!url) stop('DATABASE_URL est absente : lancez le script depuis le dossier du projet.');

// La machine, et les services du docker compose du projet : les mêmes hôtes
// que pour `pnpm db:reset`.
const LOCAUX = new Set(['localhost', '127.0.0.1', '::1', 'db', 'postgres']);
let hote = '';
try {
  hote = (parse(url).host ?? '')
    .trim()
    .replace(/^\[|\]$/g, '')
    .toLowerCase();
} catch {
  stop('DATABASE_URL n’est pas une adresse de base exploitable : le script s’arrête.');
}
// Un chemin désigne une socket de la machine. Un hôte qu'on ne sait pas lire
// n'est pas présumé local.
if (!hote) stop('DATABASE_URL ne dit pas sur quelle machine est la base : le script s’arrête.');
if (!hote.startsWith('/') && !LOCAUX.has(hote)) {
  stop(`La base « ${hote} » n’est pas locale : ce script ne sert qu’à tester, en local.`);
}

// Le travail

const bd = new pg.Pool({ connectionString: url, max: 1 });

/**
 * Les notifications des objectifs, toutes : orientations de l'APIX et
 * objectifs des directions, fiches fixées, mises à jour, rouvertes ou
 * cochées, auto-évaluations ouvertes ou à évaluer et leurs relances,
 * évaluations validées, objectifs de l'ancien modèle. Leurs clés commencent
 * toutes ainsi.
 */
const NOTIFICATIONS_DES_OBJECTIFS = `dedupe_key LIKE 'objectif:%' OR dedupe_key LIKE 'objectifs:%'`;

try {
  const { rows: organisations } = await bd.query(`SELECT id, name FROM tenants ORDER BY name`);
  let total = 0;
  for (const o of organisations) {
    const client = await bd.connect();
    try {
      // Une organisation à la fois, dans son contexte : la sécurité par
      // ligne de la base la laisse seule à portée.
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [o.id]);
      const fiches = await client.query(`DELETE FROM objectifs_fiches WHERE tenant_id = $1`, [
        o.id,
      ]);
      const { rows: objectifs } = await client.query(
        `DELETE FROM objectifs WHERE tenant_id = $1 RETURNING niveau`,
        [o.id],
      );
      const avis = await client.query(
        `DELETE FROM notifications WHERE tenant_id = $1 AND (${NOTIFICATIONS_DES_OBJECTIFS})`,
        [o.id],
      );
      await client.query('COMMIT');
      const effaces = fiches.rowCount + objectifs.length + avis.rowCount;
      total += effaces;
      if (effaces === 0) continue;
      const de = (niveau) => objectifs.filter((x) => x.niveau === niveau).length;
      console.log(
        `\n${o.name}` +
          `\n  ${de('apix')} orientation(s) de l’APIX` +
          `\n  ${de('direction')} objectif(s) de direction` +
          `\n  ${fiches.rowCount} fiche(s) d’objectifs (avec leurs auto-évaluations et évaluations)` +
          `\n  ${de('individuel')} objectif(s) individuel(s) de l’ancien modèle` +
          `\n  ${avis.rowCount} notification(s)`,
      );
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
  console.log(
    total === 0
      ? '\nRien à effacer : aucun objectif.'
      : '\nTout est à zéro : aucun objectif, aucune fiche, aucune évaluation.',
  );
} finally {
  await bd.end();
}
