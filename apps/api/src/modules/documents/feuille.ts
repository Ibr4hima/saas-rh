import PDFDocument from 'pdfkit';
import type { Tx } from '../../db/tenant-db';
import {
  dessinerEntete,
  ENTETE,
  enregistrerPolices,
  police,
  type Coupe,
  type Famille,
} from './entete';

/**
 * La feuille des documents de la DCH : une A4 à l'en-tête de l'APIX, et les
 * blocs d'un acte, du titre à la signature.
 *
 * La mécanique vient des documents d'apix-e-voting (le procès-verbal, la
 * liste d'émargement) : une fonction ouvre la feuille et rend ses blocs, un
 * bloc qui ne tient plus en bas de page passe à la suivante, et le PDF se
 * rend une fois la dernière page posée.
 *
 * Les modèles de l'APIX se configurent un à un sur cette base (ADR-0085). Un
 * bloc s'ajoute quand un modèle le demande : un tableau, des lignes à
 * remplir, un pied de page numéroté.
 */

/** Un document généré : le nom de son fichier, et ses octets. */
export interface DocumentPdf {
  filename: string;
  pdf: Buffer;
}

/** Un modèle configuré : ce qu'il imprime pour un agent. */
export interface Modele {
  pdf(tx: Tx, employeeId: string): Promise<DocumentPdf>;
}

const ENCRE = '#111111';
const MARGE = 56;

/**
 * Ouvre une feuille.
 *
 * @param titre Le titre du PDF, celui que la visionneuse affiche.
 * @param famille La police de la feuille : Arial, sauf modèle contraire.
 */
export function nouvelleFeuille({
  titre,
  famille = 'arial',
}: {
  titre: string;
  famille?: Famille;
}) {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: MARGE, bottom: 90, left: MARGE, right: MARGE },
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

  /** Une nouvelle page si la hauteur ne tient plus dans celle-ci. */
  const place = (hauteur: number) => {
    if (doc.y + hauteur > doc.page.height - doc.page.margins.bottom) doc.addPage();
  };

  return {
    doc,
    L,
    MARGE,
    coupe,
    place,

    /** L'en-tête de l'APIX : la République à gauche, le logo à droite. */
    entete() {
      dessinerEntete(doc, MARGE);
    },

    /** Le titre de l'acte : capitales espacées, centrées, soulignées. */
    intitule(texte: string) {
      doc.moveDown(3);
      const ECART = 1.8;
      doc.font(coupe('bold')).fontSize(15).fillColor(ENCRE);
      // Le trait est tracé à la main plutôt que par `underline`, qui compte
      // l'espacement ajouté APRÈS la dernière lettre et débordait d'autant.
      const largeur = doc.widthOfString(texte, { characterSpacing: ECART }) - ECART;
      const y = doc.y;
      doc.text(texte, MARGE, y, { width: L, align: 'center', characterSpacing: ECART });
      const x = (doc.page.width - largeur) / 2;
      const souligne = y + doc.currentLineHeight() + 1;
      doc
        .moveTo(x, souligne)
        .lineTo(x + largeur, souligne)
        .lineWidth(0.9)
        .strokeColor(ENCRE)
        .stroke();
    },

    /** Le corps : des paragraphes justifiés, une ligne d'air entre deux. */
    paragraphes(textes: readonly string[]) {
      doc.moveDown(2.6);
      doc.font(coupe('normal')).fontSize(11).fillColor(ENCRE);
      textes.forEach((p, i) => {
        if (i > 0) doc.moveDown(1);
        doc.text(p, MARGE, doc.y, { width: L, align: 'justify', lineGap: 5 });
      });
    },

    /**
     * Le lieu et la date, puis la signature, à droite : la première ligne en
     * gras. Les deux ne se séparent pas : sans la place pour tout, ils passent
     * ensemble à la page suivante.
     */
    cloture({ lieuEtDate, signature }: { lieuEtDate: string; signature: readonly string[] }) {
      doc.font(coupe('normal')).fontSize(11).fillColor(ENCRE);
      place(doc.currentLineHeight(true) * (6 + signature.length));
      doc.moveDown(3);
      doc.text(lieuEtDate, MARGE, doc.y, { width: L, align: 'right' });
      doc.moveDown(2);
      signature.forEach((ligne, i) => {
        doc
          .font(coupe(i === 0 ? 'bold' : 'normal'))
          .text(ligne, MARGE, doc.y, { width: L, align: 'right' });
      });
    },

    /** Le PDF, une fois la dernière page posée. */
    terminer(): Promise<Buffer> {
      doc.end();
      return fini;
    },
  };
}
