import {
  cniGroupee,
  enChiffres,
  enLettres,
  ficheStagiaireSchema,
  finDuStage,
  nomDuDocumentGenere,
  type FicheStagiaire,
} from '@teranga/contracts';
import { ZodValidationPipe } from '../../common/zod.pipe';
import type { Tx } from '../../db/tenant-db';
import { quiDirigeLaDCH } from './dossier';
import { ENTETE } from './entete';
import { nouvelleFeuille, type DocumentPdf, type Passage } from './feuille';
import {
  A_REMPLIR,
  accords,
  elide,
  frDate,
  insecable,
  qualiteDCH,
  type Personne,
} from './redaction';

/*
 * Le contrat de stage d'adaptation, sur le modèle officiel de l'APIX
 * (ADR-0094) : trois pages, les parties, huit articles et les signatures. La
 * personne n'est pas encore dans l'application : la DCH la renseigne, avec
 * le stage, tout est obligatoire (ADR-0096). Qui représente l'APIX dirige la
 * DCH. Les coquilles du modèle sont corrigées (ADR-0095).
 */

/** Un bloc du contrat, dans l'ordre où la feuille le pose. */
export type BlocDuContrat =
  | { type: 'titre'; texte: string }
  | { type: 'paragraphe'; passages: Passage[]; avant: number }
  | { type: 'puce'; passages: Passage[] }
  | { type: 'article'; numero: number; titre: string }
  | { type: 'saut' }
  | { type: 'signatures'; gauche: [string, string]; droite: [string, string] };

export interface ContratStageData {
  stagiaire: FicheStagiaire;
  /** Qui représente l'APIX : qui dirige la DCH ; null : la place est vacante. */
  signataire: Personne | null;
}

const texte = (t: string, avant = 12): BlocDuContrat => ({
  type: 'paragraphe',
  passages: [{ texte: t }],
  avant,
});
const article = (numero: number, titre: string): BlocDuContrat => ({
  type: 'article',
  numero,
  titre,
});
const puce = (t: string): BlocDuContrat => ({ type: 'puce', passages: [{ texte: t }] });

/** « trois (03) mois » : la durée en lettres, puis en chiffres sur deux positions. */
const enMois = (mois: number) => `${enLettres(mois)} (${String(mois).padStart(2, '0')}) mois`;

/** « n° 97-17 » : le numéro ne se sépare pas de son signe. */
const no = (numero: string) => insecable(`n° ${numero}`);

/**
 * Le contrat, bloc par bloc, aux mots du modèle de l'APIX. La personne porte
 * le genre de sa civilité ; la place vacante à la tête de la DCH se laisse en
 * pointillés, à remplir à la main.
 */
export function blocsDuContratDeStage(d: ContratStageData, aujourdhui: Date): BlocDuContrat[] {
  const s = d.stagiaire;
  const genre = s.civilite === 'madame' ? 'female' : 'male';
  const stagiaire = accords(genre);
  const signataire = accords(d.signataire?.genre ?? null);
  const qualite = qualiteDCH(d.signataire?.genre ?? null);
  const nom = `${stagiaire.civilite} ${s.prenom} ${s.nom.toUpperCase()}`;
  const sigle = ENTETE.sigle;
  return [
    { type: 'titre', texte: 'CONTRAT DE STAGE D’ADAPTATION' },
    {
      type: 'paragraphe',
      avant: 36,
      passages: [
        {
          texte:
            `${sigle}, au capital de 4.950.000.000 FCFA, sise au 52-54, rue ${insecable('Mohamed V')}, ` +
            `Immeuble Alwar, ${insecable('BP 430')} Dakar – Sénégal, représentée par ${
              d.signataire ? insecable(`${signataire.civilite} ${d.signataire.nom}`) : A_REMPLIR
            }, ${signataire.le.toLowerCase()} ${qualite}`,
        },
      ],
    },
    texte('d’une part,'),
    texte('Et', 22),
    texte(`Prénom et nom : ${insecable(nom)}`, 22),
    texte(`Sexe : ${genre === 'female' ? 'Féminin' : 'Masculin'}`),
    texte(`Date et lieu de naissance : ${insecable(frDate(s.naissanceLe))} à ${s.naissanceA}`),
    // Le numéro en groupes, comme sur la carte : « n° 1 234 0000 12345 ».
    texte(`CNI ${no(cniGroupee(s.cni))}`),
    texte(
      `Filiation : ${genre === 'female' ? 'Fille' : 'Fils'} de ${s.perePrenom} et de ` +
        `${s.merePrenom} ${s.mereNom}`,
    ),
    texte(`Adresse : ${s.adresse}`),
    {
      type: 'paragraphe',
      avant: 12,
      passages: [
        { texte: `Ci-après dénommé${stagiaire.e} « ` },
        { texte: 'le Stagiaire', gras: true },
        { texte: ' »' },
      ],
    },
    texte('d’autre part,', 22),
    {
      type: 'paragraphe',
      avant: 22,
      passages: [{ texte: 'Il a été convenu et arrêté ce qui suit :', gras: true }],
    },
    { type: 'saut' },

    article(1, 'OBJET'),
    texte(
      'La présente convention a pour objet de définir les conditions dans lesquelles le Stagiaire ' +
        'ci-dessus nommé sera accueilli dans l’entreprise.',
      8,
    ),
    article(2, 'TEXTES APPLICABLES'),
    texte(
      'Les parties conviennent de se référer aux textes suivants régissant le contrat de stage :',
      8,
    ),
    puce(
      `La Loi ${no('97-17')} du ${insecable('1er décembre 1997')} instituant le Code du travail`,
    ),
    puce(
      `La Loi ${no('2007-13')} modifiée autorisant la création d’une société anonyme dénommée ${sigle}`,
    ),
    puce(
      `La Loi ${no('2015-04')} du ${insecable('12 février 2015')} complétant et abrogeant certaines ` +
        `dispositions de la loi ${no('97-17')} du ${insecable('1er décembre 1997')} portant Code du travail`,
    ),
    puce(
      `Le Décret ${no('2015-777')} du ${insecable('2 juin 2015')} fixant les règles applicables au ` +
        'contrat de stage',
    ),
    article(3, 'ENGAGEMENTS DU MAÎTRE DE STAGE ET DU STAGIAIRE'),
    texte(
      'En vue de l’acquisition d’une expérience et d’aptitudes professionnelles, pour faciliter ' +
        `l’accès à un emploi et l’insertion en milieu professionnel, ${sigle} s’engage à assurer au ` +
        `Stagiaire, inscrit en ${s.formation}, une formation ${elide('en qualité d', s.poste)}.`,
      8,
    ),
    texte(
      'En retour, le Stagiaire promet de se montrer assidu lors de son stage et de se conformer ' +
        `scrupuleusement au règlement intérieur d’${sigle}.`,
      8,
    ),
    article(4, 'DURÉE DU CONTRAT'),
    texte(
      `Le présent contrat est conclu pour une durée de ${enMois(s.duree)}. Il prend effet le ` +
        `${insecable(frDate(s.debut))} et se termine le ${insecable(frDate(finDuStage(s.debut, s.duree)))}.`,
      8,
    ),
    article(5, 'ALLOCATION DE STAGE'),
    {
      type: 'paragraphe',
      avant: 8,
      passages: [
        {
          texte:
            `Le Stagiaire bénéficiera, en application de l’article 6 du Décret ${no('2015-777')} ` +
            'fixant les règles applicables au contrat de stage, d’une allocation mensuelle de ',
        },
        {
          texte: `${enLettres(s.allocation)} (${enChiffres(s.allocation)}) ${insecable('FCFA TTC')}`,
          gras: true,
        },
        { texte: '.' },
      ],
    },
    texte(
      `Cette allocation est indexée, suivant la grille salariale d’${sigle}, à la ` +
        `${insecable(`catégorie ${s.categorie.toLocaleUpperCase('fr-FR')}`)}.`,
      14,
    ),
    { type: 'saut' },

    article(6, 'SUSPENSION DU CONTRAT DE STAGE'),
    texte(
      'Le présent article, pour son application, renvoie aux dispositions de l’article 8 du Décret ' +
        `${no('2015-777')} du ${insecable('2 juin 2015')} fixant les règles applicables au contrat de stage.`,
      8,
    ),
    article(7, 'FIN ET RÉSILIATION DU CONTRAT DE STAGE'),
    texte('Aux termes de l’article 13 :', 8),
    puce('Le contrat de stage prend fin à l’échéance initialement prévue par les parties.'),
    puce(
      'Toutefois, chacune des parties se réserve le droit de mettre fin au contrat sous réserve du ' +
        'respect des règles de préavis de quinze (15) jours.',
    ),
    puce(
      'Une attestation sera délivrée au Stagiaire par le maître de stage à la fin du programme.',
    ),
    article(8, 'RÈGLEMENT DES LITIGES'),
    texte(
      'Tout différend relatif à la validité, à l’interprétation ou à l’exécution du présent contrat ' +
        'sera soumis à un règlement à l’amiable devant les services compétents en matière de droit ' +
        'du travail et de la sécurité sociale.',
      8,
    ),
    texte(
      `Fait en quatre (04) exemplaires à ${ENTETE.ville}, le ${insecable(frDate(aujourdhui))}.`,
      30,
    ),
    texte('(Signature précédée de la mention manuscrite « Lu et approuvé »)', 18),
    {
      type: 'signatures',
      gauche: ['Pour le Stagiaire', nom],
      droite: [`Pour ${sigle}`, `${signataire.le} ${qualite}`],
    },
  ];
}

/** Le contrat en PDF : l'en-tête de la République en première page, le pied de l'APIX sur chacune. */
export function pdfDuContratDeStage(
  blocs: readonly BlocDuContrat[],
  { logo }: { logo?: string | null } = {},
): Promise<Buffer> {
  const feuille = nouvelleFeuille({ titre: 'Contrat de stage', logo });
  feuille.blocRepublique();
  for (const b of blocs) {
    if (b.type === 'titre') feuille.titreSouligne(b.texte);
    else if (b.type === 'paragraphe') feuille.paragraphe(b.passages, { avant: b.avant });
    else if (b.type === 'puce')
      feuille.paragraphe(b.passages, { avant: 6, retrait: 28, puce: '-' });
    else if (b.type === 'article') {
      feuille.paragraphe(
        [
          { texte: insecable(`ARTICLE ${b.numero}`), gras: true, souligne: true },
          { texte: ` : ${b.titre}`, gras: true },
        ],
        { avant: b.numero === 1 || b.numero === 6 ? 0 : 20 },
      );
    } else if (b.type === 'saut') feuille.sautDePage();
    else feuille.signatures(b.gauche, b.droite);
  }
  return feuille.terminer();
}

/** La fiche, validée : ce que la page envoie, comme une route le ferait. */
const valider = new ZodValidationPipe(ficheStagiaireSchema);

/** Ce que le contrat imprimerait aujourd'hui pour cette fiche, sans contrôle des droits. */
export async function blocsDeContratPour(tx: Tx, corps: unknown): Promise<BlocDuContrat[]> {
  return blocsDuContratDeStage(
    { stagiaire: valider.transform(corps), signataire: await quiDirigeLaDCH(tx) },
    new Date(),
  );
}

/** Un modèle sans agent : la fiche de la personne tient lieu de dossier. */
export interface ModeleSansAgent {
  pdf(tx: Tx, corps: unknown): Promise<DocumentPdf>;
  /** Ce que l'organisation sait d'avance de la fiche, que la page pose dans ses champs vides. */
  preremplissage?(): Record<string, unknown>;
}

/** Le modèle, tel que « Générer des documents » l'appelle (ADR-0085), droits vérifiés. */
export const contratDeStage: ModeleSansAgent = {
  async pdf(tx, corps) {
    const stagiaire = valider.transform(corps);
    const blocs = blocsDuContratDeStage(
      { stagiaire, signataire: await quiDirigeLaDCH(tx) },
      new Date(),
    );
    return {
      filename: nomDuDocumentGenere(
        'contrat_stage',
        `${stagiaire.nom.toUpperCase()}-${stagiaire.prenom}`,
      ),
      pdf: await pdfDuContratDeStage(blocs),
    };
  },
};
