import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { ApplyInput, PublicJobInfo } from '@teranga/contracts';
import { MAX_DOCUMENT_BYTES } from '@teranga/contracts';
import { problem } from '../../common/problem';
import * as t from '../../db/schema';
import { TenantDb } from '../../db/tenant-db';

function pgCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code ?? e?.cause?.code;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Garde anti-abus best-effort, en mémoire : borne le nombre de dépôts par IP
 * sur une fenêtre glissante. Suffisant pour le pilote (instance unique) ; un
 * vrai rate-limiter partagé viendra avec l'infrastructure de production.
 */
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 10;

@Injectable()
export class ApplyService {
  private readonly attempts = new Map<string, number[]>();

  constructor(@Inject(TenantDb) private readonly db: TenantDb) {}

  /** Ce que voit le candidat qui suit le lien : l'offre publiée, rien d'autre. */
  async info(slug: string): Promise<PublicJobInfo> {
    return this.db.withJobSlug(slug, async (tx) => {
      const [row] = await tx
        .select({
          reference: t.jobPostings.reference,
          title: t.jobPostings.title,
          description: t.jobPostings.description,
          contractType: t.jobPostings.contractType,
          location: t.jobPostings.location,
          deadline: t.jobPostings.deadline,
          requiredDocuments: t.jobPostings.requiredDocuments,
          organizationName: t.tenants.name,
        })
        .from(t.jobPostings)
        .innerJoin(t.tenants, eq(t.tenants.id, t.jobPostings.tenantId))
        .limit(1);
      if (!row) return { valid: false, reason: 'not_found' };
      if (row.deadline && row.deadline < todayIso()) return { valid: false, reason: 'closed' };
      return {
        valid: true,
        organizationName: row.organizationName,
        reference: row.reference,
        title: row.title,
        description: row.description,
        contractType: row.contractType,
        location: row.location,
        deadline: row.deadline,
        requiredDocuments: row.requiredDocuments,
      };
    });
  }

  async apply(slug: string, input: ApplyInput, ip: string | undefined): Promise<void> {
    // Clé (ip, offre) : une IP partagée (proxy mal configuré, NAT d'entreprise)
    // ne verrouille pas toutes les offres de la plateforme d'un coup.
    this.throttle(`${ip ?? 'unknown'}|${slug}`);

    // Décodage et validation des fichiers AVANT la transaction.
    const files = input.documents.map((d) => {
      const data = Buffer.from(d.contentBase64, 'base64');
      if (data.length === 0 || data.length > MAX_DOCUMENT_BYTES) {
        problem(422, 'recruitment.document_too_large', 'Chaque document doit faire 5 Mo maximum');
      }
      return { label: d.label, filename: d.filename, contentType: d.contentType, data };
    });

    try {
      await this.db.withJobSlug(slug, async (tx) => {
        const [posting] = await tx
          .select({
            id: t.jobPostings.id,
            tenantId: t.jobPostings.tenantId,
            deadline: t.jobPostings.deadline,
            requiredDocuments: t.jobPostings.requiredDocuments,
          })
          .from(t.jobPostings)
          .limit(1);
        if (!posting || (posting.deadline && posting.deadline < todayIso())) {
          problem(410, 'recruitment.job_unavailable', "Cette offre n'accepte plus de candidatures");
        }

        // Les documents exigés par l'offre doivent tous être fournis.
        const provided = new Set(files.map((f) => f.label));
        const missing = posting.requiredDocuments.filter((label) => !provided.has(label));
        if (missing.length > 0) {
          problem(
            422,
            'recruitment.documents_missing',
            'Documents requis manquants',
            `Manque : ${missing.join(', ')}`,
          );
        }

        // Le slug a prouvé le tenant : on le pose pour la policy standard
        // et les triggers d'audit (même pattern que l'invitation).
        await tx.execute(sql`SELECT set_config('app.tenant_id', ${posting.tenantId}, true)`);

        const applicationId = uuidv7();
        await tx.insert(t.applications).values({
          id: applicationId,
          tenantId: posting.tenantId,
          jobPostingId: posting.id,
          givenName: input.givenName,
          familyName: input.familyName,
          email: input.email,
          phone: input.phone ?? null,
          message: input.message ?? null,
        });
        for (const f of files) {
          await tx.insert(t.applicationDocuments).values({
            id: uuidv7(),
            tenantId: posting.tenantId,
            applicationId,
            label: f.label,
            filename: f.filename,
            contentType: f.contentType,
            sizeBytes: f.data.length,
            data: f.data,
          });
        }
      });
    } catch (err) {
      if (pgCode(err) === '23505') {
        problem(
          409,
          'recruitment.already_applied',
          'Vous avez déjà postulé à cette offre',
          'Une seule candidature par offre et par adresse email.',
        );
      }
      throw err;
    }
  }

  private throttle(key: string): void {
    const now = Date.now();
    const recent = (this.attempts.get(key) ?? []).filter((ts) => now - ts < RATE_WINDOW_MS);
    if (recent.length >= RATE_MAX) {
      problem(429, 'recruitment.too_many_requests', 'Trop de tentatives — réessayez plus tard');
    }
    recent.push(now);
    this.attempts.set(key, recent);
    // Purge opportuniste pour borner la mémoire.
    if (this.attempts.size > 10_000) {
      for (const [k, v] of this.attempts) {
        if (v.every((ts) => now - ts >= RATE_WINDOW_MS)) this.attempts.delete(k);
      }
    }
  }
}
