#!/usr/bin/env node
/**
 * Les polices de la charte de l'APIX pour les courriels : Raleway (le texte),
 * Exo (les mentions) et Anton (l'en-tête), en woff2, servies par le site.
 *
 * Les messageries qui chargent les polices d'un courriel (Mail sur Mac et
 * iPhone, Outlook sur Mac, Thunderbird) les prennent ici ; les autres
 * retombent sur la pile système que donne le gabarit
 * (apps/api/src/modules/courriels/gabarits.ts, ADR-0186).
 *
 *   pnpm --filter @teranga/web fonts:mail
 *
 * Les fichiers produits sont VERSIONNÉS, sous licence OFL, avec leur licence.
 * Les plages Unicode des sous-ensembles sont recopiées dans le gabarit : si
 * Google les change, le script les affiche, il faut les reporter.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '..');
const FONT_DIR = join(web, 'public', 'fonts');
/** Les licences OFL, déjà versionnées avec les polices des PDF. */
const LICENCES = join(web, '..', 'api', 'assets', 'fonts');

const FAMILLES = 'family=Raleway:wght@400..700&family=Exo:wght@400..700&family=Anton';
/** `latin-ext` porte le ŋ du wolof, comme pour la police de l'interface. */
const SOUS_ENSEMBLES = new Set(['latin', 'latin-ext']);

// Sans agent moderne, Google sert du TTF, trois fois plus lourd.
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function curl(url, binaryOut) {
  const args = ['-fsSL', '--max-time', '60', '-A', UA];
  if (binaryOut) args.push('-o', binaryOut);
  args.push(url);
  // curl honore HTTPS_PROXY, ce que fetch() de Node ne fait pas.
  return execFileSync('curl', args, { encoding: binaryOut ? 'buffer' : 'utf8' });
}

const css = curl(`https://fonts.googleapis.com/css2?${FAMILLES}&display=swap`);

const blocs = [...css.matchAll(/\/\* ([\w-]+) \*\/\s*(@font-face \{[\s\S]*?\})/g)]
  .map(([, sousEnsemble, regle]) => ({
    sousEnsemble,
    famille: regle.match(/font-family:\s*'([^']+)'/)?.[1],
    url: regle.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/)?.[1],
    plage: regle.match(/unicode-range:\s*([^;]+);/)?.[1],
  }))
  .filter(({ sousEnsemble }) => SOUS_ENSEMBLES.has(sousEnsemble));

if (blocs.length !== 6) {
  throw new Error(`Six coupes attendues, ${blocs.length} reçues : polices NON remplacées.`);
}

mkdirSync(FONT_DIR, { recursive: true });
let total = 0;
for (const { sousEnsemble, famille, url, plage } of blocs) {
  if (!famille || !url) throw new Error(`Bloc « ${sousEnsemble} » illisible.`);
  const nom = `${famille.toLowerCase()}-${sousEnsemble}.woff2`;
  curl(url, join(FONT_DIR, nom));
  const octets = readFileSync(join(FONT_DIR, nom));
  if (octets.subarray(0, 4).toString('latin1') !== 'wOF2') {
    throw new Error(`${nom} n’est pas un woff2.`);
  }
  total += octets.length;
  console.log(`  ${nom} (${(octets.length / 1024).toFixed(1)} Ko)\n    ${plage}`);
}
for (const famille of ['raleway', 'exo', 'anton']) {
  copyFileSync(join(LICENCES, `${famille}-OFL.txt`), join(FONT_DIR, `${famille}-OFL.txt`));
}
console.log(`✓ ${blocs.length} coupes, ${(total / 1024).toFixed(1)} Ko au total, dans ${FONT_DIR}`);
