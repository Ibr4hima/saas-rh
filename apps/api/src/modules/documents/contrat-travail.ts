import { sql } from 'drizzle-orm';
import {
  cniGroupee,
  enChiffres,
  enLettres,
  ficheDuContratSchema,
  finDuContrat,
  nationalityLabel,
  nomDuDocumentGenere,
  salaireBrut,
  type FicheCdi,
} from '@teranga/contracts';
import { problem } from '../../common/problem';
import { ZodValidationPipe } from '../../common/zod.pipe';
import type { Tx } from '../../db/tenant-db';
import type { ModeleSansAgent } from './contrat-stage';
import { quiDirigeLeSommet } from './dossier';
import { ENTETE } from './entete';
import { nouvelleFeuille, type Passage } from './feuille';
import {
  A_REMPLIR,
  accords,
  aLUnite,
  auGenre,
  elide,
  frDate,
  insecable,
  type Personne,
} from './redaction';

/*
 * Les contrats de travail à durée déterminée et indéterminée, sur le modèle
 * de l'APIX (ADR-0098) : quatre pages en Times New Roman, les parties, neuf
 * articles et les signatures. La personne n'est pas encore dans
 * l'application : la DCH la renseigne, avec son emploi et sa rémunération.
 * Qui représente l'APIX dirige la direction générale. Les deux modèles fournis
 * portent le même texte : la durée, déterminée ou non, fait la différence.
 * Les coquilles du modèle sont corrigées (ADR-0095).
 */

export type ContratDeTravail = 'contrat_cdd' | 'contrat_cdi';

/** Un bloc du contrat, dans l'ordre où la feuille le pose. */
export type BlocDuContratDeTravail =
  | { type: 'paragraphe'; passages: Passage[]; avant: number; pas?: number; align?: 'right' }
  | { type: 'tiret'; passages: Passage[]; avant: number }
  | { type: 'rubrique'; texte: string; avant: number }
  | { type: 'montant'; libelle: string; montant: number; avant: number }
  | { type: 'article'; numero: number; titres: string[]; avant: number }
  | { type: 'saut' }
  | { type: 'signatures'; gauche: [string, string]; droite: [string, string] };

export interface ContratDeTravailData {
  doc: ContratDeTravail;
  fiche: FicheCdi & { duree?: number };
  /** L'unité d'affectation : son nom et son type dans l'organigramme. */
  unite: { nom: string; type: string };
  /** Qui représente l'APIX : qui dirige la direction générale ; null : la place est vacante. */
  signataire: Personne | null;
}

/** L'interligne du modèle : 18 points au moins ; une ligne et demie pour la personne. */
const PAS = 18;
const PAS_DE_LA_PERSONNE = 20.7;
/** Une ligne vide du modèle, à interligne simple. */
const LIGNE_SIMPLE = 13.8;

const texte = (
  t: string,
  avant: number = PAS,
  autres: { pas?: number; align?: 'right' } = {},
): BlocDuContratDeTravail => ({ type: 'paragraphe', passages: [{ texte: t }], avant, ...autres });
const article = (numero: number, avant: number, ...titres: string[]): BlocDuContratDeTravail => ({
  type: 'article',
  numero,
  titres,
  avant,
});
const tiret = (t: string): BlocDuContratDeTravail => ({
  type: 'tiret',
  passages: [{ texte: t }],
  avant: PAS,
});

/** « douze (12) mois » : la durée en lettres, puis en chiffres sur deux positions. */
const enMois = (mois: number) => `${enLettres(mois)} (${String(mois).padStart(2, '0')}) mois`;

/** « n° 97-17 » : le numéro ne se sépare pas de son signe. */
const no = (numero: string) => insecable(`n° ${numero}`);

/**
 * Le contrat, bloc par bloc, aux mots du modèle de l'APIX. La personne porte
 * le genre de sa civilité ; qui représente l'APIX, celui de son dossier ; la
 * place vacante à la tête de la direction générale se laisse en pointillés.
 */
export function blocsDuContratDeTravail(
  d: ContratDeTravailData,
  aujourdhui: Date,
): BlocDuContratDeTravail[] {
  const f = d.fiche;
  const p = accords(f.civilite === 'madame' ? 'female' : 'male');
  const pronom = p.pronom;
  // Le terme du contrat pour la personne : « l’Employée ».
  const designation = `Employé${p.e}`;
  // La civilité ne se sépare pas du prénom.
  const nom = `${p.civilite} ${f.prenom} ${f.nom.toLocaleUpperCase('fr-FR')}`;
  const sigle = ENTETE.sigle;
  const dg = d.signataire;
  const qualite = auGenre(dg?.genre ?? null, 'Directeur Général', 'Directrice Générale');
  const representant = auGenre(
    dg?.genre ?? null,
    'son représentant légal',
    'sa représentante légale',
  );
  const brut = salaireBrut(f);
  const duree = d.doc === 'contrat_cdd' ? f.duree : undefined;
  const debut = insecable(frDate(f.debut));
  return [
    {
      type: 'paragraphe',
      passages: [{ texte: 'Entre les soussignés', gras: true }],
      avant: LIGNE_SIMPLE + PAS,
    },
    texte(
      `La Société Anonyme ${sigle}, au capital de 4.950.000.000 FCFA, dont le siège social est au ` +
        `52-54, rue ${insecable('Mohamed V')}, Immeuble Alwar, numéro NINEA ${ENTETE.ninea}, code ` +
        `Sécurité Sociale ${insecable('19 2000 5620')},`,
    ),
    texte('Cotisant à l’IPRES sous le numéro 24486.101.X,', 0),
    texte(
      `Agissant par l’intermédiaire de ${representant} ${
        dg ? insecable(`${accords(dg.genre).civilite} ${dg.nom}`) : A_REMPLIR
      }, ${qualite},`,
      0,
    ),
    texte('L’Employeur, d’une part', 0),
    texte('Et'),
    texte(`${nom}, né${p.e} le ${insecable(frDate(f.naissanceLe))} à ${f.naissanceA},`, PAS, {
      pas: PAS_DE_LA_PERSONNE,
    }),
    texte(
      `CNI ${no(cniGroupee(f.cni))}, délivrée le ${insecable(frDate(f.cniDelivreeLe))} à ` +
        `${f.cniDelivreeA},`,
      0,
      { pas: PAS_DE_LA_PERSONNE },
    ),
    texte(`Nationalité ${nationalityLabel(f.nationalite)},`, 0, { pas: PAS_DE_LA_PERSONNE }),
    texte(`Demeurant à ${f.adresse},`, 0, { pas: PAS_DE_LA_PERSONNE }),
    texte(`L’${designation},`, 0, { pas: PAS_DE_LA_PERSONNE }),
    texte('d’autre part', PAS_DE_LA_PERSONNE, { pas: PAS_DE_LA_PERSONNE }),
    {
      type: 'paragraphe',
      passages: [{ texte: 'IL A ÉTÉ CONVENU ET ARRÊTÉ CE QUI SUIT, RÉGI PAR :', gras: true }],
      avant: PAS,
    },
    tiret(
      `Les dispositions de la Loi ${no('97-17')} du ${insecable('1er décembre 1997')} instituant un ` +
        'Code du travail au Sénégal et par les règlements d’application de cette loi ;',
    ),
    tiret(
      'Les parties contractantes s’engagent à se conformer aux clauses et dispositions de la ' +
        'Convention Collective Nationale Interprofessionnelle du Sénégal du ' +
        `${insecable('30 décembre 2019')}, ainsi qu’aux textes régissant ${sigle}.`,
    ),
    { type: 'saut' },

    article(1, 0, 'ENGAGEMENT'),
    texte(
      `La société ${sigle} engage à son service ${nom}, ${elide('en qualité d', f.poste)} ` +
        `${aLUnite(d.unite.nom, d.unite.type)}.`,
    ),
    article(2, PAS, 'DURÉE DU CONTRAT'),
    texte(
      duree
        ? `Le présent contrat est conclu pour une durée déterminée de ${enMois(duree)} (CDD).`
        : 'Le présent contrat est conclu pour une durée indéterminée (CDI).',
      LIGNE_SIMPLE,
    ),
    texte(
      duree
        ? `Il prend effet à compter du ${debut} et se termine le ` +
            `${insecable(frDate(finDuContrat(f.debut, duree)))}.`
        : `Il prend effet à compter du ${debut}.`,
    ),
    article(3, PAS, 'OBJET DU CONTRAT'),
    texte(
      `${nom} est appelé${p.e} à exercer la fonction définie à l’article 1 du présent contrat.`,
    ),
    texte(
      `${pronom} s’engage à s’acquitter, au mieux de sa qualification professionnelle et dans les ` +
        'conditions définies par l’Employeur, des travaux et missions qui lui sont confiés.',
    ),
    texte(
      `${pronom} exerce ses fonctions avec un sens aigu des responsabilités et de façon à assurer un ` +
        'maximum de rendement à l’entreprise.',
      12,
    ),
    texte(
      `${pronom} déclare formellement n’être lié${p.e} à aucun employeur et qu’${pronom.toLowerCase()} ` +
        'est libre de tout engagement.',
    ),
    article(4, PAS, 'OBLIGATIONS PROFESSIONNELLES'),
    texte(`${nom} s’engage à exercer de manière exclusive son activité professionnelle.`),
    texte(
      'L’exercice de toute autre activité professionnelle, soit pour son compte, soit pour le ' +
        `compte d’un tiers, reste soumis à approbation de la direction d’${sigle}.`,
    ),
    texte(
      `${pronom} s’engage également à ne pas exercer d’activité susceptible de concurrencer ${sigle} ` +
        'ou de nuire à la bonne exécution des services convenus à compter de son départ de ' +
        'l’entreprise pour cause de licenciement ou de faute lourde, pendant une durée d’une année ' +
        `et dans la limite d’un rayon de ${insecable('50 kilomètres')}.`,
    ),
    texte(
      `${nom} s’engage à observer les horaires de travail qui sont fixés par l’Employeur et à se ` +
        'conformer aux directives et instructions émanant de la hiérarchie.',
    ),
    texte(
      'Tout manquement à ces obligations au cours du présent contrat est constitutif d’une faute ' +
        'grave pouvant justifier un licenciement.',
      0,
    ),
    article(5, PAS, 'RÉMUNÉRATION', 'AVANTAGES DIVERS'),
    {
      type: 'paragraphe',
      avant: LIGNE_SIMPLE,
      passages: [
        {
          texte: `À titre de rémunération, ${nom} perçoit à la fin de chaque mois un salaire brut de `,
        },
        {
          texte: `${enLettres(brut)} (${enChiffres(brut)}) ${insecable('francs CFA')}`,
          gras: true,
        },
        { texte: ' décomposé ainsi qu’il suit :' },
      ],
    },
    { type: 'montant', libelle: 'Salaire de base :', montant: f.salaireDeBase, avant: PAS },
    { type: 'montant', libelle: 'Sursalaire :', montant: f.sursalaire, avant: 0 },
    { type: 'montant', libelle: 'Prime de transport :', montant: f.primeDeTransport, avant: 0 },
    ...(f.treiziemeMois ? [texte(`Un treizième mois est octroyé à ${nom} en fin d’année.`)] : []),
    texte(
      `${elide('Le poste d', f.poste)} est classé à la ` +
        `${insecable(`catégorie ${f.categorie.toLocaleUpperCase('fr-FR')}`)} de la Convention ` +
        'Collective du Commerce.',
      f.treiziemeMois ? 0 : PAS,
    ),
    article(6, PAS, 'CONGÉS'),
    texte(
      `${nom} a droit à des congés payés calculés selon les dispositions légales. Au cas où ${nom} ` +
        'n’aurait pas soldé ses congés au terme de son contrat, il lui sera versé une indemnité ' +
        'compensatrice de congés payés dans les conditions fixées par la réglementation en vigueur.',
    ),
    texte(
      'La période de prise de congés payés est fixée en tenant compte des nécessités de service.',
    ),
    article(7, PAS, 'LIEU DE TRAVAIL'),
    texte(`Le lieu de travail est le siège social de la société ${sigle}.`),
    texte(
      `Toutefois, ${nom} s’engage expressément à accepter tout déplacement ponctuel entrant dans ` +
        'le cadre de l’exercice de ses fonctions et toute autre affectation dans un autre ' +
        `établissement de la société ${sigle}, à l’intérieur ou à l’extérieur du Sénégal, qui ` +
        `pourraient être décidés par ${sigle}.`,
    ),
    texte(
      'Le refus d’une affectation par l’agent est considéré comme cause de rupture du contrat de ' +
        'travail de son fait.',
    ),
    { type: 'saut' },

    article(8, 0, 'CLAUSES PARTICULIÈRES'),
    { type: 'rubrique', texte: 'Soins médicaux', avant: PAS },
    texte(
      `Les soins médicaux et dentaires de l’${designation} et de ses enfants à charge ainsi que les ` +
        `médicaments sont pris en charge par ${sigle} dans le cadre de l’assurance souscrite par ` +
        `cette dernière auprès d’une compagnie d’assurance, à hauteur de ${insecable('90 %')}.`,
    ),
    texte(
      'Les risques, accidents du travail et maladies professionnelles sont couverts par la Caisse ' +
        `de Sécurité Sociale auprès de laquelle l’${designation} est immatriculé${p.e}.`,
    ),
    { type: 'rubrique', texte: 'Cotisations retraites', avant: PAS },
    texte(
      'L’organisme d’affiliation pour la retraite est l’Institution de Prévoyance Retraite du ' +
        'Sénégal (IPRES).',
    ),
    texte(
      `L’${designation} reconnaît à son Employeur le droit de prélever sur son salaire la fraction de ` +
        'cotisation mise à sa charge en vertu du règlement de l’Institution de retraite ' +
        'susmentionnée.',
    ),
    article(9, PAS, 'RÉSILIATION DU CONTRAT'),
    texte(
      'Pour la résiliation du présent contrat, les parties se réfèrent aux dispositions de ' +
        'l’article 48 du Code du travail.',
    ),
    texte(
      `Fait en quatre exemplaires à ${ENTETE.ville}, le ${insecable(frDate(aujourdhui))}.`,
      PAS,
      {
        align: 'right',
      },
    ),
    texte('(Signature précédée de la mention manuscrite « Lu et approuvé »)'),
    {
      type: 'signatures',
      gauche: [`L’${designation}`, nom],
      droite: ['L’Employeur', `${accords(dg?.genre ?? null).le} ${qualite}`],
    },
  ];
}

/** « ARTICLE 5 - RÉMUNÉRATION - AVANTAGES DIVERS » : le numéro et les titres soulignés, pas les tirets. */
function enteteDArticle(b: { numero: number; titres: string[] }): Passage[] {
  return [
    { texte: insecable(`ARTICLE ${b.numero}`), gras: true, souligne: true },
    ...b.titres.flatMap((titre) => [
      { texte: ' - ', gras: true },
      { texte: insecable(titre), gras: true, souligne: true },
    ]),
  ];
}

/** Le contrat en PDF : l'en-tête de la République en première page, le pied de l'APIX sur chacune. */
export function pdfDuContratDeTravail(
  blocs: readonly BlocDuContratDeTravail[],
  { logo }: { logo?: string | null } = {},
): Promise<Buffer> {
  const feuille = nouvelleFeuille({ titre: 'Contrat de travail', famille: 'times', logo });
  const { doc } = feuille;
  // Le corps du modèle : 12 points, en retrait de 18 sur la marge.
  const corps = { taille: 12, pas: PAS, retrait: 18 };
  feuille.blocRepublique();
  feuille.titreCadre('CONTRAT DE TRAVAIL', { avant: 46 });
  for (const b of blocs) {
    if (b.type === 'paragraphe') {
      feuille.paragraphe(b.passages, {
        ...corps,
        avant: b.avant,
        pas: b.pas ?? PAS,
        align: b.align,
      });
    } else if (b.type === 'tiret') {
      feuille.paragraphe(b.passages, {
        ...corps,
        avant: b.avant,
        retrait: 36,
        puce: '-',
        puceA: 18,
      });
    } else if (b.type === 'rubrique' || b.type === 'article') {
      // Un intitulé ne reste pas seul en bas de page : il part avec la ligne qui le suit.
      doc.y += b.avant;
      feuille.place(PAS * 3);
      if (b.type === 'article') feuille.paragraphe(enteteDArticle(b), corps);
      else {
        feuille.paragraphe([{ texte: insecable(b.texte), gras: true, souligne: true }], {
          ...corps,
          retrait: 36,
          puce: '•',
          puceA: 18,
        });
      }
    } else if (b.type === 'montant') {
      feuille.ligneAColonne(b.libelle, `${enChiffres(b.montant)} F CFA`, {
        avant: b.avant,
        taille: 12,
        pas: PAS,
        puce: '•',
        puceA: 36,
        retrait: 54,
        colonne: 189,
      });
    } else if (b.type === 'saut') {
      feuille.sautDePage();
    } else {
      feuille.signatures(b.gauche, b.droite, { avant: 13, espace: 72, taille: 12 });
    }
  }
  return feuille.terminer();
}

/** L'unité d'affectation, dans l'organigramme de l'organisation. */
async function uniteDAffectation(tx: Tx, id: string): Promise<ContratDeTravailData['unite']> {
  const { rows } = await tx.execute<{ name: string; unit_type: string }>(sql`
    SELECT name, unit_type FROM org_units WHERE id = ${id} AND deleted_at IS NULL`);
  const unite = rows[0];
  if (!unite) problem(422, 'documents.affectation', 'Unité d’affectation introuvable');
  return { nom: unite.name, type: unite.unit_type };
}

/** La fiche, validée selon le contrat : la durée, pour un contrat à durée déterminée. */
const valider = (doc: ContratDeTravail, corps: unknown) =>
  new ZodValidationPipe(ficheDuContratSchema(doc)).transform(corps);

/** Le contrat d'une fiche validée, daté d'aujourd'hui. */
async function blocsDeLaFiche(
  tx: Tx,
  doc: ContratDeTravail,
  fiche: ContratDeTravailData['fiche'],
): Promise<BlocDuContratDeTravail[]> {
  return blocsDuContratDeTravail(
    {
      doc,
      fiche,
      unite: await uniteDAffectation(tx, fiche.affectation),
      signataire: await quiDirigeLeSommet(tx),
    },
    new Date(),
  );
}

/** Ce que le contrat imprimerait aujourd'hui pour cette fiche, sans contrôle des droits. */
export function blocsDeContratDeTravailPour(
  tx: Tx,
  doc: ContratDeTravail,
  corps: unknown,
): Promise<BlocDuContratDeTravail[]> {
  return blocsDeLaFiche(tx, doc, valider(doc, corps));
}

/** Le modèle, tel que « Générer des documents » l'appelle (ADR-0085), droits vérifiés. */
export const contratDeTravail = (doc: ContratDeTravail): ModeleSansAgent => ({
  async pdf(tx, corps) {
    const fiche = valider(doc, corps);
    return {
      filename: nomDuDocumentGenere(doc, `${fiche.nom.toUpperCase()}-${fiche.prenom}`),
      pdf: await pdfDuContratDeTravail(await blocsDeLaFiche(tx, doc, fiche)),
    };
  },
});
