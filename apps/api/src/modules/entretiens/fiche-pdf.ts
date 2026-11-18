import PDFDocument from 'pdfkit';
import {
  competencesDe,
  dateEnLettres,
  LIBELLES_DU_PERSONNEL,
  NIVEAUX,
  NIVEAUX_D_ATTEINTE,
  NIVEAUX_DE_COMPETENCE,
  PERSONNELS_DE_LA_FICHE,
  QUESTIONS_DES_SOUHAITS,
  QUESTIONS_DU_BILAN,
  REFERENCE_DE_LA_FICHE,
  SYNTHESE_GENERALE,
  TITRE_DE_LA_FICHE,
  type AutoEvaluation,
  type EvaluationDuN1,
  type Niveau,
  type ObjectifEvalue,
  type PartieReservee,
  type PersonnelDeLaFiche,
} from '@teranga/contracts';
import {
  chiffresAlignes,
  dessinerPiedDePage,
  ENCRE,
  ENTETE,
  enregistrerPolices,
  HAUT_DU_PIED,
  police,
  type Coupe,
  type Famille,
} from '../documents/entete';

/* ────────────────────────────────────────────────────────────────
   La fiche d'entretien annuel d'évaluation, en PDF (ADR-0205, ADR-0206).

   Chaque page porte l'en-tête du modèle de la DCH : « DCH », le titre de la
   fiche, puis le bloc de la République, la référence de la fiche et le
   numéro de la page. En pied, les mentions de la société (ADR-0203) et les
   deux barres bleue et orange du modèle.

   Le texte est noir. Le bleu et l'orange de l'APIX viennent par touches,
   là où l'œil doit s'arrêter : le numéro et le titre de chaque section, ce
   que l'agent et le N+1 ont coché, les barres du pied. Tout se lit sur une
   seule colonne, avec de l'air : des tableaux à filets horizontaux, des
   sections bien séparées. La grille des compétences passe à l'italienne,
   comme dans le modèle.

   Une section ne commence pas en bas de page ; une ligne de tableau ne se
   coupe pas ; un tableau qui passe à la page suivante y reprend ses titres
   de colonnes.

   Deux versions : celle de l'agent, sections 1 à 7 ; la version complète,
   avec la partie réservée à la hiérarchie, toujours sur une page à part.
   ──────────────────────────────────────────────────────────────── */

type Doc = typeof PDFDocument.prototype;

export interface PersonneDeLaFiche {
  prenom: string;
  nom: string;
  fonction: string | null;
}

export interface AgentDeLaFiche extends PersonneDeLaFiche {
  matricule: string | null;
  direction: string | null;
  departement: string | null;
  service: string | null;
  /** « 3 ans et 2 mois » ; null : pas d'affectation connue. */
  anciennete: string | null;
  /** AAAA-MM-JJ : la prise du poste actuel. */
  posteDepuis: string | null;
}

/** Ce que la fiche imprime. */
export interface DonneesDeLaFiche {
  annee: number;
  personnel: PersonnelDeLaFiche;
  agent: AgentDeLaFiche;
  n1: PersonneDeLaFiche | null;
  /** AAAA-MM-JJ. */
  dateDeLEntretien: string | null;
  objectifs: readonly ObjectifEvalue[];
  auto: AutoEvaluation;
  evaluation: EvaluationDuN1;
  /** null : la version de l'agent, sans la partie réservée à la hiérarchie. */
  reservee: PartieReservee | null;
  /** AAAA-MM-JJ : les validations en ligne. */
  validations: { n1: string | null; agent: string | null };
  /** Le N+2, une fois la fiche commentée. */
  n2: (PersonneDeLaFiche & { le: string | null; commentaires: string }) | null;
}

// ──────────────────────────────────────────────── les couleurs

/** Le bleu et l'orange de la charte de l'APIX, par touches. */
const BLEU = '#004F91';
const ORANGE = '#CA631F';
/** L'orange des petits textes : #CA631F n'atteint pas 4,5:1 sur le blanc. */
const ORANGE_TEXTE = '#B14600';
const BLANC = '#FFFFFF';

// ──────────────────────────────────────────────── la page

/** Le bord du texte, celui des documents de la DCH, calé sur le logo de leur en-tête. */
const MARGE = 595.28 - 544.5;
/** L'en-tête du modèle : son haut, et la hauteur de ses trois bandes. */
const CARTOUCHE = { haut: 28, dch: 15, titre: 23, bloc: 54 } as const;
const BAS_DU_CARTOUCHE = CARTOUCHE.haut + CARTOUCHE.dch + CARTOUCHE.titre + CARTOUCHE.bloc;
/** Le haut du texte, à l'air de l'en-tête. */
const HAUT_DU_TEXTE = BAS_DU_CARTOUCHE + 30;
/** Ce que le pied réserve en bas de chaque page : les mentions et leur air. */
const RESERVE_DU_PIED = 841.89 - HAUT_DU_PIED + 20;

const CORPS = 9.5;
const INTERLIGNE = 3.4;
const PETIT = 8;
/** Les étiquettes et les titres de colonnes : en capitales, espacées. */
const CAPITALES = 7;
const FILETS = { fort: 0.8, moyen: 0.5, fin: 0.4 } as const;
/** Les filets fins, adoucis : ils séparent sans peser. */
const OPACITE_DES_FILETS_FINS = 0.3;
const MARGE_X = 7;
const MARGE_Y = 6.8;
const AIR = {
  avantSection: 38,
  apresSection: 18,
  avantSousSection: 24,
  apresSousSection: 11,
} as const;
const NEANT = 'Néant';
/** La largeur de la colonne des intitulés, dans les listes de clés et de valeurs. */
const CLES = 170;

// ──────────────────────────────────────────────── le texte

/**
 * La typographie française d'un texte saisi : l'apostrophe courbe, l'espace
 * insécable avant « : ; ? ! » et dans les guillemets. Une ligne ne commence
 * jamais par un signe de ponctuation.
 */
export function typographie(texte: string): string {
  return texte
    .replace(/'/g, '’')
    .replace(/ +([:;?!»])/g, ' $1')
    .replace(/« +/g, '« ');
}

/** Un paragraphe d'un texte saisi : une ligne, une puce si elle commence par un tiret. */
interface Paragraphe {
  puce: boolean;
  texte: string;
}

function paragraphes(texte: string): Paragraphe[] {
  return texte
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const puce = /^[-•*–]\s+(.*)$/.exec(l);
      return { puce: Boolean(puce), texte: typographie(puce ? puce[1]! : l) };
    });
}

/** Le nom, comme les documents l'impriment : « Moussa SARR ». */
export const nomImprime = (p: { prenom: string; nom: string }) =>
  `${p.prenom} ${p.nom.toLocaleUpperCase('fr')}`;

/** « 22 décembre 2026 », d'un seul tenant : une date ne se coupe pas en fin de ligne. */
const dateInsecable = (iso: string) => dateEnLettres(iso).replace(/ /g, '\u00a0');

/** « 15/12/2018 », comme le modèle écrit sa date d'application. */
const dateEnChiffres = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

interface Style {
  coupe?: Coupe;
  famille?: Famille;
  taille?: number;
  espacement?: number;
  couleur?: string;
}

const RETRAIT_DE_PUCE = 10;

/** Un tableau d'au plus autant de lignes ne se coupe pas d'une page à l'autre. */
const PETIT_TABLEAU = 4;

/** Les lignes qu'un tableau pose au moins sur sa première page : toutes s'il est petit, deux sinon. */
const lignesDuDebut = (n: number) => (n <= PETIT_TABLEAU ? n : 2);

/** Une colonne d'un tableau : son titre, sa largeur, l'alignement de son titre. */
interface Colonne {
  titre: string;
  largeur: number;
}

/** Une cellule : sa hauteur à une largeur donnée, et comment la dessiner. */
interface Cellule {
  /** Les colonnes qu'elle couvre (1 par défaut). */
  colonnes?: number;
  hauteur(largeur: number): number;
  dessiner(x: number, y: number, largeur: number): void;
}

function largeurDeLaCellule(colonnes: readonly Colonne[], i: number, cellule: Cellule): number {
  return colonnes.slice(i, i + (cellule.colonnes ?? 1)).reduce((l, c) => l + c.largeur, 0);
}

/** La fiche, page après page. */
class Composition {
  private haut = HAUT_DU_TEXTE;
  y = HAUT_DU_TEXTE;
  /** Le haut du texte qui suit le titre d'une section : la sous-section n'y ajoute pas son air. */
  private sousLeTitre = -1;

  constructor(readonly doc: Doc) {}

  get gauche(): number {
    return MARGE;
  }

  get largeur(): number {
    return this.doc.page.width - 2 * MARGE;
  }

  get droite(): number {
    return this.doc.page.width - MARGE;
  }

  get bas(): number {
    return this.doc.page.height - RESERVE_DU_PIED;
  }

  /** Une police, un corps et une couleur, pour écrire ou mesurer. */
  style({
    coupe = 'normal',
    famille = 'raleway',
    taille = CORPS,
    espacement,
    couleur,
  }: Style = {}) {
    this.doc
      .font(police(this.doc, coupe, famille))
      .fontSize(taille)
      .fillColor(couleur ?? ENCRE);
    return { characterSpacing: espacement ?? 0, lineGap: INTERLIGNE };
  }

  hauteurDe(texte: string, largeur: number, s: Style = {}): number {
    const o = this.style(s);
    return this.doc.heightOfString(texte, { ...o, width: largeur });
  }

  ecrire(
    texte: string,
    x: number,
    y: number,
    largeur: number,
    s: Style = {},
    align: 'left' | 'right' | 'center' = 'left',
  ): void {
    const o = this.style(s);
    this.doc.text(texte, x, y, { ...o, width: largeur, align });
  }

  /** Des morceaux de styles différents, à la suite, sur une ou plusieurs lignes. */
  ecrireEnLigne(x: number, y: number, largeur: number, morceaux: readonly [string, Style][]): void {
    morceaux.forEach(([t, s], i) => {
      const o = this.style(s);
      const suite = i < morceaux.length - 1;
      if (i === 0) this.doc.text(t, x, y, { ...o, width: largeur, continued: suite });
      else this.doc.text(t, { ...o, continued: suite });
    });
  }

  /** La hauteur de ces morceaux : mesurés d'un bloc, dans le plus gras de leurs styles. */
  hauteurEnLigne(largeur: number, morceaux: readonly [string, Style][]): number {
    const taille = Math.max(...morceaux.map(([, s]) => s.taille ?? CORPS));
    return this.hauteurDe(morceaux.map(([t]) => t).join(''), largeur, { coupe: 'bold', taille });
  }

  /** Une page neuve, en portrait ou à l'italienne. */
  nouvellePage(sens: 'portrait' | 'landscape' = 'portrait'): void {
    this.doc.addPage({ size: 'A4', layout: sens, margin: 0 });
    this.haut = HAUT_DU_TEXTE;
    this.y = HAUT_DU_TEXTE;
  }

  get enHautDePage(): boolean {
    return this.y <= this.haut + 0.5;
  }

  /** Une nouvelle page, dans le même sens, si `hauteur` ne tient plus dans celle-ci. */
  place(hauteur: number): void {
    if (this.y + hauteur > this.bas && !this.enHautDePage) {
      this.nouvellePage(this.doc.page.width > this.doc.page.height ? 'landscape' : 'portrait');
    }
  }

  filet(
    y: number,
    epaisseur: number,
    x = this.gauche,
    largeur = this.largeur,
    couleur = ENCRE,
  ): void {
    this.doc.save();
    if (epaisseur <= FILETS.fin) this.doc.strokeOpacity(OPACITE_DES_FILETS_FINS);
    this.doc
      .moveTo(x, y)
      .lineTo(x + largeur, y)
      .lineWidth(epaisseur)
      .strokeColor(couleur)
      .stroke();
    this.doc.restore();
  }

  // ─────────────── les blocs de texte

  /** La hauteur d'un texte saisi : ses paragraphes et ses puces. */
  hauteurDuTexte(texte: string, largeur: number, s: Style = {}): number {
    const ps = paragraphes(texte);
    if (ps.length === 0) return this.hauteurDe(NEANT, largeur, { ...s, coupe: 'italic' });
    return ps.reduce(
      (h, p, i) =>
        h +
        (i > 0 ? 3 : 0) +
        this.hauteurDe(p.texte, p.puce ? largeur - RETRAIT_DE_PUCE : largeur, s),
      0,
    );
  }

  /** Un texte saisi, à sa place ; vide, « Néant », en italique. */
  ecrireLeTexte(texte: string, x: number, y: number, largeur: number, s: Style = {}): number {
    const ps = paragraphes(texte);
    if (ps.length === 0) {
      this.ecrire(NEANT, x, y, largeur, { ...s, coupe: 'italic' });
      return this.hauteurDe(NEANT, largeur, { ...s, coupe: 'italic' });
    }
    let h = 0;
    ps.forEach((p, i) => {
      if (i > 0) h += 3;
      if (p.puce) {
        const taille = s.taille ?? CORPS;
        this.doc.circle(x + 2.4, y + h + taille * 0.66, 1.15).fill(BLEU);
        this.ecrire(p.texte, x + RETRAIT_DE_PUCE, y + h, largeur - RETRAIT_DE_PUCE, s);
        h += this.hauteurDe(p.texte, largeur - RETRAIT_DE_PUCE, s);
      } else {
        this.ecrire(p.texte, x, y + h, largeur, s);
        h += this.hauteurDe(p.texte, largeur, s);
      }
    });
    return h;
  }

  // ─────────────── les titres

  /** Une mention discrète, en italique : qui remplit la partie. */
  private qui(texte: string, x: number, y: number, largeur: number): void {
    this.doc.save().fillOpacity(0.72);
    this.ecrire(texte, x, y, largeur, { coupe: 'italic', taille: PETIT }, 'right');
    this.doc.restore();
  }

  /**
   * Le titre d'une section : son numéro en blanc sur un carré orange, son
   * intitulé en capitales bleues, un filet bleu dessous. Il ne reste jamais
   * seul en bas d'une page : `suite` est la hauteur de ce qui doit le suivre.
   */
  section(numero: number, intitule: string, suite: number, qui?: string): void {
    const COTE = 19;
    const titre = intitule.toLocaleUpperCase('fr');
    const sTitre: Style = { coupe: 'bold', taille: 11.2, espacement: 0.9, couleur: BLEU };
    const sQui: Style = { coupe: 'italic', taille: PETIT };
    const xTitre = this.gauche + COTE + 12;
    const largeurDuTitre = this.largeur - COTE - 12;
    // L'intitulé, sa première ligne centrée sur le carré ; dessous, qui remplit la section.
    const hUneLigne = this.hauteurDe('A', largeurDuTitre, sTitre) - INTERLIGNE;
    const hautDuTitre = (COTE - hUneLigne) / 2 + 0.6;
    const hTitre = this.hauteurDe(titre, largeurDuTitre, sTitre) - INTERLIGNE;
    const hQui = qui ? 5 + this.hauteurDe(qui, largeurDuTitre, sQui) - INTERLIGNE : 0;
    const hBloc = Math.max(COTE, hautDuTitre + hTitre + hQui);
    const avant = this.enHautDePage ? 0 : AIR.avantSection;
    this.place(avant + hBloc + 10 + AIR.apresSection + suite);
    if (!this.enHautDePage) this.y += avant;
    const y = this.y;
    this.doc.roundedRect(this.gauche, y, COTE, COTE, 3.5).fill(ORANGE);
    this.style({ coupe: 'bold', taille: 10.5 });
    const n = String(numero);
    const largeurDuNumero = this.doc.widthOfString(n);
    this.doc
      .fillColor(BLANC)
      .text(n, this.gauche + (COTE - largeurDuNumero) / 2, y + COTE / 2 + 10.5 * 0.355, {
        lineBreak: false,
        baseline: 'alphabetic',
      });
    this.ecrire(titre, xTitre, y + hautDuTitre, largeurDuTitre, sTitre);
    if (qui) {
      this.doc.save().fillOpacity(0.72);
      this.ecrire(qui, xTitre, y + hautDuTitre + hTitre + 5, largeurDuTitre, sQui);
      this.doc.restore();
    }
    this.y = y + hBloc + 10;
    this.filet(this.y, 1, this.gauche, this.largeur, BLEU);
    this.y += AIR.apresSection;
    this.sousLeTitre = this.y;
  }

  /** Le titre d'une sous-section : « 2.1 » en orange, son intitulé, et qui la remplit. */
  sousSection(numero: string, intitule: string, suite: number, qui?: string): void {
    const sTitre: Style = { coupe: 'bold', taille: 10.4 };
    const largeurDuNumero = numero.length > 3 ? 38 : 30;
    const largeurDuQui = qui ? 190 : 0;
    const largeurDuTitre = this.largeur - largeurDuNumero - largeurDuQui;
    const h = this.hauteurDe(intitule, largeurDuTitre, sTitre);
    const avant = this.enHautDePage || this.y === this.sousLeTitre ? 0 : AIR.avantSousSection;
    this.place(avant + h + AIR.apresSousSection + suite);
    if (!this.enHautDePage) this.y += avant;
    this.ecrire(numero, this.gauche, this.y, largeurDuNumero, { ...sTitre, couleur: ORANGE_TEXTE });
    this.ecrire(intitule, this.gauche + largeurDuNumero, this.y, largeurDuTitre, sTitre);
    if (qui) this.qui(qui, this.droite - largeurDuQui, this.y + 2, largeurDuQui);
    this.y += h + AIR.apresSousSection;
  }

  /** La hauteur du titre d'une sous-section qui suit directement celui de sa section. */
  hauteurDuSousTitre(numero: string, intitule: string, qui?: string): number {
    const largeurDuNumero = numero.length > 3 ? 38 : 30;
    const largeurDuQui = qui ? 190 : 0;
    return (
      this.hauteurDe(intitule, this.largeur - largeurDuNumero - largeurDuQui, {
        coupe: 'bold',
        taille: 10.4,
      }) + AIR.apresSousSection
    );
  }

  /** Une phrase sous un titre, en italique. */
  chapeau(texte: string): void {
    const s: Style = { coupe: 'italic', taille: 9 };
    const h = this.hauteurDe(texte, this.largeur, s);
    this.place(h + 14);
    this.ecrire(texte, this.gauche, this.y, this.largeur, s);
    this.y += h + 14;
    // Une sous-section qui suit la phrase n'y ajoute pas son air.
    this.sousLeTitre = this.y;
  }

  /**
   * Une étiquette en petites capitales espacées, au-dessus d'un bloc : « L'AGENT »,
   * « OBJECTIF 1 ». Elle ne reste pas seule en bas de page.
   */
  hauteurDeLEtiquette(texte: string): number {
    const s: Style = { coupe: 'bold', taille: CAPITALES, espacement: 1 };
    return this.hauteurDe(texte.toLocaleUpperCase('fr'), this.largeur, s) + 6;
  }

  etiquette(texte: string, couleur: string, suite: number, avant = 0): void {
    const s: Style = { coupe: 'bold', taille: CAPITALES, espacement: 1, couleur };
    const t = texte.toLocaleUpperCase('fr');
    const h = this.hauteurDe(t, this.largeur, s);
    this.place(avant + h + 6 + suite);
    if (!this.enHautDePage) this.y += avant;
    this.ecrire(t, this.gauche, this.y, this.largeur, s);
    this.y += h + 6;
  }

  /** Une ligne en petit corps : la diffusion, une mention. */
  mention(texte: string, avant = 10): void {
    const s: Style = { taille: PETIT };
    const h = this.hauteurDe(texte, this.largeur, s);
    this.place(avant + h);
    this.y += avant;
    this.ecrire(texte, this.gauche, this.y, this.largeur, s);
    this.y += h;
  }

  // ─────────────── les tableaux

  /**
   * Un tableau à filets : un trait fort en haut, les titres des colonnes, un
   * trait moyen, les lignes séparées d'un trait fin, un trait fort en bas.
   * Une ligne ne se coupe pas : celle qui ne tient plus passe à la page
   * suivante, sous les titres des colonnes répétés.
   */
  /** La hauteur d'un tableau, ses titres et toutes ses lignes ; `jusqua` : ses premières lignes seulement. */
  hauteurDuTableau(
    colonnes: readonly Colonne[],
    lignes: readonly (readonly Cellule[])[],
    o: { titres?: boolean; marge?: number; jusqua?: number } = {},
  ): number {
    const mx = o.marge ?? MARGE_X;
    const sTitre: Style = { coupe: 'bold', taille: CAPITALES, espacement: 0.6 };
    const titres =
      (o.titres ?? true)
        ? Math.max(
            ...colonnes.map((c) =>
              this.hauteurDe(c.titre.toLocaleUpperCase('fr'), c.largeur - 2 * mx, sTitre),
            ),
          ) +
          2 * MARGE_Y -
          INTERLIGNE
        : 0;
    return lignes.slice(0, o.jusqua ?? lignes.length).reduce((total, ligne) => {
      let i = 0;
      let h = 0;
      for (const cellule of ligne) {
        h = Math.max(h, cellule.hauteur(largeurDeLaCellule(colonnes, i, cellule) - 2 * mx));
        i += cellule.colonnes ?? 1;
      }
      return total + h + 2 * MARGE_Y - INTERLIGNE;
    }, titres);
  }

  /** Ce qu'un tableau pose sur sa première page : ses titres et ses premières lignes. */
  debutDuTableau(
    colonnes: readonly Colonne[],
    lignes: readonly (readonly Cellule[])[],
    o: { titres?: boolean; marge?: number } = {},
  ): number {
    return (
      this.hauteurDuTableau(colonnes, lignes, { ...o, jusqua: lignesDuDebut(lignes.length) }) + 2
    );
  }

  /** La hauteur d'une liste de clés et de valeurs. */
  hauteurDesCles(paires: readonly (readonly [string, Cellule])[]): number {
    return this.hauteurDuTableau(this.colonnesDesCles(), this.lignesDesCles(paires), {
      titres: false,
    });
  }

  private colonnesDesCles(): Colonne[] {
    return [
      { titre: '', largeur: CLES },
      { titre: '', largeur: this.largeur - CLES },
    ];
  }

  private lignesDesCles(paires: readonly (readonly [string, Cellule])[]): Cellule[][] {
    return paires.map(([cle, valeur]) => [this.intitule(cle), valeur]);
  }

  tableau(
    colonnes: readonly Colonne[],
    lignes: readonly (readonly Cellule[])[],
    o: { titres?: boolean; marge?: number } = {},
  ): void {
    const titres = o.titres ?? true;
    const mx = o.marge ?? MARGE_X;
    const sTitre: Style = { coupe: 'bold', taille: CAPITALES, espacement: 0.6 };
    const xs = colonnes.reduce<number[]>(
      (acc, c, i) => [...acc, i === 0 ? this.gauche : acc[i - 1]! + colonnes[i - 1]!.largeur],
      [],
    );
    const hauteurDesTitres = titres
      ? Math.max(
          ...colonnes.map((c) =>
            this.hauteurDe(c.titre.toLocaleUpperCase('fr'), c.largeur - 2 * mx, sTitre),
          ),
        ) +
        2 * MARGE_Y -
        INTERLIGNE
      : 0;
    const hauteurDe = (ligne: readonly Cellule[]) => {
      let i = 0;
      let h = 0;
      for (const cellule of ligne) {
        h = Math.max(h, cellule.hauteur(largeurDeLaCellule(colonnes, i, cellule) - 2 * mx));
        i += cellule.colonnes ?? 1;
      }
      return h + 2 * MARGE_Y - INTERLIGNE;
    };

    const poserLesTitres = () => {
      this.filet(this.y, FILETS.fort);
      if (!titres) return;
      colonnes.forEach((c, i) =>
        this.ecrire(
          c.titre.toLocaleUpperCase('fr'),
          xs[i]! + mx,
          this.y + MARGE_Y,
          c.largeur - 2 * mx,
          sTitre,
        ),
      );
      this.y += hauteurDesTitres;
      this.filet(this.y, FILETS.moyen);
    };

    const hauteurs = lignes.map(hauteurDe);
    const debut = hauteurs.slice(0, lignesDuDebut(lignes.length)).reduce((t, h) => t + h, 0);
    this.place(hauteurDesTitres + debut + 2);
    poserLesTitres();
    lignes.forEach((ligne, n) => {
      const h = hauteurs[n]!;
      // La dernière ligne ne part pas seule à la page suivante : l'avant-dernière l'accompagne.
      const veuve =
        lignes.length > PETIT_TABLEAU &&
        n === lignes.length - 2 &&
        n >= 2 &&
        this.y + h + hauteurs[n + 1]! > this.bas;
      if ((this.y + h > this.bas || veuve) && n > 0) {
        this.filet(this.y, FILETS.fort);
        this.nouvellePage(this.doc.page.width > this.doc.page.height ? 'landscape' : 'portrait');
        poserLesTitres();
      }
      let i = 0;
      for (const cellule of ligne) {
        const largeur = largeurDeLaCellule(colonnes, i, cellule);
        cellule.dessiner(xs[i]! + mx, this.y + MARGE_Y, largeur - 2 * mx);
        i += cellule.colonnes ?? 1;
      }
      this.y += h;
      if (n < lignes.length - 1) this.filet(this.y, FILETS.fin);
    });
    this.filet(this.y, FILETS.fort);
  }

  /** Des clés et leurs valeurs, l'une sous l'autre, sur toute la largeur. */
  cles(paires: readonly (readonly [string, Cellule])[]): void {
    this.tableau(this.colonnesDesCles(), this.lignesDesCles(paires), { titres: false });
  }

  // ─────────────── les cellules

  /** Une cellule de texte saisi. */
  texte(texte: string, s: Style = {}, colonnes?: number): Cellule {
    return {
      colonnes,
      hauteur: (l) => this.hauteurDuTexte(texte, l, s),
      dessiner: (x, y, l) => void this.ecrireLeTexte(texte, x, y, l, s),
    };
  }

  /** Une cellule d'intitulé : un texte fixe, en gras, sur la ligne de base de sa voisine. */
  intitule(texte: string, s: Style = {}, sur = CORPS): Cellule {
    const st: Style = { coupe: 'bold', taille: 8.8, ...s };
    const decalage = Math.max(0, (sur - (st.taille ?? CORPS)) * 0.94);
    return {
      hauteur: (l) => this.hauteurDe(texte, l, st) + decalage,
      dessiner: (x, y, l) => this.ecrire(texte, x, y + decalage, l, st),
    };
  }

  /** Une case à cocher : cochée, pleine et bleue, la coche en blanc. */
  caseACocher(x: number, y: number, cochee: boolean, cote = 8): void {
    if (cochee) {
      this.doc.roundedRect(x, y, cote, cote, cote * 0.14).fill(BLEU);
      this.doc
        .save()
        .moveTo(x + cote * 0.23, y + cote * 0.53)
        .lineTo(x + cote * 0.43, y + cote * 0.73)
        .lineTo(x + cote * 0.79, y + cote * 0.28)
        .lineWidth(cote * 0.14)
        .lineCap('round')
        .lineJoin('round')
        .strokeColor(BLANC)
        .stroke()
        .restore();
    } else {
      this.doc
        .roundedRect(x + 0.25, y + 0.25, cote - 0.5, cote - 0.5, cote * 0.12)
        .lineWidth(0.6)
        .strokeColor(ENCRE)
        .stroke();
    }
  }

  /** La lettre d'un niveau, en blanc sur un carré bleu aux coins adoucis. */
  lettre(niveau: Niveau, x: number, y: number, cote = 13): void {
    this.doc.roundedRect(x, y, cote, cote, cote * 0.18).fill(BLEU);
    const taille = cote * 0.66;
    this.style({ coupe: 'bold', taille });
    const largeur = this.doc.widthOfString(niveau);
    this.doc
      .fillColor(BLANC)
      .text(niveau, x + (cote - largeur) / 2, y + cote / 2 + taille * 0.355, {
        lineBreak: false,
        baseline: 'alphabetic',
      });
  }

  /** Un niveau donné : sa lettre, puis son libellé ; aucun, « Non renseigné ». */
  niveau(niveau: Niveau | null, libelle: (n: Niveau) => string): Cellule {
    const vide = 'Non renseigné';
    const COTE = 13;
    const s: Style = { coupe: 'bold', taille: 9.5 };
    return {
      hauteur: (l) =>
        niveau
          ? Math.max(COTE, this.hauteurDe(libelle(niveau), l - COTE - 7, s) - INTERLIGNE)
          : this.hauteurDe(vide, l, { coupe: 'italic' }),
      dessiner: (x, y, l) => {
        if (!niveau) {
          this.ecrire(vide, x, y, l, { coupe: 'italic' });
          return;
        }
        this.lettre(niveau, x, y - 1.2, COTE);
        this.ecrire(libelle(niveau), x + COTE + 7, y, l - COTE - 7, s);
      },
    };
  }

  /**
   * Un niveau de la grille d'un critère : sa case et ce qu'il veut dire. La
   * case du niveau donné est cochée, son texte en demi-gras.
   */
  niveauDeLaGrille(n: Niveau, texte: string, choisi: Niveau | null, taille = 8.6): Cellule {
    const s: Style = choisi === n ? { famille: 'raleway-semibold', taille } : { taille };
    const RETRAIT = 13;
    const t = typographie(texte);
    return {
      hauteur: (l) => Math.max(9, this.hauteurDe(t, l - RETRAIT, s)),
      dessiner: (x, y, l) => {
        this.caseACocher(x, y + 1, choisi === n, 8.2);
        this.ecrire(t, x + RETRAIT, y, l - RETRAIT, s);
      },
    };
  }
}

/** Des largeurs de colonnes, en parts de la largeur du texte de la page. */
function colonnes(f: Composition, ...parts: readonly [titre: string, part: number][]): Colonne[] {
  const total = parts.reduce((t, [, p]) => t + p, 0);
  return parts.map(([titre, part]) => ({ titre, largeur: (f.largeur * part) / total }));
}

// ──────────────────────────────────────────────── la fiche

/**
 * La fiche d'un agent, en PDF. Sans partie réservée (`d.reservee` à null),
 * c'est la version de l'agent.
 */
export async function ficheDEntretienPdf(d: DonneesDeLaFiche): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 0,
    bufferPages: true,
    lang: 'fr-FR',
    displayTitle: true,
    info: {
      Title: `${TITRE_DE_LA_FICHE} ${d.annee} · ${nomImprime(d.agent)}`,
      Author: 'Direction du Capital Humain',
      Subject: `${TITRE_DE_LA_FICHE} ${d.annee}`,
      Creator: ENTETE.raisonSociale,
    },
  });
  enregistrerPolices(doc);
  chiffresAlignes(doc);
  const morceaux: Buffer[] = [];
  doc.on('data', (m: Buffer) => morceaux.push(m));
  const fini = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(morceaux)));
    doc.on('error', reject);
  });

  const f = new Composition(doc);
  identification(f, d);
  bilan(f, d);
  competences(f, d);
  synthese(f, d);
  perspectives(f, d);
  souhaits(f, d);
  validation(f, d);
  if (d.reservee) partieReservee(f, d, d.reservee);

  // L'en-tête et le pied de chaque page, une fois le nombre de pages connu.
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(pages.start + i);
    cartouche(f, d, i + 1, pages.count);
    pied(doc);
  }
  doc.end();
  return fini;
}

/**
 * L'en-tête du modèle de la DCH : « DCH » et l'agent ; le titre de la fiche ;
 * le bloc de la République, la référence de la fiche, le numéro de la page.
 */
function cartouche(f: Composition, d: DonneesDeLaFiche, page: number, total: number): void {
  const doc = f.doc;
  const x0 = f.gauche;
  const L = f.largeur;
  const y0 = CARTOUCHE.haut;
  const yTitre = y0 + CARTOUCHE.dch;
  const yBloc = yTitre + CARTOUCHE.titre;
  const largeurs = [L * 0.19, L * 0.49, L * 0.32] as const;
  const xMilieu = x0 + largeurs[0];
  const xDroite = xMilieu + largeurs[1];

  doc.save().lineWidth(0.6).strokeColor(ENCRE);
  doc.rect(x0, y0, L, BAS_DU_CARTOUCHE - y0).stroke();
  doc
    .moveTo(x0, yTitre)
    .lineTo(x0 + L, yTitre)
    .stroke();
  doc
    .moveTo(x0, yBloc)
    .lineTo(x0 + L, yBloc)
    .stroke();
  doc.moveTo(xMilieu, yBloc).lineTo(xMilieu, BAS_DU_CARTOUCHE).stroke();
  doc.moveTo(xDroite, yBloc).lineTo(xDroite, BAS_DU_CARTOUCHE).stroke();
  doc.restore();

  /** La ligne de base qui centre un corps dans une bande. */
  const centre = (haut: number, hauteur: number, taille: number) =>
    haut + hauteur / 2 + taille * 0.355;
  const enLigne = (t: string, x: number, base: number, s: Style) => {
    const o = f.style(s);
    doc.text(t, x, base, { ...o, lineBreak: false, baseline: 'alphabetic' });
  };

  // « DCH », et l'agent : une feuille détachée se range d'elle-même.
  enLigne('DCH', x0 + 8, centre(y0, CARTOUCHE.dch, 7.6), {
    coupe: 'bold',
    taille: 7.6,
    espacement: 1,
  });
  const agent = [nomImprime(d.agent), d.agent.matricule ? `Matricule ${d.agent.matricule}` : null]
    .filter(Boolean)
    .join('  ·  ');
  const sAgent: Style = { taille: 7.4 };
  f.style(sAgent);
  enLigne(agent, x0 + L - 8 - doc.widthOfString(agent), centre(y0, CARTOUCHE.dch, 7.4), sAgent);

  // Le titre de la fiche, au milieu de sa bande.
  const titre = TITRE_DE_LA_FICHE.toLocaleUpperCase('fr');
  const sTitre: Style = { coupe: 'bold', taille: 10.6, espacement: 0.7, couleur: BLEU };
  f.style(sTitre);
  const largeurDuTitre = doc.widthOfString(titre, { characterSpacing: 0.7 });
  enLigne(titre, x0 + (L - largeurDuTitre) / 2, centre(yTitre, CARTOUCHE.titre, 10.6), sTitre);

  // Le bloc de la République, centré dans sa case.
  const republique: [string, Style][] = [
    [ENTETE.republique, { coupe: 'bold', taille: 5.3 }],
    [ENTETE.devise, { coupe: 'italic', taille: 4.3 }],
    ['*****', { taille: 4.3 }],
    [ENTETE.tutelle[0], { coupe: 'bold', taille: 5 }],
    ['*****', { taille: 4.3 }],
    [ENTETE.tutelle[1], { coupe: 'bold', taille: 4.6 }],
    ['*****', { taille: 4.3 }],
    [ENTETE.sigle, { coupe: 'bold', taille: 5.8 }],
  ];
  const pas = 5.7;
  const hauteurDuBloc = (republique.length - 1) * pas;
  let base = yBloc + (CARTOUCHE.bloc - hauteurDuBloc) / 2 + 1.8;
  for (const [t, s] of republique) {
    f.style(s);
    const w = doc.widthOfString(t);
    enLigne(t, x0 + (largeurs[0] - w) / 2, base, s);
    base += pas;
  }

  // La référence : les intitulés en gras, les deux-points alignés.
  const r = REFERENCE_DE_LA_FICHE;
  const lignes: [string, string][] = [
    ['Réf.', r.reference],
    ['Version', r.version],
    ['Date d’application', dateEnChiffres(r.application)],
  ];
  const sIntitule: Style = { coupe: 'bold', taille: 8.6 };
  const sValeur: Style = { taille: 8.6 };
  f.style(sIntitule);
  const largeurDesIntitules = Math.max(...lignes.map(([i]) => doc.widthOfString(i)));
  const pasDesLignes = 12.6;
  let ligne = centre(yBloc, CARTOUCHE.bloc, 8.6) - pasDesLignes;
  const xIntitule = xMilieu + 16;
  const xDeuxPoints = xIntitule + largeurDesIntitules + 18;
  for (const [intitule, valeur] of lignes) {
    enLigne(intitule, xIntitule, ligne, sIntitule);
    enLigne(':', xDeuxPoints, ligne, sValeur);
    enLigne(valeur, xDeuxPoints + 7, ligne, sValeur);
    ligne += pasDesLignes;
  }

  // Le numéro de la page, ses nombres en gras, au milieu de sa case.
  const morceaux: [string, Style][] = [
    ['Page ', { taille: 9.4 }],
    [String(page), { coupe: 'bold', taille: 9.4 }],
    [' sur ', { taille: 9.4 }],
    [String(total), { coupe: 'bold', taille: 9.4 }],
  ];
  const largeurDuNumero = morceaux.reduce((l, [t, s]) => {
    f.style(s);
    return l + doc.widthOfString(t);
  }, 0);
  let x = xDroite + (largeurs[2] - largeurDuNumero) / 2;
  const baseDuNumero = centre(yBloc, CARTOUCHE.bloc, 9.4);
  for (const [t, s] of morceaux) {
    enLigne(t, x, baseDuNumero, s);
    f.style(s);
    x += doc.widthOfString(t);
  }
}

/** Le pied de chaque page : les mentions de la société, et les deux barres du modèle. */
function pied(doc: Doc): void {
  const { width: largeur, height: hauteur } = doc.page;
  dessinerPiedDePage(doc, null, { largeur, hauteur });
  doc.save();
  doc.roundedRect(-8, hauteur - 27, 128, 9, 4.5).fill(BLEU);
  doc.roundedRect(-8, hauteur - 15, 160, 8, 4).fill(ORANGE);
  doc.restore();
}

// ──────────────────────────────────────────────── 1. Identification

function identification(f: Composition, d: DonneesDeLaFiche): void {
  f.section(1, 'Identification de l’agent et de l’évaluateur', 160);
  const a = d.agent;

  const categorie: Cellule = {
    hauteur: () => f.hauteurDe('Cadre', 100) - INTERLIGNE,
    dessiner: (x, y) => {
      let xc = x;
      for (const p of PERSONNELS_DE_LA_FICHE) {
        const coche = d.personnel === p;
        f.caseACocher(xc, y + 1.4, coche, 9);
        f.ecrire(LIBELLES_DU_PERSONNEL[p], xc + 15, y, 100, { coupe: coche ? 'bold' : 'normal' });
        xc += 110;
      }
    },
  };
  f.cles([
    ['Catégorie', categorie],
    ['Période évaluée', f.texte(`Année ${d.annee}`, { coupe: 'bold' })],
    [
      'Date de l’entretien',
      d.dateDeLEntretien
        ? f.texte(dateEnLettres(d.dateDeLEntretien), { coupe: 'bold' })
        : f.texte('À fixer', { coupe: 'italic' }),
    ],
  ]);

  const valeur = (v: string | null) => f.texte(v ? typographie(v) : '–');
  const priseDePoste =
    a.posteDepuis && a.posteDepuis.slice(0, 4) === String(d.annee)
      ? `Oui, depuis le ${dateEnLettres(a.posteDepuis)}`
      : 'Non';
  f.etiquette('L’agent', ORANGE_TEXTE, 120, 22);
  f.cles(
    (
      [
        ['Prénom et nom', nomImprime(a)],
        ['Matricule', a.matricule],
        ['Fonction', a.fonction],
        ['Direction', a.direction],
        ['Département', a.departement],
        ['Service', a.service],
        ['Ancienneté au poste', a.anciennete],
        [`Prise de poste en ${d.annee}`, priseDePoste],
      ] as const
    )
      .filter(([, v]) => v !== null)
      .map(([cle, v]) => [cle, valeur(v)] as const),
  );

  f.etiquette('L’évaluateur (N+1)', ORANGE_TEXTE, 60, 22);
  f.cles([
    ['Prénom et nom', valeur(d.n1 ? nomImprime(d.n1) : null)],
    ['Fonction', valeur(d.n1?.fonction ?? null)],
  ]);
}

// ──────────────────────────────────────────────── 2. Bilan de l'année

function bilan(f: Composition, d: DonneesDeLaFiche): void {
  const recapitulatif: [string, string][] = QUESTIONS_DU_BILAN.map((q) => [
    q.question,
    d.auto[q.cle],
  ]);
  const qui = 'Rempli par l’agent';
  const hRecapitulatif = debutDesQuestions(f, recapitulatif);
  f.section(
    2,
    `Bilan de l’année ${d.annee}`,
    f.hauteurDuSousTitre('2.1', 'Récapitulatif et faits marquants', qui) + hRecapitulatif,
  );
  f.sousSection('2.1', 'Récapitulatif et faits marquants', hRecapitulatif, qui);
  questionsReponses(f, recapitulatif);

  // Les titres 2.2 et 2.2.1 partent avec le premier objectif.
  const objectifs = d.objectifs.map((o, i) => objectif(f, d, o, i));
  const premier = objectifs[0]?.hauteur ?? 30;
  const chapeau = `L’atteinte des objectifs fixés pour ${d.annee}.`;
  const hChapeau = f.hauteurDe(chapeau, f.largeur, { coupe: 'italic', taille: 9 }) + 14;
  f.sousSection('2.2', 'Évaluation des résultats', hChapeau + 60 + premier);
  f.chapeau(chapeau);
  f.sousSection(
    '2.2.1',
    'Les objectifs fixés',
    premier,
    'Auto-évaluation, puis appréciation du N+1',
  );
  if (objectifs.length === 0) f.mention('Aucun objectif n’a été fixé pour cette année.', 0);
  for (const o of objectifs) o.poser();
  echelle(f);

  f.sousSection('2.2.2', 'Autres réalisations en dehors des objectifs', 50, 'Rempli par l’agent');
  paragrapheLibre(f, d.auto.autresRealisations);
}

/**
 * Un objectif : son intitulé et ses indicateurs, l'auto-évaluation de
 * l'agent, puis l'appréciation du N+1. Sa hauteur, et de quoi le poser,
 * d'un seul tenant sur sa page quand il y tient.
 */
function objectif(
  f: Composition,
  d: DonneesDeLaFiche,
  o: ObjectifEvalue,
  i: number,
): { hauteur: number; poser: () => void } {
  const agent = d.auto.objectifs[o.id];
  const n1 = d.evaluation.objectifs[o.id];
  const libelle = (n: Niveau) => NIVEAUX_D_ATTEINTE[n].libelle;
  const intitule = typographie(o.intitule);
  const indicateurs = o.indicateurs ? typographie(o.indicateurs) : '';
  const sIntitule: Style = { coupe: 'bold', taille: 10.6 };
  const morceaux: [string, Style][] = [
    ['Indicateurs : ', { famille: 'raleway-semibold', taille: 9 }],
    [indicateurs, { taille: 9 }],
  ];
  const deLAgent: [string, Cellule][] = [
    ['Niveau', f.niveau(agent?.niveau ?? null, libelle)],
    ['Résultats obtenus', f.texte(agent?.resultats ?? '')],
    ['Commentaire', f.texte(agent?.commentaire ?? '')],
  ];
  const duN1: [string, Cellule][] = [
    ['Niveau', f.niveau(n1?.niveau ?? null, libelle)],
    ['Commentaire', f.texte(n1?.commentaire ?? '')],
  ];
  const etiquettes = {
    objectif: `Objectif ${i + 1}`,
    agent: 'Auto-évaluation de l’agent',
    n1: 'Appréciation du N+1',
  };
  const avant = i > 0 ? 34 : 0;
  const hIntitule = f.hauteurDe(intitule, f.largeur, sIntitule);
  const hIndicateurs = indicateurs ? f.hauteurEnLigne(f.largeur, morceaux) + 2 : 0;
  const hauteur =
    f.hauteurDeLEtiquette(etiquettes.objectif) +
    hIntitule +
    hIndicateurs +
    (16 + f.hauteurDeLEtiquette(etiquettes.agent) + f.hauteurDesCles(deLAgent)) +
    (18 + f.hauteurDeLEtiquette(etiquettes.n1) + f.hauteurDesCles(duN1)) +
    2;
  return {
    hauteur,
    poser: () => {
      // L'objectif entier sur la page, s'il tient sur une page.
      f.place(avant + Math.min(hauteur, f.bas - HAUT_DU_TEXTE - avant));
      f.etiquette(etiquettes.objectif, ORANGE_TEXTE, hIntitule + hIndicateurs + 90, avant);
      f.ecrire(intitule, f.gauche, f.y, f.largeur, sIntitule);
      f.y += hIntitule;
      if (indicateurs) {
        f.ecrireEnLigne(f.gauche, f.y + 1, f.largeur, morceaux);
        f.y += hIndicateurs;
      }
      f.etiquette(etiquettes.agent, BLEU, 60, 16);
      f.cles(deLAgent);
      f.etiquette(etiquettes.n1, BLEU, 60, 18);
      f.cles(duN1);
    },
  };
}

/** L'échelle des objectifs, comme la grille l'écrit : « Dépassé (résultats excellents) ». */
function echelle(f: Composition): void {
  const COTE = 11;
  const pas = 17;
  f.etiquette('Échelle', ENCRE, NIVEAUX.length * pas, 30);
  for (const n of NIVEAUX) {
    const { libelle, resultats } = NIVEAUX_D_ATTEINTE[n];
    f.lettre(n, f.gauche, f.y - 1, COTE);
    f.ecrireEnLigne(f.gauche + COTE + 9, f.y, f.largeur - COTE - 9, [
      [libelle, { coupe: 'bold', taille: 8.8 }],
      [` (${resultats.toLocaleLowerCase('fr')})`, { taille: 8.8 }],
    ]);
    f.y += pas;
  }
}

/** Une colonne sur toute la largeur. */
const pleineLargeur = (f: Composition): Colonne[] => [{ titre: '', largeur: f.largeur }];

/** Des questions et leurs réponses, l'une sous l'autre, séparées d'un trait fin. */
function questionsReponses(f: Composition, qr: readonly [string, string][]): void {
  f.tableau(pleineLargeur(f), lignesDeQuestions(f, qr), { titres: false });
}

/** Ce que les questions posent sur leur première page, pour que leur titre parte avec. */
function debutDesQuestions(f: Composition, qr: readonly [string, string][]): number {
  return f.debutDuTableau(pleineLargeur(f), lignesDeQuestions(f, qr), { titres: false });
}

function lignesDeQuestions(f: Composition, qr: readonly [string, string][]): Cellule[][] {
  const sQuestion: Style = { coupe: 'bold', taille: 9.5 };
  return qr.map(([question, reponse]) => [
    {
      hauteur: (l: number) =>
        f.hauteurDe(typographie(question), l, sQuestion) + 4 + f.hauteurDuTexte(reponse, l),
      dessiner: (x: number, y: number, l: number) => {
        f.ecrire(typographie(question), x, y, l, sQuestion);
        const h = f.hauteurDe(typographie(question), l, sQuestion);
        f.ecrireLeTexte(reponse, x, y + h + 4, l);
      },
    },
  ]);
}

/** Un texte libre sous un titre, entre deux filets. */
function paragrapheLibre(f: Composition, texte: string): void {
  f.tableau([{ titre: '', largeur: f.largeur }], [[f.texte(texte)]], { titres: false });
}

// ──────────────────────────────────────────────── 3. Compétences

function competences(f: Composition, d: DonneesDeLaFiche): void {
  // La grille des compétences, à l'italienne, comme dans le modèle.
  f.nouvellePage('landscape');
  f.section(3, 'Évaluation des compétences et des performances', 120, 'Rempli par le N+1');
  const liste = competencesDe(d.personnel);
  f.tableau(
    colonnes(
      f,
      ['N°', 0.3],
      ['Compétence', 1.5],
      ...NIVEAUX.map((n) => [`${n}  ·  ${NIVEAUX_DE_COMPETENCE[n]}`, 1.62] as [string, number]),
    ),
    liste.map((c, i) => {
      const choisi = d.evaluation.competences[c.cle] ?? null;
      const debut = [
        f.intitule(String(i + 1), { taille: 9 }, 8.6),
        f.intitule(typographie(c.intitule), { taille: 9 }, 8.6),
      ];
      if (c.cadres && !choisi) {
        return [
          ...debut,
          { ...f.texte('Sans objet', { coupe: 'italic', taille: 9 }), colonnes: 4 },
        ];
      }
      return [...debut, ...NIVEAUX.map((n) => f.niveauDeLaGrille(n, c.niveaux[n], choisi))];
    }),
  );
}

// ──────────────────────────────────────────────── 4. Synthèse

/**
 * Un tableau sous son titre de sous-section : le titre ne reste pas seul en
 * bas de page, il part avec la première ligne du tableau.
 */
function tableauTitre(
  f: Composition,
  titre: readonly [numero: string, intitule: string],
  chapeau: string | null,
  colonnesDuTableau: readonly Colonne[],
  lignes: readonly (readonly Cellule[])[],
): void {
  const sChapeau: Style = { coupe: 'italic', taille: 9 };
  const hChapeau = chapeau ? f.hauteurDe(chapeau, f.largeur, sChapeau) + 14 : 0;
  f.sousSection(titre[0], titre[1], hChapeau + debutDuTableauTitre(f, colonnesDuTableau, lignes));
  if (chapeau) f.chapeau(chapeau);
  if (lignes.length === 0) paragrapheLibre(f, '');
  else f.tableau(colonnesDuTableau, lignes);
}

/** Le début d'un tableau sous un titre ; vide, son « Néant ». */
function debutDuTableauTitre(
  f: Composition,
  colonnesDuTableau: readonly Colonne[],
  lignes: readonly (readonly Cellule[])[],
): number {
  return lignes.length > 0
    ? f.debutDuTableau(colonnesDuTableau, lignes)
    : f.debutDuTableau(pleineLargeur(f), [[f.texte('')]], { titres: false });
}

function synthese(f: Composition, d: DonneesDeLaFiche): void {
  const e = d.evaluation;
  f.nouvellePage('portrait');
  const bilanGlobal: [string, Cellule][] = [
    ['Points forts', f.texte(e.pointsForts)],
    ['Axes de développement', f.texte(e.axesDeDeveloppement)],
  ];
  const hBilan = f.hauteurDesCles(bilanGlobal) + 2;
  f.section(
    4,
    'Synthèse de l’évaluation et axes d’amélioration',
    f.hauteurDuSousTitre('4.1', 'Bilan global') + hBilan,
    'Rempli par le N+1',
  );
  f.sousSection('4.1', 'Bilan global', hBilan);
  f.cles(bilanGlobal);

  const plan = e.plan.filter((a) => a.action.trim() || a.suivi.trim());
  tableauTitre(
    f,
    ['4.2', 'Plan d’action pour développer les compétences'],
    'Les actions concrètes à mettre en place pour développer les compétences à améliorer.',
    colonnes(
      f,
      ['Action ou moyen (coaching, mentorat, délégation…)', 2.3],
      ['Délai', 1.05],
      ['Suivi ou justification', 2.1],
    ),
    plan.map((a) => [f.texte(a.action), f.texte(a.delai), f.texte(a.suivi)]),
  );
}

// ──────────────────────────────────────────────── 5. Objectifs et perspectives

function perspectives(f: Composition, d: DonneesDeLaFiche): void {
  const e = d.evaluation;
  const suivante = d.annee + 1;
  const colonnesDesObjectifs = colonnes(
    f,
    ['N°', 0.3],
    ['Objectif', 2.25],
    ['Indicateur de réussite (quantifiable ou qualifiable)', 2.05],
    ['Échéance', 1.25],
  );
  const objectifs = e.objectifsAVenir
    .filter((o) => o.objectif.trim())
    .map((o, i) => [
      f.intitule(String(i + 1), { taille: 8.8 }),
      f.texte(o.objectif),
      f.texte(o.indicateur),
      f.texte(o.echeance ? dateInsecable(o.echeance) : ''),
    ]);
  const titre51 = `Les objectifs de l’année ${suivante}`;
  f.section(
    5,
    `Objectifs et perspectives pour ${suivante}`,
    f.hauteurDuSousTitre('5.1', titre51) + debutDuTableauTitre(f, colonnesDesObjectifs, objectifs),
    'Rempli par le N+1',
  );
  tableauTitre(f, ['5.1', titre51], null, colonnesDesObjectifs, objectifs);

  const formations = e.formations.filter((x) => x.intitule.trim());
  tableauTitre(
    f,
    ['5.2', 'Besoins et projets de formation'],
    `Les formations que le N+1 juge nécessaires pour atteindre les objectifs de ${suivante}.`,
    colonnes(
      f,
      ['N°', 0.3],
      ['Formation souhaitée', 2.35],
      ['Justification (lien avec le poste et les objectifs)', 3.2],
    ),
    formations.map((x, i) => [
      f.intitule(String(i + 1), { taille: 8.8 }),
      f.texte(x.intitule),
      f.texte(x.justification),
    ]),
  );
}

// ──────────────────────────────────────────────── 6. Souhaits de l'agent

function souhaits(f: Composition, d: DonneesDeLaFiche): void {
  const questions: [string, string][] = [
    ...QUESTIONS_DES_SOUHAITS.map(
      (q) =>
        [`${q.question}${'precision' in q ? ` (${q.precision})` : ''}`, d.auto[q.cle]] as [
          string,
          string,
        ],
    ),
    ['Autres commentaires', d.auto.autresCommentaires],
  ];
  f.section(
    6,
    'Préoccupations et souhaits de l’agent',
    debutDesQuestions(f, questions),
    'Rempli par l’agent',
  );
  questionsReponses(f, questions);
}

// ──────────────────────────────────────────────── 7. Validation

function validation(f: Composition, d: DonneesDeLaFiche): void {
  const ligne = (
    role: string,
    p: { prenom: string; nom: string } | null,
    le: string | null,
  ): Cellule[] => [
    f.intitule(role),
    f.texte(p ? nomImprime(p) : ''),
    f.texte(le ? dateInsecable(le) : ''),
    le
      ? f.texte('Validation en ligne', { coupe: 'italic', taille: 9 })
      : { hauteur: () => 26, dessiner: () => undefined },
  ];
  const cols = colonnes(
    f,
    ['Rôle', 1.65],
    ['Prénom et nom', 1.45],
    ['Date', 1.15],
    ['Signature', 1.1],
  );
  const lignes = [
    ligne('Agent (N)', d.agent, d.validations.agent),
    ligne('Responsable hiérarchique (N+1)', d.n1, d.validations.n1),
  ];
  f.section(7, 'Validation et suivi', f.debutDuTableau(cols, lignes) + 50);
  f.tableau(cols, lignes);
  f.mention('La fiche n’est valable qu’une fois validée par l’agent.', 12);
  f.mention('Diffusion : original au dossier du personnel (DCH)  ·  copie à l’agent.', 5);
}

// ──────────────────────────────────────────────── 8. Partie réservée

function partieReservee(f: Composition, d: DonneesDeLaFiche, r: PartieReservee): void {
  f.nouvellePage('portrait');
  f.section(8, 'Partie strictement réservée à la hiérarchie', 140);

  f.sousSection('8.1', 'Synthèse générale du N+1', 90);
  f.tableau(
    colonnes(f, ['Critère', 1.25], ...NIVEAUX.map((n) => [n, 1.2] as [string, number])),
    SYNTHESE_GENERALE.map((c) => [
      f.intitule(c.intitule, { taille: 8.8 }, 8.2),
      ...NIVEAUX.map((n) => f.niveauDeLaGrille(n, c.niveaux[n], r[c.cle], 8.2)),
    ]),
    { marge: 5.5 },
  );

  f.sousSection('8.2', 'Observations du N+1', 60);
  paragrapheLibre(f, r.observations);
  signature(f, 'N+1', d.n1, d.validations.n1);

  f.sousSection('8.3', 'Commentaires du N+2', 60);
  paragrapheLibre(f, d.n2?.commentaires ?? '');
  signature(f, 'N+2', d.n2, d.n2?.le ?? null);

  // À la main, sur l'original : des lignes à écrire, entre deux filets ; la
  // diffusion les suit sur la même page.
  const lignes = 4;
  const pas = 21;
  const diffusion =
    'Diffusion : original au dossier du personnel (DCH)  ·  copie 1 au N+1  ·  copie 2 au N+2, selon le circuit de validation.';
  const hDiffusion = 14 + f.hauteurDe(diffusion, f.largeur, { taille: PETIT });
  f.sousSection('8.4', 'Commentaires des autres niveaux hiérarchiques', lignes * pas + hDiffusion);
  f.filet(f.y, FILETS.fort);
  for (let i = 1; i < lignes; i++) f.filet(f.y + i * pas, FILETS.fin);
  f.y += lignes * pas;
  f.filet(f.y, FILETS.fort);

  f.mention(diffusion, 14);
}

/**
 * La signature d'une partie, sous son texte : qui, sa fonction, la date de la
 * validation en ligne. Sans validation, la place de signer à la main.
 */
function signature(
  f: Composition,
  role: string,
  p: PersonneDeLaFiche | null,
  le: string | null,
): void {
  const morceaux: [string, Style][] = [
    [`${role}   `, { coupe: 'bold', taille: 8.8, couleur: ORANGE_TEXTE }],
  ];
  if (p) {
    morceaux.push([nomImprime(p), { famille: 'raleway-semibold', taille: 8.8 }]);
    if (p.fonction) morceaux.push([`, ${typographie(p.fonction)}`, { taille: 8.8 }]);
  }
  morceaux.push([
    le ? `   ·   Validation en ligne le ${dateInsecable(le)}` : '   ·   Date et signature :',
    { coupe: 'italic', taille: 8.8 },
  ]);
  const h = f.hauteurEnLigne(f.largeur, morceaux);
  f.place(9 + h);
  f.y += 9;
  f.ecrireEnLigne(f.gauche, f.y, f.largeur, morceaux);
  f.y += h;
}
