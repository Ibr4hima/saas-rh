import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type {
  ApplicationListItem,
  ApplicationStage,
  ApplicationView,
  CreateJobPostingInput,
  DeleteJobPostingsInput,
  DeleteJobPostingsResult,
  JobPostingView,
  SessionUser,
  UpdateJobPostingInput,
} from '@teranga/contracts';
import { problem } from '../../common/problem';
import * as t from '../../db/schema';
import { TenantDb, Tx } from '../../db/tenant-db';

function ctxOf(user: SessionUser): { tenantId: string; userId: string } {
  return { tenantId: user.tenantId, userId: user.userId };
}

@Injectable()
export class JobsService {
  constructor(@Inject(TenantDb) private readonly db: TenantDb) {}

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
      await this.requirePosting(tx, id);
      if (input.orgUnitId) await this.requireOrgUnit(tx, input.orgUnitId);

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
      if (input.status !== undefined) changes.status = input.status;
      if (Object.keys(changes).length === 0) return;
      changes.updatedAt = new Date();
      await tx.update(t.jobPostings).set(changes).where(eq(t.jobPostings.id, id));
    });
  }

  /** Candidatures d'une offre, avec les métadonnées de leurs documents. */
  /**
   * Toutes les candidatures du tenant, offres confondues.
   *
   * Le pipeline d'une offre répond à « où en est ce recrutement ». Cette liste
   * répond à l'autre question, celle qu'on se pose le lundi matin : « qui a
   * postulé, et à quoi ». Elle porte donc le titre de l'offre sur chaque ligne.
   */
  async allApplications(
    user: SessionUser,
    filters: { stage?: ApplicationStage },
  ): Promise<ApplicationListItem[]> {
    return this.db.withTenant(ctxOf(user), async (tx) => {
      const rows = await tx
        .select({
          app: t.applications,
          jobTitle: t.jobPostings.title,
          jobStatus: t.jobPostings.status,
        })
        .from(t.applications)
        .innerJoin(t.jobPostings, eq(t.jobPostings.id, t.applications.jobPostingId))
        .where(filters.stage ? eq(t.applications.stage, filters.stage) : undefined)
        .orderBy(desc(t.applications.createdAt))
        .limit(200);
      if (rows.length === 0) return [];

      const docs = await tx
        .select({
          id: t.applicationDocuments.id,
          applicationId: t.applicationDocuments.applicationId,
          label: t.applicationDocuments.label,
          filename: t.applicationDocuments.filename,
          contentType: t.applicationDocuments.contentType,
          sizeBytes: t.applicationDocuments.sizeBytes,
        })
        .from(t.applicationDocuments)
        .where(
          inArray(
            t.applicationDocuments.applicationId,
            rows.map((r) => r.app.id),
          ),
        );
      const byApp = new Map<string, ApplicationView['documents']>();
      for (const d of docs) {
        const list = byApp.get(d.applicationId) ?? [];
        list.push({
          id: d.id,
          label: d.label,
          filename: d.filename,
          contentType: d.contentType,
          sizeBytes: d.sizeBytes,
        });
        byApp.set(d.applicationId, list);
      }

      return rows.map((r) => ({
        id: r.app.id,
        jobPostingId: r.app.jobPostingId,
        jobTitle: r.jobTitle,
        jobStatus: r.jobStatus,
        givenName: r.app.givenName,
        familyName: r.app.familyName,
        email: r.app.email,
        phone: r.app.phone,
        message: r.app.message,
        stage: r.app.stage as ApplicationStage,
        createdAt: r.app.createdAt.toISOString(),
        documents: byApp.get(r.app.id) ?? [],
      }));
    });
  }

  async applications(user: SessionUser, jobId: string): Promise<ApplicationView[]> {
    return this.db.withTenant(ctxOf(user), async (tx) => {
      await this.requirePosting(tx, jobId);
      const apps = await tx
        .select()
        .from(t.applications)
        .where(eq(t.applications.jobPostingId, jobId))
        .orderBy(desc(t.applications.createdAt));
      const docs = await tx
        .select({
          id: t.applicationDocuments.id,
          applicationId: t.applicationDocuments.applicationId,
          label: t.applicationDocuments.label,
          filename: t.applicationDocuments.filename,
          contentType: t.applicationDocuments.contentType,
          sizeBytes: t.applicationDocuments.sizeBytes,
        })
        .from(t.applicationDocuments)
        .innerJoin(t.applications, eq(t.applications.id, t.applicationDocuments.applicationId))
        .where(eq(t.applications.jobPostingId, jobId));

      const byApp = new Map<string, ApplicationView['documents']>();
      for (const d of docs) {
        const list = byApp.get(d.applicationId) ?? [];
        list.push({
          id: d.id,
          label: d.label,
          filename: d.filename,
          contentType: d.contentType,
          sizeBytes: d.sizeBytes,
        });
        byApp.set(d.applicationId, list);
      }
      return apps.map((a) => ({
        id: a.id,
        jobPostingId: a.jobPostingId,
        givenName: a.givenName,
        familyName: a.familyName,
        email: a.email,
        phone: a.phone,
        message: a.message,
        stage: a.stage as ApplicationStage,
        createdAt: a.createdAt.toISOString(),
        documents: byApp.get(a.id) ?? [],
      }));
    });
  }

  async updateStage(user: SessionUser, applicationId: string, stage: string): Promise<void> {
    await this.db.withTenant(ctxOf(user), async (tx) => {
      const updated = await tx
        .update(t.applications)
        .set({ stage, updatedAt: new Date() })
        .where(eq(t.applications.id, applicationId))
        .returning({ id: t.applications.id });
      if (updated.length === 0) {
        problem(404, 'recruitment.application_not_found', 'Candidature introuvable');
      }
    });
  }

  /**
   * Suppression d'une candidature par la RH — la voie de remédiation quand un
   * tiers a « squatté » l'email d'un candidat via le formulaire public : la
   * supprimer libère l'email (index unique) pour une vraie candidature.
   */
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
            reason: `${n} candidature${n > 1 ? 's' : ''} déposée${n > 1 ? 's' : ''} — fermez l’offre plutôt`,
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

  async deleteApplication(user: SessionUser, applicationId: string): Promise<void> {
    await this.db.withTenant(ctxOf(user), async (tx) => {
      await tx
        .delete(t.applicationDocuments)
        .where(eq(t.applicationDocuments.applicationId, applicationId));
      const deleted = await tx
        .delete(t.applications)
        .where(eq(t.applications.id, applicationId))
        .returning({ id: t.applications.id });
      if (deleted.length === 0) {
        problem(404, 'recruitment.application_not_found', 'Candidature introuvable');
      }
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
          filename: t.applicationDocuments.filename,
          contentType: t.applicationDocuments.contentType,
          data: t.applicationDocuments.data,
        })
        .from(t.applicationDocuments)
        .where(eq(t.applicationDocuments.id, documentId))
        .limit(1);
      if (!doc) {
        problem(404, 'recruitment.document_not_found', 'Document introuvable');
      }
      return doc;
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
      status: p.status as JobPostingView['status'],
      publicSlug: p.publicSlug,
      createdAt: p.createdAt.toISOString(),
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
