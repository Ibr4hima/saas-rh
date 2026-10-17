import { enChiffres, enLettres, nomDuDocumentGenere } from '@teranga/contracts';
import { problem } from '../../common/problem';
import type { Tx } from '../../db/tenant-db';
import { dossierDeLAgent, quiDirigeLaDCH, type DossierDeLAgent } from './dossier';
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
 * L'attestation de revenu, sur le modèle officiel de l'APIX (ADR-0087) : la
 * mise en page de l'attestation de travail, le numéro de la direction
 * générale, et le salaire net mensuel, que la DCH saisit, en chiffres puis
 * en lettres. Qui atteste dirige la DCH.
 */

export interface RevenuData extends DossierDeLAgent {
  /** Qui atteste : qui dirige la DCH ; null : la place est vacante. */
  signataire: Personne | null;
  /** Le salaire net mensuel, en francs CFA, saisi par la DCH. */
  salaire: number;
}

/** Le numéro du modèle : l'attestation de revenu passe par la direction générale. */
const REFERENCE = '/PR/SG/APIX/DG/DCH';

/**
 * Les textes de l'attestation, aux mots du modèle de l'APIX. Les noms, la
 * date d'entrée et le montant sont en gras (ADR-0088).
 */
export function textesDeLAttestationDeRevenu(
  d: RevenuData,
  aujourdhui: Date,
): TextesDUneAttestation {
  const agent = accords(d.agent.genre);
  const signataire = accords(d.signataire?.genre ?? null);
  const qualite = auGenre(
    d.signataire?.genre ?? null,
    'Directeur du Capital Humain',
    'Directrice du Capital Humain',
  );
  // « 250 000 (deux cent cinquante mille) francs CFA » : les chiffres et
  // l'unité ne se coupent pas, les lettres passent à la ligne au besoin.
  const montant = `${enChiffres(d.salaire)} (${enLettres(d.salaire)}) ${insecable('francs CFA')}`;
  return {
    reference: REFERENCE,
    lieuEtDate: `${ENTETE.ville}, le ${frDate(aujourdhui)}`,
    timbre: `${signataire.le} ${qualite}`,
    titre: 'ATTESTATION DE REVENU',
    paragraphes: [
      [
        { texte: `Je soussigné${signataire.e}, ` },
        d.signataire ? nommee(d.signataire) : { texte: A_REMPLIR },
        { texte: `, ${qualite}, atteste par la présente que ` },
        nommee(d.agent),
        { texte: ` est employé${agent.e} à ${ENTETE.sigle} depuis le ` },
        { texte: insecable(frDate(d.depuis)), gras: true },
        { texte: '.' },
      ],
      [
        {
          texte: d.poste
            ? `${agent.pronom} occupe actuellement ${elide('la fonction d', d.poste)} et perçoit un salaire net mensuel de `
            : `${agent.pronom} perçoit un salaire net mensuel de `,
        },
        { texte: montant, gras: true },
        { texte: '.' },
      ],
      [
        {
          texte:
            'En foi de quoi, la présente attestation est établie pour servir et valoir ce que de droit.',
        },
      ],
    ],
  };
}

/** L'attestation en PDF, sur la feuille de la DCH. */
export function pdfDeLAttestationDeRevenu(
  textes: TextesDUneAttestation,
  { logo }: { logo?: string | null } = {},
): Promise<Buffer> {
  return pdfDUneAttestation(textes, { titre: 'Attestation de revenu', logo });
}

/** Ce que l'attestation imprimerait aujourd'hui pour ce dossier et ce salaire, sans contrôle des droits. */
export async function textesDeRevenuPour(
  tx: Tx,
  employeeId: string,
  salaire: number,
): Promise<TextesDUneAttestation> {
  return textesDeLAttestationDeRevenu(await donnees(tx, employeeId, salaire), new Date());
}

/**
 * Le modèle, tel que « Générer des documents » l'appelle (ADR-0085), droits
 * vérifiés. Sans salaire, pas d'attestation : le dossier ne le porte pas.
 */
export const attestationDeRevenu: Modele = {
  async pdf(tx, employeeId, { salaire }) {
    if (salaire === undefined) {
      problem(400, 'documents.salaire', 'Salaire net mensuel à saisir');
    }
    const d = await donnees(tx, employeeId, salaire);
    return {
      filename: nomDuDocumentGenere('attestation_revenu', d.employeeNumber),
      pdf: await pdfDeLAttestationDeRevenu(textesDeLAttestationDeRevenu(d, new Date())),
    };
  },
};

async function donnees(tx: Tx, employeeId: string, salaire: number): Promise<RevenuData> {
  return {
    ...(await dossierDeLAgent(tx, employeeId, 'Attestation de revenu')),
    signataire: await quiDirigeLaDCH(tx),
    salaire,
  };
}
