import { sql } from 'drizzle-orm';
import { datesEnfreintes, nomDuDocumentGenere } from '@teranga/contracts';
import { problem } from '../../common/problem';
import type { Tx } from '../../db/tenant-db';
import type { AbsencesService } from '../time/absences.service';
import { premierJourOuvreApres } from '../time/workdays';
import { dossierDeLAgent, quiDirigeLaDCH, type DossierDeLAgent } from './dossier';
import { ENTETE } from './entete';
import { pdfDUneAttestation, type Modele, type TextesDUneAttestation } from './feuille';
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
 * L'attestation de congé, sur le modèle officiel de l'APIX (ADR-0092) : la
 * mise en page des autres attestations, le numéro de la direction générale,
 * puis le congé, du premier jour que la DCH saisit à la reprise de service.
 * Qui atteste dirige la DCH.
 */

export interface CongeData extends DossierDeLAgent {
  /** Qui atteste : qui dirige la DCH ; null : la place est vacante. */
  signataire: Personne | null;
  /** Le premier jour du congé, saisi par la DCH. */
  debut: string;
  /** La reprise de service : le premier jour ouvré après le dernier jour du congé ; null : introuvable. */
  reprise: string | null;
}

/**
 * Les textes de l'attestation, aux mots du modèle de l'APIX. Les noms et les
 * dates sont en gras, comme sur le modèle ; la reprise porte son jour de la
 * semaine, « mercredi 30 septembre 2026 ».
 */
export function textesDeLAttestationDeConge(d: CongeData, aujourdhui: Date): TextesDUneAttestation {
  const agent = accords(d.agent.genre);
  const signataire = accords(d.signataire?.genre ?? null);
  const qualite = qualiteDCH(d.signataire?.genre ?? null);
  return {
    reference: ENTETE.referenceDG,
    lieuEtDate: `${ENTETE.ville}, le ${frDate(aujourdhui)}`,
    timbre: `${signataire.le} ${qualite}`,
    titre: 'ATTESTATION DE CONGÉ',
    paragraphes: [
      [
        { texte: `Je soussigné${signataire.e}, ` },
        d.signataire ? nommee(d.signataire) : { texte: A_REMPLIR },
        { texte: `, ${qualite}, atteste par la présente que ` },
        nommee(d.agent),
        {
          texte: `${d.poste ? `, ${d.poste},` : ''} jouira de ses congés administratifs à partir du `,
        },
        { texte: insecable(frDate(d.debut)), gras: true },
        { texte: '.' },
      ],
      [
        { texte: `${agent.pronom} reprendra service le ` },
        { texte: d.reprise ? insecable(frDateAvecJour(d.reprise)) : A_REMPLIR, gras: true },
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
export function pdfDeLAttestationDeConge(
  textes: TextesDUneAttestation,
  { logo }: { logo?: string | null } = {},
): Promise<Buffer> {
  return pdfDUneAttestation(textes, { titre: 'Attestation de congé', logo });
}

/** Ce que l'attestation imprimerait aujourd'hui pour ce dossier et ce congé, sans contrôle des droits. */
export async function textesDeCongePour(
  tx: Tx,
  absences: AbsencesService,
  employeeId: string,
  debut: string,
  fin: string,
): Promise<TextesDUneAttestation> {
  return textesDeLAttestationDeConge(
    await donnees(tx, absences, employeeId, debut, fin),
    new Date(),
  );
}

/**
 * Le modèle, tel que « Générer des documents » l'appelle (ADR-0085), droits
 * vérifiés. Il lit le calendrier des fériés de l'APIX, que tient le module
 * des absences.
 */
export function attestationDeConge(absences: AbsencesService): Modele {
  return {
    async pdf(tx, employeeId, { debut, fin }) {
      if (!debut || !fin) problem(400, 'documents.dates', 'Dates du congé à saisir');
      if (datesEnfreintes('attestation_conge', { debut, fin }).fin) {
        problem(400, 'documents.dates', 'Le dernier jour du congé suit le premier');
      }
      const d = await donnees(tx, absences, employeeId, debut, fin);
      return {
        filename: nomDuDocumentGenere('attestation_conge', d.employeeNumber),
        pdf: await pdfDeLAttestationDeConge(textesDeLAttestationDeConge(d, new Date())),
      };
    },
  };
}

/**
 * La reprise de service : le premier jour ouvré après le dernier jour du
 * congé, ni samedi, ni dimanche, ni férié de l'APIX. Les fériés de la période
 * sont semés avant d'être lus, comme pour une demande de congé : le 1er
 * janvier d'une année que personne n'a encore ouverte compte aussi.
 */
async function jourDeReprise(
  tx: Tx,
  absences: AbsencesService,
  fin: string,
): Promise<string | null> {
  const { rows } = await tx.execute<{ tenant: string; borne: string }>(sql`
    SELECT current_setting('app.tenant_id') AS tenant, (${fin}::date + 31)::text AS borne`);
  const { tenant, borne } = rows[0]!;
  await absences.semerLaPeriode(tx, tenant, fin, borne);
  const { rows: feries } = await tx.execute<{ jour: string }>(sql`
    SELECT day::text AS jour FROM holidays
     WHERE day > ${fin}::date AND day <= ${borne}::date`);
  return premierJourOuvreApres(fin, new Set(feries.map((f) => f.jour)));
}

async function donnees(
  tx: Tx,
  absences: AbsencesService,
  employeeId: string,
  debut: string,
  fin: string,
): Promise<CongeData> {
  return {
    ...(await dossierDeLAgent(tx, employeeId, 'Attestation de congé')),
    signataire: await quiDirigeLaDCH(tx),
    debut,
    reprise: await jourDeReprise(tx, absences, fin),
  };
}
