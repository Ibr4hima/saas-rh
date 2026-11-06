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
 * Raleway, Anton et Exo sont celles de la charte graphique de l'APIX, que
 * suivent les documents de la DCH (ADR-0173) : le texte, les titres, le pied
 * de page. Arial (ADR-0090) et Times New Roman (ADR-0098) restent celles de
 * la déclaration de mouvement et des grilles d'évaluation. Aucune des deux ne
 * se redistribue : leur licence (Monotype, Microsoft) interdit de les
 * versionner. Arimo et Tinos en sont les équivalents libres, sous licence
 * OFL, dessinés aux MÊMES chasses : un mot y occupe la même largeur, une
 * ligne se coupe au même endroit. Gill Sans MT, celle des grilles
 * d'évaluation (ADR-0149), n'a pas d'équivalent aux mêmes chasses : Cabin, de
 * la même famille humaniste, en tient lieu. Google Sans reste celle du
 * certificat d'APIX Academy, comme du site. Allura, une écriture manuscrite,
 * trace les paraphes des signataires des grilles d'évaluation (ADR-0151).
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
 * avec la police. Arimo pour Arial, Tinos pour Times New Roman, et Google
 * Sans. Une licence que Google Fonts ne publie pas avec la police se prend
 * dans le dépôt de la famille (`url`).
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
    // Les paraphes des grilles d'évaluation : les initiales de qui a validé,
    // comme à la main (ADR-0151).
    css: 'Allura',
    licence: { source: 'ofl/allura/OFL.txt', nom: 'allura-OFL.txt' },
    coupes: [{ nom: 'allura-regular.ttf', style: 'normal', poids: '400' }],
  },
  {
    // La charte de l'APIX (ADR-0173) : Raleway porte le texte des documents
    // et le bloc de la République, du maigre au gras.
    css: 'Raleway:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400;1,700',
    licence: { source: 'ofl/raleway/OFL.txt', nom: 'raleway-OFL.txt' },
    coupes: [
      { nom: 'raleway-light.ttf', style: 'normal', poids: '300' },
      { nom: 'raleway-regular.ttf', style: 'normal', poids: '400' },
      { nom: 'raleway-medium.ttf', style: 'normal', poids: '500' },
      { nom: 'raleway-semibold.ttf', style: 'normal', poids: '600' },
      { nom: 'raleway-bold.ttf', style: 'normal', poids: '700' },
      { nom: 'raleway-italic.ttf', style: 'italic', poids: '400' },
      { nom: 'raleway-bold-italic.ttf', style: 'italic', poids: '700' },
    ],
  },
  {
    // Les titres des documents, en capitales, comme ceux de la charte.
    css: 'Anton',
    licence: { source: 'ofl/anton/OFL.txt', nom: 'anton-OFL.txt' },
    coupes: [{ nom: 'anton-regular.ttf', style: 'normal', poids: '400' }],
  },
  {
    // Les mentions du pied de page, comme sur le papier à en-tête de la charte.
    css: 'Exo:wght@400',
    licence: { source: 'ofl/exo/OFL.txt', nom: 'exo-OFL.txt' },
    coupes: [{ nom: 'exo-regular.ttf', style: 'normal', poids: '400' }],
  },
  {
    // Les pictogrammes du pied de page (adresse, téléphone, fax, courriel,
    // site) : les Material Symbols de l'application, pleins, réduits par
    // Google à ces cinq icônes. Leurs glyphes sont hors du latin : la police
    // ne se réduit pas. Licence Apache 2.0, pas OFL.
    css: 'Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20,400,1,0&icon_names=call,fax,language,location_on,mail',
    licence: {
      url: 'https://raw.githubusercontent.com/google/material-design-icons/master/LICENSE',
      nom: 'material-symbols-LICENSE.txt',
      attendu: 'Apache License',
    },
    reduire: false,
    coupes: [{ nom: 'material-symbols.ttf', style: 'normal', poids: '400' }],
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
function recuperer(coupe, blocs, { reduire = true } = {}) {
  const bloc = blocs.find((b) => b.style === coupe.style && b.poids === coupe.poids);
  if (!bloc?.url) throw new Error(`Coupe absente de la réponse : ${coupe.style} ${coupe.poids}`);
  // Une police réduite par Google (`icon_names`) n'a pas d'extension : seul
  // son format compte, vérifié une fois le fichier là.
  if (!bloc.url.endsWith('.ttf') && !bloc.url.includes('/l/font?')) {
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
  const reduit = reduire ? reduireAuLatin(chemin) : octets.length;
  console.log(`  ${coupe.nom} (${(reduit / 1024).toFixed(0)} Ko)`);
  return reduit;
}

/** La licence d'une famille, telle que Google Fonts, ou son dépôt, la publie avec elle. */
function recupererLaLicence({ source, url, nom, attendu = 'SIL OPEN FONT LICENSE' }) {
  const chemin = join(OUT, nom);
  curl(url ?? `https://raw.githubusercontent.com/google/fonts/main/${source}`, chemin);
  if (!readFileSync(chemin, 'utf8').includes(attendu)) {
    throw new Error(`${nom} n'est pas la licence attendue (${attendu}).`);
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
    total += recuperer(coupe, blocs, { reduire: famille.reduire ?? true });
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
    "Arimo et Tinos tiennent la place d'Arial et de Times New Roman, que leur\n" +
    'licence interdit de versionner : mêmes chasses, licence OFL (fichiers\n' +
    "`*-OFL.txt`). Les polices d'origine se déposent à la racine de `assets/`\n" +
    '(cf. `assets/README.md`).\n\n' +
    'Allura, une écriture manuscrite (OFL), trace les paraphes des\n' +
    "signataires des grilles d'évaluation.\n\n" +
    "Raleway, Anton et Exo (OFL) sont les polices de la charte de l'APIX,\n" +
    'celles des documents de la DCH : le texte, les titres, le pied de page.\n\n' +
    "Les pictogrammes du pied de page sont les Material Symbols de l'application,\n" +
    'réduits à cinq icônes (`material-symbols.ttf`, licence Apache 2.0).\n',
);
console.log(`✓ ${coupes} coupes, ${(total / 1024).toFixed(0)} Ko, dans ${OUT}`);
