import { nomDuDocumentGenere } from '@teranga/contracts';
import { problem } from '../../common/problem';
import type { Tx } from '../../db/tenant-db';
import { dossierDeLAgent, quiDirigeLaDCH, type DossierDeLAgent } from './dossier';
import { ENTETE } from './entete';
import { pdfDUneAttestation, type Modele, type TextesDUneAttestation } from './feuille';
import {
  A_REMPLIR,
  accords,
  elide,
  frDate,
  insecable,
  nommee,
  qualiteDCH,
  type Personne,
} from './redaction';

/*
 * L'attestation de départ à la retraite, sur le modèle officiel de l'APIX
 * (ADR-0093) : la mise en page des autres attestations, le numéro de la
 * direction générale, l'agent et sa date d'entrée, sa fonction, puis le jour
 * du départ, que la DCH saisit. Qui atteste dirige la DCH.
 */

export interface RetraiteData extends DossierDeLAgent {
  /** Qui atteste : qui dirige la DCH ; null : la place est vacante. */
  signataire: Personne | null;
  /** Le jour du départ à la retraite, saisi par la DCH. */
  depart: string;
}

/**
 * Les textes de l'attestation, aux mots du modèle de l'APIX. Les noms et les
 * dates sont en gras, comme sur le modèle ; la fonction ne l'est pas.
 */
export function textesDeLAttestationDeRetraite(
  d: RetraiteData,
  aujourdhui: Date,
): TextesDUneAttestation {
  const agent = accords(d.agent.genre);
  const signataire = accords(d.signataire?.genre ?? null);
  const qualite = qualiteDCH(d.signataire?.genre ?? null);
  return {
    reference: ENTETE.referenceDG,
    lieuEtDate: `${ENTETE.ville}, le ${frDate(aujourdhui)}`,
    timbre: `${signataire.le} ${qualite}`,
    titre: 'ATTESTATION DE DÉPART À LA RETRAITE',
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
            ? `${agent.pronom} occupe actuellement ${elide('la fonction d', d.poste)}, et fera valoir ses droits à la retraite le `
            : `${agent.pronom} fera valoir ses droits à la retraite le `,
        },
        { texte: insecable(frDate(d.depart)), gras: true },
        { texte: '.' },
      ],
      [
        {
          texte: `En foi de quoi, la présente attestation est délivrée à l’intéressé${agent.e} pour servir et valoir ce que de droit.`,
        },
      ],
    ],
  };
}

/** L'attestation en PDF, sur la feuille de la DCH. */
export function pdfDeLAttestationDeRetraite(
  textes: TextesDUneAttestation,
  { logo }: { logo?: string | null } = {},
): Promise<Buffer> {
  return pdfDUneAttestation(textes, { titre: 'Attestation de départ à la retraite', logo });
}

/** Ce que l'attestation imprimerait aujourd'hui pour ce dossier et ce départ, sans contrôle des droits. */
export async function textesDeRetraitePour(
  tx: Tx,
  employeeId: string,
  depart: string,
): Promise<TextesDUneAttestation> {
  return textesDeLAttestationDeRetraite(await donnees(tx, employeeId, depart), new Date());
}

/**
 * Le modèle, tel que « Générer des documents » l'appelle (ADR-0085), droits
 * vérifiés. Sans le jour du départ, pas d'attestation : le dossier ne le
 * porte pas.
 */
export const attestationDeRetraite: Modele = {
  async pdf(tx, employeeId, { depart }) {
    if (!depart) problem(400, 'documents.depart', 'Date de départ à la retraite à saisir');
    const d = await donnees(tx, employeeId, depart);
    return {
      filename: nomDuDocumentGenere('attestation_depart_retraite', d.employeeNumber),
      pdf: await pdfDeLAttestationDeRetraite(textesDeLAttestationDeRetraite(d, new Date())),
    };
  },
};

async function donnees(tx: Tx, employeeId: string, depart: string): Promise<RetraiteData> {
  return {
    ...(await dossierDeLAgent(tx, employeeId, 'Attestation de départ à la retraite')),
    signataire: await quiDirigeLaDCH(tx),
    depart,
  };
}
