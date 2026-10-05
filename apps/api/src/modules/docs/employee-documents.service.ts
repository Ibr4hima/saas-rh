import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, getTableColumns, inArray, ne, sql, type SQL } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type {
  ControleDuTitre,
  DocumentCategory,
  EmployeeDocumentView,
  PieceATraiterView,
  ReplaceEmployeeDocumentInput,
  ReviewEmployeeDocumentInput,
  TitreSaisi,
  SessionUser,
  UploadEmployeeDocumentInput,
} from '@teranga/contracts';
import {
  aUneExpiration,
  capaciteDeLaPiece,
  DOCUMENT_CATEGORY_LABELS,
  estUnique,
  MAX_EMPLOYEE_DOCUMENT_BYTES,
  peut,
  titreDeLaFiche,
} from '@teranga/contracts';
import { EncryptionService } from '../../common/encryption.service';
import { problem } from '../../common/problem';
import * as t from '../../db/schema';
import { TenantDb, Tx } from '../../db/tenant-db';
import { NotificationsService } from '../notifications/notifications.service';
import { accord, PIECE } from '../notifications/phrases';
import { agentDuCompte, directionDuPersonnel, type DirectionDuPersonnel } from '../acces/dch';
import {
  reconcilierUneDemande,
  uneDemandeALaFois,
  voitToutLaFile,
  vueDuTraitement,
  exigerDeTraiter,
} from '../acces/demandes';

/** La signature d'un PDF — le contentType seul ne prouve rien. */
const MAGIC: Array<{ type: string; check: (b: Buffer) => boolean }> = [
  { type: 'application/pdf', check: (b) => b.subarray(0, 5).toString() === '%PDF-' },
];

function ctxOf(user: SessionUser): { tenantId: string; userId: string } {
  return { tenantId: user.tenantId, userId: user.userId };
}

/** Le fichier envoyé : un PDF, de 5 Mo au plus — sa signature le prouve. */
function lireLeFichier(input: { contentType: string; contentBase64: string }): Buffer {
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
      'Seul le PDF est accepté.',
    );
  }
  return data;
}

/** Le titre d'identité que porte la fiche : son type, son numéro, ses dates. */
interface TitreDeLaFiche {
  type: 'cni' | 'passeport' | null;
  numero: string | null;
  delivreLe: string | null;
  expireLe: string | null;
}

/**
 * Comment vérifier un titre d'identité déposé. Le titre de la fiche — même
 * type, ou fiche sans type — se vérifie contre elle : on compare le
 * document à ce qu'elle porte (`conformite`) ; s'il s'agit d'une nouvelle
 * pièce, ou que la fiche n'en dit rien, on en saisit les informations, qui
 * la mettent à jour (`saisie`). L'autre titre — une CNI quand la fiche porte
 * un passeport — peut en devenir la pièce, si qui vérifie le choisit
 * (`autre`). Les autres documents : null.
 */
function modeDeControle(
  doc: { category: string; renouvellement: boolean },
  fiche: TitreDeLaFiche,
): ControleDuTitre['mode'] | null {
  if (!aUneExpiration(doc.category as DocumentCategory)) return null;
  if (fiche.type !== null && fiche.type !== doc.category) return 'autre';
  return doc.renouvellement || fiche.type === null || !fiche.numero ? 'saisie' : 'conformite';
}

/**
 * Une pièce d'identité n'est reçue que si elle vaut encore demain : une date
 * d'expiration passée, ou celle du jour, la refuse. La même règle au dépôt,
 * à la vérification et sur la fiche.
 */
async function refuserSiExpiree(tx: Tx, expireLe: string): Promise<void> {
  const { rows } = await tx.execute<{ ecart: number }>(
    sql`SELECT (${expireLe}::date - CURRENT_DATE)::int AS ecart`,
  );
  const ecart = rows[0]?.ecart ?? 1;
  if (ecart > 0) return;
  problem(
    422,
    'documents.expire',
    ecart === 0 ? 'Cette pièce expire aujourd’hui' : 'Cette pièce a expiré',
  );
}

/**
 * La date d'expiration d'un titre d'identité : exigée pour la CNI et le
 * passeport, et encore valable demain. Les autres types n'en ont pas.
 */
async function dateDExpiration(
  tx: Tx,
  category: DocumentCategory,
  expiresOn: string | undefined,
): Promise<string | null> {
  if (!aUneExpiration(category)) return null;
  if (!expiresOn) {
    problem(422, 'documents.expiration_requise', 'Indiquez la date d’expiration du document');
  }
  await refuserSiExpiree(tx, expiresOn);
  return expiresOn;
}

/** Les colonnes d'une pièce, fichier exclu : une liste n'a pas à le charger. */
const { data: _contenu, ...SANS_CONTENU } = getTableColumns(t.employeeDocuments);
type PieceSansContenu = Omit<typeof t.employeeDocuments.$inferSelect, 'data'>;

@Injectable()
export class EmployeeDocumentsService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(EncryptionService) private readonly crypto: EncryptionService,
  ) {}

  /** Le titre d'identité de la fiche d'un agent — le numéro déchiffré. */
  private async titreDeLaFiche(tx: Tx, employeeId: string): Promise<TitreDeLaFiche> {
    const [p] = await tx
      .select({
        type: t.persons.idDocumentType,
        numero: t.persons.nationalIdEncrypted,
        delivreLe: t.persons.idDocumentIssuedOn,
        expireLe: t.persons.idDocumentExpiresOn,
      })
      .from(t.employees)
      .innerJoin(t.persons, eq(t.persons.id, t.employees.personId))
      .where(eq(t.employees.id, employeeId))
      .limit(1);
    return {
      type: titreDeLaFiche(p?.type ?? null),
      numero: p?.numero ? this.crypto.decrypt(p.numero) : null,
      delivreLe: p?.delivreLe ?? null,
      expireLe: p?.expireLe ?? null,
    };
  }

  /**
   * L'agent dépose SES pièces, depuis son espace — personne ne dépose sur le
   * dossier d'un autre. La pièce part à la DCH : son directeur la vérifie,
   * ou le membre à qui il a confié les pièces. Elle ne rejoint le dossier
   * qu'une fois validée — jamais d'office, jamais par qui l'a déposée.
   */
  async upload(
    user: SessionUser,
    employeeId: string,
    input: UploadEmployeeDocumentInput,
  ): Promise<{ id: string; status: string }> {
    const data = lireLeFichier(input);
    const id = uuidv7();
    const status = 'pending';
    await this.db.withTenant(ctxOf(user), async (tx) => {
      const target = await this.requireEmployeeWithPerson(tx, employeeId);
      if (target.personUserId !== user.userId) {
        problem(
          403,
          'documents.self_only',
          'Chaque agent dépose ses pièces depuis son espace',
          'La DCH les vérifie ensuite : elle ne dépose pas à la place de l’agent.',
        );
      }

      await uneDemandeALaFois(tx, employeeId);
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
      // Un seul exemplaire au dossier : un seul aussi en vérification — on
      // change le fichier de celui-là plutôt que d'en déposer un second.
      if (estUnique(input.category)) {
        const [enCours] = await tx
          .select({ id: t.employeeDocuments.id })
          .from(t.employeeDocuments)
          .where(
            and(
              eq(t.employeeDocuments.employeeId, employeeId),
              eq(t.employeeDocuments.category, input.category),
              eq(t.employeeDocuments.status, 'pending'),
            ),
          )
          .limit(1);
        if (enCours) {
          problem(
            422,
            'documents.deja_en_verification',
            `${DOCUMENT_CATEGORY_LABELS[input.category]} : un dépôt attend déjà la vérification`,
            'Remplacez-le, ou annulez-le, avant d’en déposer un autre.',
          );
        }
      }
      const expiresOn = await dateDExpiration(tx, input.category, input.expiresOn);

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
        uploadedBySide: 'employee',
        expiresOn,
        renouvellement: aUneExpiration(input.category) && Boolean(input.renouvellement),
      });

      // À qui vérifie les pièces pour la DCH — et à eux seuls.
      await reconcilierUneDemande(tx, 'pieces', id);
    });
    return { id, status };
  }

  /**
   * Changer le fichier d'un dépôt encore en vérification — le titulaire seul.
   * Le type reste ; le dépôt reprend sa place dans la file, à la date du
   * nouveau fichier. Vérifié ou rejeté, il ne se change plus.
   */
  async replace(
    user: SessionUser,
    documentId: string,
    input: ReplaceEmployeeDocumentInput,
  ): Promise<void> {
    const data = lireLeFichier(input);
    await this.db.withTenant(ctxOf(user), async (tx) => {
      const doc = await this.requireDocument(tx, documentId);
      const target = await this.requireEmployeeWithPerson(tx, doc.employeeId);
      if (target.personUserId !== user.userId || doc.uploadedByUserId !== user.userId) {
        problem(403, 'documents.forbidden_scope', 'Accès limité à votre propre dossier');
      }
      if (doc.status !== 'pending') {
        problem(
          422,
          'documents.already_reviewed',
          'Ce document a déjà été traité',
          'Il ne se remplace plus : déposez-en un nouveau.',
        );
      }
      const expiresOn = await dateDExpiration(
        tx,
        doc.category as DocumentCategory,
        input.expiresOn,
      );
      await tx
        .update(t.employeeDocuments)
        .set({
          label: input.label,
          filename: input.filename,
          contentType: input.contentType,
          sizeBytes: data.length,
          data,
          expiresOn,
          ...(input.renouvellement !== undefined && aUneExpiration(doc.category as DocumentCategory)
            ? { renouvellement: input.renouvellement }
            : {}),
          createdAt: new Date(),
        })
        .where(eq(t.employeeDocuments.id, documentId));
      await reconcilierUneDemande(tx, 'pieces', documentId);
    });
  }

  /**
   * La vérification : qui traite les pièces pour la DCH — jamais le titulaire
   * du dossier, jamais qui a déposé la pièce.
   */
  async review(
    user: SessionUser,
    documentId: string,
    input: ReviewEmployeeDocumentInput,
  ): Promise<void> {
    await this.db.withTenant(ctxOf(user), async (tx) => {
      const doc = await this.requireDocument(tx, documentId);
      const target = await this.requireEmployeeWithPerson(tx, doc.employeeId);
      const isOwner = target.personUserId === user.userId;
      // Périmètre AVANT l'état : un tiers ne doit rien apprendre du document.
      if (!isOwner && !(await this.voit(tx, user, doc))) {
        problem(403, 'documents.forbidden_scope', 'Accès limité à votre propre dossier');
      }
      if (doc.status !== 'pending') {
        problem(422, 'documents.already_reviewed', 'Ce document a déjà été traité');
      }
      if (isOwner || doc.uploadedByUserId === user.userId) {
        problem(
          403,
          'documents.wrong_reviewer',
          'Personne ne vérifie ses propres pièces',
          'Elles vont aux membres de la DCH qui vérifient les pièces, ou à qui dirige la DCH.',
        );
      }
      await exigerDeTraiter(tx, user, capaciteDeLaPiece(doc.category as DocumentCategory), {
        employeeId: doc.employeeId,
        confieeA: doc.confieeAEmployeeId,
      });
      // L'agent doit savoir quoi corriger avant de déposer à nouveau.
      if (input.decision === 'rejected' && !input.comment?.trim()) {
        problem(422, 'documents.motif_requis', 'Indiquez le motif du rejet');
      }
      if (input.decision === 'approved') await this.reporterSurLaFiche(tx, doc, input.titre);

      await tx
        .update(t.employeeDocuments)
        .set({
          status: input.decision,
          reviewedByUserId: user.userId,
          reviewedAt: new Date(),
          reviewComment: input.comment ?? null,
        })
        .where(eq(t.employeeDocuments.id, documentId));
      await reconcilierUneDemande(tx, 'pieces', documentId);

      const approved = input.decision === 'approved';
      // CNI, passeport, CV : un seul au dossier — le nouveau prend la place
      // de l'ancien, sans autre annonce.
      if (approved && estUnique(doc.category as DocumentCategory)) {
        await tx
          .delete(t.employeeDocuments)
          .where(
            and(
              eq(t.employeeDocuments.employeeId, doc.employeeId),
              eq(t.employeeDocuments.category, doc.category),
              eq(t.employeeDocuments.status, 'approved'),
              ne(t.employeeDocuments.id, documentId),
            ),
          );
      }
      // Le titulaire l'apprend — c'est son dossier, quel qu'ait été le
      // déposant d'une pièce ancienne.
      const destinataire = target.personUserId ?? doc.uploadedByUserId;
      const piece = PIECE[doc.category as DocumentCategory] ?? PIECE.autre;
      const nom = doc.category === 'autre' ? `document « ${doc.label} »` : piece.nom;
      await this.notifications.notifyUser(tx, user.tenantId, destinataire, {
        type: 'document_reviewed',
        title: approved
          ? `Votre ${nom} est ${accord('ajouté', piece)} à votre dossier`
          : `Votre ${nom} est ${accord('refusé', piece)} : ${input.comment!.trim()}`,
        link: '/moi/documents/justificatifs',
        dedupeKey: `piece:${documentId}:verdict`,
      });
    });
  }

  /**
   * Valider le titre de la fiche. En conformité, le document porte ce que dit
   * la fiche : rien à écrire — sauf si qui vérifie constate une nouvelle
   * pièce et en saisit les informations. Une nouvelle pièce (renouvellement,
   * fiche vide) se valide avec ses informations : elles remplacent celles de
   * la fiche. L'autre titre ne touche à la fiche que si qui vérifie en fait
   * sa pièce — en en saisissant les informations. Les autres documents, jamais.
   */
  private async reporterSurLaFiche(
    tx: Tx,
    doc: PieceSansContenu,
    titre: TitreSaisi | undefined,
  ): Promise<void> {
    const mode = modeDeControle(doc, await this.titreDeLaFiche(tx, doc.employeeId));
    if (mode === null) {
      if (titre) {
        problem(
          422,
          'documents.pas_le_titre',
          'Ce document n’est pas la pièce d’identité de la fiche',
          'Ses informations ne s’y reportent pas.',
        );
      }
      return;
    }
    if (!titre) {
      // Sans nouvelles informations, c'est la date déclarée au dépôt qui vaut :
      // une pièce expirée depuis, ou ce jour, ne se valide pas.
      if (mode === 'conformite' || mode === 'autre') {
        if (doc.expiresOn) await refuserSiExpiree(tx, doc.expiresOn);
        return;
      }
      problem(
        422,
        'documents.titre_requis',
        'Saisissez les informations de la nouvelle pièce',
        'Son numéro, sa date de délivrance et sa date d’expiration remplacent celles de la fiche.',
      );
    }
    await refuserSiExpiree(tx, titre.expireLe);
    const [e] = await tx
      .select({ personId: t.employees.personId })
      .from(t.employees)
      .where(eq(t.employees.id, doc.employeeId))
      .limit(1);
    await tx
      .update(t.persons)
      .set({
        idDocumentType: doc.category === 'cni' ? 'cni' : 'passport',
        nationalIdEncrypted: this.crypto.encrypt(titre.numero),
        idDocumentIssuedOn: titre.delivreLe,
        idDocumentExpiresOn: titre.expireLe,
      })
      .where(eq(t.persons.id, e!.personId));
    // Le document porte la date retenue : c'est elle que l'agent lit, et
    // celle des rappels.
    await tx
      .update(t.employeeDocuments)
      .set({ expiresOn: titre.expireLe })
      .where(eq(t.employeeDocuments.id, doc.id));
  }

  async list(user: SessionUser, employeeId: string): Promise<EmployeeDocumentView[]> {
    return this.db.withTenant(ctxOf(user), async (tx) => {
      const target = await this.requireEmployeeWithPerson(tx, employeeId);
      const isOwner = target.personUserId === user.userId;
      // Ses documents se lisent sur sa fiche : qui consulte les dossiers les voit.
      const surLaFiche = peut(user, 'personnel.consulter');
      if (!isOwner && !surLaFiche && !(await this.voitLaFile(tx, user))) {
        problem(403, 'documents.forbidden_scope', 'Accès limité à votre propre dossier');
      }

      const uploader = t.users;
      const rows = await tx
        .select({
          doc: SANS_CONTENU,
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

      const moi = await agentDuCompte(tx, user.userId);
      const dch = await directionDuPersonnel(tx);
      const vues: EmployeeDocumentView[] = [];
      for (const { doc, uploaderGivenName, uploaderFamilyName } of rows) {
        vues.push(
          await this.vue(tx, user, moi, dch, doc, `${uploaderGivenName} ${uploaderFamilyName}`, {
            reviewer: reviewers.find((u) => u.id === doc.reviewedByUserId),
            isOwner,
          }),
        );
      }
      return vues;
    });
  }

  /**
   * La file de la DCH : les pièces déposées par les agents, en attente —
   * et celles vérifiées ces trente derniers jours, pour le suivi. Qui voit
   * toute la file la voit entière ; un membre à qui une pièce est confiée
   * voit celle-là.
   */
  async file(user: SessionUser): Promise<PieceATraiterView[]> {
    return this.db.withTenant(ctxOf(user), async (tx) => {
      const moi = await agentDuCompte(tx, user.userId);
      const toute = await this.voitLaFile(tx, user);
      if (!toute && !moi) return [];
      const uploader = t.users;
      // Les pièces en vérification viennent toutes ; la limite ne porte que
      // sur celles vérifiées ces trente derniers jours. Sans leur contenu :
      // une liste n'a pas à charger les fichiers.
      const lire = (filtre: SQL) =>
        tx
          .select({
            doc: SANS_CONTENU,
            uploaderGivenName: uploader.givenName,
            uploaderFamilyName: uploader.familyName,
            givenName: t.persons.givenName,
            familyName: t.persons.familyName,
            employeeNumber: t.employees.employeeNumber,
            ownerUserId: t.persons.userId,
          })
          .from(t.employeeDocuments)
          .innerJoin(uploader, eq(uploader.id, t.employeeDocuments.uploadedByUserId))
          .innerJoin(t.employees, eq(t.employees.id, t.employeeDocuments.employeeId))
          .innerJoin(t.persons, eq(t.persons.id, t.employees.personId))
          .where(and(filtre, toute ? undefined : eq(t.employeeDocuments.confieeAEmployeeId, moi!)))
          .orderBy(desc(t.employeeDocuments.createdAt));
      const rows = [
        ...(await lire(eq(t.employeeDocuments.status, 'pending'))),
        ...(await lire(
          sql`${t.employeeDocuments.status} <> 'pending'
              AND ${t.employeeDocuments.reviewedAt} > now() - interval '30 days'`,
        ).limit(100)),
      ].sort((a, b) => b.doc.createdAt.getTime() - a.doc.createdAt.getTime());
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
      const dch = await directionDuPersonnel(tx);
      const vues: PieceATraiterView[] = [];
      for (const r of rows) {
        const vue = await this.vue(
          tx,
          user,
          moi,
          dch,
          r.doc,
          `${r.uploaderGivenName} ${r.uploaderFamilyName}`,
          {
            reviewer: reviewers.find((u) => u.id === r.doc.reviewedByUserId),
            isOwner: r.ownerUserId === user.userId,
          },
        );
        vues.push({
          ...vue,
          employeeName: `${r.givenName} ${r.familyName}`,
          employeeNumber: r.employeeNumber,
        });
      }
      return vues;
    });
  }

  /**
   * Voit la file des pièces à vérifier : qui les vérifie pour la DCH. Qui
   * consulte les dossiers lit les pièces d'un agent sur sa fiche, pas la file.
   */
  private voitLaFile(tx: Tx, user: SessionUser): Promise<boolean> {
    return voitToutLaFile(tx, user, 'pieces');
  }

  /** Voit CE document : la file entière, ou le membre à qui il est confié. */
  private async voit(tx: Tx, user: SessionUser, doc: PieceSansContenu): Promise<boolean> {
    if (await this.voitLaFile(tx, user)) return true;
    const moi = await agentDuCompte(tx, user.userId);
    return Boolean(moi && doc.confieeAEmployeeId === moi);
  }

  private async vue(
    tx: Tx,
    user: SessionUser,
    moi: string | null,
    dch: DirectionDuPersonnel | null,
    doc: PieceSansContenu,
    uploadedByName: string,
    o: { reviewer?: { givenName: string; familyName: string }; isOwner: boolean },
  ): Promise<EmployeeDocumentView> {
    const reviewer = o.reviewer;
    const enAttenteDCH = doc.status === 'pending';
    const tr = enAttenteDCH
      ? await vueDuTraitement(
          tx,
          capaciteDeLaPiece(doc.category as DocumentCategory),
          { employeeId: doc.employeeId, confieeA: doc.confieeAEmployeeId },
          moi,
          dch,
        )
      : null;
    // Jamais ses propres pièces, jamais ce qu'on a déposé soi-même.
    const canReview =
      enAttenteDCH &&
      !o.isOwner &&
      doc.uploadedByUserId !== user.userId &&
      Boolean(tr?.peutTraiter);
    // Qui vérifie le titre de la fiche voit ce qu'elle porte : de quoi
    // comparer, ou de quoi remplacer.
    let controle: ControleDuTitre | null = null;
    if (canReview && aUneExpiration(doc.category as DocumentCategory)) {
      const fiche = await this.titreDeLaFiche(tx, doc.employeeId);
      const mode = modeDeControle(doc, fiche);
      if (mode) {
        controle = {
          mode,
          fiche: {
            type: fiche.type,
            numero: fiche.numero,
            delivreLe: fiche.delivreLe,
            expireLe: fiche.expireLe,
          },
        };
      }
    }
    // Retirer une pièce validée : qui gère les dossiers — pas sur le sien.
    const canDelete =
      (peut(user, 'personnel.gerer') && !o.isOwner) ||
      (doc.uploadedByUserId === user.userId && doc.status !== 'approved');
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
      uploadedByName,
      reviewedByName: reviewer ? `${reviewer.givenName} ${reviewer.familyName}` : null,
      reviewComment: doc.reviewComment,
      createdAt: doc.createdAt.toISOString(),
      // L'échéance d'un titre sert à son titulaire : la DCH ne la suit pas.
      expiresOn: o.isOwner ? doc.expiresOn : null,
      renouvellement: doc.renouvellement,
      controle,
      canReview,
      canDelete,
      canReplace: o.isOwner && doc.status === 'pending' && doc.uploadedByUserId === user.userId,
      traitement: tr?.vue ?? null,
    };
  }

  /** Contenu binaire — la DCH ou le titulaire (CNI, diplômes : sensibles). */
  async content(
    user: SessionUser,
    documentId: string,
  ): Promise<{ filename: string; contentType: string; data: Buffer }> {
    return this.db.withTenant(ctxOf(user), async (tx) => {
      const doc = await this.requireDocument(tx, documentId);
      const target = await this.requireEmployeeWithPerson(tx, doc.employeeId);
      // Le titulaire ; qui voit les données sensibles ; qui vérifie les pièces.
      const autorise =
        target.personUserId === user.userId ||
        peut(user, 'personnel.sensible') ||
        (await this.voit(tx, user, doc));
      if (!autorise) {
        problem(403, 'documents.forbidden_scope', 'Accès limité à votre propre dossier');
      }
      const [fichier] = await tx
        .select({ data: t.employeeDocuments.data })
        .from(t.employeeDocuments)
        .where(eq(t.employeeDocuments.id, documentId));
      return { filename: doc.filename, contentType: doc.contentType, data: fichier!.data };
    });
  }

  async remove(user: SessionUser, documentId: string): Promise<void> {
    await this.db.withTenant(ctxOf(user), async (tx) => {
      const doc = await this.requireDocument(tx, documentId);
      const target = await this.requireEmployeeWithPerson(tx, doc.employeeId);
      // Qui gère les dossiers retire une pièce validée — pas de SON dossier.
      const isManage = peut(user, 'personnel.gerer') && target.personUserId !== user.userId;
      const isUploader = doc.uploadedByUserId === user.userId;
      if (!isManage && !(isUploader && doc.status !== 'approved')) {
        problem(
          403,
          'documents.delete_forbidden',
          'Seule la DCH peut retirer un document validé du dossier',
        );
      }
      await tx.delete(t.employeeDocuments).where(eq(t.employeeDocuments.id, documentId));
      // Un dépôt annulé avant vérification ne reste pas dans la file de la DCH.
      await reconcilierUneDemande(tx, 'pieces', documentId);
    });
  }

  /** La pièce sans son contenu : seul le téléchargement lit le fichier. */
  private async requireDocument(tx: Tx, id: string) {
    const [doc] = await tx
      .select(SANS_CONTENU)
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
