import PDFDocument from 'pdfkit';
import {
  besoinsDeFormation,
  CRITERES_CADRE,
  NIVEAUX,
  NIVEAUX_D_OBJECTIF,
  NOTE_COMMANDEMENT,
  numerosDesBlocs,
  OBJECTIFS_A_VENIR,
  SIGNIFICATION_DES_NIVEAUX,
  SYNTHESE_DU_N1,
  dateEnLettres,
  texteRicheVide,
  type ContenuDeGrille,
  type IdentificationDeGrille,
  type Niveau,
  type Segment,
  type TexteRiche,
} from '@teranga/contracts';
import {
  cheminLogo,
  enregistrerPolices,
  ENTETE,
  police,
  type Coupe,
  type Famille,
} from '../documents/entete';

/* ────────────────────────────────────────────────────────────────
   La grille d'évaluation du personnel cadre (réf. S1/EN02), en PDF
   (ADR-0149).

   Les pages du modèle de l'APIX : l'en-tête de la DCH sur chacune, puis la
   couverture et l'identification, le rappel des objectifs, les treize
   critères, le résumé et les objectifs à venir, la formation et la
   ratification, la partie réservée à la hiérarchie. Les cotes viennent du
   modèle ; les marges, les cadres et les polices s'y harmonisent, et le
   texte y est corrigé de ses fautes.

   Ce qui est rempli s'imprime à la place du modèle, sans pointillés ; un
   champ resté vide garde les siens, à remplir à la main. Le rappel des
   objectifs et les besoins de formation se taillent à ce qui est écrit
   (ADR-0153) : autant d'objectifs qu'il y en a, chacun haut de son texte,
   sur une page de suite s'il le faut. Qui a validé la grille dans
   l'application la paraphe : ses initiales, à la main, sur sa ligne de
   signature (ADR-0151). Les autres champs tiennent dans leur place : un
   texte long s'y imprime plus petit, une liste longue s'y resserre. Le
   texte mis en forme s'imprime comme il s'est écrit : gras, italique, puces
   et numéros.
   ──────────────────────────────────────────────────────────────── */

type Doc = typeof PDFDocument.prototype;

/** Ce que la grille imprime. */
export interface DonneesDeLaGrille {
  annee: number;
  identification: IdentificationDeGrille;
  /** À sa forme complète (cf. `completerLaGrille`). */
  contenu: ContenuDeGrille;
  /** Le critère « Commandement » vaut pour l'agent, qui encadre. */
  commandement: boolean;
  /** La case « agent nouveau à son poste actuel ». */
  nouveauAuPoste: boolean;
  ratification: {
    evaluateur: string | null;
    /** AAAA-MM-JJ : l'envoi de la grille à l'agent. */
    envoyeeLe: string | null;
    agent: string;
    /** AAAA-MM-JJ : la validation de l'agent. */
    valideeLe: string | null;
    commentaires: string;
  };
  /** Le N+2, une fois la grille transmise. */
  n2: {
    nom: string | null;
    prenom: string | null;
    fonction: string | null;
    /** AAAA-MM-JJ : la validation du N+2. */
    le: string | null;
    commentaires: string;
  } | null;
}

const MARINE = '#001f5f';
const DIFFUSION = '#17365d';
const ENCRE = '#000000';
const FILET = 0.5;
/** Le bord gauche et le bord droit de la grille, ceux de l'en-tête. */
const G = 30.6;
const D = 564.9;
const L = D - G;
/** Le texte dans un cadre : à 5,5 points de son bord. */
const RETRAIT = 5.5;
/** Le bord gauche de la case de la pagination, dans l'en-tête. */
const X_PAGE = 442.7;
/** Le plus bas où descend une page qui s'allonge : celui de la couverture. */
const BAS = 780;

/**
 * Les initiales d'un nom, comme on paraphe : « Mariama CISSÉ » donne
 * « M.C. », « Jean-Pierre DIOP » donne « J.-P.D. ». Chaque prénom et chaque
 * nom compte ; une particule en minuscules (« de », « du ») ne compte pas.
 */
export function initiales(nom: string): string {
  return nom
    .trim()
    .split(/\s+/)
    .filter((mot) => /^\p{Lu}/u.test(mot))
    .map((mot) =>
      mot
        .split('-')
        .filter(Boolean)
        .map((partie) => `${[...partie][0]!.toLocaleUpperCase('fr')}.`)
        .join('-'),
    )
    .join('');
}

/** « 15 décembre 2026 » ; rien sans date. */
const enLettres = (iso: string | null) => (iso ? dateEnLettres(iso.slice(0, 10)) : '');

export function grilleDuPersonnelCadre(
  d: DonneesDeLaGrille,
  logo: string | null = cheminLogo(),
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    autoFirstPage: false,
    // Les pages se numérotent une fois toutes posées : « Page 2 sur 7 ».
    bufferPages: true,
    info: {
      Title: `Grille d’évaluation du personnel cadre ${d.annee}`,
      Author: ENTETE.raisonSociale,
    },
  });
  enregistrerPolices(doc);
  const morceaux: Buffer[] = [];
  doc.on('data', (m: Buffer) => morceaux.push(m));
  const fini = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(morceaux)));
    doc.on('error', reject);
  });

  const f = new Feuille(doc, logo);
  pageDeCouverture(f, d);
  pagesDesObjectifs(f, d.contenu);
  pageDesCriteres(f, d.contenu, d.commandement);
  pageDuResume(f, d.contenu);
  pageDeLaRatification(f, d);
  pageDeLaHierarchie(f, d);
  f.numeroter();
  doc.end();
  return fini;
}

// ──────────────────────────────────────────────── la feuille et ses traits

interface Style {
  famille?: Famille;
  coupe?: Coupe;
  taille?: number;
  couleur?: string;
}

/** Un morceau de texte d'une seule coupe. */
interface Morceau {
  texte: string;
  coupe: Coupe;
}

/** Une ligne d'un texte mis en forme : son retrait, sa puce ou son numéro, ses morceaux. */
interface LigneRiche {
  retrait: number;
  marque: { texte: string; x: number } | null;
  morceaux: Morceau[];
}

/** La puce de chaque niveau d'une liste. */
const PUCES = ['•', '–', '•'] as const;
/** L'interligne d'un texte resserré, en multiple de sa taille. */
const INTERLIGNE = 1.25;

const coupeDe = (s: Segment): Coupe =>
  s.gras && s.italique ? 'bold-italic' : s.gras ? 'bold' : s.italique ? 'italic' : 'normal';

class Feuille {
  constructor(
    readonly doc: Doc,
    private readonly logo: string | null,
  ) {}

  /** Une page de plus, son en-tête posé. */
  page(): void {
    this.doc.addPage({ size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } });
    this.entete();
  }

  /**
   * « Page 1 sur 6 », les nombres en gras, centré dans sa case de l'en-tête :
   * posé sur chaque page une fois toutes faites, le rappel des objectifs
   * pouvant en prendre plus d'une.
   */
  numeroter(): void {
    const { start, count } = this.doc.bufferedPageRange();
    const arial = (coupe: Coupe): Style => ({ famille: 'arial', coupe, taille: 11.04 });
    for (let i = 0; i < count; i++) {
      this.doc.switchToPage(start + i);
      const morceaux: [string, Coupe][] = [
        ['Page ', 'normal'],
        [String(i + 1), 'bold'],
        [' sur ', 'normal'],
        [String(count), 'bold'],
      ];
      const total = morceaux.reduce((s, [t, c]) => s + this.largeur(t, arial(c)), 0);
      let x = X_PAGE + (D - X_PAGE - total) / 2;
      for (const [t, c] of morceaux) x = this.texte(t, x, 85, arial(c));
    }
  }

  /** La police d'un style ; rend sa taille. */
  style({ famille = 'gill-sans', coupe = 'normal', taille = 9, couleur = ENCRE }: Style): number {
    this.doc
      .font(police(this.doc, coupe, famille))
      .fontSize(taille)
      .fillColor(couleur);
    return taille;
  }

  largeur(texte: string, s: Style): number {
    this.style(s);
    return this.doc.widthOfString(texte);
  }

  /** Une ligne de texte, posée sur sa ligne de base. */
  texte(texte: string, x: number, base: number, s: Style = {}): number {
    this.style(s);
    this.doc.text(texte, x, base, { lineBreak: false, baseline: 'alphabetic' });
    return x + this.doc.widthOfString(texte);
  }

  /** Une ligne centrée entre `x0` et `x1`. */
  centre(texte: string, x0: number, x1: number, base: number, s: Style = {}): void {
    const l = this.largeur(texte, s);
    this.texte(texte, x0 + (x1 - x0 - l) / 2, base, s);
  }

  /** La taille qui fait tenir une ligne dans `largeur`, sans dépasser `taille`. */
  ajuste(texte: string, largeur: number, s: Style & { taille: number }, minimum = 6): number {
    let t = s.taille;
    while (t > minimum && this.largeur(texte, { ...s, taille: t }) > largeur) t -= 0.25;
    return t;
  }

  trait(x0: number, y0: number, x1: number, y1: number, epaisseur = FILET, couleur = ENCRE) {
    this.doc
      .moveTo(x0, y0)
      .lineTo(x1, y1)
      .lineWidth(epaisseur)
      .strokeColor(couleur)
      .undash()
      .stroke();
  }

  cadre(x0: number, y0: number, x1: number, y1: number, epaisseur = FILET) {
    this.doc
      .rect(x0, y0, x1 - x0, y1 - y0)
      .lineWidth(epaisseur)
      .strokeColor(ENCRE)
      .undash()
      .stroke();
  }

  aplat(x0: number, y0: number, x1: number, y1: number, couleur: string) {
    this.doc
      .rect(x0, y0, x1 - x0, y1 - y0)
      .fillColor(couleur)
      .fill();
  }

  /** Les pointillés d'une ligne à remplir, sur sa ligne de base. */
  pointilles(x0: number, x1: number, base: number) {
    if (x1 - x0 < 4) return;
    this.doc
      .moveTo(x0, base)
      .lineTo(x1, base)
      .lineWidth(0.6)
      .strokeColor('#5a5a5a')
      .dash(0.6, { space: 1.8 })
      .stroke()
      .undash();
  }

  /**
   * Une bande de titre, aplat marine et texte blanc centré : celle qui
   * ouvre chaque partie de la grille.
   */
  bande(y0: number, y1: number, texte: string, taille = 11, couleur = MARINE) {
    this.aplat(G, y0, D, y1, couleur);
    this.cadre(G, y0, D, y1);
    const t = this.ajuste(texte, L - 2 * RETRAIT, { taille, coupe: 'bold' });
    this.style({ taille: t, coupe: 'bold', couleur: '#ffffff' });
    const l = this.doc.widthOfString(texte);
    this.doc.text(texte, G + (L - l) / 2, (y0 + y1) / 2, {
      lineBreak: false,
      baseline: 'middle',
    });
  }

  /**
   * Le paraphe de qui a validé : ses initiales à la main, en noir et en gras,
   * un peu penchées, posées sur sa ligne de signature. Allura n'a qu'une
   * graisse : son contour, tracé à la même encre, l'épaissit.
   */
  paraphe(nom: string, x: number, base: number, taille = 26) {
    const texte = initiales(nom);
    if (!texte) return;
    this.doc.save();
    this.doc.rotate(-4, { origin: [x, base] });
    this.style({ famille: 'signature', taille, couleur: ENCRE });
    this.doc
      .lineWidth(taille * 0.045)
      .lineJoin('round')
      .strokeColor(ENCRE)
      .text(texte, x, base, {
        lineBreak: false,
        baseline: 'alphabetic',
        fill: true,
        stroke: true,
      });
    this.doc.restore();
  }

  /** Une case à cocher, et sa croix quand elle l'est. */
  caseACocher(x: number, y: number, l: number, h: number, cochee: boolean, epaisseur = 1.2) {
    this.cadre(x, y, x + l, y + h, epaisseur);
    if (cochee) this.croix(x + l / 2, y + h / 2, Math.min(l, h) * 0.32);
  }

  /** Une croix, centrée sur (x, y). */
  croix(x: number, y: number, demi: number) {
    this.trait(x - demi, y - demi, x + demi, y + demi, 1.4);
    this.trait(x - demi, y + demi, x + demi, y - demi, 1.4);
  }

  /**
   * Un libellé, puis sa valeur ; sans valeur, les pointillés jusqu'à `fin`.
   * La valeur se resserre pour tenir avant `fin`.
   */
  champ(libelle: string, valeur: string | null, x: number, base: number, fin: number, taille = 8) {
    const apres = this.texte(libelle, x, base, { taille });
    const debut = apres + 4;
    if (!valeur) {
      this.pointilles(debut, fin, base + 1);
      return;
    }
    const t = this.ajuste(valeur, fin - debut, { taille: taille + 1 }, 6);
    this.texte(valeur, debut, base, { taille: t });
  }

  /**
   * Un texte sur des lignes à remplir : il s'imprime ligne à ligne sur leurs
   * bases, plus petit s'il le faut pour tenir. Vide, les lignes gardent leurs
   * pointillés, à remplir à la main ; écrit, il n'en laisse pas.
   */
  surLignes(texte: string, x0: number, x1: number, bases: readonly number[], taille = 9) {
    if (!texte.trim()) {
      for (const base of bases) this.pointilles(x0, x1, base + 1);
      return;
    }
    const largeur = x1 - x0;
    let t = taille;
    let lignes = this.couper(texte, largeur, t);
    while (lignes.length > bases.length && t > 6.5) {
      t -= 0.25;
      lignes = this.couper(texte, largeur, t);
    }
    if (lignes.length > bases.length) {
      lignes = lignes.slice(0, bases.length);
      lignes[lignes.length - 1] = `${lignes[lignes.length - 1]!.replace(/\s*\S*$/, '')} …`;
    }
    lignes.forEach((ligne, i) => this.texte(ligne, x0, bases[i]!, { taille: t }));
  }

  /**
   * Un texte mis en forme sur des lignes à remplir. Il s'imprime sur leurs
   * bases, plus petit s'il le faut, jusqu'à 7,5 points ; au-delà, ou pour
   * une liste plus longue que les lignes, ses lignes se répartissent dans
   * leur hauteur, de la ligne au-dessus de la première base à la dernière.
   * Vide, les lignes gardent leurs pointillés.
   */
  texteRiche(t: TexteRiche, x0: number, x1: number, bases: readonly number[], taille = 9) {
    if (texteRicheVide(t)) {
      for (const base of bases) this.pointilles(x0, x1, base + 1);
      return;
    }
    const largeur = x1 - x0;
    for (let tt = taille; tt >= 7.5; tt -= 0.25) {
      const lignes = this.disposer(t, largeur, tt);
      if (lignes.length > bases.length) continue;
      lignes.forEach((ligne, i) => this.poser(ligne, x0, bases[i]!, tt));
      return;
    }
    const pas = bases.length > 1 ? bases[1]! - bases[0]! : 2 * taille;
    const haut = bases[0]! - pas;
    const bas = bases[bases.length - 1]!;
    const capacite = (tt: number) => Math.floor((bas - haut) / (tt * INTERLIGNE));
    let tt = taille;
    let lignes = this.disposer(t, largeur, tt);
    while (lignes.length > capacite(tt) && tt > 6.5) {
      tt -= 0.25;
      lignes = this.disposer(t, largeur, tt);
    }
    if (lignes.length > capacite(tt)) {
      lignes = lignes.slice(0, capacite(tt));
      this.couperLaFin(lignes[lignes.length - 1]!, largeur, tt);
    }
    // Les lignes se répartissent dans la hauteur, sans s'écarter plus que le modèle.
    const interligne = Math.min(pas, (bas - haut) / lignes.length);
    lignes.forEach((l, i) => this.poser(l, x0, haut + (i + 1) * interligne, tt));
  }

  /** Une ligne d'un texte mis en forme, posée sur sa base. */
  poser(ligne: LigneRiche, x0: number, base: number, taille: number) {
    if (ligne.marque) this.texte(ligne.marque.texte, x0 + ligne.marque.x, base, { taille });
    let x = x0 + ligne.retrait;
    for (const m of ligne.morceaux) x = this.texte(m.texte, x, base, { coupe: m.coupe, taille });
  }

  /** La dernière ligne d'un texte qui ne tient pas : elle finit sur « … ». */
  private couperLaFin(ligne: LigneRiche, largeur: number, taille: number) {
    const fin = ' …';
    const place = largeur - ligne.retrait - this.largeur(fin, { taille });
    const mesure = () =>
      ligne.morceaux.reduce((l, m) => l + this.largeur(m.texte, { coupe: m.coupe, taille }), 0);
    while (ligne.morceaux.length > 0 && mesure() > place) {
      const dernier = ligne.morceaux[ligne.morceaux.length - 1]!;
      dernier.texte = dernier.texte.replace(/\s*\S*$/, '');
      if (!dernier.texte) ligne.morceaux.pop();
    }
    ligne.morceaux.push({ texte: fin, coupe: 'normal' });
  }

  /**
   * Les lignes d'un texte mis en forme, coupé à `largeur` : chaque bloc
   * commence une ligne ; une puce ou un numéro s'écrit dans la marge du
   * niveau, et le texte de la liste s'aligne après lui, ligne après ligne.
   */
  disposer(t: TexteRiche, largeur: number, taille: number): LigneRiche[] {
    const numeros = numerosDesBlocs(t);
    const retraitDeNiveau = taille * 1.6;
    const lignes: LigneRiche[] = [];
    t.forEach((b, i) => {
      const marque =
        b.type === 'puce' ? PUCES[b.niveau]! : b.type === 'numero' ? `${numeros[i]}.` : null;
      const xMarque = b.niveau * retraitDeNiveau;
      const retrait = marque
        ? Math.max((b.niveau + 1) * retraitDeNiveau, xMarque + this.largeur(marque, { taille }) + 3)
        : 0;
      const coupees = this.couperRiche(b.segments, largeur - retrait, taille);
      coupees.forEach((morceaux, j) =>
        lignes.push({
          retrait,
          marque: j === 0 && marque ? { texte: marque, x: xMarque } : null,
          morceaux,
        }),
      );
    });
    return lignes;
  }

  /**
   * Les lignes d'un bloc mis en forme, coupé à `largeur` entre ses mots ;
   * un mot plus long que la ligne se coupe où il le faut. Un bloc vide
   * garde sa ligne.
   */
  private couperRiche(segments: readonly Segment[], largeur: number, taille: number): Morceau[][] {
    // Les mots, chacun en morceaux de sa coupe : « **ab**cd » est un mot.
    const mots: Morceau[][] = [];
    let mot: Morceau[] = [];
    for (const s of segments) {
      for (const partie of s.texte.split(/(\s+)/)) {
        if (!partie) continue;
        if (/^\s+$/.test(partie)) {
          if (mot.length > 0) mots.push(mot);
          mot = [];
        } else {
          mot.push({ texte: partie, coupe: coupeDe(s) });
        }
      }
    }
    if (mot.length > 0) mots.push(mot);

    const mesure = (m: readonly Morceau[]) =>
      m.reduce((l, x) => l + this.largeur(x.texte, { coupe: x.coupe, taille }), 0);
    const espace = this.largeur(' ', { taille });
    const lignes: Morceau[][] = [];
    let ligne: Morceau[] = [];
    let occupe = 0;
    const ajouter = (m: readonly Morceau[], l: number) => {
      if (ligne.length > 0) ligne.push({ texte: ' ', coupe: 'normal' });
      ligne.push(...m.map((x) => ({ ...x })));
      occupe += (ligne.length > m.length ? espace : 0) + l;
    };
    for (const m of mots) {
      const l = mesure(m);
      if (ligne.length > 0 && occupe + espace + l <= largeur) {
        ajouter(m, l);
        continue;
      }
      if (ligne.length > 0) lignes.push(ligne);
      ligne = [];
      occupe = 0;
      if (l <= largeur) {
        ajouter(m, l);
        continue;
      }
      // Un mot trop long : lettre à lettre, ligne après ligne.
      let morceau: Morceau[] = [];
      let pris = 0;
      for (const x of m) {
        for (const lettre of x.texte) {
          const ll = this.largeur(lettre, { coupe: x.coupe, taille });
          if (pris + ll > largeur && morceau.length > 0) {
            lignes.push(morceau);
            morceau = [];
            pris = 0;
          }
          const avant = morceau[morceau.length - 1];
          if (avant && avant.coupe === x.coupe) avant.texte += lettre;
          else morceau.push({ texte: lettre, coupe: x.coupe });
          pris += ll;
        }
      }
      ligne = morceau;
      occupe = pris;
    }
    if (ligne.length > 0 || lignes.length === 0) lignes.push(ligne);
    // Les morceaux voisins de même coupe ne font qu'un.
    return lignes.map((l) =>
      l.reduce<Morceau[]>((fondus, x) => {
        const avant = fondus[fondus.length - 1];
        if (avant && avant.coupe === x.coupe) avant.texte += x.texte;
        else fondus.push({ ...x });
        return fondus;
      }, []),
    );
  }

  /** Les lignes d'un texte coupé à `largeur`, ses retours à la ligne gardés. */
  couper(texte: string, largeur: number, taille: number, s: Style = {}): string[] {
    this.style({ ...s, taille });
    const lignes: string[] = [];
    for (const paragraphe of texte.split(/\r?\n/)) {
      const mots = paragraphe.split(/\s+/).filter(Boolean);
      let courante = '';
      for (const mot of mots) {
        const essai = courante ? `${courante} ${mot}` : mot;
        if (this.doc.widthOfString(essai) <= largeur) {
          courante = essai;
          continue;
        }
        if (courante) lignes.push(courante);
        // Un mot plus long que la ligne se coupe où il le faut.
        let reste = mot;
        while (this.doc.widthOfString(reste) > largeur) {
          let n = reste.length - 1;
          while (n > 1 && this.doc.widthOfString(reste.slice(0, n)) > largeur) n -= 1;
          lignes.push(reste.slice(0, n));
          reste = reste.slice(n);
        }
        courante = reste;
      }
      lignes.push(courante);
    }
    while (lignes.length > 0 && lignes[lignes.length - 1] === '') lignes.pop();
    return lignes;
  }

  /**
   * L'en-tête de la DCH, sur chaque page : « RESSOURCES HUMAINES », le titre
   * de la grille, puis le logo, la référence du modèle et la pagination.
   */
  private entete() {
    const y0 = 35.6;
    const y1 = 47.6;
    const y2 = 61.9;
    const y3 = 100.7;
    const xLogo = 109.9;
    this.cadre(G, y0, D, y3);
    this.trait(G, y1, D, y1);
    this.trait(G, y2, D, y2);
    this.trait(xLogo, y2, xLogo, y3);
    this.trait(X_PAGE, y2, X_PAGE, y3);
    const arial = (coupe: Coupe = 'normal', taille = 9.96): Style => ({
      famille: 'arial',
      coupe,
      taille,
    });
    this.texte('RESSOURCES HUMAINES', G + RETRAIT, 44.6, arial());
    this.centre('GRILLE D’ÉVALUATION PERSONNEL CADRE', G, D, 58.2, arial('bold', 11.04));
    if (this.logo) {
      const image = this.doc.openImage(this.logo);
      const boite = { l: xLogo - G - 2 * RETRAIT, h: y3 - y2 - 8 };
      const echelle = Math.min(boite.l / image.width, boite.h / image.height);
      const l = image.width * echelle;
      const h = image.height * echelle;
      this.doc.image(image, G + (xLogo - G - l) / 2, y2 + (y3 - y2 - h) / 2, {
        width: l,
        height: h,
      });
    }
    const references: [string, string][] = [
      ['Réf.', 'S1/EN02'],
      ['Version', '01'],
      ['Date d’application', '05/12/2014'],
    ];
    references.forEach(([libelle, valeur], i) => {
      const base = 71.4 + i * 11.4;
      this.texte(libelle, 115.3, base, arial('bold'));
      this.texte(`: ${valeur}`, 240, base, arial());
    });
  }
}

// ──────────────────────────────────────────────── page 1 : couverture et identification

function pageDeCouverture(f: Feuille, d: DonneesDeLaGrille) {
  f.page();
  const x0 = 114;
  const x1 = 489.7;
  f.aplat(x0, 137.5, x1, 226, MARINE);
  f.cadre(x0, 137.5, x1, 226);
  f.centre('DIRECTION DU CAPITAL HUMAIN', x0, x1, 186, {
    coupe: 'bold',
    taille: 14,
    couleur: '#ffffff',
  });
  f.aplat(x0, 251.9, x1, 413.9, MARINE);
  f.cadre(x0, 251.9, x1, 413.9);
  const titre = ['GRILLE D’ÉVALUATION', 'DU', 'PERSONNEL CADRE'];
  const taille = Math.min(
    ...titre.map((l) => f.ajuste(l, x1 - x0 - 24, { taille: 28, coupe: 'bold' })),
  );
  titre.forEach((ligne, i) =>
    f.centre(ligne, x0, x1, 309 + i * 32.4, { coupe: 'bold', taille, couleur: '#ffffff' }),
  );

  // L'année, à droite.
  const annee: Style = { famille: 'arial', coupe: 'bold', taille: 14 };
  const libelle = 'ANNÉE : ';
  const fin = f.texte(libelle, 433.6, 454, annee);
  f.texte(String(d.annee), fin, 454, annee);

  // Identification.
  f.cadre(x0, 498, x1, 518.4);
  f.centre('IDENTIFICATION', x0, x1, 511.6, { taille: 11 });

  const id = d.identification;
  const gauche = x0 + RETRAIT;
  const droite = x1 - RETRAIT;
  const milieu = 300;
  f.cadre(x0, 544.3, x1, 747.1);
  f.trait(x0, 590.2, x1, 590.2);
  f.trait(x0, 689.9, x1, 689.9);
  f.champ('DIRECTION :', id.direction, gauche, 561, milieu - 8);
  f.champ('DÉPARTEMENT :', id.departement, milieu, 561, droite);
  f.champ('SERVICE :', id.service, milieu, 579.6, droite);
  f.champ('PRÉNOM & NOM DE L’AGENT (N) :', id.agent, gauche, 615.2, 388);
  f.champ('MATRICULE :', id.matricule, 392, 615.2, droite);
  f.champ('FONCTION :', id.fonction, gauche, 643.1, droite);
  f.champ('ANCIENNETÉ DANS LE POSTE :', id.anciennete, gauche, 670.9, droite);
  f.champ('PRÉNOM & NOM DE L’ÉVALUATEUR (N+1) :', id.evaluateur, gauche, 709.9, droite);
  f.champ('FONCTION :', id.fonctionEvaluateur, gauche, 733.1, droite);

  f.caseACocher(114.7, 756.8, 61.9, 21, d.nouveauAuPoste, 2);
  f.texte('Agent nouveau à son poste actuel (mettre une croix)', 186.4, 767.2, { taille: 8 });
}

// ──────────────────────────────────────────────── page 2 : rappel des objectifs

const RAPPEL = 'RAPPEL SUR LES OBJECTIFS PRINCIPAUX FIXÉS À L’AGENT POUR LA PÉRIODE ÉCOULÉE';

/**
 * Le rappel des objectifs de l'année écoulée, taillé à ce qui est écrit
 * (ADR-0153). Chaque objectif a sa ligne dans la grille A à D : son
 * intitulé, son texte, haute de ce texte, la croix au milieu. Puis les
 * raisons des objectifs partiellement réalisés ou non réalisés, s'il y en a
 * à donner. Ce qui ne tient pas sur la page continue sur la suivante, sous
 * le même titre. Un objectif ou des raisons à écrire, restés vides, gardent
 * leurs pointillés.
 */
function pagesDesObjectifs(f: Feuille, c: ContenuDeGrille) {
  const xGrille = 312;
  const colonne = 21.2;
  const xFin = xGrille + 4 * colonne;
  const x0 = 35;
  const x1 = xGrille - 12;
  const xLegende = 467.5;
  const finLegende = 178.8 + 4 * 46;
  const taille = 9.5;
  const interligne = 15;
  /** Une ligne vide, à remplir à la main : l'écart du modèle. */
  const interligneVide = 20;
  /** Du haut d'une ligne à la base de son intitulé, de l'intitulé au texte, du texte au bas. */
  const [avant, entre, apres] = [22, 18, 16];

  let premiere = true;
  /** Le haut du cadre de la page, celui de sa grille, et le bas de la dernière ligne posée. */
  let page = { haut: 121, grille: 168, y: 181 };

  const enTeteDeLaGrille = () =>
    NIVEAUX.forEach((n, i) =>
      f.centre(n, xGrille + i * colonne, xGrille + (i + 1) * colonne, page.y - 3, {
        coupe: 'bold',
        taille: 9,
      }),
    );
  const fermerLaGrille = () => {
    f.cadre(xGrille, page.grille, xFin, page.y);
    f.trait(xGrille, page.grille + 13, xFin, page.grille + 13);
    for (let i = 1; i < 4; i++) {
      f.trait(xGrille + i * colonne, page.grille, xGrille + i * colonne, page.y);
    }
  };
  const fermerLaPage = (bas: number) => f.cadre(G, page.haut, D, bas);
  const pageDeSuite = (grille: boolean) => {
    f.page();
    f.bande(112.3, 132.3, `${RAPPEL} (SUITE)`, 11);
    premiere = false;
    page = { haut: 112.3, grille: 149, y: 162 };
    if (grille) enTeteDeLaGrille();
  };

  f.page();
  f.bande(121, 151.5, RAPPEL);
  // La légende, à droite, sur la première page.
  NIVEAUX.forEach((n, i) => {
    const y = 178.8 + i * 46;
    f.cadre(xLegende, y, D - 2, y + 46);
    f.centre(n, xLegende, D - 2, y + 16, { coupe: 'bold', taille: 11 });
    const lignes = f.couper(NIVEAUX_D_OBJECTIF[n], D - 2 - xLegende - 8, 11);
    lignes.forEach((l, j) => f.centre(l, xLegende, D - 2, y + 30 + j * 12.8, { taille: 11 }));
  });
  enTeteDeLaGrille();

  c.objectifs.forEach((o, i) => {
    const lignes = texteRicheVide(o.texte) ? null : f.disposer(o.texte, x1 - x0, taille);
    const pas = lignes ? interligne : interligneVide;
    const nombre = lignes ? lignes.length : 2;
    const hauteur = avant + entre + (nombre - 1) * pas + apres;
    if (page.y + hauteur > BAS) {
      fermerLaGrille();
      fermerLaPage(page.y + 20);
      pageDeSuite(true);
    }
    const y = page.y;
    if (y > page.grille + 13) f.trait(xGrille, y, xFin, y);
    const base = y + avant;
    f.texte(`OBJECTIF ${i + 1}`, x0, base, { taille: 11 });
    for (let k = 0; k < nombre; k++) {
      const ligne = lignes?.[k];
      if (ligne) f.poser(ligne, x0, base + entre + k * pas, taille);
      else f.pointilles(x0, x1, base + entre + k * pas + 1);
    }
    if (o.niveau) {
      const k = NIVEAUX.indexOf(o.niveau);
      f.croix(xGrille + (k + 0.5) * colonne, y + hauteur / 2, 5);
    }
    page.y = y + hauteur;
  });
  fermerLaGrille();

  // Les raisons : sous la grille et la légende, ou sur une page de suite.
  const aDonner = c.objectifs.some((o) => o.niveau === 'C' || o.niveau === 'D');
  const fond = () => Math.max(page.y, premiere ? finLegende : 0);
  if (texteRicheVide(c.raisons) && !aDonner) {
    fermerLaPage(fond() + 20);
    return;
  }
  const xFinRaisons = D - RETRAIT - 4;
  const lignes = texteRicheVide(c.raisons) ? null : f.disposer(c.raisons, xFinRaisons - x0, taille);
  const pas = lignes ? interligne : interligneVide;
  const nombre = lignes ? lignes.length : 3;
  const hauteur = 24 + (nombre - 1) * pas + 20;
  let intitule = fond() + 32;
  if (intitule + hauteur > BAS) {
    fermerLaPage(fond() + 20);
    pageDeSuite(false);
    intitule = 162;
  }
  f.texte(
    'Pour les objectifs non atteints ou partiellement réalisés, indiquez succinctement les raisons :',
    x0,
    intitule,
    { taille: 10 },
  );
  for (let k = 0; k < nombre; k++) {
    const ligne = lignes?.[k];
    if (ligne) f.poser(ligne, x0, intitule + 24 + k * pas, taille);
    else f.pointilles(x0, xFinRaisons, intitule + 24 + k * pas + 1);
  }
  fermerLaPage(intitule + hauteur);
}

// ──────────────────────────────────────────────── page 3 : les treize critères

function pageDesCriteres(f: Feuille, c: ContenuDeGrille, commandement: boolean) {
  f.page();
  f.bande(112.3, 132.3, 'ÉVALUATION DES PERFORMANCES DANS LE POSTE', 12);

  const xNum = G;
  const xIntitule = 57.1;
  const xA = 170.5;
  const colonne = (D - xA) / 4;
  const xs = [xA, xA + colonne, xA + 2 * colonne, xA + 3 * colonne, D];
  const haut = 152.5;
  const enTete = 171.6;
  const times = (coupe: Coupe = 'normal'): Style => ({ famille: 'times', coupe, taille: 8 });
  const interligne = 9.2;
  const boite = 10;
  const retraitCase = boite + 5;

  // Hauteur de chaque ligne : la plus longue de ses cellules.
  const lignesDe = (texte: string, largeur: number, premiere: number) => {
    // La première ligne cède la place à la case.
    const mots = texte.split(/\s+/);
    let enTeteDeCellule = '';
    const restants = [...mots];
    while (restants.length > 0) {
      const essai = enTeteDeCellule ? `${enTeteDeCellule} ${restants[0]}` : restants[0]!;
      if (f.largeur(essai, times()) > premiere) break;
      enTeteDeCellule = essai;
      restants.shift();
    }
    return [enTeteDeCellule, ...f.couper(restants.join(' '), largeur, 8, times())].filter(
      (l, i) => i === 0 || l !== '',
    );
  };
  const cellules = CRITERES_CADRE.map((cr) => {
    const intitule = f.couper(
      cr.commandement ? `${cr.intitule} (*)` : cr.intitule,
      xA - xIntitule - 2 * RETRAIT,
      8,
      times('bold'),
    );
    const niveaux = NIVEAUX.map((n) =>
      lignesDe(cr.niveaux[n], colonne - 2 * 4, colonne - 2 * 4 - retraitCase),
    );
    const n = Math.max(intitule.length, ...niveaux.map((l) => l.length));
    return { cr, intitule, niveaux, hauteur: Math.max(28, n * interligne + 9) };
  });

  // L'en-tête du tableau.
  f.cadre(xNum, haut, D, enTete);
  f.centre('N°', xNum, xIntitule, 165, times('bold'));
  f.centre('NIVEAU', xIntitule, xA, 160.6, { coupe: 'bold', taille: 8 });
  f.centre('D’ÉVALUATION', xIntitule, xA, 169.4, { coupe: 'bold', taille: 8 });
  NIVEAUX.forEach((n, i) => f.centre(n, xs[i]!, xs[i + 1]!, 165, { coupe: 'bold', taille: 8 }));
  for (const x of [xIntitule, ...xs.slice(0, 4)]) f.trait(x, haut, x, enTete);

  let y = enTete;
  for (const cel of cellules) {
    const y1 = y + cel.hauteur;
    f.cadre(xNum, y, D, y1);
    for (const x of [xIntitule, ...xs.slice(0, 4)]) f.trait(x, y, x, y1);
    const milieu = (y + y1) / 2;
    f.centre(String(cel.cr.numero), xNum, xIntitule, milieu + 2.8, times('bold'));
    const hautIntitule = milieu - (cel.intitule.length * interligne) / 2 + 6.8;
    cel.intitule.forEach((l, i) =>
      f.texte(l, xIntitule + RETRAIT, hautIntitule + i * interligne, times('bold')),
    );
    const choisi = c.criteres[cel.cr.numero - 1] ?? null;
    const vaut = commandement || !cel.cr.commandement;
    NIVEAUX.forEach((n, i) => {
      const x = xs[i]! + 4;
      f.caseACocher(x, y + 4, boite, boite, vaut && choisi === n, 1.5);
      cel.niveaux[i]!.forEach((l, j) =>
        f.texte(l, j === 0 ? x + retraitCase : x, y + 11.6 + j * interligne, times()),
      );
    });
    y = y1;
  }

  f.texte(`(*) ${NOTE_COMMANDEMENT}`, 36, y + 15, {
    famille: 'times',
    coupe: 'bold',
    taille: 9.96,
  });

  // Ce que vaut chaque niveau : la lettre, puis « RÉSULTATS » et ce qu'ils sont.
  const y0 = y + 26;
  const y1 = y0 + 34;
  f.cadre(xNum, y0, D, y1);
  for (const x of xs.slice(0, 4)) f.trait(x, y0, x, y1);
  ['SIGNIFICATION', 'DES NIVEAUX', 'D’ÉVALUATION'].forEach((l, i) =>
    f.texte(l, xNum + RETRAIT, y0 + 10.5 + i * 9.4, times()),
  );
  NIVEAUX.forEach((n, i) => {
    const [, qualite = ''] = SIGNIFICATION_DES_NIVEAUX[n].split(/^Résultats /);
    f.centre(n, xs[i]!, xs[i + 1]!, y0 + 10.5, times('bold'));
    f.centre('RÉSULTATS', xs[i]!, xs[i + 1]!, y0 + 19.9, times());
    f.centre(qualite.toUpperCase(), xs[i]!, xs[i + 1]!, y0 + 29.3, times());
  });
}

// ──────────────────────────────────────────────── page 4 : résumé, actions, objectifs à venir

function pageDuResume(f: Feuille, c: ContenuDeGrille) {
  f.page();
  const x0 = G + RETRAIT;
  const x1 = D - RETRAIT;
  f.cadre(G, 131.8, D, 672.5);

  f.bande(131.8, 152.1, 'RÉSUMÉ DE L’ÉVALUATION DES PERFORMANCES', 12);
  f.texte('1- POINTS FORTS DE L’ÉVALUÉ :', x0, 172, { taille: 8 });
  f.texteRiche(c.pointsForts, x0, x1, [190, 208, 226, 244], 9);
  f.texte('2- POINTS FAIBLES DE L’ÉVALUÉ (à améliorer) :', x0, 266, { taille: 8 });
  f.texteRiche(c.pointsFaibles, x0, x1, [284, 302, 320, 338], 9);

  f.bande(348.2, 368.6, 'ACTIONS POUR AMÉLIORER LES PERFORMANCES DE N', 12);
  f.texteRiche(c.actions, x0, x1, [386, 404, 422, 440], 9);

  f.bande(
    451.8,
    472.1,
    'OBJECTIFS DE TRAVAIL POUR LA PÉRIODE À VENIR (à remplir par N+1 après concertation avec N)',
    11,
  );
  const xEcheance = 420;
  const finObjectif = xEcheance - 20;
  f.centre('OBJECTIFS', x0, finObjectif, 494, { taille: 9 });
  f.centre('ÉCHÉANCES', xEcheance, x1, 494, { taille: 9 });
  const objectifs = c.objectifsAVenir.filter((o) => o.texte);
  if (objectifs.length === 0) {
    // Rien d'écrit : les quatre lignes du modèle, à remplir à la main.
    for (let i = 0; i < OBJECTIFS_A_VENIR; i++) {
      const base = 518 + i * 40;
      f.surLignes('', x0, finObjectif, [base, base + 16], 9);
      f.surLignes('', xEcheance, x1, [base], 9);
    }
    return;
  }
  // Une puce par objectif, haut de son texte, son échéance en face.
  const xTexte = x0 + 11;
  let base = 518;
  for (const o of objectifs) {
    const deuxLignes = f.couper(o.texte, finObjectif - xTexte, 9).length > 1;
    f.texte('•', x0 + 2, base, { taille: 9 });
    f.surLignes(o.texte, xTexte, finObjectif, deuxLignes ? [base, base + 16] : [base], 9);
    if (o.echeance) f.centre(dateEnLettres(o.echeance), xEcheance, x1, base, { taille: 9 });
    base += deuxLignes ? 40 : 26;
  }
}

// ──────────────────────────────────────────────── page 5 : formation et ratification

/**
 * Les besoins de formation, puis la ratification de l'entretien, qui les
 * suit (ADR-0153). Chaque besoin a sa ligne, haute de son titre ; au-delà
 * des trois lignes du modèle, ils se resserrent. Sans besoin, les trois
 * lignes du modèle, à remplir à la main.
 */
function pageDeLaRatification(f: Feuille, d: DonneesDeLaGrille) {
  f.page();
  const x0 = G + RETRAIT;
  const x1 = D - RETRAIT;
  const besoins = d.contenu.formations;
  f.bande(
    104.9,
    125.2,
    `${besoinsDeFormation(besoins.length).toUpperCase()} (à remplir par N+1 après concertation avec N)`,
    11,
  );
  let derniere = 229;
  if (besoins.length === 0) {
    for (let i = 0; i < 3; i++) f.champ(`Formation n° ${i + 1}`, null, x0, 152 + i * 38.5, x1, 8);
  } else {
    const pas = besoins.length <= 3 ? 38.5 : 26;
    let base = 152;
    besoins.forEach((b, i) => {
      const debut = f.texte(`Formation n° ${i + 1}`, x0, base, { taille: 8 }) + 4;
      const deuxLignes = f.couper(b.titre, x1 - debut, 9).length > 1;
      f.surLignes(b.titre, debut, x1, deuxLignes ? [base, base + 13] : [base], 9);
      derniere = deuxLignes ? base + 13 : base;
      base = derniere + pas;
    });
  }
  // La ratification, sous le dernier besoin ; sans besoin, à sa place du modèle.
  const dy = derniere + 31.7 - 260.7;
  f.cadre(G, 104.9, D, 572 + dy);

  f.bande(260.7 + dy, 281.1 + dy, 'RATIFICATION DE L’ENTRETIEN', 11);
  f.centre('COMMENTAIRES ÉVENTUELS DE L’ÉVALUÉ :', G, D, 303.6 + dy, { taille: 8 });
  f.surLignes(
    d.ratification.commentaires,
    x0,
    x1,
    [322, 342, 362, 382].map((b) => b + dy),
    9,
  );
  f.doc
    .moveTo(x0, 400 + dy)
    .lineTo(x1, 400 + dy)
    .lineWidth(0.6)
    .strokeColor(ENCRE)
    .dash(3, { space: 2 })
    .stroke()
    .undash();

  const xN1 = 170;
  const xN = 380;
  f.texte('RATIFICATION :', 45, 426 + dy, { coupe: 'bold', taille: 8 });
  f.texte('ÉVALUATEUR (N+1)', xN1, 426 + dy, { taille: 8 });
  f.texte('ÉVALUÉ (N)', xN, 426 + dy, { taille: 8 });
  const r = d.ratification;
  const lignes: [string, string | null, string | null][] = [
    ['PRÉNOM ET NOM :', r.evaluateur, r.agent],
    ['DATE :', enLettres(r.envoyeeLe) || null, enLettres(r.valideeLe) || null],
  ];
  lignes.forEach(([libelle, n1, n], i) => {
    const base = 456 + i * 30.6 + dy;
    f.texte(libelle, 45, base, { taille: 8 });
    for (const [x, valeur] of [
      [xN1, n1],
      [xN, n],
    ] as const) {
      if (valeur) f.texte(valeur, x, base, { taille: f.ajuste(valeur, 195, { taille: 9 }) });
      else f.pointilles(x, x + 150, base + 1);
    }
  });
  // La signature : le N+1 paraphe en envoyant la grille à l'agent, l'agent
  // en la validant.
  const baseSignature = 456 + 2 * 30.6 + dy;
  f.texte('SIGNATURE :', 45, baseSignature, { taille: 8 });
  for (const [x, nom, signe] of [
    [xN1, r.evaluateur, Boolean(r.envoyeeLe)],
    [xN, r.agent, Boolean(r.valideeLe)],
  ] as const) {
    f.pointilles(x, x + 150, baseSignature + 1);
    if (signe && nom) f.paraphe(nom, x + 8, baseSignature - 2);
  }
  f.texte(
    '(Le document doit obligatoirement être validé par la signature de l’agent évalué (N).)',
    45,
    548 + dy,
    { taille: 8 },
  );
}

// ──────────────────────────────────────────────── page 6 : réservée à la hiérarchie

function pageDeLaHierarchie(f: Feuille, d: DonneesDeLaGrille) {
  f.page();
  const x0 = G + RETRAIT;
  const x1 = D - RETRAIT;
  f.bande(112.3, 132.3, 'PARTIE STRICTEMENT RÉSERVÉE À LA HIÉRARCHIE', 11);
  f.bande(153, 172.9, 'SYNTHÈSE GÉNÉRALE DE N+1', 11);

  // La synthèse : deux critères, de A à D.
  const xCrit = 136.5;
  const colonne = (D - xCrit) / 4;
  const xs = [xCrit, xCrit + colonne, xCrit + 2 * colonne, xCrit + 3 * colonne, D];
  const haut = 193.2;
  const enTete = 207.1;
  f.cadre(G, haut, D, enTete);
  f.centre('CRITÈRES', G, xCrit, 203.8, { taille: 10 });
  NIVEAUX.forEach((n, i) => f.centre(n, xs[i]!, xs[i + 1]!, 203.8, { taille: 10 }));
  for (const x of xs.slice(0, 4)) f.trait(x, haut, x, enTete);
  const choix: Record<'comprehension' | 'tenue', Niveau | null> = {
    comprehension: d.contenu.comprehension,
    tenue: d.contenu.tenue,
  };
  let y = enTete;
  for (const critere of SYNTHESE_DU_N1) {
    const y1 = y + 36;
    f.cadre(G, y, D, y1);
    for (const x of xs.slice(0, 4)) f.trait(x, y, x, y1);
    const intitule = f.couper(critere.intitule.toUpperCase(), xCrit - G - 2 * RETRAIT, 8);
    intitule.forEach((l, i) =>
      f.centre(l, G, xCrit, (y + y1) / 2 - (intitule.length - 1) * 4.6 + 2.8 + i * 9.2, {
        taille: 8,
      }),
    );
    NIVEAUX.forEach((n, i) => {
      const x = xs[i]! + 4;
      f.caseACocher(x, y + 6, 14, 11, choix[critere.cle] === n, 0.9);
      const lignes = f.couper(critere.niveaux[n], colonne - 4 - 14 - 8, 8);
      lignes.forEach((l, j) => f.texte(l, x + 18, y + 14 + j * 9.4, { taille: 8 }));
    });
    y = y1;
  }

  // Les observations du N+1.
  f.bande(296, 309.2, 'OBSERVATIONS N+1', 10);
  f.cadre(G, 296, D, 434);
  f.texteRiche(d.contenu.observations, x0, x1, [330, 351, 372, 393], 9);
  const finSignature = f.texte('SIGNATURE DE N+1', 360, 422, { coupe: 'bold', taille: 10 });
  if (d.ratification.envoyeeLe && d.ratification.evaluateur) {
    f.paraphe(d.ratification.evaluateur, finSignature + 14, 425, 24);
  }

  // Les commentaires du N+2.
  const n2 = d.n2;
  f.bande(454, 467.2, 'COMMENTAIRES DE N+2', 10);
  f.cadre(G, 454, D, 569.5);
  const xDroite = 318;
  f.surLignes(n2?.commentaires ?? '', x0, xDroite - 12, [487, 512.5, 538, 563], 9);
  f.champ('Nom', n2?.nom ?? null, xDroite, 487, xDroite + 112, 9);
  f.champ('Prénom', n2?.prenom ?? null, xDroite + 116, 487, x1, 9);
  f.champ('Fonction', n2?.fonction ?? null, xDroite, 512.5, x1, 9);
  f.champ('Date', enLettres(n2?.le ?? null) || null, xDroite, 538, x1, 9);
  f.champ('Signature', null, xDroite, 563, x1, 9);
  if (n2?.le && n2.prenom && n2.nom) {
    const debut = xDroite + f.largeur('Signature', { taille: 9 }) + 10;
    f.paraphe(`${n2.prenom} ${n2.nom}`, debut, 562, 20);
  }

  // Les commentaires des autres hiérarchies : à la main.
  f.bande(590, 603.2, 'COMMENTAIRES ÉVENTUELS DES AUTRES HIÉRARCHIES', 10);
  f.cadre(G, 590, D, 702.5);
  for (const base of [628, 653, 678, 698]) f.pointilles(x0, x1, base);

  f.bande(702.5, 725, 'Diffusion du document : original DCH – copies hiérarchie', 9, DIFFUSION);
}
