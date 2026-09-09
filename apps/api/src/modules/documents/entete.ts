import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type PDFDocument from 'pdfkit';

/**
 * L'en-tête des documents officiels, et la typographie qui va avec.
 *
 * Il vit à part de l'attestation : le contrat de travail, le certificat et
 * l'attestation de salaire porteront le même — un en-tête recopié dans chaque
 * générateur finit par diverger, et c'est l'entête d'une administration.
 */

type Doc = typeof PDFDocument.prototype;

const RACINE = join(__dirname, '..', '..', '..');

/**
 * L'en-tête de l'APIX, tel qu'il figure sur son papier.
 *
 * C'est une CONSTANTE et non des données : le produit est écrit pour une
 * agence. Le jour où une seconde organisation arrive, ce bloc devient des
 * colonnes de `tenants` (raison sociale, tutelle, ville) et la fonction reçoit
 * la ligne du tenant courant — la forme du dessin, elle, ne changera pas.
 */
export const ENTETE = {
  republique: 'REPUBLIQUE DU SENEGAL',
  devise: 'UN PEUPLE – UN BUT – UNE FOI',
  tutelle: ['PRESIDENCE DE LA REPUBLIQUE', 'SECRETARIAT GENERAL'],
  agence: 'Agence pour la Promotion des Investissements et des Grands Travaux',
  /** Raison sociale, telle qu'elle doit apparaître dans le corps des actes. */
  raisonSociale: 'APIX S.A',
  /** Service émetteur, qui signe. */
  service: 'Direction du Capital Humain',
  /** Lieu d'émission — « Fait à … ». */
  ville: 'Dakar',
} as const;

/**
 * L'en-tête de la République, tel qu'il figure à la charte.
 *
 * C'est une IMAGE et non du texte à recomposer : la disposition, la fonte et
 * l'espacement de ce bloc appartiennent à la charte graphique de l'agence, et
 * une recomposition, même fidèle, n'en serait qu'une imitation.
 */
function cheminEnteteRepublique(): string | null {
  const candidats = [
    join(RACINE, 'assets', 'entete-republique.png'),
    join(RACINE, 'assets', 'entete-republique.jpg'),
  ];
  return candidats.find((c) => existsSync(c)) ?? null;
}

/**
 * Le logo, cherché là où il peut être.
 *
 * pdfkit ne lit ni SVG ni woff2 : il lui faut un PNG ou un JPEG. On regarde
 * d'abord dans les ressources de l'API, puis dans celles du site — l'exploitant
 * n'a ainsi qu'un seul fichier à déposer, où que ce soit. Absent, l'en-tête se
 * dessine sans lui : un document sans logo reste un document, une erreur de
 * génération n'est rien.
 */
function cheminLogo(): string | null {
  const candidats = [
    join(RACINE, 'assets', 'logo-apix.png'),
    join(RACINE, '..', 'web', 'public', 'logo-apix.png'),
    join(RACINE, 'assets', 'logo-apix.jpg'),
  ];
  return candidats.find((c) => existsSync(c)) ?? null;
}

/** Les trois coupes de Google Sans, enregistrées sous des noms courts. */
export function enregistrerPolices(doc: Doc): void {
  const dir = join(RACINE, 'assets', 'fonts');
  const coupes: Array<[string, string]> = [
    ['gs', 'google-sans-regular.ttf'],
    ['gs-bold', 'google-sans-bold.ttf'],
    ['gs-italic', 'google-sans-italic.ttf'],
  ];
  for (const [nom, fichier] of coupes) {
    const chemin = join(dir, fichier);
    // Sans les polices, on retombe sur Helvetica plutôt que d'échouer : c'est
    // laid, ce n'est pas faux. `pnpm --filter @teranga/api fonts:fetch` remet
    // les fichiers en place.
    if (existsSync(chemin)) doc.registerFont(nom, readFileSync(chemin));
  }
}

/** Vrai si Google Sans a pu être enregistrée — sinon on nomme Helvetica. */
export function police(doc: Doc, coupe: 'normal' | 'bold' | 'italic'): string {
  const nom = coupe === 'bold' ? 'gs-bold' : coupe === 'italic' ? 'gs-italic' : 'gs';
  const secours =
    coupe === 'bold' ? 'Helvetica-Bold' : coupe === 'italic' ? 'Helvetica-Oblique' : 'Helvetica';
  try {
    doc.font(nom);
    return nom;
  } catch {
    return secours;
  }
}

/**
 * Dessine l'en-tête et rend l'ordonnée où le corps peut commencer.
 *
 * Deux colonnes : la République à gauche, le logo à droite. C'est la
 * disposition du papier à en-tête de l'agence — l'État d'abord, l'émetteur
 * ensuite.
 */
/**
 * Hauteurs de l'en-tête, en points.
 *
 * Un papier à en-tête d'administration porte ces deux blocs DISCRETS, calés
 * sur les bords : ils annoncent l'émetteur, ils ne sont pas le sujet de la
 * page. Ajustés à la largeur de leur colonne, ils prenaient le tiers de la
 * feuille et écrasaient l'acte.
 */
const HAUTEUR_ENTETE = 66;
const HAUTEUR_LOGO = 50;

export function dessinerEntete(doc: Doc, marge: number): number {
  const hautDePage = doc.y;
  const droite = doc.page.width - marge;

  // Le bloc de l'État se cale sur le bord gauche, le logo sur le bord droit :
  // c'est l'écart entre les deux qui fait l'en-tête, pas leur taille.
  const image = cheminEnteteRepublique();
  let basGauche: number;
  if (image) {
    doc.image(image, marge, hautDePage, { height: HAUTEUR_ENTETE });
    basGauche = hautDePage + HAUTEUR_ENTETE;
  } else {
    dessinerEnteteComposee(doc, marge, (droite - marge) * 0.62);
    basGauche = doc.y;
  }

  const logo = cheminLogo();
  if (logo) {
    const largeurLogo = largeurPour(doc, logo, HAUTEUR_LOGO);
    // Centré sur la hauteur du bloc d'État : les deux se répondent.
    const y = hautDePage + Math.max(0, (basGauche - hautDePage - HAUTEUR_LOGO) / 2);
    doc.image(logo, droite - largeurLogo, y, { height: HAUTEUR_LOGO });
  }

  // Un filet de cheveu, à peine posé : il sépare sans souligner. Le trait
  // épais d'avant faisait un bandeau là où il ne fallait qu'une limite.
  const y = basGauche + 12;
  doc.moveTo(marge, y).lineTo(droite, y).lineWidth(0.4).strokeColor('#9aa2b1').stroke();
  doc.y = y + 1;
  return doc.y;
}

/** La largeur d'une image ramenée à une hauteur donnée. */
function largeurPour(doc: Doc, chemin: string, hauteur: number): number {
  const img = doc.openImage(chemin);
  return (img.width * hauteur) / img.height;
}

/**
 * Le bloc composé au plomb, quand l'image de la charte n'a pas été déposée.
 *
 * Ce n'est PAS l'en-tête officiel : c'en est la transcription, aux mêmes mots,
 * pour qu'un document sorte quand même. Déposer `assets/entete-republique.png`
 * la remplace aussitôt.
 */
function dessinerEnteteComposee(doc: Doc, marge: number, colonneGauche: number): void {
  const ligne = (
    texte: string,
    coupe: 'normal' | 'bold' | 'italic',
    taille: number,
    ecart = 1.6,
  ) => {
    doc.font(police(doc, coupe)).fontSize(taille).fillColor('#111111');
    doc.text(texte, marge, doc.y, { width: colonneGauche, align: 'center', lineGap: 0 });
    doc.y += ecart;
  };
  /** Le séparateur du papier officiel : cinq astérisques, rien d'autre. */
  const separateur = () => ligne('*****', 'normal', 8, 2.5);

  ligne(ENTETE.republique, 'bold', 11);
  ligne(ENTETE.devise, 'italic', 8.5);
  separateur();
  ligne(ENTETE.tutelle[0], 'bold', 11);
  separateur();
  ligne(ENTETE.tutelle[1], 'normal', 10.5);
  separateur();
  ligne(ENTETE.agence, 'normal', 9.5, 0);
}
