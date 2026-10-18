import { nomDuDocumentGenere, REQUESTABLE_DOC_LABELS } from '@teranga/contracts';
import { problem } from '../../common/problem';
import type { Tx } from '../../db/tenant-db';
import {
  affectationDeLAgent,
  dossierDeLAgent,
  quiDirigeLaDCH,
  type AffectationDeLAgent,
  type DossierDeLAgent,
} from './dossier';
import { ENTETE } from './entete';
import { pdfDUneAttestation, type Modele, type TextesDUneAttestation } from './feuille';
import {
  A_REMPLIR,
  accords,
  aLUnite,
  frDate,
  insecable,
  nommee,
  qualiteDCH,
  type Personne,
} from './redaction';

/*
 * L'attestation de reprise de service après disponibilité, sur le modèle de
 * l'APIX (ADR-0104) : la mise en page des autres attestations, le numéro de
 * la direction générale, puis l'agent, son poste et son unité au dossier, la
 * période de la disponibilité et le jour de la reprise, que la DCH saisit.
 * Qui atteste dirige la DCH. Les coquilles du modèle sont corrigées
 * (ADR-0095).
 */

export interface RepriseData extends DossierDeLAgent {
  /** L'unité de l'affectation en cours ; null : aucune. */
  affectation: AffectationDeLAgent | null;
  /** Qui atteste : qui dirige la DCH ; null : la place est vacante. */
  signataire: Personne | null;
  /** Le premier jour de la disponibilité, saisi par la DCH. */
  debut: string;
  /** Son dernier jour, saisi par la DCH. */
  fin: string;
  /** Le jour de la reprise de service, saisi par la DCH. */
  reprise: string;
}

/**
 * Les textes de l'attestation, aux mots du modèle de l'APIX. Les noms et le
 * jour de la reprise sont en gras, comme sur le modèle.
 */
export function textesDeLAttestationDeReprise(
  d: RepriseData,
  aujourdhui: Date,
): TextesDUneAttestation {
  const agent = accords(d.agent.genre);
  const signataire = accords(d.signataire?.genre ?? null);
  const qualite = qualiteDCH(d.signataire?.genre ?? null);
  // « , Chargée d'études à la Direction du Capital Humain » : le poste, et
  // l'unité quand le dossier la porte. Qui dirige l'unité a un poste qui la
  // nomme déjà : « , Cheffe du département Études ».
  const a = d.affectation;
  const unite = a && !a.responsable ? ` ${aLUnite(a.unite.nom, a.unite.type)}` : '';
  const emploi = d.poste ? `, ${d.poste}${unite}` : '';
  return {
    reference: ENTETE.referenceDG,
    lieuEtDate: `${ENTETE.ville}, le ${frDate(aujourdhui)}`,
    timbre: `${signataire.le} ${qualite}`,
    titre: 'ATTESTATION DE REPRISE DE SERVICE',
    paragraphes: [
      [
        { texte: `Je soussigné${signataire.e}, ` },
        d.signataire ? nommee(d.signataire) : { texte: A_REMPLIR },
        { texte: `, ${qualite}, atteste par la présente que ` },
        nommee(d.agent),
        {
          texte:
            `${emploi}, mis${agent.e} en disponibilité pour la période allant du ` +
            `${insecable(frDate(d.debut))} au ${insecable(frDate(d.fin))}, a repris service le `,
        },
        { texte: insecable(frDate(d.reprise)), gras: true },
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
export function pdfDeLAttestationDeReprise(
  textes: TextesDUneAttestation,
  { logo }: { logo?: string | null } = {},
): Promise<Buffer> {
  return pdfDUneAttestation(textes, {
    titre: REQUESTABLE_DOC_LABELS.attestation_reprise_disponibilite,
    logo,
  });
}

/** Les dates saisies, contrôlées : toutes là, la fin après le début, la reprise après le début. */
function dates(debut?: string, fin?: string, reprise?: string) {
  if (!debut || !fin || !reprise) {
    problem(400, 'documents.dates', 'Dates de la disponibilité et de la reprise à saisir');
  }
  if (fin < debut) problem(400, 'documents.dates', 'La fin de la disponibilité précède son début');
  if (reprise <= debut) {
    problem(
      400,
      'documents.dates',
      'La reprise de service ne suit pas le début de la disponibilité',
    );
  }
  return { debut, fin, reprise };
}

async function donnees(
  tx: Tx,
  employeeId: string,
  saisies: { debut: string; fin: string; reprise: string },
): Promise<RepriseData> {
  return {
    ...(await dossierDeLAgent(tx, employeeId, 'Attestation de reprise de service')),
    affectation: await affectationDeLAgent(tx, employeeId),
    signataire: await quiDirigeLaDCH(tx),
    ...saisies,
  };
}

/** Ce que l'attestation imprimerait aujourd'hui pour ce dossier et ces dates, sans contrôle des droits. */
export async function textesDeReprisePour(
  tx: Tx,
  employeeId: string,
  saisies: { debut?: string; fin?: string; reprise?: string },
): Promise<TextesDUneAttestation> {
  const { debut, fin, reprise } = saisies;
  return textesDeLAttestationDeReprise(
    await donnees(tx, employeeId, dates(debut, fin, reprise)),
    new Date(),
  );
}

/** Le modèle, tel que « Générer des documents » l'appelle (ADR-0085), droits vérifiés. */
export const attestationDeReprise: Modele = {
  async pdf(tx, employeeId, { debut, fin, reprise }) {
    const d = await donnees(tx, employeeId, dates(debut, fin, reprise));
    return {
      filename: nomDuDocumentGenere('attestation_reprise_disponibilite', d.employeeNumber),
      pdf: await pdfDeLAttestationDeReprise(textesDeLAttestationDeReprise(d, new Date())),
    };
  },
};
