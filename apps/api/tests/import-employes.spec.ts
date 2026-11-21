import { describe, expect, it } from 'vitest';
import type { CelluleXlsx } from '../src/common/xlsx';
import { lirePremiereFeuille, XlsxIllisible } from '../src/common/xlsx';
import {
  CHAMPS_DE_LA_REMUNERATION,
  colonnesRemplies,
  correspondre,
  designeLaDirection,
  lireLigne,
  natureDuPoste,
  nomDUnite,
  type LigneLue,
} from '../src/modules/people/import-employes';
import {
  accorderAuGenre,
  cleDeNom,
  entreeDepuisAnciennete,
  intitule,
  lireBanque,
  lireCni,
  lireContrat,
  lireCourrielPro,
  lireDate,
  lireFiliation,
  lireLien,
  lireMontant,
  lireParts,
  lirePays,
  lireRegion,
  lireRib,
  lireSexe,
  lireSituation,
  lireStatut,
  lireTelephone,
  nomDePersonne,
  nomDeVille,
} from '../src/modules/people/import-valeurs';
import { classeur } from './fabrique-xlsx';

/* ────────────────────────────────────────────────────────────────
   L'import du fichier du personnel de la DCH (ADR-0159) : la lecture.

   Ici, ce que la plateforme comprend du fichier, sans toucher à la base :
   les intitulés, les valeurs corrigées, les lignes refusées. L'écriture des
   dossiers a son propre fichier, `import-service.spec.ts`.
   ──────────────────────────────────────────────────────────────── */

const AUJOURDHUI = '2026-11-02';

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
          `<c r="A1" s="1" t="n"><v>32975</v></c>` +
          `<c r="B1" s="2" t="n"><v>32975</v></c>` +
          `<c r="C1" s="0" t="n"><v>32975</v></c>` +
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

  it('ne laisse pas une cellule vide en balise courte avaler la suivante', () => {
    const f = lirePremiereFeuille(
      classeur(
        `<sheetData><row r="1">` +
          `<c r="A1" t="inlineStr"><is><t>a</t></is></c>` +
          `<c r="B1" s="3"/>` +
          `<c r="C1" t="inlineStr"/>` +
          `<c r="D1" t="inlineStr"><is><t>d</t></is></c>` +
          `</row></sheetData>`,
      ),
    );
    expect(f.lignes[0]).toEqual(['a', null, '', 'd']);
  });

  it('garde le numéro des lignes : une ligne omise ou vide ne décale pas les suivantes', () => {
    const f = lirePremiereFeuille(
      classeur(
        `<sheetData>` +
          `<row r="1"><c r="A1" t="inlineStr"><is><t>un</t></is></c></row>` +
          `<row r="2" spans="1:3"/>` +
          `<row r="4"><c r="A4" t="inlineStr"><is><t>quatre</t></is></c></row>` +
          `</sheetData>`,
      ),
    );
    expect(f.lignes).toEqual([['un'], [], [], ['quatre']]);
  });

  it('refuse ce qui n’est pas une archive', () => {
    expect(() => lirePremiereFeuille(Buffer.from('ceci est un csv;pas un xlsx'))).toThrow(
      XlsxIllisible,
    );
  });
});

/** Les soixante intitulés du fichier de la DCH, tels qu'il les écrit. */
export const ENTETES_DCH = [
  'N°',
  'Matricule',
  'Prénom',
  'Nom',
  'Nom complet',
  'Sexe',
  'Âge',
  'Date de naissance',
  'Lieu de naissance',
  'Pays',
  'Fils/Fille',
  'Nationalité',
  'Numero CNI',
  'Situation Matrimoniale',
  "Nom de l'épouse 1",
  "Nom de l'épouse 2",
  "Nom de l'épouse 3",
  "Nom de l'épouse 4",
  "Nombre d'épouse ",
  "Nombre d'enfants",
  'Adresse mail personnel ',
  'Adresse mail professionnel ',
  'Numéro de tel personnel',
  'Numero de tel professionnel',
  'Adresse physique',
  'Ville',
  'Region ',
  "Personne à contacter en cas d'urgence",
  "Numero Tel de la personne à contacter en cas d'urgence",
  'Lien de parenté avec le contact',
  'Poste occupé ',
  'Responsable Hierarchique\n(N+1)',
  'Responsable Fonctionnel',
  'Statut',
  'Direction',
  'Département ',
  'Lieu de travail',
  'Projet',
  'Type de contrat',
  "Date d'entrée",
  'Date de fin (si CDD)',
  'Date de sortie',
  'Motif de sortie',
  'Ancienneté (années)',
  'Catégorie socio -professionnelle',
  'Salaire de base ',
  'Sursalaire ',
  "Prime d'ancienneté",
  'Brut social',
  'Prime de transport',
  'Salaire brut',
  'Nombre de part Sociale',
  'Carburant ',
  'Forfait Téléphone',
  'Indemnités de sujetion',
  'Autres avantages',
  'Banque',
  "Relevé d'Identité Bancaire",
  'Domiciliation',
  'Numero IPRES',
];

describe('les intitulés du fichier de la DCH', () => {
  it('reconnaît les soixante colonnes, espaces, retours à la ligne et accents compris', () => {
    const r = correspondre(ENTETES_DCH);
    expect(r.inconnues).toEqual([]);
    expect(r.manquantes).toEqual([]);
    expect(r.colonnes.n1).toBe(31);
    expect(r.colonnes.categorie).toBe(44);
    expect(r.intitules.region).toBe('Region');
  });

  it('reconnaît la filiation, la rémunération, la banque et l’IPRES', () => {
    const place = (h: string) => ENTETES_DCH.indexOf(h);
    expect(correspondre(ENTETES_DCH).colonnes).toMatchObject({
      filiation: place('Fils/Fille'),
      salaireDeBase: place('Salaire de base '),
      primeAnciennete: place("Prime d'ancienneté"),
      primeTransport: place('Prime de transport'),
      nombreDeParts: place('Nombre de part Sociale'),
      indemniteSujetion: place('Indemnités de sujetion'),
      rib: place("Relevé d'Identité Bancaire"),
      numeroIpres: place('Numero IPRES'),
    });
  });

  it('nomme les colonnes de la rémunération que le fichier remplit, « NA » compté pour vide', () => {
    const corr = correspondre(ENTETES_DCH);
    const ligne = ENTETES_DCH.map((h) =>
      h === 'Banque' ? 'CBAO' : h === 'Sursalaire ' ? 'NA' : null,
    );
    expect(colonnesRemplies(corr, [ligne], CHAMPS_DE_LA_REMUNERATION)).toEqual(['Banque']);
    expect(colonnesRemplies(corr, [], CHAMPS_DE_LA_REMUNERATION)).toEqual([]);
  });

  it('accepte l’ancienneté à la place de la date d’entrée, pas l’absence des deux', () => {
    expect(correspondre(['Matricule', 'Prénom', 'Nom', 'Ancienneté']).manquantes).toEqual([]);
    expect(correspondre(['Matricule', 'Prénom']).manquantes).toEqual(['Nom', 'Date d’entrée']);
  });

  it('signale une colonne qu’elle ne sait pas placer', () => {
    expect(correspondre([...ENTETES_DCH, 'Groupe sanguin']).inconnues).toEqual(['Groupe sanguin']);
  });
});

describe('les dates', () => {
  it('lit le numéro de série d’Excel : 44452 est le 13 septembre 2021', () => {
    expect(lireDate(44452, AUJOURDHUI)).toEqual({
      valeur: { iso: '2021-09-13', auMois: false, interpretee: true },
      corrige: true,
    });
    expect(lireDate('44452', AUJOURDHUI)).toMatchObject({ valeur: { iso: '2021-09-13' } });
  });

  it('lit le texte au format d’ici, en lettres, et l’ISO', () => {
    expect(lireDate('13/09/2021', AUJOURDHUI)).toMatchObject({
      valeur: { iso: '2021-09-13' },
      corrige: false,
    });
    expect(lireDate('13-09-21', AUJOURDHUI)).toMatchObject({ valeur: { iso: '2021-09-13' } });
    expect(lireDate('1er octobre 2020', AUJOURDHUI)).toMatchObject({
      valeur: { iso: '2020-10-01' },
    });
    expect(lireDate('2021-09-13', AUJOURDHUI)).toMatchObject({ valeur: { iso: '2021-09-13' } });
  });

  it('remet à l’endroit un jour et un mois inversés, et le dit', () => {
    expect(lireDate('09/13/2021', AUJOURDHUI)).toMatchObject({
      valeur: { iso: '2021-09-13' },
      corrige: true,
    });
  });

  it('garde un mois seul comme tel, et refuse l’année seule', () => {
    expect(lireDate('09/2021', AUJOURDHUI)).toMatchObject({
      valeur: { iso: '2021-09-01', auMois: true },
    });
    expect(lireDate('sept. 2021', AUJOURDHUI)).toMatchObject({ valeur: { auMois: true } });
    expect(lireDate(2015, AUJOURDHUI)).toEqual({
      erreur: '« 2015 » : l’année seule ne suffit pas',
    });
    expect(lireDate('31/04/2021', AUJOURDHUI)).toHaveProperty('erreur');
  });

  it('lit le format jj-mmm-aa qu’Excel montre, en français ou en anglais', () => {
    expect(lireDate('01-mars-04', AUJOURDHUI)).toEqual({
      valeur: { iso: '2004-03-01', auMois: false, interpretee: false },
      corrige: false,
    });
    expect(lireDate('01-juil-26', AUJOURDHUI)).toMatchObject({ valeur: { iso: '2026-07-01' } });
    expect(lireDate('15-déc.-19', AUJOURDHUI)).toMatchObject({ valeur: { iso: '2019-12-15' } });
    expect(lireDate('12-mai-85', AUJOURDHUI)).toMatchObject({ valeur: { iso: '1985-05-12' } });
    expect(lireDate('01-Mar-04', AUJOURDHUI)).toMatchObject({ valeur: { iso: '2004-03-01' } });
    expect(lireDate('mars-04', AUJOURDHUI)).toMatchObject({
      valeur: { iso: '2004-03-01', auMois: true },
    });
    expect(lireDate('31-avr.-04', AUJOURDHUI)).toHaveProperty('erreur');
  });

  it('lit un montant en francs CFA, séparateurs et unité compris', () => {
    expect(lireMontant(26000)).toEqual({ valeur: 26000, corrige: false });
    expect(lireMontant('26 000')).toMatchObject({ valeur: 26000 });
    expect(lireMontant('26.000 FCFA')).toMatchObject({ valeur: 26000 });
    expect(lireMontant('26000 F CFA')).toMatchObject({ valeur: 26000 });
    expect(lireMontant('0')).toMatchObject({ valeur: 0 });
    expect(lireMontant('vingt mille')).toEqual({ erreur: '« vingt mille » n’est pas un montant' });
    expect(lireMontant('-5')).toHaveProperty('erreur');
  });

  it('déduit de l’ancienneté le mois d’entrée, pas le jour', () => {
    expect(entreeDepuisAnciennete(5.1, AUJOURDHUI)).toBe('2021-10-01');
    expect(entreeDepuisAnciennete(0.5, AUJOURDHUI)).toBe('2026-05-01');
    expect(entreeDepuisAnciennete(1.8, AUJOURDHUI)).toBe('2025-01-01');
  });
});

describe('les numéros', () => {
  it('écrit tout numéro sénégalais avec +221', () => {
    for (const n of [
      '771234567',
      '77 123 45 67',
      '+221 77 123 45 67',
      '00221771234567',
      771234567,
    ]) {
      expect(lireTelephone(n)).toMatchObject({ valeur: '+221771234567' });
    }
    expect(lireTelephone('33 812 34 56')).toMatchObject({ valeur: '+221338123456' });
  });

  it('refuse un numéro sénégalais qui n’a pas 9 chiffres commençant par 7 ou 3', () => {
    expect(lireTelephone('77123456')).toEqual({
      erreur: 'Numéro sénégalais : 9 chiffres, commençant par 7 ou 3',
    });
    expect(lireTelephone('571234567')).toHaveProperty('erreur');
  });

  it('garde un numéro étranger valide, et le premier de deux numéros', () => {
    expect(lireTelephone('+33 6 12 34 56 78')).toMatchObject({ valeur: '+33612345678' });
    expect(lireTelephone('77 123 45 67 / 76 987 65 43')).toEqual({
      valeur: '+221771234567',
      corrige: true,
    });
  });

  it('veut 13 chiffres pour la CNI, et dit combien il y en a', () => {
    expect(lireCni('1 751 1990 01234')).toEqual({ valeur: '1751199001234', corrige: false });
    expect(lireCni(1751199001234)).toMatchObject({ valeur: '1751199001234' });
    expect(lireCni('175119900123')).toEqual({ erreur: 'Numéro CNI à 12 chiffres au lieu de 13' });
  });

  it('corrige le domaine d’une adresse professionnelle, et refuse un autre domaine', () => {
    expect(lireCourrielPro('A.Diop@APIX.SN')).toEqual({ valeur: 'a.diop@apix.sn', corrige: false });
    expect(lireCourrielPro('a.diop@apix.com')).toEqual({ valeur: 'a.diop@apix.sn', corrige: true });
    expect(lireCourrielPro('a.diop@gmail.com')).toEqual({
      erreur: 'L’adresse professionnelle doit se terminer par @apix.sn',
    });
  });
});

describe('les listes de valeurs', () => {
  it('ramène la région à l’une des quatorze, fautes et abréviations comprises', () => {
    expect(lireRegion('St Louis')).toEqual({ valeur: 'saint_louis', corrige: true });
    expect(lireRegion('St-Louis')).toEqual({ valeur: 'saint_louis', corrige: true });
    expect(lireRegion('SAINT LOUIS')).toEqual({ valeur: 'saint_louis', corrige: false });
    expect(lireRegion('Ziginchor')).toEqual({ valeur: 'ziguinchor', corrige: true });
    expect(lireRegion('THIES')).toEqual({ valeur: 'thies', corrige: false });
    expect(lireRegion('Rufisque')).toEqual({ valeur: 'dakar', corrige: true });
    expect(lireRegion('Dakar Plateau')).toEqual({ valeur: 'dakar', corrige: true });
    expect(lireRegion('Paris')).toHaveProperty('erreur');
  });

  it('lit Cadre et Non cadre sous toutes leurs écritures', () => {
    for (const s of ['non cadre', 'Non-Cadre', 'NON CADRE', 'noncadre']) {
      expect(lireStatut(s)).toEqual({ valeur: 'non_cadre', corrige: false });
    }
    expect(lireStatut('CADRE')).toEqual({ valeur: 'cadre', corrige: false });
    expect(lireStatut('non carde')).toEqual({ valeur: 'non_cadre', corrige: true });
    expect(lireStatut('Agent de maîtrise')).toHaveProperty('erreur');
  });

  it('lit le sexe en M, F ou H, et la situation matrimoniale', () => {
    expect(lireSexe('M')).toMatchObject({ valeur: 'male' });
    expect(lireSexe('h')).toMatchObject({ valeur: 'male' });
    expect(lireSexe('F')).toMatchObject({ valeur: 'female' });
    expect(lireSexe('X')).toHaveProperty('erreur');
    expect(lireSituation('célib')).toEqual({ valeur: 'single', corrige: false });
    expect(lireSituation('MARIE(E)')).toEqual({ valeur: 'married', corrige: false });
    expect(lireSituation('divorcée')).toEqual({ valeur: 'divorced', corrige: false });
    expect(lireSituation('veuv')).toEqual({ valeur: 'widowed', corrige: true });
  });

  it('n’importe que les CDD et les CDI', () => {
    expect(lireContrat('C.D.I')).toEqual({ valeur: 'cdi', corrige: false });
    expect(lireContrat('Contrat à durée déterminée')).toEqual({ valeur: 'cdd', corrige: false });
    expect(lireContrat('Stage')).toEqual({
      erreur: '« Stage » : seuls les CDD et les CDI s’importent',
    });
  });

  it('range le lien de parenté dans la liste, et signale ce qu’elle a traduit', () => {
    expect(lireLien('AMI')).toEqual({ valeur: 'ami', corrige: false });
    expect(lireLien('EPOUSE')).toEqual({ valeur: 'conjoint', corrige: true });
    expect(lireLien('Oncle')).toEqual({ valeur: 'autre', corrige: true });
  });

  it('prend le pays dans la liste de la plateforme', () => {
    expect(lirePays('SENEGAL')).toEqual({ valeur: 'Sénégal', corrige: false });
    expect(lirePays('Sénégalaise')).toEqual({ valeur: 'Sénégal', corrige: true });
    expect(lirePays('COTE D IVOIRE')).toMatchObject({ valeur: 'Côte d’Ivoire' });
    expect(lirePays('Wakanda')).toHaveProperty('erreur');
  });
});

describe('les noms et les intitulés', () => {
  it('écrit un nom tout en capitales comme on l’écrit à la main', () => {
    expect(nomDePersonne('NDEYE FATOU')).toBe('Ndeye Fatou');
    expect(nomDePersonne("N'DIAYE")).toBe("N'Diaye");
    expect(nomDePersonne('BA-SECK')).toBe('Ba-Seck');
    expect(nomDePersonne('Ndèye')).toBe('Ndèye');
  });

  it('remet les accents d’une ville connue', () => {
    expect(nomDeVille('THIES')).toEqual({ valeur: 'Thiès', corrige: false });
    expect(nomDeVille('ST LOUIS')).toEqual({ valeur: 'Saint-Louis', corrige: true });
    expect(nomDeVille('NIORO DU RIP')).toEqual({ valeur: 'Nioro du Rip', corrige: false });
    expect(nomDeVille('BAMAKO')).toEqual({ valeur: 'Bamako', corrige: false });
  });

  it('écrit un intitulé de poste avec ses accents et ses sigles', () => {
    expect(intitule("CHARGE D'ETUDES")).toBe("Chargé d'études");
    expect(intitule('ASSISTANTE DE DIRECTION')).toBe('Assistante de direction');
    expect(intitule('RESPONSABLE IT')).toBe('Responsable IT');
    expect(intitule('AGENT DE SECURITE DE LA DFC', new Set(['DFC']))).toBe(
      'Agent de sécurité de la DFC',
    );
    expect(intitule('Assistante de direction')).toBe('Assistante de direction');
  });

  it('nomme une unité à créer', () => {
    expect(nomDUnite('department', 'digitalisation')).toBe('Département Digitalisation');
    expect(nomDUnite('service', 'qualite')).toBe('Service Qualité');
    expect(nomDUnite('department', 'etudes et strategies')).toBe(
      'Département Études et stratégies',
    );
  });

  it('nomme une unité sans faute : accents, apostrophe, sigle, faute de frappe', () => {
    expect(nomDUnite('department', 'COMPETITIVITE ET INNOVATION')).toBe(
      'Département Compétitivité et innovation',
    );
    expect(nomDUnite('department', 'RESPONSABILITE SOCIETALE D ENTREPRISE')).toBe(
      'Département Responsabilité sociétale d’entreprise',
    );
    expect(nomDUnite('department', 'INGENIERIE URBAINE ET FONCIERE')).toBe(
      'Département Ingénierie urbaine et foncière',
    );
    expect(nomDUnite('department', 'MOYENS GENEREAUX')).toBe('Département Moyens généraux');
    expect(nomDUnite('department', 'PORTEFEUILLLE ET RECOUVREMENT')).toBe(
      'Département Portefeuille et recouvrement',
    );
    expect(nomDUnite('department', 'COURRIER, DOCUMENTATION ET ARCHIVAGE')).toBe(
      'Département Courrier, documentation et archivage',
    );
    expect(nomDUnite('service', 'COMPTABILITE ETAT')).toBe('Service Comptabilité État');
    expect(nomDUnite('service', 'ETATS FINANCIERS')).toBe('Service États financiers');
    expect(nomDUnite('service', 'SUIVI DES INVESTISSEMENTS PRIVES')).toBe(
      'Service Suivi des investissements privés',
    );
    expect(nomDUnite('service', 'BCE')).toBe('Service BCE');
  });

  it('corrige une faute de frappe sur un mot connu, sans toucher au pluriel ni au féminin', () => {
    expect(intitule('ADMINSTRATION DU PERSONNEL')).toBe('Administration du personnel');
    expect(intitule('CHARGE DU RECOUVREMMENT')).toBe('Chargé du recouvrement');
    expect(intitule('ZONES URBAINES')).toBe('Zones urbaines');
    expect(intitule('CONSEILLERS FINANCIERS')).toBe('Conseillers financiers');
    expect(intitule('CONTROLEURS DE GESTION')).toBe('Contrôleurs de gestion');
    // Une faute dans les deux dernières lettres reste : le pluriel s'y écrit.
    expect(intitule('RECOUVREMEN')).toBe('Recouvremen');
  });

  it('écrit sans faute les intitulés du fichier de la DCH', () => {
    // Sigles courts, abréviations, « à » et « des » écornés.
    expect(intitule("CHARGE D'APPUI AU PROJET TER")).toBe("Chargé d'appui au projet TER");
    expect(intitule("CHARGE D'APPUI A LA CREATION D'ENTREPRISE")).toBe(
      "Chargé d'appui à la création d'entreprise",
    );
    expect(intitule('CHARGE DES SYST. ELEC DE GESTION DES MARCHES PCS.')).toBe(
      'Chargé des systèmes électroniques de gestion des marchés PCS',
    );
    expect(intitule('CHEF  DEPART. TECHNIQUE')).toBe('Chef du département technique');
    expect(intitule("DIRECTEUR DU GUICHET UNIQUE ET ES PLATEFORMES LOCALES D'INVESTISSEMENT")).toBe(
      "Directeur du guichet unique et des plateformes locales d'investissement",
    );
    expect(intitule('PMO - CHARGE DE MISSION DG')).toBe('PMO - chargé de mission DG');
    expect(intitule('CONSEILLER SPECIAL COORDONNATEUR SPV APIX.SA')).toBe(
      'Conseiller spécial coordonnateur SPV APIX SA',
    );
    // Fautes de frappe et accents.
    expect(intitule('ASISTANT RH')).toBe('Assistant RH');
    expect(intitule('INGENEUR ELECTRIQUE')).toBe('Ingénieur électrique');
    expect(intitule("COORDONNATEUR PLATEFORME LOCALE D'INVESTISSMENT DE SALY")).toBe(
      "Coordonnateur plateforme locale d'investissement de Saly",
    );
    expect(intitule('CHEF DE MARCHE PETROLE ET GAZ')).toBe('Chef de marché pétrole et gaz');
    // Lieux, et sigles de plus de trois lettres.
    expect(intitule('COORDONNATUR PLI SAINT LOUIS')).toBe('Coordonnateur PLI Saint-Louis');
    expect(intitule('COORDONNATEUR PLI SUD')).toBe('Coordonnateur PLI Sud');
    expect(intitule('COORDONNATEUR ZFID')).toBe('Coordonnateur ZFID');
    // Une seule façon d'écrire une même expression.
    expect(intitule('ASSISTANT PASSATION MARCHES')).toBe('Assistant passation des marchés');
    expect(intitule('SPECIALISTE EN PASSATION DE MARCHES')).toBe(
      'Spécialiste en passation des marchés',
    );
    expect(intitule('CONSEILLER TECHNIQUE CHARGE  DE RELATION PRESSE')).toBe(
      'Conseiller technique chargé de relations presse',
    );
    expect(intitule('CHAUFFEUR COURSIER')).toBe('Chauffeur-coursier');
    expect(intitule("CHARGE D'INSTRUCTION BACK OFFICE")).toBe("Chargé d'instruction back-office");
    expect(intitule('CHEF BUREAU REGIONAL KAOLACK')).toBe('Chef du bureau régional de Kaolack');
    expect(intitule('CHEF SERVICE LOGISTIQUE')).toBe('Chef du service logistique');
    // La lettre d'une catégorie reste une lettre.
    expect(intitule('CADRE DE CATEGORIE A')).toBe('Cadre de catégorie A');
  });

  it('accorde l’intitulé au genre de la personne, « Agent » excepté', () => {
    expect(accorderAuGenre('Assistant RH', 'female')).toBe('Assistante RH');
    expect(accorderAuGenre('Assistante administrative', 'male')).toBe('Assistant administratif');
    expect(accorderAuGenre('Conseiller spécial coordonnateur SPV APIX SA', 'female')).toBe(
      'Conseillère spéciale coordonnatrice SPV APIX SA',
    );
    expect(accorderAuGenre('Ingénieur financier', 'female')).toBe('Ingénieure financière');
    expect(accorderAuGenre("Opérateur d'images monteur", 'female')).toBe(
      "Opératrice d'images monteuse",
    );
    expect(accorderAuGenre('Agent administratif', 'female')).toBe('Agent administratif');
    // Ce qui suit « de » parle d'autre chose que de la personne.
    expect(accorderAuGenre('Assistant du directeur général', 'female')).toBe(
      'Assistante du directeur général',
    );
    expect(accorderAuGenre('Chef de marché financier', 'female')).toBe(
      'Cheffe de marché financier',
    );
    expect(accorderAuGenre('Ingénieur génie civil', 'female')).toBe('Ingénieure génie civil');
    // Sans genre connu, la majorité des mots de l'intitulé décide.
    expect(accorderAuGenre('Conseiller spéciale chargée des nouveaux projets', null)).toBe(
      'Conseillère spéciale chargée des nouveaux projets',
    );
    expect(accorderAuGenre("Chargé d'études", null)).toBe("Chargé d'études");
  });

  it('garde les villes, les chiffres romains et l’apostrophe perdue', () => {
    expect(intitule('CHEF DE PROJET ZES DIASS')).toBe('Chef de projet ZES Diass');
    expect(intitule('AGENT DE NIVEAU III')).toBe('Agent de niveau III');
    expect(intitule('AGENT D ACCUEIL')).toBe('Agent d’accueil');
    expect(intitule("CHARGE D'ETUDES")).toBe("Chargé d'études");
  });

  it('reconnaît un nom écrit dans l’autre sens, ou avec sa civilité', () => {
    expect(cleDeNom('DIOP Awa')).toBe(cleDeNom('Awa Diop'));
    expect(cleDeNom('Mme Awa DIOP')).toBe(cleDeNom('Awa Diop'));
  });
});

describe('ce que dit le poste', () => {
  it('reconnaît les chefs de département et de service, avec le nom de l’unité', () => {
    expect(natureDuPoste('CHEF DE DEPARTEMENT DIGITALISATION')).toEqual({
      nature: 'chef',
      type: 'department',
      nom: 'DIGITALISATION',
    });
    expect(natureDuPoste('CHEF DE SERVICE QUALITE')).toEqual({
      nature: 'chef',
      type: 'service',
      nom: 'QUALITE',
    });
    expect(natureDuPoste('Cheffe du service des moyens généraux')).toEqual({
      nature: 'chef',
      type: 'service',
      nom: 'moyens généraux',
    });
    expect(natureDuPoste('CHEF DE SERVICE')).toEqual({
      nature: 'chef',
      type: 'service',
      nom: null,
    });
  });

  it('prend le nom de l’unité tel que le fichier l’écrit, sans second rôle ni intérim', () => {
    expect(natureDuPoste('CHEF DU DEPARTEMENT COURRIER, DOCUMENTATION ET ARCHIVAGE')).toEqual({
      nature: 'chef',
      type: 'department',
      nom: 'COURRIER, DOCUMENTATION ET ARCHIVAGE',
    });
    expect(natureDuPoste('CHEF DU DEPARTEMENT AMENAGEMENT ET CHEF DE PROJET ZES DIASS')).toEqual({
      nature: 'chef',
      type: 'department',
      nom: 'AMENAGEMENT',
    });
    expect(natureDuPoste('CHEF DU SERVICE LOGISTIQUE PAR INTERIM')).toEqual({
      nature: 'chef',
      type: 'service',
      nom: 'LOGISTIQUE',
    });
    expect(natureDuPoste('CHEF DU SERVICE QUALITE (DQSE)')).toEqual({
      nature: 'chef',
      type: 'service',
      nom: 'QUALITE',
    });
  });

  it('reconnaît le poste malgré une faute ou une abréviation', () => {
    expect(natureDuPoste('CHEF DE DPARTEMENT INTELLIGENCE ECONOMIQUE')).toEqual({
      nature: 'chef',
      type: 'department',
      nom: 'INTELLIGENCE ECONOMIQUE',
    });
    expect(natureDuPoste('CHEF  DEPART. TECHNIQUE')).toEqual({
      nature: 'chef',
      type: 'department',
      nom: 'TECHNIQUE',
    });
    // « Services » n'est pas une faute pour « service ».
    expect(natureDuPoste('CHEF DU DEPARTEMENT SERVICES AUX INVESTISSEURS')).toEqual({
      nature: 'chef',
      type: 'department',
      nom: 'SERVICES AUX INVESTISSEURS',
    });
    const guichet = natureDuPoste(
      "DIRECTEUR DU GUICHET UNIQUE ET ES PLATEFORMES LOCALES D'INVESTISSEMENT",
    );
    expect(guichet).toMatchObject({ nature: 'directeur' });
    expect(
      designeLaDirection(guichet.nature === 'directeur' ? guichet.precision : null, {
        nom: 'Direction du Guichet Unique et des Plateformes Locales d’Investissement',
        sigle: 'DGUPLI',
      }),
    ).toBe(true);
  });

  it('reconnaît le DG, le DGA, les directeurs, et laisse les adjoints à leur poste', () => {
    expect(natureDuPoste('DIRECTEUR GENERAL')).toEqual({ nature: 'dg' });
    expect(natureDuPoste('DIRECTRICE GENERALE ADJOINTE')).toEqual({ nature: 'dga' });
    expect(natureDuPoste('DIRECTEUR FINANCIER ET COMPTABLE ')).toEqual({
      nature: 'directeur',
      precision: 'financier comptable',
    });
    expect(natureDuPoste('CHEF DE SERVICE ADJOINT QUALITE')).toEqual({ nature: 'agent' });
    expect(natureDuPoste('ASSISTANTE DE DIRECTION')).toEqual({ nature: 'agent' });
  });

  it('ne fait un directeur que de qui nomme sa direction', () => {
    const dfc = { nom: 'Direction Financière et Comptable', sigle: 'DFC' };
    expect(designeLaDirection('financier comptable', dfc)).toBe(true);
    expect(designeLaDirection('financier', dfc)).toBe(true);
    expect(designeLaDirection('dfc', dfc)).toBe(true);
    expect(designeLaDirection(null, dfc)).toBe(true);
    expect(designeLaDirection('projet', dfc)).toBe(false);
  });
});

/* ─────────────────────── Une ligne entière ─────────────────────── */

const CORR = correspondre(ENTETES_DCH);
const contexte = { aujourdhui: AUJOURDHUI, sigles: new Set(['DFC', 'DCH', 'DSID']) };
const ligne = (v: Record<string, CelluleXlsx>) => ENTETES_DCH.map((h) => v[h] ?? null);
const lire = (v: Record<string, CelluleXlsx>) => lireLigne(7, ligne(v), CORR, contexte);
const lue = (v: Record<string, CelluleXlsx>): LigneLue => {
  const r = lire(v);
  if (!('ok' in r)) throw new Error(`ligne refusée : ${r.refus.motif}`);
  return r.ok;
};

const MOUSSA: Record<string, CelluleXlsx> = {
  'N°': 1,
  Matricule: 'apix-0123',
  Prénom: 'MOUHAMADOU MOUSTAPHA',
  Nom: 'NDIAYE',
  'Nom complet': 'MOUHAMADOU MOUSTAPHA NDIAYE',
  Sexe: 'M',
  Âge: 41,
  'Date de naissance': 31213,
  'Lieu de naissance': 'THIES',
  Pays: 'SENEGAL',
  Nationalité: 'Sénégalaise',
  'Numero CNI': '1 751 1985 01234',
  'Situation Matrimoniale': 'MARIE',
  "Nom de l'épouse 1": 'FATOU SARR',
  "Nom de l'épouse 2": 'AIDA SOW',
  "Nombre d'épouse ": 2,
  "Nombre d'enfants": 3,
  'Adresse mail personnel ': 'Moussa.Ndiaye@Gmail.com',
  'Adresse mail professionnel ': 'm.ndiaye@apix.sn',
  'Numéro de tel personnel': '77 123 45 67',
  'Numero de tel professionnel': 338123456,
  'Adresse physique': 'CITE KEUR GORGUI VILLA 12',
  Ville: 'DAKAR',
  'Region ': 'Dakar',
  "Personne à contacter en cas d'urgence": 'AWA SARR',
  "Numero Tel de la personne à contacter en cas d'urgence": '+221 76 987 65 43',
  'Lien de parenté avec le contact': 'MERE',
  'Poste occupé ': "CHARGE D'ETUDES",
  'Responsable Hierarchique\n(N+1)': 'AWA DIOP',
  'Responsable Fonctionnel': 'OUSMANE FALL',
  Statut: 'Non Cadre',
  Direction: 'DCH',
  'Lieu de travail': 'Siège',
  Projet: 'Guichet unique',
  'Type de contrat': 'CDI',
  "Date d'entrée": 44452,
  'Ancienneté (années)': 5.1,
  'Catégorie socio -professionnelle': '5B',
};

describe('une ligne du fichier', () => {
  it('donne une fiche complète, avec ses noms et ses numéros écrits comme la fiche les écrit', () => {
    const l = lue(MOUSSA);
    expect(l.matricule).toBe('APIX-0123');
    expect(l.prenom).toBe('Mouhamadou Moustapha');
    expect(l.nom).toBe('Ndiaye');
    expect(l.entree).toEqual({ iso: '2021-09-13', auMois: false });
    expect(l.personne).toEqual({
      gender: 'male',
      birthDate: '1985-06-15',
      birthPlace: 'Sénégal',
      lieuDeNaissance: 'Thiès',
      nationalId: '1751198501234',
      idDocumentType: 'cni',
      maritalStatus: 'married',
      epouses: ['Fatou Sarr', 'Aida Sow'],
      nombreEnfants: 3,
      personalEmail: 'moussa.ndiaye@gmail.com',
      phone: '+221771234567',
      addressLine: 'Cité Keur Gorgui Villa 12',
      ville: 'Dakar',
      region: 'dakar',
      emergencyContactName: 'Awa Sarr',
      emergencyContactPhone: '+221769876543',
      lienContactUrgence: 'mere',
    });
    expect(l.emploi).toEqual({
      workEmail: 'm.ndiaye@apix.sn',
      workPhone: '+221338123456',
      personnel: 'non_cadre',
      lieuDeTravail: 'Siège',
      projet: 'Guichet unique',
      categorie: '5B',
    });
    expect(l.poste).toEqual({ intitule: "Chargé d'études", nature: { nature: 'agent' } });
    expect(l).toMatchObject({
      direction: 'DCH',
      contrat: { type: 'cdi', fin: null },
      n1: 'AWA DIOP',
      fonctionnel: 'OUSMANE FALL',
    });
    // Les dates gardées en nombres par Excel, lues et montrées ; l'ancienneté concorde.
    expect(l.corrections).toEqual([
      { colonne: "Date d'entrée", lu: '44452', retenu: '13/09/2021' },
      { colonne: 'Date de naissance', lu: '31213', retenu: '15/06/1985' },
    ]);
    expect(l.avertissements).toEqual([]);
  });

  it('refuse une ligne sans matricule, sans prénom ou sans nom, en nommant la colonne', () => {
    expect(lire({ ...MOUSSA, Matricule: null })).toMatchObject({
      refus: { motif: 'Le matricule manque', colonne: 'Matricule' },
    });
    expect(lire({ ...MOUSSA, Prénom: '  ' })).toMatchObject({
      refus: { motif: 'Le prénom manque', colonne: 'Prénom' },
    });
  });

  it('prend l’ancienneté quand la date d’entrée manque, au mois près', () => {
    const l = lue({ ...MOUSSA, "Date d'entrée": null });
    expect(l.entree).toEqual({ iso: '2021-10-01', auMois: true });
    expect(l.corrections).toContainEqual({
      colonne: "Date d'entrée",
      lu: '',
      retenu: 'oct. 2021, d’après l’ancienneté (5,1 ans)',
    });
  });

  it('lit la date d’entrée « 01-mars-04 » et laisse de côté l’ancienneté du fichier', () => {
    // Le fichier date de deux mois : son ancienneté retarde, la date d'entrée fait foi.
    const l = lue({ ...MOUSSA, "Date d'entrée": '01-mars-04', 'Ancienneté (années)': 22.6 });
    expect(l.entree).toEqual({ iso: '2004-03-01', auMois: false });
    expect(l.corrections.filter((c) => c.colonne === "Date d'entrée")).toEqual([]);
    expect(l.avertissements).toEqual([]);
  });

  it('reprend la prime de transport, et écarte un montant qui ne se lit pas', () => {
    expect(lue({ ...MOUSSA, 'Prime de transport': '26 000' }).remuneration).toEqual({
      primeTransport: 26000,
    });
    expect(lue(MOUSSA).remuneration).toEqual({});
    const l = lue({ ...MOUSSA, 'Prime de transport': 'forfait' });
    expect(l.remuneration).toEqual({});
    expect(l.avertissements).toEqual([
      { colonne: 'Prime de transport', texte: '« forfait » n’est pas un montant : non importé' },
    ]);
  });

  it('déduit le contrat que le fichier ne dit pas : un CDD avec une date de fin, un CDI sinon', () => {
    const cdi = lue({ ...MOUSSA, 'Type de contrat': null });
    expect(cdi.contrat).toEqual({ type: 'cdi', fin: null });
    expect(cdi.corrections).toContainEqual({
      colonne: 'Type de contrat',
      lu: '',
      retenu: 'CDI, sans date de fin',
    });
    const cdd = lue({ ...MOUSSA, 'Type de contrat': null, 'Date de fin (si CDD)': '31/12/2027' });
    expect(cdd.contrat).toEqual({ type: 'cdd', fin: '2027-12-31' });
    expect(cdd.corrections).toContainEqual({
      colonne: 'Type de contrat',
      lu: '',
      retenu: 'CDD, d’après la date de fin',
    });
  });

  it('reprend toute la rémunération, la banque, le RIB et l’IPRES', () => {
    const l = lue({
      ...MOUSSA,
      'Salaire de base ': 450000,
      'Sursalaire ': '50 000',
      "Prime d'ancienneté": 12000,
      'Brut social': 512000,
      'Prime de transport': 26000,
      'Salaire brut': 538000,
      'Nombre de part Sociale': '2,5',
      'Carburant ': '100.000 FCFA',
      'Forfait Téléphone': 25000,
      'Indemnités de sujetion': 30000,
      'Autres avantages': 'Logement de fonction',
      Banque: 'CBAO',
      "Relevé d'Identité Bancaire": 'SN012 01201 036182616901 96',
      Domiciliation: 'Oui',
      'Numero IPRES': 1234567,
    });
    expect(l.remuneration).toEqual({
      salaireDeBase: 450000,
      sursalaire: 50000,
      primeAnciennete: 12000,
      brutSocial: 512000,
      primeTransport: 26000,
      salaireBrut: 538000,
      carburant: 100000,
      forfaitTelephone: 25000,
      indemniteSujetion: 30000,
      nombreDeParts: 2.5,
      banque: 'cbao',
      rib: 'SN0120120103618261690196',
      autresAvantages: 'Logement de fonction',
      domiciliation: true,
      numeroIpres: '1234567',
    });
    // Rien à corriger, rien d'écarté : la même ligne que sans la rémunération.
    expect(l.corrections).toEqual(lue(MOUSSA).corrections);
    expect(l.avertissements).toEqual(lue(MOUSSA).avertissements);
  });

  it('montre la banque et le RIB corrigés, et écarte ce qui ne se lit pas', () => {
    const l = lue({
      ...MOUSSA,
      Banque: 'Ecobank Sénégal',
      "Relevé d'Identité Bancaire": '0120120103618261690196',
      'Nombre de part Sociale': 6,
      Domiciliation: 'Agence Plateau',
      'Numero IPRES': 'x'.repeat(31),
    });
    expect(l.remuneration).toEqual({ banque: 'ecobank', rib: 'SN0120120103618261690196' });
    expect(l.corrections).toEqual(
      expect.arrayContaining([
        { colonne: 'Banque', lu: 'Ecobank Sénégal', retenu: 'Ecobank' },
        {
          colonne: "Relevé d'Identité Bancaire",
          lu: '0120120103618261690196',
          retenu: 'SN012 01201 036182616901 96',
        },
      ]),
    );
    expect(l.avertissements.map((a) => a.colonne)).toEqual([
      'Nombre de part Sociale',
      'Domiciliation',
      'Numero IPRES',
    ]);
    expect(l.avertissements).toContainEqual({
      colonne: 'Domiciliation',
      texte: '« Agence Plateau » n’est ni Oui ni Non : non importé',
    });
  });

  it('lit la domiciliation par oui ou par non, « O » et « N » compris', () => {
    expect(lue({ ...MOUSSA, Domiciliation: 'NON' }).remuneration.domiciliation).toBe(false);
    const l = lue({ ...MOUSSA, Domiciliation: 'o' });
    expect(l.remuneration.domiciliation).toBe(true);
    expect(l.corrections).toContainEqual({ colonne: 'Domiciliation', lu: 'o', retenu: 'Oui' });
    expect(lue({ ...MOUSSA, Domiciliation: 'N/A' }).remuneration.domiciliation).toBeUndefined();
  });

  it('lit la filiation sur la fiche : le prénom du père, le prénom et le nom de la mère', () => {
    expect(
      lue({ ...MOUSSA, 'Fils/Fille': "Fils de Mamadou Ndiaye et d'Aminata Sow" }).personne,
    ).toMatchObject({ prenomDuPere: 'Mamadou', prenomDeLaMere: 'Aminata', nomDeLaMere: 'Sow' });
    const l = lue({ ...MOUSSA, 'Fils/Fille': 'Mamadou et Awa Diop et Fatou Sow' });
    expect(l.personne.prenomDuPere).toBeUndefined();
    expect(l.avertissements).toContainEqual({
      colonne: 'Fils/Fille',
      texte:
        '« Mamadou et Awa Diop et Fatou Sow » ne se lit pas (le père, puis la mère, séparés par « et ») : non importé',
    });
  });

  it('accorde le poste au sexe de la personne', () => {
    const l = lue({
      ...MOUSSA,
      Sexe: 'F',
      'Situation Matrimoniale': 'Célibataire',
      "Nom de l'épouse 1": null,
      "Nom de l'épouse 2": null,
      "Nombre d'épouse ": null,
      'Poste occupé ': 'ASISTANT RH',
    });
    expect(l.poste?.intitule).toBe('Assistante RH');
  });

  it('prend « NA », « N/A » ou « - » pour une case vide, sans avertissement', () => {
    const l = lue({
      ...MOUSSA,
      'Adresse mail professionnel ': 'NA',
      'Numero de tel professionnel': 'N/A',
      'Responsable Hierarchique\n(N+1)': 'NA',
      'Lieu de travail': '-',
      "Nombre d'enfants": 'néant',
    });
    expect(l.emploi.workEmail).toBeUndefined();
    expect(l.emploi.workPhone).toBeUndefined();
    expect(l.emploi.lieuDeTravail).toBeUndefined();
    expect(l.n1).toBeNull();
    // Pour un nombre, « néant » dit 0.
    expect(l.personne.nombreEnfants).toBe(0);
    expect(l.avertissements).toEqual([]);
  });

  it('refuse la ligne sans date d’entrée ni ancienneté', () => {
    expect(
      lire({ ...MOUSSA, "Date d'entrée": 'bientôt', 'Ancienneté (années)': null }),
    ).toMatchObject({
      refus: { motif: '« bientôt » n’est pas une date', colonne: "Date d'entrée" },
    });
  });

  it('retient la date d’entrée quand l’ancienneté la contredit, et le dit', () => {
    const l = lue({ ...MOUSSA, 'Ancienneté (années)': 9 });
    expect(l.entree.iso).toBe('2021-09-13');
    expect(l.avertissements).toContainEqual({
      colonne: 'Ancienneté (années)',
      texte:
        '9 ans dans le fichier, 5,1 ans d’après la date d’entrée : la date d’entrée est retenue',
    });
  });

  it('écarte une valeur fausse et importe le reste de la ligne', () => {
    const l = lue({ ...MOUSSA, 'Numero CNI': '17511985012', 'Region ': 'Paris' });
    expect(l.personne.nationalId).toBeUndefined();
    expect(l.personne.region).toBeUndefined();
    expect(l.personne.phone).toBe('+221771234567');
    expect(l.avertissements).toEqual([
      { colonne: 'Numero CNI', texte: 'Numéro CNI à 11 chiffres au lieu de 13 : non importé' },
      { colonne: 'Region', texte: '« Paris » n’est pas une région du Sénégal : non importé' },
    ]);
  });

  it('n’importe les épouses que pour un homme marié, autant de noms qu’annoncé', () => {
    const femme = lue({ ...MOUSSA, Sexe: 'F' });
    expect(femme.personne.epouses).toBeUndefined();
    expect(femme.avertissements).toContainEqual({
      colonne: "Nombre d'épouse",
      texte: 'Épouses renseignées pour une femme : épouses non importées',
    });
    const incoherent = lue({ ...MOUSSA, "Nombre d'épouse ": 3 });
    expect(incoherent.personne.epouses).toBeUndefined();
    expect(incoherent.avertissements).toContainEqual({
      colonne: "Nombre d'épouse",
      texte: '3 épouses annoncées, 2 noms : épouses non importées',
    });
    const celibataire = lue({ ...MOUSSA, 'Situation Matrimoniale': 'Célibataire' });
    expect(celibataire.avertissements[0]?.texte).toBe(
      'Épouses renseignées pour un homme qui n’est pas marié : épouses non importées',
    );
    const sansNombre = lue({ ...MOUSSA, "Nombre d'épouse ": null });
    expect(sansNombre.personne.epouses).toEqual(['Fatou Sarr', 'Aida Sow']);
    const femmeSansEpouse = lue({
      ...MOUSSA,
      Sexe: 'F',
      'Situation Matrimoniale': 'Mariée',
      "Nom de l'épouse 1": null,
      "Nom de l'épouse 2": null,
      "Nombre d'épouse ": 0,
    });
    expect(femmeSansEpouse.avertissements).toEqual([]);
  });

  it('veut une date de fin pour un CDD, et pas pour un CDI', () => {
    const cdd = lue({ ...MOUSSA, 'Type de contrat': 'CDD', 'Date de fin (si CDD)': '31/12/2027' });
    expect(cdd.contrat).toEqual({ type: 'cdd', fin: '2027-12-31' });
    const sansFin = lue({ ...MOUSSA, 'Type de contrat': 'CDD' });
    expect(sansFin.contrat).toBeNull();
    expect(sansFin.avertissements).toContainEqual({
      colonne: 'Type de contrat',
      texte: 'CDD sans date de fin : non importé',
    });
    const cdi = lue({ ...MOUSSA, 'Date de fin (si CDD)': '31/12/2027' });
    expect(cdi.contrat).toEqual({ type: 'cdi', fin: null });
    expect(cdi.avertissements).toContainEqual({
      colonne: 'Date de fin (si CDD)',
      texte: 'Un CDI n’a pas de date de fin : non importé',
    });
    const echu = lue({ ...MOUSSA, 'Type de contrat': 'CDD', 'Date de fin (si CDD)': '30/06/2026' });
    expect(echu.avertissements).toContainEqual({
      colonne: 'Date de fin (si CDD)',
      texte: 'CDD terminé le 30/06/2026 : saisissez son renouvellement sur la fiche',
    });
  });

  it('laisse la sortie à la fiche', () => {
    const l = lue({ ...MOUSSA, 'Date de sortie': '01/10/2026', 'Motif de sortie': 'Démission' });
    expect(l.avertissements).toEqual([
      { colonne: 'Date de sortie', texte: 'La sortie se saisit sur la fiche : non importé' },
      { colonne: 'Motif de sortie', texte: 'La sortie se saisit sur la fiche : non importé' },
    ]);
  });

  it('montre chaque correction de saisie avant l’import', () => {
    const l = lue({
      ...MOUSSA,
      'Region ': 'Ziginchor',
      Statut: 'non carde',
      'Lien de parenté avec le contact': 'Oncle',
      'Adresse mail professionnel ': 'm.ndiaye@apix.com',
    });
    expect(l.corrections).toEqual(
      expect.arrayContaining([
        { colonne: 'Region', lu: 'Ziginchor', retenu: 'Ziguinchor' },
        { colonne: 'Statut', lu: 'non carde', retenu: 'Non cadre' },
        { colonne: 'Lien de parenté avec le contact', lu: 'Oncle', retenu: 'Autre' },
        {
          colonne: 'Adresse mail professionnel',
          lu: 'm.ndiaye@apix.com',
          retenu: 'm.ndiaye@apix.sn',
        },
      ]),
    );
  });

  it('écarte la date de naissance d’une personne de moins de quinze ans', () => {
    const l = lue({ ...MOUSSA, 'Date de naissance': '01/01/2020' });
    expect(l.personne.birthDate).toBeUndefined();
    expect(l.avertissements[0]?.colonne).toBe('Date de naissance');
  });
});

describe('la banque, le RIB, les parts et la filiation', () => {
  it('reconnaît la banque à son nom, à son sigle ou à son ancien nom', () => {
    expect(lireBanque('CBAO')).toEqual({ valeur: 'cbao', corrige: false });
    expect(lireBanque('Banque Islamique')).toEqual({ valeur: 'banque_islamique', corrige: false });
    expect(lireBanque('BHS')).toEqual({ valeur: 'banque_habitat', corrige: true });
    expect(lireBanque('cncas')).toEqual({ valeur: 'banque_agricole', corrige: true });
    expect(lireBanque('UBA SA')).toEqual({ valeur: 'uba', corrige: true });
    expect(lireBanque('ECOBANQ')).toEqual({ valeur: 'ecobank', corrige: true });
    expect(lireBanque('Banque')).toEqual({ erreur: '« Banque » n’est pas une banque de la liste' });
  });

  it('lit le RIB avec ou sans espaces, complète le SN, et tire le RIB d’un IBAN', () => {
    const rib = 'SN0120120103618261690196';
    expect(lireRib('SN012 01201 036182616901 96')).toEqual({ valeur: rib, corrige: false });
    expect(lireRib('012012010361826169 0196')).toEqual({ valeur: rib, corrige: true });
    expect(lireRib('SN08 SN01 2012 0103 6182 6169 0196')).toEqual({ valeur: rib, corrige: true });
    expect(lireRib(120120103618261690196)).toEqual({
      erreur: 'Excel garde ce RIB comme un nombre, et en a perdu des chiffres',
    });
    expect(lireRib('SN012 0120')).toEqual({
      erreur: '« SN012 0120 » n’est pas un RIB (SN, puis 22 chiffres)',
    });
  });

  it('lit le nombre de parts, par demi-part', () => {
    expect(lireParts(2)).toEqual({ valeur: 2, corrige: false });
    expect(lireParts('1,5 part')).toEqual({ valeur: 1.5, corrige: false });
    expect(lireParts('3.5 parts')).toEqual({ valeur: 3.5, corrige: false });
    expect(lireParts(6)).toEqual({
      erreur: '« 6 » n’est pas un nombre de parts (de 1 à 5, par demi-part)',
    });
  });

  it('lit la filiation comme l’état civil l’écrit, le père d’abord', () => {
    expect(lireFiliation('Fils de Mamadou Ndiaye et de Awa Diop', 'Ndiaye')).toEqual({
      valeur: { prenomDuPere: 'Mamadou', prenomDeLaMere: 'Awa', nomDeLaMere: 'Diop' },
      corrige: false,
    });
    expect(lireFiliation('MAMADOU ET NDEYE FATOU SOW', 'Ndiaye')).toEqual({
      valeur: { prenomDuPere: 'Mamadou', prenomDeLaMere: 'Ndeye Fatou', nomDeLaMere: 'Sow' },
      corrige: false,
    });
    expect(lireFiliation('Mamadou / Awa', 'Ndiaye')).toEqual({
      valeur: { prenomDuPere: 'Mamadou', prenomDeLaMere: 'Awa' },
      corrige: false,
    });
    // Un seul nom : celui du père.
    expect(lireFiliation('Fille de Mamadou', 'Ndiaye')).toEqual({
      valeur: { prenomDuPere: 'Mamadou' },
      corrige: false,
    });
    // « Fils » seul ne dit que le sexe.
    expect(lireFiliation('Fils', 'Ndiaye')).toBeNull();
  });
});
