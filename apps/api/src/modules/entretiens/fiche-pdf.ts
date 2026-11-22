import PDFDocument from 'pdfkit';
import {
  autoEvaluationVide,
  competencesDe,
  dateEnLettres,
  evaluationDuN1Vide,
  LIBELLES_DU_PERSONNEL,
  NIVEAUX,
  NIVEAUX_D_ATTEINTE,
  NIVEAUX_DE_COMPETENCE,
  partieReserveeVide,
  PERSONNELS_DE_LA_FICHE,
  pucesDe,
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
import { initiales } from '../evaluations/feuille-de-grille';

/* ────────────────────────────────────────────────────────────────
   La fiche d'entretien annuel d'évaluation, en PDF (ADR-0205 à ADR-0209).

   Chaque page porte l'en-tête du modèle de la DCH : « DCH », le titre de la
   fiche, puis le bloc de la République, la référence de la fiche et le
   numéro de la page. En pied, les mentions de la société (ADR-0203).

   Le texte est noir. Le bleu et l'orange de l'APIX viennent par touches,
   là où l'œil doit s'arrêter : le numéro et le titre de chaque section en
   bleu, le numéro d'une sous-section en orange, ce que l'agent et le N+1 ont
   coché en blanc sur bleu. Tout se lit sur une seule colonne, avec de
   l'air : des tableaux à filets horizontaux, des sections bien séparées. La
   grille des compétences passe à l'italienne, comme dans le modèle.

   Une section ne commence pas en bas de page ; une ligne de tableau ne se
   coupe pas ; un tableau qui passe à la page suivante y reprend ses titres
   de colonnes.

   Deux versions : celle de l'agent, sections 1 à 7 ; la version complète,
   avec la partie réservée à la hiérarchie, toujours sur une page à part.
   Et la fiche vierge, toutes ses sections à remplir à la main : des cases
   vides, des lignes pour chaque réponse. Avant l'évaluation, la partie de
   l'agent seule : l'identification, le bilan, chaque objectif avec son
   auto-évaluation, et les souhaits (ADR-0241).
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
/**
 * L'orange des numéros de sous-section et des étiquettes, plus soutenu que
 * celui de la charte (#CA631F), qui n'atteint pas 4,5:1 sur le blanc.
 */
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
/**
 * La largeur de la colonne des intitulés, dans les listes de clés et de
 * valeurs. Sur la fiche vierge, plus étroite : la place d'écrire s'élargit.
 */
const CLES = 170;
const CLES_DE_LA_FICHE_VIERGE = 130;
/** Le pas des lignes à écrire à la main : 22 points, près de 8 mm. */
const PAS_D_ECRITURE = 22;
/** La fiche vierge : ses blocs d'objectifs, ses lignes de tableaux, ses lignes de réponse. */
const VIERGE = {
  objectifs: 3,
  plan: 3,
  objectifsAVenir: 3,
  formations: 3,
  /** Les deux questions du récapitulatif de l'année : la place d'y revenir en détail. */
  recapitulatif: 8,
  /** Une réponse aux questions de l'agent. */
  reponse: 4,
  /** Un commentaire, des points forts, des axes de développement. */
  commentaire: 4,
  /** Les résultats et les commentaires d'un objectif. */
  objectif: 2,
} as const;

// ──────────────────────────────────────────────── le texte

/**
 * La typographie française d'un texte saisi : l'apostrophe courbe, l'espace
 * insécable avant « : ; ? ! » et dans les guillemets, et entre un nombre et ce
 * qui le suit (« 1 % », « 48 heures »). Une ligne ne commence jamais par un
 * signe de ponctuation, ni un nombre ne finit une ligne sans son unité.
 */
export function typographie(texte: string): string {
  return texte
    .replace(/'/g, '’')
    .replace(/(\d) +(?=[\p{L}%])/gu, '$1 ')
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

  /**
   * `vierge` : la fiche à remplir à la main, ses cases vides, ses lignes à
   * écrire. `agentSeul` : ce que l'agent remplit, sans le N+1 (ADR-0241).
   */
  constructor(
    readonly doc: Doc,
    readonly vierge = false,
    readonly agentSeul = false,
  ) {}

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
   * Le titre d'une section : son numéro en blanc sur un carré bleu, son
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
    this.doc.roundedRect(this.gauche, y, COTE, COTE, 3.5).fill(BLEU);
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
    const cles = this.vierge ? CLES_DE_LA_FICHE_VIERGE : CLES;
    return [
      { titre: '', largeur: cles },
      { titre: '', largeur: this.largeur - cles },
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

  /**
   * Le paraphe de qui a validé en ligne : ses initiales à la main, en noir,
   * un peu penchées, comme sur la grille (ADR-0151, ADR-0209). Allura n'a
   * qu'une graisse : son contour, tracé à la même encre, l'épaissit.
   */
  paraphe(nom: string, x: number, base: number, taille = 22): void {
    const texte = initiales(nom);
    if (!texte) return;
    this.doc.save();
    this.doc.rotate(-4, { origin: [x, base] });
    this.style({ famille: 'signature', taille });
    this.doc
      .lineWidth(taille * 0.045)
      .lineJoin('round')
      .strokeColor(ENCRE)
      .text(texte, x, base, { lineBreak: false, baseline: 'alphabetic', fill: true, stroke: true });
    this.doc.restore();
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

  // ─────────────── la fiche vierge

  /**
   * Des lignes à écrire à la main, sous `haut`, d'un trait fin. La dernière
   * n'est pas dessinée ici : c'est le filet qui ferme la ligne du tableau.
   */
  lignesAEcrire(x: number, haut: number, largeur: number, lignes: number): void {
    for (let k = 1; k < lignes; k++) {
      this.filet(haut + k * PAS_D_ECRITURE, FILETS.fin, x, largeur);
    }
  }

  /** Une cellule à remplir à la main : sa ligne de tableau mesure `lignes` pas d'écriture. */
  aEcrire(lignes = 1, colonnes?: number): Cellule {
    return {
      colonnes,
      hauteur: () => lignes * PAS_D_ECRITURE - 2 * MARGE_Y + INTERLIGNE,
      dessiner: (x, y, l) => this.lignesAEcrire(x, y - MARGE_Y, l, lignes),
    };
  }

  /** Un texte saisi ; sur la fiche vierge, ses lignes à écrire. */
  saisie(texte: string, lignes: number): Cellule {
    return this.vierge ? this.aEcrire(lignes) : this.texte(texte);
  }

  /** Une cellule laissée vide : la place d'un nom, d'une date, d'une signature. */
  blanc(lignes: number): Cellule {
    return {
      hauteur: () => lignes * PAS_D_ECRITURE - 2 * MARGE_Y + INTERLIGNE,
      dessiner: () => undefined,
    };
  }

  /** Un champ : son nom en petites capitales, et la place de l'écrire dessous. */
  champ(nom: string, place = 26): Cellule {
    const s: Style = { coupe: 'bold', taille: CAPITALES, espacement: 0.6 };
    const t = nom.toLocaleUpperCase('fr');
    return {
      hauteur: (l) => this.hauteurDe(t, l, s) + place,
      dessiner: (x, y, l) => this.ecrire(t, x, y, l, s),
    };
  }

  /**
   * Les quatre niveaux, chacun sa case vide : sur une ligne s'ils y tiennent,
   * sinon deux par ligne.
   */
  niveauxACocher(libelle: (n: Niveau) => string): Cellule {
    const sLettre: Style = { coupe: 'bold', taille: 9 };
    const s: Style = { taille: 9 };
    /** La case et son air. */
    const CASE = 15;
    /** L'air entre deux niveaux, sur une ligne. */
    const ECART = 14;
    const PAS = 16;
    const morceaux = (n: Niveau): [string, Style][] => [
      [`${n}  `, sLettre],
      [libelle(n), s],
    ];
    const largeurs = NIVEAUX.map(
      (n) =>
        CASE + morceaux(n).reduce((w, [t, st]) => w + this.doc.widthOfString(t, this.style(st)), 0),
    );
    const surUneLigne = (l: number) =>
      largeurs.reduce((t, w) => t + w, 0) + ECART * (NIVEAUX.length - 1) <= l;
    return {
      hauteur: (l) => (surUneLigne(l) ? 0 : PAS) + this.hauteurDe('A', l, s),
      dessiner: (x, y, l) => {
        const uneLigne = surUneLigne(l);
        let suivant = x;
        NIVEAUX.forEach((n, i) => {
          const xi = uneLigne ? suivant : x + (i % 2) * (l / 2);
          const yi = uneLigne ? y : y + Math.floor(i / 2) * PAS;
          this.caseACocher(xi, yi + 1.2, false, 9);
          this.ecrireEnLigne(xi + CASE, yi, x + l - xi - CASE, morceaux(n));
          suivant += largeurs[i]! + ECART;
        });
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
  return composer(d, false);
}

/**
 * La partie de l'agent, avant sa transmission au N+1 (ADR-0241) :
 * l'identification, le bilan de l'année, chaque objectif avec son
 * auto-évaluation, et les souhaits. Rien du N+1 : ni son appréciation,
 * ni les compétences, ni les perspectives, ni les validations.
 */
export async function ficheDeLAgentPdf(d: DonneesDeLaFiche): Promise<Buffer> {
  return composer(d, false, true);
}

/**
 * La fiche vierge d'une année : toutes ses sections, celles de l'agent, du
 * N+1 et du N+2, à remplir à la main (ADR-0208).
 */
export async function ficheViergePdf(annee: number): Promise<Buffer> {
  return composer(
    {
      annee,
      // Toutes les compétences, le management compris ; aucune case n'est cochée.
      personnel: 'cadre',
      agent: {
        prenom: '',
        nom: '',
        fonction: null,
        matricule: null,
        direction: null,
        departement: null,
        service: null,
        anciennete: null,
        posteDepuis: null,
      },
      n1: null,
      dateDeLEntretien: null,
      objectifs: [],
      auto: autoEvaluationVide(),
      evaluation: evaluationDuN1Vide(),
      reservee: partieReserveeVide(),
      validations: { n1: null, agent: null },
      n2: null,
    },
    true,
  );
}

async function composer(d: DonneesDeLaFiche, vierge: boolean, agentSeul = false): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 0,
    bufferPages: true,
    lang: 'fr-FR',
    displayTitle: true,
    info: {
      Title: vierge
        ? `${TITRE_DE_LA_FICHE} ${d.annee}`
        : `${TITRE_DE_LA_FICHE} ${d.annee} · ${nomImprime(d.agent)}`,
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

  const f = new Composition(doc, vierge, agentSeul);
  identification(f, d);
  bilan(f, d);
  if (agentSeul) {
    souhaits(f, d);
  } else {
    competences(f, d);
    synthese(f, d);
    perspectives(f, d);
    souhaits(f, d);
    validation(f, d);
    if (d.reservee) partieReservee(f, d, d.reservee);
  }

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
  if (!f.vierge) {
    const agent = [nomImprime(d.agent), d.agent.matricule ? `Matricule ${d.agent.matricule}` : null]
      .filter(Boolean)
      .join('  ·  ');
    const sAgent: Style = { taille: 7.4 };
    f.style(sAgent);
    enLigne(agent, x0 + L - 8 - doc.widthOfString(agent), centre(y0, CARTOUCHE.dch, 7.4), sAgent);
  }

  // Le titre de la fiche, au milieu de sa bande.
  const titre = TITRE_DE_LA_FICHE.toLocaleUpperCase('fr');
  const sTitre: Style = { coupe: 'bold', taille: 10.6, espacement: 0.7 };
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

/** Le pied de chaque page : les mentions de la société. */
function pied(doc: Doc): void {
  const { width: largeur, height: hauteur } = doc.page;
  dessinerPiedDePage(doc, null, { largeur, hauteur });
}

// ──────────────────────────────────────────────── 1. Identification

function identification(f: Composition, d: DonneesDeLaFiche): void {
  f.section(1, 'Identification de l’agent et de l’évaluateur', 160);
  const a = d.agent;

  /** Des cases côte à côte ; la cochée en gras. */
  const choix = (options: readonly (readonly [libelle: string, coche: boolean])[]): Cellule => ({
    hauteur: () => f.hauteurDe('Cadre', 100) - INTERLIGNE,
    dessiner: (x, y) => {
      let xc = x;
      for (const [libelle, coche] of options) {
        f.caseACocher(xc, y + 1.4, coche, 9);
        f.ecrire(libelle, xc + 15, y, 100, { coupe: coche ? 'bold' : 'normal' });
        xc += 110;
      }
    },
  });
  const categorie = choix(
    PERSONNELS_DE_LA_FICHE.map((p) => [LIBELLES_DU_PERSONNEL[p], !f.vierge && d.personnel === p]),
  );
  const dateDeLEntretien = f.vierge
    ? f.aEcrire()
    : d.dateDeLEntretien
      ? f.texte(dateEnLettres(d.dateDeLEntretien), { coupe: 'bold' })
      : f.texte('À fixer', { coupe: 'italic' });
  f.cles([
    ['Catégorie', categorie],
    ['Période évaluée', f.texte(`Année ${d.annee}`, { coupe: 'bold' })],
    ['Date de l’entretien', dateDeLEntretien],
  ]);

  const valeur = (v: string | null) => (f.vierge ? f.aEcrire() : f.texte(v ? typographie(v) : '–'));
  const priseDePoste = f.vierge
    ? choix([
        ['Non', false],
        ['Oui, depuis le', false],
      ])
    : valeur(
        a.posteDepuis && a.posteDepuis.slice(0, 4) === String(d.annee)
          ? `Oui, depuis le ${dateEnLettres(a.posteDepuis)}`
          : 'Non',
      );
  const deLAgent: (readonly [string, string | null])[] = [
    ['Prénom et nom', nomImprime(a)],
    ['Matricule', a.matricule],
    ['Fonction', a.fonction],
    ['Direction', a.direction],
    ['Département', a.departement],
    ['Service', a.service],
    ['Ancienneté au poste', a.anciennete],
  ];
  f.etiquette('L’agent', ORANGE_TEXTE, 120, 22);
  f.cles([
    // Sur la fiche vierge, toutes les lignes ; sinon, celles que le dossier renseigne.
    ...deLAgent
      .filter(([, v]) => f.vierge || v !== null)
      .map(([cle, v]) => [cle, valeur(v)] as const),
    [`Prise de poste en ${d.annee}`, priseDePoste],
  ]);

  f.etiquette('L’évaluateur (N+1)', ORANGE_TEXTE, 60, 22);
  f.cles([
    ['Prénom et nom', valeur(d.n1 ? nomImprime(d.n1) : null)],
    ['Fonction', valeur(d.n1?.fonction ?? null)],
  ]);
}

// ──────────────────────────────────────────────── 2. Bilan de l'année

/** Une question de l'auto-évaluation, telle que les contrats la donnent. */
type QuestionDeLAuto =
  (typeof QUESTIONS_DU_BILAN)[number] | (typeof QUESTIONS_DES_SOUHAITS)[number];

/**
 * La réponse imprimée d'une question de l'auto-évaluation (ADR-0238) : ses
 * puces, ou « Oui » et ses puces, ou « Non ». Sans choix, le texte tel qu'il
 * est écrit : une fiche vierge garde ses lignes à remplir.
 */
function reponseDeLAuto(auto: AutoEvaluation, q: QuestionDeLAuto): string {
  const texte = auto[q.cle];
  const enPuces = () =>
    pucesDe(texte)
      .map((p) => `- ${p}`)
      .join('\n');
  if ('ouiNon' in q) {
    const oui = auto[q.ouiNon];
    if (oui === false) return 'Non';
    if (oui === true) return ['Oui', enPuces()].filter(Boolean).join('\n');
    return texte;
  }
  return 'puces' in q ? enPuces() : texte;
}

function bilan(f: Composition, d: DonneesDeLaFiche): void {
  const recapitulatif: Question[] = QUESTIONS_DU_BILAN.map((q) => [
    q.question,
    reponseDeLAuto(d.auto, q),
    VIERGE.recapitulatif,
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
  const objectifs = f.vierge
    ? Array.from({ length: VIERGE.objectifs }, (_, i) => objectif(f, d, null, i))
    : d.objectifs.map((o, i) => objectif(f, d, o, i));
  const premier = objectifs[0]?.hauteur ?? 30;
  const chapeau = `L’atteinte des objectifs fixés pour ${d.annee}.`;
  const hChapeau = f.hauteurDe(chapeau, f.largeur, { coupe: 'italic', taille: 9 }) + 14;
  f.sousSection('2.2', 'Évaluation des résultats', hChapeau + 60 + premier);
  f.chapeau(chapeau);
  f.sousSection(
    '2.2.1',
    'Les objectifs fixés',
    premier,
    f.agentSeul ? 'Rempli par l’agent' : 'Auto-évaluation, puis appréciation du N+1',
  );
  // Sans objectif, la mention seule : l'échelle n'aurait rien à noter (ADR-0244).
  if (objectifs.length === 0) {
    f.mention('Aucun objectif n’a été fixé pour cette année.', 0);
  } else {
    for (const o of objectifs) o.poser();
    echelle(f);
  }

  // Sur la fiche vierge, les autres réalisations prennent les lignes qui
  // restent sur la page, avant la grille des compétences à l'italienne.
  const titre = 'Autres réalisations en dehors des objectifs';
  const qui222 = 'Rempli par l’agent';
  const lignes = f.vierge
    ? lignesQuiRestent(f, f.hauteurDuSousTitre('2.2.2', titre, qui222))
    : VIERGE.commentaire;
  f.sousSection('2.2.2', titre, hauteurDuParagraphe(f, d.auto.autresRealisations, lignes), qui222);
  paragrapheLibre(f, d.auto.autresRealisations, lignes);
}

/**
 * Les lignes à écrire qui tiennent encore sur la page sous un titre de
 * sous-section, avec ce qui doit les suivre (`apres`) : de trois à six. S'il
 * en tient moins de trois, le titre passe à la page suivante avec ses lignes
 * habituelles.
 */
function lignesQuiRestent(f: Composition, titre: number, apres = 0): number {
  const reste = f.bas - f.y - AIR.avantSousSection - titre - 2 - apres;
  const lignes = Math.floor(reste / PAS_D_ECRITURE);
  return lignes >= 3 ? Math.min(lignes, 6) : VIERGE.commentaire;
}

/**
 * Un objectif : son intitulé et ses indicateurs, l'auto-évaluation de
 * l'agent, puis l'appréciation du N+1, sauf sur la partie de l'agent seule.
 * Sa hauteur, et de quoi le poser, d'un seul tenant sur sa page quand il y
 * tient. Sur la fiche vierge (`o` à null), l'intitulé et les indicateurs
 * s'écrivent aussi à la main.
 */
function objectif(
  f: Composition,
  d: DonneesDeLaFiche,
  o: ObjectifEvalue | null,
  i: number,
): { hauteur: number; poser: () => void } {
  const agent = o ? d.auto.objectifs[o.id] : undefined;
  const n1 = o ? d.evaluation.objectifs[o.id] : undefined;
  const libelle = (n: Niveau) => NIVEAUX_D_ATTEINTE[n].libelle;
  const niveau = (choisi: Niveau | null) =>
    f.vierge ? f.niveauxACocher(libelle) : f.niveau(choisi, libelle);
  const intitule = o ? typographie(o.intitule) : '';
  const indicateurs = o?.indicateurs ? typographie(o.indicateurs) : '';
  const sIntitule: Style = { coupe: 'bold', taille: 10.6 };
  const morceaux: [string, Style][] = [
    ['Indicateurs : ', { famille: 'raleway-semibold', taille: 9 }],
    [indicateurs, { taille: 9 }],
  ];
  const aEcrire: [string, Cellule][] = [
    ['Intitulé', f.aEcrire(2)],
    ['Indicateurs', f.aEcrire(2)],
  ];
  const deLAgent: [string, Cellule][] = [
    ['Niveau', niveau(agent?.niveau ?? null)],
    ['Résultats obtenus', f.saisie(agent?.resultats ?? '', VIERGE.objectif)],
    ['Commentaire', f.saisie(agent?.commentaire ?? '', VIERGE.objectif)],
  ];
  const duN1: [string, Cellule][] = [
    ['Niveau', niveau(n1?.niveau ?? null)],
    ['Commentaire', f.saisie(n1?.commentaire ?? '', VIERGE.objectif)],
  ];
  const etiquettes = {
    objectif: `Objectif ${i + 1}`,
    agent: 'Auto-évaluation de l’agent',
    n1: 'Appréciation du N+1',
  };
  const avant = i > 0 ? 34 : 0;
  const hIntitule = f.vierge
    ? f.hauteurDesCles(aEcrire) + 2
    : f.hauteurDe(intitule, f.largeur, sIntitule);
  const hIndicateurs = indicateurs ? f.hauteurEnLigne(f.largeur, morceaux) + 2 : 0;
  const hauteur =
    f.hauteurDeLEtiquette(etiquettes.objectif) +
    hIntitule +
    hIndicateurs +
    (16 + f.hauteurDeLEtiquette(etiquettes.agent) + f.hauteurDesCles(deLAgent)) +
    (f.agentSeul ? 0 : 18 + f.hauteurDeLEtiquette(etiquettes.n1) + f.hauteurDesCles(duN1)) +
    2;
  return {
    hauteur,
    poser: () => {
      // L'objectif entier sur la page, s'il tient sur une page.
      f.place(avant + Math.min(hauteur, f.bas - HAUT_DU_TEXTE - avant));
      f.etiquette(etiquettes.objectif, ORANGE_TEXTE, hIntitule + hIndicateurs + 90, avant);
      if (f.vierge) {
        f.cles(aEcrire);
      } else {
        f.ecrire(intitule, f.gauche, f.y, f.largeur, sIntitule);
        f.y += hIntitule;
      }
      if (indicateurs) {
        f.ecrireEnLigne(f.gauche, f.y + 1, f.largeur, morceaux);
        f.y += hIndicateurs;
      }
      f.etiquette(etiquettes.agent, BLEU, 60, 16);
      f.cles(deLAgent);
      if (!f.agentSeul) {
        f.etiquette(etiquettes.n1, BLEU, 60, 18);
        f.cles(duN1);
      }
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

/** Une question, sa réponse, et le nombre de lignes de sa réponse sur la fiche vierge. */
type Question = readonly [question: string, reponse: string, lignes?: number];

/** Des questions et leurs réponses, l'une sous l'autre, séparées d'un trait fin. */
function questionsReponses(f: Composition, qr: readonly Question[]): void {
  f.tableau(pleineLargeur(f), lignesDeQuestions(f, qr), { titres: false });
}

/** Ce que les questions posent sur leur première page, pour que leur titre parte avec. */
function debutDesQuestions(f: Composition, qr: readonly Question[]): number {
  return f.debutDuTableau(pleineLargeur(f), lignesDeQuestions(f, qr), { titres: false });
}

function lignesDeQuestions(f: Composition, qr: readonly Question[]): Cellule[][] {
  const sQuestion: Style = { coupe: 'bold', taille: 9.5 };
  return qr.map(([question, reponse, lignes = VIERGE.reponse]) => {
    const q = typographie(question);
    const hQuestion = (l: number) => f.hauteurDe(q, l, sQuestion);
    // Sur la fiche vierge, les lignes partent du bas de la question, au pas
    // d'écriture ; la dernière est le filet sous la réponse.
    const hauteur = (l: number) =>
      f.vierge
        ? hQuestion(l) + lignes * PAS_D_ECRITURE - MARGE_Y
        : hQuestion(l) + 4 + f.hauteurDuTexte(reponse, l);
    return [
      {
        hauteur,
        dessiner: (x: number, y: number, l: number) => {
          f.ecrire(q, x, y, l, sQuestion);
          if (f.vierge) f.lignesAEcrire(x, y + hQuestion(l) - INTERLIGNE, l, lignes);
          else f.ecrireLeTexte(reponse, x, y + hQuestion(l) + 4, l);
        },
      },
    ];
  });
}

/** Un texte libre sous un titre, entre deux filets ; sur la fiche vierge, ses lignes. */
function paragrapheLibre(f: Composition, texte: string, lignes: number = VIERGE.commentaire): void {
  f.tableau(pleineLargeur(f), [[f.saisie(texte, lignes)]], { titres: false });
}

/** La hauteur d'un texte libre : le titre au-dessus part avec lui. */
function hauteurDuParagraphe(
  f: Composition,
  texte: string,
  lignes: number = VIERGE.commentaire,
): number {
  return f.debutDuTableau(pleineLargeur(f), [[f.saisie(texte, lignes)]], { titres: false });
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
      const intitule = typographie(c.intitule);
      const debut = [
        f.intitule(String(i + 1), { taille: 9 }, 8.6),
        // Sur la fiche vierge, le management dit à qui il s'applique.
        c.cadres && f.vierge
          ? avecPrecision(f, intitule, 'Personnel cadre seulement')
          : f.intitule(intitule, { taille: 9 }, 8.6),
      ];
      if (c.cadres && !choisi && !f.vierge) {
        return [
          ...debut,
          { ...f.texte('Sans objet', { coupe: 'italic', taille: 9 }), colonnes: 4 },
        ];
      }
      return [...debut, ...NIVEAUX.map((n) => f.niveauDeLaGrille(n, c.niveaux[n], choisi))];
    }),
  );
}

/** Un intitulé en gras, et dessous sa précision en italique. */
function avecPrecision(f: Composition, intitule: string, precision: string): Cellule {
  const s: Style = { coupe: 'bold', taille: 9 };
  const sPrecision: Style = { coupe: 'italic', taille: PETIT };
  return {
    hauteur: (l) => f.hauteurDe(intitule, l, s) + f.hauteurDe(precision, l, sPrecision),
    dessiner: (x, y, l) => {
      f.ecrire(intitule, x, y, l, s);
      f.ecrire(precision, x, y + f.hauteurDe(intitule, l, s), l, sPrecision);
    },
  };
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
    ['Points forts', f.saisie(e.pointsForts, VIERGE.commentaire)],
    ['Axes de développement', f.saisie(e.axesDeDeveloppement, VIERGE.commentaire)],
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

  const plan = f.vierge
    ? Array.from({ length: VIERGE.plan }, () => [f.aEcrire(2), f.aEcrire(2), f.aEcrire(2)])
    : e.plan
        .filter((a) => a.action.trim() || a.suivi.trim())
        .map((a) => [f.texte(a.action), f.texte(a.delai), f.texte(a.suivi)]);
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
    plan,
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
  const numero = (i: number) => f.intitule(String(i + 1), { taille: 8.8 });
  const objectifs = f.vierge
    ? Array.from({ length: VIERGE.objectifsAVenir }, (_, i) => [
        numero(i),
        f.aEcrire(2),
        f.aEcrire(2),
        f.aEcrire(2),
      ])
    : e.objectifsAVenir
        .filter((o) => o.objectif.trim())
        .map((o, i) => [
          numero(i),
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

  const formations = f.vierge
    ? Array.from({ length: VIERGE.formations }, (_, i) => [numero(i), f.aEcrire(2), f.aEcrire(2)])
    : e.formations
        .filter((x) => x.intitule.trim())
        .map((x, i) => [numero(i), f.texte(x.intitule), f.texte(x.justification)]);
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
    formations,
  );
}

// ──────────────────────────────────────────────── 6. Souhaits de l'agent

function souhaits(f: Composition, d: DonneesDeLaFiche): void {
  const questions: Question[] = [
    ...QUESTIONS_DES_SOUHAITS.map((q): Question => [
      `${q.question}${'precision' in q ? ` (${q.precision})` : ''}`,
      reponseDeLAuto(d.auto, q),
    ]),
    ['Autres commentaires', d.auto.autresCommentaires, VIERGE.reponse - 1],
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
  /** Validée en ligne : le paraphe, et dessous, en petit, la mention. */
  const signee = (p: { prenom: string; nom: string } | null): Cellule => ({
    hauteur: () => 31,
    dessiner: (x, y, l) => {
      if (p) f.paraphe(nomImprime(p), x + 2, y + 16);
      f.doc.save().fillOpacity(0.72);
      f.ecrire('Validation en ligne', x, y + 21, l, { coupe: 'italic', taille: 7.4 });
      f.doc.restore();
    },
  });
  const ligne = (
    role: string,
    p: { prenom: string; nom: string } | null,
    le: string | null,
  ): Cellule[] =>
    f.vierge
      ? // Sur la fiche vierge, la place d'écrire et de signer.
        [f.intitule(role), f.blanc(2), f.blanc(2), f.blanc(2)]
      : [
          f.intitule(role),
          f.texte(p ? nomImprime(p) : ''),
          f.texte(le ? dateInsecable(le) : ''),
          le ? signee(p) : { hauteur: () => 26, dessiner: () => undefined },
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

  if (f.vierge) {
    const n1 = commentaireSigne(f, VIERGE.commentaire + 2);
    f.sousSection('8.2', 'Observations du N+1', n1.hauteur);
    n1.poser();
    const n2 = commentaireSigne(f, VIERGE.commentaire + 1);
    f.sousSection('8.3', 'Commentaires du N+2', n2.hauteur);
    n2.poser();
  } else {
    // Le texte part avec son titre, la signature le suit.
    const n2 = d.n2?.commentaires ?? '';
    f.sousSection('8.2', 'Observations du N+1', hauteurDuParagraphe(f, r.observations) + 30);
    paragrapheLibre(f, r.observations);
    signature(f, 'N+1', d.n1, d.validations.n1);
    f.sousSection('8.3', 'Commentaires du N+2', hauteurDuParagraphe(f, n2) + 30);
    paragrapheLibre(f, n2);
    signature(f, 'N+2', d.n2, d.n2?.le ?? null);
  }

  // À la main, sur l'original : des lignes à écrire, entre deux filets, qui
  // prennent la place restant sur la dernière page ; la diffusion les suit.
  const diffusion =
    'Diffusion : original au dossier du personnel (DCH)  ·  copie 1 au N+1  ·  copie 2 au N+2, selon le circuit de validation.';
  const hDiffusion = 14 + f.hauteurDe(diffusion, f.largeur, { taille: PETIT });
  const titre84 = 'Commentaires des autres niveaux hiérarchiques';
  const lignes = lignesQuiRestent(f, f.hauteurDuSousTitre('8.4', titre84), hDiffusion);
  const autres = [[f.aEcrire(lignes)]];
  f.sousSection(
    '8.4',
    titre84,
    f.debutDuTableau(pleineLargeur(f), autres, { titres: false }) + hDiffusion,
  );
  f.tableau(pleineLargeur(f), autres, { titres: false });

  f.mention(diffusion, 14);
}

/**
 * Sur la fiche vierge : les lignes d'un commentaire, puis le nom, la
 * fonction, la date et la signature de qui l'écrit, dans un même tableau.
 */
function commentaireSigne(f: Composition, lignes: number): { hauteur: number; poser: () => void } {
  const cols = colonnes(f, ['', 1.5], ['', 1.6], ['', 1], ['', 1.3]);
  const rangs: Cellule[][] = [
    [f.aEcrire(lignes, 4)],
    [f.champ('Prénom et nom'), f.champ('Fonction'), f.champ('Date'), f.champ('Signature')],
  ];
  return {
    hauteur: f.debutDuTableau(cols, rangs, { titres: false }),
    poser: () => f.tableau(cols, rangs, { titres: false }),
  };
}

/**
 * La signature d'une partie, sous son texte : qui, sa fonction, la date de la
 * validation en ligne, et le paraphe à droite. Sans validation, la place de
 * signer à la main.
 *
 * Le rôle se met en retrait ; quand tout ne tient pas sur une ligne, la
 * validation passe entière à la ligne, sous le nom, plutôt que de se couper.
 */
function signature(
  f: Composition,
  role: string,
  p: PersonneDeLaFiche | null,
  le: string | null,
): void {
  const sRole: Style = { coupe: 'bold', taille: 8.8, couleur: ORANGE_TEXTE };
  const sMention: Style = { coupe: 'italic', taille: 8.8 };
  f.style(sRole);
  const retrait = Math.max(f.doc.widthOfString('N+1'), f.doc.widthOfString('N+2')) + 7;
  /** La place du paraphe, au bout de la ligne. */
  const PARAPHE = 76;
  const paraphe = le && p ? nomImprime(p) : null;
  const x = f.gauche + retrait;
  const largeur = f.largeur - retrait - (paraphe ? PARAPHE : 0);

  const qui: [string, Style][] = [];
  if (p) {
    qui.push([nomImprime(p), { famille: 'raleway-semibold', taille: 8.8 }]);
    if (p.fonction) qui.push([`, ${typographie(p.fonction)}`, { taille: 8.8 }]);
  }
  const mention = le
    ? `Validation en ligne le\u00a0${dateInsecable(le)}`
    : 'Date et signature\u00a0:';
  const enUneLigne: [string, Style][] = [
    ...qui,
    [qui.length ? `   ·   ${mention}` : mention, sMention],
  ];
  const largeurDe = (morceaux: readonly [string, Style][]) =>
    morceaux.reduce((somme, [t, s]) => somme + f.doc.widthOfString(t, f.style(s)), 0);
  const surUneLigne = largeurDe(enUneLigne) <= largeur - 1;

  // La hauteur, pour ne pas couper la signature d'une page à l'autre ; le
  // paraphe se centre sur le texte, et déborde un peu dessous.
  const h = surUneLigne
    ? f.hauteurDe(mention, largeur, sMention)
    : (qui.length ? f.hauteurEnLigne(largeur, qui) : 0) + f.hauteurDe(mention, largeur, sMention);
  const baseDuParaphe = h / 2 + 7;
  const hBloc = paraphe ? Math.max(h, baseDuParaphe + 6) : h;
  f.place(9 + hBloc);
  f.y += 9;
  const haut = f.y;
  f.ecrire(role, f.gauche, f.y, retrait, sRole);
  if (surUneLigne) {
    f.ecrireEnLigne(x, f.y, largeur, enUneLigne);
  } else {
    if (qui.length) f.ecrireEnLigne(x, f.y, largeur, qui);
    // pdfkit pose `doc.y` sous la dernière ligne écrite.
    f.ecrire(mention, x, qui.length ? f.doc.y : f.y, largeur, sMention);
  }
  if (paraphe) f.paraphe(paraphe, f.droite - PARAPHE + 16, haut + baseDuParaphe);
  f.y = Math.max(f.doc.y, haut + hBloc);
}
