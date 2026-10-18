import { Inject, Injectable } from '@nestjs/common';
import type {
  DocumentGenere,
  DocumentSansAgent,
  SaisiesDuDocument,
  SessionUser,
} from '@teranga/contracts';
import {
  estGenere,
  REQUESTABLE_DOC_LABELS,
  requestableDocSchema,
  sansAgent,
} from '@teranga/contracts';
import { pasSurSoi } from '../acces/dch';
import { problem } from '../../common/problem';
import { TenantDb } from '../../db/tenant-db';
import { AbsencesService } from '../time/absences.service';
import { attestationDeConge } from './attestation-conge';
import { attestationDeReprise } from './attestation-reprise';
import { attestationDeRetraite } from './attestation-retraite';
import { attestationDeRevenu } from './attestation-revenu';
import { attestationDeStage } from './attestation-stage';
import { certificatDeTravail } from './certificat-travail';
import { attestationDeCessation, attestationDeRepriseDeService } from './conge-de-maternite';
import { contratDeStage, type ModeleSansAgent } from './contrat-stage';
import { contratDeTravail } from './contrat-travail';
import { declarationDeMouvement } from './declaration-mouvement';
import { decisionDeDisponibilite } from './decision-disponibilite';
import { domiciliationBancaire } from './domiciliation';
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
 *
 * Un document sans agent (les contrats de travail et de stage, ADR-0094,
 * ADR-0098) se génère d'une fiche que la DCH renseigne : la personne n'est
 * pas encore dans l'application.
 */
@Injectable()
export class GenerationService {
  /**
   * Les modèles configurés. Le type tient la liste d'accord avec
   * `GENERATED_DOCS` : un document déclaré générable sans modèle, ou un
   * modèle hors de la liste, ne compile pas.
   */
  private readonly modeles: Record<Exclude<DocumentGenere, DocumentSansAgent>, Modele>;
  private readonly sansAgent: Record<DocumentSansAgent, ModeleSansAgent> = {
    contrat_cdd: contratDeTravail('contrat_cdd'),
    contrat_cdi: contratDeTravail('contrat_cdi'),
    contrat_stage: contratDeStage,
    decision_disponibilite: decisionDeDisponibilite('decision_disponibilite'),
    decision_renouvellement_disponibilite: decisionDeDisponibilite(
      'decision_renouvellement_disponibilite',
    ),
    domiciliation_bancaire: domiciliationBancaire,
    declaration_mouvement: declarationDeMouvement,
  };

  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(AttestationService) attestations: AttestationService,
    @Inject(AbsencesService) absences: AbsencesService,
  ) {
    this.modeles = {
      attestation_conge: attestationDeConge(absences),
      attestation_reprise_service: attestationDeRepriseDeService,
      attestation_cessation: attestationDeCessation,
      attestation_reprise_disponibilite: attestationDeReprise,
      attestation_depart_retraite: attestationDeRetraite,
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
    const doc = this.documentConfigure(user, type);
    if (sansAgent(doc)) {
      problem(422, 'documents.sans_agent', `${REQUESTABLE_DOC_LABELS[doc]} : sans agent`);
    }
    const modele = this.modeles[doc];
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      await pasSurSoi(tx, user.userId, [employeeId], 'générer un document pour');
      return modele.pdf(tx, employeeId, saisies);
    });
  }

  /** Un document sans agent, d'après la fiche que la DCH renseigne. */
  async pdfSansAgent(user: SessionUser, type: string, corps: unknown): Promise<DocumentPdf> {
    const doc = this.documentConfigure(user, type);
    if (!sansAgent(doc)) {
      problem(422, 'documents.avec_agent', `${REQUESTABLE_DOC_LABELS[doc]} : un agent à choisir`);
    }
    const modele = this.sansAgent[doc];
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, (tx) =>
      modele.pdf(tx, corps),
    );
  }

  /** Le document demandé, s'il est de la liste et que son modèle est configuré ; sinon, le refus. */
  private documentConfigure(user: SessionUser, type: string): DocumentGenere {
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
    return doc.data;
  }
}
