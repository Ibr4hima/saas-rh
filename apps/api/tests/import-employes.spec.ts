import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { classeur, fabriquerXlsx } from './fabrique-xlsx';
import { lirePremiereFeuille, XlsxIllisible } from '../src/common/xlsx';
import {
  convertirLigne,
  correspondre,
  finDeContrat,
  normaliserIntitule,
} from '../src/modules/people/import-employes';

/* ————————————————————————————————————————————————————————————————
   L'import d'un fichier d'effectif.

   Ici, la LECTURE et la TRADUCTION : ce que la plateforme comprend d'un
   classeur, sans toucher à la base. L'écriture des dossiers a son propre
   fichier, `import-service.spec.ts`.

   Les classeurs sont fabriqués octet par octet par `./fabrique-xlsx` : un
   .xlsx est une archive zip, et un test qui dépendrait d'un fichier joint au
   dépôt ne dirait plus rien le jour où quelqu'un le régénère avec un autre
   tableur.
   ———————————————————————————————————————————————————————————————— */

describe('lecture d’un classeur .xlsx', () => {
  it('lit une feuille désignée par un chemin ABSOLU dans les relations', () => {
    const f = lirePremiereFeuille(
      classeur(
        `<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Prénom</t></is></c></row></sheetData>`,
      ),
    );
    expect(f.nom).toBe('Employés');
    expect(f.lignes[0]).toEqual(['Prénom']);
  });

  it('décode les accents échappés en numérique', () => {
    const f = lirePremiereFeuille(
      classeur(
        `<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Mari&#233;</t></is></c></row></sheetData>`,
      ),
    );
    expect(f.lignes[0]?.[0]).toBe('Marié');
  });

  it('rend une DATE quand le format de la cellule en est un, un nombre sinon', () => {
    const f = lirePremiereFeuille(
      classeur(
        `<sheetData><row r="1">` +
          `<c r="A1" s="1" t="n"><v>32975</v></c>` + // format dd/mm/yyyy
          `<c r="B1" s="2" t="n"><v>32975</v></c>` + // format intégré 14
          `<c r="C1" s="0" t="n"><v>32975</v></c>` + // aucun format de date
          `</row></sheetData>`,
      ),
    );
    const [a, b, c] = f.lignes[0]!;
    expect(a).toBeInstanceOf(Date);
    expect((a as Date).toISOString().slice(0, 10)).toBe('1990-04-12');
    expect(b).toBeInstanceOf(Date);
    expect(c).toBe(32975);
  });

  it('garde les trous : une cellule absente ne décale pas la ligne', () => {
    const f = lirePremiereFeuille(
      classeur(
        `<sheetData><row r="1">` +
          `<c r="A1" t="inlineStr"><is><t>a</t></is></c>` +
          `<c r="C1" t="inlineStr"><is><t>c</t></is></c>` +
          `</row></sheetData>`,
      ),
    );
    expect(f.lignes[0]).toEqual(['a', null, 'c']);
  });

  it('recolle une chaîne partagée découpée en fragments de mise en forme', () => {
    const f = lirePremiereFeuille(
      classeur(`<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData>`, {
        'xl/sharedStrings.xml': `<sst><si><r><t>Direction du </t></r><r><t>Capital Humain</t></r></si></sst>`,
      }),
    );
    expect(f.lignes[0]?.[0]).toBe('Direction du Capital Humain');
  });

  it('refuse ce qui n’est pas une archive', () => {
    expect(() => lirePremiereFeuille(Buffer.from('ceci est un csv;pas un xlsx'))).toThrow(
      XlsxIllisible,
    );
  });
});

describe('correspondance des colonnes', () => {
  const entetes = [
    'Prénom',
    'Nom',
    'Matricule',
    'Début du contrat',
    'Direction affectée',
    'Salaire brut',
  ];

  it('retrouve les colonnes quels que soient accents, casse et ponctuation', () => {
    const { colonnes } = correspondre(['PRENOM', 'nom', 'N° matricule', "Date d'embauche"]);
    expect(colonnes.prenom).toBe(0);
    expect(colonnes.nom).toBe(1);
    expect(colonnes.matricule).toBe(2);
    expect(colonnes.debutContrat).toBe(3);
  });

  it('signale les colonnes qu’elle ne sait pas placer, sans s’en offusquer', () => {
    const { inconnues, manquantes } = correspondre(entetes);
    expect(inconnues).toEqual(['Salaire brut']);
    expect(manquantes).toEqual([]);
  });

  it('nomme les colonnes obligatoires absentes', () => {
    const { manquantes } = correspondre(['Prénom', 'Nom']);
    expect(manquantes).toEqual(['Matricule', 'Début du contrat']);
  });

  it('ne se fie pas à l’ordre : une colonne insérée ne décale rien', () => {
    const { colonnes } = correspondre([
      'Matricule',
      'Service',
      'Prénom',
      'Nom',
      'Début du contrat',
    ]);
    expect(colonnes.matricule).toBe(0);
    expect(colonnes.unite).toBe(1);
    expect(colonnes.prenom).toBe(2);
  });

  it('normaliserIntitule réduit au squelette comparable', () => {
    expect(normaliserIntitule('  Durée (mois)  ')).toBe('duree mois');
    expect(normaliserIntitule('N° Matricule')).toBe('n matricule');
  });
});

describe('fin d’un contrat à durée déterminée', () => {
  it('douze mois depuis le 20 mai 2024 s’achèvent le 19 mai 2025', () => {
    expect(finDeContrat('2024-05-20', 12)).toBe('2025-05-19');
  });

  it('trois mois depuis le 3 février 2025 s’achèvent le 2 mai 2025', () => {
    expect(finDeContrat('2025-02-03', 3)).toBe('2025-05-02');
  });

  it('un mois depuis le 31 janvier ne déborde pas sur mars', () => {
    // 31 janvier + 1 mois = 28 février (dernier jour atteint), veille = 27.
    expect(finDeContrat('2025-01-31', 1)).toBe('2025-02-27');
  });

  it('franchit une année bissextile sans dériver', () => {
    expect(finDeContrat('2023-03-01', 12)).toBe('2024-02-29');
  });
});

describe('conversion d’une ligne', () => {
  const ENTETES = [
    'Prénom',
    'Nom',
    'Sexe',
    'Situation matrimoniale',
    'Date de naissance',
    'Pays de naissance',
    "Pièce d'identité",
    'Numéro de la pièce',
    "Date d'expiration",
    'Indicatif téléphone',
    'Téléphone',
    'Email personnel',
    'Matricule',
    'Type de contrat',
    'Début du contrat',
    'Durée (mois)',
    'Poste',
    'Direction affectée',
  ];
  const { colonnes } = correspondre(ENTETES);
  const ligne = (valeurs: Record<string, unknown>): unknown[] =>
    ENTETES.map((e) => valeurs[e] ?? null);

  const complete = {
    Prénom: 'Moussa',
    Nom: 'Diop',
    Sexe: 'Homme',
    'Situation matrimoniale': 'Marié',
    'Date de naissance': new Date(Date.UTC(1990, 3, 12, 12)),
    'Pays de naissance': 'Sénégal',
    "Pièce d'identité": "Carte Nationale d'Identité",
    'Numéro de la pièce': '1199019012345',
    "Date d'expiration": new Date(Date.UTC(2099, 5, 1, 12)),
    'Indicatif téléphone': '+221',
    Téléphone: '77 512 34 56',
    'Email personnel': 'moussa.diop@gmail.com',
    Matricule: 'APIX-0001',
    'Type de contrat': 'CDI',
    'Début du contrat': new Date(Date.UTC(2023, 0, 9, 12)),
    Poste: 'Analyste de données',
    'Direction affectée': 'DIPE',
  };

  it('traduit les vocabulaires du fichier en ceux du produit', () => {
    const r = convertirLigne(ligne(complete) as never, colonnes);
    expect('ok' in r).toBe(true);
    if (!('ok' in r)) return;
    expect(r.ok.entree.person.gender).toBe('male');
    expect(r.ok.entree.person.maritalStatus).toBe('married');
    expect(r.ok.entree.person.idDocumentType).toBe('cni');
    expect(r.ok.entree.contract?.contractType).toBe('cdi');
    expect(r.ok.entree.person.birthDate).toBe('1990-04-12');
    expect(r.ok.uniteAbrege).toBe('DIPE');
  });

  it('compose le téléphone comme la saisie manuelle, en E.164', () => {
    const r = convertirLigne(ligne(complete) as never, colonnes);
    if (!('ok' in r)) throw new Error('attendu convertible');
    expect(r.ok.entree.person.phone).toBe('+221775123456');
  });

  it('garde le zéro de tête là où le pays l’exige (Côte d’Ivoire)', () => {
    const r = convertirLigne(
      ligne({ ...complete, 'Indicatif téléphone': '+225', Téléphone: '07 12 34 56 78' }) as never,
      colonnes,
    );
    if (!('ok' in r)) throw new Error('attendu convertible');
    expect(r.ok.entree.person.phone).toBe('+2250712345678');
  });

  it('écrit le pays avec l’apostrophe du produit, pas celle du fichier', () => {
    const r = convertirLigne(
      ligne({ ...complete, 'Pays de naissance': "Côte d'Ivoire" }) as never,
      colonnes,
    );
    if (!('ok' in r)) throw new Error('attendu convertible');
    // Intl écrit « Côte d’Ivoire » avec l'apostrophe typographique : sans
    // normalisation, une fiche importée et une fiche saisie différeraient.
    expect(r.ok.entree.person.birthPlace).toBe('Côte d’Ivoire');
  });

  it('déduit la fin d’un CDD de sa durée', () => {
    const r = convertirLigne(
      ligne({
        ...complete,
        'Type de contrat': 'CDD',
        'Début du contrat': new Date(Date.UTC(2024, 4, 20, 12)),
        'Durée (mois)': 12,
      }) as never,
      colonnes,
    );
    if (!('ok' in r)) throw new Error('attendu convertible');
    expect(r.ok.entree.contract?.endDate).toBe('2025-05-19');
  });

  it('lit une date écrite à la main au format du pays', () => {
    const r = convertirLigne(
      ligne({ ...complete, 'Date de naissance': '12/04/1990' }) as never,
      colonnes,
    );
    if (!('ok' in r)) throw new Error('attendu convertible');
    expect(r.ok.entree.person.birthDate).toBe('1990-04-12');
  });

  for (const [cas, modif, motif, colonne] of [
    ['sans matricule', { Matricule: null }, /matricule manque/i, 'Matricule'],
    ['sans prénom', { Prénom: null }, /prénom manque/i, 'Prénom'],
    ['sans date de début', { 'Début du contrat': null }, /date de début/i, 'Début du contrat'],
    ['au sexe illisible', { Sexe: 'H' }, /ni Homme ni Femme/i, 'Sexe'],
    [
      'à la situation inconnue',
      { 'Situation matrimoniale': 'Pacsé' },
      /ne se comprend pas/i,
      'Situation matrimoniale',
    ],
    [
      'au numéro de pièce sans type',
      { "Pièce d'identité": null },
      /sans son type/i,
      "Pièce d'identité",
    ],
    [
      'à la pièce expirée',
      { "Date d'expiration": new Date(Date.UTC(2020, 0, 1, 12)) },
      /expirée/i,
      "Date d'expiration",
    ],
    ['au pays inconnu', { 'Pays de naissance': 'Wakanda' }, /Pays inconnu/i, 'Pays de naissance'],
    [
      'à la date illisible',
      { 'Date de naissance': '32/13/1990' },
      /pas une date/i,
      'Date de naissance',
    ],
    [
      'à l’email malformé',
      { 'Email personnel': 'moussa.diop' },
      /adresse email/i,
      'Email personnel',
    ],
    ['à la durée sur un CDI', { 'Durée (mois)': 12 }, /CDI ne prend pas de durée/i, 'Durée (mois)'],
  ] as [string, Record<string, unknown>, RegExp, string][]) {
    it(`refuse une ligne ${cas}, en nommant la colonne`, () => {
      const r = convertirLigne(ligne({ ...complete, ...modif }) as never, colonnes);
      expect('refus' in r).toBe(true);
      if (!('refus' in r)) return;
      expect(r.refus.motif).toMatch(motif);
      expect(r.refus.colonne).toBe(colonne);
    });
  }

  it('accepte une ligne réduite au strict nécessaire', () => {
    const r = convertirLigne(
      ligne({
        Prénom: 'Awa',
        Nom: 'Ndiaye',
        Matricule: 'APIX-0002',
        'Début du contrat': '2022-03-14',
      }) as never,
      colonnes,
    );
    expect('ok' in r).toBe(true);
    if (!('ok' in r)) return;
    expect(r.ok.entree.employee.hiredOn).toBe('2022-03-14');
    expect(r.ok.entree.contract).toBeUndefined();
    expect(r.ok.entree.assignment).toBeUndefined();
    expect(r.ok.uniteAbrege).toBeNull();
  });
});
