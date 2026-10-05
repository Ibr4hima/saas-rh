import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type {
  AdvanceDocumentRequestInput,
  BatchAdvanceDocumentRequestInput,
  BatchAdvanceResult,
  CreateDocumentRequestInput,
  CreateDocumentRequestResult,
  DocumentRequestStatus,
  DocumentRequestView,
  RequestableDoc,
  SessionUser,
} from '@teranga/contracts';
import {
  peut,
  DOC_REQUEST_STATUS_LABELS,
  documentsEnCours,
  OPEN_DOCUMENT_REQUEST_STATUSES,
  REQUESTABLE_DOC_LABELS,
} from '@teranga/contracts';
import { problem, ProblemException } from '../../common/problem';
import * as t from '../../db/schema';
import { TenantDb, Tx } from '../../db/tenant-db';
import { NotificationsService } from '../notifications/notifications.service';
import { accord, de, DOCUMENT } from '../notifications/phrases';
import { agentDuCompte, directionDuPersonnel } from '../acces/dch';
import {
  capaciteDesDocuments,
  exigerDeTraiter,
  reconcilierUneDemande,
  vueDuTraitement,
  voitToutLaFile,
} from '../acces/demandes';

/** Le garde-fou et sa définition vivent au contrat : le portail l'annonce. */
const OPEN_STATUSES: string[] = OPEN_DOCUMENT_REQUEST_STATUSES;

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
  cancelled: [],
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

  /**
   * L'agent demande ses documents depuis son espace (jamais la DCH pour lui).
   *
   * Chaque document devient une demande à part : il va à qui traite CE type
   * de document — les attestations de travail à l'un, les bulletins de
   * salaire à l'autre. Un document déjà demandé, et encore en cours, ne se
   * redemande pas.
   */
  async create(
    user: SessionUser,
    input: CreateDocumentRequestInput,
  ): Promise<CreateDocumentRequestResult> {
    const docTypes = [...new Set(input.docTypes)];
    const ids = docTypes.map(() => uuidv7());
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

      const ouvertes = await tx
        .select({ status: t.documentRequests.status, docTypes: t.documentRequests.docTypes })
        .from(t.documentRequests)
        .where(
          and(
            eq(t.documentRequests.employeeId, self.employeeId),
            inArray(t.documentRequests.status, OPEN_STATUSES),
          ),
        );
      const enCours = documentsEnCours(ouvertes);
      const doublons = docTypes.filter((d) => enCours.has(d));
      if (doublons.length > 0) {
        problem(
          422,
          'documents.deja_en_cours',
          'Ce document est déjà demandé',
          // Le client n'affiche que le DÉTAIL : il doit se lire seul.
          `${labelList(doublons)} : votre demande est déjà en cours de traitement. Vous serez prévenu dès qu’il sera prêt.`,
        );
      }

      for (const [i, docType] of docTypes.entries()) {
        await tx.insert(t.documentRequests).values({
          id: ids[i]!,
          tenantId: user.tenantId,
          employeeId: self.employeeId,
          docTypes: [docType],
          note: input.note ?? null,
          requestedByUserId: user.userId,
        });
        // À qui traite ce document pour la DCH — et à eux seuls.
        await reconcilierUneDemande(tx, 'documents', ids[i]!);
      }
    });
    return { ids };
  }

  /**
   * La file de la DCH (tout le tenant) ou l'historique personnel.
   * `employeeId` restreint à un dossier — la fiche s'en sert.
   *
   * Voit toute la file qui la traite (le directeur, les membres habilités)
   * ou consulte les dossiers ; un membre à qui une demande est confiée voit
   * celle-là ; chacun voit les siennes.
   */
  async list(
    user: SessionUser,
    filters: { employeeId?: string; status?: DocumentRequestStatus; scope?: 'mine' },
  ): Promise<DocumentRequestView[]> {
    return this.db.withTenant(ctxOf(user), async (tx) => {
      // « scope=mine » est honoré QUELLES QUE SOIENT ses habilitations :
      // l'espace personnel d'un membre de la DCH doit rester personnel (il
      // est aussi agent).
      const moi = await agentDuCompte(tx, user.userId);
      const selfOnly = filters.scope === 'mine';
      const toute = !selfOnly && (await this.traiteLesDocuments(tx, user));
      // Son dossier, actif ou non : un agent qui n'est plus en activité
      // suit encore les documents qu'il a demandés, et les annule.
      const soi = await this.selfEmployee(tx, user);
      const conditions = [];

      if (selfOnly) {
        if (!soi) return [];
        conditions.push(eq(t.documentRequests.employeeId, soi.employeeId));
      } else if (!toute) {
        if (!moi) return [];
        conditions.push(
          sql`(${t.documentRequests.employeeId} = ${moi}
               OR ${t.documentRequests.confieeAEmployeeId} = ${moi})`,
        );
      }
      if (!selfOnly && filters.employeeId) {
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

      const dch = await directionDuPersonnel(tx);
      const traiteLesDocuments = !selfOnly && (await this.traiteLesDocuments(tx, user));
      const vues: DocumentRequestView[] = [];
      for (const r of rows) {
        const ouverte = ['received', 'processing'].includes(r.request.status);
        const d = { employeeId: r.request.employeeId, confieeA: r.request.confieeAEmployeeId };
        const tr =
          !selfOnly && ouverte
            ? await vueDuTraitement(tx, capaciteDesDocuments(r.request.docTypes), d, moi, dch)
            : null;
        // Prête : on corrige le point de retrait — qui l'a traitée, ou la DCH.
        const peutAvancer =
          r.request.status === 'ready'
            ? r.request.handledByUserId === user.userId ||
              (traiteLesDocuments && r.request.employeeId !== moi)
            : Boolean(tr?.peutTraiter);
        vues.push({
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
            (['rejected', 'cancelled'].includes(r.request.status)
              ? r.request.updatedAt.toISOString()
              : null),
          canAdvance: peutAvancer && (ALLOWED_TRANSITIONS[r.request.status]?.length ?? 0) > 0,
          canCancel: ouverte && r.request.employeeId === soi?.employeeId,
          traitement: tr?.vue ?? null,
        });
      }
      return vues;
    });
  }

  /** Traite les demandes de documents : le directeur du Capital Humain, les membres habilités. */
  private traiteLesDocuments(tx: Tx, user: SessionUser): Promise<boolean> {
    return voitToutLaFile(tx, user, 'documents');
  }

  /**
   * Peut-il faire avancer cette demande ? Ouverte, qui la traite pour la
   * DCH ; prête (correction du point de retrait), qui l'a traitée ou la DCH.
   * Rend le motif du refus, ou null.
   */
  private async refus(
    tx: Tx,
    user: SessionUser,
    row: typeof t.documentRequests.$inferSelect,
  ): Promise<string | null> {
    if (row.status === 'ready') {
      const moi = await agentDuCompte(tx, user.userId);
      if (row.handledByUserId === user.userId) return null;
      if (row.employeeId !== moi && (await this.traiteLesDocuments(tx, user))) return null;
      return 'Traitée par un autre membre de la DCH';
    }
    try {
      await exigerDeTraiter(tx, user, capaciteDesDocuments(row.docTypes), {
        employeeId: row.employeeId,
        confieeA: row.confieeAEmployeeId,
      });
      return null;
    } catch (err) {
      if (err instanceof ProblemException) return err.problem.title;
      throw err;
    }
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
      if (row.status === 'ready') {
        const motif = await this.refus(tx, user, row);
        if (motif) problem(403, 'demandes.pas_traitant', motif);
      } else if (OPEN_STATUSES.includes(row.status)) {
        await exigerDeTraiter(tx, user, capaciteDesDocuments(row.docTypes), {
          employeeId: row.employeeId,
          confieeA: row.confieeAEmployeeId,
        });
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
      if (input.status === 'processing') {
        changes.processingAt = now;
        // Qui la prend en charge la garde : les autres ne sont plus appelés.
        changes.confieeAEmployeeId =
          (await agentDuCompte(tx, user.userId)) ?? row.confieeAEmployeeId;
      }
      if (input.status === 'ready') {
        // readyAt date la mise à disposition, pas la correction : une coquille
        // rectifiée ne doit pas rajeunir une demande qui attend depuis 3 semaines.
        if (!isCorrection) changes.readyAt = now;
        // Sans précision, l'employé s'adresse à celui qui a traité la demande.
        changes.pickupContact =
          input.pickupContact?.trim() || `${user.givenName} ${user.familyName}`;
      }

      await tx.update(t.documentRequests).set(changes).where(eq(t.documentRequests.id, requestId));
      await reconcilierUneDemande(tx, 'documents', requestId);

      const [person] = await tx
        .select({ userId: t.persons.userId })
        .from(t.employees)
        .innerJoin(t.persons, eq(t.persons.id, t.employees.personId))
        .where(eq(t.employees.id, row.employeeId))
        .limit(1);
      if (!person?.userId) return; // dossier sans compte portail : rien à notifier

      await this.notifyEmployee(tx, user.tenantId, person.userId, {
        requestId,
        status: input.status,
        docTypes: row.docTypes,
        pickupContact: changes.pickupContact ?? null,
        message: input.message?.trim() || null,
        isCorrection,
      });
    });
  }

  /**
   * L'agent retire sa demande tant qu'elle n'est pas prête : elle sort de la
   * file. Déjà prise en charge, qui la préparait en est prévenu.
   */
  async cancel(user: SessionUser, requestId: string): Promise<void> {
    await this.db.withTenant(ctxOf(user), async (tx) => {
      const [row] = await tx
        .select()
        .from(t.documentRequests)
        .where(eq(t.documentRequests.id, requestId))
        .for('update')
        .limit(1);
      const soi = await this.selfEmployee(tx, user);
      if (!row || !soi || row.employeeId !== soi.employeeId) {
        problem(404, 'documents.request_not_found', 'Demande introuvable');
      }
      if (!OPEN_STATUSES.includes(row.status)) {
        problem(422, 'documents.deja_traitee', 'Cette demande est déjà traitée');
      }
      await tx
        .update(t.documentRequests)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(eq(t.documentRequests.id, requestId));
      await reconcilierUneDemande(tx, 'documents', requestId);

      if (row.status !== 'processing' || !row.handledByUserId) return;
      if (row.handledByUserId === user.userId) return;
      const doc = DOCUMENT[row.docTypes[0] as RequestableDoc] ?? DOCUMENT.autre;
      await this.notifications.notifyUser(tx, user.tenantId, row.handledByUserId, {
        type: 'document_request_cancelled',
        title: `${soi.givenName} ${soi.familyName} annule sa demande ${de(doc.nom)}`,
        link: '/documents',
        dedupeKey: `document:${requestId}:annulee`,
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

        const motif = await this.refus(tx, user, row);
        if (motif) {
          skipped.push({ id, employeeName: name, reason: motif });
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
        await reconcilierUneDemande(tx, 'documents', id);
        advanced += 1;

        if (who?.userId) {
          await this.notifyEmployee(tx, user.tenantId, who.userId, {
            requestId: id,
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

  /**
   * Avis envoyé à l'employé, identique que la demande parte seule ou en lot.
   * Chaque étape prend la place de la précédente : « en préparation », puis
   * « prête », puis un éventuel nouveau lieu de retrait.
   */
  private async notifyEmployee(
    tx: Tx,
    tenantId: string,
    userId: string,
    e: {
      requestId: string;
      status: DocumentRequestStatus;
      docTypes: string[];
      pickupContact: string | null;
      message: string | null;
      isCorrection: boolean;
    },
  ): Promise<void> {
    const seul = e.docTypes.length === 1 ? DOCUMENT[e.docTypes[0] as RequestableDoc] : undefined;
    const votre = seul ? `Votre ${seul.nom} est` : 'Vos documents sont';
    const pret = seul ? accord('prêt', seul) : 'prêts';
    const titres: Partial<Record<DocumentRequestStatus, string>> = {
      processing: `${votre} en préparation`,
      ready: e.isCorrection
        ? `${votre} à retirer auprès ${de(e.pickupContact ?? 'la DCH')}`
        : `${votre} ${pret}, à retirer auprès ${de(e.pickupContact ?? 'la DCH')}`,
      rejected: `Votre demande ${seul ? de(seul.nom) : 'de documents'} est refusée`,
    };
    const title = titres[e.status];
    if (!title) return;
    const sujet = `document:${e.requestId}:suivi:`;
    await this.notifications.notifyUser(tx, tenantId, userId, {
      type: `document_request_${e.status}`,
      title,
      link: '/moi/documents/suivi',
      dedupeKey: `${sujet}${e.status}${e.isCorrection ? `:${Date.now()}` : ''}`,
      remplace: sujet,
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
