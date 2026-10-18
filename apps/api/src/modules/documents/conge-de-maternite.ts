import { nomDuDocumentGenere, REQUESTABLE_DOC_LABELS } from '@teranga/contracts';
import { problem } from '../../common/problem';
import type { Tx } from '../../db/tenant-db';
import { dossierDeLAgent, quiDirigeLaDCH, type DossierDeLAgent } from './dossier';
import { ENTETE } from './entete';
import {
  pdfDUneAttestation,
  type Modele,
  type Passage,
  type TextesDUneAttestation,
} from './feuille';
import {
  A_REMPLIR,
  accords,
  frDate,
  frDateAvecJour,
  insecable,
  nommee,
  qualiteDCH,
  type Personne,
} from './redaction';

/*
 * Les attestations du congé de maternité, sur les modèles de l'APIX
 * (ADR-0105) : la cessation de paiement et d'activités, qui suspend le
 * salaire au premier jour du congé, puis la reprise de service, au retour.
 * La mise en page des autres attestations, le numéro de la direction
 * générale ; le dossier donne le nom et le poste, la DCH saisit le jour. Qui
 * atteste dirige la DCH. Les coquilles des modèles sont corrigées
 * (ADR-0095).
 */

export interface CongeDeMaterniteData extends DossierDeLAgent {
  /** Qui atteste : qui dirige la DCH ; null : la place est vacante. */
  signataire: Personne | null;
  /** Le jour saisi par la DCH : la suspension du salaire, ou la reprise de service. */
  jour: string;
}

/** « Je soussignée, Madame …, Directrice du Capital Humain, atteste par la présente que » */
function soussigne(d: CongeDeMaterniteData): Passage[] {
  const signataire = accords(d.signataire?.genre ?? null);
  return [
    { texte: `Je soussigné${signataire.e}, ` },
    d.signataire ? nommee(d.signataire) : { texte: A_REMPLIR },
    { texte: `, ${qualiteDCH(d.signataire?.genre ?? null)}, atteste par la présente que ` },
  ];
}

/** L'en-tête et le timbre de qui atteste, communs aux deux attestations. */
function entete(d: CongeDeMaterniteData, aujourdhui: Date) {
  const signataire = accords(d.signataire?.genre ?? null);
  return {
    reference: ENTETE.referenceDG,
    lieuEtDate: `${ENTETE.ville}, le ${frDate(aujourdhui)}`,
    timbre: `${signataire.le} ${qualiteDCH(d.signataire?.genre ?? null)}`,
  };
}

const EN_FOI: Passage[] = [
  {
    texte:
      'En foi de quoi, la présente attestation est établie pour servir et valoir ce que de droit.',
  },
];

/**
 * La cessation de paiement et d'activités : le salaire suspendu à compter du
 * jour saisi, pour les congés de maternité ; le certificat médical en pièce
 * jointe. Les noms et le jour sont en gras, comme sur le modèle.
 */
export function textesDeLaCessation(
  d: CongeDeMaterniteData,
  aujourdhui: Date,
): TextesDUneAttestation {
  return {
    ...entete(d, aujourdhui),
    titre: 'ATTESTATION DE CESSATION DE PAIEMENT ET\nD’ACTIVITÉS',
    paragraphes: [
      [
        ...soussigne(d),
        { texte: 'le salaire de ' },
        nommee(d.agent),
        { texte: `${d.poste ? `, ${d.poste},` : ''} est suspendu à compter du ` },
        { texte: insecable(frDate(d.jour)), gras: true },
        { texte: ', pour jouissance de ses congés de maternité.' },
      ],
      EN_FOI,
    ],
    pieceJointe: 'Certificat médical',
  };
}

/**
 * La reprise de service, au retour des congés de maternité : le jour saisi,
 * écrit avec son jour de la semaine, « lundi 5 octobre 2026 ». Les noms et le
 * jour sont en gras, comme sur le modèle.
 */
export function textesDeLaRepriseDeService(
  d: CongeDeMaterniteData,
  aujourdhui: Date,
): TextesDUneAttestation {
  return {
    ...entete(d, aujourdhui),
    titre: 'ATTESTATION DE REPRISE DE SERVICE',
    paragraphes: [
      [
        ...soussigne(d),
        nommee(d.agent),
        { texte: `${d.poste ? `, ${d.poste},` : ''} a repris service le ` },
        { texte: insecable(frDateAvecJour(d.jour)), gras: true },
        { texte: ', suite à ses congés de maternité.' },
      ],
      EN_FOI,
    ],
  };
}

/**
 * Le dossier, et le jour saisi. Les modèles attestent un congé de maternité :
 * un dossier au genre masculin est refusé, en le disant.
 */
async function donnees(
  tx: Tx,
  employeeId: string,
  document: string,
  jour: string | undefined,
  manque: string,
): Promise<CongeDeMaterniteData> {
  if (!jour) problem(400, 'documents.dates', manque);
  const dossier = await dossierDeLAgent(tx, employeeId, document);
  if (dossier.agent.genre === 'male') {
    problem(
      422,
      'documents.maternite',
      `${document} : congé de maternité`,
      'Le dossier de l’agent porte le genre masculin.',
    );
  }
  return { ...dossier, signataire: await quiDirigeLaDCH(tx), jour };
}

const CESSATION = 'Attestation de cessation de paiement';
const REPRISE = 'Attestation de reprise de service';

/** Ce que la cessation imprimerait aujourd'hui, sans contrôle des droits. */
export async function textesDeCessationPour(
  tx: Tx,
  employeeId: string,
  debut?: string,
): Promise<TextesDUneAttestation> {
  const d = await donnees(tx, employeeId, CESSATION, debut, 'Premier jour du congé à saisir');
  return textesDeLaCessation(d, new Date());
}

/** Ce que la reprise de service imprimerait aujourd'hui, sans contrôle des droits. */
export async function textesDeRepriseDeServicePour(
  tx: Tx,
  employeeId: string,
  reprise?: string,
): Promise<TextesDUneAttestation> {
  const d = await donnees(tx, employeeId, REPRISE, reprise, 'Jour de la reprise à saisir');
  return textesDeLaRepriseDeService(d, new Date());
}

/** La cessation, telle que « Générer des documents » l'appelle (ADR-0085), droits vérifiés. */
export const attestationDeCessation: Modele = {
  async pdf(tx, employeeId, { debut }) {
    const d = await donnees(tx, employeeId, CESSATION, debut, 'Premier jour du congé à saisir');
    return {
      filename: nomDuDocumentGenere('attestation_cessation', d.employeeNumber),
      pdf: await pdfDUneAttestation(textesDeLaCessation(d, new Date()), {
        titre: REQUESTABLE_DOC_LABELS.attestation_cessation,
      }),
    };
  },
};

/** La reprise de service, telle que « Générer des documents » l'appelle, droits vérifiés. */
export const attestationDeRepriseDeService: Modele = {
  async pdf(tx, employeeId, { reprise }) {
    const d = await donnees(tx, employeeId, REPRISE, reprise, 'Jour de la reprise à saisir');
    return {
      filename: nomDuDocumentGenere('attestation_reprise_service', d.employeeNumber),
      pdf: await pdfDUneAttestation(textesDeLaRepriseDeService(d, new Date()), {
        titre: REQUESTABLE_DOC_LABELS.attestation_reprise_service,
      }),
    };
  },
};
