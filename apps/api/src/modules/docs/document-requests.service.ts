import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type {
  AdvanceDocumentRequestInput,
  CreateDocumentRequestInput,
  DocumentRequestStatus,
  DocumentRequestView,
  RequestableDoc,
  SessionUser,
} from '@teranga/contracts';
import { REQUESTABLE_DOC_LABELS } from '@teranga/contracts';
import { problem } from '../../common/problem';
import * as t from '../../db/schema';
import { TenantDb, Tx } from '../../db/tenant-db';
import { NotificationsService } from '../notifications/notifications.service';

const MANAGE_ROLES = new Set(['admin', 'hr']);
/**
 * Une demande non close bloque les nouvelles : évite les doublons de file.
 * « prête » n'en fait PAS partie — c'est l'état final depuis que la remise
 * n'est plus enregistrée : la compter bloquerait l'employé à vie.
 */
const OPEN_STATUSES = ['received', 'processing'];
const MAX_OPEN_REQUESTS = 3;

/**
 * Transitions autorisées : le circuit ne peut pas remonter le temps.
 * `ready` est terminal en PROGRESSION — la RH annonce le point de retrait mais
 * n'a aucun moyen de savoir quand l'employé est passé le récupérer
 * (ADR-0012 rév. 2). Elle garde en revanche le droit de se corriger : `ready`
 * vers `ready` réécrit le point de retrait et prévient à nouveau l'employé,
 * sinon une coquille sur le nom l'enverrait au mauvais bureau sans recours.
 * `delivered` reste listé pour les demandes closes avant cette révision.
 */
const ALLOWED_TRANSITIONS: Record<string, DocumentRequestStatus[]> = {
  received: ['processing', 'rejected'],
  processing: ['ready', 'rejected'],
  ready: ['ready'],
  delivered: [],
  rejected: [],
};

function ctxOf(user: SessionUser): { tenantId: string; userId: string } {
  return { tenantId: user.tenantId, userId: user.userId };
}

function labelList(types: string[]): string {
  return types.map((d) => REQUESTABLE_DOC_LABELS[d as RequestableDoc] ?? d).join(', ');
}

@Injectable()
export class DocumentRequestsService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  /** L'employé demande ses documents depuis son espace (jamais la RH pour lui). */
  async create(user: SessionUser, input: CreateDocumentRequestInput): Promise<{ id: string }> {
    const id = uuidv7();
    await this.db.withTenant(ctxOf(user), async (tx) => {
      const self = await this.selfEmployee(tx, user);
      if (!self) {
        problem(
          404,
          'documents.no_employee_record',
          'Aucun dossier employé relié à ce compte',
          'Seuls les employés peuvent demander leurs documents.',
        );
      }

      const [open] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(t.documentRequests)
        .where(
          and(
            eq(t.documentRequests.employeeId, self.employeeId),
            inArray(t.documentRequests.status, OPEN_STATUSES),
          ),
        );
      if ((open?.n ?? 0) >= MAX_OPEN_REQUESTS) {
        problem(
          422,
          'documents.too_many_open_requests',
          'Vous avez déjà plusieurs demandes en cours',
          'Attendez leur traitement avant d’en formuler une nouvelle.',
        );
      }

      await tx.insert(t.documentRequests).values({
        id,
        tenantId: user.tenantId,
        employeeId: self.employeeId,
        docTypes: input.docTypes,
        note: input.note ?? null,
        requestedByUserId: user.userId,
      });

      await this.notifications.notifyHr(tx, user.tenantId, {
        type: 'document_request',
        title: `${self.givenName} ${self.familyName} demande des documents`,
        body: labelList(input.docTypes),
        link: '/documents',
      });
    });
    return { id };
  }

  /**
   * File d'attente RH (tout le tenant) ou historique personnel.
   * `employeeId` restreint à un dossier — la RH s'en sert sur la fiche.
   */
  async list(
    user: SessionUser,
    filters: { employeeId?: string; status?: DocumentRequestStatus; scope?: 'mine' },
  ): Promise<DocumentRequestView[]> {
    return this.db.withTenant(ctxOf(user), async (tx) => {
      // « scope=mine » est honoré QUEL QUE SOIT le rôle : l'espace personnel
      // d'un membre RH doit rester personnel (il est aussi salarié). Le
      // périmètre ne se déduit jamais du seul rôle de l'appelant.
      const selfOnly = filters.scope === 'mine' || !MANAGE_ROLES.has(user.role);
      const isManage = MANAGE_ROLES.has(user.role) && !selfOnly;
      const conditions = [];

      if (selfOnly) {
        const self = await this.selfEmployee(tx, user);
        if (!self) return [];
        conditions.push(eq(t.documentRequests.employeeId, self.employeeId));
      } else if (filters.employeeId) {
        conditions.push(eq(t.documentRequests.employeeId, filters.employeeId));
      }
      if (filters.status) conditions.push(eq(t.documentRequests.status, filters.status));

      const handler = t.users;
      const rows = await tx
        .select({
          request: t.documentRequests,
          givenName: t.persons.givenName,
          familyName: t.persons.familyName,
          employeeNumber: t.employees.employeeNumber,
          employeeStatus: t.employees.status,
          handlerGivenName: handler.givenName,
          handlerFamilyName: handler.familyName,
        })
        .from(t.documentRequests)
        .innerJoin(t.employees, eq(t.employees.id, t.documentRequests.employeeId))
        .innerJoin(t.persons, eq(t.persons.id, t.employees.personId))
        .leftJoin(handler, eq(handler.id, t.documentRequests.handledByUserId))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(t.documentRequests.createdAt))
        .limit(100);

      return rows.map((r) => ({
        id: r.request.id,
        employeeId: r.request.employeeId,
        employeeName: `${r.givenName} ${r.familyName}`,
        employeeNumber: r.employeeNumber,
        employeeStatus: r.employeeStatus,
        docTypes: r.request.docTypes as RequestableDoc[],
        note: r.request.note,
        status: r.request.status as DocumentRequestStatus,
        pickupContact: r.request.pickupContact,
        hrMessage: r.request.hrMessage,
        handledByName: r.handlerGivenName ? `${r.handlerGivenName} ${r.handlerFamilyName}` : null,
        createdAt: r.request.createdAt.toISOString(),
        processingAt: r.request.processingAt?.toISOString() ?? null,
        readyAt: r.request.readyAt?.toISOString() ?? null,
        deliveredAt: r.request.deliveredAt?.toISOString() ?? null,
        canAdvance: isManage && (ALLOWED_TRANSITIONS[r.request.status]?.length ?? 0) > 0,
      }));
    });
  }

  /** Fait avancer la demande dans le circuit et notifie l'employé à chaque étape. */
  async advance(
    user: SessionUser,
    requestId: string,
    input: AdvanceDocumentRequestInput,
  ): Promise<void> {
    if (input.status === 'rejected' && !input.message?.trim()) {
      problem(
        422,
        'documents.reject_reason_required',
        'Un motif est requis pour refuser une demande',
      );
    }

    await this.db.withTenant(ctxOf(user), async (tx) => {
      const [row] = await tx
        .select()
        .from(t.documentRequests)
        .where(eq(t.documentRequests.id, requestId))
        .for('update')
        .limit(1);
      if (!row) {
        problem(404, 'documents.request_not_found', 'Demande introuvable');
      }
      const allowed = ALLOWED_TRANSITIONS[row.status] ?? [];
      if (!allowed.includes(input.status)) {
        problem(
          422,
          'documents.invalid_transition',
          'Cette étape ne suit pas l’étape actuelle de la demande',
          `État actuel : ${row.status}.`,
        );
      }

      // Même statut = la RH corrige le point de retrait d'une demande déjà prête.
      const isCorrection = row.status === input.status;

      const now = new Date();
      const changes: Partial<typeof t.documentRequests.$inferInsert> = {
        status: input.status,
        handledByUserId: user.userId,
        updatedAt: now,
      };
      if (input.status === 'ready') {
        // Le panneau « prête » est affiche a la RH pre-rempli avec la valeur
        // courante : ce qu'elle y laisse fait donc FOI, y compris un champ vidé.
        // Sans cela, corriger le point de retrait conserverait une précision
        // devenue fausse (« bureau 204 » etait celui du contact precedent).
        changes.hrMessage = input.message?.trim() || null;
      } else if (input.message?.trim()) {
        changes.hrMessage = input.message.trim();
      }
      if (input.status === 'processing') changes.processingAt = now;
      if (input.status === 'ready') {
        // readyAt date la mise à disposition, pas la correction : une coquille
        // rectifiée ne doit pas rajeunir une demande qui attend depuis 3 semaines.
        if (!isCorrection) changes.readyAt = now;
        // Sans précision, l'employé s'adresse à celui qui a traité la demande.
        changes.pickupContact =
          input.pickupContact?.trim() || `${user.givenName} ${user.familyName}`;
      }

      await tx.update(t.documentRequests).set(changes).where(eq(t.documentRequests.id, requestId));

      const [person] = await tx
        .select({ userId: t.persons.userId })
        .from(t.employees)
        .innerJoin(t.persons, eq(t.persons.id, t.employees.personId))
        .where(eq(t.employees.id, row.employeeId))
        .limit(1);
      if (!person?.userId) return; // dossier sans compte portail : rien à notifier

      const docs = labelList(row.docTypes);
      const drafts: Record<string, { title: string; body: string }> = {
        processing: {
          title: 'Votre demande de documents est en cours de traitement',
          body: `La Direction du Capital Humain prépare : ${docs}.`,
        },
        ready: {
          title: isCorrection
            ? 'Changement : où retirer vos documents'
            : 'Vos documents sont disponibles',
          body:
            `${docs} — à retirer auprès de ${changes.pickupContact}, Direction du Capital Humain. ` +
            `Merci de passer les récupérer${input.message?.trim() ? ` (${input.message.trim()})` : ''}.`,
        },
        rejected: {
          title: 'Votre demande de documents n’a pas pu être traitée',
          body: `${docs} — motif : ${input.message?.trim()}`,
        },
      };
      const draft = drafts[input.status];
      if (draft) {
        await this.notifications.notifyUser(tx, user.tenantId, person.userId, {
          type: `document_request_${input.status}`,
          title: draft.title,
          body: draft.body,
          link: '/moi/documents',
        });
      }
    });
  }

  private async selfEmployee(tx: Tx, user: SessionUser) {
    const [row] = await tx
      .select({
        employeeId: t.employees.id,
        givenName: t.persons.givenName,
        familyName: t.persons.familyName,
      })
      .from(t.employees)
      .innerJoin(t.persons, eq(t.persons.id, t.employees.personId))
      .where(eq(t.persons.userId, user.userId))
      .limit(1);
    return row ?? null;
  }
}
