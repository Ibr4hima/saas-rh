#!/usr/bin/env node
/**
 * APIX Academy — tester l'évaluation et le certificat sans regarder les vidéos.
 *
 * Pour UN compte de test, marque comme vues et validées toutes les leçons des
 * formations publiées : l'évaluation finale s'ouvre aussitôt, et le parcours
 * se teste jusqu'au certificat — un vrai, numéroté, vérifiable par son QR
 * code.
 *
 * Le script écrit DIRECTEMENT en base, ce que le verrou anti-triche interdit
 * justement de faire par l'API. D'où ses garde-fous : il refuse de tourner
 * quand NODE_ENV vaut `production`, et sur toute base qui n'est pas locale.
 *
 * Usage :
 *   node scripts/academy-valider-lecons.mjs a.diop@apix.sn
 *   node scripts/academy-valider-lecons.mjs a.diop@apix.sn --formation PowerPoint
 *   node scripts/academy-valider-lecons.mjs a.diop@apix.sn --remise-a-zero
 *
 *   --formation <texte>  une seule formation : un morceau de son titre suffit.
 *   --remise-a-zero      l'inverse : efface, pour ce compte, la progression,
 *                        les copies et les certificats de ces formations —
 *                        pour recommencer le test du début.
 *
 * Le compte doit avoir un dossier d'agent actif : c'est depuis un compte
 * d'agent que l'évaluation se passe. La RH, elle, a « Essayer l'évaluation »
 * dans l'atelier.
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

// ———————————————————————————— les arguments

const USAGE =
  'Usage : node scripts/academy-valider-lecons.mjs <email> [--formation <texte>] [--remise-a-zero]';
const args = process.argv.slice(2);
let email = null;
let filtre = null;
let remiseAZero = false;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--formation') {
    filtre = args[i + 1];
    i += 1;
    if (!filtre) stop(USAGE);
  } else if (args[i] === '--remise-a-zero') remiseAZero = true;
  else if (!email && !args[i].startsWith('--')) email = args[i];
  else stop(`Argument inattendu : ${args[i]}\n${USAGE}`);
}
if (!email) stop(USAGE);

// ———————————————————————————— les garde-fous

if (process.env.NODE_ENV === 'production') {
  stop('NODE_ENV vaut « production » : ce script ne sert qu’à tester, en local.');
}
const url = process.env.DATABASE_URL;
if (!url) stop('DATABASE_URL est absente : lancez le script depuis le dossier du projet.');
const hote = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(hote)) {
  stop(`La base « ${hote} » n’est pas locale : ce script ne sert qu’à tester, en local.`);
}

// ———————————————————————————— le travail

const bd = new pg.Pool({ connectionString: url, max: 1 });
const web = (process.env.PUBLIC_WEB_URL ?? 'http://localhost:3002').replace(/\/$/, '');

try {
  // Le dossier d'agent actif du compte — la même règle que l'API.
  const { rows: agents } = await bd.query(
    `SELECT e.id, e.tenant_id, p.given_name, p.family_name, t.name AS organisation
       FROM users u
       JOIN persons p ON p.user_id = u.id AND p.deleted_at IS NULL
       JOIN employees e ON e.person_id = p.id AND e.status = 'active'
       JOIN tenants t ON t.id = e.tenant_id
      WHERE lower(u.email) = lower($1)`,
    [email],
  );
  if (agents.length === 0) {
    stop(
      `Aucun dossier d’agent actif pour ${email}. L’évaluation se passe depuis un compte d’agent ` +
        '(la RH, elle, a « Essayer l’évaluation » dans l’atelier).',
    );
  }

  for (const agent of agents) {
    const { rows: formations } = await bd.query(
      `SELECT id, title FROM academy_courses
        WHERE tenant_id = $1 AND published_at IS NOT NULL
          AND ($2::text IS NULL OR title ILIKE '%' || $2 || '%')
        ORDER BY title`,
      [agent.tenant_id, filtre],
    );
    console.log(
      `\n${agent.given_name} ${agent.family_name} — ${agent.organisation}` +
        (remiseAZero ? ' · remise à zéro' : ''),
    );
    if (formations.length === 0) {
      console.log(
        filtre
          ? `  Aucune formation publiée ne contient « ${filtre} » dans son titre.`
          : '  Aucune formation publiée.',
      );
      continue;
    }

    for (const f of formations) {
      if (remiseAZero) {
        // Les certificats d'abord : ils pointent vers les copies.
        const c = await bd.query(
          `DELETE FROM academy_certificates WHERE employee_id = $1 AND course_id = $2`,
          [agent.id, f.id],
        );
        const a = await bd.query(
          `DELETE FROM academy_quiz_attempts WHERE employee_id = $1 AND course_id = $2`,
          [agent.id, f.id],
        );
        const p = await bd.query(
          `DELETE FROM academy_lesson_progress
            WHERE employee_id = $1
              AND lesson_id IN (SELECT id FROM academy_lessons WHERE course_id = $2)`,
          [agent.id, f.id],
        );
        console.log(
          `  ↺ ${f.title}\n    ${p.rowCount} leçon(s), ${a.rowCount} copie(s), ${c.rowCount} certificat(s) effacés`,
        );
        continue;
      }

      // Chaque leçon prête, vue de bout en bout : un intervalle [0, durée].
      const { rowCount } = await bd.query(
        `INSERT INTO academy_lesson_progress
           (tenant_id, employee_id, lesson_id, watched, watched_seconds, position_seconds, completed_at)
         SELECT l.tenant_id, $1, l.id, jsonb_build_array(jsonb_build_array(0, l.duration_seconds)),
                l.duration_seconds, 0, now()
           FROM academy_lessons l
          WHERE l.course_id = $2 AND l.video_status = 'prete' AND l.duration_seconds IS NOT NULL
         ON CONFLICT (employee_id, lesson_id) DO UPDATE
           SET watched = EXCLUDED.watched,
               watched_seconds = EXCLUDED.watched_seconds,
               completed_at = COALESCE(academy_lesson_progress.completed_at, now()),
               updated_at = now()`,
        [agent.id, f.id],
      );
      console.log(
        `  ✓ ${f.title}\n    ${rowCount} leçon(s) validée(s) · évaluation : ${web}/academy/${f.id}/evaluation`,
      );
    }
  }
  console.log(
    remiseAZero
      ? '\nC’est reparti de zéro pour ce compte.'
      : `\nConnectez-vous avec ${email} pour passer l’évaluation.`,
  );
} finally {
  await bd.end();
}
