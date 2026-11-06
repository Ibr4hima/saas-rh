import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  AgentDeLaCible,
  CodeDeBanque,
  DocumentGenere,
  DocumentHorsDossier,
  DocumentSansAgent,
  DossierPourLaFiche,
  SaisiesDuDocument,
  SessionUser,
  StageAuDossier,
} from '@teranga/contracts';
import {
  aChoixDAgent,
  depuisLeDossier,
  estGenere,
  genereQuelqueChose,
  horsDossier,
  peut,
  peutGenerer,
  REQUESTABLE_DOC_LABELS,
  requestableDocSchema,
  sansAgent,
} from '@teranga/contracts';
import { pasSurSoi } from '../acces/dch';
import { EncryptionService } from '../../common/encryption.service';
import { problem } from '../../common/problem';
import { TenantDb } from '../../db/tenant-db';
import { AbsencesService } from '../time/absences.service';
import { attestationDeConge } from './attestation-conge';
import { attestationDeReprise } from './attestation-reprise';
import { attestationDeRetraite } from './attestation-retraite';
import { attestationDeRevenu } from './attestation-revenu';
import { attestationDeStage, attestationDeStageHorsDossier } from './attestation-stage';
import { certificatDeTravail, certificatHorsDossier } from './certificat-travail';
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
 * pour un agent de sa cible (ADR-0130). Le certificat de travail et
 * l'attestation de stage se génèrent aussi d'une fiche, pour une personne
 * sans dossier dans l'application (ADR-0176).
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
  /** Les mêmes documents qu'avec un agent, d'après la fiche d'une personne sans dossier. */
  private readonly horsDossier: Record<DocumentHorsDossier, ModeleSansAgent> = {
    certificat_travail: certificatHorsDossier,
    attestation_stage: attestationDeStageHorsDossier,
  };

  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(EncryptionService) private readonly crypto: EncryptionService,
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
   * (ADR-0130) : la page ne propose qu'eux. La domiciliation bancaire, sans
   * agent, propose les siens pour préremplir sa fiche (ADR-0174).
   */
  async agents(user: SessionUser, type: string, q: string): Promise<AgentDeLaCible[]> {
    const doc = this.documentConfigure(user, type);
    if (!aChoixDAgent(doc)) {
      problem(422, 'documents.sans_agent', `${REQUESTABLE_DOC_LABELS[doc]} : sans agent`);
    }
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, (tx) =>
      agentsDeLaCible(tx, doc, q, user.userId),
    );
  }

  /**
   * Ce que le dossier d'un agent donne d'avance à la fiche d'une
   * domiciliation bancaire ou d'une décision de disponibilité (ADR-0174) :
   * son état civil, son poste et son unité en cours, le contrat qui fait foi
   * et son premier jour ; pour la domiciliation seulement, sa banque et son
   * RIB, à qui a l'accès aux données sensibles (ADR-0158). L'agent est de la
   * cible, et jamais soi.
   */
  async dossierPourLaFiche(
    user: SessionUser,
    type: string,
    employeeId: string,
  ): Promise<DossierPourLaFiche> {
    const doc = this.documentConfigure(user, type);
    if (!depuisLeDossier(doc)) {
      problem(
        422,
        'documents.sans_dossier',
        `${REQUESTABLE_DOC_LABELS[doc]} : rien à reprendre du dossier d’un agent`,
      );
    }
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      await pasSurSoi(tx, user.userId, [employeeId], 'générer un document pour');
      await exigerLaCible(tx, doc, employeeId);
      const { rows } = await tx.execute<{
        gender: string | null;
        given_name: string;
        family_name: string;
        position_title: string | null;
        org_unit_id: string | null;
        contract_type: 'cdd' | 'cdi';
        start_date: string;
      }>(sql`
        SELECT p.gender, p.given_name, p.family_name, a.position_title, a.org_unit_id,
               c.contract_type, to_char(c.start_date, 'YYYY-MM-DD') AS start_date
          FROM employees e
          JOIN persons p ON p.id = e.person_id
          -- Le poste en cours, sinon le prochain.
          LEFT JOIN LATERAL (
            SELECT position_title, org_unit_id FROM assignments
             WHERE employee_id = e.id
             ORDER BY validity @> CURRENT_DATE DESC, lower(validity) DESC LIMIT 1
          ) a ON true
          -- Le contrat qui fait foi, comme pour la cible : le dernier commencé.
          JOIN LATERAL (
            SELECT contract_type, start_date FROM contracts
             WHERE employee_id = e.id AND start_date <= CURRENT_DATE
             ORDER BY start_date DESC, created_at DESC LIMIT 1
          ) c ON true
         WHERE e.id = ${employeeId}`);
      const dossier = rows[0]!;
      const banqueEtRib = doc === 'domiciliation_bancaire' && peut(user, 'personnel.sensible');
      const { rows: comptes } = banqueEtRib
        ? await tx.execute<{ banque: string | null; rib_chiffre: string | null }>(sql`
            SELECT banque, rib_chiffre FROM remunerations WHERE employee_id = ${employeeId} LIMIT 1`)
        : { rows: [] };
      const compte = comptes[0];
      return {
        civilite:
          dossier.gender === 'female' ? 'madame' : dossier.gender === 'male' ? 'monsieur' : null,
        prenom: dossier.given_name,
        nom: dossier.family_name,
        poste: dossier.position_title,
        affectation: dossier.org_unit_id,
        contrat: dossier.contract_type,
        debut: dossier.start_date,
        banque: (compte?.banque as CodeDeBanque | null | undefined) ?? null,
        rib: compte?.rib_chiffre ? this.crypto.decrypt(compte.rib_chiffre) : null,
      };
    });
  }

  /**
   * Un document d'après la fiche que la DCH renseigne : un document sans
   * agent, ou le certificat de travail et l'attestation de stage d'une
   * personne sans dossier (ADR-0176).
   */
  async pdfSansAgent(user: SessionUser, type: string, corps: unknown): Promise<DocumentPdf> {
    const doc = this.documentConfigure(user, type);
    const modele = sansAgent(doc)
      ? this.sansAgent[doc]
      : horsDossier(doc)
        ? this.horsDossier[doc]
        : null;
    if (!modele) {
      problem(422, 'documents.avec_agent', `${REQUESTABLE_DOC_LABELS[doc]} : un agent à choisir`);
    }
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
