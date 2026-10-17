import { Inject, Injectable } from '@nestjs/common';
import type { DocumentGenere, SaisiesDuDocument, SessionUser } from '@teranga/contracts';
import { estGenere, REQUESTABLE_DOC_LABELS, requestableDocSchema } from '@teranga/contracts';
import { pasSurSoi } from '../acces/dch';
import { problem } from '../../common/problem';
import { TenantDb } from '../../db/tenant-db';
import { attestationDeRevenu } from './attestation-revenu';
import { attestationDeStage } from './attestation-stage';
import { certificatDeTravail } from './certificat-travail';
import { AttestationService } from './attestation.service';
import type { DocumentPdf, Modele } from './feuille';

/**
 * « Générer des documents » (ADR-0085) : qui dirige la DCH génère, à sa
 * guise, tout document de la liste dont le modèle est configuré, pour
 * n'importe quel agent, sans demande, sauf pour soi.
 *
 * Les membres de la DCH ne génèrent que pour une demande dont le traitement
 * leur revient, depuis la file des documents. Le compte d'administration,
 * technique, ne produit pas d'actes.
 */
@Injectable()
export class GenerationService {
  /**
   * Les modèles configurés. Le type tient la liste d'accord avec
   * `GENERATED_DOCS` : un document déclaré générable sans modèle, ou un
   * modèle hors de la liste, ne compile pas.
   */
  private readonly modeles: Record<DocumentGenere, Modele>;

  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(AttestationService) attestations: AttestationService,
  ) {
    this.modeles = {
      attestation_travail: { pdf: (tx, employeeId) => attestations.pdfPour(tx, employeeId) },
      attestation_revenu: attestationDeRevenu,
      attestation_stage: attestationDeStage,
      certificat_travail: certificatDeTravail,
    };
  }

  async pdf(
    user: SessionUser,
    type: string,
    employeeId: string,
    saisies: SaisiesDuDocument = {},
  ): Promise<DocumentPdf> {
    if (!user.dirigeLaDCH) problem(403, 'auth.forbidden', 'Droits insuffisants pour cette action');
    const doc = requestableDocSchema.safeParse(type);
    // Un document retiré de la liste ne se génère pas plus qu'il ne se demande.
    if (!doc.success) problem(404, 'documents.inconnu', 'Document inconnu');
    if (!estGenere(doc.data)) {
      problem(
        422,
        'documents.modele_a_configurer',
        `${REQUESTABLE_DOC_LABELS[doc.data]} : modèle à configurer`,
      );
    }
    const modele = this.modeles[doc.data];
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      await pasSurSoi(tx, user.userId, [employeeId], 'générer un document pour');
      return modele.pdf(tx, employeeId, saisies);
    });
  }
}
