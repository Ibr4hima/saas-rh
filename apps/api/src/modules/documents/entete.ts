import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, win32 } from 'node:path';
import type PDFDocument from 'pdfkit';

/**
 * Ce qui est propre à l'APIX sur ses documents (ADR-0086) : en tête, à
 * gauche, le bloc de la République ; en pied de page, à droite, le logo, une
 * barre bleue et les mentions de la société. Les deux se composent en code,
 * comme dans apix-e-voting : rien à déposer, un texte net à toute taille, et
 * un seul endroit à corriger quand une mention change.
 *
 * La typographie va avec : Google Sans, celle d'apix-e-voting, et Comic Sans
 * MS pour ce que les modèles de l'APIX écrivent avec elle.
 */

type Doc = typeof PDFDocument.prototype;

const RACINE = join(__dirname, '..', '..', '..');

const ENCRE = '#111111';
/** Le bleu de l'APIX, celui de la barre du pied de page. */
const BLEU = '#004f91';

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

/** Les mentions du pied de page, ligne par ligne, telles que l'APIX les imprime. */
export const MENTIONS = [
  'Société Anonyme à Participation Publique Majoritaire',
  'au Capital de 4.950.000.000 FCFA - RCCM : SN DKR 2008 B 72',
  `NINEA : ${ENTETE.ninea}`,
  '52-54, rue Mohamed V – BP 430 CP18524 Dakar SENEGAL',
  'Tel (+221) 33 849 05 55 – Fax (+221) 33 823 94 89',
  'www.investinsenegal.com',
  'mail : infos@apix.sn',
] as const;

/**
 * Le logo, cherché là où il peut être.
 *
 * pdfkit ne lit ni SVG ni woff2 : il lui faut un PNG ou un JPEG. On regarde
 * d'abord dans les ressources de l'API, puis dans celles du site : l'exploitant
 * n'a qu'un fichier à déposer, où que ce soit. Absent, le pied de page se
 * dessine sans lui : un document sans logo reste un document.
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
 * Les familles des documents : Arial, la police principale (ADR-0090), Times
 * New Roman, celle des contrats de travail (ADR-0098), Comic Sans MS pour ce
 * que les modèles de l'APIX écrivent avec elle, Gill Sans MT, celle des
 * grilles d'évaluation (ADR-0149), Google Sans, celle du certificat d'APIX
 * Academy, et une écriture manuscrite, celle des paraphes des signataires
 * d'une grille (ADR-0151).
 */
export type Famille = 'arial' | 'times' | 'comic' | 'gill-sans' | 'google-sans' | 'signature';

/**
 * Où les systèmes rangent Arial, Times New Roman et Comic Sans MS, quand ils
 * les ont : Windows et macOS de série, Debian et Ubuntu avec le paquet
 * officiel des polices de Microsoft (`ttf-mscorefonts-installer`). `windows` :
 * le nom du fichier sous Windows, que reprend le paquet ; `macos` : celui de
 * macOS.
 */
const surLeSysteme = (windows: string, macos?: string) => [
  `C:\\Windows\\Fonts\\${windows}`,
  `/usr/share/fonts/truetype/msttcorefonts/${windows}`,
  ...(macos ? [`/System/Library/Fonts/Supplemental/${macos}`] : []),
];

/**
 * Où trouver chaque coupe, par ordre de préférence, depuis `assets/`.
 *
 * Arial, Times New Roman, Comic Sans MS et Gill Sans MT ne se versionnent
 * pas : leur licence l'interdit (ADR-0090). Le générateur prend celles que
 * l'exploitant dépose à la racine des ressources, sous leur nom Windows, puis
 * celles du serveur. Sans elles, leurs équivalents libres, versionnés dans
 * `fonts/`, prennent la place, aux mêmes chasses : la mise en page ne bouge
 * pas d'un caractère. Gill Sans MT n'en a pas aux mêmes chasses : Cabin, de
 * la même famille humaniste, la remplace, et une grille la place à sa mesure.
 */
const FICHIERS: Record<Famille, Partial<Record<Coupe, readonly string[]>>> = {
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
  comic: {
    normal: [
      'comic.ttf',
      ...surLeSysteme('comic.ttf', 'Comic Sans MS.ttf'),
      'fonts/comic-relief-regular.ttf',
    ],
    bold: [
      'comicbd.ttf',
      ...surLeSysteme('comicbd.ttf', 'Comic Sans MS Bold.ttf'),
      'fonts/comic-relief-bold.ttf',
    ],
    // Comic Relief n'a pas d'italique : sans les fichiers d'origine, le romain.
    italic: ['comici.ttf', ...surLeSysteme('comici.ttf')],
    'bold-italic': ['comicz.ttf', ...surLeSysteme('comicz.ttf')],
  },
  'gill-sans': {
    normal: ['GIL_____.TTF', ...surLeSysteme('GIL_____.TTF'), 'fonts/cabin-regular.ttf'],
    bold: ['GILB____.TTF', ...surLeSysteme('GILB____.TTF'), 'fonts/cabin-bold.ttf'],
    italic: ['GILI____.TTF', ...surLeSysteme('GILI____.TTF'), 'fonts/cabin-italic.ttf'],
    'bold-italic': ['GILBI___.TTF', ...surLeSysteme('GILBI___.TTF'), 'fonts/cabin-bold-italic.ttf'],
  },
  'google-sans': {
    normal: ['fonts/google-sans-regular.ttf'],
    bold: ['fonts/google-sans-bold.ttf'],
    italic: ['fonts/google-sans-italic.ttf'],
  },
  signature: {
    normal: ['fonts/allura-regular.ttf'],
  },
};

/**
 * Un fichier des ressources, ou du serveur si son chemin est absolu, quelle
 * que soit la casse de son nom : COMIC.TTF vaut comic.ttf.
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

/** Les polices des documents, enregistrées sous `famille-coupe` : « arial-bold ». */
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
export function police(doc: Doc, coupe: Coupe, famille: Famille = 'arial'): string {
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

/** Une ligne du bloc de la République : texte, coupe, corps, air dessous. */
type Ligne = [texte: string, coupe: Coupe, taille: number, ecart: number];

/** L'échelle du bloc, celle d'apix-e-voting. */
const ECHELLE = 0.8;

/**
 * Le bloc de la République, composé comme dans apix-e-voting : République et
 * devise, tutelle, secrétariat, puis l'agence sur deux lignes, séparés par
 * cinq astérisques. Aussi large que sa plus longue ligne, chaque ligne centrée
 * sur cette largeur. Rend ses dimensions.
 */
export function dessinerBlocRepublique(
  doc: Doc,
  x: number,
  y: number,
): { largeur: number; hauteur: number } {
  const etoiles: Ligne = ['*****', 'normal', 5.5 * ECHELLE, 0.5];
  const lignes: Ligne[] = [
    [ENTETE.republique, 'bold', 8.6 * ECHELLE, 0.5],
    [ENTETE.devise, 'italic', 6.4 * ECHELLE, 0.3],
    etoiles,
    [ENTETE.tutelle[0], 'bold', 8.6 * ECHELLE, 0.5],
    etoiles,
    [ENTETE.tutelle[1], 'normal', 7.8 * ECHELLE, 0.5],
    etoiles,
    ...ENTETE.agenceLignes.map((t): Ligne => [t, 'normal', 7.2 * ECHELLE, 0.2]),
  ];
  const mesures = lignes.map(([texte, coupe, taille]) => {
    doc.font(police(doc, coupe)).fontSize(taille);
    // Un interlignage serré (1,15) : la hauteur naturelle de la police
    // espaçait trop ces huit lignes.
    return {
      largeur: doc.widthOfString(texte),
      hauteur: taille * (texte === '*****' ? 1.25 : 1.15),
    };
  });
  const largeur = Math.max(...mesures.map((m) => m.largeur));
  let bas = y;
  lignes.forEach(([texte, coupe, taille, ecart], i) => {
    doc
      .font(police(doc, coupe))
      .fontSize(taille)
      .fillColor(ENCRE)
      .text(texte, x, bas, { width: largeur, align: 'center', lineBreak: false });
    bas += mesures[i]!.hauteur + ecart;
  });
  return { largeur, hauteur: bas - y };
}

/**
 * Le pied de page de l'APIX : le logo, une barre verticale bleue, puis les
 * mentions de la société. Calé sur la marge de droite, son bas sur `bas`.
 * Rend la hauteur du milieu de la barre, où le logo se centre.
 */
export function dessinerPiedApix(
  doc: Doc,
  { droite, bas, logo }: { droite: number; bas: number; logo: string | null },
): { milieu: number } {
  const TAILLE = 6;
  const PAS = 7.6;
  // La barre dépasse les mentions d'autant en haut et en bas.
  const DEBORD = 4;
  doc.font(police(doc, 'normal')).fontSize(TAILLE);
  const largeur = Math.max(...MENTIONS.map((l) => doc.widthOfString(l)));
  const hauteurBarre = MENTIONS.length * PAS + 2 * DEBORD;
  const haut = bas - hauteurBarre;
  const xTexte = droite - largeur;
  const xBarre = xTexte - 8;

  doc.moveTo(xBarre, haut).lineTo(xBarre, bas).lineWidth(1.2).strokeColor(BLEU).stroke();
  MENTIONS.forEach((ligne, i) => {
    doc
      .font(police(doc, 'normal'))
      .fontSize(TAILLE)
      .fillColor(ENCRE)
      .text(ligne, xTexte, haut + DEBORD + i * PAS, { lineBreak: false });
  });
  if (logo) {
    const HAUTEUR_LOGO = 24;
    const image = doc.openImage(logo);
    const largeurLogo = (image.width * HAUTEUR_LOGO) / image.height;
    doc.image(image, xBarre - 10 - largeurLogo, haut + (hauteurBarre - HAUTEUR_LOGO) / 2, {
      height: HAUTEUR_LOGO,
    });
  }
  return { milieu: haut + hauteurBarre / 2 };
}
