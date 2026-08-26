import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type {
  AdvanceDocumentRequestInput,
  BatchAdvanceDocumentRequestInput,
  BatchAdvanceResult,
  CreateDocumentRequestInput,
  DocumentRequestStatus,
  DocumentRequestView,
  RequestableDoc,
  SessionUser,
} from '@teranga/contracts';
import { DOC_REQUEST_STATUS_LABELS, REQUESTABLE_DOC_LABELS } from '@teranga/contracts';
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
        // Clôture : mise à disposition, remise, ou refus. Le refus n'a pas de
        // colonne dédiée, mais rien ne suit un refus — `updatedAt` en date donc
        // exactement. Une correction du point de retrait, elle, laisse
        // `readyAt` en place : la durée de traitement ne rajeunit pas.
        handledAt:
          r.request.readyAt?.toISOString() ??
          r.request.deliveredAt?.toISOString() ??
          (r.request.status === 'rejected' ? r.request.updatedAt.toISOString() : null),
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

      await this.notifyEmployee(tx, user.tenantId, person.userId, {
        status: input.status,
        docTypes: row.docTypes,
        pickupContact: changes.pickupContact ?? null,
        message: input.message?.trim() || null,
        isCorrection,
      });
    });
  }

  /**
   * Traite plusieurs demandes d'un coup — le geste réel de la RH, qui sort le
   * parapheur du jour plutôt qu'une demande à la fois.
   *
   * Tout se joue dans UNE transaction : au premier problème, rien ne part.
   * Une demande qu'un collègue a fait avancer entre-temps n'annule pas les
   * autres — elle est écartée et nommée dans le résultat.
   */
  async batchAdvance(
    user: SessionUser,
    input: BatchAdvanceDocumentRequestInput,
  ): Promise<BatchAdvanceResult> {
    if (input.status === 'rejected' && !input.message?.trim()) {
      problem(
        422,
        'documents.reject_reason_required',
        'Un motif est requis pour refuser une demande',
      );
    }

    return this.db.withTenant(ctxOf(user), async (tx) => {
      // Verrouillage dans un ordre STABLE : deux lots qui se croisent sur les
      // mêmes demandes s'attendent au lieu de s'interbloquer.
      const rows = await tx
        .select()
        .from(t.documentRequests)
        .where(inArray(t.documentRequests.id, input.ids))
        .orderBy(t.documentRequests.id)
        .for('update');

      const found = new Map(rows.map((r) => [r.id, r]));
      const employees = rows.length
        ? await tx
            .select({
              employeeId: t.employees.id,
              userId: t.persons.userId,
              givenName: t.persons.givenName,
              familyName: t.persons.familyName,
            })
            .from(t.employees)
            .innerJoin(t.persons, eq(t.persons.id, t.employees.personId))
            .where(
              inArray(
                t.employees.id,
                rows.map((r) => r.employeeId),
              ),
            )
        : [];
      const byEmployee = new Map(employees.map((e) => [e.employeeId, e]));

      const skipped: BatchAdvanceResult['skipped'] = [];
      const now = new Date();
      const pickupContact = input.pickupContact?.trim() || `${user.givenName} ${user.familyName}`;
      const message = input.message?.trim() || null;
      let advanced = 0;

      for (const id of input.ids) {
        const row = found.get(id);
        const who = row ? byEmployee.get(row.employeeId) : undefined;
        const name = who ? `${who.givenName} ${who.familyName}` : '';
        if (!row) {
          skipped.push({ id, employeeName: name, reason: 'Demande introuvable' });
          continue;
        }
        if (!OPEN_STATUSES.includes(row.status)) {
          skipped.push({
            id,
            employeeName: name,
            reason: `Déjà « ${DOC_REQUEST_STATUS_LABELS[row.status as DocumentRequestStatus] ?? row.status} »`,
          });
          continue;
        }

        const changes: Partial<typeof t.documentRequests.$inferInsert> = {
          status: input.status,
          handledByUserId: user.userId,
          hrMessage: message,
          updatedAt: now,
        };
        if (input.status === 'ready') {
          changes.readyAt = now;
          changes.pickupContact = pickupContact;
          // Une demande encore « reçue » traverse l'étape de traitement au
          // même instant : le circuit reste celui de l'ADR-0012, et la durée
          // de traitement garde une borne de départ. L'employé ne reçoit en
          // revanche QUE l'avis final — être prévenu deux fois dans la même
          // seconde ne l'informe de rien.
          if (row.status === 'received') changes.processingAt = now;
        }

        await tx.update(t.documentRequests).set(changes).where(eq(t.documentRequests.id, id));
        advanced += 1;

        if (who?.userId) {
          await this.notifyEmployee(tx, user.tenantId, who.userId, {
            status: input.status,
            docTypes: row.docTypes,
            pickupContact,
            message,
            isCorrection: false,
          });
        }
      }

      return { advanced, skipped };
    });
  }

  /** Avis envoyé à l'employé, identique que la demande parte seule ou en lot. */
  private async notifyEmployee(
    tx: Tx,
    tenantId: string,
    userId: string,
    e: {
      status: DocumentRequestStatus;
      docTypes: string[];
      pickupContact: string | null;
      message: string | null;
      isCorrection: boolean;
    },
  ): Promise<void> {
    const docs = labelList(e.docTypes);
    const drafts: Record<string, { title: string; body: string }> = {
      processing: {
        title: 'Votre demande de documents est en cours de traitement',
        body: `La Direction du Capital Humain prépare : ${docs}.`,
      },
      ready: {
        title: e.isCorrection
          ? 'Changement : où retirer vos documents'
          : 'Vos documents sont disponibles',
        body:
          `${docs} — à retirer auprès de ${e.pickupContact}, Direction du Capital Humain. ` +
          `Merci de passer les récupérer${e.message ? ` (${e.message})` : ''}.`,
      },
      rejected: {
        title: 'Votre demande de documents n’a pas pu être traitée',
        body: `${docs} — motif : ${e.message}`,
      },
    };
    const draft = drafts[e.status];
    if (!draft) return;
    await this.notifications.notifyUser(tx, tenantId, userId, {
      type: `document_request_${e.status}`,
      title: draft.title,
      body: draft.body,
      link: '/moi/documents',
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
