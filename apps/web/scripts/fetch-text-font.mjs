#!/usr/bin/env node
/**
 * Rapatrie la police de TEXTE de l'interface — Google Sans — et la sert
 * depuis notre domaine.
 *
 * Même raison que pour la police d'icônes, et un motif de plus : le produit
 * est destiné à une administration sénégalaise, dont le réseau peut fort bien
 * filtrer fonts.googleapis.com. Une police de texte absente n'est pas une
 * panne — le texte retombe sur la pile système — mais l'application change de
 * visage, les mesures glissent, et surtout le navigateur signale l'échec de
 * chargement, ce que la surcouche de développement de Next affiche comme une
 * erreur d'exécution. On ne dépend de personne à l'exécution.
 *
 *   pnpm --filter @teranga/web fonts:fetch
 *
 * À relancer si l'on change la famille ou les graisses ci-dessous. Le CSS
 * produit est VERSIONNÉ : le dépôt cloné doit s'afficher correctement sans
 * qu'on ait à lancer quoi que ce soit.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '..');
const FONT_DIR = join(web, 'public', 'fonts');
const CSS_OUT = join(web, 'app', 'google-sans.css');

/** Graisses et tailles optiques réellement utilisées par l'interface. */
const FAMILY = 'Google+Sans:ital,opsz,wght@0,17..18,400..700;1,17..18,400..700';

/**
 * Les seuls sous-ensembles qui nous concernent. Google en sert une quinzaine
 * (arménien, bengali, syllabaire autochtone…) : les embarquer tous pour un
 * produit francophone serait payer des centaines de kilo-octets pour rien.
 * `latin-ext` n'est pas facultatif — il porte le ŋ du wolof.
 */
const SOUS_ENSEMBLES = new Set(['latin', 'latin-ext']);

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

const css = curl(`https://fonts.googleapis.com/css2?family=${FAMILY}&display=swap`);

/**
 * Chaque bloc est précédé du nom de son sous-ensemble en commentaire — c'est
 * la seule façon de le connaître, `unicode-range` ne le nomme pas.
 */
const blocs = [...css.matchAll(/\/\* ([\w-]+) \*\/\s*(@font-face \{[\s\S]*?\})/g)]
  .map(([, sousEnsemble, regle]) => ({ sousEnsemble, regle }))
  .filter(({ sousEnsemble }) => SOUS_ENSEMBLES.has(sousEnsemble));

if (blocs.length === 0) {
  throw new Error(
    'Aucun sous-ensemble latin dans la réponse de Google — police NON remplacée.\n' +
      css.slice(0, 400),
  );
}

mkdirSync(FONT_DIR, { recursive: true });
const regles = [];
let total = 0;

for (const { sousEnsemble, regle } of blocs) {
  const url = regle.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/)?.[1];
  if (!url) throw new Error(`URL de police absente du bloc « ${sousEnsemble} »`);
  const italique = /font-style:\s*italic/.test(regle);
  const nom = `google-sans-${sousEnsemble}${italique ? '-italic' : ''}.woff2`;

  curl(url, join(FONT_DIR, nom));
  const octets = readFileSync(join(FONT_DIR, nom));
  if (octets.subarray(0, 4).toString('latin1') !== 'wOF2') {
    throw new Error(`${nom} n’est pas un woff2 — police NON remplacée en l’état.`);
  }
  total += octets.length;
  console.log(`  ${nom} (${(octets.length / 1024).toFixed(1)} Ko)`);

  regles.push(
    `/* ${sousEnsemble}${italique ? ' · italique' : ''} */\n` +
      regle.replace(/url\(https:\/\/[^)]+\)/, `url('/fonts/${nom}')`),
  );
}

writeFileSync(
  CSS_OUT,
  `/*\n * Google Sans — SERVIE PAR NOUS, jamais par un tiers.\n *\n` +
    ` * Fichier GÉNÉRÉ par scripts/fetch-text-font.mjs : ne pas modifier à la main.\n` +
    ` * Sous-ensembles : ${[...SOUS_ENSEMBLES].join(', ')}. Relancer après tout\n` +
    ` * changement de famille ou de graisse :\n *\n` +
    ` *     pnpm --filter @teranga/web fonts:fetch\n */\n\n` +
    regles.join('\n\n') +
    '\n',
);

// Le fichier est versionné : il doit passer `pnpm lint` comme le reste.
execFileSync('pnpm', ['exec', 'prettier', '--write', CSS_OUT], { stdio: 'ignore' });

console.log(`✓ ${blocs.length} coupes, ${(total / 1024).toFixed(1)} Ko au total`);
console.log(`✓ ${CSS_OUT}`);
