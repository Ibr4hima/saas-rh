import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type {
  EmployeeDocumentView,
  ReviewEmployeeDocumentInput,
  SessionUser,
  UploadEmployeeDocumentInput,
} from '@teranga/contracts';
import { MAX_EMPLOYEE_DOCUMENT_BYTES } from '@teranga/contracts';
import { problem } from '../../common/problem';
import * as t from '../../db/schema';
import { TenantDb, Tx } from '../../db/tenant-db';
import { NotificationsService } from '../notifications/notifications.service';

const MANAGE_ROLES = new Set(['admin', 'hr']);

/** Signatures binaires des formats acceptés — le contentType seul ne prouve rien. */
const MAGIC: Array<{ type: string; check: (b: Buffer) => boolean }> = [
  { type: 'application/pdf', check: (b) => b.subarray(0, 5).toString() === '%PDF-' },
  { type: 'image/jpeg', check: (b) => b[0] === 0xff && b[1] === 0xd8 },
  {
    type: 'image/png',
    check: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
];

function ctxOf(user: SessionUser): { tenantId: string; userId: string } {
  return { tenantId: user.tenantId, userId: user.userId };
}

@Injectable()
export class EmployeeDocumentsService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  /**
   * Dépôt par l'employé OU par la RH. La contrepartie est notifiée pour
   * vérifier la conformité ; le document ne rejoint le dossier qu'une fois
   * validé. Un dossier sans compte portail n'a pas de contrepartie : le
   * dépôt RH y est validé d'office.
   */
  async upload(
    user: SessionUser,
    employeeId: string,
    input: UploadEmployeeDocumentInput,
  ): Promise<{ id: string; status: string }> {
    const data = Buffer.from(input.contentBase64, 'base64');
    if (data.length === 0 || data.length > MAX_EMPLOYEE_DOCUMENT_BYTES) {
      problem(422, 'documents.too_large', 'Le fichier doit faire 5 Mo maximum');
    }
    const magic = MAGIC.find((m) => m.type === input.contentType);
    if (!magic || !magic.check(data)) {
      problem(
        422,
        'documents.bad_format',
        'Le contenu ne correspond pas au format annoncé',
        'Formats acceptés : PDF, JPG, PNG.',
      );
    }

    const id = uuidv7();
    let status = 'pending';
    await this.db.withTenant(ctxOf(user), async (tx) => {
      const target = await this.requireEmployeeWithPerson(tx, employeeId);
      const isManage = MANAGE_ROLES.has(user.role);
      if (!isManage && target.personUserId !== user.userId) {
        problem(403, 'documents.self_only', 'Vous ne pouvez déposer que sur votre propre dossier');
      }
      // La titularité prime sur le rôle : un membre RH qui dépose sur SON
      // propre dossier est côté « employé » — la validation revient à une
      // AUTRE personne de la RH (jamais d'auto-validation).
      const side = isManage && target.personUserId !== user.userId ? 'hr' : 'employee';
      if (side === 'hr' && !target.personUserId) status = 'approved';

      const [pendingCount] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(t.employeeDocuments)
        .where(
          and(
            eq(t.employeeDocuments.employeeId, employeeId),
            eq(t.employeeDocuments.status, 'pending'),
          ),
        );
      if ((pendingCount?.n ?? 0) >= 10) {
        problem(
          422,
          'documents.too_many_pending',
          'Trop de documents en attente de validation sur ce dossier',
          'Faites valider ou retirez les dépôts en attente avant d’en ajouter.',
        );
      }

      await tx.insert(t.employeeDocuments).values({
        id,
        tenantId: user.tenantId,
        employeeId,
        category: input.category,
        label: input.label,
        filename: input.filename,
        contentType: input.contentType,
        sizeBytes: data.length,
        data,
        status,
        uploadedByUserId: user.userId,
        uploadedBySide: side,
      });

      const who = `${target.givenName} ${target.familyName}`;
      if (side === 'employee') {
        await this.notifications.notifyHr(
          tx,
          user.tenantId,
          {
            type: 'document_uploaded',
            title: `${who} a déposé « ${input.label} »`,
            body: 'À vérifier puis valider pour l’ajouter au dossier.',
            link: `/employees/${employeeId}`,
          },
          user.userId,
        );
      } else if (target.personUserId && status === 'pending') {
        await this.notifications.notifyUser(tx, user.tenantId, target.personUserId, {
          type: 'document_uploaded',
          title: `La RH a déposé « ${input.label} » sur votre dossier`,
          body: 'Vérifiez sa conformité puis validez-le.',
          link: '/moi/documents',
        });
      }
    });
    return { id, status };
  }

  /** Validation croisée : seule la partie qui n'a PAS déposé peut trancher. */
  async review(
    user: SessionUser,
    documentId: string,
    input: ReviewEmployeeDocumentInput,
  ): Promise<void> {
    await this.db.withTenant(ctxOf(user), async (tx) => {
      const doc = await this.requireDocument(tx, documentId);
      const target = await this.requireEmployeeWithPerson(tx, doc.employeeId);
      const isManage = MANAGE_ROLES.has(user.role);
      const isOwner = target.personUserId === user.userId;
      // Périmètre AVANT l'état : un tiers ne doit rien apprendre du document.
      if (!isManage && !isOwner) {
        problem(403, 'documents.forbidden_scope', 'Accès limité à votre propre dossier');
      }
      if (doc.status !== 'pending') {
        problem(422, 'documents.already_reviewed', 'Ce document a déjà été traité');
      }
      if (doc.uploadedByUserId === user.userId) {
        problem(403, 'documents.wrong_reviewer', 'La contrepartie doit valider — pas le déposant');
      }
      const allowed =
        (doc.uploadedBySide === 'employee' && isManage) || (doc.uploadedBySide === 'hr' && isOwner);
      if (!allowed) {
        problem(
          403,
          'documents.wrong_reviewer',
          doc.uploadedBySide === 'employee'
            ? 'Ce document attend la validation de la RH'
            : 'Ce document attend la validation du titulaire du dossier',
        );
      }

      await tx
        .update(t.employeeDocuments)
        .set({
          status: input.decision,
          reviewedByUserId: user.userId,
          reviewedAt: new Date(),
          reviewComment: input.comment ?? null,
        })
        .where(eq(t.employeeDocuments.id, documentId));

      const approved = input.decision === 'approved';
      await this.notifications.notifyUser(tx, user.tenantId, doc.uploadedByUserId, {
        type: 'document_reviewed',
        title: approved ? `« ${doc.label} » validé — ajouté au dossier` : `« ${doc.label} » rejeté`,
        body: approved
          ? undefined
          : (input.comment ?? 'Vérifiez le fichier puis déposez-le à nouveau.'),
        link: doc.uploadedBySide === 'hr' ? `/employees/${doc.employeeId}` : '/moi/documents',
      });
    });
  }

  async list(user: SessionUser, employeeId: string): Promise<EmployeeDocumentView[]> {
    return this.db.withTenant(ctxOf(user), async (tx) => {
      const target = await this.requireEmployeeWithPerson(tx, employeeId);
      const isManage = MANAGE_ROLES.has(user.role);
      const isOwner = target.personUserId === user.userId;
      if (!isManage && !isOwner) {
        problem(403, 'documents.forbidden_scope', 'Accès limité à votre propre dossier');
      }

      const uploader = t.users;
      const rows = await tx
        .select({
          doc: t.employeeDocuments,
          uploaderGivenName: uploader.givenName,
          uploaderFamilyName: uploader.familyName,
        })
        .from(t.employeeDocuments)
        .innerJoin(uploader, eq(uploader.id, t.employeeDocuments.uploadedByUserId))
        .where(eq(t.employeeDocuments.employeeId, employeeId))
        .orderBy(desc(t.employeeDocuments.createdAt));

      const reviewerIds = rows
        .map((r) => r.doc.reviewedByUserId)
        .filter((v): v is string => Boolean(v));
      const reviewers = reviewerIds.length
        ? await tx
            .select({
              id: t.users.id,
              givenName: t.users.givenName,
              familyName: t.users.familyName,
            })
            .from(t.users)
            .where(inArray(t.users.id, reviewerIds))
        : [];

      return rows.map(({ doc, uploaderGivenName, uploaderFamilyName }) => {
        const reviewer = reviewers.find((u) => u.id === doc.reviewedByUserId);
        const canReview =
          doc.status === 'pending' &&
          doc.uploadedByUserId !== user.userId &&
          ((doc.uploadedBySide === 'employee' && isManage) ||
            (doc.uploadedBySide === 'hr' && isOwner));
        const canDelete =
          isManage || (doc.uploadedByUserId === user.userId && doc.status !== 'approved');
        return {
          id: doc.id,
          employeeId: doc.employeeId,
          category: doc.category as EmployeeDocumentView['category'],
          label: doc.label,
          filename: doc.filename,
          contentType: doc.contentType,
          sizeBytes: doc.sizeBytes,
          status: doc.status as EmployeeDocumentView['status'],
          uploadedBySide: doc.uploadedBySide as EmployeeDocumentView['uploadedBySide'],
          uploadedByName: `${uploaderGivenName} ${uploaderFamilyName}`,
          reviewedByName: reviewer ? `${reviewer.givenName} ${reviewer.familyName}` : null,
          reviewComment: doc.reviewComment,
          createdAt: doc.createdAt.toISOString(),
          canReview,
          canDelete,
        };
      });
    });
  }

  /** Contenu binaire — RH ou titulaire uniquement (CNI, diplômes : sensibles). */
  async content(
    user: SessionUser,
    documentId: string,
  ): Promise<{ filename: string; contentType: string; data: Buffer }> {
    return this.db.withTenant(ctxOf(user), async (tx) => {
      const doc = await this.requireDocument(tx, documentId);
      const target = await this.requireEmployeeWithPerson(tx, doc.employeeId);
      if (!MANAGE_ROLES.has(user.role) && target.personUserId !== user.userId) {
        problem(403, 'documents.forbidden_scope', 'Accès limité à votre propre dossier');
      }
      return { filename: doc.filename, contentType: doc.contentType, data: doc.data };
    });
  }

  async remove(user: SessionUser, documentId: string): Promise<void> {
    await this.db.withTenant(ctxOf(user), async (tx) => {
      const doc = await this.requireDocument(tx, documentId);
      const isManage = MANAGE_ROLES.has(user.role);
      const isUploader = doc.uploadedByUserId === user.userId;
      if (!isManage && !(isUploader && doc.status !== 'approved')) {
        problem(
          403,
          'documents.delete_forbidden',
          'Seule la RH peut retirer un document validé du dossier',
        );
      }
      await tx.delete(t.employeeDocuments).where(eq(t.employeeDocuments.id, documentId));
    });
  }

  private async requireDocument(tx: Tx, id: string) {
    const [doc] = await tx
      .select()
      .from(t.employeeDocuments)
      .where(eq(t.employeeDocuments.id, id))
      .limit(1);
    if (!doc) {
      problem(404, 'documents.not_found', 'Document introuvable');
    }
    return doc;
  }

  private async requireEmployeeWithPerson(tx: Tx, employeeId: string) {
    const [row] = await tx
      .select({
        employeeId: t.employees.id,
        personUserId: t.persons.userId,
        givenName: t.persons.givenName,
        familyName: t.persons.familyName,
      })
      .from(t.employees)
      .innerJoin(t.persons, eq(t.persons.id, t.employees.personId))
      .where(eq(t.employees.id, employeeId))
      .limit(1);
    if (!row) {
      problem(404, 'people.employee_not_found', 'Employé introuvable');
    }
    return row;
  }
}
