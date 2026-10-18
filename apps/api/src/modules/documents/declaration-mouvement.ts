import {
  CATEGORIES_D_ENREGISTREMENT,
  CHIFFRES_DE_L_IMMATRICULATION,
  cniGroupee,
  DISPOSITIONS_MAX,
  enChiffres,
  ficheDeclarationMouvementSchema,
  HORAIRES_HEBDOMADAIRES,
  maritalLabelsFor,
  MOUVEMENTS_DU_TRAVAILLEUR,
  nationalityLabel,
  natureDuMouvement,
  nomDuDocumentGenere,
  REQUESTABLE_DOC_LABELS,
  type FicheDeclarationMouvement,
  type MouvementDuTravailleur,
} from '@teranga/contracts';
import { ZodValidationPipe } from '../../common/zod.pipe';
import type { ModeleSansAgent } from './contrat-stage';
import { ENTETE } from './entete';
import { nouvelleFeuille, type Passage } from './feuille';
import { elide, frDate, insecable } from './redaction';

/*
 * La déclaration de mouvement du travailleur (ADR-0106) : le formulaire que
 * l'employeur adresse à l'inspection du travail et de la sécurité sociale
 * pour une embauche, un départ ou un changement dans la situation du
 * travailleur (article L.222 du Code du travail), selon l'arrêté n° 7301 du
 * 17 mai 1963. Les références sont celles du modèle, comme sur les autres
 * documents de la DCH (ADR-0107).
 *
 * Deux pages, les rubriques du formulaire dans son ordre. Les mentions se
 * rayent ou s'encadrent, comme le formulaire le demande ; ce que la DCH n'a
 * pas renseigné laisse des pointillés, à remplir à la main ; ce qui ne
 * s'applique pas se dit « Néant » ou « Sans objet ». Ni en-tête ni pied de
 * l'APIX : c'est un formulaire de l'administration, que le cachet de
 * l'employeur signe. Les coquilles du modèle sont corrigées (ADR-0095).
 */

/** Une cellule d'une ligne : elle commence à `de`, une part de la largeur, et finit où la suivante commence. */
export interface Cellule {
  de: number;
  passages: Passage[];
}

/** Une ligne du formulaire : une cellule, ou plusieurs côte à côte. */
export type Ligne = Cellule[];

/** Ce que la déclaration imprime, rubrique par rubrique. */
export interface DeclarationDeMouvement {
  /** Le jour de la déclaration ; son numéro se porte à la main. */
  date: string;
  references: readonly string[];
  /** Le numéro au fichier central de la main-d'œuvre ; null : l'immatriculation se demande. */
  immatriculation: string | null;
  /** La catégorie d'enregistrement, encadrée sous la grille du numéro ; null : aucune encadrée. */
  categorieDEnregistrement: (typeof CATEGORIES_D_ENREGISTREMENT)[number] | null;
  /** Les mouvements, ligne par ligne comme sur le formulaire, rayés ou encadrés. */
  objet: Passage[][];
  /** Le jour où le mouvement prend effet : l'entrée, le départ ou le changement. */
  aCompterDu: string;
  travailleur: Ligne[];
  /** La durée du contrat : une mention par ligne, rayée ou encadrée. */
  contrat: Passage[][];
  residence: Ligne[];
  statutMilitaire: Ligne[];
  /** La première disposition particulière : la catégorie, l'horaire et le salaire. */
  salaire: Passage[];
  /** Les dispositions 2 à 5 ; null : des pointillés. */
  dispositions: (string | null)[];
}

/** Ce que la DCH n'a pas renseigné : à remplir à la main. */
const POINTILLES = '……………………';

/** Un libellé, en romain. */
const libelle = (texte: string): Passage => ({ texte });
/** Une valeur, en gras ; sans valeur, des pointillés. */
const valeur = (texte: string | null | undefined): Passage =>
  texte ? { texte, gras: true } : { texte: POINTILLES };
/** Une date, d'un seul tenant. */
const date = (iso: string | undefined) => (iso ? insecable(frDate(iso)) : null);
/** « Libellé : valeur ». */
const champ = (nom: string, v: string | null | undefined): Passage[] => [
  libelle(`${nom}${insecable(' :')} `),
  valeur(v),
];
/** « de Moussa », « d’Ibrahima » : la préposition, élidée devant une voyelle, puis la valeur. */
const de = (avant: string, nom: string): Passage[] => {
  const elidee = elide('d', nom);
  return [libelle(`${avant}${elidee.slice(0, elidee.length - nom.length)}`), valeur(nom)];
};
/** Une ligne d'une seule cellule. */
const pleine = (passages: Passage[]): Ligne => [{ de: 0, passages }];
/** Une ligne de deux cellules, la seconde à `milieu`. */
const deux = (gauche: Passage[], droite: Passage[], milieu = 0.5): Ligne => [
  { de: 0, passages: gauche },
  { de: milieu, passages: droite },
];

/** Une mention, d'un seul tenant : valable, elle s'encadre ; sinon, elle se raye. */
const mention = (texte: string, valable: boolean): Passage => ({
  texte: insecable(texte),
  raye: !valable,
  encadre: valable,
});

/** Des mentions à la suite, séparées d'un tiret. */
const mentions = (liste: readonly (readonly [texte: string, valable: boolean])[]): Passage[] =>
  liste.flatMap(([texte, valable], i) => [
    ...(i > 0 ? [libelle(' – ')] : []),
    mention(texte, valable),
  ]);

/** Un numéro et sa date : « n° 1234 du 2 octobre 2026 ». */
const numeroEtDate = (p: { numero: string; le: string } | undefined) =>
  p ? insecable(`n° ${p.numero} du ${frDate(p.le)}`) : null;

/** Des noms en liste : « Awa Diop, Moussa Diop et Fatou Diop » ; aucun : « Néant ». */
const liste = (noms: readonly string[]) =>
  noms.length > 0 ? new Intl.ListFormat('fr', { type: 'conjunction' }).format(noms) : 'Néant';

/** Le nom français d'un pays : « Sénégal », « Côte d’Ivoire ». */
const nomDuPays = (code: string) =>
  new Intl.DisplayNames(['fr'], { type: 'region' }).of(code) ?? code;

/** Les mouvements, ligne par ligne, comme le formulaire les range. */
const LIGNES_DE_L_OBJET: readonly (readonly MouvementDuTravailleur[])[] = [
  ['embauchage', 'licenciement'],
  ['expiration_du_contrat'],
  ['demission', 'mutation'],
  ['changement_de_categorie'],
  ['modification_du_contrat'],
  ['changement_de_situation_de_famille'],
  ['changement_de_residence'],
  ['changement_d_emploi', 'deces'],
];

/** Les textes du formulaire : la loi en vigueur, et l'arrêté qui en fixe les modalités. */
export const REFERENCES = [
  `Article L.222, alinéas 2 à 5, du Code du travail (loi ${insecable('n° 97-17')} du ` +
    `${insecable('1er décembre 1997')})`,
  `Arrêté ministériel ${insecable('n° 7301')} du ${insecable('17 mai 1963')} déterminant les ` +
    'modalités des déclarations de mouvements de travailleurs (JO ' +
    `${insecable('n° 3610')} du ${insecable('22 juin 1963')}, ${insecable('p. 835')})`,
] as const;

/** La situation de famille, sous les codes de l'état civil des dossiers. */
const ETAT_CIVIL = {
  celibataire: 'single',
  marie: 'married',
  divorce: 'divorced',
  veuf: 'widowed',
} as const;

/** La déclaration, aux mots du formulaire, accordée à la personne. */
export function declarationDe(
  f: FicheDeclarationMouvement,
  aujourdhui: Date,
): DeclarationDeMouvement {
  const femme = f.civilite === 'madame';
  const nature = natureDuMouvement(f.mouvements);
  const senegalaise = f.nationalite === 'SN';
  const sigle = elide('d', ENTETE.sigle);
  const mere = `${f.merePrenom} ${f.mereNom}`;

  return {
    date: insecable(frDate(aujourdhui)),
    references: REFERENCES,
    immatriculation: f.immatriculation ?? null,
    categorieDEnregistrement: f.categorieDEnregistrement ?? null,
    objet: LIGNES_DE_L_OBJET.map((ligne) =>
      mentions(ligne.map((m) => [MOUVEMENTS_DU_TRAVAILLEUR[m], f.mouvements.includes(m)] as const)),
    ),
    aCompterDu: insecable(frDate(f.effetLe ?? f.entreeLe)),
    travailleur: [
      deux(champ('Nom', f.nom.toLocaleUpperCase('fr-FR')), champ('Prénom(s)', f.prenom)),
      [
        {
          de: 0,
          passages: [
            ...champ(femme ? 'Née le' : 'Né le', date(f.naissanceLe)),
            libelle(' à '),
            valeur(f.naissanceA),
          ],
        },
        { de: 0.5, passages: champ('Pays', nomDuPays(f.naissancePays)) },
        { de: 0.74, passages: champ('Nationalité', nationalityLabel(f.nationalite)) },
      ],
      pleine([...de(femme ? 'Fille ' : 'Fils ', f.perePrenom), ...de(' et ', mere)]),
      pleine(champ('Adresse', f.adresse)),
      deux(
        [
          libelle('Carte d’identité n° '),
          valeur(senegalaise ? insecable(cniGroupee(f.cni)) : f.cni),
        ],
        champ('Délivrée à', f.cniDelivreeA),
      ),
      pleine(champ('Par', f.cniDelivreePar)),
      deux(
        champ('N° d’immatriculation à la CSS', f.css),
        champ('N° d’immatriculation à l’IPRES', f.ipres),
      ),
      deux(
        champ(
          'Situation de famille',
          maritalLabelsFor(femme ? 'female' : 'male')[ETAT_CIVIL[f.situationDeFamille]],
        ),
        femme
          ? champ('Nom de l’époux', liste(f.conjoints))
          : champ(
              'Nombre d’épouses',
              f.conjoints.length > 0 ? String(f.conjoints.length) : 'Néant',
            ),
      ),
      ...(femme
        ? []
        : [
            pleine(
              champ(
                f.conjoints.length === 1 ? 'Nom de l’épouse' : 'Noms des épouses',
                liste(f.conjoints),
              ),
            ),
          ]),
      pleine(
        champ(
          'Nombre d’enfants à charge',
          f.enfants.length > 0 ? String(f.enfants.length) : 'Néant',
        ),
      ),
      pleine(
        champ(
          f.enfants.length === 1 ? 'Nom de l’enfant à charge' : 'Noms des enfants à charge',
          liste(f.enfants),
        ),
      ),
      // Un départ se déclare avec sa date (article L.222 du Code du travail).
      nature === 'depart'
        ? deux(
            champ('Date d’entrée dans l’établissement', date(f.entreeLe)),
            champ('Date de départ de l’établissement', date(f.effetLe)),
          )
        : pleine(champ('Date d’entrée dans l’établissement', date(f.entreeLe))),
      pleine(
        champ(
          'N° et date de la déclaration d’embauche effectuée lors de l’engagement',
          // La présente déclaration est celle de l'embauche.
          nature === 'embauche' ? 'Sans objet' : numeroEtDate(f.declarationDEmbauche),
        ),
      ),
      deux(champ('Profession', f.profession), champ('Emploi dans l’établissement', f.emploi)),
      deux(
        champ('Convention collective', `Barème salarial ${sigle}`),
        champ('Catégorie', f.categorie),
      ),
      pleine(champ('Éventuellement, date du contrat', date(f.contratLe))),
      pleine(
        champ(
          'N° et date du visa d’approbation par l’inspecteur du travail et de la sécurité sociale',
          numeroEtDate(f.visa),
        ),
      ),
      pleine(
        champ(
          // La section locale se porte à la main, comme sur le modèle.
          `N° et date du visa d’enregistrement à la section locale de ${SECTION} du service de ` +
            'la main-d’œuvre',
          numeroEtDate(f.enregistrement),
        ),
      ),
      pleine(
        champ(
          'Raison sociale et adresse précise de l’employeur',
          `${ENTETE.sigle}, 52-54, rue ${insecable('Mohamed V')}, ${ENTETE.ville}`,
        ),
      ),
      pleine(champ('Activité de l’établissement', 'Société de services')),
    ],
    contrat: [
      [
        mention('à durée déterminée', f.contrat === 'cdd'),
        ...(f.contrat === 'cdd'
          ? [libelle(' du '), valeur(date(f.cddDu)), libelle(' au '), valeur(date(f.cddAu))]
          : []),
      ],
      [mention('à durée indéterminée', f.contrat === 'cdi')],
      f.contrat === 'chantier' && f.chantier
        ? [mention('chantier', true), ...de(' ', f.chantier)]
        : [mention('chantier de', false)],
    ],
    residence: [
      pleine(champ('Nom et adresse du précédent employeur', f.precedentEmployeur ?? 'Néant')),
      deux(
        champ('Lieu de résidence habituel du travailleur', f.residence),
        champ('Date d’entrée au Sénégal', senegalaise ? 'Sans objet' : date(f.entreeAuSenegalLe)),
        0.6,
      ),
    ],
    statutMilitaire: [
      pleine(
        champ('Classe de recrutement', f.serviceMilitaire ? f.classeDeRecrutement : 'Sans objet'),
      ),
      pleine([
        libelle(
          `${femme ? 'L’intéressée a-t-elle' : 'L’intéressé a-t-il'} effectué son service ` +
            `militaire${insecable(' :')} `,
        ),
        ...mentions([
          ['oui', f.serviceMilitaire],
          ['non', !f.serviceMilitaire],
        ]),
      ]),
      pleine([
        libelle(`Armée d’appartenance${insecable(' :')} `),
        ...mentions((['terre', 'air', 'mer'] as const).map((a) => [a, f.armee === a] as const)),
      ]),
      pleine([
        libelle(`Grade dans la réserve${insecable(' :')} `),
        ...mentions([
          ['officier', f.grade === 'officier'],
          ['sous-officier', f.grade === 'sous_officier'],
          ['troupe', f.grade === 'troupe'],
        ]),
      ]),
    ],
    salaire: [
      libelle('Le salaire du travailleur sera fixé pour la catégorie '),
      valeur(f.categorie),
      libelle(
        ` du barème salarial ${sigle}, en fonction d’un horaire de travail hebdomadaire ` +
          `de${insecable(' :')} `,
      ),
      ...mentions(HORAIRES_HEBDOMADAIRES.map((h) => [`${h} heures`, f.horaire === h] as const)),
      libelle(', soit '),
      valeur(insecable(`${enChiffres(f.salaire)} FCFA`)),
      libelle(' par mois.'),
    ],
    dispositions: Array.from({ length: DISPOSITIONS_MAX }, (_, i) => f.dispositions[i] ?? null),
  };
}

const ENCRE = '#111111';
/** Les marges de gauche et de droite, et celle du haut. */
const MARGE = 45;
const HAUT = 34;
/** Le corps du texte, et le pas de ses lignes. */
const TAILLE = 10;
const PAS = 13.4;
/** Le cadre du cachet de l'employeur, en haut à droite. */
const CACHET = { largeur: 150, hauteur: 104 };
/** Où commence le cadre de l'immatriculation, à droite des mouvements. */
const CADRE_DE_L_OBJET = 0.56;

/** Les notes du bas du formulaire, celles du modèle, chacune avec ses points. */
const NOTES: readonly { note: Passage[]; points?: readonly string[] }[] = [
  {
    note: [
      libelle(
        'La déclaration de mouvement du travailleur est à établir en trois exemplaires dûment ' +
          'signés par l’employeur et le travailleur. Un exemplaire est remis au travailleur. Le ' +
          'second est conservé par l’employeur. Le troisième est déposé :',
      ),
    ],
    points: [
      'dans l’intérieur : à la section locale du service de la main-d’œuvre, à l’inspection ' +
        'régionale du travail et de la sécurité sociale du ressort ;',
      'à Dakar : au Bureau central du service de la main-d’œuvre.',
    ],
  },
  {
    note: [
      libelle('L’employeur doit '),
      { texte: 'OBLIGATOIREMENT', gras: true },
      libelle(' délivrer une ampliation de la déclaration de mouvement au travailleur.'),
    ],
  },
  {
    note: [libelle('Sont provisoirement exemptés de la déclaration de mouvement :')],
    points: [
      'les travailleurs journaliers ;',
      'les manœuvres ordinaires dans toutes les branches d’activité.',
    ],
  },
];
/** La hauteur des notes, leur trait compris. */
const HAUTEUR_DES_NOTES = 166;
/** La section locale du service de la main-d'œuvre, à porter à la main. */
const SECTION = '…………';

/** La déclaration en PDF, sur deux pages. */
export function pdfDeLaDeclaration(d: DeclarationDeMouvement): Promise<Buffer> {
  const feuille = nouvelleFeuille({
    titre: REQUESTABLE_DOC_LABELS.declaration_mouvement,
    famille: 'times',
    marge: MARGE,
    haut: HAUT,
    pied: false,
  });
  const { doc, L, coupe } = feuille;

  /** Des lignes de cellules ; une ligne ne se coupe pas d'une page à l'autre. */
  const lignes = (ls: readonly Ligne[]) => {
    for (const ligne of ls) {
      feuille.place(PAS * 2);
      const y = doc.y;
      let bas = y;
      ligne.forEach((cellule, i) => {
        const fin = ligne[i + 1]?.de ?? 1;
        doc.y = y;
        feuille.paragraphe(cellule.passages, {
          taille: TAILLE,
          pas: PAS,
          retrait: cellule.de * L,
          retraitDroit: (1 - fin) * L + (fin < 1 ? 8 : 0),
          align: 'left',
        });
        bas = Math.max(bas, doc.y);
      });
      doc.y = bas;
    }
  };
  const rubrique = (titre: string, precision?: string) => {
    feuille.place(PAS * 4);
    feuille.paragraphe([{ texte: titre, gras: true }], { avant: 9, taille: 10.5, align: 'left' });
    if (precision) {
      feuille.paragraphe([{ texte: precision, italique: true }], {
        taille: 8.5,
        interligne: 1,
        align: 'left',
      });
    }
    doc.y += 3;
  };
  /** Le trait qui sépare deux rubriques ; il suit la rubrique qu'il ouvre sur la page suivante. */
  const trait = () => {
    doc.y += 5;
    feuille.place(PAS * 3);
    if (doc.y > doc.page.margins.top) {
      doc
        .moveTo(MARGE, doc.y)
        .lineTo(MARGE + L, doc.y)
        .lineWidth(0.9)
        .strokeColor(ENCRE)
        .stroke();
    }
    doc.y += 2;
  };

  // En tête : le titre, le numéro et le jour, les références ; à droite, le
  // cadre du cachet de l'employeur.
  const haut = doc.page.margins.top;
  const xCachet = MARGE + L - CACHET.largeur;
  doc
    .rect(xCachet, haut, CACHET.largeur, CACHET.hauteur)
    .lineWidth(0.9)
    .strokeColor(ENCRE)
    .stroke();
  doc.font(coupe('bold')).fontSize(9.5).fillColor(ENCRE);
  ['Cachet et raison sociale', 'de l’employeur'].forEach((t, i) =>
    doc.text(t, xCachet, haut + 7 + i * 11.5, {
      width: CACHET.largeur,
      align: 'center',
      lineBreak: false,
    }),
  );
  const aGauche = L - CACHET.largeur - 16;
  const TITRE = 'DÉCLARATION DE MOUVEMENT DU TRAVAILLEUR';
  doc.font(coupe('bold')).fontSize(14);
  const tailleDuTitre = Math.min(14, (14 * aGauche) / doc.widthOfString(TITRE));
  doc.fontSize(tailleDuTitre).text(TITRE, MARGE, haut + 6, { lineBreak: false });
  doc.y = haut + 34;
  const colonne = { retraitDroit: L - aGauche, align: 'left' as const };
  feuille.paragraphe([libelle(`N°${' '}`), libelle(POINTILLES), libelle(' du '), valeur(d.date)], {
    taille: 11,
    ...colonne,
  });
  feuille.paragraphe([{ texte: 'RÉFÉRENCES', gras: true }], {
    avant: 8,
    taille: 10,
    retraitDroit: L - aGauche,
    align: 'center',
  });
  d.references.forEach((r) =>
    feuille.paragraphe([libelle(r)], { avant: 1, taille: 9.5, interligne: 1, ...colonne }),
  );
  doc.y = Math.max(doc.y, haut + CACHET.hauteur) + 12;

  // Le numéro au fichier central de la main-d'œuvre, un chiffre par case ;
  // dessous, les catégories d'enregistrement, celle du travailleur encadrée.
  const yBande = doc.y;
  const HAUTEUR_DE_BANDE = 44;
  doc.rect(MARGE, yBande, L, HAUTEUR_DE_BANDE).lineWidth(1.2).strokeColor(ENCRE).stroke();
  doc.font(coupe('normal')).fontSize(9.5).fillColor(ENCRE);
  ['N° d’immatriculation du travailleur au fichier central', 'de la main-d’œuvre'].forEach((t, i) =>
    doc.text(t, MARGE + 8, yBande + 9 + i * 11.5, { lineBreak: false }),
  );
  const CASE = 18;
  const HAUTEUR_DE_CASE = 17;
  const largeurDeLaGrille = CHIFFRES_DE_L_IMMATRICULATION * CASE;
  const xGrille = MARGE + L - 14 - largeurDeLaGrille;
  const yGrille = yBande + 6;
  doc.lineWidth(0.7).strokeColor(ENCRE);
  doc.rect(xGrille, yGrille, largeurDeLaGrille, HAUTEUR_DE_CASE).stroke();
  // Les cases se séparent d'un trait à mi-hauteur, comme sur le formulaire.
  for (let k = 1; k < CHIFFRES_DE_L_IMMATRICULATION; k++) {
    doc
      .moveTo(xGrille + k * CASE, yGrille + HAUTEUR_DE_CASE / 2)
      .lineTo(xGrille + k * CASE, yGrille + HAUTEUR_DE_CASE)
      .stroke();
  }
  doc.font(coupe('bold')).fontSize(10.5).fillColor(ENCRE);
  [...(d.immatriculation ?? '')].forEach((c, i) =>
    doc.text(c, xGrille + i * CASE + (CASE - doc.widthOfString(c)) / 2, yGrille + 3.5, {
      lineBreak: false,
    }),
  );
  const pasDesCategories = largeurDeLaGrille / CATEGORIES_D_ENREGISTREMENT.length;
  const yCategories = yGrille + HAUTEUR_DE_CASE + 4.5;
  doc.font(coupe('bold')).fontSize(9);
  CATEGORIES_D_ENREGISTREMENT.forEach((c, i) => {
    const largeur = doc.widthOfString(c);
    const xc = xGrille + i * pasDesCategories + (pasDesCategories - largeur) / 2;
    doc.text(c, xc, yCategories, { lineBreak: false });
    if (c === d.categorieDEnregistrement) {
      doc
        .rect(xc - 3.5, yCategories - 1.5, largeur + 7, 12.5)
        .lineWidth(0.7)
        .stroke();
    }
  });
  doc.y = yBande + HAUTEUR_DE_BANDE + 4;

  // L'objet : les mouvements, et à droite le blanc où se demande
  // l'immatriculation.
  rubrique(
    'OBJET DE LA PRÉSENTE DÉCLARATION',
    'Rayer les mentions inutiles et encadrer les mentions valables',
  );
  const yListe = doc.y;
  const xCadre = MARGE + CADRE_DE_L_OBJET * L;
  const largeurDuCadre = (1 - CADRE_DE_L_OBJET) * L;
  const hauteurDuCadre = 5 * PAS - 3;
  doc
    .rect(xCadre, yListe, largeurDuCadre, hauteurDuCadre)
    .lineWidth(0.9)
    .strokeColor(ENCRE)
    .stroke();
  if (d.immatriculation === null) {
    doc
      .font(coupe('bold'))
      .fontSize(12)
      .fillColor(ENCRE)
      .text('Immatriculation', xCadre, yListe + hauteurDuCadre / 2 - 7, {
        width: largeurDuCadre,
        align: 'center',
        lineBreak: false,
      });
  }
  doc.y = yListe + hauteurDuCadre + 3;
  feuille.paragraphe(
    [
      libelle(
        'Si le travailleur n’a pas encore été immatriculé, la mention ' +
          `${insecable('« Immatriculation »')} devra être portée dans le blanc ci-dessus.`,
      ),
    ],
    { taille: 8.5, interligne: 0.5, retrait: CADRE_DE_L_OBJET * L, align: 'left' },
  );
  const sousLaNote = doc.y;
  doc.y = yListe;
  d.objet.forEach((ligne) =>
    feuille.paragraphe(ligne, {
      taille: TAILLE,
      pas: PAS,
      retrait: 14,
      retraitDroit: largeurDuCadre + 12,
      puce: '-',
      puceA: 2,
      align: 'left',
    }),
  );
  doc.y = Math.max(doc.y, sousLaNote);
  lignes([pleine([libelle('À compter du '), valeur(d.aCompterDu)])]);

  rubrique('CONCERNANT LE TRAVAILLEUR');
  lignes(d.travailleur);

  trait();
  lignes([pleine([libelle(`Durée du contrat${insecable(' :')}`)])]);
  d.contrat.forEach((ligne) =>
    feuille.paragraphe(ligne, {
      taille: TAILLE,
      pas: PAS,
      retrait: 14,
      puce: '-',
      puceA: 2,
      align: 'left',
    }),
  );
  feuille.paragraphe(
    [{ texte: '(Rayer la mention inutile et encadrer la mention correcte)', italique: true }],
    {
      taille: 8.5,
      interligne: 1,
      align: 'left',
    },
  );

  trait();
  lignes(d.residence);

  // La seconde page : le statut militaire, les dispositions particulières,
  // les signatures et les notes.
  if (feuille.pages() === 1) feuille.sautDePage();
  rubrique('STATUT MILITAIRE', '(Rayer les mentions inutiles)');
  lignes(d.statutMilitaire);

  rubrique(
    'DISPOSITIONS PARTICULIÈRES CONCERNANT L’ENGAGEMENT',
    '(Auxquelles les parties ont expressément souscrit)',
  );
  const disposition = (rang: number, passages: Passage[]) =>
    feuille.paragraphe(passages, {
      avant: rang === 1 ? 0 : 8,
      taille: TAILLE,
      pas: PAS,
      retrait: 20,
      puce: `${rang})`,
      puceA: 0,
      align: 'left',
    });
  disposition(1, d.salaire);
  // Une disposition laissée vide : une ligne de pointillés, pour l'écrire à la main.
  doc.font(coupe('normal')).fontSize(TAILLE);
  const ligneVide = '…'.repeat(Math.floor((L - 20) / doc.widthOfString('…')) - 1);
  d.dispositions.forEach((texte, i) => disposition(i + 2, [libelle(texte ?? ligneVide)]));

  // Les signatures, la place de chacune dessous.
  doc.y += 26;
  feuille.place(90);
  const ySignatures = doc.y;
  feuille.paragraphe([{ texte: 'Signature du travailleur', gras: true }], {
    taille: TAILLE,
    retraitDroit: L / 2,
    align: 'left',
  });
  feuille.paragraphe(
    [{ texte: '(Précédée de la mention manuscrite « pour accord »)', italique: true }],
    {
      taille: 8.5,
      retraitDroit: L / 2,
      align: 'left',
    },
  );
  doc.y = ySignatures;
  feuille.paragraphe([{ texte: 'Signature de l’employeur', gras: true }], {
    taille: TAILLE,
    retrait: 0.62 * L,
    align: 'left',
  });
  // Les notes au pied de la page, comme sur le formulaire : la place des
  // signatures s'étend jusqu'à elles.
  doc.y = Math.max(ySignatures + 86, doc.page.height - doc.page.margins.bottom - HAUTEUR_DES_NOTES);

  trait();
  feuille.paragraphe([{ texte: `NB${insecable(' :')}`, gras: true }], {
    avant: 4,
    taille: 9,
    align: 'left',
  });
  NOTES.forEach(({ note, points = [] }, i) => {
    feuille.paragraphe(note, {
      avant: 2,
      taille: 9,
      interligne: 1.5,
      retrait: 16,
      puce: `${i + 1})`,
      puceA: 0,
    });
    for (const point of points) {
      feuille.paragraphe([libelle(point)], {
        taille: 9,
        interligne: 1.5,
        retrait: 30,
        puce: '-',
        puceA: 19,
        align: 'left',
      });
    }
  });
  return feuille.terminer();
}

const valider = new ZodValidationPipe(ficheDeclarationMouvementSchema);

/** Ce que la déclaration imprimerait aujourd'hui pour cette fiche, sans contrôle des droits. */
export function declarationPour(corps: unknown): DeclarationDeMouvement {
  return declarationDe(valider.transform(corps), new Date());
}

/** Le modèle, tel que « Générer des documents » l'appelle (ADR-0085), droits vérifiés. */
export const declarationDeMouvement: ModeleSansAgent = {
  async pdf(_tx, corps) {
    const fiche = valider.transform(corps);
    return {
      filename: nomDuDocumentGenere(
        'declaration_mouvement',
        `${fiche.nom.toUpperCase()}-${fiche.prenom}`,
      ),
      pdf: await pdfDeLaDeclaration(declarationDe(fiche, new Date())),
    };
  },
};
