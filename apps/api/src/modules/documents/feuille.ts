import PDFDocument from 'pdfkit';
import type { SaisiesDuDocument } from '@teranga/contracts';
import type { Tx } from '../../db/tenant-db';
import {
  BLEU,
  cheminLogo,
  chiffresAlignes,
  dessinerEnTete,
  dessinerPiedDePage,
  ENTETE,
  enregistrerPolices,
  HAUT_DE_LA_COURBE,
  hautDeLaCourbe,
  ORANGE,
  police,
  type Coupe,
  type Famille,
} from './entete';
import { cedeA, lignesEquilibrees } from './composition';

/**
 * La feuille des documents de la DCH : une A4 sur le papier à en-tête de la
 * charte de l'APIX (ADR-0173), l'en-tête sur la première page, le pied de
 * page sur chacune, et les blocs d'un acte.
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

/**
 * Un passage d'un paragraphe : du texte, en gras ou non, souligné ou non, en
 * italique ou non ; rayé ou encadré, comme une mention d'un formulaire.
 */
export interface Passage {
  texte: string;
  gras?: boolean;
  souligne?: boolean;
  italique?: boolean;
  raye?: boolean;
  encadre?: boolean;
}

const ENCRE = '#111111';
const GRIS = '#5a5f75';
/** La marge de gauche et de droite des documents ; un modèle peut avoir la sienne. */
const MARGE_PAR_DEFAUT = 56;
/** Le haut du texte des pages qui suivent la première, sans en-tête. */
const HAUT = 48;
/**
 * Ce que le pied de page garde pour lui en bas de chaque page : le texte
 * s'arrête au-dessus de la courbe, avec un peu d'air.
 */
const RESERVE_DU_PIED = 841.89 - HAUT_DE_LA_COURBE + 6;
/** La marge du bas d'une feuille sans pied de page. */
const BAS_SANS_PIED = 36;
/** L'espace insécable : la justification ne coupe ni n'étire ce qu'elle joint. */
const INSECABLE = '\u00a0';

/**
 * Ouvre une feuille.
 *
 * @param titre Le titre du PDF, celui que la visionneuse affiche.
 * @param famille La police de la feuille : Raleway, celle de la charte (ADR-0173).
 * @param logo Le logo de l'en-tête ; par défaut, celui que l'exploitant a déposé.
 * @param marge Les marges de gauche et de droite du texte, celles du modèle. L'en-tête et
 *   le pied, imprimés d'avance sur le papier de la charte, ne s'y calent pas.
 * @param haut La marge du haut des pages qui suivent la première.
 * @param pied Le pied de page de l'APIX, sur chaque page ; un formulaire de l'administration
 *   s'en passe.
 */
export function nouvelleFeuille({
  titre,
  famille = 'raleway',
  logo = cheminLogo(),
  marge = MARGE_PAR_DEFAUT,
  haut = HAUT,
  pied = true,
}: {
  titre: string;
  famille?: Famille;
  logo?: string | null;
  marge?: number;
  haut?: number;
  pied?: boolean;
}) {
  const MARGE = marge;
  const doc = new PDFDocument({
    size: 'A4',
    margins: {
      top: haut,
      bottom: pied ? RESERVE_DU_PIED : BAS_SANS_PIED,
      left: MARGE,
      right: MARGE,
    },
    bufferPages: true,
    info: { Title: titre, Author: ENTETE.raisonSociale },
  });
  enregistrerPolices(doc);
  chiffresAlignes(doc);
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
     * L'en-tête : le papier de la charte, puis, à droite sous le logo, le
     * numéro de l'acte, laissé en pointillés pour qu'on le porte à la main,
     * et, un blanc plus bas, le lieu et la date, comme sur le courrier de la
     * charte. Les deux lignes partagent leur bord gauche, et la plus longue
     * finit sur la marge.
     */
    entete({ reference, lieuEtDate }: { reference: string; lieuEtDate: string }) {
      dessinerEnTete(doc, { logo });
      const TAILLE = 9.5;
      const BLANC = 84;
      const base = 144;
      doc.font(coupe('normal')).fontSize(TAILLE).fillColor(ENCRE);
      const largeurNumero = doc.widthOfString('N°');
      const largeurRef = largeurNumero + 3 + BLANC + 3 + doc.widthOfString(reference);
      const x = MARGE + L - Math.max(largeurRef, doc.widthOfString(lieuEtDate));
      const ecrire = (texte: string, xTexte: number, y: number) =>
        doc
          .font(coupe('normal'))
          .fontSize(TAILLE)
          .fillColor(ENCRE)
          .text(texte, xTexte, y, { lineBreak: false, baseline: 'alphabetic' });
      ecrire('N°', x, base);
      const xBlanc = x + largeurNumero + 3;
      doc
        .moveTo(xBlanc, base + 0.6)
        .lineTo(xBlanc + BLANC, base + 0.6)
        .lineWidth(0.7)
        .dash(0.8, { space: 2.2 })
        .strokeColor(GRIS)
        .stroke()
        .undash();
      ecrire(reference, xBlanc + BLANC + 3, base);
      // Plus bas qu'une ligne suivante : un blanc détache la date du numéro.
      const date = base + 22;
      ecrire(lieuEtDate, x, date);
      doc.y = date + TAILLE * 0.4;
    },

    /** L'en-tête d'un contrat : le papier de la charte seul, sans numéro ni date. */
    blocRepublique() {
      doc.y = dessinerEnTete(doc, { logo });
    },

    /**
     * Le titre d'un acte, comme ceux de la charte : en Anton, en capitales
     * bleues, centré, et souligné d'un court filet orange. Il tient sur une
     * ligne quand il le peut ; sinon sur deux lignes de longueurs voisines,
     * coupées entre deux mots là où elles s'équilibrent le mieux, quelles que
     * soient les coupures du modèle (« \n »).
     */
    titre(texte: string, { avant = 34, taille = 20 }: { avant?: number; taille?: number } = {}) {
      doc.y += avant;
      const ESPACEMENT = 0.3;
      const anton = police(doc, 'normal', 'anton');
      const mesurer = (t: string) =>
        doc.font(anton).fontSize(taille).widthOfString(t, { characterSpacing: ESPACEMENT });
      const mots = texte.toUpperCase().split(/\s+/).filter(Boolean);
      const entier = mots.join(' ');
      let lignes = [entier];
      if (mesurer(entier) > L * 0.92 && mots.length > 1) {
        // La coupure qui rend la plus longue des deux lignes la plus courte.
        let meilleure = 1;
        let largeurMax = Infinity;
        for (let i = 1; i < mots.length; i++) {
          const plus = Math.max(
            mesurer(mots.slice(0, i).join(' ')),
            mesurer(mots.slice(i).join(' ')),
          );
          if (plus < largeurMax) [meilleure, largeurMax] = [i, plus];
        }
        lignes = [mots.slice(0, meilleure).join(' '), mots.slice(meilleure).join(' ')];
      }
      const h = taille * 1.22;
      place(lignes.length * h + 14);
      // La ligne de base de la première ligne : la hauteur des capitales d'Anton.
      const premiere = doc.y + taille * 0.95;
      lignes.forEach((ligne, i) => {
        doc
          .font(anton)
          .fontSize(taille)
          .fillColor(BLEU)
          .text(ligne, MARGE, premiere + i * h, {
            width: L,
            align: 'center',
            lineBreak: false,
            characterSpacing: ESPACEMENT,
            baseline: 'alphabetic',
          });
      });
      const filet = premiere + (lignes.length - 1) * h + 8;
      doc
        .moveTo(MARGE + L / 2 - 18, filet)
        .lineTo(MARGE + L / 2 + 18, filet)
        .lineWidth(1.6)
        .strokeColor(ORANGE)
        .stroke();
      doc.y = filet + 2;
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
      [gauche, droite].forEach(([hautDeColonne, basDeColonne], i) => {
        const x = MARGE + i * colonne;
        doc.text(hautDeColonne, x, y, { width: colonne, align: 'center', lineBreak: false });
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
      // Un passage encadré prend, de chaque côté, l'air de son cadre.
      const AIR_DU_CADRE = taille * 0.22;

      type Morceau = {
        texte: string;
        gras: boolean;
        souligne: boolean;
        italique: boolean;
        raye: boolean;
        encadre: boolean;
        largeur: number;
      };
      const mots: { morceaux: Morceau[]; largeur: number; lie?: boolean }[] = [];
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
        const raye = Boolean(p.raye);
        const encadre = Boolean(p.encadre);
        for (const bout of p.texte.split(/( )/)) {
          if (bout === ' ') clore();
          else if (bout) {
            enCours.push({
              texte: bout,
              gras,
              souligne,
              italique,
              raye,
              encadre,
              largeur: mesurer(bout, gras, italique) + (encadre ? 2 * AIR_DU_CADRE : 0),
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
        largeur: mesurer(texte, m.gras, m.italique) + (m.encadre ? 2 * AIR_DU_CADRE : 0),
      });
      /**
       * Le mot insécable coupé à la dernière de ses espaces insécables qui
       * laisse tenir sa tête dans `place` ; null s'il n'en a pas. Seules se
       * coupent celles qui cèdent (`composition.ts`) : entre deux prénoms,
       * jamais après une civilité ni un nombre, ni devant une ponctuation.
       */
      const couper = (mot: Mot, place: number): [Mot, Mot] | null => {
        let coupe: [Mot, Mot] | null = null;
        const texteDuMot = mot.morceaux.map((m) => m.texte).join('');
        let debut = 0;
        mot.morceaux.forEach((m, i) => {
          for (
            let k = m.texte.indexOf(INSECABLE);
            k !== -1;
            k = m.texte.indexOf(INSECABLE, k + 1)
          ) {
            if (!cedeA(texteDuMot, debut + k)) continue;
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
          debut += m.texte.length;
        });
        return coupe;
      };
      /** Chaque ligne remplie au plus juste : un paragraphe en drapeau ou centré. */
      const lignesAuPlusJuste = (): Mot[][] => {
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
        return lignes;
      };
      // Justifié, le paragraphe se répartit sur toutes ses lignes à la fois,
      // un mot courant coupé s'il le faut, pour que ses blancs restent égaux
      // et proches de l'espace normal (`composition.ts`).
      const lignes: Mot[][] =
        align === 'justify'
          ? lignesEquilibrees(mots, { largeurUtile, espace, partie })
          : lignesAuPlusJuste();

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
        // Le trait sous la ligne de base, à l'épaisseur du corps.
        const souligner = (de: number, a: number) => {
          const sous = y + taille * 1.02;
          doc
            .moveTo(de, sous)
            .lineTo(a, sous)
            .lineWidth(taille * 0.06)
            .strokeColor(ENCRE)
            .stroke();
        };
        // Le trait à mi-hauteur des minuscules.
        const rayer = (de: number, a: number) => {
          const milieu = y + taille * 0.62;
          doc
            .moveTo(de, milieu)
            .lineTo(a, milieu)
            .lineWidth(taille * 0.07)
            .strokeColor(ENCRE)
            .stroke();
        };
        let precedent: { morceau: Morceau; fin: number } | null = null;
        for (const mot of l) {
          const premier = mot.morceaux[0];
          if (mot.lie && precedent && premier) {
            // Le blanc d'une espace insécable, que le trait d'un passage traverse.
            if (precedent.morceau.souligne && premier.souligne) souligner(precedent.fin, x);
            if (precedent.morceau.raye && premier.raye) rayer(precedent.fin, x);
          }
          for (const m of mot.morceaux) {
            doc
              .font(coupe(coupeDe(m.gras, m.italique)))
              .fontSize(taille)
              .fillColor(ENCRE)
              .text(m.texte, x + (m.encadre ? AIR_DU_CADRE : 0), y, { lineBreak: false });
            if (m.souligne) souligner(x, x + m.largeur);
            // Il déborde un peu du mot.
            if (m.raye) rayer(x - 1, x + m.largeur + 1);
            if (m.encadre) {
              // Le cadre serre la mention, de la ligne des capitales au bas des jambages.
              doc
                .rect(x, y - taille * 0.08, m.largeur, taille * 1.28)
                .lineWidth(taille * 0.07)
                .strokeColor(ENCRE)
                .stroke();
            }
            x += m.largeur;
          }
          const dernier = mot.morceaux.at(-1);
          precedent = dernier ? { morceau: dernier, fin: x } : null;
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
     * Un bloc en bas de page, à gauche, au-dessus de la courbe du pied : les
     * ampliations d'une décision, le destinataire d'une lettre. Sa dernière
     * ligne finit à `finA` au-dessus de la courbe ; une ligne vide se donne
     * sans passage. Les lignes commencent à `retrait` de la marge, l'étiquette
     * de la première (« À ») sur la marge. Si le texte de la page descend
     * jusque-là, le bloc passe à la page suivante.
     */
    piedAGauche(
      lignes: readonly (readonly Passage[])[],
      {
        taille = 10,
        pas = 11.5,
        finA = 9,
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
      const largeurDe = (passages: readonly Passage[]) =>
        passages.reduce(
          (s, p) =>
            s +
            doc
              .font(police(doc, coupeDe(Boolean(p.gras), Boolean(p.italique)), f))
              .fontSize(taille)
              .widthOfString(p.texte),
          0,
        );
      // La courbe monte vers la droite : le bloc se pose au-dessus de son
      // point le plus haut, sous toute la largeur de sa plus longue ligne.
      const droite = MARGE + retrait + Math.max(0, ...lignes.map(largeurDe));
      const sommet = hautDeLaCourbe(MARGE, droite) - finA - lignes.length * pas;
      if (doc.y > sommet - pas) doc.addPage();
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
        const y = sommet + i * pas;
        if (i === 0 && etiquette) ecrire(etiquette, MARGE, y);
        ecrire(ligne, MARGE + retrait, y);
      });
      doc.page.margins.bottom = marge;
    },

    /**
     * Le pied de page de l'APIX sur chaque page, numérotée quand il y en a
     * plusieurs, s'il y a un pied ; puis le PDF.
     */
    terminer(): Promise<Buffer> {
      const pages = doc.bufferedPageRange();
      for (let i = 0; pied && i < pages.count; i++) {
        doc.switchToPage(pages.start + i);
        // Écrire dans la marge du bas sans ouvrir de page : la marge est
        // levée le temps du pied.
        const marge = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        dessinerPiedDePage(doc, pages.count > 1 ? `${i + 1}/${pages.count}` : null);
        doc.page.margins.bottom = marge;
      }
      doc.end();
      return fini;
    },
  };
}

/** Une feuille ouverte : ce que `nouvelleFeuille` rend. */
export type Feuille = ReturnType<typeof nouvelleFeuille>;

/**
 * Comment un acte qui tient sur une page se resserre, s'il le faut : le
 * corps de son texte d'abord, d'un demi-point à la fois jusqu'à 10, ses
 * espaces ensuite seulement. Une page aérée en corps 10,5 se lit mieux
 * qu'une page tassée en corps 11.
 */
export const SERRAGES = [
  { corps: 11, espaces: 1 },
  { corps: 10.5, espaces: 1 },
  { corps: 10, espaces: 1 },
  { corps: 10, espaces: 0.8 },
  { corps: 10, espaces: 0.6 },
] as const;
export type Serrage = (typeof SERRAGES)[number];

/**
 * L'acte posé au premier serrage qui le tient sur ses `pages`, celles de son
 * modèle : les lettres, les attestations et les décisions sur une, un contrat
 * sur les siennes. Au plus serré, s'il déborde encore, il garde sa suite.
 */
export function surSesPages(
  pages: number,
  composer: (serrage: Serrage) => Feuille,
): Promise<Buffer> {
  for (const serrage of SERRAGES.slice(0, -1)) {
    const feuille = composer(serrage);
    if (feuille.pages() <= pages) return feuille.terminer();
  }
  return composer(SERRAGES[SERRAGES.length - 1]!).terminer();
}

/** L'acte sur une page : cf. `surSesPages`. */
export function surUnePage(composer: (serrage: Serrage) => Feuille): Promise<Buffer> {
  return surSesPages(1, composer);
}

/** Ce qu'une attestation de l'APIX imprime, bloc par bloc. */
export interface TextesDUneAttestation {
  reference: string;
  lieuEtDate: string;
  timbre: string;
  titre: string;
  paragraphes: Passage[][];
  /** La pièce jointe, sous le texte : « PJ : Certificat médical ». */
  pieceJointe?: string;
}

/**
 * Une attestation sur le modèle de l'APIX (ADR-0086), ou un certificat, qui
 * suit la même, sur le papier de la charte (ADR-0173) : l'en-tête, le
 * timbre, le titre, puis les paragraphes et, s'il y en a une, la pièce
 * jointe. L'espace sous le texte reste libre pour la signature et le cachet.
 * Elle tient sur une page, serrée s'il le faut (`surUnePage`).
 *
 * @param titre Le titre du PDF, celui que la visionneuse affiche.
 */
export function pdfDUneAttestation(
  textes: TextesDUneAttestation,
  { titre, logo }: { titre: string; logo?: string | null },
): Promise<Buffer> {
  return surUnePage(({ corps, espaces }) => {
    const feuille = nouvelleFeuille({ titre, logo });
    feuille.entete({ reference: textes.reference, lieuEtDate: textes.lieuEtDate });
    feuille.timbre(textes.timbre, { avant: 44 * espaces });
    feuille.titre(textes.titre, { avant: 34 * espaces });
    textes.paragraphes.forEach((p, i) =>
      feuille.paragraphe(p, { avant: (i === 0 ? 40 : 14) * espaces, taille: corps }),
    );
    if (textes.pieceJointe) {
      feuille.paragraphe(
        [
          { texte: 'PJ', gras: true, souligne: true },
          { texte: `${INSECABLE}: ${textes.pieceJointe}` },
        ],
        { avant: 40 * espaces, taille: corps, align: 'left' },
      );
    }
    return feuille;
  });
}
