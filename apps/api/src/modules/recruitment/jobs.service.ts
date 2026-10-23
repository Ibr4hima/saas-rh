import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { CONTRATS_A_DUREE, correspond, premierPrenom } from '@teranga/contracts';
import type {
  ApplicationStage,
  ApplicationView,
  CreateJobPostingInput,
  DeleteApplicationsResult,
  DeleteJobPostingsInput,
  DeleteJobPostingsResult,
  JobPostingView,
  ReconsiderApplicationsResult,
  RejectedApplicationsInput,
  RejectedApplicationsPage,
  RejectedApplicationsQuery,
  SessionUser,
  UpdateJobPostingInput,
} from '@teranga/contracts';
import { EncryptionService } from '../../common/encryption.service';
import { problem } from '../../common/problem';
import * as t from '../../db/schema';
import { TenantDb, Tx } from '../../db/tenant-db';
import { ExpediteurCourriels } from '../courriels/expediteur';
import { ENTETE } from '../documents/entete';
import {
  contenuDeLaPiece,
  dechiffrerCandidature,
  nomDeLaPiece,
  nomsDuCandidat,
} from './chiffrement';

/**
 * La durée suit le contrat : exigée pour un CDD ou un stage, effacée pour les
 * autres. Un CDI passé en CDD sans durée serait une offre qu'on ne sait pas
 * annoncer ; un CDD redevenu CDI ne garde pas une durée qui ne veut plus rien
 * dire.
 */
function dureeSelonContrat(
  contractType: string,
  dureeMois: number | null | undefined,
): number | null {
  if (!CONTRATS_A_DUREE.includes(contractType)) return null;
  if (dureeMois == null) {
    problem(422, 'recruitment.duree_requise', 'Choisissez la durée du contrat.');
  }
  return dureeMois;
}

function ctxOf(user: SessionUser): { tenantId: string; userId: string } {
  return { tenantId: user.tenantId, userId: user.userId };
}

/**
 * Une date limite se fixe à venir : annoncer un jour déjà passé n'aurait pas
 * de sens. Passée ensuite, elle ne ferme rien : l'offre reste ouverte, et
 * seule la RH l'archive (ADR-0061).
 */
async function refuserUneDateLimitePassee(tx: Tx, limite: string | null): Promise<void> {
  if (!limite) return;
  const { rows } = await tx.execute<{ passee: boolean }>(
    sql`SELECT ${limite}::date < CURRENT_DATE AS passee`,
  );
  if (rows[0]?.passee) {
    problem(422, 'recruitment.date_limite_passee', 'La date limite de candidature est passée');
  }
}

@Injectable()
export class JobsService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(EncryptionService) private readonly enc: EncryptionService,
    @Inject(ExpediteurCourriels)
    private readonly expediteur?: ExpediteurCourriels,
  ) {}

  /** Qui a consulté quoi : la liste d'une offre, ou une pièce. */
  private async tracer(
    tx: Tx,
    user: SessionUser,
    consultation:
      | { action: 'list'; jobPostingId: string }
      | { action: 'document'; applicationId: string; documentId: string },
  ): Promise<void> {
    await tx.execute(sql`
      INSERT INTO application_access_log
        (tenant_id, action, job_posting_id, application_id, document_id, actor_user_id)
      VALUES (${user.tenantId}, ${consultation.action},
              ${'jobPostingId' in consultation ? consultation.jobPostingId : null},
              ${'applicationId' in consultation ? consultation.applicationId : null},
              ${'documentId' in consultation ? consultation.documentId : null},
              ${user.userId})`);
  }

  async create(
    user: SessionUser,
    input: CreateJobPostingInput,
  ): Promise<{ id: string; publicSlug: string }> {
    const id = uuidv7();
    // Le slug est un identifiant public non devinable (pas un secret) : il
    // rend l'offre accessible sans permettre d'énumérer les autres.
    const publicSlug = randomBytes(16).toString('base64url');
    await this.db.withTenant(ctxOf(user), async (tx) => {
      if (input.orgUnitId) await this.requireOrgUnit(tx, input.orgUnitId);
      await refuserUneDateLimitePassee(tx, input.deadline ?? null);
      const reference = await this.prochaineReference(tx, user.tenantId);
      await tx.insert(t.jobPostings).values({
        id,
        tenantId: user.tenantId,
        reference,
        title: input.title,
        description: input.description,
        orgUnitId: input.orgUnitId ?? null,
        contractType: input.contractType,
        location: input.location ?? null,
        deadline: input.deadline ?? null,
        requiredDocuments: input.requiredDocuments,
        niveauEtudes: input.niveauEtudes,
        experienceMin: input.experienceMin,
        langues: input.langues,
        dureeMois: dureeSelonContrat(input.contractType, input.dureeMois),
        publicSlug,
        createdByUserId: user.userId,
      });
    });
    return { id, publicSlug };
  }

  async list(user: SessionUser): Promise<JobPostingView[]> {
    return this.db.withTenant(ctxOf(user), async (tx) => {
      const rows = await tx
        .select({
          posting: t.jobPostings,
          orgUnitName: t.orgUnits.name,
          counts: sql<Record<string, number> | null>`(
            SELECT jsonb_object_agg(s.stage, s.n) FROM (
              SELECT a.stage, count(*)::int AS n FROM applications a
              WHERE a.job_posting_id = ${t.jobPostings.id}
              GROUP BY a.stage
            ) s)`,
        })
        .from(t.jobPostings)
        .leftJoin(t.orgUnits, eq(t.orgUnits.id, t.jobPostings.orgUnitId))
        .orderBy(desc(t.jobPostings.createdAt));
      return rows.map((r) => this.toView(r.posting, r.orgUnitName, r.counts));
    });
  }

  async detail(user: SessionUser, id: string): Promise<JobPostingView> {
    return this.db.withTenant(ctxOf(user), async (tx) => {
      const row = await this.requirePosting(tx, id);
      const [unit] = row.orgUnitId
        ? await tx
            .select({ name: t.orgUnits.name })
            .from(t.orgUnits)
            .where(eq(t.orgUnits.id, row.orgUnitId))
            .limit(1)
        : [];
      const counts = await tx
        .select({ stage: t.applications.stage, n: sql<number>`count(*)::int` })
        .from(t.applications)
        .where(eq(t.applications.jobPostingId, id))
        .groupBy(t.applications.stage);
      return this.toView(
        row,
        unit?.name ?? null,
        Object.fromEntries(counts.map((c) => [c.stage, c.n])),
      );
    });
  }

  async update(user: SessionUser, id: string, input: UpdateJobPostingInput): Promise<void> {
    await this.db.withTenant(ctxOf(user), async (tx) => {
      const actuelle = await this.requirePosting(tx, id);
      if (input.orgUnitId) await this.requireOrgUnit(tx, input.orgUnitId);
      // Seule une NOUVELLE date limite se vérifie : celle qui est déjà passée
      // n'empêche ni de modifier l'offre, ni de la publier, ni de la rouvrir.
      if (input.deadline !== undefined && input.deadline !== actuelle.deadline) {
        await refuserUneDateLimitePassee(tx, input.deadline);
      }

      const changes: Partial<typeof t.jobPostings.$inferInsert> = {};
      if (input.title !== undefined) changes.title = input.title;
      if (input.description !== undefined) changes.description = input.description;
      if (input.orgUnitId !== undefined) changes.orgUnitId = input.orgUnitId;
      if (input.contractType !== undefined) changes.contractType = input.contractType;
      if (input.location !== undefined) changes.location = input.location;
      if (input.deadline !== undefined) changes.deadline = input.deadline;
      if (input.requiredDocuments !== undefined) {
        changes.requiredDocuments = input.requiredDocuments;
      }
      if (input.niveauEtudes !== undefined) changes.niveauEtudes = input.niveauEtudes;
      if (input.experienceMin !== undefined) changes.experienceMin = input.experienceMin;
      if (input.langues !== undefined) changes.langues = input.langues;
      // La durée se juge sur l'état FINAL de l'offre : contrat et durée
      // peuvent changer ensemble, ou l'un sans l'autre.
      if (input.contractType !== undefined || input.dureeMois !== undefined) {
        changes.dureeMois = dureeSelonContrat(
          input.contractType ?? actuelle.contractType,
          input.dureeMois === undefined ? actuelle.dureeMois : input.dureeMois,
        );
      }
      if (input.status !== undefined) changes.status = input.status;
      // Rendue publique : c'est de ce jour que la page la date.
      if (input.status === 'published' && actuelle.status !== 'published') {
        changes.publishedAt = new Date();
      }
      if (Object.keys(changes).length === 0) return;
      changes.updatedAt = new Date();
      await tx.update(t.jobPostings).set(changes).where(eq(t.jobPostings.id, id));
    });
  }

  /**
   * Candidatures d'une offre, avec les métadonnées de leurs documents. Les
   * rejetées n'y sont plus : elles ont leur page (`rejetees`).
   */
  async applications(user: SessionUser, jobId: string): Promise<ApplicationView[]> {
    return this.db.withTenant(ctxOf(user), async (tx) => {
      await this.requirePosting(tx, jobId);
      const apps = await tx
        .select()
        .from(t.applications)
        .where(and(eq(t.applications.jobPostingId, jobId), ne(t.applications.stage, 'rejected')))
        .orderBy(desc(t.applications.createdAt));
      const ids = apps.map((a) => a.id);
      const byApp = await this.piecesDe(tx, ids);
      const refus = await this.refusEnvoyes(tx, ids);
      await this.tracer(tx, user, { action: 'list', jobPostingId: jobId });
      return apps.map((a) => this.vueCandidature(a, byApp, refus));
    });
  }

  /**
   * Les candidatures rejetées, toutes offres confondues, la plus récente
   * d'abord, une page à la fois (ADR-0068).
   *
   * Sans recherche, la base pagine seule. Avec, il faut les noms : chiffrés
   * au repos, ils se déchiffrent ici, eux seuls et hors de toute
   * transaction, puis seule la page se lit en entier. Avant, chaque appel
   * déchiffrait et renvoyait tous les dossiers (4,5 Mo pour 6 000), et
   * vingt appels simultanés prenaient toutes les connexions.
   *
   * La lecture se trace comme celle d'une offre : une ligne par offre dont
   * la page montre des dossiers.
   */
  async rejetees(
    user: SessionUser,
    query: RejectedApplicationsQuery,
  ): Promise<RejectedApplicationsPage> {
    const ordre = [desc(t.applications.updatedAt), desc(t.applications.id)];
    const rejetee = eq(t.applications.stage, 'rejected');
    const recherche = query.q?.trim() ?? '';
    let total: number;
    let ids: string[];
    if (!recherche) {
      ({ total, ids } = await this.db.withTenant(ctxOf(user), async (tx) => {
        const [compte] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(t.applications)
          .where(rejetee);
        const page = await tx
          .select({ id: t.applications.id })
          .from(t.applications)
          .where(rejetee)
          .orderBy(...ordre)
          .limit(query.limit)
          .offset(query.offset);
        return { total: compte?.n ?? 0, ids: page.map((p) => p.id) };
      }));
    } else {
      const lignes = await this.db.withTenant(ctxOf(user), (tx) =>
        tx
          .select({
            id: t.applications.id,
            tenantId: t.applications.tenantId,
            givenName: t.applications.givenName,
            familyName: t.applications.familyName,
            cleVersion: t.applications.cleVersion,
            jobTitle: t.jobPostings.title,
            jobReference: t.jobPostings.reference,
          })
          .from(t.applications)
          .innerJoin(t.jobPostings, eq(t.jobPostings.id, t.applications.jobPostingId))
          .where(rejetee)
          .orderBy(...ordre),
      );
      const trouvees = lignes.filter((l) => {
        const { givenName, familyName } = nomsDuCandidat(this.enc, l);
        return correspond(recherche, `${givenName} ${familyName}`, l.jobTitle, l.jobReference);
      });
      total = trouvees.length;
      ids = trouvees.slice(query.offset, query.offset + query.limit).map((l) => l.id);
    }
    if (ids.length === 0) return { items: [], total };

    const items = await this.db.withTenant(ctxOf(user), async (tx) => {
      const lignes = await tx
        .select({ candidature: t.applications, offre: t.jobPostings })
        .from(t.applications)
        .innerJoin(t.jobPostings, eq(t.jobPostings.id, t.applications.jobPostingId))
        .where(and(inArray(t.applications.id, ids), rejetee))
        .orderBy(...ordre);
      const byApp = await this.piecesDe(tx, ids);
      const refus = await this.refusEnvoyes(tx, ids);
      for (const jobPostingId of new Set(lignes.map((l) => l.offre.id))) {
        await this.tracer(tx, user, { action: 'list', jobPostingId });
      }
      return lignes.map(({ candidature, offre }) => ({
        ...this.vueCandidature(candidature, byApp, refus),
        jobTitle: offre.title,
        jobReference: offre.reference,
        jobCreatedAt: offre.createdAt.toISOString(),
        rejectedAt: candidature.updatedAt.toISOString(),
      }));
    });
    return { items, total };
  }

  /** Combien de candidatures rejetées : la page n'a d'entrée au menu qu'à partir d'une. */
  async nombreDeRejetees(user: SessionUser): Promise<{ count: number }> {
    return this.db.withTenant(ctxOf(user), async (tx) => {
      const [r] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(t.applications)
        .where(eq(t.applications.stage, 'rejected'));
      return { count: r?.n ?? 0 };
    });
  }

  private vueCandidature(
    a: typeof t.applications.$inferSelect,
    byApp: Map<string, ApplicationView['documents']>,
    refus: Set<string>,
  ): ApplicationView {
    return {
      id: a.id,
      jobPostingId: a.jobPostingId,
      ...dechiffrerCandidature(this.enc, a),
      stage: a.stage as ApplicationStage,
      createdAt: a.createdAt.toISOString(),
      documents: byApp.get(a.id) ?? [],
      refusalSent: refus.has(a.id),
    };
  }

  /** Celles dont le courriel de refus est déjà parti. */
  private async refusEnvoyes(tx: Tx, applicationIds: string[]): Promise<Set<string>> {
    if (applicationIds.length === 0) return new Set();
    const partis = await tx
      .selectDistinct({ id: t.outboundEmails.subjectId })
      .from(t.outboundEmails)
      .where(
        and(
          eq(t.outboundEmails.kind, 'candidature_refusee'),
          eq(t.outboundEmails.status, 'sent'),
          inArray(t.outboundEmails.subjectId, applicationIds),
        ),
      );
    return new Set(partis.flatMap((p) => (p.id ? [p.id] : [])));
  }

  /** Les pièces de ces candidatures, sans leur contenu. */
  private async piecesDe(
    tx: Tx,
    applicationIds: string[],
  ): Promise<Map<string, ApplicationView['documents']>> {
    const byApp = new Map<string, ApplicationView['documents']>();
    if (applicationIds.length === 0) return byApp;
    const docs = await tx
      .select({
        id: t.applicationDocuments.id,
        tenantId: t.applicationDocuments.tenantId,
        applicationId: t.applicationDocuments.applicationId,
        label: t.applicationDocuments.label,
        filename: t.applicationDocuments.filename,
        contentType: t.applicationDocuments.contentType,
        sizeBytes: t.applicationDocuments.sizeBytes,
        cleVersion: t.applicationDocuments.cleVersion,
      })
      .from(t.applicationDocuments)
      .where(inArray(t.applicationDocuments.applicationId, applicationIds));
    for (const d of docs) {
      const list = byApp.get(d.applicationId) ?? [];
      list.push({
        id: d.id,
        label: d.label,
        filename: nomDeLaPiece(this.enc, d),
        contentType: d.contentType,
        sizeBytes: d.sizeBytes,
      });
      byApp.set(d.applicationId, list);
    }
    return byApp;
  }

  /**
   * L'étape d'une candidature. Rejetée, elle vaut un courriel de refus, mis
   * en file avec le geste : un seul, même rejetée de nouveau après avoir été
   * reconsidérée. Une candidature rejetée ne change plus d'étape par
   * ce chemin : elle se reconsidère (`reconsider`), ce qui retient son refus.
   */
  async updateStage(user: SessionUser, applicationId: string, stage: string): Promise<void> {
    const enFile = await this.db.withTenant(ctxOf(user), async (tx) => {
      const [avant] = await tx
        .select()
        .from(t.applications)
        .where(eq(t.applications.id, applicationId))
        .for('update');
      if (!avant) {
        problem(404, 'recruitment.application_not_found', 'Candidature introuvable');
      }
      if (avant.stage === stage) return false;
      if (avant.stage === 'rejected') {
        problem(
          409,
          'recruitment.candidature_rejetee',
          'Cette candidature a été rejetée : reconsidérez-la depuis les candidatures non retenues.',
        );
      }
      await tx
        .update(t.applications)
        .set({ stage, updatedAt: new Date() })
        .where(eq(t.applications.id, applicationId));
      if (stage !== 'rejected' || !this.expediteur) return false;
      // Une seule réponse : le refus déjà parti, ou en partance, suffit.
      const [dejaRepondu] = await tx
        .select({ id: t.outboundEmails.id })
        .from(t.outboundEmails)
        .where(
          and(
            eq(t.outboundEmails.subjectId, applicationId),
            eq(t.outboundEmails.kind, 'candidature_refusee'),
            inArray(t.outboundEmails.status, ['pending', 'sent']),
          ),
        )
        .limit(1);
      if (dejaRepondu) return false;

      const [offre] = await tx
        .select({ titre: t.jobPostings.title, reference: t.jobPostings.reference })
        .from(t.jobPostings)
        .where(eq(t.jobPostings.id, avant.jobPostingId));
      if (!offre) return false;
      const candidat = dechiffrerCandidature(this.enc, avant);
      // L'adresse ne se recopie pas : elle se lit dans la candidature au départ.
      return this.expediteur.mettreEnFile(tx, {
        tenantId: user.tenantId,
        kind: 'candidature_refusee',
        subjectId: applicationId,
        to: null,
        gabarit: {
          nom: 'refus_candidature',
          prenom: premierPrenom(candidat.givenName),
          // La raison sociale, comme dans le corps des actes : « APIX S.A ».
          organisation: ENTETE.raisonSociale,
          poste: offre.titre,
          reference: offre.reference,
        },
      });
    });
    if (enFile) this.expediteur?.bientot();
  }

  /**
   * Supprime une ou plusieurs offres, en une transaction.
   *
   * Une offre qui porte des candidatures est ÉCARTÉE, pas effacée : les
   * dossiers déposés appartiennent à des candidats, et les emporter en
   * refermant une campagne serait une perte que personne n'a demandée. Le
   * résultat nomme ce qui n'est pas parti, plutôt que d'échouer en bloc et de
   * laisser la RH deviner laquelle bloquait.
   */
  async remove(user: SessionUser, input: DeleteJobPostingsInput): Promise<DeleteJobPostingsResult> {
    return this.db.withTenant(ctxOf(user), async (tx) => {
      const offres = await tx
        .select({ id: t.jobPostings.id, title: t.jobPostings.title })
        .from(t.jobPostings)
        .where(inArray(t.jobPostings.id, input.ids))
        .orderBy(t.jobPostings.id)
        .for('update');
      const connues = new Map(offres.map((o) => [o.id, o]));

      const comptes = offres.length
        ? await tx
            .select({
              jobPostingId: t.applications.jobPostingId,
              n: sql<number>`count(*)::int`,
            })
            .from(t.applications)
            .where(
              inArray(
                t.applications.jobPostingId,
                offres.map((o) => o.id),
              ),
            )
            .groupBy(t.applications.jobPostingId)
        : [];
      const parOffre = new Map(comptes.map((c) => [c.jobPostingId, c.n]));

      const skipped: DeleteJobPostingsResult['skipped'] = [];
      const aSupprimer: string[] = [];
      for (const id of input.ids) {
        const offre = connues.get(id);
        if (!offre) {
          skipped.push({ id, title: '', reason: 'Offre introuvable' });
          continue;
        }
        const n = parOffre.get(id) ?? 0;
        if (n > 0) {
          skipped.push({
            id,
            title: offre.title,
            reason: `${n} candidature${n > 1 ? 's' : ''} déposée${n > 1 ? 's' : ''} : fermez l’offre plutôt`,
          });
          continue;
        }
        aSupprimer.push(id);
      }

      if (aSupprimer.length > 0) {
        await tx.delete(t.jobPostings).where(inArray(t.jobPostings.id, aSupprimer));
      }
      return { deleted: aSupprimer.length, skipped };
    });
  }

  /** Les candidatures de ce lot encore non retenues, verrouillées le temps du geste. */
  private async nonRetenuesDuLot(tx: Tx, ids: string[]): Promise<string[]> {
    const lignes = await tx
      .select({ id: t.applications.id })
      .from(t.applications)
      .where(and(inArray(t.applications.id, ids), eq(t.applications.stage, 'rejected')))
      .orderBy(t.applications.id)
      .for('update');
    return lignes.map((l) => l.id);
  }

  /**
   * Reconsidérer des candidatures non retenues : chacune retrouve les
   * dossiers de son offre, à l'étape où elle était avant le rejet. Le journal
   * la garde (0079) ; à défaut, « reçue ». Le refus qui n'est pas encore
   * parti ne part plus ; déjà parti, un nouveau rejet n'en renverra pas un
   * second (`updateStage`).
   *
   * Une candidature qui n'est plus non retenue (reconsidérée par quelqu'un
   * d'autre entre-temps) est laissée telle quelle.
   */
  async reconsider(
    user: SessionUser,
    input: RejectedApplicationsInput,
  ): Promise<ReconsiderApplicationsResult> {
    return this.db.withTenant(ctxOf(user), async (tx) => {
      const ids = await this.nonRetenuesDuLot(tx, input.ids);
      if (ids.length === 0) return { reconsidered: 0 };
      // Un seul paramètre, découpé côté base : un tableau passé tel quel se
      // développerait en tuple, que Postgres refuse de couler en uuid[].
      const lot = sql`string_to_array(${ids.join(',')}, ',')::uuid[]`;
      await tx.execute(sql`
        UPDATE applications a
           SET stage = COALESCE((
                 SELECT l.old_data ->> 'stage' FROM audit_log l
                  WHERE l.table_name = 'applications' AND l.row_id = a.id
                    AND l.action = 'UPDATE' AND l.new_data ->> 'stage' = 'rejected'
                    AND l.old_data ->> 'stage' IN ('received', 'screening', 'interview', 'offer', 'hired')
                  ORDER BY l.occurred_at DESC
                  LIMIT 1), 'received'),
               updated_at = now()
         WHERE a.id = ANY(${lot})`);
      await tx.execute(sql`
        UPDATE outbound_emails
           SET status = 'cancelled', body_encrypted = NULL
         WHERE kind = 'candidature_refusee' AND status = 'pending'
           AND subject_id = ANY(${lot})`);
      return { reconsidered: ids.length };
    });
  }

  /**
   * Supprimer définitivement des candidatures non retenues : le dossier, ses
   * pièces et les courriels qui en parlaient (accusé de réception, refus)
   * s'effacent ; l'adresse se libère (index unique) pour une nouvelle
   * candidature. Le journal garde la trace des gestes, plus leur contenu. Le
   * journal des consultations demeure : il ne porte que des identifiants,
   * rien de la personne (0079).
   *
   * Une candidature encore en lice ne s'efface pas par ce chemin : elle se
   * rejette d'abord. Reconsidérée entre-temps, elle est laissée.
   */
  async deleteApplications(
    user: SessionUser,
    input: RejectedApplicationsInput,
  ): Promise<DeleteApplicationsResult> {
    return this.db.withTenant(ctxOf(user), async (tx) => {
      const ids = await this.nonRetenuesDuLot(tx, input.ids);
      if (ids.length === 0) return { deleted: 0 };
      const pieces = await tx
        .delete(t.applicationDocuments)
        .where(inArray(t.applicationDocuments.applicationId, ids))
        .returning({ id: t.applicationDocuments.id });
      await tx.delete(t.applications).where(inArray(t.applications.id, ids));
      await tx.delete(t.outboundEmails).where(inArray(t.outboundEmails.subjectId, ids));
      // En dernier : chaque suppression vient d'écrire au journal une copie
      // de la ligne effacée. C'est ce contenu-là qu'on retire, en laissant la
      // trace de l'opération.
      const traces = [...ids, ...pieces.map((p) => p.id)];
      await tx.execute(
        sql`SELECT erase_audit_payload(string_to_array(${traces.join(',')}, ',')::uuid[])`,
      );
      return { deleted: ids.length };
    });
  }

  /** Téléchargement d'un document par le staff (jamais exposé publiquement). */
  async document(
    user: SessionUser,
    documentId: string,
  ): Promise<{ filename: string; contentType: string; data: Buffer }> {
    return this.db.withTenant(ctxOf(user), async (tx) => {
      const [doc] = await tx
        .select({
          id: t.applicationDocuments.id,
          tenantId: t.applicationDocuments.tenantId,
          applicationId: t.applicationDocuments.applicationId,
          filename: t.applicationDocuments.filename,
          contentType: t.applicationDocuments.contentType,
          data: t.applicationDocuments.data,
          cleVersion: t.applicationDocuments.cleVersion,
        })
        .from(t.applicationDocuments)
        .where(eq(t.applicationDocuments.id, documentId))
        .limit(1);
      if (!doc) {
        problem(404, 'recruitment.document_not_found', 'Document introuvable');
      }
      await this.tracer(tx, user, {
        action: 'document',
        applicationId: doc.applicationId,
        documentId: doc.id,
      });
      return {
        filename: nomDeLaPiece(this.enc, doc),
        // Un dépôt ancien n'a pas été contrôlé comme un PDF : il se télécharge
        // sans que le navigateur l'interprète.
        contentType:
          doc.contentType === 'application/pdf' ? doc.contentType : 'application/octet-stream',
        data: contenuDeLaPiece(this.enc, doc),
      };
    });
  }

  private toView(
    p: typeof t.jobPostings.$inferSelect,
    orgUnitName: string | null,
    counts: Record<string, number> | null,
  ): JobPostingView {
    return {
      id: p.id,
      reference: p.reference,
      title: p.title,
      description: p.description,
      orgUnitId: p.orgUnitId,
      orgUnitName,
      contractType: p.contractType,
      location: p.location,
      deadline: p.deadline,
      requiredDocuments: p.requiredDocuments,
      niveauEtudes: p.niveauEtudes as JobPostingView['niveauEtudes'],
      experienceMin: p.experienceMin,
      langues: p.langues as JobPostingView['langues'],
      dureeMois: p.dureeMois,
      status: p.status as JobPostingView['status'],
      publicSlug: p.publicSlug,
      createdAt: p.createdAt.toISOString(),
      publishedAt: p.publishedAt?.toISOString() ?? null,
      applicationCounts: counts ?? {},
    };
  }

  private async requirePosting(tx: Tx, id: string) {
    const [row] = await tx.select().from(t.jobPostings).where(eq(t.jobPostings.id, id)).limit(1);
    if (!row) {
      problem(404, 'recruitment.job_not_found', 'Offre introuvable');
    }
    return row;
  }

  /**
   * Le numéro suivant du registre : OFF-AAAA-NNN, remis à 001 chaque janvier.
   *
   * Le compteur vit dans sa propre table et n'est JAMAIS décrémenté. Le
   * déduire des offres présentes le rendrait à la suppression d'une offre —
   * et un courrier archivé citant OFF-2026-002 désignerait alors deux
   * campagnes. L'incrément se fait en une écriture atomique : deux créations
   * simultanées ne peuvent pas obtenir le même numéro.
   */
  private async prochaineReference(tx: Tx, tenantId: string): Promise<string> {
    const annee = new Date().getFullYear();
    const [row] = await tx
      .insert(t.jobPostingCounters)
      .values({ tenantId, year: annee, lastNumber: 1 })
      .onConflictDoUpdate({
        target: [t.jobPostingCounters.tenantId, t.jobPostingCounters.year],
        set: { lastNumber: sql`${t.jobPostingCounters.lastNumber} + 1` },
      })
      .returning({ n: t.jobPostingCounters.lastNumber });
    return `OFF-${annee}-${String(row!.n).padStart(3, '0')}`;
  }

  private async requireOrgUnit(tx: Tx, id: string) {
    const [unit] = await tx
      .select({ id: t.orgUnits.id })
      .from(t.orgUnits)
      .where(and(eq(t.orgUnits.id, id), sql`${t.orgUnits.deletedAt} IS NULL`))
      .limit(1);
    if (!unit) {
      problem(422, 'org.unit_not_found', "Cette unité n'existe pas");
    }
  }
}
