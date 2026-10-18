import {
  enLettres,
  ficheDisponibiliteSchema,
  ficheRenouvellementSchema,
  nomDuDocumentGenere,
  REQUESTABLE_DOC_LABELS,
  type DecisionDeDisponibilite,
  type FicheDisponibilite,
  type FicheRenouvellement,
} from '@teranga/contracts';
import { ZodValidationPipe } from '../../common/zod.pipe';
import type { Tx } from '../../db/tenant-db';
import type { ModeleSansAgent } from './contrat-stage';
import { quiDirigeLaDCH, quiDirigeLeSommet, uniteDAffectation, type Unite } from './dossier';
import { ENTETE } from './entete';
import { nouvelleFeuille, type Passage } from './feuille';
import {
  accords,
  aLUnite,
  auGenre,
  frDate,
  insecable,
  qualiteDCH,
  type Personne,
} from './redaction';

/*
 * Les décisions de disponibilité pour convenances personnelles, sur les
 * modèles de l'APIX (ADR-0100) : la mise en disponibilité et son
 * renouvellement. Une page, l'en-tête et son numéro, l'analyse, les visas,
 * quatre articles, les ampliations. Les deux modèles portent le même texte, à
 * l'article 1er près : l'une met en disponibilité à compter d'un jour, l'autre
 * proroge la période fixée d'abord ; son analyse le dit (ADR-0101). La DCH
 * renseigne qui la demande, les dates de la disponibilité et celles des
 * sessions du conseil d'administration qui ont nommé la direction générale.
 * Qui décide dirige la direction générale ; qui l'exécute, la DCH. Les
 * coquilles des modèles sont corrigées (ADR-0095).
 */

/** Ce que la décision imprime, bloc par bloc. */
export interface TextesDeLaDecision {
  titre: string;
  reference: string;
  lieuEtDate: string;
  analyse: string;
  /** Qui décide, au-dessus des visas : « Le Directeur Général ». */
  timbre: string;
  visas: Passage[][];
  articles: { titre: string; passages: Passage[] }[];
  ampliations: string[];
}

/** La fiche saisie, et ce que l'organisation sait : qui dirige, où la personne est affectée. */
export type DisponibiliteData = {
  /** Qui dirige la direction générale ; null : la place est vacante. */
  directionGenerale: Personne | null;
  /** Qui dirige la DCH ; null : la place est vacante. */
  dch: Personne | null;
} & (
  | { doc: 'decision_disponibilite'; fiche: FicheDisponibilite }
  | { doc: 'decision_renouvellement_disponibilite'; fiche: FicheRenouvellement; unite: Unite }
);

/** « n° 97-17 » : le numéro ne se sépare pas de son signe. */
const no = (numero: string) => insecable(`n° ${numero}`);
/** Le point-virgule d'un visa, que l'espace insécable garde sur sa ligne. */
const PV = insecable(' ;');

/** « du 2 janvier au 1er juillet 2026 » : l'année ne se répète pas quand c'est la même. */
function periode(du: string, au: string): string {
  const debut = du.slice(0, 4) === au.slice(0, 4) ? frDate(du).replace(/ \d+$/, '') : frDate(du);
  return `du ${insecable(debut)} au ${insecable(frDate(au))}`;
}

/** L'article 1er : la mise en disponibilité, ou la prorogation de la période initiale. */
function articlePremier(d: DisponibiliteData, nom: string, e: string): Passage[] {
  if (d.doc === 'decision_disponibilite') {
    return [
      { texte: nom, gras: true },
      {
        texte:
          `, ${d.fiche.poste}, est mis${e} en position de disponibilité pour convenances ` +
          'personnelles, à compter du ',
      },
      { texte: `${insecable(frDate(d.fiche.effetLe))}.`, gras: true },
    ];
  }
  const f = d.fiche;
  return [
    { texte: 'La période de disponibilité de ' },
    { texte: nom, gras: true },
    {
      texte:
        `, ${f.poste} ${aLUnite(d.unite.nom, d.unite.type)}, initialement fixée ` +
        `${periode(f.initialementDu, f.initialementAu)}, est prorogée pour une durée de `,
    },
    { texte: insecable(`${enLettres(f.duree)} (${f.duree}) mois`), gras: true },
    { texte: '.' },
  ];
}

/** La décision, aux mots des modèles de l'APIX, accordée à chacun. */
export function textesDeLaDecision(d: DisponibiliteData, aujourdhui: Date): TextesDeLaDecision {
  const f = d.fiche;
  const personne = accords(f.civilite === 'madame' ? 'female' : 'male');
  const e = personne.e;
  const nom = insecable(`${personne.civilite} ${f.prenom} ${f.nom.toLocaleUpperCase('fr-FR')}`);
  const sigle = ENTETE.sigle;
  const dg = accords(d.directionGenerale?.genre ?? null);
  const qualiteDG = auGenre(
    d.directionGenerale?.genre ?? null,
    'Directeur Général',
    'Directrice Générale',
  );
  const genreDCH = d.dch?.genre ?? null;
  const dch = accords(genreDCH);
  const societe = (lien: string) =>
    `autorisant la création d’une société anonyme à participation publique majoritaire${lien} ` +
    `dénommée ${insecable(`« ${sigle} »`)}`;
  return {
    titre: REQUESTABLE_DOC_LABELS[d.doc],
    reference: ENTETE.referenceDecision,
    lieuEtDate: `${ENTETE.ville}, le ${frDate(aujourdhui)}`,
    analyse:
      d.doc === 'decision_disponibilite'
        ? 'Décision accordant une mise en disponibilité pour convenances personnelles'
        : 'Décision accordant le renouvellement d’une mise en disponibilité pour convenances ' +
          'personnelles',
    timbre: `${dg.le} ${qualiteDG}`,
    visas: [
      [{ texte: `Vu la Constitution${PV}` }],
      [
        {
          texte: `Vu la loi ${no('97-17')} du ${insecable('1er décembre 1997')} portant Code du travail${PV}`,
        },
      ],
      [
        {
          texte:
            `Vu la loi 2007-13 du ${insecable('19 février 2007')} autorisant la création ` +
            'd’une société anonyme à participation publique majoritaire, dénommée ',
        },
        { texte: insecable(`« ${sigle} »`), gras: true },
        { texte: PV },
      ],
      [
        {
          texte:
            `Vu la loi 2007-33 du ${insecable('31 décembre 2007')}, modifiant la loi 2007-13 ` +
            `${societe(',')}${PV}`,
        },
      ],
      [
        {
          texte:
            `Vu le décret 2007-1591 portant application de la loi ${no('2007-13')} du ` +
            `${insecable('19 février 2007')} ${societe('')}, modifiée en certaines de ses ` +
            `dispositions par la loi 2007-33 du ${insecable('31 décembre 2007')}${PV}`,
        },
      ],
      [
        {
          texte:
            `Vu le procès-verbal de la session du ${insecable(frDate(f.pvDirectionGeneraleLe))} du ` +
            `Conseil d’Administration de la société anonyme ${sigle} qui a nommé ` +
            `${dg.le.toLowerCase()} ${qualiteDG} d’${sigle}${PV}`,
        },
      ],
      [
        {
          texte:
            'Vu le procès-verbal de la session du ' +
            `${insecable(frDate(f.pvDirectionGeneraleAdjointeLe))} du Conseil d’Administration de ` +
            `la société anonyme ${sigle} qui a nommé le Directeur Général Adjoint d’${sigle}${PV}`,
        },
      ],
      [
        {
          texte: `Vu la demande de ${nom} par lettre en date du ${insecable(frDate(f.demandeLe))}${PV}`,
        },
      ],
      [{ texte: `Vu les nécessités de service${PV}` }],
    ],
    articles: [
      { titre: 'Article 1er', passages: articlePremier(d, nom, e) },
      {
        titre: 'Article 2',
        passages: [
          {
            texte:
              'Pendant cette période de disponibilité, conformément aux dispositions de l’article ' +
              `L.68 du Code du travail, ${nom} ne percevra aucune rémunération et cessera de ` +
              'bénéficier de ses droits à l’avancement et à la retraite.',
          },
        ],
      },
      {
        titre: 'Article 3',
        passages: [
          {
            texte:
              `L’intéressé${e} sera considéré${e} comme démissionnaire de son emploi ` +
              `${e ? 'si elle' : 's’il'} ne reprend pas service le `,
          },
          { texte: insecable(frDate(f.repriseLe)), gras: true },
          { texte: ', à l’expiration de sa période de disponibilité.' },
        ],
      },
      {
        titre: 'Article 4',
        passages: [
          {
            texte:
              `${dch.le} ${qualiteDCH(genreDCH)} est ${auGenre(genreDCH, 'chargé', 'chargée')} ` +
              'de l’exécution de la présente décision qui sera enregistrée et communiquée ' +
              'partout où besoin sera.',
          },
        ],
      },
    ],
    ampliations: ['- DCH', '- DFC', `- Dossier de l’intéressé${e}`],
  };
}

/**
 * Les espaces entre les blocs : ceux du modèle, l'en-tête un peu rapproché
 * pour que l'article 1er d'un renouvellement, plus long, tienne ; puis ceux
 * d'une page serrée, quand la saisie allonge le texte au point que les
 * ampliations ne tiennent plus à côté du pied.
 */
const ESPACES = [
  { analyse: 36, timbre: 11, visas: 16, decide: 14, articles: 14, entre: 13.8 },
  { analyse: 18, timbre: 6, visas: 8, decide: 8, articles: 8, entre: 6 },
] as const;

/** La décision posée sur la feuille, aux espaces donnés. */
function composer(
  t: TextesDeLaDecision,
  logo: string | null | undefined,
  espaces: (typeof ESPACES)[number],
) {
  const feuille = nouvelleFeuille({ titre: t.titre, logo, marge: 42.6 });
  feuille.entete({ reference: t.reference, lieuEtDate: t.lieuEtDate });
  feuille.paragraphe([{ texte: t.analyse, gras: true }], {
    avant: espaces.analyse,
    taille: 12,
    interligne: 0,
    retrait: 70,
    puce: [{ texte: 'ANALYSE', gras: true, souligne: true }, { texte: insecable(' :') }],
    puceA: 0,
    align: 'left',
  });
  feuille.timbre(t.timbre, { avant: espaces.timbre, police: 'comic', taille: 13, align: 'center' });
  t.visas.forEach((visa, i) =>
    feuille.paragraphe(visa, {
      avant: i === 0 ? espaces.visas : 0,
      taille: 12,
      pas: 15.9,
      retrait: 18,
      puce: '▪',
      puceA: 0,
    }),
  );
  feuille.timbre('D É C I D E', {
    avant: espaces.decide,
    police: 'arial',
    taille: 18,
    align: 'center',
  });
  t.articles.forEach((article, i) =>
    feuille.paragraphe(
      [
        { texte: insecable(article.titre), gras: true, souligne: true },
        { texte: `${insecable(' :')} ` },
        ...article.passages,
      ],
      { avant: i === 0 ? espaces.articles : espaces.entre, taille: 12, interligne: 0 },
    ),
  );
  feuille.piedAGauche([
    [{ texte: 'Ampliations', gras: true, souligne: true }, { texte: insecable(' :') }],
    [],
    ...t.ampliations.map((a) => [{ texte: a, italique: true }]),
  ]);
  return feuille;
}

/** La décision en PDF, sur une page, aux marges du modèle ; serrée s'il le faut. */
export function pdfDeLaDecision(
  t: TextesDeLaDecision,
  { logo }: { logo?: string | null } = {},
): Promise<Buffer> {
  const [modele, serree] = ESPACES;
  const feuille = composer(t, logo, modele);
  return (feuille.pages() > 1 ? composer(t, logo, serree) : feuille).terminer();
}

/** La fiche validée, et ce que l'organisation sait. */
async function donnees(
  tx: Tx,
  doc: DecisionDeDisponibilite,
  corps: unknown,
): Promise<DisponibiliteData> {
  if (doc === 'decision_disponibilite') {
    const fiche = new ZodValidationPipe(ficheDisponibiliteSchema).transform(corps);
    return {
      doc,
      fiche,
      directionGenerale: await quiDirigeLeSommet(tx),
      dch: await quiDirigeLaDCH(tx),
    };
  }
  const fiche = new ZodValidationPipe(ficheRenouvellementSchema).transform(corps);
  return {
    doc,
    fiche,
    unite: await uniteDAffectation(tx, fiche.affectation),
    directionGenerale: await quiDirigeLeSommet(tx),
    dch: await quiDirigeLaDCH(tx),
  };
}

/** Ce que la décision imprimerait aujourd'hui pour cette fiche, sans contrôle des droits. */
export async function textesDeDecisionPour(
  tx: Tx,
  doc: DecisionDeDisponibilite,
  corps: unknown,
): Promise<TextesDeLaDecision> {
  return textesDeLaDecision(await donnees(tx, doc, corps), new Date());
}

/** Le modèle, tel que « Générer des documents » l'appelle (ADR-0085), droits vérifiés. */
export const decisionDeDisponibilite = (doc: DecisionDeDisponibilite): ModeleSansAgent => ({
  async pdf(tx, corps) {
    const d = await donnees(tx, doc, corps);
    return {
      filename: nomDuDocumentGenere(doc, `${d.fiche.nom.toUpperCase()}-${d.fiche.prenom}`),
      pdf: await pdfDeLaDecision(textesDeLaDecision(d, new Date())),
    };
  },
});
