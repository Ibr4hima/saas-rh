import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, win32 } from 'node:path';
import type PDFDocument from 'pdfkit';

/**
 * Ce qui est propre à l'APIX sur ses documents : le papier à en-tête de sa
 * charte graphique de 2026 (ADR-0173), en noir (ADR-0203). En tête, à
 * gauche, le drapeau du Sénégal au-dessus du bloc de la République ; à
 * droite, le logo. En pied de page, en bas à droite, les mentions de la
 * société derrière un filet, comme sur l'ancien papier de l'APIX, sans son
 * logo. Tout se compose en code, comme avant (ADR-0086) : rien à déposer que
 * le logo, un trait net à toute taille, et un seul endroit à corriger quand
 * une mention change.
 *
 * La typographie va avec : Raleway pour le texte, Anton pour les titres, Exo
 * pour les mentions du pied, les polices de la charte.
 */

type Doc = typeof PDFDocument.prototype;

const RACINE = join(__dirname, '..', '..', '..');

/**
 * L'encre des documents, la seule couleur de leur papier avec celles du
 * drapeau : le texte, les titres, leurs filets, le pied de page. Le bleu et
 * l'orange de la charte quittent les documents, plus administratifs en noir
 * (ADR-0203).
 */
export const ENCRE = '#111111';

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
 * Les mentions du pied de page, ligne par ligne, comme sur l'ancien papier à
 * en-tête de l'APIX, remises au propre (ADR-0203) : la société, son registre,
 * son adresse, ses numéros, son courriel et son site. Les mentions d'une
 * même ligne se séparent d'un point.
 */
export const MENTIONS: readonly (readonly string[])[] = [
  ['Société Anonyme à Participation Publique Majoritaire'],
  ['au Capital de 4.950.000.000 FCFA'],
  ['RCCM : SN DKR 2008 B 72', `NINEA : ${ENTETE.ninea}`],
  ['52-54, rue Mohamed V', 'BP 430 - CP 18524 Dakar SENEGAL'],
  ['Tél. (+221) 33 849 05 55', 'Fax (+221) 33 823 94 89'],
  ['infos@apix.sn', 'www.investinsenegal.sn'],
];

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
 * Arial (ADR-0090) et Times New Roman (ADR-0098),
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
  /** La largeur de la feuille A4. */
  largeur: 595.28,
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

/** Le pied de page, en bas à droite : les mentions, leur corps et leur interligne. */
const PIED = {
  taille: 6.8,
  pas: 9,
  /** La ligne de base de la dernière mention, à l'air du bas de la feuille. */
  derniereBase: 818,
  /** Le blanc entre le filet et les mentions, et l'épaisseur du filet, très fin. */
  blanc: 7.5,
  filet: 0.25,
  /** Le blanc de part et d'autre du point qui sépare deux mentions, et son rayon. */
  autourDuPoint: 4.2,
  rayonDuPoint: 0.55,
} as const;

/** La ligne de base de la première mention. */
const PREMIERE_BASE = PIED.derniereBase - (MENTIONS.length - 1) * PIED.pas;

/**
 * Le haut du pied de page : un bloc posé en bas à gauche d'une page, comme
 * les ampliations d'une décision, s'arrête au-dessus.
 */
export const HAUT_DU_PIED = PREMIERE_BASE - 10;

/**
 * Le pied de page : en bas à droite, les mentions de la société, alignées à
 * gauche derrière un filet très fin, le bloc calé sur le bord droit du logo,
 * comme l'ancien papier de l'APIX le faisait, sans son logo (ADR-0203). Les
 * mentions d'une ligne se séparent d'un point. Le numéro de la page, quand il
 * y en a plusieurs (« 2/3 »), se pose en bas à gauche, sur la ligne de la
 * dernière mention. Tout est à l'encre du texte.
 */
export function dessinerPiedDePage(doc: Doc, numero: string | null = null): void {
  const exo = police(doc, 'normal', 'exo');
  doc.font(exo).fontSize(PIED.taille);
  // Le point qui sépare deux mentions se dessine : le point médian de la
  // police, à ce corps, se voit à peine.
  const point = 2 * PIED.autourDuPoint;
  const largeurDe = (ligne: readonly string[]) =>
    ligne.reduce(
      (largeur, mention, i) => largeur + doc.widthOfString(mention) + (i > 0 ? point : 0),
      0,
    );
  const gauche = PAPIER.droiteDuLogo - Math.max(...MENTIONS.map(largeurDe));
  const ecrire = (texte: string, x: number, base: number) =>
    doc
      .font(exo)
      .fontSize(PIED.taille)
      .fillColor(ENCRE)
      .text(texte, x, base, { lineBreak: false, baseline: 'alphabetic' });

  MENTIONS.forEach((ligne, i) => {
    const base = PREMIERE_BASE + i * PIED.pas;
    let x = gauche;
    ligne.forEach((mention, j) => {
      if (j > 0) {
        // À mi-hauteur des capitales, comme un point médian.
        doc
          .circle(x + PIED.autourDuPoint, base - PIED.taille * 0.34, PIED.rayonDuPoint)
          .fill(ENCRE);
        x += point;
      }
      ecrire(mention, x, base);
      x += doc.widthOfString(mention);
    });
  });
  // Le filet, du haut des capitales de la première mention au bas de la dernière.
  const filet = gauche - PIED.blanc;
  doc
    .moveTo(filet, PREMIERE_BASE - PIED.taille * 0.95)
    .lineTo(filet, PIED.derniereBase + PIED.taille * 0.3)
    .lineWidth(PIED.filet)
    .strokeColor(ENCRE)
    .stroke();

  if (numero) ecrire(numero, PAPIER.largeur - PAPIER.droiteDuLogo, PIED.derniereBase);
}
