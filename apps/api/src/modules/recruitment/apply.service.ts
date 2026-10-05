import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { ApplyInput, Langue, NiveauEtudes, PublicJobInfo } from '@teranga/contracts';
import { MAX_DOCUMENT_BYTES } from '@teranga/contracts';
import { EncryptionService } from '../../common/encryption.service';
import { problem } from '../../common/problem';
import * as t from '../../db/schema';
import { TenantDb } from '../../db/tenant-db';
import { chiffrerCandidature, chiffrerPiece } from './chiffrement';

function pgCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code ?? e?.cause?.code;
}

/**
 * Le nom d'un fichier venu du public, tel qu'il s'affichera à la RH : sans
 * caractère de contrôle ni d'inversion de sens (« cv‮fdp.exe »), sans
 * chemin, et terminé par « .pdf », ce qu'il est.
 */
function nomSur(nom: string): string {
  const propre = nom
    .replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/[\\/]/g, '-')
    .trim()
    .slice(0, 180);
  const base = propre.replace(/\.pdf$/i, '') || 'document';
  return `${base}.pdf`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

@Injectable()
export class ApplyService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(EncryptionService) private readonly enc: EncryptionService,
  ) {}

  /** Ce que voit le candidat qui suit le lien : l'offre publiée, rien d'autre. */
  async info(slug: string): Promise<PublicJobInfo> {
    return this.db.withJobSlug(slug, async (tx) => {
      const [row] = await tx
        .select({
          reference: t.jobPostings.reference,
          createdAt: t.jobPostings.createdAt,
          publishedAt: t.jobPostings.publishedAt,
          title: t.jobPostings.title,
          description: t.jobPostings.description,
          contractType: t.jobPostings.contractType,
          location: t.jobPostings.location,
          deadline: t.jobPostings.deadline,
          requiredDocuments: t.jobPostings.requiredDocuments,
          niveauEtudes: t.jobPostings.niveauEtudes,
          experienceMin: t.jobPostings.experienceMin,
          langues: t.jobPostings.langues,
          dureeMois: t.jobPostings.dureeMois,
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
        publishedAt: (row.publishedAt ?? row.createdAt).toISOString(),
        title: row.title,
        description: row.description,
        contractType: row.contractType,
        location: row.location,
        deadline: row.deadline,
        requiredDocuments: row.requiredDocuments,
        niveauEtudes: row.niveauEtudes as NiveauEtudes | null,
        experienceMin: row.experienceMin,
        langues: row.langues as Langue[],
        dureeMois: row.dureeMois,
      };
    });
  }

  /**
   * Déposer une candidature. L'anti-abus (dix par adresse et par offre, dix
   * minutes) et la taille passent avant la lecture du corps : cf. la porte
   * des corps (common/corps.ts).
   */
  async apply(slug: string, input: ApplyInput): Promise<void> {
    // Décodage et validation des fichiers AVANT la transaction.
    const files = input.documents.map((d) => {
      const data = Buffer.from(d.contentBase64, 'base64');
      if (data.length === 0 || data.length > MAX_DOCUMENT_BYTES) {
        problem(422, 'recruitment.document_too_large', 'Chaque document doit faire 5 Mo maximum');
      }
      // Le type ANNONCÉ ne prouve rien : n'importe qui peut poster un exécutable
      // étiqueté « application/pdf ». On lit la signature du fichier, comme au
      // dépôt des pièces du dossier employé.
      if (data.subarray(0, 5).toString() !== '%PDF-') {
        problem(
          422,
          'recruitment.document_not_pdf',
          'Chaque pièce doit être un PDF',
          `« ${d.filename} » n'en est pas un.`,
        );
      }
      return { label: d.label, filename: nomSur(d.filename), contentType: d.contentType, data };
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

        // Une pièce par document demandé, et rien d'autre.
        const intrus = files.filter(
          (f, i) =>
            !posting.requiredDocuments.includes(f.label) ||
            files.findIndex((g) => g.label === f.label) !== i,
        );
        if (intrus.length > 0) {
          problem(
            422,
            'recruitment.document_inattendu',
            'Une pièce ne correspond à aucun document demandé',
            `« ${intrus[0]!.label} » n’est pas demandé, ou l’est déjà.`,
          );
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

        // Chiffrée avant d'entrer en base : nom, adresse, téléphone,
        // message, et chaque pièce avec son nom (cf. chiffrement.ts).
        const applicationId = uuidv7();
        await tx.insert(t.applications).values({
          id: applicationId,
          tenantId: posting.tenantId,
          jobPostingId: posting.id,
          ...chiffrerCandidature(
            this.enc,
            { tenantId: posting.tenantId, id: applicationId, jobPostingId: posting.id },
            {
              givenName: input.givenName,
              familyName: input.familyName,
              email: input.email,
              phone: input.phone ?? null,
              message: input.message ?? null,
            },
          ),
        });
        for (const f of files) {
          const id = uuidv7();
          await tx.insert(t.applicationDocuments).values({
            id,
            tenantId: posting.tenantId,
            applicationId,
            label: f.label,
            contentType: f.contentType,
            sizeBytes: f.data.length,
            ...chiffrerPiece(this.enc, { tenantId: posting.tenantId, id }, f),
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
}
