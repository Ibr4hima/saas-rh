#!/usr/bin/env node
/**
 * Objectifs : repartir de zéro pour tester.
 *
 * Efface, dans chaque organisation de la base locale :
 *   - les fiches d'objectifs : les objectifs fixés par les n+1, les statuts
 *     et les commentaires des auto-évaluations, les évaluations et les notes ;
 *   - les objectifs individuels de l'ancien modèle, fixés un à un ;
 *   - les notifications qui en parlaient : objectifs fixés ou mis à jour,
 *     évaluations validées, auto-évaluations à évaluer et leurs relances.
 *     Un courriel encore en attente pour l'une d'elles ne part plus.
 *
 * Restent : les orientations de l'APIX et les objectifs des directions, les
 * dates d'évaluation fixées par la DCH, et le journal d'audit (qui garde la
 * trace de l'effacement).
 *
 * Le script écrit DIRECTEMENT en base. D'où ses garde-fous : il refuse de
 * tourner quand NODE_ENV vaut `production`, et sur toute base qui n'est pas
 * locale.
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
// pg et dotenv sont des dépendances de l'API : on les prend chez elle.
const requireApi = createRequire(join(RACINE, 'apps', 'api', 'package.json'));
const pg = requireApi('pg');
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
const hote = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(hote)) {
  stop(`La base « ${hote} » n’est pas locale : ce script ne sert qu’à tester, en local.`);
}

// Le travail

const bd = new pg.Pool({ connectionString: url, max: 1 });

/**
 * Les notifications des objectifs d'un agent : fixés ou mis à jour (fiche),
 * évalués, l'objectif individuel fixé ou évalué, l'appel à évaluer une
 * auto-évaluation et sa relance. Les orientations de l'APIX et les objectifs
 * des directions gardent les leurs.
 */
const NOTIFICATIONS_DES_OBJECTIFS = `
  dedupe_key LIKE 'objectifs:fiche:%'
  OR dedupe_key LIKE 'objectifs:evaluation:%'
  OR dedupe_key LIKE 'objectif:%'
  OR dedupe_key ~ '^objectifs:[0-9a-f-]{36}:[0-9]{4}:[12]:(appel|rappel):'`;

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
      const individuels = await client.query(
        `DELETE FROM objectifs WHERE tenant_id = $1 AND niveau = 'individuel'`,
        [o.id],
      );
      const avis = await client.query(
        `DELETE FROM notifications WHERE tenant_id = $1 AND (${NOTIFICATIONS_DES_OBJECTIFS})`,
        [o.id],
      );
      await client.query('COMMIT');
      const effaces = fiches.rowCount + individuels.rowCount + avis.rowCount;
      total += effaces;
      if (effaces === 0) continue;
      console.log(
        `\n${o.name}\n  ${fiches.rowCount} fiche(s) d’objectifs (avec leurs auto-évaluations et évaluations)` +
          `\n  ${individuels.rowCount} objectif(s) individuel(s) de l’ancien modèle` +
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
      ? '\nRien à effacer : aucun objectif fixé.'
      : '\nC’est reparti de zéro : les n+1 peuvent fixer de nouveaux objectifs.',
  );
} finally {
  await bd.end();
}
