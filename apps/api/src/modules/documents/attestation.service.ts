import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { SessionUser } from '@teranga/contracts';
import { capaciteDuDocument, nomDuDocumentGenere } from '@teranga/contracts';
import { agentDuCompte, directionDuPersonnel, pasSurSoi } from '../acces/dch';
import { vueDuTraitement } from '../acces/demandes';
import { problem } from '../../common/problem';
import { TenantDb, Tx } from '../../db/tenant-db';
import { dossierDeLAgent, quiDirigeLeSommet, type DossierDeLAgent } from './dossier';
import { ENTETE } from './entete';
import { pdfDUneAttestation, type DocumentPdf, type TextesDUneAttestation } from './feuille';
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
 * L'attestation de travail, sur le modèle officiel de l'APIX (ADR-0086) :
 * l'en-tête de la République, le numéro à porter à la main et la date, le
 * timbre, le titre encadré, puis trois paragraphes. Qui atteste dirige le
 * sommet de l'organigramme, la direction générale. L'espace sous le texte
 * reste libre pour la signature et le cachet.
 */

/**
 * Le contrat cité : chaque libellé porte SON article.
 *
 * « dans le cadre d'un convention de stage » : le générateur écrivait cela,
 * parce qu'il collait « d'un » devant un libellé dont il ignorait le genre.
 * L'article appartient au libellé, il ne se devine pas. Le stage n'y est
 * pas : il relève de l'attestation de stage.
 */
export const CONTRACT_LABELS: Record<string, string> = {
  cdi: 'd’un contrat à durée indéterminée',
  cdd: 'd’un contrat à durée déterminée',
  consultant: 'd’un contrat de consultance',
  detachement: 'd’un détachement',
};

export interface AttestationData extends DossierDeLAgent {
  /** Qui atteste : qui dirige le sommet de l'organigramme ; null : la place est vacante. */
  signataire: Personne | null;
}

/**
 * Les textes de l'attestation, aux mots du modèle de l'APIX. Les noms et la
 * date d'entrée sont en gras, comme sur le modèle, chacun d'un seul tenant.
 */
export function textesDeLAttestation(d: AttestationData, aujourdhui: Date): TextesDUneAttestation {
  const agent = accords(d.agent.genre);
  const signataire = accords(d.signataire?.genre ?? null);
  const qualite = auGenre(d.signataire?.genre ?? null, 'Directeur Général', 'Directrice Générale');
  const contrat = d.contrat ? CONTRACT_LABELS[d.contrat] : undefined;
  const fonction = d.poste
    ? `${agent.pronom} occupe actuellement ${elide('la fonction d', d.poste)}` +
      (contrat ? `, au titre ${contrat}.` : '.')
    : contrat
      ? `${agent.pronom} est en fonction au titre ${contrat}.`
      : null;
  return {
    reference: ENTETE.referenceDCH,
    lieuEtDate: `${ENTETE.ville}, le ${frDate(aujourdhui)}`,
    // Le timbre nomme qui signe, qui atteste dans le corps (ADR-0087). Le
    // modèle portait « Le Directeur Général Adjoint » ; l'APIX a retenu la
    // direction générale.
    timbre: `${signataire.le} ${qualite}`,
    titre: 'ATTESTATION DE TRAVAIL',
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
      ...(fonction ? [[{ texte: fonction }]] : []),
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
export function pdfDeLAttestation(
  textes: TextesDUneAttestation,
  { logo }: { logo?: string | null } = {},
): Promise<Buffer> {
  return pdfDUneAttestation(textes, { titre: 'Attestation de travail', logo });
}

@Injectable()
export class AttestationService {
  constructor(@Inject(TenantDb) private readonly db: TenantDb) {}

  /**
   * L'attestation d'un agent : qui traite, en ce moment, sa demande
   * d'attestation de travail. Une demande d'un autre document n'y donne pas
   * droit, et le droit s'éteint avec la demande : une fois prête, refusée ou
   * annulée, ou la délégation retirée. Gérer les dossiers n'y suffit pas, les
   * attestations se délèguent à part. L'administrateur garde la main pour
   * contrôler le modèle.
   */
  async forEmployee(user: SessionUser, employeeId: string): Promise<DocumentPdf> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      await this.exigerLeDroit(tx, user, employeeId);
      return this.pdfPour(tx, employeeId);
    });
  }

  /**
   * Le PDF, sans contrôle des droits : à l'appelant de les avoir vérifiés.
   * La file des documents et « Générer des documents » (ADR-0085) ont chacune
   * les siens.
   */
  async pdfPour(tx: Tx, employeeId: string): Promise<DocumentPdf> {
    const d = await this.donnees(tx, employeeId);
    return {
      filename: nomDuDocumentGenere('attestation_travail', d.employeeNumber),
      pdf: await pdfDeLAttestation(textesDeLAttestation(d, new Date())),
    };
  }

  /** Ce que le PDF imprimerait aujourd'hui pour ce dossier, sans contrôle des droits. */
  async textesPour(tx: Tx, employeeId: string): Promise<TextesDUneAttestation> {
    return textesDeLAttestation(await this.donnees(tx, employeeId), new Date());
  }

  private async exigerLeDroit(tx: Tx, user: SessionUser, employeeId: string): Promise<void> {
    // La sienne se demande depuis « Mes documents », comme pour tout agent.
    await pasSurSoi(tx, user.userId, [employeeId], 'établir votre propre attestation');
    if (user.role !== 'admin' && !(await this.traiteSaDemande(tx, user, employeeId))) {
      problem(403, 'auth.forbidden', 'Droits insuffisants pour cette action');
    }
  }

  /** Une demande d'attestation de travail de cet agent, encore ouverte, que l'appelant traite. */
  private async traiteSaDemande(tx: Tx, user: SessionUser, employeeId: string): Promise<boolean> {
    const moi = await agentDuCompte(tx, user.userId);
    const dch = await directionDuPersonnel(tx);
    const { rows } = await tx.execute<{ confiee_a_employee_id: string | null }>(sql`
      SELECT confiee_a_employee_id FROM document_requests
       WHERE employee_id = ${employeeId} AND status IN ('received', 'processing')
         AND 'attestation_travail' = ANY (doc_types)`);
    const capacite = capaciteDuDocument('attestation_travail');
    for (const r of rows) {
      const d = { employeeId, confieeA: r.confiee_a_employee_id };
      if ((await vueDuTraitement(tx, capacite, d, moi, dch)).peutTraiter) return true;
    }
    return false;
  }

  private async donnees(tx: Tx, employeeId: string): Promise<AttestationData> {
    return {
      ...(await dossierDeLAgent(tx, employeeId, 'Attestation de travail')),
      signataire: await quiDirigeLeSommet(tx),
    };
  }
}
