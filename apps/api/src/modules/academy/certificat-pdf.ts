import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { frDate } from '../documents/redaction';
import {
  cheminLogo,
  chiffresAlignes,
  ENTETE,
  enregistrerPolices,
  police,
} from '../documents/entete';

/* ────────────────────────────────────────────────────────────────
   Le certificat d'APIX Academy, en PDF, à la charte de l'APIX (ADR-0185).

   Une page A4 à l'italienne, composée comme les supports de la charte de
   2026 : le logo en tête sur le blanc, un filet fin sous l'en-tête, le titre
   en Anton, le texte en Raleway, les mentions en Exo. En bas, la courbe
   bleue de la charte, soulignée d'orange comme sur le communiqué de presse,
   porte les ondulations du dos de la charte, les dates, la référence et le
   QR code. À cheval sur la courbe, un sceau dit le score, ou la formation
   validée.

   Le document dit ce qu'il atteste, et pas plus : une formation suivie en
   ligne et une évaluation réussie ; ou, sans évaluation, chacune de ses
   leçons validée (ADR-0049). Ce n'est pas un diplôme, et il ne le prétend
   pas.

   Tout est tracé en vecteurs, le QR code compris : net à l'impression, à
   n'importe quelle taille.
   ———————————————————————————————————————————————————————————————— */

/** Les couleurs de la charte : ses deux principales, et deux de ses secondaires. */
const BLEU = '#004f91';
const BLEU_PROFOND = '#003a6c';
const ORANGE = '#ca631f';
const ANTHRACITE = '#383838';
const ARDOISE = '#546775';
const BLANC = '#ffffff';

export interface DonneesCertificat {
  numero: string;
  titulaire: string;
  /** Absent pour un spécimen tiré par un compte sans dossier d'agent. */
  matricule: string | null;
  formation: string;
  organisation: string;
  /** `null` : une formation sans évaluation, suivie en entier. */
  score: number | null;
  emisLe: Date;
  expireLe: Date | null;
  /** L'adresse de la page de vérification, que porte le QR code. */
  urlVerification: string;
  /**
   * L'aperçu de la RH : barré « SPÉCIMEN » en travers de la page, et l'en-tête
   * dit qu'il ne se vérifie pas : un spécimen imprimé ne passe pour rien.
   */
  specimen?: boolean;
}

type Doc = typeof PDFDocument.prototype;

/** Le format de la page, A4 à l'italienne, et la marge des bords. */
const L = 841.89;
const H = 595.28;
const MARGE = 56;

/* ──── La courbe de la charte ────────────────────────────────────────

   Le bord supérieur de la courbe du papier à en-tête (entete.ts), tracé sur
   l'A4 en hauteur, ramené à la largeur de l'A4 à l'italienne : un croissant
   qui descend un peu après le bord gauche, puis monte vers la droite. Les
   trois arcs de Bézier, en points de la page. */
const ECHELLE = L / 595.28;
const DECALAGE = H - 841.89;
const ARCS: readonly (readonly [number, number])[][] = [
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
].map((arc) => arc.map(([x, y]) => [x! * ECHELLE, y! + DECALAGE] as const));

/** Le bord de la courbe, échantillonné de gauche à droite. */
const BORD: readonly (readonly [number, number])[] = ARCS.flatMap((arc, i) =>
  Array.from({ length: 41 }, (_, k) => k / 40)
    .slice(i === 0 ? 0 : 1)
    .map((t) => {
      const u = 1 - t;
      const [p0, p1, p2, p3] = arc as [
        readonly [number, number],
        readonly [number, number],
        readonly [number, number],
        readonly [number, number],
      ];
      const c = (k: 0 | 1) =>
        u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k];
      return [c(0), c(1)] as const;
    }),
);

/** La hauteur du bord de la courbe à l'abscisse `x`. */
function bordA(x: number): number {
  for (let i = 1; i < BORD.length; i += 1) {
    const [x1, y1] = BORD[i]!;
    const [x0, y0] = BORD[i - 1]!;
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0 || 1);
  }
  return BORD.at(-1)![1];
}

/** Le bord de la courbe, décalé de `dy`, puis fermé par le bas de la page. */
function tracerBande(doc: Doc, dy: number): void {
  const [premier, ...suite] = ARCS;
  doc.moveTo(premier![0]![0], premier![0]![1] + dy);
  for (const arc of [premier!, ...suite]) {
    const [, p1, p2, p3] = arc;
    doc.bezierCurveTo(p1![0], p1![1] + dy, p2![0], p2![1] + dy, p3![0], p3![1] + dy);
  }
  doc.lineTo(L, H).lineTo(0, H).closePath();
}

/**
 * La bande du bas : un liseré orange au-dessus de la courbe bleue, comme le
 * communiqué de presse de la charte ; sur le bleu, de fines ondulations,
 * celles du dos de la charte, assez pâles pour que le texte se lise dessus.
 */
function dessinerBande(doc: Doc): void {
  tracerBande(doc, -5);
  doc.fill(ORANGE);

  const fond = doc.linearGradient(0, 455, 0, H);
  fond.stop(0, BLEU).stop(1, BLEU_PROFOND);
  tracerBande(doc, 0);
  doc.fill(fond);

  doc.save();
  tracerBande(doc, 0);
  doc.clip();
  doc.lineWidth(0.55).strokeColor(BLANC).strokeOpacity(0.075);
  for (let i = 0; i < 26; i += 1) {
    const ecart = 7 + i * 5.4;
    const phase = i * 0.42;
    for (let x = -10; x <= L + 10; x += 6) {
      const y =
        bordA(Math.min(Math.max(x, 0), L)) +
        ecart +
        2.6 * Math.sin((2 * Math.PI * x) / 230 + phase) * (1 - i / 40);
      if (x === -10) doc.moveTo(x, y);
      else doc.lineTo(x, y);
    }
    doc.stroke();
  }
  doc.restore();
}

/**
 * Les ondulations de la charte sur le blanc, dans le coin opposé au logo :
 * des lignes bleues à peine visibles, qui s'effacent vers le centre, pour
 * répondre à la bande du bas sans rien gêner de ce qui se lit.
 */
function dessinerOndulations(doc: Doc): void {
  // Chaque ligne monte vers la droite, comme la courbe du bas, en quatre
  // tronçons de plus en plus nets : quatre opacités, pas une par segment.
  const depart = 500;
  const troncons = 4;
  const pas = (L + 10 - depart) / troncons;
  doc.save().lineWidth(0.6).strokeColor(BLEU);
  for (let t = 0; t < troncons; t += 1) {
    doc.strokeOpacity(0.035 + 0.035 * t);
    for (let k = 0; k < 22; k += 1) {
      for (let x = depart + t * pas; x <= depart + (t + 1) * pas + 0.1; x += 5) {
        const y =
          150 + k * 9 - 0.62 * (x - depart) + 9 * Math.sin((2 * Math.PI * x) / 300 + k * 0.22);
        if (x === depart + t * pas) doc.moveTo(x, y);
        else doc.lineTo(x, y);
      }
    }
    doc.stroke();
  }
  doc.restore();
}

/* ──── Le QR code ──────────────────────────────────────────────────── */

/** Le QR code, module par module, en carrés pleins. */
function dessinerQr(doc: Doc, texte: string, x: number, y: number, taille: number): void {
  const qr = QRCode.create(texte, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const pas = taille / n;
  doc.save().fillColor(BLEU_PROFOND);
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

/* ──── Le sceau ──────────────────────────────────────────────────────── */

/**
 * Un texte posé sur un cercle de centre (cx, cy) et de rayon r, centré sur
 * l'angle `milieu` (en degrés, 0 à droite, -90 en haut). Au-dessus du centre,
 * il se lit dans le sens des aiguilles d'une montre ; en dessous, dans
 * l'autre, pour se lire lui aussi de gauche à droite.
 */
function texteEnCercle(
  doc: Doc,
  texte: string,
  cx: number,
  cy: number,
  r: number,
  milieu: number,
  espacement: number,
): void {
  const enBas = milieu > 0 && milieu < 180;
  const lettres = [...texte];
  const largeurs = lettres.map((c) => doc.widthOfString(c) + espacement);
  const total = largeurs.reduce((a, b) => a + b, 0) - espacement;
  let angle = (milieu * Math.PI) / 180 + ((enBas ? 1 : -1) * total) / 2 / r;
  for (const [i, lettre] of lettres.entries()) {
    const pas = largeurs[i]! / r;
    const centre = angle + ((enBas ? -1 : 1) * (largeurs[i]! - espacement)) / 2 / r;
    const x = cx + r * Math.cos(centre);
    const y = cy + r * Math.sin(centre);
    const rotation = (centre * 180) / Math.PI + (enBas ? -90 : 90);
    doc.save();
    doc.translate(x, y).rotate(rotation);
    doc.text(lettre, -(largeurs[i]! - espacement) / 2, 0, {
      lineBreak: false,
      baseline: 'middle',
    });
    doc.restore();
    angle += (enBas ? -1 : 1) * pas;
  }
}

/** Le rayon de l'anneau intérieur du sceau, et l'air que le score y garde. */
const ANNEAU = 27.5;
const AIR = 4;

/** Où et à quel corps le score se pose, par rapport au centre du sceau. */
export interface PoseDuScore {
  corps: number;
  corpsPourcent: number;
  gauche: number;
  base: number;
  largeurValeur: number;
  ecart: number;
  /** Les coins des chiffres et du « % », qui doivent rester dans l'anneau. */
  coins: [number, number][];
}

/**
 * Le score dans l'anneau intérieur du sceau : les chiffres en Anton, centrés
 * un point au-dessus du centre (le centre optique), « % » plus petit à leur
 * suite. « 80 % » garde son corps de 25 points ; « 100 % », plus large, se
 * resserre jusqu'à garder son air de chaque côté.
 */
export function poseDuScore(doc: Doc, valeur: string): PoseDuScore {
  const essayer = (corps: number): PoseDuScore => {
    doc.font(police(doc, 'normal', 'anton')).fontSize(corps);
    const capitales = (doc as unknown as { _font: { capHeight: number } })._font.capHeight / 1000;
    const largeurValeur = doc.widthOfString(valeur);
    const corpsPourcent = corps * 0.48;
    const ecart = corps * 0.06;
    const largeur = largeurValeur + ecart + doc.fontSize(corpsPourcent).widthOfString('%');
    const gauche = -largeur / 2;
    const base = -1 + (capitales * corps) / 2;
    const haut = base - capitales * corps;
    return {
      corps,
      corpsPourcent,
      gauche,
      base,
      largeurValeur,
      ecart,
      coins: [
        [gauche, haut],
        [gauche + largeurValeur, haut],
        [gauche + largeur, base - capitales * corpsPourcent],
        [gauche, base],
        [gauche + largeur, base],
      ],
    };
  };
  let pose = essayer(25);
  while (pose.corps > 12 && pose.coins.some(([x, y]) => Math.hypot(x, y) > ANNEAU - AIR)) {
    pose = essayer(pose.corps - 0.5);
  }
  return pose;
}

/**
 * Le sceau de la réussite, à cheval sur la courbe : une rosace orange, un
 * disque bleu, « APIX ACADEMY » en haut de l'anneau, et au centre le score
 * en Anton ; sans évaluation, une coche, et « FORMATION » en bas de
 * l'anneau.
 */
function dessinerSceau(doc: Doc, cx: number, cy: number, score: number | null): void {
  const dents = 44;
  const exterieur = 50;
  const interieur = 46.6;
  doc.save();
  for (let k = 0; k <= dents * 2; k += 1) {
    const a = (Math.PI * k) / dents - Math.PI / 2;
    const r = k % 2 === 0 ? exterieur : interieur;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    if (k === 0) doc.moveTo(x, y);
    else doc.lineTo(x, y);
  }
  doc.closePath().fill(ORANGE);
  doc.circle(cx, cy, 44).fill(BLEU);
  doc.lineWidth(0.7).strokeColor(BLANC).strokeOpacity(0.55);
  doc.circle(cx, cy, 40.5).stroke();
  doc.circle(cx, cy, ANNEAU).stroke();
  doc.restore();

  doc.save().fillColor(BLANC);
  doc.font(police(doc, 'normal', 'exo')).fontSize(6.6);
  texteEnCercle(doc, 'APIX ACADEMY', cx, cy, 34, -90, 1.9);
  texteEnCercle(doc, score === null ? 'FORMATION' : 'RÉUSSITE', cx, cy, 34, 90, 1.9);
  for (const angle of [0, 180]) {
    const a = (angle * Math.PI) / 180;
    doc.circle(cx + 34 * Math.cos(a), cy + 34 * Math.sin(a), 1.1).fill(ORANGE);
  }
  doc.fillColor(BLANC);

  if (score !== null) {
    // Arrondi par défaut, comme partout : 79,6 % ne s'affiche jamais « 80 % ».
    const valeur = `${Math.floor(score * 100 + 1e-9)}`;
    const pose = poseDuScore(doc, valeur);
    const options = { lineBreak: false, baseline: 'alphabetic' } as const;
    doc.font(police(doc, 'normal', 'anton'));
    doc.fontSize(pose.corps).text(valeur, cx + pose.gauche, cy + pose.base, options);
    doc
      .fontSize(pose.corpsPourcent)
      .text('%', cx + pose.gauche + pose.largeurValeur + pose.ecart, cy + pose.base, options);
  } else {
    // Une coche tracée : la même à toute taille, sans dépendre d'une police.
    doc
      .lineWidth(3.2)
      .lineCap('round')
      .lineJoin('round')
      .strokeColor(BLANC)
      .strokeOpacity(1)
      .moveTo(cx - 10, cy + 0.5)
      .lineTo(cx - 3, cy + 7.5)
      .lineTo(cx + 11, cy - 7.5)
      .stroke();
  }
  doc.restore();
}

/* ──── Le certificat ──────────────────────────────────────────────── */

export function genererCertificatPdf(
  d: DonneesCertificat,
  { logo = cheminLogo() }: { logo?: string | null } = {},
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margin: 0,
    info: {
      Title: d.specimen
        ? `Spécimen de certificat : ${d.formation}`
        : `Certificat ${d.numero} : ${d.formation}`,
      Author: `${ENTETE.raisonSociale}, APIX Academy`,
      Subject: `${d.score === null ? 'Certificat de formation' : 'Certificat de réussite'} de ${d.titulaire}`,
    },
  });
  enregistrerPolices(doc);
  // Les chiffres alignés : Raleway écrit les siens à l'ancienne, et
  // « APX-109J » se lirait « 1o9J ».
  chiffresAlignes(doc);
  const morceaux: Buffer[] = [];
  doc.on('data', (c: Buffer) => morceaux.push(c));
  const fini = new Promise<Buffer>((resolve) =>
    doc.on('end', () => resolve(Buffer.concat(morceaux))),
  );

  const droite = L - MARGE;
  dessinerOndulations(doc);

  // ──── L'en-tête : le logo à gauche, sur le blanc et dans sa zone de
  // protection ; « APIX ACADEMY » à droite, centré sur la même ligne ; un
  // filet fin dessous, comme les pages de la charte.
  const milieuEnTete = 62;
  if (logo) {
    doc.image(logo, MARGE, milieuEnTete - 27, { fit: [176, 54], valign: 'center' });
  } else {
    doc
      .font(police(doc, 'normal', 'anton'))
      .fontSize(26)
      .fillColor(BLEU)
      .text('APIX', MARGE, milieuEnTete, { lineBreak: false, baseline: 'middle' });
  }
  doc
    .font(police(doc, 'normal', 'anton'))
    .fontSize(15)
    .fillColor(BLEU);
  const academie = 'APIX ACADEMY';
  doc.text(
    academie,
    droite - doc.widthOfString(academie, { characterSpacing: 1.6 }),
    milieuEnTete,
    {
      lineBreak: false,
      baseline: 'middle',
      characterSpacing: 1.6,
    },
  );
  doc
    .moveTo(MARGE, 100)
    .lineTo(droite, 100)
    .lineWidth(0.6)
    .strokeColor(BLEU)
    .strokeOpacity(0.55)
    .stroke()
    .strokeOpacity(1);

  // Seul le spécimen s'explique, pour la RH qui l'essaie.
  if (d.specimen) {
    doc
      .font(police(doc, 'italic'))
      .fontSize(8.5)
      .fillColor(ARDOISE)
      .text(
        'Spécimen : la référence et le QR code sont attribués à la réussite de l’agent.',
        L / 2 - 170,
        milieuEnTete,
        { width: 340, align: 'center', baseline: 'middle' },
      );
  }

  // ──── Le corps, centré, et centré en hauteur entre le filet de l'en-tête
  // et le haut du sceau : composé une fois pour se mesurer, une fois pour
  // s'écrire.
  const largeur = 600;
  const gauche = (L - largeur) / 2;
  const scoreEnTexte = d.score === null ? null : `${Math.floor(d.score * 100 + 1e-9)} %`;
  // Un nom long se resserre plutôt que de passer à la ligne.
  let corpsNom = 36;
  doc.font(police(doc, 'bold'));
  while (corpsNom > 24 && doc.fontSize(corpsNom).widthOfString(d.titulaire) > largeur) {
    corpsNom -= 1;
  }
  // Un titre long (jusqu'à 160 caractères) tiendrait sur trois lignes et
  // toucherait le sceau : il passe alors en plus petit.
  const intitule = `« ${d.formation} »`;
  doc.fontSize(20);
  const corpsIntitule =
    Math.round(doc.heightOfString(intitule, { width: largeur }) / doc.currentLineHeight(true)) > 2
      ? 16
      : 20;

  const composer = (haut: number, ecrire: boolean): number => {
    const centre = (
      texte: string,
      taille: number,
      y: number,
      {
        coupe = 'normal',
        famille = 'raleway',
        couleur = ANTHRACITE,
        espacement = 0,
      }: {
        coupe?: 'normal' | 'bold' | 'italic';
        famille?: 'raleway' | 'raleway-semibold' | 'anton' | 'exo';
        couleur?: string;
        espacement?: number;
      } = {},
    ) => {
      doc
        .font(police(doc, coupe, famille))
        .fontSize(taille)
        .fillColor(couleur);
      const options = { width: largeur, align: 'center', characterSpacing: espacement } as const;
      if (!ecrire) return y + doc.heightOfString(texte, options);
      doc.text(texte, gauche, y, options);
      return doc.y;
    };

    let y = centre('CERTIFICAT', 50, haut, { famille: 'anton', couleur: BLEU, espacement: 4 });
    y = centre(d.score === null ? 'DE FORMATION' : 'DE RÉUSSITE', 13.5, y - 4, {
      famille: 'raleway-semibold',
      couleur: ORANGE,
      espacement: 8,
    });
    // Un filet orange sous le titre.
    if (ecrire) doc.rect(L / 2 - 48, y + 12, 96, 2.4).fill(ORANGE);
    y = centre('décerné à', 12, y + 30, { coupe: 'italic', couleur: ARDOISE });
    y = centre(d.titulaire, corpsNom, y + 4, { coupe: 'bold' });
    if (d.matricule) {
      y = centre(`MATRICULE ${d.matricule}`, 8.5, y + 2, {
        famille: 'exo',
        couleur: ARDOISE,
        espacement: 1.4,
      });
    }
    y = centre('pour avoir suivi la formation en ligne', 12.5, y + 16, { couleur: ARDOISE });
    y = centre(intitule, corpsIntitule, y + 5, { coupe: 'bold', couleur: BLEU });

    // La dernière phrase, le score en orange : ce que le sceau répète. Ses
    // morceaux se mesurent et se posent l'un après l'autre, centrés ensemble.
    const morceaux: [texte: string, coupe: 'normal' | 'bold', couleur: string][] =
      scoreEnTexte === null
        ? [['et validé chacune de ses leçons.', 'normal', ARDOISE]]
        : [
            ['et réussi son évaluation finale avec un score de ', 'normal', ARDOISE],
            [scoreEnTexte, 'bold', ORANGE],
            ['.', 'normal', ARDOISE],
          ];
    const largeurs = morceaux.map(([texte, coupe]) =>
      doc.font(police(doc, coupe)).fontSize(12.5).widthOfString(texte),
    );
    const yPhrase = y + 7;
    if (ecrire) {
      let x = L / 2 - largeurs.reduce((a, b) => a + b, 0) / 2;
      for (const [i, [texte, coupe, couleur]] of morceaux.entries()) {
        doc
          .font(police(doc, coupe))
          .fontSize(12.5)
          .fillColor(couleur)
          .text(texte, x, yPhrase, { lineBreak: false });
        x += largeurs[i]!;
      }
    }
    return yPhrase + doc.font(police(doc, 'normal')).fontSize(12.5).currentLineHeight(true);
  };

  const hautDuSceau = bordA(L / 2) - 2 - 50;
  const hauteur = composer(0, false);
  composer(100 + Math.max(14, (hautDuSceau - 100 - hauteur) / 2), true);

  // ──── La bande du bas, puis ce qu'elle porte.
  dessinerBande(doc);
  dessinerSceau(doc, L / 2, bordA(L / 2) - 2, d.score);

  // À gauche, la date et la validité, chacune sous son intitulé.
  const etiquette = (texte: string, x: number, yy: number) =>
    doc
      .font(police(doc, 'normal', 'exo'))
      .fontSize(7)
      .fillColor(BLANC)
      .fillOpacity(0.72)
      .text(texte, x, yy, { lineBreak: false, characterSpacing: 1.6 })
      .fillOpacity(1);
  const valeur = (texte: string, x: number, yy: number) =>
    doc
      .font(police(doc, 'normal', 'raleway-semibold'))
      .fontSize(11)
      .fillColor(BLANC)
      .text(texte, x, yy, { lineBreak: false });
  etiquette('DÉLIVRÉ LE', MARGE, 553);
  valeur(frDate(d.emisLe), MARGE, 564);
  etiquette('VALIDITÉ', MARGE + 150, 553);
  valeur(d.expireLe ? `Jusqu’au ${frDate(d.expireLe)}` : 'Sans limite', MARGE + 150, 564);

  // À droite, le QR code sur une tuile blanche, et la référence à sa gauche.
  const tuile = 74;
  const xTuile = droite - tuile;
  const yTuile = H - 24 - tuile;
  doc.roundedRect(xTuile, yTuile, tuile, tuile, 8).fill(BLANC);
  dessinerQr(doc, d.urlVerification, xTuile + 7, yTuile + 7, tuile - 14);

  const finTexte = xTuile - 16;
  const aDroite = (texte: string, yy: number, espacement = 0) => {
    const w = doc.widthOfString(texte, { characterSpacing: espacement });
    doc.text(texte, finTexte - w, yy, { lineBreak: false, characterSpacing: espacement });
  };
  doc
    .font(police(doc, 'normal', 'exo'))
    .fontSize(7)
    .fillColor(BLANC)
    .fillOpacity(0.72);
  aDroite('RÉFÉRENCE', yTuile + 14, 1.6);
  doc.fillOpacity(1).font(police(doc, 'bold')).fontSize(13).fillColor(BLANC);
  aDroite(d.numero, yTuile + 25, 0.8);
  // L'adresse de la vérification, sans le protocole : pour qui n'a pas de
  // quoi lire le QR code.
  const adresse = d.urlVerification.replace(/^https?:\/\//, '');
  doc
    .font(police(doc, 'normal', 'exo'))
    .fontSize(7.5)
    .fillColor(BLANC)
    .fillOpacity(0.8);
  let corpsAdresse = 7.5;
  while (corpsAdresse > 5.5 && doc.fontSize(corpsAdresse).widthOfString(adresse) > 230) {
    corpsAdresse -= 0.5;
  }
  aDroite(adresse, yTuile + 46);
  doc.fillOpacity(1);

  // ──── Le spécimen : en travers, par-dessus tout, assez pâle pour se lire
  // dessous, assez grand pour ne jamais passer pour l'original.
  if (d.specimen) {
    doc.save();
    doc.rotate(-18, { origin: [L / 2, H / 2] });
    doc
      .fillOpacity(0.08)
      .font(police(doc, 'normal', 'anton'))
      .fontSize(130)
      .fillColor(BLEU)
      .text('SPÉCIMEN', 0, H / 2 - 80, { width: L, align: 'center', characterSpacing: 12 });
    doc.restore();
  }

  doc.end();
  return fini;
}
