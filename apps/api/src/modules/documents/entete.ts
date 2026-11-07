import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, win32 } from 'node:path';
import type PDFDocument from 'pdfkit';

/**
 * Ce qui est propre à l'APIX sur ses documents : le papier à en-tête de sa
 * charte graphique de 2026 (ADR-0173). En tête, à gauche, le drapeau du
 * Sénégal au-dessus du bloc de la République ; à droite, le logo. En pied de
 * page, la courbe bleue de la charte, puis les mentions de la société sur
 * trois colonnes, avec leurs pictogrammes. Tout se compose en code, comme
 * avant (ADR-0086) : rien à déposer que le logo, un trait net à toute
 * taille, et un seul endroit à corriger quand une mention change.
 *
 * La typographie va avec : Raleway pour le texte, Anton pour les titres, Exo
 * pour les mentions du pied, les polices de la charte.
 */

type Doc = typeof PDFDocument.prototype;

const RACINE = join(__dirname, '..', '..', '..');

const ENCRE = '#111111';
/** Le bleu de la charte de l'APIX : la courbe du pied, ses pictogrammes, les titres des actes. */
export const BLEU = '#004f91';
/** L'orange de la charte : le filet sous le titre d'un acte. */
export const ORANGE = '#ca631f';
/** L'anthracite de la charte, celui des mentions du pied de page. */
const ANTHRACITE = '#383838';

/**
 * L'APIX, telle que ses documents la présentent.
 *
 * C'est une CONSTANTE et non des données : le produit est écrit pour une
 * agence. Le jour où une seconde organisation arrive, ce bloc devient des
 * colonnes de `tenants`, et les dessins reçoivent la ligne du tenant
 * courant : leur forme, elle, ne changera pas.
 */
export const ENTETE = {
  republique: 'REPUBLIQUE DU SENEGAL',
  devise: 'UN PEUPLE – UN BUT – UNE FOI',
  tutelle: ['PRESIDENCE DE LA REPUBLIQUE', 'SECRETARIAT GENERAL'],
  /** Le nom de l'agence sur deux lignes : le bloc de la République reste étroit. */
  agenceLignes: ['Agence pour la Promotion des Investissements', 'et des Grands Travaux'],
  /** Raison sociale, telle qu'elle figure dans les métadonnées et l'Academy. */
  raisonSociale: 'APIX S.A',
  /** La société, telle que les actes de la DCH la nomment, dans tous les modèles (ADR-0088). */
  sigle: 'APIX-SA',
  /** La fin du numéro d'un acte de la DCH : « N° … /PR/SG/APIX/DCH ». */
  referenceDCH: '/PR/SG/APIX/DCH',
  /**
   * Celle d'un acte qui passe par la direction générale : les attestations
   * de revenu et de stage.
   */
  referenceDG: '/PR/SG/APIX/DG/DCH',
  /** Celle d'une décision du directeur général : « N° … /APIX/DG/DCH ». */
  referenceDecision: '/APIX/DG/DCH',
  /** Lieu d'émission : « Dakar, le … ». */
  ville: 'Dakar',
  /** Le NINEA, celui du pied de page et des contrats de travail (ADR-0099). */
  ninea: '28409592G3',
} as const;

/**
 * Les sessions du conseil d'administration qui ont nommé la direction
 * générale et la direction générale adjointe en place, au format AAAA-MM-JJ.
 * Les décisions de disponibilité les visent : leur fiche les propose, la DCH
 * les corrige (ADR-0123). Une constante, comme `ENTETE` : elle se met à jour
 * à chaque nomination.
 */
export const SESSIONS_DU_CONSEIL = {
  directionGenerale: '2024-05-07',
  directionGeneraleAdjointe: '2024-12-13',
} as const;

/**
 * Les mentions du pied de page, colonne par colonne, telles que le papier à
 * en-tête de la charte les imprime : la société, puis son adresse et son
 * téléphone, puis son fax, son courriel et son site.
 */
export const MENTIONS = {
  societe: [
    'Société Anonyme à Participation Publique Majoritaire',
    'au Capital de 4.950.000.000 FCFA',
    'RCCM : SN DKR 2008 B 72',
    `NINEA : ${ENTETE.ninea}`,
  ],
  adresse: ['52-54, rue Mohamed V', 'BP 430 - CP 18524 Dakar SENEGAL'],
  telephone: '(+221) 33 849 05 55',
  fax: '(+221) 33 823 94 89',
  courriel: 'infos@apix.sn',
  site: 'www.investinsenegal.sn',
} as const;

/**
 * Le logo, cherché là où il peut être.
 *
 * pdfkit ne lit ni SVG ni woff2 : il lui faut un PNG ou un JPEG. On regarde
 * d'abord dans les ressources de l'API, puis dans celles du site : l'exploitant
 * n'a qu'un fichier à déposer, où que ce soit. Absent, l'en-tête se dessine
 * sans lui, la droite blanche : un document sans logo reste un document.
 */
export function cheminLogo(): string | null {
  const candidats = [
    join(RACINE, 'assets', 'logo-apix.png'),
    join(RACINE, '..', 'web', 'public', 'logo-apix.png'),
    join(RACINE, 'assets', 'logo-apix.jpg'),
  ];
  return candidats.find((c) => existsSync(c)) ?? null;
}

export type Coupe = 'normal' | 'bold' | 'italic' | 'bold-italic';

/**
 * Les familles des documents : Raleway, celle des documents de la DCH depuis
 * la charte de 2026, avec ses graisses intermédiaires pour le bloc de la
 * République, Anton pour les titres et Exo pour le pied de page (ADR-0173) ;
 * les pictogrammes du pied ; Arial (ADR-0090) et Times New Roman (ADR-0098),
 * celles de la déclaration de mouvement et des grilles d'évaluation ; Gill
 * Sans MT, celle des grilles (ADR-0149) ; et une écriture manuscrite, celle
 * des paraphes des signataires d'une grille (ADR-0151). Le certificat
 * d'APIX Academy suit lui aussi la charte (ADR-0185).
 */
export type Famille =
  | 'raleway'
  | 'raleway-light'
  | 'raleway-medium'
  | 'raleway-semibold'
  | 'anton'
  | 'exo'
  | 'symboles'
  | 'arial'
  | 'times'
  | 'gill-sans'
  | 'signature';

/**
 * Où les systèmes rangent Arial et Times New Roman, quand ils les ont :
 * Windows et macOS de série, Debian et Ubuntu avec le paquet officiel des
 * polices de Microsoft (`ttf-mscorefonts-installer`). `windows` : le nom du
 * fichier sous Windows, que reprend le paquet ; `macos` : celui de macOS.
 */
const surLeSysteme = (windows: string, macos?: string) => [
  `C:\\Windows\\Fonts\\${windows}`,
  `/usr/share/fonts/truetype/msttcorefonts/${windows}`,
  ...(macos ? [`/System/Library/Fonts/Supplemental/${macos}`] : []),
];

/**
 * Où trouver chaque coupe, par ordre de préférence, depuis `assets/`.
 *
 * Arial, Times New Roman et Gill Sans MT ne se versionnent pas : leur
 * licence l'interdit (ADR-0090). Le générateur prend celles que l'exploitant
 * dépose à la racine des ressources, sous leur nom Windows, puis celles du
 * serveur. Sans elles, leurs équivalents libres, versionnés dans
 * `fonts/`, prennent la place, aux mêmes chasses : la mise en page ne bouge
 * pas d'un caractère. Gill Sans MT n'en a pas aux mêmes chasses : Cabin, de
 * la même famille humaniste, la remplace, et une grille la place à sa mesure.
 */
const FICHIERS: Record<Famille, Partial<Record<Coupe, readonly string[]>>> = {
  raleway: {
    normal: ['fonts/raleway-regular.ttf'],
    bold: ['fonts/raleway-bold.ttf'],
    italic: ['fonts/raleway-italic.ttf'],
    'bold-italic': ['fonts/raleway-bold-italic.ttf'],
  },
  'raleway-light': { normal: ['fonts/raleway-light.ttf'] },
  'raleway-medium': { normal: ['fonts/raleway-medium.ttf'] },
  'raleway-semibold': { normal: ['fonts/raleway-semibold.ttf'] },
  anton: { normal: ['fonts/anton-regular.ttf'] },
  exo: { normal: ['fonts/exo-regular.ttf'] },
  symboles: { normal: ['fonts/material-symbols.ttf'] },
  arial: {
    normal: ['arial.ttf', ...surLeSysteme('arial.ttf', 'Arial.ttf'), 'fonts/arimo-regular.ttf'],
    bold: ['arialbd.ttf', ...surLeSysteme('arialbd.ttf', 'Arial Bold.ttf'), 'fonts/arimo-bold.ttf'],
    italic: [
      'ariali.ttf',
      ...surLeSysteme('ariali.ttf', 'Arial Italic.ttf'),
      'fonts/arimo-italic.ttf',
    ],
    'bold-italic': [
      'arialbi.ttf',
      ...surLeSysteme('arialbi.ttf', 'Arial Bold Italic.ttf'),
      'fonts/arimo-bold-italic.ttf',
    ],
  },
  times: {
    normal: [
      'times.ttf',
      ...surLeSysteme('times.ttf', 'Times New Roman.ttf'),
      'fonts/tinos-regular.ttf',
    ],
    bold: [
      'timesbd.ttf',
      ...surLeSysteme('timesbd.ttf', 'Times New Roman Bold.ttf'),
      'fonts/tinos-bold.ttf',
    ],
    italic: [
      'timesi.ttf',
      ...surLeSysteme('timesi.ttf', 'Times New Roman Italic.ttf'),
      'fonts/tinos-italic.ttf',
    ],
    'bold-italic': [
      'timesbi.ttf',
      ...surLeSysteme('timesbi.ttf', 'Times New Roman Bold Italic.ttf'),
      'fonts/tinos-bold-italic.ttf',
    ],
  },
  'gill-sans': {
    normal: ['GIL_____.TTF', ...surLeSysteme('GIL_____.TTF'), 'fonts/cabin-regular.ttf'],
    bold: ['GILB____.TTF', ...surLeSysteme('GILB____.TTF'), 'fonts/cabin-bold.ttf'],
    italic: ['GILI____.TTF', ...surLeSysteme('GILI____.TTF'), 'fonts/cabin-italic.ttf'],
    'bold-italic': ['GILBI___.TTF', ...surLeSysteme('GILBI___.TTF'), 'fonts/cabin-bold-italic.ttf'],
  },
  signature: {
    normal: ['fonts/allura-regular.ttf'],
  },
};

/**
 * Un fichier des ressources, ou du serveur si son chemin est absolu, quelle
 * que soit la casse de son nom : ARIAL.TTF vaut arial.ttf.
 */
function ressource(chemin: string): string | null {
  // Le chemin d'un autre système, C:\Windows sous Linux : rien à chercher.
  if (win32.isAbsolute(chemin) && !isAbsolute(chemin)) return null;
  const complet = isAbsolute(chemin) ? chemin : join(RACINE, 'assets', chemin);
  if (existsSync(complet)) return complet;
  const dossier = dirname(complet);
  const nom = basename(complet).toLowerCase();
  const trouve = existsSync(dossier)
    ? readdirSync(dossier).find((f) => f.toLowerCase() === nom)
    : undefined;
  return trouve ? join(dossier, trouve) : null;
}

/** Les polices des documents, enregistrées sous `famille-coupe` : « raleway-bold ». */
export function enregistrerPolices(doc: Doc): void {
  for (const [famille, coupes] of Object.entries(FICHIERS)) {
    for (const [coupe, candidats] of Object.entries(coupes)) {
      const chemin = candidats.map(ressource).find((c) => c !== null);
      // Sans les polices, on retombe sur Helvetica plutôt que d'échouer : c'est
      // laid, ce n'est pas faux. `pnpm --filter @teranga/api fonts:fetch` remet
      // les fichiers en place.
      if (chemin) doc.registerFont(`${famille}-${coupe}`, readFileSync(chemin));
    }
  }
}

const HELVETICA: Record<Coupe, string> = {
  normal: 'Helvetica',
  bold: 'Helvetica-Bold',
  italic: 'Helvetica-Oblique',
  'bold-italic': 'Helvetica-BoldOblique',
};

/**
 * Le nom à donner à pdfkit pour une coupe : celle de la famille, si elle a pu
 * être enregistrée ; une italique absente cède la place au romain de la même
 * famille ; à défaut de tout, Helvetica.
 */
export function police(doc: Doc, coupe: Coupe, famille: Famille = 'raleway'): string {
  const essais: Coupe[] =
    coupe === 'italic' ? ['italic', 'normal'] : coupe === 'bold-italic' ? [coupe, 'bold'] : [coupe];
  for (const c of essais) {
    try {
      doc.font(`${famille}-${c}`);
      return `${famille}-${c}`;
    } catch {
      // Pas enregistrée : la suivante.
    }
  }
  return HELVETICA[coupe];
}

/**
 * Les chiffres alignés sur tout ce que la feuille écrit. Raleway dessine les
 * siens à l'ancienne, le 3 et le 9 sous la ligne : dans une date, un
 * matricule ou un montant, ils se lisent mal. pdfkit applique une fonction
 * de la police à la demande, texte par texte : la feuille la demande pour
 * tous, à l'écriture comme à la mesure. Une police qui n'a pas la fonction
 * n'en est pas changée.
 */
export function chiffresAlignes(doc: Doc): void {
  type Options = { features?: string[] };
  const interne = doc as unknown as { _initOptions: (...args: unknown[]) => Options };
  const initialiser = interne._initOptions.bind(doc);
  interne._initOptions = (...args: unknown[]) => {
    const options = initialiser(...args);
    options.features ??= ['lnum'];
    return options;
  };
  const mesurer = doc.widthOfString.bind(doc);
  doc.widthOfString = (texte: string, options: Options = {}) =>
    mesurer(texte, options.features ? options : { ...options, features: ['lnum'] });
}

/**
 * Le drapeau du Sénégal, tracé d'après son fichier officiel (900 × 600) :
 * vert, or et rouge, l'étoile verte au milieu de la bande d'or. Dessiné et
 * non collé : il reste net à toute taille, et il n'y a rien à déposer.
 */
export function dessinerDrapeau(doc: Doc, x: number, y: number, hauteur: number): void {
  doc
    .save()
    .translate(x, y)
    .scale(hauteur / 600);
  doc.rect(0, 0, 900, 600).fill('#e31b23');
  doc.rect(0, 0, 600, 600).fill('#fdef42');
  doc.rect(0, 0, 300, 600).fill('#00853f');
  doc.path('M391,382l59-181 59,181-154-112h190Z').fill('#00853f');
  doc.restore();
}

/**
 * Le papier à en-tête de la charte, mesuré sur sa maquette et ramené à la
 * page A4, en points. C'est un papier imprimé d'avance : l'en-tête et le pied
 * ne suivent pas les marges du texte, qui changent d'un modèle à l'autre.
 */
const PAPIER = {
  /** Le milieu du bloc de la République, celui du drapeau. */
  milieuDuBloc: 122,
  hautDuDrapeau: 29.4,
  hauteurDuDrapeau: 21.6,
  /** Le logo : son bord droit, sa hauteur ; sa largeur au plus. */
  droiteDuLogo: 544.5,
  hauteurDuLogo: 61.2,
  largeurDuLogo: 150,
  /** Le bas de l'en-tête : la dernière ligne du bloc et son air. */
  basDeLEnTete: 131,
} as const;

/** Une ligne du bloc de la République : texte, famille, corps, ligne de base. */
type Ligne = [texte: string, famille: Famille, taille: number, base: number];

/** Le bloc de la République, ligne par ligne, aux corps et aux graisses de la charte. */
const LIGNES_DU_BLOC: readonly Ligne[] = [
  [ENTETE.republique, 'raleway-semibold', 9.12, 68.82],
  [ENTETE.devise, 'raleway-light', 6.31, 75.99],
  ['*****', 'raleway', 6.31, 83.15],
  [ENTETE.tutelle[0], 'raleway-semibold', 8.33, 92.7],
  ['*****', 'raleway', 6.31, 100.11],
  [ENTETE.tutelle[1], 'raleway-medium', 6.31, 105.12],
  ['*****', 'raleway', 6.31, 113.48],
  [ENTETE.agenceLignes[0], 'raleway', 6.31, 120.41],
  [ENTETE.agenceLignes[1], 'raleway', 6.31, 128.12],
];

/**
 * Le milieu du bloc de la République en hauteur, du haut du drapeau à la
 * ligne de base de sa dernière ligne, qui ne descend pas sous la ligne :
 * c'est sur lui que le logo se centre, de l'autre côté de la page.
 */
const MILIEU_DU_BLOC_EN_HAUTEUR = (PAPIER.hautDuDrapeau + LIGNES_DU_BLOC.at(-1)![3]) / 2;

/**
 * L'en-tête du papier de la charte : à gauche, le drapeau au-dessus du bloc
 * de la République, chaque ligne centrée sur le drapeau ; à droite, le logo,
 * son milieu à la hauteur du milieu du bloc. Sans logo déposé, la droite
 * reste blanche. Rend le bas de l'en-tête.
 */
export function dessinerEnTete(doc: Doc, { logo }: { logo: string | null }): number {
  const largeurDuDrapeau = (PAPIER.hauteurDuDrapeau * 3) / 2;
  dessinerDrapeau(
    doc,
    PAPIER.milieuDuBloc - largeurDuDrapeau / 2,
    PAPIER.hautDuDrapeau,
    PAPIER.hauteurDuDrapeau,
  );
  for (const [texte, famille, taille, base] of LIGNES_DU_BLOC) {
    doc
      .font(police(doc, 'normal', famille))
      .fontSize(taille)
      .fillColor(ENCRE);
    doc.text(texte, PAPIER.milieuDuBloc - doc.widthOfString(texte) / 2, base, {
      lineBreak: false,
      baseline: 'alphabetic',
    });
  }
  if (logo) {
    const image = doc.openImage(logo);
    let hauteur: number = PAPIER.hauteurDuLogo;
    let largeur = (image.width * hauteur) / image.height;
    if (largeur > PAPIER.largeurDuLogo) {
      largeur = PAPIER.largeurDuLogo;
      hauteur = (image.height * largeur) / image.width;
    }
    doc.image(image, PAPIER.droiteDuLogo - largeur, MILIEU_DU_BLOC_EN_HAUTEUR - hauteur / 2, {
      width: largeur,
      height: hauteur,
    });
  }
  return PAPIER.basDeLEnTete;
}

/**
 * La courbe bleue du pied de page, d'un bord à l'autre de la feuille : un
 * croissant qui monte vers la droite, tracé d'après la maquette de la charte.
 */
const COURBE =
  'M0 769.7C99.12 787.94 200.97 780.65 300.25 767.28C374.96 757.09 448.99 742.17 522.22 724.29' +
  'C546.66 718.4 571.01 712.15 595.28 705.59C571.08 712.4 546.79 718.89 522.41 725.03' +
  'C358.82 764.26 166.92 801.08 0 769.7Z';

/**
 * Le haut de la courbe sous le texte d'une page : le texte s'arrête au-dessus,
 * à droite, où elle monte le plus haut sous la marge.
 */
export const HAUT_DE_LA_COURBE = 718;

/** Le bord supérieur de la courbe, ses trois arcs : départ, deux points de contrôle, arrivée. */
const BORD_DE_LA_COURBE: readonly (readonly [number, number])[][] = [
  [
    [0, 769.7],
    [99.12, 787.94],
    [200.97, 780.65],
    [300.25, 767.28],
  ],
  [
    [300.25, 767.28],
    [374.96, 757.09],
    [448.99, 742.17],
    [522.22, 724.29],
  ],
  [
    [522.22, 724.29],
    [546.66, 718.4],
    [571.01, 712.15],
    [595.28, 705.59],
  ],
];

/**
 * Le plus haut de la courbe entre `de` et `a`, en points depuis le haut de
 * la page : ce qu'un bloc posé au-dessus, de cette largeur, ne doit pas
 * dépasser. Elle monte vers la droite ; à gauche, elle descend un peu avant.
 */
export function hautDeLaCourbe(de: number, a: number): number {
  let haut = Infinity;
  for (const [p0, p1, p2, p3] of BORD_DE_LA_COURBE) {
    for (let i = 0; i <= 48; i++) {
      const t = i / 48;
      const u = 1 - t;
      const point = (k: 0 | 1) =>
        u * u * u * p0![k] + 3 * u * u * t * p1![k] + 3 * u * t * t * p2![k] + t * t * t * p3![k];
      const x = point(0);
      if (x >= de && x <= a) haut = Math.min(haut, point(1));
    }
  }
  return haut;
}

/** Les pictogrammes du pied, par leur point de code dans les Material Symbols. */
const PICTOGRAMMES = {
  lieu: 0xe0c8,
  telephone: 0xe0b0,
  fax: 0xead8,
  courriel: 0xe158,
  site: 0xe894,
} as const;

/**
 * Le pied de page du papier de la charte : la courbe bleue, puis les
 * mentions en Exo, sur trois colonnes, chacune à la place de la maquette :
 * la société ; son adresse, sous un repère, et son téléphone ; son fax, son
 * courriel et son site. Les pictogrammes, bleus, se centrent sur leur ligne.
 * Le numéro de la page, quand il y en a plusieurs (« 2/3 »), finit la ligne
 * du site sur la droite.
 */
export function dessinerPiedDePage(doc: Doc, numero: string | null = null): void {
  doc.path(COURBE).fill(BLEU);
  const TAILLE = 6.24;
  const ecrire = (texte: string, x: number, base: number) =>
    doc
      .font(police(doc, 'normal', 'exo'))
      .fontSize(TAILLE)
      .fillColor(ANTHRACITE)
      .text(texte, x, base, { lineBreak: false, baseline: 'alphabetic' });
  MENTIONS.societe.forEach((ligne, i) => ecrire(ligne, 52.7, 800.09 + i * 8.32));
  ecrire(MENTIONS.adresse[0], 244.4, 799.9);
  ecrire(MENTIONS.adresse[1], 244.4, 808.22);
  ecrire(MENTIONS.telephone, 244.4, 825.26);
  ecrire(MENTIONS.fax, 388.8, 800.15);
  ecrire(MENTIONS.courriel, 388.8, 812.26);
  ecrire(MENTIONS.site, 388.8, 824.95);
  if (numero) {
    doc.font(police(doc, 'normal', 'exo')).fontSize(TAILLE);
    ecrire(numero, PAPIER.droiteDuLogo - doc.widthOfString(numero), 824.95);
  }

  // Un pictogramme centré sur (x, y), de `cote` points : sans sa police, rien.
  const pictogramme = (code: number, x: number, y: number, cote = 7) => {
    const nom = police(doc, 'normal', 'symboles');
    if (!nom.startsWith('symboles')) return;
    doc.font(nom).fontSize(cote);
    const glyphe = (
      doc as unknown as {
        _font: { font: { glyphForCodePoint(c: number): { bbox: Boite } }; ascender: number };
      }
    )._font;
    const boite = glyphe.font.glyphForCodePoint(code).bbox;
    const k = cote / 960;
    // La boîte du glyphe, en unités de la police, ramenée au point voulu.
    const gauche = x - ((boite.minX + boite.maxX) / 2) * k;
    const base = y + ((boite.minY + boite.maxY) / 2) * k;
    doc.fillColor(BLEU).text(String.fromCodePoint(code), gauche, base, {
      lineBreak: false,
      baseline: 'alphabetic',
    });
  };
  pictogramme(PICTOGRAMMES.lieu, 238.5, 801, 8);
  pictogramme(PICTOGRAMMES.telephone, 238.5, 823.1);
  pictogramme(PICTOGRAMMES.fax, 382.3, 797.6);
  pictogramme(PICTOGRAMMES.courriel, 382.3, 809.6);
  pictogramme(PICTOGRAMMES.site, 382.3, 822.6);
}

/** La boîte d'un glyphe, en unités de la police. */
type Boite = { minX: number; minY: number; maxX: number; maxY: number };
