import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { frDate } from '../documents/attestation.service';
import { cheminLogo, ENTETE, enregistrerPolices, police } from '../documents/entete';

/* ————————————————————————————————————————————————————————————————
   Le certificat de réussite d'APIX Academy, en PDF.

   Une page A4 à l'italienne, dans le bleu de la marque : qui, quoi, avec
   quel score, quand, jusqu'à quand — et comment le vérifier. Le QR code,
   en haut à droite, mène à la page publique de vérification ; la référence,
   en bas à droite, permet la même vérification à la main.

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
  /** Absent pour un spécimen tiré par un compte sans dossier d'agent. */
  matricule: string | null;
  formation: string;
  organisation: string;
  score: number;
  emisLe: Date;
  expireLe: Date | null;
  /** L'adresse de la page de vérification, que porte le QR code. */
  urlVerification: string;
  /**
   * L'aperçu de la RH : barré « SPÉCIMEN » en travers de la page, et le pied
   * dit qu'il ne se vérifie pas — un spécimen imprimé ne passe pour rien.
   */
  specimen?: boolean;
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
      Title: d.specimen
        ? `Spécimen de certificat — ${d.formation}`
        : `Certificat ${d.numero} — ${d.formation}`,
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

  // ———— Le cadre : deux filets fins, un bleu, un pâle. Un trait épais
  // alourdissait la page ; deux lignes fines l'encadrent sans la serrer.
  doc
    .lineWidth(1.1)
    .strokeColor(BLEU)
    .roundedRect(cadre, cadre, L - 2 * cadre, H - 2 * cadre, 14)
    .stroke();
  doc
    .lineWidth(0.5)
    .strokeColor(FILET)
    .roundedRect(cadre + 7, cadre + 7, L - 2 * cadre - 14, H - 2 * cadre - 14, 10)
    .stroke();

  const gauche = 72;
  const largeur = L - 2 * gauche;

  // ———— L'en-tête : l'émetteur à gauche, le QR code à droite — les deux
  // centrés sur la même ligne.
  const qr = 72;
  const hautQr = 64;
  const milieuEnTete = hautQr + qr / 2;
  const logo = cheminLogo();
  if (logo) {
    doc.image(logo, gauche, milieuEnTete - 24, { fit: [190, 48], valign: 'center' });
  } else {
    doc
      .font(police(doc, 'bold'))
      .fontSize(22)
      .fillColor(BLEU)
      .text('APIX', gauche, milieuEnTete - 14);
  }
  dessinerQr(doc, d.urlVerification, L - gauche - qr, hautQr, qr);

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

  let y = 184;
  y = centre('CERTIFICAT DE RÉUSSITE', 27, 'bold', BLEU, y, 4);
  doc
    .moveTo(L / 2 - 32, y + 13)
    .lineTo(L / 2 + 32, y + 13)
    .lineWidth(1.2)
    .strokeColor(BLEU)
    .stroke();
  y = centre('décerné à', 12, 'italic', GRIS, y + 30);
  y = centre(d.titulaire, 32, 'bold', ENCRE, y + 6);
  if (d.matricule) y = centre(`Matricule ${d.matricule}`, 10, 'normal', GRIS, y + 3);
  y = centre('pour avoir suivi la formation en ligne', 12, 'normal', GRIS, y + 20);
  // Un titre long (jusqu'à 160 caractères) tiendrait sur trois lignes et
  // pousserait le score contre le pied : il passe alors en plus petit.
  const intitule = `« ${d.formation} »`;
  doc.font(police(doc, 'bold')).fontSize(18);
  const lignes = Math.round(
    doc.heightOfString(intitule, { width: largeur }) / doc.currentLineHeight(true),
  );
  y = centre(intitule, lignes > 2 ? 15 : 18, 'bold', ENCRE, y + 6);
  // Arrondi par défaut, comme partout : 79,6 % ne s'affiche jamais « 80 % ».
  const score = `${Math.floor(d.score * 100 + 1e-9)} %`;
  centre(`et réussi son évaluation finale avec un score de ${score}.`, 12, 'normal', GRIS, y + 8);

  // ———— Le pied, sur deux lignes qui se répondent : la date et sa validité
  // à gauche ; la référence et l'émetteur à droite.
  const filet = H - 128;
  doc
    .moveTo(gauche, filet)
    .lineTo(L - gauche, filet)
    .lineWidth(0.5)
    .strokeColor(FILET)
    .stroke();
  const ligne1 = filet + 22;
  const ligne2 = ligne1 + 17;
  const droite = L - gauche;

  doc
    .font(police(doc, 'normal'))
    .fontSize(10.5)
    .fillColor(ENCRE)
    .text(`Délivré le ${frDate(d.emisLe)}`, gauche, ligne1, { lineBreak: false });
  doc
    .fontSize(9.5)
    .fillColor(GRIS)
    .text(
      d.expireLe ? `Valable jusqu’au ${frDate(d.expireLe)}` : 'Sans limite de validité',
      gauche,
      ligne2,
      { lineBreak: false },
    );

  const aDroite = (texte: string, y: number, espacement = 0) => {
    const largeurTexte = doc.widthOfString(texte, { characterSpacing: espacement });
    doc.text(texte, droite - largeurTexte, y, { lineBreak: false, characterSpacing: espacement });
  };
  doc.font(police(doc, 'bold')).fontSize(10.5);
  const largeurNumero = doc.widthOfString(d.numero, { characterSpacing: 0.6 });
  doc
    .font(police(doc, 'normal'))
    .fontSize(10.5)
    .fillColor(GRIS)
    .text('REF : ', droite - largeurNumero - doc.widthOfString('REF : '), ligne1, {
      lineBreak: false,
    });
  doc.font(police(doc, 'bold')).fillColor(ENCRE);
  aDroite(d.numero, ligne1, 0.6);
  doc.fontSize(9.5).fillColor(BLEU);
  aDroite('APIX ACADEMY', ligne2, 2);

  // Seul le spécimen s'explique, pour la RH qui l'essaie.
  if (d.specimen) {
    const colonne = 300;
    doc
      .font(police(doc, 'normal'))
      .fontSize(8.5)
      .fillColor(GRIS)
      .text(
        'Spécimen : la référence et le QR code sont attribués à la réussite de l’agent.',
        L / 2 - colonne / 2,
        ligne1 + 1,
        { width: colonne, align: 'center' },
      );
  }

  // ———— Le spécimen : en travers, par-dessus tout, assez pâle pour se lire
  // dessous, assez grand pour ne jamais passer pour l'original.
  if (d.specimen) {
    doc.save();
    doc.rotate(-18, { origin: [L / 2, H / 2] });
    doc
      .fillOpacity(0.09)
      .font(police(doc, 'bold'))
      .fontSize(118)
      .fillColor(BLEU)
      .text('SPÉCIMEN', 0, H / 2 - 66, { width: L, align: 'center', characterSpacing: 10 });
    doc.restore();
  }

  doc.end();
  return fini;
}
