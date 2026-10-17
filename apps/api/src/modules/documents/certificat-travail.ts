import { nomDuDocumentGenere } from '@teranga/contracts';
import { problem } from '../../common/problem';
import type { Tx } from '../../db/tenant-db';
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
 */

export interface CertificatData extends EmploiDeLAgent {
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

/** Ce que le certificat imprimerait aujourd'hui pour ce dossier et cette catégorie, sans contrôle des droits. */
export async function textesDeCertificatPour(
  tx: Tx,
  employeeId: string,
  categorie: string,
): Promise<TextesDUneAttestation> {
  return textesDuCertificatDeTravail(await donnees(tx, employeeId, categorie), new Date());
}

/**
 * Le modèle, tel que « Générer des documents » l'appelle (ADR-0085), droits
 * vérifiés. Sans catégorie, pas de certificat : le dossier ne la porte pas.
 */
export const certificatDeTravail: Modele = {
  async pdf(tx, employeeId, { categorie }) {
    if (!categorie) {
      problem(400, 'documents.categorie', 'Catégorie du poste à saisir');
    }
    const d = await donnees(tx, employeeId, categorie);
    return {
      filename: nomDuDocumentGenere('certificat_travail', d.employeeNumber),
      pdf: await pdfDuCertificatDeTravail(textesDuCertificatDeTravail(d, new Date())),
    };
  },
};

async function donnees(tx: Tx, employeeId: string, categorie: string): Promise<CertificatData> {
  return {
    ...(await emploiDeLAgent(tx, employeeId)),
    signataire: await quiDirigeLeSommet(tx),
    categorie,
  };
}
