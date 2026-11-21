import {
  CRITERES_NON_CADRE,
  NIVEAUX,
  NOTES_DU_NIVEAU,
  releveDesNotes,
  TOTAL_DES_POINTS,
  type ContenuDeGrille,
} from '@teranga/contracts';
import { cheminLogo } from '../documents/entete';
import {
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
   La grille d'évaluation du personnel non cadre (réf. S1/EN03), en PDF
   (ADR-0155) : cinq pages, sur la feuille des deux grilles.

   Ses pages à elle : les huit critères, chacun noté dans l'une des deux
   cases de son niveau ; puis le relevé des notes, chaque note pondérée par
   son coefficient et leur total sur 170, le résumé et les actions. Elle n'a
   pas d'objectifs. La note du modèle sur le critère du commandement, reprise
   de la grille du personnel cadre sans critère auquel renvoyer, ne
   s'imprime pas.
   ──────────────────────────────────────────────────────────────── */

/**
 * Les couleurs du modèle, qui ne sont pas celles de la grille du personnel
 * cadre : des bandes d'un bleu-gris clair, leur texte en noir ; les deux du
 * bas de la dernière page d'un bleu un peu plus soutenu ; l'identification
 * sur le même fond que les bandes, la synthèse du N+1 dans un simple cadre.
 */
const BLEU_GRIS = '#dbe4f0';
const MODELE: ModeleImprime = {
  personnel: 'PERSONNEL NON CADRE',
  reference: 'S1/EN03',
  application: '25/12/2014',
  teintes: {
    fond: BLEU_GRIS,
    texte: '#000000',
    gras: false,
    identification: BLEU_GRIS,
    synthese: null,
    autresHierarchies: '#c5d9f0',
    diffusion: '#c5d9f0',
  },
};

export function grilleDuPersonnelNonCadre(
  d: DonneesDeLaGrille,
  logo: string | null = cheminLogo(),
): Promise<Buffer> {
  return imprimerLaGrille(
    MODELE,
    d,
    (f) => {
      pageDeCouverture(f, d);
      pageDesCriteres(f, d.contenu);
      pageDuReleve(f, d.contenu);
      pageDeLaRatification(f, d);
      pageDeLaHierarchie(f, d);
    },
    logo,
  );
}

// ──────────────────────────────────────────────── page 2 : les huit critères

/**
 * Les huit critères. Chaque niveau a ses deux notes, chacune dans sa case,
 * la plus haute à gauche, comme sur le modèle : 10 et 9 pour A, 7 et 6 pour
 * B, 4 et 3 pour C, 1 et 0 pour D. La note donnée a sa croix ; ce que dit
 * le niveau s'écrit sous ses cases.
 */
function pageDesCriteres(f: Feuille, c: ContenuDeGrille) {
  let y = enTeteDesCriteres(f);
  const largeurCase = 30;
  const hauteurCase = 11;
  // Du haut de la ligne à la base du premier texte, sous les cases.
  const premiere = 4 + hauteurCase + 8.4;
  const cellules = CRITERES_NON_CADRE.map((cr) => {
    const intitule = lignesDeLIntitule(f, cr.intitule);
    const niveaux = NIVEAUX.map((n) => f.couper(cr.niveaux[n], COLONNE - 2 * 4, 8, times()));
    const n = Math.max(...niveaux.map((l) => l.length));
    const hauteur = Math.max(
      intitule.length * INTERLIGNE_DES_CRITERES + 9,
      premiere + (n - 1) * INTERLIGNE_DES_CRITERES + 6.6,
    );
    return { cr, intitule, niveaux, hauteur };
  });

  for (const cel of cellules) {
    const y1 = y + cel.hauteur;
    ligneDuTableau(f, y, y1, cel.cr.numero, cel.intitule);
    const donnee = c.notes[cel.cr.numero - 1] ?? null;
    NIVEAUX.forEach((n, i) => {
      NOTES_DU_NIVEAU[n].forEach((note, k) => {
        const x = k === 0 ? XS[i]! + 6 : XS[i + 1]! - 6 - largeurCase;
        f.cadre(x, y + 4, x + largeurCase, y + 4 + hauteurCase, 0.9);
        f.texte(String(note), x + 3, y + 12.2, times('bold'));
        if (donnee === note) f.croix(x + largeurCase - 8, y + 4 + hauteurCase / 2, 3);
      });
      cel.niveaux[i]!.forEach((l, j) =>
        f.texte(l, XS[i]! + 4, y + premiere + j * INTERLIGNE_DES_CRITERES, times()),
      );
    });
    y = y1;
  }
  significationDesNiveaux(f, y + 16);
}

// ──────────────────────────────────────────────── page 3 : relevé des notes, résumé, actions

/**
 * Le relevé des notes obtenues : chaque critère, sa note brute, son
 * coefficient et sa note pondérée, puis le total des points sur 170, une
 * fois chaque critère noté. Une note qui manque garde ses pointillés.
 * Dessous, le résumé de l'évaluation et les actions.
 */
function pageDuReleve(f: Feuille, c: ContenuDeGrille) {
  f.page();
  const haut = 112.3;
  f.bande(haut, 132.3, 'RELEVÉ DES NOTES OBTENUES', 12);

  // Le tableau, en retrait du cadre de la page.
  const x0 = G + 2 * RETRAIT;
  const x1 = D - 2 * RETRAIT;
  const xs = [x0, 280, 368, 452, x1];
  const enTete = 148;
  const premiere = enTete + 20;
  const pas = 19;
  const releve = releveDesNotes(c.notes);
  const finDesLignes = premiere + releve.lignes.length * pas + 6;
  const bas = finDesLignes + 26;
  f.cadre(x0, enTete, x1, bas);
  f.trait(x0, premiere, x1, premiere);
  f.trait(x0, finDesLignes, x1, finDesLignes);
  for (const x of xs.slice(1, 4)) f.trait(x, enTete, x, finDesLignes);
  ['CRITÈRES', 'Note brute', 'Coefficient', 'Note pondérée'].forEach((t, i) =>
    f.centre(t, xs[i]!, xs[i + 1]!, enTete + 13, { taille: 8.5 }),
  );
  // Les critères et les notes en Arial, comme sur le modèle : ses chiffres se lisent mieux.
  const arial = { famille: 'arial', taille: 9 } as const;
  releve.lignes.forEach((l, i) => {
    const base = premiere + 14 + i * pas;
    const intitule = `${l.critere.numero}- ${l.critere.intitule}`;
    const place = xs[1]! - x0 - 2 * RETRAIT;
    f.texte(intitule, x0 + RETRAIT, base, {
      famille: 'arial',
      taille: f.ajuste(intitule, place, { famille: 'arial', taille: 8.5 }),
    });
    // Une note, dans sa colonne ; sans note, ses pointillés.
    const valeur = (v: number | null, k: number) => {
      if (v === null) f.pointilles(xs[k]! + 22, xs[k + 1]! - 22, base + 1);
      else f.centre(String(v), xs[k]!, xs[k + 1]!, base, arial);
    };
    valeur(l.note, 1);
    valeur(l.critere.coefficient, 2);
    valeur(l.ponderee, 3);
  });

  // Le total, sous les lignes : « 128 / 170 », ou ses pointillés.
  const base = finDesLignes + 17;
  const gras = { famille: 'arial', coupe: 'bold', taille: 11 } as const;
  f.texte('TOTAL DES POINTS', x0 + 30, base, { taille: 11 });
  const sur = ` / ${TOTAL_DES_POINTS}`;
  const debutSur = x1 - 30 - f.largeur(sur, gras);
  f.texte(sur, debutSur, base, gras);
  if (releve.total === null) f.pointilles(debutSur - 90, debutSur - 2, base + 1);
  else {
    const total = String(releve.total);
    f.texte(total, debutSur - f.largeur(total, gras), base, gras);
  }

  const finActions = resumeEtActions(f, c, bas + 18);
  f.cadre(G, haut, D, finActions);
}
