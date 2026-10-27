import {
  CRITERES_CADRE,
  NIVEAUX,
  NIVEAUX_D_OBJECTIF,
  NOTE_COMMANDEMENT,
  OBJECTIFS_A_VENIR,
  dateEnLettres,
  texteRicheVide,
  type ContenuDeGrille,
} from '@teranga/contracts';
import { cheminLogo } from '../documents/entete';
import {
  BAS,
  COLONNE,
  D,
  enTeteDesCriteres,
  G,
  imprimerLaGrille,
  INTERLIGNE_DES_CRITERES,
  ligneDuTableau,
  lignesDeLIntitule,
  pageDeCouverture,
  pageDeLaHierarchie,
  pageDeLaRatification,
  resumeEtActions,
  RETRAIT,
  significationDesNiveaux,
  times,
  XS,
  type DonneesDeLaGrille,
  type Feuille,
  type ModeleImprime,
} from './feuille-de-grille';

/* ────────────────────────────────────────────────────────────────
   La grille d'évaluation du personnel cadre (réf. S1/EN02), en PDF
   (ADR-0149) : six pages, sur la feuille des deux grilles.

   Ses pages à elle : le rappel des objectifs de l'année écoulée, les treize
   critères notés de A à D, le résumé et les objectifs à venir. Le rappel
   des objectifs se taille à ce qui est écrit (ADR-0153) : autant
   d'objectifs qu'il y en a, chacun haut de son texte, sur une page de
   suite s'il le faut.
   ──────────────────────────────────────────────────────────────── */

/** Les couleurs du modèle : des bandes marine, leur texte blanc et gras. */
const MARINE = '#001f5f';
const MODELE: ModeleImprime = {
  personnel: 'PERSONNEL CADRE',
  reference: 'S1/EN02',
  application: '05/12/2014',
  teintes: {
    fond: MARINE,
    texte: '#ffffff',
    gras: true,
    identification: null,
    synthese: MARINE,
    autresHierarchies: MARINE,
    diffusion: '#17365d',
  },
};

export function grilleDuPersonnelCadre(
  d: DonneesDeLaGrille,
  logo: string | null = cheminLogo(),
): Promise<Buffer> {
  return imprimerLaGrille(
    MODELE,
    d,
    (f) => {
      pageDeCouverture(f, d);
      pagesDesObjectifs(f, d.contenu);
      pageDesCriteres(f, d.contenu, d.commandement);
      pageDuResume(f, d.contenu);
      pageDeLaRatification(f, d);
      pageDeLaHierarchie(f, d);
    },
    logo,
  );
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
  let y = enTeteDesCriteres(f);
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
    const intitule = lignesDeLIntitule(f, cr.commandement ? `${cr.intitule} (*)` : cr.intitule);
    const niveaux = NIVEAUX.map((n) =>
      lignesDe(cr.niveaux[n], COLONNE - 2 * 4, COLONNE - 2 * 4 - retraitCase),
    );
    const n = Math.max(intitule.length, ...niveaux.map((l) => l.length));
    return { cr, intitule, niveaux, hauteur: Math.max(28, n * INTERLIGNE_DES_CRITERES + 9) };
  });

  for (const cel of cellules) {
    const y1 = y + cel.hauteur;
    ligneDuTableau(f, y, y1, cel.cr.numero, cel.intitule);
    const choisi = c.criteres[cel.cr.numero - 1] ?? null;
    const vaut = commandement || !cel.cr.commandement;
    NIVEAUX.forEach((n, i) => {
      const x = XS[i]! + 4;
      f.caseACocher(x, y + 4, boite, boite, vaut && choisi === n, 1.5);
      cel.niveaux[i]!.forEach((l, j) =>
        f.texte(l, j === 0 ? x + retraitCase : x, y + 11.6 + j * INTERLIGNE_DES_CRITERES, times()),
      );
    });
    y = y1;
  }

  f.texte(`(*) ${NOTE_COMMANDEMENT}`, 36, y + 15, {
    famille: 'times',
    coupe: 'bold',
    taille: 9.96,
  });
  significationDesNiveaux(f, y + 26);
}

// ──────────────────────────────────────────────── page 4 : résumé, actions, objectifs à venir

function pageDuResume(f: Feuille, c: ContenuDeGrille) {
  f.page();
  const x0 = G + RETRAIT;
  const x1 = D - RETRAIT;
  f.cadre(G, 131.8, D, 672.5);
  const haut = resumeEtActions(f, c, 131.8);

  f.bande(
    haut,
    haut + 20.3,
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
