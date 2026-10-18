import {
  banqueDe,
  enChiffres,
  enLettres,
  ficheDomiciliationSchema,
  nomDuDocumentGenere,
  REQUESTABLE_DOC_LABELS,
  ribGroupe,
  type FicheDomiciliation,
} from '@teranga/contracts';
import { ZodValidationPipe } from '../../common/zod.pipe';
import type { Tx } from '../../db/tenant-db';
import type { ModeleSansAgent } from './contrat-stage';
import { quiDirigeLaDCH } from './dossier';
import { ENTETE } from './entete';
import { nouvelleFeuille, type Passage } from './feuille';
import { accords, elide, frDate, insecable, qualiteDCH, type Personne } from './redaction';

/*
 * La domiciliation bancaire, sur le modèle de l'APIX (ADR-0102) : la lettre
 * de qui dirige la DCH à qui dirige la banque de la personne, qui annonce
 * l'ordre de virement irrévocable de son salaire et les engagements de
 * l'APIX. Une page. La DCH renseigne la personne, sa fonction, son contrat et
 * le jour où il a commencé, le jour de sa demande, la banque et le genre de
 * qui la dirige, le RIB, le salaire mensuel net. Les coquilles du modèle sont
 * corrigées (ADR-0095).
 */

/** Ce que la lettre imprime, bloc par bloc. */
export interface TextesDeLaDomiciliation {
  reference: string;
  lieuEtDate: string;
  /** Qui écrit, sous l'en-tête : « Le Directeur du Capital Humain ». */
  timbre: string;
  objet: string;
  /** « Monsieur le Directeur Général, » */
  appel: string;
  paragraphes: Passage[][];
  /** À qui la lettre s'adresse, en bas à gauche : la qualité et la banque. */
  destinataire: string;
}

export interface DomiciliationData {
  fiche: FicheDomiciliation;
  /** Qui dirige la DCH ; null : la place est vacante. */
  dch: Personne | null;
}

/** La lettre, aux mots du modèle de l'APIX, accordée à chacun. */
export function textesDeLaDomiciliation(
  d: DomiciliationData,
  aujourdhui: Date,
): TextesDeLaDomiciliation {
  const f = d.fiche;
  const personne = accords(f.civilite === 'madame' ? 'female' : 'male');
  const e = personne.e;
  const nom = insecable(`${personne.civilite} ${f.prenom} ${f.nom.toLocaleUpperCase('fr-FR')}`);
  const banque = banqueDe(f.banque);
  // « de la CBAO », « d’Ecobank », « de La Banque Agricole » : l'article et
  // l'élision devant le nom, que la lettre met en gras.
  const deLaBanque = elide('d', `${banque.article}${banque.nom}`);
  const devantLaBanque = deLaBanque.slice(0, deLaBanque.length - banque.nom.length);
  const qualite =
    f.destinataire === 'directrice_generale'
      ? 'Madame la Directrice Générale'
      : 'Monsieur le Directeur Général';
  const dch = accords(d.dch?.genre ?? null);
  return {
    reference: ENTETE.referenceDG,
    lieuEtDate: `${ENTETE.ville}, le ${frDate(aujourdhui)}`,
    timbre: `${dch.le} ${qualiteDCH(d.dch?.genre ?? null)}`,
    objet: 'Domiciliation bancaire',
    appel: `${qualite},`,
    paragraphes: [
      [
        { texte: 'Nous vous informons que ' },
        { texte: nom, gras: true },
        {
          texte:
            ', qui fait partie de notre personnel depuis le ' +
            `${insecable(frDate(f.debut))} et qui occupe actuellement la fonction ` +
            `${elide('d', f.poste)} au titre d’un `,
        },
        {
          texte:
            f.contrat === 'cdd' ? 'contrat à durée déterminée' : 'contrat à durée indéterminée',
          gras: true,
        },
        { texte: ', nous a donné, le ' },
        { texte: insecable(frDate(f.demandeLe)), gras: true },
        { texte: ', l’ordre de virement irrévocable à vos caisses, pour en créditer son compte ' },
        { texte: insecable(`n° ${ribGroupe(f.rib)}`), gras: true },
        { texte: ` tenu sur les livres ${devantLaBanque}` },
        { texte: banque.nom, gras: true },
        {
          texte:
            ', toutes sommes pouvant lui être dues par notre Société, à quelque titre que ce ' +
            'soit, notamment son salaire mensuel net qui s’élève actuellement à ' +
            `${enLettres(f.salaire)} `,
        },
        { texte: insecable(`(${enChiffres(f.salaire)}) francs CFA`), gras: true },
        { texte: ', gratifications, indemnités de congés, etc.' },
      ],
      [
        {
          texte:
            'Par la présente, nous nous engageons irrévocablement dans la limite de l’échéance ' +
            'ci-dessus indiquée à exécuter ces instructions qui ne pourront être révoquées ' +
            'qu’avec votre accord exprès donné par écrit ou pour les causes ci-dessous indiquées.',
        },
      ],
      [
        {
          texte:
            `De plus, nous nous interdisons de consentir à l’intéressé${e} une avance sur ` +
            `salaire supérieure à ${insecable('25 %')}, de manière qu’au moins ` +
            `${insecable('75 %')} de ses revenus mensuels parviennent sur son compte.`,
        },
      ],
      [
        {
          texte:
            'Enfin, nous nous engageons à vous aviser immédiatement de tout changement qui ' +
            'surviendrait dans la situation de ',
        },
        { texte: nom, gras: true },
        {
          texte:
            ', en particulier en cas de licenciement ou de démission. Dans cette éventualité, ' +
            'nous reconnaissons que nous serions tenus de reverser aussitôt sur le compte de ' +
            `l’intéressé${e} à ${banque.article}`,
        },
        { texte: banque.nom, gras: true },
        {
          texte:
            ', l’intégralité des sommes dont nous pourrons être redevables envers ' +
            `${e ? 'elle' : 'lui'} à quelque titre que ce soit.`,
        },
      ],
      [
        { texte: 'Veuillez agréer, ' },
        { texte: qualite, gras: true },
        { texte: ', l’assurance de ma considération distinguée.' },
      ],
    ],
    destinataire: `${qualite} ${deLaBanque}`,
  };
}

/**
 * Le retrait du texte de la lettre, depuis la marge de gauche, comme sur le
 * modèle. À droite, le texte va un peu plus loin que sur le modèle : la
 * formule de politesse tient sur sa première ligne jusqu'à « considération »,
 * que la qualité soit « Monsieur le Directeur Général » ou « Madame la
 * Directrice Générale ».
 */
const RETRAIT = 40;

/** La lettre en PDF, sur une page, aux retraits du modèle. */
export function pdfDeLaDomiciliation(
  t: TextesDeLaDomiciliation,
  { logo }: { logo?: string | null } = {},
): Promise<Buffer> {
  const feuille = nouvelleFeuille({
    titre: REQUESTABLE_DOC_LABELS.domiciliation_bancaire,
    logo,
  });
  feuille.entete({ reference: t.reference, lieuEtDate: t.lieuEtDate });
  feuille.timbre(t.timbre, { avant: 45, police: 'comic', taille: 12, retrait: 6 });
  feuille.paragraphe(
    [{ texte: 'Objet', gras: true, souligne: true }, { texte: `${insecable(' :')} ${t.objet}` }],
    { avant: 25, taille: 12, interligne: 0, retrait: 17, align: 'left' },
  );
  feuille.paragraphe([{ texte: t.appel, gras: true }], {
    avant: 27,
    taille: 12,
    interligne: 0,
    retrait: RETRAIT,
    align: 'left',
  });
  t.paragraphes.forEach((p) =>
    feuille.paragraphe(p, {
      avant: 13.8,
      taille: 12,
      interligne: 0,
      retrait: RETRAIT,
      retraitDroit: 4,
    }),
  );
  // Qui dirige la banque, en bas à gauche, à la hauteur du modèle ; au-dessus,
  // la place de la signature.
  feuille.piedAGauche([[{ texte: t.destinataire, gras: true }]], {
    police: 'comic',
    taille: 12,
    pas: 14.4,
    finA: 81.4,
    retrait: 24,
    etiquette: [{ texte: 'À', gras: true }],
  });
  return feuille.terminer();
}

const valider = new ZodValidationPipe(ficheDomiciliationSchema);

/** Ce que la lettre imprimerait aujourd'hui pour cette fiche, sans contrôle des droits. */
export async function textesDeDomiciliationPour(
  tx: Tx,
  corps: unknown,
): Promise<TextesDeLaDomiciliation> {
  return textesDeLaDomiciliation(
    { fiche: valider.transform(corps), dch: await quiDirigeLaDCH(tx) },
    new Date(),
  );
}

/** Le modèle, tel que « Générer des documents » l'appelle (ADR-0085), droits vérifiés. */
export const domiciliationBancaire: ModeleSansAgent = {
  async pdf(tx, corps) {
    const fiche = valider.transform(corps);
    const textes = textesDeLaDomiciliation({ fiche, dch: await quiDirigeLaDCH(tx) }, new Date());
    return {
      filename: nomDuDocumentGenere(
        'domiciliation_bancaire',
        `${fiche.nom.toUpperCase()}-${fiche.prenom}`,
      ),
      pdf: await pdfDeLaDomiciliation(textes),
    };
  },
};
