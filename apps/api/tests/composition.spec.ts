/**
 * La composition des paragraphes justifiés des documents (ADR-0173) : la
 * césure à la française (`cesure.ts`), et les lignes réparties sur tout le
 * paragraphe à la fois (`composition.ts`), sur des paragraphes des modèles,
 * en Raleway 11 comme sur les documents.
 */
import PDFDocument from 'pdfkit';
import { describe, expect, it } from 'vitest';
import { cesures } from '../src/modules/documents/cesure';
import {
  lignesEquilibrees,
  type Morceau,
  type Mot,
  type Outils,
} from '../src/modules/documents/composition';
import { enregistrerPolices, police } from '../src/modules/documents/entete';

/** Un mot coupé à toutes ses places de césure : « consi-dé-ra-tion ». */
const coupe = (mot: string) => {
  let a = 0;
  let resultat = '';
  for (const k of cesures(mot)) {
    resultat += `${mot.slice(a, k)}-`;
    a = k;
  }
  return resultat + mot.slice(a);
};

describe('la césure', () => {
  it('coupe un mot courant là où le français le permet, trois lettres au moins de chaque côté', () => {
    expect(coupe('considération')).toBe('consi-dé-ra-tion');
    expect(coupe('disponibilité')).toBe('dis-po-ni-bi-lité');
    expect(coupe('rémunération')).toBe('rému-né-ra-tion');
    expect(coupe('responsabilités')).toBe('res-pon-sa-bi-li-tés');
    expect(coupe('établissement')).toBe('éta-blis-se-ment');
  });

  it('ne coupe ni un nom propre, ni un sigle, ni un nombre, ni un mot composé, ni un mot court', () => {
    for (const mot of [
      'Sénégal',
      'Convention',
      'APIX',
      'APIX-SA',
      '2026',
      'porte-parole',
      'maison',
    ]) {
      expect(cesures(mot)).toEqual([]);
    }
  });

  it('ne coupe jamais juste après une élision, et la ponctuation qui suit ne compte pas', () => {
    expect(coupe('l’assurance')).toBe('l’assu-rance');
    expect(coupe('qu’indépendamment')).toBe('qu’indé-pen-dam-ment');
    expect(cesures('considération,')).toEqual(cesures('considération'));
  });
});

const NBSP = ' ';

/** Des paragraphes de la domiciliation bancaire et de la décision de disponibilité. */
const PARAGRAPHES = [
  `Nous vous informons que Madame${NBSP}Awa${NBSP}DIOP, qui fait partie de notre personnel ` +
    `depuis le 1er${NBSP}mars${NBSP}2018 et qui occupe actuellement la fonction de Chargée ` +
    `d’études au titre d’un contrat à durée indéterminée, nous a donné, le ` +
    `15${NBSP}octobre${NBSP}2026, l’ordre de virement irrévocable à vos caisses, pour en ` +
    `créditer son compte n°${NBSP}SN012${NBSP}01001 tenu sur les livres de la CBAO, toutes ` +
    'sommes pouvant lui être dues par notre Société, à quelque titre que ce soit, notamment ' +
    'son salaire mensuel net qui s’élève actuellement à six cent cinquante mille francs CFA, ' +
    'gratifications, indemnités de congés, etc.',
  'Par la présente, nous nous engageons irrévocablement dans la limite de l’échéance ' +
    'ci-dessus indiquée à exécuter ces instructions qui ne pourront être révoquées qu’avec ' +
    'votre accord exprès donné par écrit ou pour les causes ci-dessous indiquées.',
  'Enfin, nous nous engageons à vous aviser immédiatement de tout changement qui ' +
    `surviendrait dans la situation de Madame${NBSP}Awa${NBSP}DIOP, en particulier en cas ` +
    'de licenciement ou de démission. Dans cette éventualité, nous reconnaissons que nous ' +
    'serions tenus de reverser aussitôt sur le compte de l’intéressée à la CBAO, ' +
    'l’intégralité des sommes dont nous pourrions être redevables envers elle à quelque ' +
    'titre que ce soit.',
  'Pendant cette période de disponibilité, conformément aux dispositions de l’article L.68 ' +
    `du Code du travail, Madame${NBSP}Awa${NBSP}DIOP ne percevra aucune rémunération et ` +
    'cessera de bénéficier de ses droits à l’avancement et à la retraite.',
];

/** Les largeurs de texte des documents, de la plus étroite à la plus large. */
const LARGEURS = [420, 455, 510];

describe('la justification', () => {
  const doc = new PDFDocument();
  enregistrerPolices(doc);
  doc.font(police(doc, 'normal')).fontSize(11);
  const mesure = (texte: string) => doc.widthOfString(texte);
  const espace = mesure(' ');
  const morceau = (texte: string): Morceau => ({
    texte,
    gras: false,
    souligne: false,
    italique: false,
    raye: false,
    encadre: false,
    largeur: mesure(texte),
  });
  const motsDe = (texte: string): Mot[] =>
    texte.split(' ').map((t) => ({ morceaux: [morceau(t)], largeur: mesure(t) }));
  const outils = (largeurUtile: number): Outils => ({
    largeurUtile,
    espace,
    partie: (m, texte) => ({ ...m, texte, largeur: mesure(texte) }),
  });
  const texteDe = (mot: Mot) => mot.morceaux.map((m) => m.texte).join('');
  /**
   * Les lignes d'un tenant : un retour à chaque fin de ligne, une espace
   * insécable entre deux mots liés, le mot coupé recollé.
   */
  const enTexte = (lignes: Mot[][]) =>
    lignes
      .map((l) => l.map((m, j) => (j > 0 ? (m.lie ? NBSP : ' ') : '') + texteDe(m)).join(''))
      .join('\n')
      .replace(/(\p{Ll})-\n(\p{Ll})/gu, '$1$2');
  /** Le blanc entre deux mots d'une ligne justifiée, en espaces normales. */
  const blanc = (ligne: Mot[], largeurUtile: number) =>
    (largeurUtile - ligne.reduce((s, m) => s + m.largeur, 0)) / (ligne.length - 1) / espace;
  /** Le pire blanc d'un remplissage ligne par ligne, chaque ligne au plus juste, sans césure. */
  const pireBlancAuPlusJuste = (mots: Mot[], largeurUtile: number) => {
    const blancs: number[] = [];
    let ligne: Mot[] = [];
    for (const m of mots) {
      const largeur = ligne.reduce((s, x) => s + x.largeur + espace, 0) + m.largeur;
      if (ligne.length > 0 && largeur > largeurUtile) {
        blancs.push(blanc(ligne, largeurUtile));
        ligne = [];
      }
      ligne.push(m);
    }
    return Math.max(...blancs);
  };
  const cas = LARGEURS.flatMap((largeur) => PARAGRAPHES.map((texte, i) => ({ largeur, texte, i })));

  it.each(cas)(
    'paragraphe $i sur $largeur points : le texte entier, dans son ordre, chaque ligne dans la largeur',
    ({ largeur, texte }) => {
      const lignes = lignesEquilibrees(motsDe(texte), outils(largeur));
      // Chaque fin de ligne tombe sur un blanc du texte, et rien d'autre ne change.
      const recompose = enTexte(lignes);
      expect([...recompose].map((c, k) => (c === '\n' ? texte[k] : c)).join('')).toBe(texte);
      for (const ligne of lignes.slice(0, -1)) {
        expect(ligne.length).toBeGreaterThan(1);
        // Un blanc se resserre de 15 % au plus.
        expect(blanc(ligne, largeur)).toBeGreaterThanOrEqual(0.85 - 1e-9);
      }
      const derniere = lignes.at(-1)!;
      const naturelle =
        derniere.reduce((s, m) => s + m.largeur, 0) + (derniere.length - 1) * espace;
      expect(naturelle).toBeLessThanOrEqual(largeur);
      // Le dernier mot du paragraphe ne se coupe pas.
      expect(texteDe(derniere.at(-1)!)).toBe(texte.split(' ').at(-1));
    },
  );

  it.each(cas)(
    'paragraphe $i sur $largeur points : pas de blanc plus large que ligne par ligne',
    ({ largeur, texte }) => {
      const lignes = lignesEquilibrees(motsDe(texte), outils(largeur));
      const pire = Math.max(...lignes.slice(0, -1).map((l) => blanc(l, largeur)));
      expect(pire).toBeLessThanOrEqual(pireBlancAuPlusJuste(motsDe(texte), largeur) + 1e-9);
    },
  );

  it('ne sépare jamais une civilité de son nom, ni un nombre de ce qui le suit', () => {
    for (const largeur of LARGEURS) {
      for (const texte of PARAGRAPHES) {
        const recompose = enTexte(lignesEquilibrees(motsDe(texte), outils(largeur)));
        for (const { index } of recompose.matchAll(/\n/g)) {
          if (texte[index] !== NBSP) continue;
          // Une insécable a cédé : jamais après « Madame », « 15 », « 1er » ou « n° ».
          const avant = texte
            .slice(0, index)
            .split(/[ \u00a0]/)
            .at(-1);
          expect(avant).not.toMatch(/^(Madame|Monsieur|\d+(er)?|n°)$/u);
        }
      }
    }
  });

  it('étire les blancs des espaces insécables entre deux mots, jamais ceux d’un nombre', () => {
    const texte = `Madame${NBSP}Awa${NBSP}DIOP percevra (650${NBSP}000) francs le 15${NBSP}octobre.`;
    const [ligne] = lignesEquilibrees(motsDe(texte), outils(510));
    expect(ligne!.map((m) => [texteDe(m), Boolean(m.lie)])).toEqual([
      ['Madame', false],
      ['Awa', true],
      ['DIOP', true],
      ['percevra', false],
      [`(650${NBSP}000)`, false],
      ['francs', false],
      ['le', false],
      ['15', false],
      ['octobre.', true],
    ]);
  });

  it('coupe un mot en fin de ligne quand le blanc y gagne, trait d’union compris', () => {
    const lignes = lignesEquilibrees(motsDe(PARAGRAPHES[0]!), outils(420));
    const coupees = lignes.slice(0, -1).filter((l) => texteDe(l.at(-1)!).endsWith('-'));
    expect(coupees.length).toBeGreaterThan(0);
    for (const ligne of coupees) {
      // Trois lettres au moins avant la coupure.
      expect(texteDe(ligne.at(-1)!)).toMatch(/\p{L}{3}-$/u);
    }
  });
});
