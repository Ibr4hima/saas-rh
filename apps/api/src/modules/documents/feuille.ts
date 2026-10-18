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

/** Un passage d'un paragraphe : du texte, en gras ou non, souligné ou non, en italique ou non. */
export interface Passage {
  texte: string;
  gras?: boolean;
  souligne?: boolean;
  italique?: boolean;
}

const ENCRE = '#111111';
const GRIS = '#5a5f75';
/** La marge de gauche et de droite des documents ; un modèle peut avoir la sienne. */
const MARGE_PAR_DEFAUT = 56;
const HAUT = 48;
/** Le bas du pied de page, au-dessus du bord de la feuille. */
const BAS_DU_PIED = 30;
/** Ce que le pied de page garde pour lui en bas de chaque page : le texte s'arrête au-dessus. */
const RESERVE_DU_PIED = 110;
/** L'espace insécable : la justification ne coupe ni n'étire ce qu'elle joint. */
const INSECABLE = '\u00a0';

/**
 * Ouvre une feuille.
 *
 * @param titre Le titre du PDF, celui que la visionneuse affiche.
 * @param famille La police de la feuille : Arial, celle des documents de la DCH (ADR-0090).
 * @param logo Le logo du pied de page ; par défaut, celui que l'exploitant a déposé.
 * @param marge Les marges de gauche et de droite, celles du modèle ; l'en-tête et le pied s'y calent.
 */
export function nouvelleFeuille({
  titre,
  famille = 'arial',
  logo = cheminLogo(),
  marge = MARGE_PAR_DEFAUT,
}: {
  titre: string;
  famille?: Famille;
  logo?: string | null;
  marge?: number;
}) {
  const MARGE = marge;
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
  /** La coupe d'un passage : gras, italique, les deux ou aucun. */
  const coupeDe = (gras: boolean, italique: boolean): Coupe =>
    gras ? (italique ? 'bold-italic' : 'bold') : italique ? 'italic' : 'normal';
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
    /** Le nombre de pages déjà ouvertes. */
    pages: () => doc.bufferedPageRange().count,

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

    /** L'en-tête d'un contrat : le bloc de la République seul, sans numéro ni date. */
    blocRepublique() {
      const bloc = dessinerBlocRepublique(doc, MARGE, HAUT);
      doc.y = HAUT + bloc.hauteur;
    },

    /** Le titre d'un contrat : centré, en gras, souligné. */
    titreSouligne(texte: string, { avant = 40 }: { avant?: number } = {}) {
      doc.y += avant;
      doc
        .font(coupe('bold'))
        .fontSize(12)
        .fillColor(ENCRE)
        .text(texte, MARGE, doc.y, { width: L, align: 'center', underline: true });
    },

    /** Le titre d'un contrat de travail : centré, en gras, dans un filet fin qui le serre. */
    titreCadre(
      texte: string,
      { avant = 40, taille = 12 }: { avant?: number; taille?: number } = {},
    ) {
      doc.y += avant;
      doc.font(coupe('bold')).fontSize(taille).fillColor(ENCRE);
      const largeur = doc.widthOfString(texte);
      const hauteur = doc.currentLineHeight();
      const x = MARGE + (L - largeur) / 2;
      const y = doc.y;
      doc.text(texte, x, y, { lineBreak: false });
      doc
        .rect(x - 2, y - 1, largeur + 4, hauteur + 2)
        .lineWidth(0.5)
        .strokeColor(ENCRE)
        .stroke();
      doc.y = y + hauteur;
    },

    /** La suite sur une nouvelle page. */
    sautDePage() {
      doc.addPage();
      doc.y = doc.page.margins.top;
    },

    /**
     * Les signatures, en deux colonnes : de chaque côté, en gras, qui signe
     * en haut et sa qualité en bas, l'espace entre les deux pour la signature.
     */
    signatures(
      gauche: readonly [string, string],
      droite: readonly [string, string],
      {
        avant = 30,
        espace = 70,
        taille = 11,
      }: { avant?: number; espace?: number; taille?: number } = {},
    ) {
      doc.y += avant;
      const colonne = L / 2;
      place(espace + 40);
      const y = doc.y;
      doc.font(coupe('bold')).fontSize(taille).fillColor(ENCRE);
      [gauche, droite].forEach(([haut, basDeColonne], i) => {
        const x = MARGE + i * colonne;
        doc.text(haut, x, y, { width: colonne, align: 'center', lineBreak: false });
        doc.text(basDeColonne, x, y + espace, {
          width: colonne,
          align: 'center',
          lineBreak: false,
        });
      });
      doc.y = y + espace + doc.currentLineHeight(true);
    },

    /** Le timbre : qui émet l'acte, sous l'en-tête, à gauche, à `retrait` de la marge, ou centré. */
    timbre(
      texte: string,
      {
        avant = 44,
        police: f = famille,
        taille = 11,
        align = 'left',
        retrait = 0,
      }: {
        avant?: number;
        police?: Famille;
        taille?: number;
        align?: 'left' | 'center';
        retrait?: number;
      } = {},
    ) {
      doc.y += avant;
      doc
        .font(police(doc, 'bold', f))
        .fontSize(taille)
        .fillColor(ENCRE);
      const x = align === 'center' ? MARGE + (L - doc.widthOfString(texte)) / 2 : MARGE + retrait;
      doc.text(texte, x, doc.y, { lineBreak: false });
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
     *
     * `retrait` décale le paragraphe vers la droite ; `puce` se pose dans ce
     * retrait, devant la première ligne : un élément de liste, sa puce calée
     * à droite au milieu du retrait, ou à `puceA` de la marge. `pas` fixe la
     * hauteur des lignes, au moins, comme l'interligne « au moins » de Word.
     * `align: 'left'` laisse les lignes en drapeau, `'right'` les cale à
     * droite, `'center'` les centre, sans justifier. La puce peut être une
     * étiquette mise en forme (« ANALYSE : ») ou « ▪ », le petit carré des
     * listes de Word, dessiné.
     */
    paragraphe(
      passages: readonly Passage[],
      {
        avant = 0,
        taille = 11,
        interligne = 3.5,
        pas,
        retrait = 0,
        retraitDroit = 0,
        puce,
        puceA,
        align = 'justify',
      }: {
        avant?: number;
        taille?: number;
        interligne?: number;
        pas?: number;
        retrait?: number;
        /** Le retrait du bord droit des lignes, depuis la marge de droite. */
        retraitDroit?: number;
        puce?: string | readonly Passage[];
        puceA?: number;
        align?: 'justify' | 'left' | 'right' | 'center';
      } = {},
    ) {
      doc.y += avant;
      const largeurUtile = L - retrait - retraitDroit;
      const mesurer = (texte: string, gras: boolean, italique = false) =>
        doc
          .font(coupe(coupeDe(gras, italique)))
          .fontSize(taille)
          .widthOfString(texte);

      type Morceau = {
        texte: string;
        gras: boolean;
        souligne: boolean;
        italique: boolean;
        largeur: number;
      };
      const mots: { morceaux: Morceau[]; largeur: number }[] = [];
      let enCours: Morceau[] = [];
      const clore = () => {
        if (enCours.length === 0) return;
        mots.push({ morceaux: enCours, largeur: enCours.reduce((s, m) => s + m.largeur, 0) });
        enCours = [];
      };
      for (const p of passages) {
        const gras = Boolean(p.gras);
        const souligne = Boolean(p.souligne);
        const italique = Boolean(p.italique);
        for (const bout of p.texte.split(/( )/)) {
          if (bout === ' ') clore();
          else if (bout) {
            enCours.push({
              texte: bout,
              gras,
              souligne,
              italique,
              largeur: mesurer(bout, gras, italique),
            });
          }
        }
      }
      clore();

      const espace = mesurer(' ', false);
      type Mot = (typeof mots)[number];
      const largeurDe = (morceaux: Morceau[]) => morceaux.reduce((s, m) => s + m.largeur, 0);
      const partie = (m: Morceau, texte: string): Morceau => ({
        ...m,
        texte,
        largeur: mesurer(texte, m.gras, m.italique),
      });
      /**
       * Le mot insécable coupé à la dernière de ses espaces insécables qui
       * laisse tenir sa tête dans `place` ; null s'il n'en a pas. Seules se
       * coupent celles qui séparent deux mots : jamais devant une
       * ponctuation, après « n° » ni entre des guillemets.
       */
      const couper = (mot: Mot, place: number): [Mot, Mot] | null => {
        let coupe: [Mot, Mot] | null = null;
        mot.morceaux.forEach((m, i) => {
          for (
            let k = m.texte.indexOf(INSECABLE);
            k !== -1;
            k = m.texte.indexOf(INSECABLE, k + 1)
          ) {
            const avant = k > 0 ? m.texte[k - 1] : mot.morceaux[i - 1]?.texte.at(-1);
            const apres = k < m.texte.length - 1 ? m.texte[k + 1] : mot.morceaux[i + 1]?.texte[0];
            if (!/[\p{L}\p{N}.]/u.test(avant ?? '') || !/[\p{L}\p{N}]/u.test(apres ?? '')) continue;
            const tete = [...mot.morceaux.slice(0, i), partie(m, m.texte.slice(0, k))].filter(
              (x) => x.texte,
            );
            const queue = [partie(m, m.texte.slice(k + 1)), ...mot.morceaux.slice(i + 1)].filter(
              (x) => x.texte,
            );
            const largeurTete = largeurDe(tete);
            if (largeurTete <= place) {
              coupe = [
                { morceaux: tete, largeur: largeurTete },
                { morceaux: queue, largeur: largeurDe(queue) },
              ];
            }
          }
        });
        return coupe;
      };
      const lignes: Mot[][] = [];
      let ligne: Mot[] = [];
      let largeur = 0;
      for (let mot of mots) {
        for (;;) {
          const ajout = ligne.length > 0 ? espace + mot.largeur : mot.largeur;
          if (largeur + ajout <= largeurUtile) {
            ligne.push(mot);
            largeur += ajout;
            break;
          }
          // Un mot insécable qui laisserait la ligne creuse, un nom à trois
          // prénoms par exemple, se coupe plutôt qu'étirer ses blancs.
          const coupe =
            largeur < largeurUtile * 0.6
              ? couper(mot, largeurUtile - largeur - (ligne.length > 0 ? espace : 0))
              : null;
          if (coupe) {
            lignes.push([...ligne, coupe[0]]);
            [ligne, largeur, mot] = [[], 0, coupe[1]];
          } else if (ligne.length === 0) {
            // Plus large que la ligne, et rien à couper : il dépasse.
            ligne.push(mot);
            largeur = mot.largeur;
            break;
          } else {
            lignes.push(ligne);
            [ligne, largeur] = [[], 0];
          }
        }
      }
      if (ligne.length > 0) lignes.push(ligne);

      doc.font(coupe('normal')).fontSize(taille);
      const hauteurLigne =
        pas === undefined
          ? doc.currentLineHeight(true) + interligne
          : Math.max(pas, doc.currentLineHeight(true));
      let y = doc.y;
      // Ni ligne seule en bas de page, ni ligne seule en haut de la suivante,
      // comme Word : un paragraphe qui se coupe en laisse deux de chaque côté.
      const tiennent = Math.floor((bas() - y) / hauteurLigne);
      const reste = lignes.length - tiennent;
      const coupure =
        reste <= 0
          ? -1
          : tiennent <= 1
            ? 0
            : reste > 1
              ? tiennent
              : tiennent >= 3
                ? tiennent - 1
                : 0;
      lignes.forEach((l, i) => {
        if (i === coupure || y + hauteurLigne > bas()) {
          doc.addPage();
          y = doc.page.margins.top;
        }
        const pleine = l.reduce((s, m) => s + m.largeur, 0);
        const derniere = i === lignes.length - 1;
        const ecart =
          align === 'justify' && !derniere && l.length > 1
            ? (largeurUtile - pleine) / (l.length - 1)
            : espace;
        if (puce === '▪' && i === 0) {
          // Le petit carré, dessiné : aucune police ne l'a sûrement, il se
          // centre sur la hauteur des minuscules.
          const cote = taille * 0.34;
          const base = y + taille * 0.9;
          doc.rect(MARGE + (puceA ?? 0), base - taille * 0.26 - cote / 2, cote, cote).fill(ENCRE);
        } else if (typeof puce === 'string' && i === 0) {
          doc.font(coupe('normal')).fontSize(taille).fillColor(ENCRE);
          const xPuce =
            puceA === undefined ? MARGE + retrait / 2 - doc.widthOfString(puce) : MARGE + puceA;
          doc.text(puce, xPuce, y, { lineBreak: false });
        } else if (puce && i === 0) {
          // Une étiquette mise en forme, devant la première ligne.
          let xEtiquette = MARGE + (puceA ?? 0);
          for (const e of puce as readonly Passage[]) {
            const largeurE = mesurer(e.texte, Boolean(e.gras), Boolean(e.italique));
            doc.fillColor(ENCRE).text(e.texte, xEtiquette, y, { lineBreak: false });
            if (e.souligne) {
              const sous = y + taille * 1.02;
              doc
                .moveTo(xEtiquette, sous)
                .lineTo(xEtiquette + largeurE, sous)
                .lineWidth(taille * 0.06)
                .strokeColor(ENCRE)
                .stroke();
            }
            xEtiquette += largeurE;
          }
        }
        const occupee = pleine + espace * (l.length - 1);
        let x =
          align === 'right'
            ? MARGE + L - retraitDroit - occupee
            : align === 'center'
              ? MARGE + retrait + (largeurUtile - occupee) / 2
              : MARGE + retrait;
        for (const mot of l) {
          for (const m of mot.morceaux) {
            doc
              .font(coupe(coupeDe(m.gras, m.italique)))
              .fontSize(taille)
              .fillColor(ENCRE)
              .text(m.texte, x, y, { lineBreak: false });
            if (m.souligne) {
              // Le trait sous la ligne de base, à l'épaisseur du corps.
              const sous = y + taille * 1.02;
              doc
                .moveTo(x, sous)
                .lineTo(x + m.largeur, sous)
                .lineWidth(taille * 0.06)
                .strokeColor(ENCRE)
                .stroke();
            }
            x += m.largeur;
          }
          x += ecart;
        }
        y += hauteurLigne;
      });
      doc.y = y;
    },

    /**
     * Une ligne de liste en deux colonnes : la puce à `puceA` de la marge, le
     * libellé à `retrait`, la valeur à `colonne`. « Salaire de base : 350 000
     * F CFA ».
     */
    ligneAColonne(
      libelle: string,
      valeur: string,
      {
        avant = 0,
        taille = 11,
        pas = 18,
        puce,
        puceA = 0,
        retrait = 0,
        colonne,
      }: {
        avant?: number;
        taille?: number;
        pas?: number;
        puce?: string;
        puceA?: number;
        retrait?: number;
        colonne: number;
      },
    ) {
      doc.y += avant;
      place(pas);
      const y = doc.y;
      doc.font(coupe('normal')).fontSize(taille).fillColor(ENCRE);
      if (puce) doc.text(puce, MARGE + puceA, y, { lineBreak: false });
      doc.text(libelle, MARGE + retrait, y, { lineBreak: false });
      doc.text(valeur, MARGE + colonne, y, { lineBreak: false });
      doc.y = y + Math.max(pas, doc.currentLineHeight(true));
    },

    /**
     * Un bloc en bas de page, à gauche, à côté du pied de l'APIX : les
     * ampliations d'une décision, le destinataire d'une lettre. Sa dernière
     * ligne finit à `finA` au-dessus du bas du pied ; une ligne vide se donne
     * sans passage. Les lignes commencent à `retrait` de la marge, l'étiquette
     * de la première (« À ») sur la marge. Si le texte de la page descend
     * jusque-là, le bloc passe à la page suivante.
     */
    piedAGauche(
      lignes: readonly (readonly Passage[])[],
      {
        taille = 10,
        pas = 11.5,
        finA = 28,
        police: f = famille,
        retrait = 0,
        etiquette,
      }: {
        taille?: number;
        pas?: number;
        finA?: number;
        police?: Famille;
        retrait?: number;
        etiquette?: readonly Passage[];
      } = {},
    ) {
      const haut = doc.page.height - BAS_DU_PIED - finA - lignes.length * pas;
      if (doc.y > haut - pas) doc.addPage();
      const ecrire = (passages: readonly Passage[], depuis: number, y: number) => {
        let x = depuis;
        for (const p of passages) {
          doc
            .font(police(doc, coupeDe(Boolean(p.gras), Boolean(p.italique)), f))
            .fontSize(taille)
            .fillColor(ENCRE);
          const largeur = doc.widthOfString(p.texte);
          doc.text(p.texte, x, y, { lineBreak: false });
          if (p.souligne) {
            const sous = y + taille * 1.02;
            doc
              .moveTo(x, sous)
              .lineTo(x + largeur, sous)
              .lineWidth(taille * 0.06)
              .strokeColor(ENCRE)
              .stroke();
          }
          x += largeur;
        }
      };
      // Écrire dans la marge du bas sans ouvrir de page, comme le pied.
      const marge = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      lignes.forEach((ligne, i) => {
        const y = haut + i * pas;
        if (i === 0 && etiquette) ecrire(etiquette, MARGE, y);
        ecrire(ligne, MARGE + retrait, y);
      });
      doc.page.margins.bottom = marge;
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
        const { milieu } = dessinerPiedApix(doc, { droite: MARGE + L, bas, logo });
        // Le numéro seul, sur la marge de gauche, à la hauteur du logo : le
        // champ PAGE des modèles Word. Ses chiffres se centrent sur le milieu.
        if (pages.count > 1) {
          doc
            .font(coupe('normal'))
            .fontSize(11)
            .fillColor(ENCRE)
            .text(String(i + 1), MARGE, milieu - 6, { lineBreak: false });
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
