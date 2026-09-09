#!/usr/bin/env node
/**
 * Récupère Google Sans en TTF pour les documents PDF.
 *
 * Pourquoi un second script alors que le web a déjà le sien : les deux
 * consommateurs ne lisent pas le même format. Le navigateur veut du woff2 ;
 * pdfkit ne sait lire que du TTF ou de l'OTF, et refuse le woff2. Deux
 * fichiers pour une même police, donc, chacun là où il sert.
 *
 *   pnpm --filter @teranga/api fonts:fetch
 *
 * Les fichiers produits sont VERSIONNÉS : une attestation doit sortir avec la
 * bonne typographie sur un dépôt fraîchement cloné, sans manipulation.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'assets', 'fonts');

/**
 * Google sert du woff2 aux navigateurs modernes et du TTF à ceux qu'il ne
 * reconnaît pas. C'est précisément ce qu'il nous faut : l'agent ancien n'est
 * pas une ruse, c'est la façon documentée d'obtenir le format historique.
 */
const UA = 'Mozilla/4.0';

const COUPES = [
  { nom: 'google-sans-regular.ttf', style: 'normal', poids: '400' },
  { nom: 'google-sans-bold.ttf', style: 'normal', poids: '700' },
  { nom: 'google-sans-italic.ttf', style: 'italic', poids: '400' },
];

/**
 * Les jeux dont un document sénégalais a besoin. Le TTF de Google porte TOUTES
 * les écritures dans un seul fichier — près de deux méga-octets par coupe, là
 * où le woff2 est découpé par plage. Versionner six méga-octets pour du texte
 * français serait absurde ; on garde le latin, ses extensions et la
 * ponctuation.
 */
const PLAGES = [
  'U+0000-00FF',
  'U+0100-024F',
  'U+0259',
  'U+1E00-1EFF',
  'U+2000-206F',
  'U+2074',
  'U+20A0-20BF',
  'U+2122',
  'U+2212',
  'U+FEFF',
  'U+FFFD',
].join(',');

/**
 * Réduit la police aux plages retenues, si l'outil est là.
 *
 * `pyftsubset` (fonttools) n'est PAS une dépendance du projet : les fichiers
 * produits sont versionnés, personne n'a besoin de relancer ce script pour
 * travailler. On prévient et on garde la police entière plutôt que d'échouer —
 * une police lourde reste une police juste.
 */
function reduireAuLatin(chemin) {
  const reduit = `${chemin}.sub`;
  try {
    execFileSync(
      'pyftsubset',
      [
        chemin,
        `--output-file=${reduit}`,
        `--unicodes=${PLAGES}`,
        '--layout-features=*',
        '--no-hinting',
      ],
      { stdio: 'ignore' },
    );
  } catch {
    console.warn(
      `  ⚠ pyftsubset absent : ${chemin.split('/').pop()} reste entière (fonttools réduit ×25).`,
    );
    return readFileSync(chemin).length;
  }
  unlinkSync(chemin);
  renameSync(reduit, chemin);
  return readFileSync(chemin).length;
}

function curl(url, sortie) {
  const args = ['-fsSL', '--max-time', '60', '-A', UA];
  if (sortie) args.push('-o', sortie);
  args.push(url);
  // curl honore HTTPS_PROXY, ce que fetch() de Node ne fait pas.
  return execFileSync('curl', args, { encoding: sortie ? 'buffer' : 'utf8' });
}

const css = curl(
  'https://fonts.googleapis.com/css2?family=Google+Sans:ital,wght@0,400;0,700;1,400&display=swap',
);

// Chaque bloc porte son style et sa graisse : on les apparie plutôt que de se
// fier à l'ordre, que rien ne garantit.
const blocs = [...css.matchAll(/@font-face \{([\s\S]*?)\}/g)].map(([, corps]) => ({
  style: /font-style:\s*(\w+)/.exec(corps)?.[1],
  poids: /font-weight:\s*(\d+)/.exec(corps)?.[1],
  url: /url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/.exec(corps)?.[1],
}));

mkdirSync(OUT, { recursive: true });
let total = 0;
for (const coupe of COUPES) {
  const bloc = blocs.find((b) => b.style === coupe.style && b.poids === coupe.poids);
  if (!bloc?.url) throw new Error(`Coupe absente de la réponse : ${coupe.style} ${coupe.poids}`);
  if (!bloc.url.endsWith('.ttf')) {
    throw new Error(
      `Google a servi autre chose qu'un TTF (${bloc.url.slice(-12)}) — police NON remplacée.`,
    );
  }
  const chemin = join(OUT, coupe.nom);
  curl(bloc.url, chemin);
  const octets = readFileSync(chemin);
  // Un TTF commence par 0x00010000 ; un OTF par « OTTO ». Tout le reste — une
  // page d'erreur, un woff2 — casserait pdfkit à la génération, pas ici.
  const entete = octets.readUInt32BE(0);
  if (entete !== 0x00010000 && octets.subarray(0, 4).toString('latin1') !== 'OTTO') {
    throw new Error(`${coupe.nom} n'est pas une police TrueType — NON remplacée.`);
  }
  const reduit = reduireAuLatin(chemin);
  total += reduit;
  console.log(`  ${coupe.nom} (${(reduit / 1024).toFixed(0)} Ko)`);
}

writeFileSync(
  join(OUT, 'README.md'),
  '# Polices des documents PDF\n\n' +
    'Fichiers GÉNÉRÉS par `scripts/fetch-pdf-fonts.mjs` — ne pas modifier à la main.\n\n' +
    '    pnpm --filter @teranga/api fonts:fetch\n\n' +
    'pdfkit ne lit ni le woff2 ni le SVG : le web et les PDF ont chacun leur\n' +
    'copie de Google Sans, dans le format que leur moteur sait ouvrir.\n',
);
console.log(`✓ ${COUPES.length} coupes, ${(total / 1024).toFixed(0)} Ko — ${OUT}`);
