import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import type { AcademyCategory } from '@teranga/contracts';
import { ACADEMY_CATEGORY_LABELS } from '@teranga/contracts';
import { frDate } from '../documents/attestation.service';
import { cheminLogo, ENTETE, enregistrerPolices, police } from '../documents/entete';

/* ————————————————————————————————————————————————————————————————
   Le certificat de réussite d'APIX Academy, en PDF.

   Une page A4 à l'italienne, dans le bleu de la marque : qui, quoi, avec
   quel score, quand, jusqu'à quand — et comment le vérifier. Le QR code
   mène à la page publique de vérification ; le numéro, imprimé dessous,
   permet la même vérification à la main.

   Le document dit ce qu'il atteste, et pas plus : une formation suivie en
   ligne et une évaluation réussie. Ce n'est pas un diplôme, et il ne le
   prétend pas.

   Le QR code est DESSINÉ en carrés vectoriels plutôt que collé en image :
   il reste net à l'impression, à n'importe quelle taille.
   ———————————————————————————————————————————————————————————————— */

const BLEU = '#004f91';
const ENCRE = '#14172a';
const GRIS = '#5a5f75';
const FILET = '#c9d6e6';

export interface DonneesCertificat {
  numero: string;
  titulaire: string;
  matricule: string;
  formation: string;
  famille: AcademyCategory;
  organisation: string;
  score: number;
  emisLe: Date;
  expireLe: Date | null;
  /** L'adresse de la page de vérification, que porte le QR code. */
  urlVerification: string;
}

type Doc = typeof PDFDocument.prototype;

/** Le QR code, module par module, en carrés pleins. */
function dessinerQr(doc: Doc, texte: string, x: number, y: number, taille: number): void {
  const qr = QRCode.create(texte, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const pas = taille / n;
  doc.save().fillColor(ENCRE);
  for (let ligne = 0; ligne < n; ligne += 1) {
    // Les modules sombres consécutifs d'une ligne en UN rectangle : dix fois
    // moins d'objets dans le PDF, et pas de joints visibles entre eux.
    let debut = -1;
    for (let col = 0; col <= n; col += 1) {
      const sombre = col < n && qr.modules.get(ligne, col) === 1;
      if (sombre && debut < 0) debut = col;
      if (!sombre && debut >= 0) {
        doc.rect(x + debut * pas, y + ligne * pas, (col - debut) * pas, pas);
        debut = -1;
      }
    }
  }
  doc.fill().restore();
}

export function genererCertificatPdf(d: DonneesCertificat): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margin: 0,
    info: {
      Title: `Certificat ${d.numero} — ${d.formation}`,
      Author: `${ENTETE.raisonSociale} — APIX Academy`,
      Subject: `Certificat de réussite de ${d.titulaire}`,
    },
  });
  enregistrerPolices(doc);
  const morceaux: Buffer[] = [];
  doc.on('data', (c: Buffer) => morceaux.push(c));
  const fini = new Promise<Buffer>((resolve) =>
    doc.on('end', () => resolve(Buffer.concat(morceaux))),
  );

  const L = doc.page.width;
  const H = doc.page.height;
  const cadre = 28;

  // ———— Le cadre : un trait de marque, un filet intérieur.
  doc
    .lineWidth(2.2)
    .strokeColor(BLEU)
    .roundedRect(cadre, cadre, L - 2 * cadre, H - 2 * cadre, 10)
    .stroke();
  doc
    .lineWidth(0.6)
    .strokeColor(FILET)
    .roundedRect(cadre + 8, cadre + 8, L - 2 * cadre - 16, H - 2 * cadre - 16, 7)
    .stroke();

  const gauche = 72;
  const largeur = L - 2 * gauche;

  // ———— L'en-tête : l'émetteur à gauche, l'Academy à droite.
  const logo = cheminLogo();
  if (logo) {
    // Borné dans les deux sens : un logo en largeur ou carré tient sa place
    // sans toucher « APIX ACADEMY », à droite.
    doc.image(logo, gauche, 62, { fit: [200, 46] });
  } else {
    doc.font(police(doc, 'bold')).fontSize(22).fillColor(BLEU).text('APIX', gauche, 68);
  }
  doc
    .font(police(doc, 'bold'))
    .fontSize(9)
    .fillColor(BLEU)
    .text('APIX ACADEMY', gauche, 66, { width: largeur, align: 'right', characterSpacing: 2.2 });
  doc
    .font(police(doc, 'normal'))
    .fontSize(9)
    .fillColor(GRIS)
    .text(ACADEMY_CATEGORY_LABELS[d.famille], gauche, 80, { width: largeur, align: 'right' });

  // ———— Le corps, centré.
  const centre = (
    texte: string,
    taille: number,
    coupe: 'normal' | 'bold' | 'italic',
    couleur: string,
    y: number,
    espacement = 0,
  ) => {
    doc
      .font(police(doc, coupe))
      .fontSize(taille)
      .fillColor(couleur)
      .text(texte, gauche, y, { width: largeur, align: 'center', characterSpacing: espacement });
    return doc.y;
  };

  let y = 138;
  y = centre('CERTIFICAT DE RÉUSSITE', 26, 'bold', BLEU, y, 3.5);
  doc
    .moveTo(L / 2 - 36, y + 12)
    .lineTo(L / 2 + 36, y + 12)
    .lineWidth(1.4)
    .strokeColor(BLEU)
    .stroke();
  y = centre('décerné à', 12, 'italic', GRIS, y + 30);
  y = centre(d.titulaire, 30, 'bold', ENCRE, y + 6);
  y = centre(`Matricule ${d.matricule}`, 10, 'normal', GRIS, y + 2);
  y = centre('pour avoir suivi la formation en ligne', 12, 'normal', GRIS, y + 18);
  y = centre(`« ${d.formation} »`, 18, 'bold', ENCRE, y + 6);
  // Arrondi par défaut, comme partout : 79,6 % ne s'affiche jamais « 80 % ».
  const score = `${Math.floor(d.score * 100 + 1e-9)} %`;
  centre(`et réussi son évaluation finale avec un score de ${score}.`, 12, 'normal', GRIS, y + 8);

  // ———— Le pied : date et validité à gauche, vérification à droite.
  const bas = H - 140;
  doc
    .moveTo(gauche, bas - 16)
    .lineTo(L - gauche, bas - 16)
    .lineWidth(0.5)
    .strokeColor(FILET)
    .stroke();

  doc
    .font(police(doc, 'normal'))
    .fontSize(10)
    .fillColor(ENCRE)
    .text(`Délivré à ${ENTETE.ville}, le ${frDate(d.emisLe)}`, gauche, bas);
  doc
    .fontSize(9.5)
    .fillColor(GRIS)
    .text(
      d.expireLe ? `Valable jusqu’au ${frDate(d.expireLe)}` : 'Sans limite de validité',
      gauche,
      doc.y + 3,
    );
  doc
    .font(police(doc, 'bold'))
    .fontSize(10)
    .fillColor(ENCRE)
    .text(`Pour ${d.organisation}`, gauche, doc.y + 16);
  doc
    .font(police(doc, 'normal'))
    .fontSize(9.5)
    .fillColor(GRIS)
    .text(ENTETE.service, gauche, doc.y + 2);

  const qr = 78;
  const xQr = L - gauche - qr;
  dessinerQr(doc, d.urlVerification, xQr, bas - 6, qr);
  const colonne = 230;
  doc
    .font(police(doc, 'bold'))
    .fontSize(10)
    .fillColor(ENCRE)
    .text(d.numero, xQr - colonne - 14, bas + 4, {
      width: colonne,
      align: 'right',
      characterSpacing: 0.6,
    });
  doc
    .font(police(doc, 'normal'))
    .fontSize(8.5)
    .fillColor(GRIS)
    .text('Vérifiez ce certificat en scannant le code, ou sur', xQr - colonne - 14, doc.y + 4, {
      width: colonne,
      align: 'right',
    });
  doc
    .fillColor(BLEU)
    .text(d.urlVerification.replace(/^https?:\/\//, ''), xQr - colonne - 14, doc.y + 1, {
      width: colonne,
      align: 'right',
    });

  doc.end();
  return fini;
}
