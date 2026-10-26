import { Inject, Injectable } from '@nestjs/common';
import type {
  AgentDeLaCible,
  DocumentGenere,
  DocumentSansAgent,
  SaisiesDuDocument,
  SessionUser,
  StageAuDossier,
} from '@teranga/contracts';
import {
  estGenere,
  genereQuelqueChose,
  peutGenerer,
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
import { agentsDeLaCible, exigerLaCible } from './cibles';
import { attestationDeCessation, attestationDeRepriseDeService } from './conge-de-maternite';
import { contratDeStage, type ModeleSansAgent } from './contrat-stage';
import { contratDeTravail } from './contrat-travail';
import { declarationDeMouvement } from './declaration-mouvement';
import { decisionDeDisponibilite } from './decision-disponibilite';
import { domiciliationBancaire } from './domiciliation';
import { stagesDeLAgent } from './dossier';
import { AttestationService } from './attestation.service';
import type { DocumentPdf, Modele } from './feuille';

/**
 * « Générer des documents » (ADR-0085) : qui dirige la DCH génère, à sa
 * guise, tout document de la liste dont le modèle est configuré, pour
 * n'importe quel agent, sans demande, sauf pour soi.
 *
 * Les membres de la DCH génèrent pour une demande dont le traitement leur
 * revient, depuis la file des documents ; et, depuis cette page, les contrats
 * dont la génération leur est déléguée (ADR-0114). Le compte
 * d'administration, technique, ne produit pas d'actes.
 *
 * Un document sans agent (les contrats de travail et de stage, ADR-0094,
 * ADR-0098) se génère d'une fiche que la DCH renseigne : la personne n'est
 * pas encore dans l'application. Un document avec agent ne se génère que
 * pour un agent de sa cible (ADR-0130).
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
      await exigerLaCible(tx, doc, employeeId);
      return modele.pdf(tx, employeeId, saisies);
    });
  }

  /**
   * Les stages d'un agent, pour l'attestation de stage (ADR-0132) : à
   * plusieurs, la page demande lequel l'attestation cite.
   */
  async stages(user: SessionUser, employeeId: string): Promise<StageAuDossier[]> {
    this.documentConfigure(user, 'attestation_stage');
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      await pasSurSoi(tx, user.userId, [employeeId], 'générer un document pour');
      await exigerLaCible(tx, 'attestation_stage', employeeId);
      return (await stagesDeLAgent(tx, employeeId)).map(({ debut, fin, poste }) => ({
        debut,
        fin,
        poste,
      }));
    });
  }

  /**
   * Les agents de la cible du document qui répondent à la recherche
   * (ADR-0130) : la page ne propose qu'eux.
   */
  async agents(user: SessionUser, type: string, q: string): Promise<AgentDeLaCible[]> {
    const doc = this.documentConfigure(user, type);
    if (sansAgent(doc)) {
      problem(422, 'documents.sans_agent', `${REQUESTABLE_DOC_LABELS[doc]} : sans agent`);
    }
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, (tx) =>
      agentsDeLaCible(tx, doc, q, user.userId),
    );
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

  /**
   * Ce que l'organisation sait d'avance de la fiche d'un document sans agent :
   * les sessions du conseil d'administration d'une décision de disponibilité
   * (ADR-0123). La page le pose dans les champs encore vides.
   */
  preremplissage(user: SessionUser, type: string): Record<string, unknown> {
    const doc = this.documentConfigure(user, type);
    if (!sansAgent(doc)) {
      problem(422, 'documents.avec_agent', `${REQUESTABLE_DOC_LABELS[doc]} : un agent à choisir`);
    }
    return this.sansAgent[doc].preremplissage?.() ?? {};
  }

  /**
   * Le document demandé, s'il est de la liste, que l'appelant peut le générer
   * et que son modèle est configuré ; sinon, le refus.
   */
  private documentConfigure(user: SessionUser, type: string): DocumentGenere {
    if (!genereQuelqueChose(user)) {
      problem(403, 'auth.forbidden', 'Vous n’avez pas les droits nécessaires pour cette action');
    }
    const doc = requestableDocSchema.safeParse(type);
    // Un document retiré de la liste ne se génère pas plus qu'il ne se demande.
    if (!doc.success) problem(404, 'documents.inconnu', 'Document inconnu');
    // Un membre ne génère que les contrats qu'on lui a délégués.
    if (!peutGenerer(user, doc.data)) {
      problem(403, 'auth.forbidden', 'Vous n’avez pas les droits nécessaires pour cette action');
    }
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
