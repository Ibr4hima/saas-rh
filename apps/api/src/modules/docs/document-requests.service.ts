import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, not, sql, type SQL } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type {
  AdvanceDocumentRequestInput,
  BatchAdvanceDocumentRequestInput,
  BatchAdvanceResult,
  CreateDocumentRequestInput,
  CreateDocumentRequestResult,
  DeposerFichierInput,
  DocumentRequestStatus,
  DocumentRequestView,
  FichierRemisView,
  PeriodeDuBulletin,
  RequestableDoc,
  SessionUser,
} from '@teranga/contracts';
import {
  peut,
  DOC_REQUEST_STATUS_LABELS,
  documentsEnCours,
  FICHIERS_REMIS_MAX,
  MAX_FICHIER_REMIS_BYTES,
  moisDeDuAu,
  moisEnLettres,
  OPEN_DOCUMENT_REQUEST_STATUSES,
  REQUESTABLE_DOC_LABELS,
} from '@teranga/contracts';
import { EncryptionService } from '../../common/encryption.service';
import { chiffrerPiece, contenuDeLaPiece, nomDeLaPiece } from '../../common/pieces-chiffrees';
import { problem, ProblemException } from '../../common/problem';
import * as t from '../../db/schema';
import { TenantDb, Tx } from '../../db/tenant-db';
import { NotificationsService } from '../notifications/notifications.service';
import { accord, bulletins, de, deBulletins, DOCUMENT } from '../notifications/phrases';
import { colonnesDuBulletin, periodeDu } from './bulletin';
import { agentDuCompte, detenteursDe, directionDuPersonnel } from '../acces/dch';
import {
  capaciteDesDocuments,
  reconcilierUneDemande,
  uneDemandeALaFois,
  voitToutLaFile,
  vueDuTraitement,
  exigerDeTraiter,
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

/** La signature du fichier : le type annoncé seul ne prouve rien. */
const SIGNATURES: Record<string, (b: Buffer) => boolean> = {
  'application/pdf': (b) => b.subarray(0, 5).toString() === '%PDF-',
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) =>
    b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
};

/** Le document déposé : PDF, JPEG ou PNG, 5 Mo au plus. Sa signature le prouve. */
function lireLeFichier(input: DeposerFichierInput): Buffer {
  const data = Buffer.from(input.contentBase64, 'base64');
  if (data.length === 0 || data.length > MAX_FICHIER_REMIS_BYTES) {
    problem(422, 'documents.too_large', 'Le fichier doit faire 5 Mo maximum');
  }
  if (!SIGNATURES[input.contentType]?.(data)) {
    problem(
      422,
      'documents.bad_format',
      'Le contenu ne correspond pas au format annoncé',
      'Déposez un PDF, un JPEG ou un PNG.',
    );
  }
  return data;
}

function labelList(types: string[]): string {
  return types.map((d) => REQUESTABLE_DOC_LABELS[d as RequestableDoc] ?? d).join(', ');
}

/**
 * Traite-t-on CE document pour la DCH ? La personne qui dirige la DCH, qui
 * détient l'habilitation de ce type, ou à qui la demande est confiée. Un
 * bulletin de salaire ne s'ouvre pas à qui traite seulement les attestations.
 * `detenteurs` garde les détenteurs déjà lus : une liste n'interroge la base
 * qu'une fois par habilitation.
 */
async function traiteCeDocument(
  tx: Tx,
  moi: string | null,
  directeur: string | null,
  row: { docTypes: string[]; confieeAEmployeeId: string | null },
  detenteurs = new Map<string, string[]>(),
): Promise<boolean> {
  if (!moi) return false;
  if (row.confieeAEmployeeId === moi || directeur === moi) return true;
  const capacite = capaciteDesDocuments(row.docTypes);
  let qui = detenteurs.get(capacite);
  if (!qui) {
    qui = await detenteursDe(tx, capacite);
    detenteurs.set(capacite, qui);
  }
  return qui.includes(moi);
}

@Injectable()
export class DocumentRequestsService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(EncryptionService) private readonly crypto: EncryptionService,
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

      await uneDemandeALaFois(tx, self.employeeId);
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

      if (input.bulletin) await this.exigerDesMoisPossibles(tx, self.employeeId, input.bulletin);

      for (const [i, docType] of docTypes.entries()) {
        await tx.insert(t.documentRequests).values({
          id: ids[i]!,
          tenantId: user.tenantId,
          employeeId: self.employeeId,
          docTypes: [docType],
          // Les mois vont au bulletin, et à lui seul.
          ...(docType === 'bulletin_salaire' ? colonnesDuBulletin(input.bulletin) : {}),
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
   * Les mois d'un bulletin existent : ni à venir, ni d'avant l'arrivée de
   * l'agent à l'APIX. Le mois en cours se demande (la paie tombe en fin de
   * mois) ; la DCH dit, en refusant, s'il n'est pas encore établi.
   */
  private async exigerDesMoisPossibles(
    tx: Tx,
    employeeId: string,
    p: PeriodeDuBulletin,
  ): Promise<void> {
    const {
      rows: [m],
    } = await tx.execute<{ courant: string; arrivee: string }>(sql`
      SELECT to_char(CURRENT_DATE, 'YYYY-MM') AS courant, to_char(hired_on, 'YYYY-MM') AS arrivee
        FROM employees WHERE id = ${employeeId}`);
    if (!m) return;
    const [premier, dernier] =
      p.type === 'mois' ? [p.mois, p.mois] : p.type === 'periode' ? [p.du, p.au] : [null, null];
    if (dernier && dernier > m.courant) {
      problem(
        422,
        'documents.bulletin_a_venir',
        'Ce bulletin n’existe pas encore',
        `Le bulletin ${de(moisEnLettres(dernier))} n’est pas encore établi.`,
      );
    }
    if (premier && premier < m.arrivee) {
      problem(
        422,
        'documents.bulletin_avant_arrivee',
        'Aucun bulletin avant votre arrivée',
        `Votre arrivée à l’APIX date ${de(moisEnLettres(m.arrivee))} : aucun bulletin avant ce mois.`,
      );
    }
    const depuisLArrivee = moisDeDuAu(m.arrivee, m.courant);
    if (p.type === 'derniers' && p.nombre > depuisLArrivee) {
      problem(
        422,
        'documents.bulletins_trop_nombreux',
        'Pas autant de bulletins',
        `Vous êtes à l’APIX depuis ${moisEnLettres(m.arrivee)} : ${depuisLArrivee} bulletins au plus.`,
      );
    }
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
      const conditions: SQL[] = [];

      if (selfOnly) {
        if (!soi) return [];
        conditions.push(eq(t.documentRequests.employeeId, soi.employeeId));
      } else if (!toute) {
        if (!moi) return [];
        conditions.push(
          // Confiée : tant qu'elle est ouverte seulement (cf. les congés).
          sql`(${t.documentRequests.employeeId} = ${moi}
               OR (${t.documentRequests.confieeAEmployeeId} = ${moi}
                   AND ${inArray(t.documentRequests.status, OPEN_STATUSES)}))`,
        );
      }
      if (!selfOnly && filters.employeeId) {
        conditions.push(eq(t.documentRequests.employeeId, filters.employeeId));
      }
      if (filters.status) conditions.push(eq(t.documentRequests.status, filters.status));

      const handler = t.users;
      // Les demandes ouvertes viennent toutes ; la limite ne porte que sur
      // l'historique, sinon les plus anciennes sortiraient de la file.
      const ouverte = inArray(t.documentRequests.status, OPEN_STATUSES);
      const lire = (filtre: SQL) =>
        tx
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
          .where(and(...conditions, filtre))
          .orderBy(desc(t.documentRequests.createdAt));
      const rows = [...(await lire(ouverte)), ...(await lire(not(ouverte)).limit(100))].sort(
        (a, b) => b.request.createdAt.getTime() - a.request.createdAt.getTime(),
      );

      const dch = await directionDuPersonnel(tx);
      const traiteLesDocuments = !selfOnly && (await this.traiteLesDocuments(tx, user));
      const fichiers = await this.fichiersDe(
        tx,
        rows.map((r) => r.request.id),
      );
      const detenteurs = new Map<string, string[]>();
      const vues: DocumentRequestView[] = [];
      for (const r of rows) {
        const ouverte = ['received', 'processing'].includes(r.request.status);
        const d = { employeeId: r.request.employeeId, confieeA: r.request.confieeAEmployeeId };
        const tr =
          !selfOnly && ouverte
            ? await vueDuTraitement(tx, capaciteDesDocuments(r.request.docTypes), d, moi, dch)
            : null;
        // Prête : on corrige le point de retrait, qui traite les documents
        // pour la DCH ; qui l'a traitée seulement s'il les traite encore.
        const peutAvancer =
          r.request.status === 'ready'
            ? traiteLesDocuments && r.request.employeeId !== moi
            : Boolean(tr?.peutTraiter);
        // Les documents remis : ouverte, qui la traite ; prête, qui traite
        // ce type de document pour la DCH (les mêmes règles que le serveur).
        const gereLesFichiers =
          r.request.status === 'ready'
            ? peutAvancer &&
              (await traiteCeDocument(
                tx,
                moi,
                dch?.directeurEmployeeId ?? null,
                r.request,
                detenteurs,
              ))
            : peutAvancer;
        vues.push({
          id: r.request.id,
          employeeId: r.request.employeeId,
          employeeName: `${r.givenName} ${r.familyName}`,
          employeeNumber: r.employeeNumber,
          employeeStatus: r.employeeStatus,
          docTypes: r.request.docTypes as RequestableDoc[],
          bulletin: periodeDu(
            r.request.payslipFrom,
            r.request.payslipTo,
            r.request.payslipLastMonths,
          ),
          note: r.request.note,
          status: r.request.status as DocumentRequestStatus,
          pickupContact: r.request.pickupContact,
          // L'agent les reçoit une fois la demande prête ; qui la traite, dès
          // leur dépôt, pour vérifier ce qui part.
          fichiers:
            ['ready', 'delivered'].includes(r.request.status) || peutAvancer
              ? (fichiers.get(r.request.id) ?? [])
              : [],
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
          canHandleFiles: gereLesFichiers,
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
      // Qui l'a traitée ne garde pas la main en quittant la DCH : la
      // correction revient à qui traite les documents aujourd'hui.
      const moi = await agentDuCompte(tx, user.userId);
      if (row.employeeId !== moi && (await this.traiteLesDocuments(tx, user))) return null;
      return 'Réservé à qui traite les documents pour la DCH';
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
      const deposes = (await this.compteDesFichiers(tx, [requestId])).get(requestId) ?? 0;
      if (input.status === 'ready') {
        // readyAt date la mise à disposition, pas la correction : une coquille
        // rectifiée ne doit pas rajeunir une demande qui attend depuis 3 semaines.
        if (!isCorrection) changes.readyAt = now;
        // Sans précision, on s'adresse à qui a traité la demande ; le document
        // déposé en ligne, lui, se télécharge sans passer au bureau.
        changes.pickupContact =
          input.pickupContact?.trim() ||
          (deposes > 0 ? null : `${user.givenName} ${user.familyName}`);
      }

      await tx.update(t.documentRequests).set(changes).where(eq(t.documentRequests.id, requestId));
      await reconcilierUneDemande(tx, 'documents', requestId);
      // Refusée, elle ne garde pas les documents préparés pour elle.
      if (input.status === 'rejected') await this.effacerLesFichiers(tx, [requestId]);

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
        bulletin: periodeDu(row.payslipFrom, row.payslipTo, row.payslipLastMonths),
        pickupContact: changes.pickupContact ?? null,
        fichiers: input.status === 'rejected' ? 0 : deposes,
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
      // Annulée, elle ne garde pas les documents préparés pour elle.
      await this.effacerLesFichiers(tx, [requestId]);

      if (row.status !== 'processing' || !row.handledByUserId) return;
      if (row.handledByUserId === user.userId) return;
      const doc = DOCUMENT[row.docTypes[0] as RequestableDoc] ?? DOCUMENT.autre;
      const periode = periodeDu(row.payslipFrom, row.payslipTo, row.payslipLastMonths);
      const quoi = periode ? deBulletins(bulletins(periode)) : de(doc.nom);
      await this.notifications.notifyUser(tx, user.tenantId, row.handledByUserId, {
        type: 'document_request_cancelled',
        sujet: 'dch.documents',
        title: `${soi.givenName} ${soi.familyName} annule sa demande ${quoi}`,
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
      const deposes = await this.compteDesFichiers(tx, input.ids);
      // Sans précision, on s'adresse à qui traite ; un document déposé en
      // ligne se télécharge sans passer au bureau.
      const retraitDe = (id: string) =>
        input.pickupContact?.trim() ||
        ((deposes.get(id) ?? 0) > 0 ? null : `${user.givenName} ${user.familyName}`);
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
          changes.pickupContact = retraitDe(id);
          // Une demande encore « reçue » traverse l'étape de traitement au
          // même instant : le circuit reste celui de l'ADR-0012, et la durée
          // de traitement garde une borne de départ. L'employé ne reçoit en
          // revanche QUE l'avis final — être prévenu deux fois dans la même
          // seconde ne l'informe de rien.
          if (row.status === 'received') changes.processingAt = now;
        }

        await tx.update(t.documentRequests).set(changes).where(eq(t.documentRequests.id, id));
        await reconcilierUneDemande(tx, 'documents', id);
        // Refusée, elle ne garde pas les documents préparés pour elle.
        if (input.status === 'rejected') await this.effacerLesFichiers(tx, [id]);
        advanced += 1;

        if (who?.userId) {
          await this.notifyEmployee(tx, user.tenantId, who.userId, {
            requestId: id,
            status: input.status,
            docTypes: row.docTypes,
            bulletin: periodeDu(row.payslipFrom, row.payslipTo, row.payslipLastMonths),
            pickupContact: changes.pickupContact ?? null,
            fichiers: input.status === 'rejected' ? 0 : (deposes.get(id) ?? 0),
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
   * « prête » (à retirer, ou déposée dans son espace), puis une éventuelle
   * correction.
   */
  private async notifyEmployee(
    tx: Tx,
    tenantId: string,
    userId: string,
    e: {
      requestId: string;
      status: DocumentRequestStatus;
      docTypes: string[];
      /** Les mois d'un bulletin de salaire : il se nomme avec eux. */
      bulletin: PeriodeDuBulletin | null;
      pickupContact: string | null;
      /** Les documents déposés en ligne, à télécharger depuis l'espace personnel. */
      fichiers: number;
      message: string | null;
      isCorrection: boolean;
    },
  ): Promise<void> {
    const seul = e.docTypes.length === 1 ? DOCUMENT[e.docTypes[0] as RequestableDoc] : undefined;
    const b = seul && e.bulletin ? bulletins(e.bulletin) : null;
    const votre = b
      ? b.pluriel
        ? `Vos ${b.texte} sont`
        : `Votre ${b.texte} est`
      : seul
        ? `Votre ${seul.nom} est`
        : 'Vos documents sont';
    const accorde = (mot: string) =>
      b ? (b.pluriel ? `${mot}s` : mot) : seul ? accord(mot, seul) : `${mot}s`;
    const demande = b ? deBulletins(b) : seul ? de(seul.nom) : 'de documents';
    const retrait = `à retirer auprès ${de(e.pickupContact ?? 'la DCH')}`;
    const titres: Partial<Record<DocumentRequestStatus, string>> = {
      processing: `${votre} en préparation`,
      ready:
        e.fichiers > 0
          ? `${votre} ${accorde('déposé')} dans votre espace${
              e.pickupContact ? `, l’original ${retrait}` : ''
            }`
          : e.isCorrection
            ? `${votre} ${retrait}`
            : `${votre} ${accorde('prêt')}, ${retrait}`,
      rejected: `Votre demande ${demande} est refusée`,
    };
    const title = titres[e.status];
    if (!title) return;
    const sujet = `document:${e.requestId}:suivi:`;
    await this.notifications.notifyUser(tx, tenantId, userId, {
      type: `document_request_${e.status}`,
      sujet: 'documents',
      title,
      link: '/moi/documents/suivi',
      dedupeKey: `${sujet}${e.status}${e.isCorrection ? `:${Date.now()}` : ''}`,
      remplace: sujet,
    });
  }

  /* La remise en ligne (ADR-0040). */

  /**
   * Déposer un document sur une demande : qui la traite, jamais la sienne.
   * Ouverte, le document attend qu'elle soit prête pour partir ; prête, il
   * part tout de suite, et un avis l'annonce.
   */
  async deposer(
    user: SessionUser,
    requestId: string,
    input: DeposerFichierInput,
  ): Promise<FichierRemisView> {
    const data = lireLeFichier(input);
    return this.db.withTenant(ctxOf(user), async (tx) => {
      const row = await this.demandeARemettre(tx, user, requestId);
      const deja = (await this.compteDesFichiers(tx, [requestId])).get(requestId) ?? 0;
      if (deja >= FICHIERS_REMIS_MAX) {
        problem(
          422,
          'documents.trop_de_fichiers',
          `Au plus ${FICHIERS_REMIS_MAX} fichiers par demande`,
          'Regroupez les pages dans un seul PDF.',
        );
      }
      const id = uuidv7();
      const filename = input.filename.trim();
      const [cree] = await tx
        .insert(t.documentRequestFiles)
        .values({
          id,
          tenantId: user.tenantId,
          requestId,
          contentType: input.contentType,
          sizeBytes: data.length,
          uploadedByUserId: user.userId,
          ...chiffrerPiece(
            this.crypto,
            'document_request_files',
            { tenantId: user.tenantId, id },
            { filename, data },
          ),
        })
        .returning({ createdAt: t.documentRequestFiles.createdAt });

      // Prête, la demande remet ce document tout de suite : l'agent le sait.
      if (row.status === 'ready') {
        const userId = await this.compteDe(tx, row.employeeId);
        if (userId) {
          await this.notifyEmployee(tx, user.tenantId, userId, {
            requestId,
            status: 'ready',
            docTypes: row.docTypes,
            bulletin: periodeDu(row.payslipFrom, row.payslipTo, row.payslipLastMonths),
            pickupContact: row.pickupContact,
            fichiers: deja + 1,
            message: null,
            isCorrection: true,
          });
        }
      }
      return {
        id,
        filename,
        contentType: input.contentType,
        sizeBytes: data.length,
        createdAt: cree!.createdAt.toISOString(),
      };
    });
  }

  /**
   * Retirer un document déposé : un mauvais fichier ne reste pas dans
   * l'espace de l'agent. Une demande prête sans point de retrait garde au
   * moins un document : on dépose d'abord le bon.
   */
  async retirerFichier(user: SessionUser, requestId: string, fichierId: string): Promise<void> {
    await this.db.withTenant(ctxOf(user), async (tx) => {
      const row = await this.demandeARemettre(tx, user, requestId);
      const [f] = await tx
        .select({ id: t.documentRequestFiles.id })
        .from(t.documentRequestFiles)
        .where(
          and(
            eq(t.documentRequestFiles.id, fichierId),
            eq(t.documentRequestFiles.requestId, requestId),
          ),
        );
      if (!f) problem(404, 'documents.fichier_introuvable', 'Fichier introuvable');
      const restants = (await this.compteDesFichiers(tx, [requestId])).get(requestId) ?? 0;
      if (row.status === 'ready' && !row.pickupContact && restants <= 1) {
        problem(
          422,
          'documents.dernier_fichier',
          'Le dernier document ne se retire pas',
          'Déposez d’abord le bon fichier, puis retirez celui-ci.',
        );
      }
      await tx.delete(t.documentRequestFiles).where(eq(t.documentRequestFiles.id, fichierId));
    });
  }

  /**
   * Un document remis, à télécharger : l'agent, une fois sa demande prête ;
   * qui traite ce document pour la DCH, à tout moment, pour vérifier.
   */
  async fichier(
    user: SessionUser,
    requestId: string,
    fichierId: string,
  ): Promise<{ filename: string; contentType: string; data: Buffer }> {
    return this.db.withTenant(ctxOf(user), async (tx) => {
      const [row] = await tx
        .select()
        .from(t.documentRequests)
        .where(eq(t.documentRequests.id, requestId))
        .limit(1);
      const [f] = row
        ? await tx
            .select()
            .from(t.documentRequestFiles)
            .where(
              and(
                eq(t.documentRequestFiles.id, fichierId),
                eq(t.documentRequestFiles.requestId, requestId),
              ),
            )
        : [];
      if (!row || !f) problem(404, 'documents.fichier_introuvable', 'Fichier introuvable');

      const soi = await this.selfEmployee(tx, user);
      if (soi?.employeeId === row.employeeId) {
        // Le sien : une fois remis seulement ; avant, l'agent n'en voit rien.
        if (!['ready', 'delivered'].includes(row.status)) {
          problem(404, 'documents.fichier_introuvable', 'Fichier introuvable');
        }
      } else if (
        !(await traiteCeDocument(
          tx,
          await agentDuCompte(tx, user.userId),
          (await directionDuPersonnel(tx))?.directeurEmployeeId ?? null,
          row,
        ))
      ) {
        problem(403, 'documents.forbidden_scope', 'Réservé à qui traite ce document pour la DCH');
      }
      const ligne = { tenantId: f.tenantId, id: f.id, cleVersion: f.cleVersion };
      return {
        filename: nomDeLaPiece(this.crypto, 'document_request_files', {
          ...ligne,
          filename: f.filename,
        }),
        contentType: f.contentType,
        data: contenuDeLaPiece(this.crypto, 'document_request_files', { ...ligne, data: f.data }),
      };
    });
  }

  /** La demande où l'on dépose ou retire un document : ouverte ou prête, et à soi de la traiter. */
  private async demandeARemettre(tx: Tx, user: SessionUser, requestId: string) {
    const [row] = await tx
      .select()
      .from(t.documentRequests)
      .where(eq(t.documentRequests.id, requestId))
      .for('update')
      .limit(1);
    if (!row) problem(404, 'documents.request_not_found', 'Demande introuvable');
    if (![...OPEN_STATUSES, 'ready'].includes(row.status)) {
      problem(422, 'documents.deja_traitee', 'Cette demande est close');
    }
    if (row.status === 'ready') {
      // Prête, ses documents restent à qui traite CE type de document : un
      // bulletin de salaire ne se touche pas au titre des attestations.
      const moi = await agentDuCompte(tx, user.userId);
      const directeur = (await directionDuPersonnel(tx))?.directeurEmployeeId ?? null;
      if (row.employeeId === moi || !(await traiteCeDocument(tx, moi, directeur, row))) {
        problem(403, 'documents.forbidden_scope', 'Réservé à qui traite ce document pour la DCH');
      }
    } else {
      const motif = await this.refus(tx, user, row);
      if (motif) problem(403, 'demandes.pas_traitant', motif);
    }
    return row;
  }

  /** Les documents remis des demandes, sans leur contenu, noms déchiffrés. */
  private async fichiersDe(tx: Tx, ids: string[]): Promise<Map<string, FichierRemisView[]>> {
    const parDemande = new Map<string, FichierRemisView[]>();
    if (ids.length === 0) return parDemande;
    const lignes = await tx
      .select({
        id: t.documentRequestFiles.id,
        tenantId: t.documentRequestFiles.tenantId,
        requestId: t.documentRequestFiles.requestId,
        filename: t.documentRequestFiles.filename,
        cleVersion: t.documentRequestFiles.cleVersion,
        contentType: t.documentRequestFiles.contentType,
        sizeBytes: t.documentRequestFiles.sizeBytes,
        createdAt: t.documentRequestFiles.createdAt,
      })
      .from(t.documentRequestFiles)
      .where(inArray(t.documentRequestFiles.requestId, ids))
      .orderBy(t.documentRequestFiles.createdAt);
    for (const l of lignes) {
      const liste = parDemande.get(l.requestId) ?? [];
      liste.push({
        id: l.id,
        filename: nomDeLaPiece(this.crypto, 'document_request_files', l),
        contentType: l.contentType,
        sizeBytes: l.sizeBytes,
        createdAt: l.createdAt.toISOString(),
      });
      parDemande.set(l.requestId, liste);
    }
    return parDemande;
  }

  private async compteDesFichiers(tx: Tx, ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const lignes = await tx
      .select({
        requestId: t.documentRequestFiles.requestId,
        n: sql<number>`count(*)::int`,
      })
      .from(t.documentRequestFiles)
      .where(inArray(t.documentRequestFiles.requestId, ids))
      .groupBy(t.documentRequestFiles.requestId);
    return new Map(lignes.map((l) => [l.requestId, l.n]));
  }

  private async effacerLesFichiers(tx: Tx, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await tx.delete(t.documentRequestFiles).where(inArray(t.documentRequestFiles.requestId, ids));
  }

  /** Le compte portail d'un dossier, s'il en a un. */
  private async compteDe(tx: Tx, employeeId: string): Promise<string | null> {
    const [person] = await tx
      .select({ userId: t.persons.userId })
      .from(t.employees)
      .innerJoin(t.persons, eq(t.persons.id, t.employees.personId))
      .where(eq(t.employees.id, employeeId))
      .limit(1);
    return person?.userId ?? null;
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
