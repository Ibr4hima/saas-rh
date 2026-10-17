import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
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
  /** Lieu d'émission : « Dakar, le … ». */
  ville: 'Dakar',
} as const;

/** Les mentions du pied de page, ligne par ligne, telles que l'APIX les imprime. */
export const MENTIONS = [
  'Société Anonyme à Participation Publique Majoritaire',
  'au Capital de 4.950.000.000 FCFA - RCCM : SN DKR 2008 B 72',
  'NINEA : 28409592G3',
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

/** Les familles des documents : Google Sans, la police principale, et Comic Sans MS. */
export type Famille = 'google-sans' | 'comic';

/**
 * Où trouver chaque coupe, par ordre de préférence, depuis `assets/`.
 *
 * Comic Sans MS ne se versionne pas : sa licence l'interdit. L'exploitant qui
 * en a la licence dépose les fichiers à la racine des ressources, sous leur
 * nom Windows, et ils passent devant ; sinon Comic Relief, libre et versionnée
 * dans `fonts/`, prend la place, aux mêmes chasses.
 */
const FICHIERS: Record<Famille, Partial<Record<Coupe, readonly string[]>>> = {
  'google-sans': {
    normal: ['fonts/google-sans-regular.ttf'],
    bold: ['fonts/google-sans-bold.ttf'],
    italic: ['fonts/google-sans-italic.ttf'],
  },
  comic: {
    normal: ['comic.ttf', 'fonts/comic-relief-regular.ttf'],
    bold: ['comicbd.ttf', 'fonts/comic-relief-bold.ttf'],
    // Comic Relief n'a pas d'italique : sans les fichiers d'origine, le romain.
    italic: ['comici.ttf'],
    'bold-italic': ['comicz.ttf'],
  },
};

/** Un fichier des ressources, quelle que soit la casse de son nom : COMIC.TTF vaut comic.ttf. */
function ressource(chemin: string): string | null {
  const complet = join(RACINE, 'assets', chemin);
  if (existsSync(complet)) return complet;
  const dossier = dirname(complet);
  const nom = basename(complet).toLowerCase();
  const trouve = existsSync(dossier)
    ? readdirSync(dossier).find((f) => f.toLowerCase() === nom)
    : undefined;
  return trouve ? join(dossier, trouve) : null;
}

/** Les polices des documents, enregistrées sous `famille-coupe` : « google-sans-bold ». */
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
export function police(doc: Doc, coupe: Coupe, famille: Famille = 'google-sans'): string {
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
 */
export function dessinerPiedApix(
  doc: Doc,
  { droite, bas, logo }: { droite: number; bas: number; logo: string | null },
): void {
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
}
