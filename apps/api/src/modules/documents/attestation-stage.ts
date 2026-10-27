import { nomDuDocumentGenere } from '@teranga/contracts';
import type { Tx } from '../../db/tenant-db';
import { quiDirigeLaDCH, stageDeLAgent, type StageDeLAgent } from './dossier';
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
 * L'attestation de stage, sur le modèle officiel de l'APIX (ADR-0089) : la
 * mise en page des autres attestations, le numéro de la direction générale,
 * puis le stage, ses dates et le poste occupé. Qui atteste dirige la DCH.
 * Le dossier compte-t-il plusieurs stages, la DCH choisit celui que
 * l'attestation cite (ADR-0132).
 */

export interface StageData extends StageDeLAgent {
  /** Qui atteste : qui dirige la DCH ; null : la place est vacante. */
  signataire: Personne | null;
}

/**
 * Les textes de l'attestation, aux mots du modèle de l'APIX. Les noms et les
 * dates du stage sont en gras, comme sur le modèle ; le poste ne l'est pas.
 */
export function textesDeLAttestationDeStage(d: StageData, aujourdhui: Date): TextesDUneAttestation {
  const agent = accords(d.agent.genre);
  const signataire = accords(d.signataire?.genre ?? null);
  const qualite = qualiteDCH(d.signataire?.genre ?? null);
  return {
    reference: ENTETE.referenceDG,
    lieuEtDate: `${ENTETE.ville}, le ${frDate(aujourdhui)}`,
    timbre: `${signataire.le} ${qualite}`,
    titre: 'ATTESTATION DE STAGE',
    paragraphes: [
      [
        { texte: `Je soussigné${signataire.e}, ` },
        d.signataire ? nommee(d.signataire) : { texte: A_REMPLIR },
        { texte: `, ${qualite}, atteste par la présente que ` },
        nommee(d.agent),
        { texte: ' a effectué un stage sur la période allant du ' },
        { texte: insecable(frDate(d.debut)), gras: true },
        { texte: ' au ' },
        // Une fin que rien ne fixe encore se porte à la main.
        { texte: d.fin ? insecable(frDate(d.fin)) : A_REMPLIR, gras: true },
        { texte: d.poste ? `, ${elide('en qualité d', d.poste)}.` : '.' },
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
export function pdfDeLAttestationDeStage(
  textes: TextesDUneAttestation,
  { logo }: { logo?: string | null } = {},
): Promise<Buffer> {
  return pdfDUneAttestation(textes, { titre: 'Attestation de stage', logo });
}

/**
 * Ce que l'attestation imprimerait aujourd'hui pour ce dossier, sans contrôle
 * des droits ; `debut` : le premier jour du stage cité.
 */
export async function textesDeStagePour(
  tx: Tx,
  employeeId: string,
  debut?: string,
): Promise<TextesDUneAttestation> {
  return textesDeLAttestationDeStage(await donnees(tx, employeeId, debut), new Date());
}

/** Le modèle, tel que « Générer des documents » l'appelle (ADR-0085), droits vérifiés. */
export const attestationDeStage: Modele = {
  async pdf(tx, employeeId, { stage }) {
    const d = await donnees(tx, employeeId, stage);
    return {
      filename: nomDuDocumentGenere('attestation_stage', d.employeeNumber),
      pdf: await pdfDeLAttestationDeStage(textesDeLAttestationDeStage(d, new Date())),
    };
  },
};

async function donnees(tx: Tx, employeeId: string, debut?: string): Promise<StageData> {
  return {
    ...(await stageDeLAgent(tx, employeeId, debut)),
    signataire: await quiDirigeLaDCH(tx),
  };
}
