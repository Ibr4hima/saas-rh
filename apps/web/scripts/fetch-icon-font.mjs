#!/usr/bin/env node
/**
 * Fabrique la police d'icônes SERVIE PAR NOUS.
 *
 * Pourquoi ne pas pointer simplement sur fonts.googleapis.com : une police
 * d'icônes rendue par ligature dégrade très mal. Si la feuille de style
 * n'arrive pas — réseau d'administration filtrant, coupure, poste hors ligne —
 * le menu n'affiche pas des icônes fades, il affiche « free_cancellation » et
 * « folder_managed » écrits en toutes lettres. Une police de TEXTE absente
 * retombe sur la police système ; une police d'ICÔNES absente n'a pas de repli.
 * On télécharge donc le sous-ensemble une fois, on le versionne (23 Ko), et
 * l'application ne dépend plus de personne à l'exécution.
 *
 *   pnpm --filter @teranga/web icons:fetch
 *
 * À relancer après toute modification de ICON_NAMES (components/icons.tsx) :
 * le sous-ensemble ne contient que les icônes listées au moment de l'appel.
 * En développement, Icon prévient en console si la liste et la police ont
 * divergé — c'est exactement ce que le manifeste sert à détecter.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '..');
const ICONS_TSX = join(web, 'components', 'icons.tsx');
const FONT_OUT = join(web, 'public', 'fonts', 'material-symbols-outlined.subset.woff2');
const MANIFEST_OUT = join(web, 'components', 'icon-font.manifest.json');

/** Plage d'axes servie ; doit rester alignée sur celle utilisée par Icon. */
const AXES = 'opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200';
// Google sert du TTF aux agents qu'il ne reconnaît pas : sans UA moderne, on
// récupérerait un fichier trois fois plus lourd que le woff2 attendu.
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function curl(url, binaryOut) {
  const args = ['-fsSL', '--max-time', '60', '-A', UA];
  if (binaryOut) args.push('-o', binaryOut);
  args.push(url);
  // curl honore HTTPS_PROXY, ce que fetch() de Node ne fait pas.
  return execFileSync('curl', args, { encoding: binaryOut ? 'buffer' : 'utf8' });
}

/** ICON_NAMES reste la source de vérité : on la lit, on ne la duplique pas. */
function readIconNames() {
  const src = readFileSync(ICONS_TSX, 'utf8');
  const block = src.match(/export const ICON_NAMES = \[([\s\S]*?)\] as const;/);
  if (!block) throw new Error(`ICON_NAMES introuvable dans ${ICONS_TSX}`);
  const names = [...block[1].matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
  if (names.length === 0) throw new Error('ICON_NAMES est vide');
  return [...new Set(names)].sort();
}

const icons = readIconNames();
const cssUrl =
  'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:' +
  `${AXES}&icon_names=${icons.join(',')}&display=block`;

console.log(`→ ${icons.length} icônes : ${icons.join(', ')}`);
const css = curl(cssUrl);
const kit = css.match(/https:\/\/fonts\.gstatic\.com\/[^)]+/);
if (!kit) throw new Error('URL de police absente de la réponse CSS :\n' + css.slice(0, 400));

mkdirSync(dirname(FONT_OUT), { recursive: true });
curl(kit[0], FONT_OUT);
const bytes = readFileSync(FONT_OUT);
if (bytes.subarray(0, 4).toString('latin1') !== 'wOF2') {
  throw new Error('Le fichier téléchargé n’est pas un woff2 — police NON remplacée en l’état.');
}

writeFileSync(
  MANIFEST_OUT,
  JSON.stringify(
    {
      _: 'Généré par scripts/fetch-icon-font.mjs — ne pas modifier à la main.',
      icons,
      axes: AXES,
      bytes: bytes.length,
    },
    null,
    2,
  ) + '\n',
);
console.log(`✓ ${FONT_OUT} (${(bytes.length / 1024).toFixed(1)} Ko)`);
console.log(`✓ ${MANIFEST_OUT}`);
