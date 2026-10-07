import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { CONTRATS_A_DUREE, premierPrenom } from '@teranga/contracts';
import type {
  ApplicationStage,
  ApplicationView,
  CreateJobPostingInput,
  DeleteJobPostingsInput,
  DeleteJobPostingsResult,
  JobPostingView,
  SessionUser,
  UpdateJobPostingInput,
} from '@teranga/contracts';
import { EncryptionService } from '../../common/encryption.service';
import { problem } from '../../common/problem';
import * as t from '../../db/schema';
import { TenantDb, Tx } from '../../db/tenant-db';
import { parLeSysteme } from '../../db/systeme';
import { ExpediteurCourriels } from '../courriels/expediteur';
import { contenuDeLaPiece, dechiffrerCandidature, nomDeLaPiece } from './chiffrement';

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
 * Une offre se ferme d'elle-même le lendemain de sa date limite : son statut
 * dit alors ce que lit le candidat. Relu à chaque lecture de la liste.
 */
async function cloreLesOffresEchues(tx: Tx): Promise<void> {
  await parLeSysteme(tx, () =>
    tx.execute(sql`
      UPDATE job_postings SET status = 'closed', updated_at = now()
       WHERE status = 'published' AND deadline < CURRENT_DATE`),
  );
}

/** Une date limite déjà passée ne se publie pas : l'offre serait close à l'instant. */
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
      await cloreLesOffresEchues(tx);
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
      await cloreLesOffresEchues(tx);
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
      await cloreLesOffresEchues(tx);
      const actuelle = await this.requirePosting(tx, id);
      if (input.orgUnitId) await this.requireOrgUnit(tx, input.orgUnitId);
      // Ce que l'offre sera une fois modifiée : publiée, sa date limite doit
      // être à venir. Une date reportée ne la rouvre pas d'elle-même.
      const statut = input.status ?? actuelle.status;
      const limite = input.deadline !== undefined ? input.deadline : actuelle.deadline;
      if (statut === 'published' || input.deadline !== undefined) {
        await refuserUneDateLimitePassee(tx, limite);
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

  /** Candidatures d'une offre, avec les métadonnées de leurs documents. */
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
          tenantId: t.applicationDocuments.tenantId,
          applicationId: t.applicationDocuments.applicationId,
          label: t.applicationDocuments.label,
          filename: t.applicationDocuments.filename,
          contentType: t.applicationDocuments.contentType,
          sizeBytes: t.applicationDocuments.sizeBytes,
          cleVersion: t.applicationDocuments.cleVersion,
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
          filename: nomDeLaPiece(this.enc, d),
          contentType: d.contentType,
          sizeBytes: d.sizeBytes,
        });
        byApp.set(d.applicationId, list);
      }
      await this.tracer(tx, user, { action: 'list', jobPostingId: jobId });
      return apps.map((a) => ({
        id: a.id,
        jobPostingId: a.jobPostingId,
        ...dechiffrerCandidature(this.enc, a),
        stage: a.stage as ApplicationStage,
        createdAt: a.createdAt.toISOString(),
        documents: byApp.get(a.id) ?? [],
      }));
    });
  }

  /**
   * L'étape d'une candidature. Rejetée, elle vaut au candidat un courriel de
   * refus, mis en file avec le geste ; elle ne se rouvre plus : le candidat a
   * reçu la réponse.
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
          'Cette candidature a été rejetée : le candidat en a reçu la réponse.',
        );
      }
      await tx
        .update(t.applications)
        .set({ stage, updatedAt: new Date() })
        .where(eq(t.applications.id, applicationId));
      if (stage !== 'rejected' || !this.expediteur) return false;

      const [offre] = await tx
        .select({
          titre: t.jobPostings.title,
          reference: t.jobPostings.reference,
          organisation: t.tenants.name,
        })
        .from(t.jobPostings)
        .innerJoin(t.tenants, eq(t.tenants.id, t.jobPostings.tenantId))
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
          organisation: offre.organisation,
          poste: offre.titre,
          reference: offre.reference,
        },
      });
    });
    if (enFile) this.expediteur?.bientot();
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
      // Le journal avait gardé la candidature à chaque étape (nom, email,
      // téléphone, message) : il garde la trace des gestes, plus leur contenu.
      await tx.execute(sql`SELECT erase_audit_payload(ARRAY[${applicationId}]::uuid[])`);
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
