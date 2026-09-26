import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
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
const DISQUE = '#eaf1f8';

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

/**
 * La médaille d'APIX Academy : le symbole « workspace_premium » de Material
 * Symbols, le même que dans l'application, redessiné en vecteur — la police
 * d'icônes ne s'embarque pas dans un PDF. Posée sur un disque bleu pâle.
 */
const TRACE_MEDAILLE =
  'm385-412 36-115-95-74h116l38-119 37 119h117l-95 74 35 115-94-71-95 71ZM244-40v-304q-45-47-64.5-103T160-560q0-136 92-228t228-92q136 0 228 92t92 228q0 57-19.5 113T716-344v304l-236-79-236 79Zm420.5-335.5Q740-451 740-560t-75.5-184.5Q589-820 480-820t-184.5 75.5Q220-669 220-560t75.5 184.5Q371-300 480-300t184.5-75.5ZM304-124l176-55 176 55v-171q-40 29-86 42t-90 13q-44 0-90-13t-86-42v171Zm176-86Z';

function dessinerMedaille(doc: Doc, cx: number, cy: number, diametre: number): void {
  doc
    .save()
    .circle(cx, cy, diametre / 2)
    .fill(DISQUE)
    .restore();
  const taille = diametre * 0.62;
  // Le symbole est dessiné dans une boîte de 960 unités, l'axe vertical
  // allant de -960 à 0 : on la ramène à `taille` points, centrée.
  doc
    .save()
    .translate(cx - taille / 2, cy - taille / 2)
    .scale(taille / 960)
    .translate(0, 960)
    .path(TRACE_MEDAILLE)
    .fill(BLEU)
    .restore();
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

  // ———— L'en-tête : l'émetteur à gauche, la médaille à droite.
  const logo = cheminLogo();
  if (logo) {
    doc.image(logo, gauche, 60, { fit: [190, 48] });
  } else {
    doc.font(police(doc, 'bold')).fontSize(22).fillColor(BLEU).text('APIX', gauche, 70);
  }
  dessinerMedaille(doc, L - gauche - 29, 84, 58);

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

  let y = 146;
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
  y = centre(`« ${d.formation} »`, 18, 'bold', ENCRE, y + 6);
  // Arrondi par défaut, comme partout : 79,6 % ne s'affiche jamais « 80 % ».
  const score = `${Math.floor(d.score * 100 + 1e-9)} %`;
  centre(`et réussi son évaluation finale avec un score de ${score}.`, 12, 'normal', GRIS, y + 8);

  // ———— Le pied : la date à gauche ; à droite, le QR code et son numéro,
  // juste dessous — on lit le numéro là où on scanne.
  const qr = 82;
  const hautQr = H - 160;
  const xQr = L - gauche - qr;
  doc
    .moveTo(gauche, hautQr - 18)
    .lineTo(L - gauche, hautQr - 18)
    .lineWidth(0.5)
    .strokeColor(FILET)
    .stroke();

  // La date, sa validité, et qui délivre — un bloc centré sur la hauteur du QR.
  const milieuQr = hautQr + qr / 2;
  doc
    .font(police(doc, 'normal'))
    .fontSize(10.5)
    .fillColor(ENCRE)
    .text(`Délivré le ${frDate(d.emisLe)}`, gauche, milieuQr - 27);
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
    .fontSize(9.5)
    .fillColor(BLEU)
    .text('APIX ACADEMY', gauche, doc.y + 13, { characterSpacing: 2 });

  dessinerQr(doc, d.urlVerification, xQr, hautQr, qr);
  // Centré sous le code — sans jamais passer la marge droite, que le QR
  // touche : un numéro plus large que lui s'y aligne plutôt.
  doc.font(police(doc, 'bold')).fontSize(9).fillColor(ENCRE);
  const espacement = 0.6;
  const largeurNumero = doc.widthOfString(d.numero, { characterSpacing: espacement });
  const xNumero = Math.min(xQr + (qr - largeurNumero) / 2, L - gauche - largeurNumero);
  doc.text(d.numero, xNumero, hautQr + qr + 7, {
    lineBreak: false,
    characterSpacing: espacement,
  });

  const colonne = 220;
  const xTexte = xQr - colonne - 16;
  doc.font(police(doc, 'normal')).fontSize(8.5).fillColor(GRIS);
  if (d.specimen) {
    doc.text(
      'Spécimen : le numéro et le QR code sont attribués à la réussite de l’agent.',
      xTexte,
      milieuQr - 12,
      { width: colonne, align: 'right' },
    );
  } else {
    doc.text('Scannez le code pour vérifier ce certificat,', xTexte, milieuQr - 12, {
      width: colonne,
      align: 'right',
    });
    doc.text('ou rendez-vous sur', xTexte, doc.y + 1, { width: colonne, align: 'right' });
    doc.fillColor(BLEU).text(d.urlVerification.replace(/^https?:\/\//, ''), xTexte, doc.y + 1, {
      width: colonne,
      align: 'right',
    });
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
