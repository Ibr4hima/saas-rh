#!/usr/bin/env node
/**
 * Récupère en TTF les polices des documents PDF, chacune avec sa licence.
 *
 * Pourquoi un second script alors que le web a déjà le sien : les deux
 * consommateurs ne lisent pas le même format. Le navigateur veut du woff2 ;
 * pdfkit ne sait lire que du TTF ou de l'OTF, et refuse le woff2. Deux
 * fichiers pour une même police, donc, chacun là où il sert.
 *
 *   pnpm --filter @teranga/api fonts:fetch
 *   pnpm --filter @teranga/api fonts:fetch Tinos   (une famille seule)
 *
 * Les fichiers produits sont VERSIONNÉS : une attestation doit sortir avec la
 * bonne typographie sur un dépôt fraîchement cloné, sans manipulation.
 *
 * Arial est la police des documents de la DCH (ADR-0090) ; Times New Roman,
 * celle de ses contrats de travail (ADR-0098) ; Comic Sans MS, certains
 * modèles de l'APIX l'emploient. Aucune ne se redistribue : leur licence
 * (Monotype, Microsoft) interdit de les versionner. Arimo, Tinos et Comic
 * Relief en sont les équivalents libres, sous licence OFL, dessinés aux MÊMES
 * chasses : un mot y occupe la même largeur, une ligne se coupe au même
 * endroit. Gill Sans MT, celle des grilles d'évaluation (ADR-0149), n'a pas
 * d'équivalent aux mêmes chasses : Cabin, de la même famille humaniste, en
 * tient lieu. Google Sans reste celle du certificat d'APIX Academy, comme du
 * site.
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

/**
 * Les familles, coupe par coupe, et leur licence : l'OFL veut qu'elle voyage
 * avec la police. Arimo pour Arial, Tinos pour Times New Roman, Comic Relief
 * pour Comic Sans MS, et Google Sans. Une licence que Google Fonts ne publie
 * pas avec la police se prend dans le dépôt de la famille (`url`).
 */
const FAMILLES = [
  {
    css: 'Arimo:ital,wght@0,400;0,700;1,400;1,700',
    licence: { source: 'ofl/arimo/OFL.txt', nom: 'arimo-OFL.txt' },
    coupes: [
      { nom: 'arimo-regular.ttf', style: 'normal', poids: '400' },
      { nom: 'arimo-bold.ttf', style: 'normal', poids: '700' },
      { nom: 'arimo-italic.ttf', style: 'italic', poids: '400' },
      { nom: 'arimo-bold-italic.ttf', style: 'italic', poids: '700' },
    ],
  },
  {
    css: 'Tinos:ital,wght@0,400;0,700;1,400;1,700',
    licence: {
      url: 'https://raw.githubusercontent.com/googlefonts/tinos/main/OFL.txt',
      nom: 'tinos-OFL.txt',
    },
    coupes: [
      { nom: 'tinos-regular.ttf', style: 'normal', poids: '400' },
      { nom: 'tinos-bold.ttf', style: 'normal', poids: '700' },
      { nom: 'tinos-italic.ttf', style: 'italic', poids: '400' },
      { nom: 'tinos-bold-italic.ttf', style: 'italic', poids: '700' },
    ],
  },
  {
    css: 'Google+Sans:ital,wght@0,400;0,700;1,400',
    licence: { source: 'ofl/googlesans/OFL.txt', nom: 'google-sans-OFL.txt' },
    coupes: [
      { nom: 'google-sans-regular.ttf', style: 'normal', poids: '400' },
      { nom: 'google-sans-bold.ttf', style: 'normal', poids: '700' },
      { nom: 'google-sans-italic.ttf', style: 'italic', poids: '400' },
    ],
  },
  {
    // Gill Sans MT, celle des grilles d'évaluation de l'APIX (ADR-0149), ne se
    // redistribue pas plus qu'Arial : Cabin, humaniste comme elle, en tient
    // lieu tant que l'exploitant n'a pas déposé la vraie.
    css: 'Cabin:ital,wght@0,400;0,700;1,400;1,700',
    licence: { source: 'ofl/cabin/OFL.txt', nom: 'cabin-OFL.txt' },
    coupes: [
      { nom: 'cabin-regular.ttf', style: 'normal', poids: '400' },
      { nom: 'cabin-bold.ttf', style: 'normal', poids: '700' },
      { nom: 'cabin-italic.ttf', style: 'italic', poids: '400' },
      { nom: 'cabin-bold-italic.ttf', style: 'italic', poids: '700' },
    ],
  },
  {
    // Comic Relief n'a pas d'italique.
    css: 'Comic+Relief:wght@400;700',
    licence: { source: 'ofl/comicrelief/OFL.txt', nom: 'comic-relief-OFL.txt' },
    coupes: [
      { nom: 'comic-relief-regular.ttf', style: 'normal', poids: '400' },
      { nom: 'comic-relief-bold.ttf', style: 'normal', poids: '700' },
    ],
  },
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

/** Les coupes qu'une famille propose : style, graisse, adresse du TTF. */
function blocsDe(famille) {
  const css = curl(`https://fonts.googleapis.com/css2?family=${famille}&display=swap`);
  // Chaque bloc porte son style et sa graisse : on les apparie plutôt que de se
  // fier à l'ordre, que rien ne garantit.
  return [...css.matchAll(/@font-face \{([\s\S]*?)\}/g)].map(([, corps]) => ({
    style: /font-style:\s*(\w+)/.exec(corps)?.[1],
    poids: /font-weight:\s*(\d+)/.exec(corps)?.[1],
    url: /url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/.exec(corps)?.[1],
  }));
}

/** Une coupe, téléchargée, vérifiée et réduite : rend sa taille en octets. */
function recuperer(coupe, blocs) {
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
  console.log(`  ${coupe.nom} (${(reduit / 1024).toFixed(0)} Ko)`);
  return reduit;
}

/** La licence d'une famille, telle que Google Fonts, ou son dépôt, la publie avec elle. */
function recupererLaLicence({ source, url, nom }) {
  const chemin = join(OUT, nom);
  curl(url ?? `https://raw.githubusercontent.com/google/fonts/main/${source}`, chemin);
  if (!readFileSync(chemin, 'utf8').includes('SIL OPEN FONT LICENSE')) {
    throw new Error(`${nom} n'est pas la licence OFL attendue.`);
  }
  console.log(`  ${nom}`);
}

/** Les familles demandées (« Tinos »), toutes sans argument. */
const demandees = process.argv.slice(2).map((f) => f.toLowerCase());
const nomDe = (famille) => famille.css.split(':')[0].replace(/\+/g, ' ').toLowerCase();

mkdirSync(OUT, { recursive: true });
let total = 0;
let coupes = 0;
for (const famille of FAMILLES) {
  if (demandees.length > 0 && !demandees.includes(nomDe(famille))) continue;
  const blocs = blocsDe(famille.css);
  for (const coupe of famille.coupes) {
    total += recuperer(coupe, blocs);
    coupes += 1;
  }
  recupererLaLicence(famille.licence);
}

writeFileSync(
  join(OUT, 'README.md'),
  '# Polices des documents PDF\n\n' +
    'Fichiers GÉNÉRÉS par `scripts/fetch-pdf-fonts.mjs` — ne pas modifier à la main.\n\n' +
    '    pnpm --filter @teranga/api fonts:fetch\n\n' +
    'pdfkit ne lit ni le woff2 ni le SVG : le web et les PDF ont chacun leur\n' +
    'copie de Google Sans, dans le format que leur moteur sait ouvrir.\n\n' +
    "Arimo, Tinos et Comic Relief tiennent la place d'Arial, de Times New Roman\n" +
    'et de Comic Sans MS, que leur licence interdit de versionner : mêmes\n' +
    "chasses, licence OFL (fichiers `*-OFL.txt`). Les polices d'origine se\n" +
    'déposent à la racine de `assets/` (cf. `assets/README.md`).\n',
);
console.log(`✓ ${coupes} coupes, ${(total / 1024).toFixed(0)} Ko, dans ${OUT}`);
