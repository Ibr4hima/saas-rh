import {
  ficheDuCertificatDeTravailSchema,
  nomDuDocumentGenere,
  type FicheDuCertificatDeTravail,
} from '@teranga/contracts';
import { problem } from '../../common/problem';
import { ZodValidationPipe } from '../../common/zod.pipe';
import type { Tx } from '../../db/tenant-db';
import type { ModeleSansAgent } from './contrat-stage';
import { emploiDeLAgent, quiDirigeLeSommet, type EmploiDeLAgent } from './dossier';
import { ENTETE } from './entete';
import { pdfDUneAttestation, type Modele, type TextesDUneAttestation } from './feuille';
import {
  A_REMPLIR,
  accords,
  auGenre,
  elide,
  frDate,
  insecable,
  nommee,
  type Personne,
} from './redaction';

/*
 * Le certificat de travail, sur le modèle officiel de l'APIX (ADR-0091) : la
 * mise en page des attestations, le numéro de la direction générale, puis
 * l'emploi, ses dates et le dernier poste occupé, et la catégorie de ce
 * poste, que la DCH saisit. Qui certifie dirige le sommet de l'organigramme.
 *
 * Il se délivre au départ, ou se prépare avant pour un agent encore en poste :
 * la DCH saisit alors le dernier jour que prévoit son départ (ADR-0176). Pour
 * une personne sans dossier dans l'application, partie il y a dix ans par
 * exemple, la DCH renseigne une fiche : la personne, l'emploi, le poste et sa
 * catégorie.
 */

export interface CertificatData extends Omit<EmploiDeLAgent, 'employeeNumber'> {
  /** Qui certifie : qui dirige le sommet de l'organigramme ; null : la place est vacante. */
  signataire: Personne | null;
  /** La catégorie du poste dans la convention collective, saisie par la DCH. */
  categorie: string;
}

/**
 * Les textes du certificat, aux mots du modèle de l'APIX, corrigé : la
 * catégorie suit le mot, en capitales quelle que soit la saisie, « classé à la
 * catégorie 7B ». Les noms et les dates sont en gras, comme sur le modèle.
 */
export function textesDuCertificatDeTravail(
  d: CertificatData,
  aujourdhui: Date,
): TextesDUneAttestation {
  const agent = accords(d.agent.genre);
  const signataire = accords(d.signataire?.genre ?? null);
  const qualite = auGenre(d.signataire?.genre ?? null, 'Directeur Général', 'Directrice Générale');
  return {
    reference: ENTETE.referenceDG,
    lieuEtDate: `${ENTETE.ville}, le ${frDate(aujourdhui)}`,
    timbre: `${signataire.le} ${qualite}`,
    titre: 'CERTIFICAT DE TRAVAIL',
    paragraphes: [
      [
        { texte: `Je soussigné${signataire.e}, ` },
        d.signataire ? nommee(d.signataire) : { texte: A_REMPLIR },
        { texte: `, ${qualite} de la Société ${ENTETE.sigle}, certifie que ` },
        nommee(d.agent),
        { texte: ` a été employé${agent.e} à ${ENTETE.sigle}, sur la période allant du ` },
        { texte: insecable(frDate(d.debut)), gras: true },
        { texte: ' au ' },
        { texte: d.fin ? insecable(frDate(d.fin)) : A_REMPLIR, gras: true },
        { texte: d.poste ? `, ${elide('en qualité d', d.poste)}.` : '.' },
      ],
      [
        {
          texte:
            `${d.poste ? elide('Ce poste d', d.poste) : 'Ce poste'} est classé à la ` +
            `${insecable(`catégorie ${d.categorie.toLocaleUpperCase('fr-FR')}`)} de la Convention Collective du Commerce.`,
        },
      ],
      [
        {
          texte:
            'En foi de quoi, le présent certificat est établi pour servir et valoir ce que de droit.',
        },
      ],
    ],
  };
}

/** Le certificat en PDF, sur la feuille de la DCH. */
export function pdfDuCertificatDeTravail(
  textes: TextesDUneAttestation,
  { logo }: { logo?: string | null } = {},
): Promise<Buffer> {
  return pdfDUneAttestation(textes, { titre: 'Certificat de travail', logo });
}

/**
 * Ce que le certificat imprimerait aujourd'hui pour ce dossier et cette
 * catégorie, sans contrôle des droits ; `fin` : le dernier jour saisi d'un
 * agent encore en poste.
 */
export async function textesDeCertificatPour(
  tx: Tx,
  employeeId: string,
  categorie: string,
  fin?: string,
): Promise<TextesDUneAttestation> {
  return textesDuCertificatDeTravail(await donnees(tx, employeeId, categorie, fin), new Date());
}

/**
 * Le modèle, tel que « Générer des documents » l'appelle (ADR-0085), droits
 * vérifiés. Sans catégorie, pas de certificat : le dossier ne la porte pas.
 * Sans dernier jour, pas de certificat pour un agent en poste.
 */
export const certificatDeTravail: Modele = {
  async pdf(tx, employeeId, { categorie, fin }) {
    if (!categorie) {
      problem(400, 'documents.categorie', 'Catégorie du poste à saisir');
    }
    const d = await donnees(tx, employeeId, categorie, fin);
    return {
      filename: nomDuDocumentGenere('certificat_travail', d.employeeNumber),
      pdf: await pdfDuCertificatDeTravail(textesDuCertificatDeTravail(d, new Date())),
    };
  },
};

async function donnees(
  tx: Tx,
  employeeId: string,
  categorie: string,
  fin?: string,
): Promise<CertificatData & { employeeNumber: string }> {
  return {
    ...(await emploiDeLAgent(tx, employeeId, fin)),
    signataire: await quiDirigeLeSommet(tx),
    categorie,
  };
}

/** La fiche d'une personne sans dossier, validée : ce que la page envoie, comme une route le ferait. */
const valider = new ZodValidationPipe(ficheDuCertificatDeTravailSchema);

/** Ce que le certificat imprimerait aujourd'hui pour cette fiche, sans contrôle des droits. */
export async function textesDeCertificatHorsDossierPour(
  tx: Tx,
  corps: unknown,
): Promise<TextesDUneAttestation> {
  return textesDuCertificatDeTravail(await depuisLaFiche(tx, valider.transform(corps)), new Date());
}

/**
 * Le certificat d'une personne sans dossier dans l'application, d'après la
 * fiche que la DCH renseigne (ADR-0176), droits vérifiés.
 */
export const certificatHorsDossier: ModeleSansAgent = {
  async pdf(tx, corps) {
    const fiche = valider.transform(corps);
    const textes = textesDuCertificatDeTravail(await depuisLaFiche(tx, fiche), new Date());
    return {
      filename: nomDuDocumentGenere(
        'certificat_travail',
        `${fiche.nom.toUpperCase()}-${fiche.prenom}`,
      ),
      pdf: await pdfDuCertificatDeTravail(textes),
    };
  },
};

async function depuisLaFiche(tx: Tx, f: FicheDuCertificatDeTravail): Promise<CertificatData> {
  return {
    agent: {
      nom: `${f.prenom} ${f.nom.toUpperCase()}`,
      genre: f.civilite === 'madame' ? 'female' : 'male',
    },
    debut: f.debut,
    fin: f.fin,
    poste: f.poste,
    signataire: await quiDirigeLeSommet(tx),
    categorie: f.categorie,
  };
}
