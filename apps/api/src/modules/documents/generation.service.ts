import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type {
  AgentDeLaCible,
  CodeDeBanque,
  DocumentGenere,
  DocumentHorsDossier,
  DocumentParLettre,
  DocumentSansAgent,
  DossierPourLaDeclaration,
  DossierPourLaFiche,
  SaisiesDuDocument,
  SessionUser,
  StageAuDossier,
} from '@teranga/contracts';
import {
  aChoixDAgent,
  codeDuPays,
  dateDeLaDemande,
  depuisLeDossier,
  estGenere,
  ficheDeLaDecisionSchema,
  ficheReprise,
  ficheDomiciliationSchema,
  genereQuelqueChose,
  horsDossier,
  parLettre,
  peut,
  peutGenerer,
  REQUESTABLE_DOC_LABELS,
  repriseDeLaDeclaration,
  requestableDocSchema,
  sansAgent,
  SITUATION_DE_FAMILLE_DU_DOSSIER,
} from '@teranga/contracts';
import { agentDuCompte, directionDuPersonnel, pasSurSoi } from '../acces/dch';
import { attenteDe, capaciteDesDocuments, vueDuTraitement } from '../acces/demandes';
import { EncryptionService } from '../../common/encryption.service';
import { problem } from '../../common/problem';
import * as t from '../../db/schema';
import { TenantDb, type Tx } from '../../db/tenant-db';
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
 * dont la génération leur est déléguée (ADR-0114). Une demande de mise en
 * disponibilité, de renouvellement ou de domiciliation se génère au titre de
 * la demande, pour l'agent qui l'a faite, par qui la traite (ADR-0189). Le
 * compte d'administration, technique, ne produit pas d'actes.
 *
 * Un document sans agent (les contrats de travail et de stage, ADR-0094,
 * ADR-0098) se génère d'une fiche que la DCH renseigne : la personne n'est
 * pas encore dans l'application. Un document avec agent ne se génère que
 * pour un agent de sa cible (ADR-0130). Le certificat de travail et
 * l'attestation de stage se génèrent aussi d'une fiche, pour une personne
 * sans dossier dans l'application (ADR-0176). La déclaration de mouvement se
 * génère d'une fiche que le dossier de l'agent choisi préremplit, ou que la
 * DCH renseigne en entier pour une personne sans dossier (ADR-0199).
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
    demandeId?: string,
  ): Promise<DossierPourLaFiche> {
    const parDemande = parLaDemande(demandeId);
    const doc = parDemande ? documentDeLaDemande(type) : this.documentConfigure(user, type);
    if (!depuisLeDossier(doc)) {
      problem(
        422,
        'documents.sans_dossier',
        `${REQUESTABLE_DOC_LABELS[doc]} : rien à reprendre du dossier d’un agent`,
      );
    }
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      if (parDemande && (await agentDeLaDemande(tx, user, doc, parDemande)).id !== employeeId) {
        problem(403, 'auth.forbidden', 'Ce dossier n’est pas celui de l’agent de la demande');
      }
      await pasSurSoi(tx, user.userId, [employeeId], 'générer un document pour');
      await exigerLaCible(tx, doc, employeeId);
      const dossier = await identiteAuDossier(tx, employeeId);
      const banqueEtRib = doc === 'domiciliation_bancaire' && peut(user, 'personnel.sensible');
      const { rows: comptes } = banqueEtRib
        ? await tx.execute<{ banque: string | null; rib_chiffre: string | null }>(sql`
            SELECT banque, rib_chiffre FROM remunerations WHERE employee_id = ${employeeId} LIMIT 1`)
        : { rows: [] };
      const compte = comptes[0];
      return {
        ...dossier,
        banque: (compte?.banque as CodeDeBanque | null | undefined) ?? null,
        rib: compte?.rib_chiffre ? this.crypto.decrypt(compte.rib_chiffre) : null,
      };
    });
  }

  /**
   * Ce que le dossier d'un agent donne d'avance à sa déclaration de mouvement
   * (ADR-0199) ; le numéro de la CNI, celui de l'IPRES et le salaire de base,
   * à qui a l'accès aux données sensibles (ADR-0158). L'agent est de la
   * cible, et jamais soi.
   */
  async dossierPourLaDeclaration(
    user: SessionUser,
    employeeId: string,
  ): Promise<DossierPourLaDeclaration> {
    this.documentConfigure(user, 'declaration_mouvement');
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      await pasSurSoi(tx, user.userId, [employeeId], 'générer un document pour');
      await exigerLaCible(tx, 'declaration_mouvement', employeeId);
      return declarationAuDossier(tx, this.crypto, employeeId, peut(user, 'personnel.sensible'));
    });
  }

  /**
   * Un document d'après la fiche que la DCH renseigne : un document sans
   * agent, ou le certificat de travail et l'attestation de stage d'une
   * personne sans dossier (ADR-0176). Une fiche que le dossier d'un agent
   * préremplit reprend ce que ce dossier porte : au titre d'une demande
   * (ADR-0190), ou de l'agent choisi sur « Générer des documents » (ADR-0197).
   */
  async pdfSansAgent(
    user: SessionUser,
    type: string,
    corps: unknown,
    demandeId?: string,
    agentId?: string,
  ): Promise<DocumentPdf> {
    const parDemande = parLaDemande(demandeId);
    const doc = parDemande ? documentDeLaDemande(type) : this.documentConfigure(user, type);
    const modele = sansAgent(doc)
      ? this.sansAgent[doc]
      : horsDossier(doc)
        ? this.horsDossier[doc]
        : null;
    if (!modele) {
      problem(422, 'documents.avec_agent', `${REQUESTABLE_DOC_LABELS[doc]} : un agent à choisir`);
    }
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      if (parDemande && parLettre(doc)) {
        // Au titre d'une demande, le document est celui de l'agent qui l'a
        // faite : la fiche le nomme, aux capitales et aux accents près. Ce
        // que son dossier porte, et la date de la demande, la fiche les
        // reprend tels quels (ADR-0190).
        const agent = await agentDeLaDemande(tx, user, doc, parDemande);
        await pasSurSoi(tx, user.userId, [agent.id], 'générer un document pour');
        const fiche = ficheDeLaDemande(doc).safeParse(corps);
        if (fiche.success && !memePersonne(fiche.data, agent)) {
          problem(
            422,
            'documents.autre_personne',
            'La fiche doit nommer l’agent qui a fait la demande',
          );
        }
        return modele.pdf(
          tx,
          ficheFigee(
            corps,
            ficheReprise(doc, await identiteAuDossier(tx, agent.id), agent.demandeLe),
          ),
        );
      }
      if (!parDemande && agentId && depuisLeDossier(doc)) {
        // L'agent choisi sur « Générer des documents » : ce que son dossier
        // porte, la fiche le reprend tel quel. La date de la demande, elle,
        // se saisit (ADR-0197).
        await pasSurSoi(tx, user.userId, [agentId], 'générer un document pour');
        await exigerLaCible(tx, doc, agentId);
        return modele.pdf(
          tx,
          ficheFigee(corps, ficheReprise(doc, await identiteAuDossier(tx, agentId))),
        );
      }
      if (!parDemande && agentId && doc === 'declaration_mouvement') {
        // La déclaration d'un agent choisi : ce que son dossier porte, elle le
        // reprend tel quel, et nomme autant d'enfants à charge qu'il en
        // compte (ADR-0199).
        await pasSurSoi(tx, user.userId, [agentId], 'générer un document pour');
        await exigerLaCible(tx, doc, agentId);
        const { nombreDEnfants, ...reprise } = repriseDeLaDeclaration(
          await declarationAuDossier(tx, this.crypto, agentId, peut(user, 'personnel.sensible')),
        );
        const fiche = ficheFigee(corps, reprise);
        const enfants = (fiche as { enfants?: unknown } | null)?.enfants;
        if (
          nombreDEnfants !== undefined &&
          Array.isArray(enfants) &&
          enfants.length !== nombreDEnfants
        ) {
          problem(
            422,
            'documents.enfants',
            `Enfants à charge : ${nombreDEnfants} au dossier`,
            nombreDEnfants === 0
              ? 'Le dossier ne compte aucun enfant à charge : la déclaration n’en nomme pas.'
              : 'La déclaration nomme chacun des enfants à charge que compte le dossier.',
          );
        }
        return modele.pdf(tx, fiche);
      }
      return modele.pdf(tx, corps);
    });
  }

  /**
   * Ce que l'organisation sait d'avance de la fiche d'un document sans agent :
   * les sessions du conseil d'administration d'une décision de disponibilité
   * (ADR-0123). La page le pose dans les champs encore vides.
   */
  async preremplissage(
    user: SessionUser,
    type: string,
    demandeId?: string,
  ): Promise<Record<string, unknown>> {
    const parDemande = parLaDemande(demandeId);
    const doc = parDemande ? documentDeLaDemande(type) : this.documentConfigure(user, type);
    if (!sansAgent(doc)) {
      problem(422, 'documents.avec_agent', `${REQUESTABLE_DOC_LABELS[doc]} : un agent à choisir`);
    }
    if (parDemande) {
      await this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, (tx) =>
        agentDeLaDemande(tx, user, doc, parDemande),
      );
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
    // Un membre ne génère que les documents délégués.
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

/* ──── Au titre d'une demande (ADR-0189) ───────────────────────────────── */

/**
 * La demande au titre de laquelle on génère. Pour tous, qui dirige la DCH
 * compris : la page d'une demande fige ce que le dossier de l'agent porte
 * (ADR-0190). Sans demande, « Générer des documents » reste ce qu'il était.
 */
function parLaDemande(demandeId: string | undefined): string | null {
  return demandeId ?? null;
}

/** Le document d'une demande par lettre, configuré ; aucun autre ne se génère à ce titre. */
function documentDeLaDemande(type: string): DocumentGenere & DocumentParLettre {
  const doc = requestableDocSchema.safeParse(type);
  if (!doc.success) problem(404, 'documents.inconnu', 'Document inconnu');
  if (!parLettre(doc.data) || !estGenere(doc.data)) {
    problem(403, 'auth.forbidden', 'Vous n’avez pas les droits nécessaires pour cette action');
  }
  return doc.data;
}

/**
 * L'agent d'une demande que l'appelant traite : ouverte, de ce document, et
 * dont le traitement revient à l'appelant, comme dans la file (ADR-0128). Jamais la
 * sienne : la règle de traitement l'écarte.
 */
async function agentDeLaDemande(
  tx: Tx,
  user: SessionUser,
  doc: DocumentGenere,
  demandeId: string,
): Promise<{ id: string; prenom: string; nom: string; demandeLe: string }> {
  const [row] = await tx
    .select({
      request: t.documentRequests,
      prenom: t.persons.givenName,
      nom: t.persons.familyName,
    })
    .from(t.documentRequests)
    .innerJoin(t.employees, eq(t.employees.id, t.documentRequests.employeeId))
    .innerJoin(t.persons, eq(t.persons.id, t.employees.personId))
    .where(eq(t.documentRequests.id, demandeId))
    .limit(1);
  if (!row || row.request.docTypes[0] !== doc) {
    problem(404, 'documents.request_not_found', 'Demande introuvable');
  }
  if (!['received', 'processing'].includes(row.request.status)) {
    problem(422, 'documents.deja_traitee', 'Cette demande est clôturée');
  }
  const { peutTraiter } = await vueDuTraitement(
    tx,
    capaciteDesDocuments(row.request.docTypes),
    {
      employeeId: row.request.employeeId,
      confieeA: row.request.confieeAEmployeeId,
      attente: attenteDe(row.request),
    },
    await agentDuCompte(tx, user.userId),
    await directionDuPersonnel(tx),
  );
  if (!peutTraiter) {
    problem(403, 'demandes.pas_traitant', 'Réservé à la personne qui traite cette demande');
  }
  // La date que la fiche reprend : celle de la lettre, ou le jour de l'envoi.
  const [lettre] = await tx
    .select({ datee: t.documentRequestLettres.datee })
    .from(t.documentRequestLettres)
    .where(eq(t.documentRequestLettres.requestId, demandeId))
    .limit(1);
  return {
    id: row.request.employeeId,
    prenom: row.prenom,
    nom: row.nom,
    demandeLe: dateDeLaDemande({
      createdAt: row.request.createdAt.toISOString(),
      lettre: lettre ? { datee: lettre.datee } : null,
    }),
  };
}

/** Le schéma de la fiche d'un document par lettre. */
const ficheDeLaDemande = (doc: DocumentParLettre) =>
  doc === 'domiciliation_bancaire' ? ficheDomiciliationSchema : ficheDeLaDecisionSchema(doc);

/** Un nom sans capitales, accents ni tirets : « Fatou-Bintou » et « fatou bintou » se valent. */
const aplati = (texte: string) =>
  texte
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim();

const memePersonne = (
  fiche: { prenom: string; nom: string },
  agent: { prenom: string; nom: string },
) => aplati(fiche.prenom) === aplati(agent.prenom) && aplati(fiche.nom) === aplati(agent.nom);

/**
 * La fiche, ce qu'elle reprend remis à sa place : au titre d'une demande,
 * ni l'identité de l'agent, ni son poste, ni la date de la demande ne se
 * corrigent (ADR-0190). Une fiche qui n'est pas un objet part telle quelle :
 * le modèle la refuse.
 */
function ficheFigee(corps: unknown, figes: object): unknown {
  return typeof corps === 'object' && corps !== null && !Array.isArray(corps)
    ? { ...corps, ...figes }
    : corps;
}

/* ──── Le dossier de l'agent ───────────────────────────────────────────── */

/**
 * Ce que le dossier dit de l'agent pour une fiche (ADR-0174) : son état
 * civil, son poste et son unité en cours, le contrat qui fait foi et son
 * premier jour.
 */
async function identiteAuDossier(
  tx: Tx,
  employeeId: string,
): Promise<Omit<DossierPourLaFiche, 'banque' | 'rib'>> {
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
  const dossier = rows[0];
  if (!dossier) problem(404, 'people.employee_not_found', 'Dossier introuvable');
  return {
    civilite:
      dossier.gender === 'female' ? 'madame' : dossier.gender === 'male' ? 'monsieur' : null,
    prenom: dossier.given_name,
    nom: dossier.family_name,
    poste: dossier.position_title,
    affectation: dossier.org_unit_id,
    contrat: dossier.contract_type,
    debut: dossier.start_date,
  };
}

/**
 * Ce que le dossier dit d'un agent pour sa déclaration de mouvement
 * (ADR-0199) : l'état civil et la filiation, l'adresse et la ville, la CNI,
 * la famille, l'entrée, le poste en cours, la catégorie, le contrat qui fait
 * foi s'il est un CDI ou un CDD ; avec l'accès aux données sensibles, le
 * numéro de la CNI, celui de l'IPRES et le salaire de base. Une entrée connue
 * au mois seulement ne se reprend pas : son jour n'est pas sûr.
 */
async function declarationAuDossier(
  tx: Tx,
  crypto: EncryptionService,
  employeeId: string,
  sensible: boolean,
): Promise<DossierPourLaDeclaration> {
  const { rows } = await tx.execute<{
    gender: string | null;
    given_name: string;
    family_name: string;
    birth_date: string | null;
    lieu_de_naissance: string | null;
    birth_place: string | null;
    nationality: string | null;
    prenom_du_pere: string | null;
    prenom_de_la_mere: string | null;
    nom_de_la_mere: string | null;
    address_line: string | null;
    ville: string | null;
    national_id_encrypted: string | null;
    id_document_type: string | null;
    id_document_issued_on: string | null;
    marital_status: string | null;
    epouses: string[] | null;
    nombre_enfants: number | null;
    hired_on: string;
    entree_au_mois: boolean;
    categorie: string | null;
    position_title: string | null;
    contract_type: string | null;
    start_date: string | null;
    end_date: string | null;
    salaire_de_base: number | null;
    numero_ipres: string | null;
  }>(sql`
    SELECT p.gender, p.given_name, p.family_name,
           to_char(p.birth_date, 'YYYY-MM-DD') AS birth_date,
           p.lieu_de_naissance, p.birth_place, p.nationality,
           p.prenom_du_pere, p.prenom_de_la_mere, p.nom_de_la_mere,
           p.address_line, p.ville, p.national_id_encrypted, p.id_document_type,
           to_char(p.id_document_issued_on, 'YYYY-MM-DD') AS id_document_issued_on,
           p.marital_status, p.epouses, p.nombre_enfants,
           to_char(e.hired_on, 'YYYY-MM-DD') AS hired_on, e.entree_au_mois, e.categorie,
           a.position_title, c.contract_type,
           to_char(c.start_date, 'YYYY-MM-DD') AS start_date,
           to_char(c.end_date, 'YYYY-MM-DD') AS end_date,
           r.salaire_de_base, r.numero_ipres
      FROM employees e
      JOIN persons p ON p.id = e.person_id
      -- Le poste en cours, sinon le dernier.
      LEFT JOIN LATERAL (
        SELECT position_title FROM assignments
         WHERE employee_id = e.id
         ORDER BY validity @> CURRENT_DATE DESC, lower(validity) DESC LIMIT 1
      ) a ON true
      -- Le contrat qui fait foi, comme pour la cible : le dernier commencé.
      LEFT JOIN LATERAL (
        SELECT contract_type, start_date, end_date FROM contracts
         WHERE employee_id = e.id AND start_date <= CURRENT_DATE
         ORDER BY start_date DESC, created_at DESC LIMIT 1
      ) c ON true
      LEFT JOIN LATERAL (
        SELECT salaire_de_base, numero_ipres FROM remunerations
         WHERE employee_id = e.id LIMIT 1
      ) r ON true
     WHERE e.id = ${employeeId}`);
  const d = rows[0];
  if (!d) problem(404, 'people.employee_not_found', 'Dossier introuvable');
  const cni = d.id_document_type === 'cni';
  const contrat = d.contract_type === 'cdd' || d.contract_type === 'cdi' ? d.contract_type : null;
  return {
    civilite: d.gender === 'female' ? 'madame' : d.gender === 'male' ? 'monsieur' : null,
    prenom: d.given_name,
    nom: d.family_name,
    naissanceLe: d.birth_date,
    naissanceA: d.lieu_de_naissance,
    naissancePays: codeDuPays(d.birth_place),
    nationalite: d.nationality,
    perePrenom: d.prenom_du_pere,
    merePrenom: d.prenom_de_la_mere,
    mereNom: d.nom_de_la_mere,
    adresse: d.address_line,
    residence: d.ville,
    cni:
      cni && sensible && d.national_id_encrypted
        ? crypto.decrypt(d.national_id_encrypted).replace(/[\s-]/g, '')
        : null,
    cniDelivreeLe: cni ? d.id_document_issued_on : null,
    ipres: sensible ? d.numero_ipres : null,
    situationDeFamille: d.marital_status
      ? (SITUATION_DE_FAMILLE_DU_DOSSIER[d.marital_status] ?? null)
      : null,
    epouses: d.epouses ?? [],
    nombreDEnfants: d.nombre_enfants,
    entreeLe: d.entree_au_mois ? null : d.hired_on,
    emploi: d.position_title,
    categorie: d.categorie,
    contrat,
    debut: contrat ? d.start_date : null,
    fin: contrat ? d.end_date : null,
    salaire: sensible ? d.salaire_de_base : null,
  };
}
