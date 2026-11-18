import PDFDocument from 'pdfkit';
import {
  competencesDe,
  dateEnLettres,
  LIBELLES_DU_PERSONNEL,
  NIVEAUX,
  NIVEAUX_D_ATTEINTE,
  NIVEAUX_DE_COMPETENCE,
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
  cheminLogo,
  chiffresAlignes,
  dessinerEnTete,
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
   La fiche d'entretien annuel d'évaluation, en PDF (ADR-0205).

   Le papier des documents de la DCH : l'en-tête de la République sur la
   première page, les mentions de la société en pied de chaque page, tout
   à l'encre noire (ADR-0203). Raleway pour le texte, aux chiffres alignés ;
   Anton pour le titre, souligné d'un court filet.

   La grille se lit d'un bout à l'autre sans cadre inutile : des tableaux à
   filets horizontaux seulement (un trait fort en haut et en bas, un trait
   fin entre les lignes), des colonnes alignées à gauche, du blanc pour
   séparer. Une section ne commence pas en bas de page ; un tableau qui
   passe à la page suivante y reprend ses titres de colonnes. À partir de la
   deuxième page, un bandeau rappelle la fiche et l'agent : une feuille
   détachée se range d'elle-même.

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

// ──────────────────────────────────────────────── la page

const LARGEUR_DE_PAGE = 595.28;
/** Les bords du texte : ceux du papier de la DCH, calés sur le logo. */
const DROITE = 544.5;
const GAUCHE = LARGEUR_DE_PAGE - DROITE;
const LARGEUR = DROITE - GAUCHE;
/** Le haut du texte sous le bandeau des pages suivantes. */
const HAUT_DES_SUITES = 86;
/** Le bas du texte, à l'air des mentions du pied de page. */
const BAS = HAUT_DU_PIED - 16;

const CORPS = 9;
const INTERLIGNE = 2.7;
const CORPS_PETIT = 7.6;
const CORPS_DES_TITRES_DE_COLONNE = 6.9;
const FILETS = { fort: 0.8, moyen: 0.45, fin: 0.25 } as const;
/** Le blanc autour du texte d'une cellule. */
const MARGE_X = 5;
const MARGE_Y = 4.6;
const BLANC = '#FFFFFF';
const NEANT = 'Néant';

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

interface Style {
  coupe?: Coupe;
  famille?: Famille;
  taille?: number;
  espacement?: number;
}

/** La fiche, page après page. */
class Composition {
  /** Le haut du texte de la page en cours : sous l'en-tête ou sous le bandeau. */
  private haut = HAUT_DES_SUITES;
  y = HAUT_DES_SUITES;

  constructor(readonly doc: Doc) {}

  /** Une police et un corps, pour écrire ou mesurer. */
  style({ coupe = 'normal', famille = 'raleway', taille = CORPS, espacement }: Style = {}) {
    this.doc
      .font(police(this.doc, coupe, famille))
      .fontSize(taille)
      .fillColor(ENCRE);
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
    align?: 'left' | 'right' | 'center',
  ) {
    const o = this.style(s);
    this.doc.text(texte, x, y, { ...o, width: largeur, align: align ?? 'left' });
  }

  /** Le haut d'une page neuve. */
  nouvellePage(): void {
    this.doc.addPage();
    this.haut = HAUT_DES_SUITES;
    this.y = HAUT_DES_SUITES;
  }

  /** La page commence ici (la première, sous son titre). */
  commencer(y: number): void {
    this.haut = y;
    this.y = y;
  }

  get enHautDePage(): boolean {
    return this.y <= this.haut + 0.5;
  }

  /** Une nouvelle page si `hauteur` ne tient plus dans celle-ci. */
  place(hauteur: number): void {
    if (this.y + hauteur > BAS && !this.enHautDePage) this.nouvellePage();
  }

  filet(y: number, epaisseur: number, x = GAUCHE, largeur = LARGEUR): void {
    this.doc
      .moveTo(x, y)
      .lineTo(x + largeur, y)
      .lineWidth(epaisseur)
      .strokeColor(ENCRE)
      .stroke();
  }

  // ─────────────── les blocs de texte

  /** La hauteur d'un texte saisi : ses paragraphes et ses puces. */
  hauteurDuTexte(texte: string, largeur: number, s: Style = {}): number {
    const ps = paragraphes(texte);
    if (ps.length === 0) return this.hauteurDe(NEANT, largeur, { ...s, coupe: 'italic' });
    return ps.reduce(
      (h, p, i) =>
        h +
        (i > 0 ? 2.5 : 0) +
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
      if (i > 0) h += 2.5;
      if (p.puce) {
        const taille = s.taille ?? CORPS;
        this.doc.circle(x + 2.2, y + h + taille * 0.62, 1.05).fill(ENCRE);
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

  /**
   * Le titre d'une section : son numéro, son intitulé en capitales espacées,
   * un trait fort dessous. Il ne reste jamais seul en bas d'une page :
   * `suite` est la hauteur de ce qui doit le suivre sur la même page.
   */
  section(numero: number, intitule: string, suite: number, qui?: string): void {
    const avant = this.enHautDePage ? 0 : 20;
    this.place(avant + 24 + suite);
    if (!this.enHautDePage) this.y += avant;
    const base = this.y;
    this.ecrire(String(numero), GAUCHE, base, 20, { coupe: 'bold', taille: 10.5 });
    this.ecrire(intitule.toLocaleUpperCase('fr'), GAUCHE + 20, base, LARGEUR - 20 - 120, {
      coupe: 'bold',
      taille: 10.5,
      espacement: 0.7,
    });
    if (qui) {
      this.ecrire(
        qui,
        DROITE - 150,
        base + 2.6,
        150,
        { coupe: 'italic', taille: CORPS_PETIT },
        'right',
      );
    }
    const h = this.hauteurDe(intitule.toLocaleUpperCase('fr'), LARGEUR - 140, {
      coupe: 'bold',
      taille: 10.5,
      espacement: 0.7,
    });
    this.y = base + h + 3;
    this.filet(this.y, FILETS.fort);
    this.y += 10;
  }

  /** Le titre d'une sous-section : « 2.1 », son intitulé, et qui la remplit. */
  sousSection(numero: string, intitule: string, suite: number, qui?: string): void {
    const avant = this.enHautDePage ? 0 : 12;
    this.place(avant + 18 + suite);
    if (!this.enHautDePage) this.y += avant;
    const base = this.y;
    const largeurDuNumero = numero.length > 3 ? 34 : 26;
    this.ecrire(numero, GAUCHE, base, largeurDuNumero, { coupe: 'bold', taille: 9.6 });
    this.ecrire(intitule, GAUCHE + largeurDuNumero, base, LARGEUR - largeurDuNumero - 150, {
      coupe: 'bold',
      taille: 9.6,
    });
    if (qui) {
      this.ecrire(
        qui,
        DROITE - 150,
        base + 1.6,
        150,
        { coupe: 'italic', taille: CORPS_PETIT },
        'right',
      );
    }
    this.y =
      base +
      this.hauteurDe(intitule, LARGEUR - largeurDuNumero - 150, { coupe: 'bold', taille: 9.6 }) +
      6;
  }

  /** Une phrase sous un titre, en italique. */
  chapeau(texte: string): void {
    const h = this.hauteurDe(texte, LARGEUR, { coupe: 'italic', taille: 8.4 });
    this.place(h + 6);
    this.ecrire(texte, GAUCHE, this.y, LARGEUR, { coupe: 'italic', taille: 8.4 });
    this.y += h + 6;
  }

  /** Une ligne en petit corps : la diffusion, une mention. */
  mention(texte: string, avant = 8): void {
    const h = this.hauteurDe(texte, LARGEUR, { taille: CORPS_PETIT });
    this.place(avant + h);
    this.y += avant;
    this.ecrire(texte, GAUCHE, this.y, LARGEUR, { taille: CORPS_PETIT });
    this.y += h;
  }

  // ─────────────── les tableaux

  /**
   * Un tableau à filets : un trait fort en haut, les titres des colonnes, un
   * trait moyen, les lignes séparées d'un trait fin, un trait fort en bas.
   * Une ligne ne se coupe pas : celle qui ne tient plus passe à la page
   * suivante, sous les titres des colonnes répétés.
   */
  tableau(
    colonnes: readonly Colonne[],
    lignes: readonly (readonly Cellule[])[],
    o: { titres?: boolean; marge?: number } = {},
  ): void {
    const titres = o.titres ?? true;
    const MARGE_DE_CELLULE = { x: o.marge ?? MARGE_X, y: MARGE_Y };
    const xs = colonnes.reduce<number[]>(
      (acc, c, i) => [...acc, (acc[i - 1] ?? GAUCHE) + (i > 0 ? colonnes[i - 1]!.largeur : 0)],
      [],
    );
    const hauteurDesTitres = titres
      ? Math.max(
          ...colonnes.map((c) =>
            this.hauteurDe(c.titre.toLocaleUpperCase('fr'), c.largeur - 2 * MARGE_DE_CELLULE.x, {
              coupe: 'bold',
              taille: CORPS_DES_TITRES_DE_COLONNE,
              espacement: 0.5,
            }),
          ),
        ) +
        2 * MARGE_DE_CELLULE.y
      : 0;
    const hauteurDe = (ligne: readonly Cellule[]) =>
      Math.max(
        ...ligne.map((cellule, i) => {
          const largeur = largeurDeLaCellule(colonnes, i, cellule) - 2 * MARGE_DE_CELLULE.x;
          return cellule.hauteur(largeur);
        }),
      ) +
      2 * MARGE_DE_CELLULE.y;

    const poserLesTitres = () => {
      this.filet(this.y, FILETS.fort);
      if (!titres) return;
      colonnes.forEach((c, i) =>
        this.ecrire(
          c.titre.toLocaleUpperCase('fr'),
          xs[i]! + MARGE_DE_CELLULE.x,
          this.y + MARGE_DE_CELLULE.y + 0.6,
          c.largeur - 2 * MARGE_DE_CELLULE.x,
          { coupe: 'bold', taille: CORPS_DES_TITRES_DE_COLONNE, espacement: 0.5 },
          c.aligne,
        ),
      );
      this.y += hauteurDesTitres;
      this.filet(this.y, FILETS.moyen);
    };

    const premiere = lignes[0] ? hauteurDe(lignes[0]) : 0;
    this.place(hauteurDesTitres + premiere + 2);
    poserLesTitres();
    lignes.forEach((ligne, n) => {
      const h = hauteurDe(ligne);
      if (this.y + h > BAS && n > 0) {
        this.filet(this.y, FILETS.fort);
        this.nouvellePage();
        poserLesTitres();
      }
      let i = 0;
      for (const cellule of ligne) {
        const largeur = largeurDeLaCellule(colonnes, i, cellule);
        cellule.dessiner(
          xs[i]! + MARGE_DE_CELLULE.x,
          this.y + MARGE_DE_CELLULE.y,
          largeur - 2 * MARGE_DE_CELLULE.x,
        );
        i += cellule.colonnes ?? 1;
      }
      this.y += h;
      if (n < lignes.length - 1) this.filet(this.y, FILETS.fin);
    });
    this.filet(this.y, FILETS.fort);
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

  /** Une cellule d'intitulé : un texte fixe, en gras. */
  intitule(texte: string, s: Style = {}, sur = CORPS): Cellule {
    const st: Style = { coupe: 'bold', taille: 8.4, ...s };
    // Plus petit que le texte de sa ligne, il descend sur la même ligne de base.
    const decalage = Math.max(0, (sur - (st.taille ?? CORPS)) * 0.94);
    return {
      hauteur: (l) => this.hauteurDe(texte, l, st) + decalage,
      dessiner: (x, y, l) => this.ecrire(texte, x, y + decalage, l, st),
    };
  }

  /** Une case à cocher, pleine et cochée quand elle l'est. */
  caseACocher(x: number, y: number, cochee: boolean, cote = 7): void {
    if (cochee) {
      this.doc.rect(x, y, cote, cote).fill(ENCRE);
      this.doc
        .moveTo(x + cote * 0.22, y + cote * 0.53)
        .lineTo(x + cote * 0.42, y + cote * 0.74)
        .lineTo(x + cote * 0.8, y + cote * 0.26)
        .lineWidth(cote * 0.15)
        .lineCap('round')
        .lineJoin('round')
        .strokeColor(BLANC)
        .stroke();
      this.doc.lineCap('butt').lineJoin('miter');
    } else {
      this.doc
        .rect(x + 0.25, y + 0.25, cote - 0.5, cote - 0.5)
        .lineWidth(0.5)
        .strokeColor(ENCRE)
        .stroke();
    }
  }

  /** Un niveau donné : sa lettre en blanc sur un carré noir, puis son libellé. */
  pastille(niveau: Niveau | null, libelle: (n: Niveau) => string): Cellule {
    const vide = 'Non renseigné';
    const COTE = 11;
    return {
      hauteur: (l) =>
        niveau
          ? Math.max(
              COTE,
              this.hauteurDe(libelle(niveau), l - COTE - 5, { coupe: 'bold', taille: 8.6 }),
            )
          : this.hauteurDe(vide, l, { coupe: 'italic' }),
      dessiner: (x, y, l) => {
        if (!niveau) {
          this.ecrire(vide, x, y, l, { coupe: 'italic' });
          return;
        }
        this.lettre(niveau, x, y - 0.2, COTE);
        this.ecrire(libelle(niveau), x + COTE + 5, y + 0.6, l - COTE - 5, {
          coupe: 'bold',
          taille: 8.6,
        });
      },
    };
  }

  /** La lettre d'un niveau, en blanc sur un carré noir aux coins adoucis. */
  lettre(niveau: Niveau, x: number, y: number, cote = 11): void {
    this.doc.roundedRect(x, y, cote, cote, cote * 0.16).fill(ENCRE);
    const taille = cote * 0.68;
    this.style({ coupe: 'bold', taille });
    const largeur = this.doc.widthOfString(niveau);
    this.doc
      .fillColor(BLANC)
      .text(niveau, x + (cote - largeur) / 2, y + cote / 2 + taille * 0.355, {
        lineBreak: false,
        baseline: 'alphabetic',
      });
    this.doc.fillColor(ENCRE);
  }

  /**
   * Une liste de clés et de valeurs, sous un titre, à une place donnée : une
   * colonne de l'identification. Rend sa hauteur.
   */
  liste(
    x: number,
    y: number,
    largeur: number,
    titre: string,
    paires: readonly [string, string | null][],
    largeurDesCles: number,
  ): number {
    const sCle: Style = { coupe: 'bold', taille: 8 };
    const sTitre: Style = { coupe: 'bold', taille: CORPS_DES_TITRES_DE_COLONNE, espacement: 0.5 };
    const largeurDesValeurs = largeur - largeurDesCles - MARGE_X;
    let h = 0;
    this.filet(y, FILETS.fort, x, largeur);
    const t = titre.toLocaleUpperCase('fr');
    this.ecrire(t, x + MARGE_X, y + MARGE_Y + 0.6, largeur - 2 * MARGE_X, sTitre);
    h += this.hauteurDe(t, largeur - 2 * MARGE_X, sTitre) + 2 * MARGE_Y;
    this.filet(y + h, FILETS.moyen, x, largeur);
    paires.forEach(([cle, valeur], i) => {
      const v = valeur ? typographie(valeur) : '–';
      const hl =
        Math.max(
          this.hauteurDe(cle, largeurDesCles - 2 * MARGE_X, sCle),
          this.hauteurDe(v, largeurDesValeurs),
        ) +
        2 * MARGE_Y;
      this.ecrire(cle, x + MARGE_X, y + h + MARGE_Y + 0.9, largeurDesCles - 2 * MARGE_X, sCle);
      this.ecrire(v, x + largeurDesCles, y + h + MARGE_Y, largeurDesValeurs);
      h += hl;
      this.filet(y + h, i < paires.length - 1 ? FILETS.fin : FILETS.fort, x, largeur);
    });
    return h;
  }

  /** Des morceaux de texte de styles différents, à la suite, sur une ou plusieurs lignes. */
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

  /**
   * La grille d'un critère : quatre niveaux, chacun sa case et ce qu'il veut
   * dire ; la case du niveau donné est cochée, son texte en gras.
   */
  niveauDeLaGrille(n: Niveau, texte: string, choisi: Niveau | null): Cellule {
    // Le niveau donné : sa case cochée, son texte en demi-gras.
    const s: Style = choisi === n ? { famille: 'raleway-semibold', taille: 7.4 } : { taille: 7.4 };
    const RETRAIT = 10;
    return {
      hauteur: (l) => Math.max(8, this.hauteurDe(typographie(texte), l - RETRAIT, s)),
      dessiner: (x, y, l) => {
        this.caseACocher(x, y + 0.7, choisi === n, 6.6);
        this.ecrire(typographie(texte), x + RETRAIT, y, l - RETRAIT, s);
      },
    };
  }
}

const RETRAIT_DE_PUCE = 9;

/** Une colonne d'un tableau : son titre, sa largeur, l'alignement de son titre. */
interface Colonne {
  titre: string;
  largeur: number;
  aligne?: 'left' | 'center' | 'right';
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

/** Des largeurs de colonnes, en parts de la largeur du texte. */
function colonnes(
  ...parts: readonly [titre: string, part: number, aligne?: Colonne['aligne']][]
): Colonne[] {
  const total = parts.reduce((t, [, p]) => t + p, 0);
  return parts.map(([titre, part, aligne]) => ({
    titre,
    largeur: (LARGEUR * part) / total,
    aligne,
  }));
}

// ──────────────────────────────────────────────── la fiche

/**
 * La fiche d'un agent, en PDF. Sans partie réservée (`d.reservee` à null),
 * c'est la version de l'agent.
 */
export async function ficheDEntretienPdf(d: DonneesDeLaFiche): Promise<Buffer> {
  const titreDuPdf = `${TITRE_DE_LA_FICHE} ${d.annee} · ${nomImprime(d.agent)}`;
  const doc = new PDFDocument({
    size: 'A4',
    margin: 0,
    bufferPages: true,
    lang: 'fr-FR',
    displayTitle: true,
    info: {
      Title: titreDuPdf,
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
  premierePage(f, d);
  identification(f, d);
  bilan(f, d);
  competences(f, d);
  synthese(f, d);
  perspectives(f, d);
  souhaits(f, d);
  validation(f, d);
  if (d.reservee) partieReservee(f, d, d.reservee);

  // Le bandeau des pages suivantes et le pied de chaque page, une fois le
  // nombre de pages connu.
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(pages.start + i);
    if (i > 0) bandeau(f, d);
    dessinerPiedDePage(doc, `Page ${i + 1} sur ${pages.count}`);
  }
  doc.end();
  return fini;
}

/** L'en-tête de la République, le titre de la fiche et sa référence. */
function premierePage(f: Composition, d: DonneesDeLaFiche): void {
  const doc = f.doc;
  const basDeLEnTete = dessinerEnTete(doc, { logo: cheminLogo() });
  const taille = 20;
  const premiere = basDeLEnTete + 30 + taille * 0.95;
  doc
    .font(police(doc, 'normal', 'anton'))
    .fontSize(taille)
    .fillColor(ENCRE)
    .text(TITRE_DE_LA_FICHE.toLocaleUpperCase('fr'), GAUCHE, premiere, {
      width: LARGEUR,
      align: 'center',
      lineBreak: false,
      characterSpacing: 0.3,
      baseline: 'alphabetic',
    });
  const filet = premiere + 8;
  doc
    .moveTo(GAUCHE + LARGEUR / 2 - 18, filet)
    .lineTo(GAUCHE + LARGEUR / 2 + 18, filet)
    .lineWidth(1.6)
    .strokeColor(ENCRE)
    .stroke();
  f.ecrire(
    `Année ${d.annee}`,
    GAUCHE,
    filet + 9,
    LARGEUR,
    { coupe: 'bold', taille: 10.5, famille: 'raleway' },
    'center',
  );
  const r = REFERENCE_DE_LA_FICHE;
  f.ecrire(
    `Réf. ${r.reference}  ·  Version ${r.version}  ·  Date d’application : ${dateEnLettres(r.application)}`,
    GAUCHE,
    filet + 26,
    LARGEUR,
    { taille: 7.2 },
    'center',
  );
  f.commencer(filet + 52);
}

/** Le bandeau des pages suivantes : la fiche, sa référence, et l'agent. */
function bandeau(f: Composition, d: DonneesDeLaFiche): void {
  const haut = 34;
  const s: Style = { taille: 7.2 };
  f.ecrire('Direction du Capital Humain', GAUCHE, haut, LARGEUR / 2, {
    ...s,
    coupe: 'bold',
    espacement: 0.4,
  });
  f.ecrire(`${TITRE_DE_LA_FICHE} ${d.annee}`, GAUCHE, haut + 10, LARGEUR / 2, s);
  const r = REFERENCE_DE_LA_FICHE;
  f.ecrire(
    `Réf. ${r.reference} · Version ${r.version}`,
    GAUCHE + LARGEUR / 2,
    haut,
    LARGEUR / 2,
    s,
    'right',
  );
  const agent = [nomImprime(d.agent), d.agent.matricule ? `Matricule ${d.agent.matricule}` : null]
    .filter(Boolean)
    .join(' · ');
  f.ecrire(agent, GAUCHE + LARGEUR / 2, haut + 10, LARGEUR / 2, { ...s, coupe: 'bold' }, 'right');
  f.filet(haut + 24, FILETS.moyen);
}

// ──────────────────────────────────────────────── 1. Identification

function identification(f: Composition, d: DonneesDeLaFiche): void {
  f.section(1, 'Identification de l’agent et de l’évaluateur', 150);
  const a = d.agent;
  const titre: Style = { coupe: 'bold', taille: CORPS_DES_TITRES_DE_COLONNE, espacement: 0.5 };

  // La catégorie, la période et la date de l'entretien, sur deux lignes.
  const y = f.y;
  f.ecrire('CATÉGORIE', GAUCHE, y + 1.2, 70, titre);
  let x = GAUCHE + 74;
  for (const p of ['cadre', 'non_cadre'] as const) {
    f.caseACocher(x, y + 1, d.personnel === p, 7.5);
    f.ecrire(LIBELLES_DU_PERSONNEL[p], x + 11.5, y, 70, {
      coupe: d.personnel === p ? 'bold' : 'normal',
    });
    x += 80;
  }
  const milieu = GAUCHE + LARGEUR * 0.58;
  const valeurs = milieu + 96;
  f.ecrire('PÉRIODE ÉVALUÉE', milieu, y + 1.2, 96, titre);
  f.ecrire(`Année ${d.annee}`, valeurs, y, DROITE - valeurs, { coupe: 'bold' });
  f.ecrire('DATE DE L’ENTRETIEN', milieu, y + 16.2, 96, titre);
  f.ecrire(
    d.dateDeLEntretien ? dateEnLettres(d.dateDeLEntretien) : 'À fixer',
    valeurs,
    y + 15,
    DROITE - valeurs,
    { coupe: d.dateDeLEntretien ? 'bold' : 'italic' },
  );
  f.y = y + 38;

  // L'agent à gauche, le N+1 à droite : deux listes côte à côte.
  const priseDePoste =
    a.posteDepuis && a.posteDepuis.slice(0, 4) === String(d.annee)
      ? `Oui, depuis le ${dateEnLettres(a.posteDepuis)}`
      : 'Non';
  const gauche: [string, string | null][] = [
    ['Prénom et nom', nomImprime(a)],
    ['Matricule', a.matricule],
    ['Fonction', a.fonction],
    ['Direction', a.direction],
    ['Département', a.departement],
    ['Service', a.service],
    ['Ancienneté au poste', a.anciennete],
    [`Prise de poste en ${d.annee}`, priseDePoste],
  ];
  const droite: [string, string | null][] = [
    ['Prénom et nom', d.n1 ? nomImprime(d.n1) : null],
    ['Fonction', d.n1?.fonction ?? null],
  ];
  const ecart = 18;
  const largeurGauche = LARGEUR * 0.58 - ecart / 2;
  const haut = f.y;
  const h1 = f.liste(
    GAUCHE,
    haut,
    largeurGauche,
    'L’agent',
    gauche.filter(([, v]) => v !== null),
    104,
  );
  const h2 = f.liste(
    GAUCHE + largeurGauche + ecart,
    haut,
    LARGEUR - largeurGauche - ecart,
    'L’évaluateur (N+1)',
    droite,
    76,
  );
  f.y = haut + Math.max(h1, h2);
}

// ──────────────────────────────────────────────── 2. Bilan de l'année

function bilan(f: Composition, d: DonneesDeLaFiche): void {
  f.section(2, `Bilan de l’année ${d.annee}`, 80);
  f.sousSection('2.1', 'Récapitulatif et faits marquants', 60, 'Rempli par l’agent');
  questionsReponses(
    f,
    QUESTIONS_DU_BILAN.map((q) => [q.question, d.auto[q.cle]]),
  );

  f.sousSection('2.2', 'Évaluation des résultats', 120);
  f.chapeau(`L’atteinte des objectifs fixés pour ${d.annee}.`);
  f.sousSection('2.2.1', 'Les objectifs fixés', 120, 'Auto-évaluation, puis appréciation du N+1');
  if (d.objectifs.length === 0) f.mention('Aucun objectif n’a été fixé pour cette année.', 0);
  const libelle = (n: Niveau) => NIVEAUX_D_ATTEINTE[n].libelle;
  d.objectifs.forEach((o, i) => {
    const agent = d.auto.objectifs[o.id];
    const n1 = d.evaluation.objectifs[o.id];
    const intitule = typographie(o.intitule);
    const indicateurs = o.indicateurs ? typographie(o.indicateurs) : '';
    const sIntitule: Style = { coupe: 'bold', taille: 9.4 };
    const sIndicateurs: Style = { taille: 8.2 };
    const hIntitule = f.hauteurDe(intitule, LARGEUR, sIntitule);
    const hIndicateurs = indicateurs
      ? f.hauteurDe(`Indicateurs : ${indicateurs}`, LARGEUR, sIndicateurs) + 1
      : 0;
    // L'objectif ne se sépare pas de la première ligne de son tableau.
    f.place((i > 0 ? 12 : 0) + 10 + hIntitule + hIndicateurs + 6 + 50);
    if (i > 0 && !f.enHautDePage) f.y += 12;
    f.ecrire(`OBJECTIF ${i + 1}`, GAUCHE, f.y, LARGEUR, {
      coupe: 'bold',
      taille: CORPS_DES_TITRES_DE_COLONNE,
      espacement: 0.6,
    });
    f.y += 10;
    f.ecrire(intitule, GAUCHE, f.y, LARGEUR, sIntitule);
    f.y += hIntitule + 1;
    if (indicateurs) {
      f.ecrireEnLigne(GAUCHE, f.y, LARGEUR, [
        ['Indicateurs : ', { famille: 'raleway-semibold', taille: 8.2 }],
        [indicateurs, sIndicateurs],
      ]);
      f.y += hIndicateurs;
    }
    f.y += 5;
    f.tableau(colonnes(['', 0.9], ['Auto-évaluation de l’agent', 2], ['Appréciation du N+1', 2]), [
      [
        f.intitule('Niveau', { taille: 8 }),
        f.pastille(agent?.niveau ?? null, libelle),
        f.pastille(n1?.niveau ?? null, libelle),
      ],
      [
        f.intitule('Résultats obtenus', { taille: 8 }),
        f.texte(agent?.resultats ?? '', { taille: 8.6 }),
        vide(),
      ],
      [
        f.intitule('Commentaire', { taille: 8 }),
        f.texte(agent?.commentaire ?? '', { taille: 8.6 }),
        f.texte(n1?.commentaire ?? '', { taille: 8.6 }),
      ],
    ]);
  });
  legende(
    f,
    NIVEAUX.map((n) => ({
      niveau: n,
      libelle: NIVEAUX_D_ATTEINTE[n].libelle,
      precision: NIVEAUX_D_ATTEINTE[n].resultats,
    })),
  );

  f.sousSection('2.2.2', 'Autres réalisations en dehors des objectifs', 40, 'Rempli par l’agent');
  paragrapheLibre(f, d.auto.autresRealisations);
}

/** Une cellule vide : la place d'une colonne sans rien dedans. */
function vide(): Cellule {
  return { hauteur: () => 0, dessiner: () => undefined };
}

/**
 * L'échelle des niveaux, sous les objectifs : quatre colonnes, chacune sa
 * lettre, son libellé et ce qu'il dit des résultats.
 */
function legende(
  f: Composition,
  niveaux: readonly { niveau: Niveau; libelle: string; precision: string }[],
): void {
  const etiquette = 46;
  const largeur = (LARGEUR - etiquette) / niveaux.length;
  const sLibelle: Style = { coupe: 'bold', taille: CORPS_PETIT };
  const sPrecision: Style = { taille: 7.2 };
  const COTE = 8.5;
  const h = Math.max(
    ...niveaux.map(
      (n) =>
        f.hauteurDe(n.libelle, largeur - COTE - 10, sLibelle) +
        f.hauteurDe(n.precision, largeur - COTE - 10, sPrecision),
    ),
  );
  f.place(10 + h);
  f.y += 10;
  f.ecrire('ÉCHELLE', GAUCHE, f.y + 0.8, etiquette, {
    coupe: 'bold',
    taille: CORPS_DES_TITRES_DE_COLONNE,
    espacement: 0.5,
  });
  niveaux.forEach((n, i) => {
    const x = GAUCHE + etiquette + i * largeur;
    f.lettre(n.niveau, x, f.y - 0.2, COTE);
    f.ecrire(n.libelle, x + COTE + 4, f.y, largeur - COTE - 10, sLibelle);
    const hl = f.hauteurDe(n.libelle, largeur - COTE - 10, sLibelle);
    f.ecrire(n.precision, x + COTE + 4, f.y + hl, largeur - COTE - 10, sPrecision);
  });
  f.y += h;
}

/** Des questions et leurs réponses, l'une sous l'autre, séparées d'un trait fin. */
function questionsReponses(f: Composition, qr: readonly [string, string][]): void {
  const sQuestion: Style = { coupe: 'bold', taille: 8.6 };
  f.tableau(
    colonnes(['', 1]),
    qr.map(([question, reponse]) => [
      {
        hauteur: (l: number) =>
          f.hauteurDe(typographie(question), l, sQuestion) + 3 + f.hauteurDuTexte(reponse, l),
        dessiner: (x: number, y: number, l: number) => {
          f.ecrire(typographie(question), x, y, l, sQuestion);
          const h = f.hauteurDe(typographie(question), l, sQuestion);
          f.ecrireLeTexte(reponse, x, y + h + 3, l);
        },
      },
    ]),
    { titres: false },
  );
}

/** Un texte libre sous un titre, entre deux filets. */
function paragrapheLibre(f: Composition, texte: string): void {
  f.tableau(colonnes(['', 1]), [[f.texte(texte)]], { titres: false });
}

// ──────────────────────────────────────────────── 3. Compétences

function competences(f: Composition, d: DonneesDeLaFiche): void {
  f.section(3, 'Évaluation des compétences et des performances', 150, 'Rempli par le N+1');
  const liste = competencesDe(d.personnel);
  f.tableau(
    colonnes(
      ['N°', 0.22],
      ['Compétence', 1.02],
      ...NIVEAUX.map((n) => [`${n}  ${NIVEAUX_DE_COMPETENCE[n]}`, 1.2] as [string, number]),
    ),
    liste.map((c, i) => {
      const choisi = d.evaluation.competences[c.cle] ?? null;
      const debut = [
        f.intitule(String(i + 1), { taille: 8 }),
        f.intitule(typographie(c.intitule), { taille: 8 }),
      ];
      if (c.cadres && !choisi) {
        return [
          ...debut,
          { ...f.texte('Sans objet', { coupe: 'italic', taille: 8 }), colonnes: 4 },
        ];
      }
      return [...debut, ...NIVEAUX.map((n) => f.niveauDeLaGrille(n, c.niveaux[n], choisi))];
    }),
    { marge: 4.2 },
  );
}

// ──────────────────────────────────────────────── 4. Synthèse

function synthese(f: Composition, d: DonneesDeLaFiche): void {
  const e = d.evaluation;
  f.section(4, 'Synthèse de l’évaluation et axes d’amélioration', 90, 'Rempli par le N+1');
  f.sousSection('4.1', 'Bilan global', 60);
  f.tableau(
    colonnes(['', 1.1], ['', 3.4]),
    [
      [f.intitule('Points forts', { taille: 8.4 }), f.texte(e.pointsForts)],
      [f.intitule('Axes de développement', { taille: 8.4 }), f.texte(e.axesDeDeveloppement)],
    ],
    { titres: false },
  );

  f.sousSection('4.2', 'Plan d’action pour développer les compétences', 70);
  f.chapeau('Les actions concrètes à mettre en place pour développer les compétences à améliorer.');
  const plan = e.plan.filter((a) => a.action.trim() || a.suivi.trim());
  if (plan.length === 0) {
    paragrapheLibre(f, '');
  } else {
    f.tableau(
      colonnes(
        ['Action ou moyen (coaching, mentorat, délégation…)', 2.3],
        ['Délai', 1],
        ['Suivi ou justification', 2.1],
      ),
      plan.map((a) => [f.texte(a.action), f.texte(a.delai), f.texte(a.suivi)]),
    );
  }
}

// ──────────────────────────────────────────────── 5. Objectifs et perspectives

function perspectives(f: Composition, d: DonneesDeLaFiche): void {
  const e = d.evaluation;
  const suivante = d.annee + 1;
  f.section(5, `Objectifs et perspectives pour ${suivante}`, 90, 'Rempli par le N+1');
  f.sousSection('5.1', `Les objectifs de l’année ${suivante}`, 60);
  const objectifs = e.objectifsAVenir.filter((o) => o.objectif.trim());
  if (objectifs.length === 0) {
    paragrapheLibre(f, '');
  } else {
    f.tableau(
      colonnes(
        ['N°', 0.28],
        ['Objectif', 2.3],
        ['Indicateur de réussite (quantifiable ou qualifiable)', 2.05],
        ['Échéance', 1.2],
      ),
      objectifs.map((o, i) => [
        f.intitule(String(i + 1), { taille: 8 }),
        f.texte(o.objectif),
        f.texte(o.indicateur),
        f.texte(o.echeance ? dateEnLettres(o.echeance) : ''),
      ]),
    );
  }

  f.sousSection('5.2', 'Besoins et projets de formation', 60);
  f.chapeau(
    `Les formations que le N+1 juge nécessaires pour atteindre les objectifs de ${suivante}.`,
  );
  const formations = e.formations.filter((x) => x.intitule.trim());
  if (formations.length === 0) {
    paragrapheLibre(f, '');
  } else {
    f.tableau(
      colonnes(
        ['N°', 0.28],
        ['Formation souhaitée', 2.4],
        ['Justification (lien avec le poste et les objectifs)', 3.15],
      ),
      formations.map((x, i) => [
        f.intitule(String(i + 1), { taille: 8 }),
        f.texte(x.intitule),
        f.texte(x.justification),
      ]),
    );
  }
}

// ──────────────────────────────────────────────── 6. Souhaits de l'agent

function souhaits(f: Composition, d: DonneesDeLaFiche): void {
  f.section(6, 'Préoccupations et souhaits de l’agent', 90, 'Rempli par l’agent');
  questionsReponses(f, [
    ...QUESTIONS_DES_SOUHAITS.map(
      (q) =>
        [`${q.question}${'precision' in q ? ` (${q.precision})` : ''}`, d.auto[q.cle]] as [
          string,
          string,
        ],
    ),
    ['Autres commentaires', d.auto.autresCommentaires],
  ]);
}

// ──────────────────────────────────────────────── 7. Validation

function validation(f: Composition, d: DonneesDeLaFiche): void {
  f.section(7, 'Validation et suivi', 110);
  const ligne = (
    role: string,
    p: { prenom: string; nom: string } | null,
    le: string | null,
  ): Cellule[] => [
    f.intitule(role, { taille: 8.4 }),
    f.texte(p ? nomImprime(p) : ''),
    f.texte(le ? dateEnLettres(le) : ''),
    le
      ? f.texte('Validation en ligne', { coupe: 'italic', taille: 8.4 })
      : { hauteur: () => 22, dessiner: () => undefined },
  ];
  f.tableau(colonnes(['Rôle', 1.6], ['Prénom et nom', 1.5], ['Date', 1.1], ['Signature', 1.1]), [
    ligne('Agent (N)', d.agent, d.validations.agent),
    ligne('Responsable hiérarchique (N+1)', d.n1, d.validations.n1),
  ]);
  f.mention('La fiche n’est valable qu’une fois validée par l’agent.', 7);
  f.mention('Diffusion : original au dossier du personnel (DCH)  ·  copie à l’agent.', 4);
}

// ──────────────────────────────────────────────── 8. Partie réservée

function partieReservee(f: Composition, d: DonneesDeLaFiche, r: PartieReservee): void {
  f.nouvellePage();
  f.section(8, 'Partie strictement réservée à la hiérarchie', 120);

  f.sousSection('8.1', 'Synthèse générale du N+1', 80);
  f.tableau(
    colonnes(['Critère', 1.25], ...NIVEAUX.map((n) => [n, 1.2] as [string, number])),
    SYNTHESE_GENERALE.map((c) => [
      f.intitule(c.intitule, { taille: 8 }),
      ...NIVEAUX.map((n) => f.niveauDeLaGrille(n, c.niveaux[n], r[c.cle])),
    ]),
    { marge: 4.2 },
  );

  f.sousSection('8.2', 'Observations du N+1', 50);
  paragrapheLibre(f, r.observations);
  signature(f, 'N+1', d.n1, d.validations.n1);

  f.sousSection('8.3', 'Commentaires du N+2', 50);
  paragrapheLibre(f, d.n2?.commentaires ?? '');
  signature(f, 'N+2', d.n2, d.n2?.le ?? null);

  f.sousSection('8.4', 'Commentaires des autres niveaux hiérarchiques', 110);
  // À la main, sur l'original : des lignes à écrire, entre deux filets.
  const lignes = 5;
  const pas = 19;
  f.place(lignes * pas + 8);
  f.filet(f.y, FILETS.fort);
  for (let i = 1; i < lignes; i++) f.filet(f.y + i * pas, FILETS.fin);
  f.y += lignes * pas;
  f.filet(f.y, FILETS.fort);

  f.mention(
    'Diffusion : original au dossier du personnel (DCH)  ·  copie 1 au N+1  ·  copie 2 au N+2, selon le circuit de validation.',
    10,
  );
}

/**
 * La signature d'une partie, sous son texte : qui, sa fonction, la date, et
 * la validation en ligne. Sans validation, la place de signer à la main.
 */
function signature(
  f: Composition,
  role: string,
  p: PersonneDeLaFiche | null,
  le: string | null,
): void {
  const morceaux: [string, Style][] = [[`${role}  `, { coupe: 'bold', taille: 8 }]];
  if (p) {
    morceaux.push([nomImprime(p), { famille: 'raleway-semibold', taille: 8 }]);
    if (p.fonction) morceaux.push([`, ${typographie(p.fonction)}`, { taille: 8 }]);
  }
  morceaux.push([
    le ? `   ·   Validation en ligne le ${dateEnLettres(le)}` : '   ·   Date et signature :',
    { coupe: 'italic', taille: 8 },
  ]);
  const h = f.hauteurEnLigne(LARGEUR, morceaux);
  f.place(6 + h);
  f.y += 6;
  f.ecrireEnLigne(GAUCHE, f.y, LARGEUR, morceaux);
  f.y += h;
}
