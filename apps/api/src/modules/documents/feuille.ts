import PDFDocument from 'pdfkit';
import type { SaisiesDuDocument } from '@teranga/contracts';
import type { Tx } from '../../db/tenant-db';
import {
  cheminLogo,
  dessinerBlocRepublique,
  dessinerPiedApix,
  ENTETE,
  enregistrerPolices,
  police,
  type Coupe,
  type Famille,
} from './entete';

/**
 * La feuille des documents de la DCH : une A4 aux sections de l'APIX (le
 * bloc de la République en tête, le pied de page sur chaque page), et les
 * blocs d'un acte.
 *
 * La mécanique vient des documents d'apix-e-voting : une fonction ouvre la
 * feuille et rend ses blocs, un bloc qui ne tient plus en bas de page passe à
 * la suivante, et le pied de page se pose sur chaque page une fois la
 * dernière écrite.
 *
 * Les modèles de l'APIX se configurent un à un sur cette base (ADR-0085,
 * ADR-0086). Un bloc s'ajoute quand un modèle le demande.
 */

/** Un document généré : le nom de son fichier, et ses octets. */
export interface DocumentPdf {
  filename: string;
  pdf: Buffer;
}

/**
 * Un modèle configuré : ce qu'il imprime pour un agent, avec ce que la DCH a
 * saisi et que le dossier ne porte pas (ADR-0087). Chaque modèle exige ce
 * qu'il demande.
 */
export interface Modele {
  pdf(tx: Tx, employeeId: string, saisies: SaisiesDuDocument): Promise<DocumentPdf>;
}

/** Un passage d'un paragraphe : du texte, en gras ou non. */
export interface Passage {
  texte: string;
  gras?: boolean;
}

const ENCRE = '#111111';
const GRIS = '#5a5f75';
const MARGE = 56;
const HAUT = 48;
/** Le bas du pied de page, au-dessus du bord de la feuille. */
const BAS_DU_PIED = 30;
/** Ce que le pied de page garde pour lui en bas de chaque page : le texte s'arrête au-dessus. */
const RESERVE_DU_PIED = 110;

/**
 * Ouvre une feuille.
 *
 * @param titre Le titre du PDF, celui que la visionneuse affiche.
 * @param famille La police de la feuille : Arial, celle des documents de la DCH (ADR-0090).
 * @param logo Le logo du pied de page ; par défaut, celui que l'exploitant a déposé.
 */
export function nouvelleFeuille({
  titre,
  famille = 'arial',
  logo = cheminLogo(),
}: {
  titre: string;
  famille?: Famille;
  logo?: string | null;
}) {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: HAUT, bottom: RESERVE_DU_PIED, left: MARGE, right: MARGE },
    bufferPages: true,
    info: { Title: titre, Author: ENTETE.raisonSociale },
  });
  enregistrerPolices(doc);
  const morceaux: Buffer[] = [];
  doc.on('data', (m: Buffer) => morceaux.push(m));
  const fini = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(morceaux)));
    doc.on('error', reject);
  });

  const L = doc.page.width - MARGE * 2;
  const coupe = (c: Coupe) => police(doc, c, famille);
  const bas = () => doc.page.height - doc.page.margins.bottom;

  /** Une nouvelle page si la hauteur ne tient plus dans celle-ci. */
  const place = (hauteur: number) => {
    if (doc.y + hauteur > bas()) doc.addPage();
  };

  return {
    doc,
    L,
    MARGE,
    coupe,
    place,

    /**
     * L'en-tête : le bloc de la République à gauche ; à droite, le numéro de
     * l'acte, laissé en pointillés pour qu'on le porte à la main, puis le lieu
     * et la date. Les deux lignes de droite partagent leur bord gauche, et la
     * plus longue finit sur la marge.
     */
    entete({ reference, lieuEtDate }: { reference: string; lieuEtDate: string }) {
      const y = HAUT;
      const bloc = dessinerBlocRepublique(doc, MARGE, y);
      const TAILLE = 10.5;
      const BLANC = 84;
      doc.font(coupe('bold')).fontSize(TAILLE).fillColor(ENCRE);
      const largeurNumero = doc.widthOfString('N°');
      const largeurRef = largeurNumero + 3 + BLANC + 3 + doc.widthOfString(reference);
      const x = MARGE + L - Math.max(largeurRef, doc.widthOfString(lieuEtDate));
      doc.text('N°', x, y, { lineBreak: false });
      const xBlanc = x + largeurNumero + 3;
      const ligne = y + TAILLE * 0.98;
      doc
        .moveTo(xBlanc, ligne)
        .lineTo(xBlanc + BLANC, ligne)
        .lineWidth(0.7)
        .dash(0.8, { space: 2.2 })
        .strokeColor(GRIS)
        .stroke()
        .undash();
      doc
        .font(coupe('bold'))
        .fontSize(TAILLE)
        .fillColor(ENCRE)
        .text(reference, xBlanc + BLANC + 3, y, { lineBreak: false });
      doc.text(lieuEtDate, x, y + 30, { lineBreak: false });
      doc.y = y + bloc.hauteur;
    },

    /** Le timbre : qui émet l'acte, sous l'en-tête, à gauche. */
    timbre(
      texte: string,
      { avant = 44, police: f = famille }: { avant?: number; police?: Famille } = {},
    ) {
      doc.y += avant;
      doc
        .font(police(doc, 'bold', f))
        .fontSize(11)
        .fillColor(ENCRE)
        .text(texte, MARGE, doc.y, { lineBreak: false });
      doc.y += doc.currentLineHeight(true);
    },

    /**
     * Le titre de l'acte, centré dans un cadre gris : un filet épais dehors,
     * un filet fin dedans, le fond gris entre les deux, comme sur le modèle.
     */
    titreEncadre(texte: string, { avant = 34 }: { avant?: number } = {}) {
      doc.y += avant;
      const RETRAIT = 32;
      const HAUTEUR = 56;
      const RENTRE = 3.4;
      place(HAUTEUR);
      const x = MARGE + RETRAIT;
      const largeur = L - 2 * RETRAIT;
      const y = doc.y;
      doc.rect(x, y, largeur, HAUTEUR).lineWidth(2.2).strokeColor(ENCRE).stroke();
      doc
        .rect(x + RENTRE, y + RENTRE, largeur - 2 * RENTRE, HAUTEUR - 2 * RENTRE)
        .lineWidth(0.6)
        .fillAndStroke('#e0e0e0', ENCRE);
      doc.font(coupe('bold')).fontSize(17).fillColor(ENCRE);
      const h = doc.currentLineHeight();
      doc.text(texte, x, y + (HAUTEUR - h) / 2, {
        width: largeur,
        align: 'center',
        lineBreak: false,
      });
      doc.y = y + HAUTEUR;
    },

    /**
     * Un paragraphe justifié, gras et romain mêlés.
     *
     * pdfkit ne justifie pas une ligne faite de plusieurs morceaux
     * (`continued`) : la première ligne d'un paragraphe qui changeait de
     * graisse restait en drapeau. La feuille compose donc elle-même : des
     * mots (un mot peut changer de graisse en son milieu, « BATHILY, »), des
     * lignes remplies au plus juste, et l'espace qui reste réparti entre les
     * mots, sauf sur la dernière ligne. L'espace insécable lie deux mots.
     */
    paragraphe(
      passages: readonly Passage[],
      {
        avant = 0,
        taille = 11,
        interligne = 3.5,
      }: { avant?: number; taille?: number; interligne?: number } = {},
    ) {
      doc.y += avant;
      const mesurer = (texte: string, gras: boolean) =>
        doc
          .font(coupe(gras ? 'bold' : 'normal'))
          .fontSize(taille)
          .widthOfString(texte);

      type Morceau = { texte: string; gras: boolean; largeur: number };
      const mots: { morceaux: Morceau[]; largeur: number }[] = [];
      let enCours: Morceau[] = [];
      const clore = () => {
        if (enCours.length === 0) return;
        mots.push({ morceaux: enCours, largeur: enCours.reduce((s, m) => s + m.largeur, 0) });
        enCours = [];
      };
      for (const p of passages) {
        const gras = Boolean(p.gras);
        for (const bout of p.texte.split(/( )/)) {
          if (bout === ' ') clore();
          else if (bout) enCours.push({ texte: bout, gras, largeur: mesurer(bout, gras) });
        }
      }
      clore();

      const espace = mesurer(' ', false);
      const lignes: (typeof mots)[] = [];
      let ligne: typeof mots = [];
      let largeur = 0;
      for (const mot of mots) {
        const ajout = ligne.length > 0 ? espace + mot.largeur : mot.largeur;
        if (ligne.length > 0 && largeur + ajout > L) {
          lignes.push(ligne);
          ligne = [mot];
          largeur = mot.largeur;
        } else {
          ligne.push(mot);
          largeur += ajout;
        }
      }
      if (ligne.length > 0) lignes.push(ligne);

      doc.font(coupe('normal')).fontSize(taille);
      const hauteurLigne = doc.currentLineHeight(true) + interligne;
      let y = doc.y;
      lignes.forEach((l, i) => {
        if (y + hauteurLigne > bas()) {
          doc.addPage();
          y = doc.page.margins.top;
        }
        const pleine = l.reduce((s, m) => s + m.largeur, 0);
        const derniere = i === lignes.length - 1;
        const ecart = !derniere && l.length > 1 ? (L - pleine) / (l.length - 1) : espace;
        let x = MARGE;
        for (const mot of l) {
          for (const m of mot.morceaux) {
            doc
              .font(coupe(m.gras ? 'bold' : 'normal'))
              .fontSize(taille)
              .fillColor(ENCRE)
              .text(m.texte, x, y, { lineBreak: false });
            x += m.largeur;
          }
          x += ecart;
        }
        y += hauteurLigne;
      });
      doc.y = y;
    },

    /**
     * Le pied de page de l'APIX sur chaque page, numérotée quand il y en a
     * plusieurs, puis le PDF.
     */
    terminer(): Promise<Buffer> {
      const pages = doc.bufferedPageRange();
      for (let i = 0; i < pages.count; i++) {
        doc.switchToPage(pages.start + i);
        // Écrire dans la marge du bas sans ouvrir de page : la marge est
        // levée le temps du pied.
        const marge = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        const bas = doc.page.height - BAS_DU_PIED;
        dessinerPiedApix(doc, { droite: MARGE + L, bas, logo });
        if (pages.count > 1) {
          doc
            .font(coupe('normal'))
            .fontSize(7.5)
            .fillColor(GRIS)
            .text(`Page ${i + 1} sur ${pages.count}`, MARGE, bas - 9, { lineBreak: false });
        }
        doc.page.margins.bottom = marge;
      }
      doc.end();
      return fini;
    },
  };
}

/** Ce qu'une attestation de l'APIX imprime, bloc par bloc. */
export interface TextesDUneAttestation {
  reference: string;
  lieuEtDate: string;
  timbre: string;
  titre: string;
  paragraphes: Passage[][];
}

/**
 * Une attestation sur le modèle de l'APIX (ADR-0086), ou un certificat, qui
 * suit la même : l'en-tête, le timbre en Comic Sans MS, comme sur le modèle,
 * le titre encadré, puis les paragraphes. L'espace sous le texte reste libre
 * pour la signature et le cachet.
 *
 * @param titre Le titre du PDF, celui que la visionneuse affiche.
 */
export function pdfDUneAttestation(
  textes: TextesDUneAttestation,
  { titre, logo }: { titre: string; logo?: string | null },
): Promise<Buffer> {
  const feuille = nouvelleFeuille({ titre, logo });
  feuille.entete({ reference: textes.reference, lieuEtDate: textes.lieuEtDate });
  feuille.timbre(textes.timbre, { police: 'comic' });
  feuille.titreEncadre(textes.titre);
  textes.paragraphes.forEach((p, i) => feuille.paragraphe(p, { avant: i === 0 ? 40 : 14 }));
  return feuille.terminer();
}
