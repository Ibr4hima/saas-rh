import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, not, sql, type SQL } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type {
  CreateProfileChangeRequestInput,
  DecideProfileChangeRequestInput,
  ProfileChangeField,
  ProfileChangeRequestView,
  ProfileChangeStatus,
  ProfileChangeValues,
  SessionUser,
} from '@teranga/contracts';
import {
  peut,
  PROFILE_CHANGE_ALL_LABELS,
  profileChangeValuesSchema,
  maritalLabelsFor,
} from '@teranga/contracts';
import { problem } from '../../common/problem';
import * as t from '../../db/schema';
import { TenantDb, Tx } from '../../db/tenant-db';
import { NotificationsService } from '../notifications/notifications.service';
import { agentDuCompte, directionDuPersonnel } from '../acces/dch';
import {
  reconcilierUneDemande,
  uneDemandeALaFois,
  voitToutLaFile,
  vueDuTraitement,
  exigerDeTraiter,
} from '../acces/demandes';

/**
 * Colonne `persons` correspondant à chaque champ.
 *
 * Les champs RETIRÉS de la liste des demandables y figurent encore : une
 * demande déposée avant leur retrait doit s'appliquer entière le jour où la RH
 * la valide. Sans leur colonne ici, elle s'appliquerait amputée, en silence.
 */
const COLUMN_OF: Record<string, keyof typeof t.persons.$inferInsert> = {
  maritalStatus: 'maritalStatus',
  personalEmail: 'personalEmail',
  phone: 'phone',
  addressLine: 'addressLine',
  emergencyContactName: 'emergencyContactName',
  emergencyContactPhone: 'emergencyContactPhone',
};

/** Deux valeurs d'un champ, comparées comme le dossier les tient (vide = absent). */
const pareil = (a: unknown, b: unknown) => String(a ?? '') === String(b ?? '');

/** Les champs dont la valeur au dossier n'est plus celle qu'avait vue l'agent. */
function modifiesDepuis(
  changes: Record<string, unknown>,
  previous: Record<string, unknown>,
  person: Record<string, unknown>,
): string[] {
  return Object.keys(changes).filter((field) => {
    const colonne = COLUMN_OF[field];
    return colonne !== undefined && !pareil(previous[field], person[colonne]);
  });
}

function ctxOf(user: SessionUser) {
  return { tenantId: user.tenantId, userId: user.userId };
}

@Injectable()
export class ProfileChangesService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  /** L'employé propose des corrections sur SON dossier, jamais sur un autre. */
  async create(user: SessionUser, input: CreateProfileChangeRequestInput): Promise<{ id: string }> {
    const id = uuidv7();
    await this.db.withTenant(ctxOf(user), async (tx) => {
      const self = await this.selfPerson(tx, user);

      // Ne garder que ce qui change RÉELLEMENT : une demande qui ne demande
      // rien ferait travailler la RH pour confirmer l'état existant.
      const changes: Record<string, unknown> = {};
      const previous: Record<string, unknown> = {};
      for (const [field, value] of Object.entries(input.changes) as [
        ProfileChangeField,
        string | null,
      ][]) {
        const current = (self.person as Record<string, unknown>)[COLUMN_OF[field] ?? field] ?? null;
        if ((current ?? null) === (value ?? null)) continue;
        changes[field] = value ?? null;
        previous[field] = current;
      }
      if (Object.keys(changes).length === 0) {
        problem(
          422,
          'profile.no_change',
          'Aucune modification à transmettre',
          'Les valeurs saisies sont déjà celles de votre dossier.',
        );
      }

      await uneDemandeALaFois(tx, self.employeeId);
      const [pending] = await tx
        .select({ id: t.profileChangeRequests.id })
        .from(t.profileChangeRequests)
        .where(
          and(
            eq(t.profileChangeRequests.employeeId, self.employeeId),
            eq(t.profileChangeRequests.status, 'pending'),
          ),
        )
        .limit(1);
      if (pending) {
        problem(
          422,
          'profile.request_already_pending',
          'Une demande est déjà en attente',
          'Attendez la réponse de la Direction du Capital Humain avant d’en envoyer une autre.',
        );
      }

      await tx.insert(t.profileChangeRequests).values({
        id,
        tenantId: user.tenantId,
        employeeId: self.employeeId,
        changes,
        previous,
        note: input.note ?? null,
        requestedByUserId: user.userId,
        status: 'pending',
      });

      // À qui la traite pour la DCH — et à eux seuls.
      await reconcilierUneDemande(tx, 'informations', id);
    });
    return { id };
  }

  /**
   * La file de la DCH (tout le tenant) ou l'historique personnel.
   * `scope=mine` est honoré QUELLES QUE SOIENT ses habilitations : un membre
   * de la DCH est aussi agent, son espace personnel doit rester personnel.
   *
   * Voit toute la file qui la traite (le directeur, les membres habilités)
   * ou consulte les dossiers ; un membre à qui une demande est confiée voit
   * celle-là ; chacun voit les siennes.
   */
  async list(
    user: SessionUser,
    filters: { employeeId?: string; status?: ProfileChangeStatus; scope?: 'mine' },
  ): Promise<ProfileChangeRequestView[]> {
    return this.db.withTenant(ctxOf(user), async (tx) => {
      const moi = await agentDuCompte(tx, user.userId);
      const selfOnly = filters.scope === 'mine';
      // La file : qui la traite pour la DCH. Les signalements d'UN agent, sur
      // sa fiche : qui consulte les dossiers.
      const toute =
        !selfOnly &&
        ((await voitToutLaFile(tx, user, 'informations')) ||
          (Boolean(filters.employeeId) && peut(user, 'personnel.consulter')));
      const self = await this.selfPerson(tx, user, true);
      const conditions: SQL[] = [];

      if (selfOnly) {
        if (!self) return [];
        conditions.push(eq(t.profileChangeRequests.employeeId, self.employeeId));
      } else if (!toute) {
        if (!moi) return [];
        conditions.push(
          sql`(${t.profileChangeRequests.employeeId} = ${moi}
               OR ${t.profileChangeRequests.confieeAEmployeeId} = ${moi})`,
        );
      }
      if (!selfOnly && filters.employeeId) {
        conditions.push(eq(t.profileChangeRequests.employeeId, filters.employeeId));
      }
      if (filters.status) conditions.push(eq(t.profileChangeRequests.status, filters.status));

      const handler = t.users;
      // Les demandes en attente viennent toutes ; la limite ne porte que sur
      // l'historique, sinon les plus anciennes sortiraient de la file.
      const ouverte = eq(t.profileChangeRequests.status, 'pending');
      const lire = (filtre: SQL) =>
        tx
          .select({
            request: t.profileChangeRequests,
            givenName: t.persons.givenName,
            familyName: t.persons.familyName,
            gender: t.persons.gender,
            person: t.persons,
            employeeNumber: t.employees.employeeNumber,
            handlerGivenName: handler.givenName,
            handlerFamilyName: handler.familyName,
          })
          .from(t.profileChangeRequests)
          .innerJoin(t.employees, eq(t.employees.id, t.profileChangeRequests.employeeId))
          .innerJoin(t.persons, eq(t.persons.id, t.employees.personId))
          .leftJoin(handler, eq(handler.id, t.profileChangeRequests.handledByUserId))
          .where(and(...conditions, filtre))
          .orderBy(desc(t.profileChangeRequests.createdAt));
      const rows = [...(await lire(ouverte)), ...(await lire(not(ouverte)).limit(100))].sort(
        (a, b) => b.request.createdAt.getTime() - a.request.createdAt.getTime(),
      );

      const dch = await directionDuPersonnel(tx);
      const vues: ProfileChangeRequestView[] = [];
      for (const r of rows) {
        const d = { employeeId: r.request.employeeId, confieeA: r.request.confieeAEmployeeId };
        const tr =
          !selfOnly && r.request.status === 'pending'
            ? await vueDuTraitement(tx, 'demandes.informations', d, moi, dch)
            : null;
        vues.push({
          id: r.request.id,
          employeeId: r.request.employeeId,
          employeeName: `${r.givenName} ${r.familyName}`,
          employeeNumber: r.employeeNumber,
          status: r.request.status as ProfileChangeStatus,
          note: r.request.note,
          hrMessage: r.request.hrMessage,
          handledByName: r.handlerGivenName ? `${r.handlerGivenName} ${r.handlerFamilyName}` : null,
          createdAt: r.request.createdAt.toISOString(),
          handledAt: r.request.handledAt?.toISOString() ?? null,
          fields: this.describe(
            r.request.changes as Record<string, unknown>,
            r.request.previous as Record<string, unknown>,
            r.gender,
            // Le dossier d'aujourd'hui ne compte que pour une demande en attente.
            r.request.status === 'pending' ? (r.person as Record<string, unknown>) : null,
          ),
          canDecide: Boolean(tr?.peutTraiter),
          canCancel: r.request.status === 'pending' && r.request.employeeId === self?.employeeId,
          traitement: tr?.vue ?? null,
        });
      }
      return vues;
    });
  }

  /**
   * Qui la traite pour la DCH tranche. Confirmer applique les valeurs au
   * dossier, immédiatement.
   */
  async decide(
    user: SessionUser,
    requestId: string,
    input: DecideProfileChangeRequestInput,
  ): Promise<void> {
    if (input.decision === 'reject' && !input.message?.trim()) {
      problem(422, 'profile.reject_reason_required', 'Un motif est requis pour refuser');
    }

    await this.db.withTenant(ctxOf(user), async (tx) => {
      const [row] = await tx
        .select()
        .from(t.profileChangeRequests)
        .where(eq(t.profileChangeRequests.id, requestId))
        .for('update')
        .limit(1);
      if (!row) {
        problem(404, 'profile.request_not_found', 'Demande introuvable');
      }
      if (row.status !== 'pending') {
        problem(
          422,
          'profile.request_already_handled',
          'Cette demande a déjà été traitée',
          `État actuel : ${row.status}.`,
        );
      }
      await exigerDeTraiter(tx, user, 'demandes.informations', {
        employeeId: row.employeeId,
        confieeA: row.confieeAEmployeeId,
      });

      const [target] = await tx
        .select({ personId: t.employees.personId, userId: t.persons.userId, person: t.persons })
        .from(t.employees)
        .innerJoin(t.persons, eq(t.persons.id, t.employees.personId))
        .where(eq(t.employees.id, row.employeeId))
        .limit(1);

      if (input.decision === 'approve' && target && !input.ecraser) {
        // La RH a corrigé l'un de ces champs depuis la demande : la valider
        // remplacerait sa correction. Cela se décide en le voyant.
        const changes = modifiesDepuis(
          row.changes as Record<string, unknown>,
          row.previous as Record<string, unknown>,
          target.person as Record<string, unknown>,
        );
        if (changes.length > 0) {
          problem(
            409,
            'profile.modifie_depuis',
            'Le dossier a changé depuis la demande',
            `${changes.map((f) => PROFILE_CHANGE_ALL_LABELS[f] ?? f).join(', ')} : la valeur au dossier n’est plus celle que l’agent avait sous les yeux.`,
          );
        }
      }

      if (input.decision === 'approve') {
        // Le jsonb stocké est REVALIDÉ avant d'atteindre la base : il a
        // transité par le disque, et rien ne garantit qu'il porte encore la
        // forme attendue. On ne construit l'UPDATE qu'à partir de la liste
        // blanche, jamais par recopie des clés reçues.
        const parsed = profileChangeValuesSchema.safeParse(row.changes);
        if (!parsed.success) {
          problem(
            422,
            'profile.invalid_stored_changes',
            'Cette demande porte des données inexploitables',
            'Demandez à l’employé de la reformuler.',
          );
        }
        const patch: Record<string, unknown> = {};
        for (const [field, value] of Object.entries(parsed.data) as [string, string | null][]) {
          const colonne = COLUMN_OF[field];
          // Un champ dont on ne connaît plus la colonne ne s'applique pas :
          // mieux vaut le laisser que d'écrire quelque part au hasard.
          if (!colonne) continue;
          patch[colonne] = value ?? null;
        }
        if (Object.keys(patch).length > 0 && target) {
          await tx.update(t.persons).set(patch).where(eq(t.persons.id, target.personId));
        }
      }

      await tx
        .update(t.profileChangeRequests)
        .set({
          status: input.decision === 'approve' ? 'approved' : 'rejected',
          handledByUserId: user.userId,
          handledAt: new Date(),
          hrMessage: input.message?.trim() || null,
          updatedAt: new Date(),
        })
        .where(eq(t.profileChangeRequests.id, requestId));
      await reconcilierUneDemande(tx, 'informations', requestId);

      if (!target?.userId) return; // dossier sans compte portail : rien à notifier
      await this.notifications.notifyUser(tx, user.tenantId, target.userId, {
        type: `profile_change_${input.decision}`,
        title:
          input.decision === 'approve'
            ? 'Vos informations sont mises à jour'
            : 'Votre demande de mise à jour est refusée',
        link: '/moi',
      });
    });
  }

  /** L'agent retire sa demande tant qu'elle attend : elle sort de la file. */
  async cancel(user: SessionUser, requestId: string): Promise<void> {
    await this.db.withTenant(ctxOf(user), async (tx) => {
      const [row] = await tx
        .select()
        .from(t.profileChangeRequests)
        .where(eq(t.profileChangeRequests.id, requestId))
        .for('update')
        .limit(1);
      const self = await this.selfPerson(tx, user, true);
      if (!row || !self || row.employeeId !== self.employeeId) {
        problem(404, 'profile.request_not_found', 'Demande introuvable');
      }
      if (row.status !== 'pending') {
        problem(422, 'profile.request_already_handled', 'Cette demande a déjà été traitée');
      }
      await tx
        .update(t.profileChangeRequests)
        .set({ status: 'cancelled', handledAt: new Date(), updatedAt: new Date() })
        .where(eq(t.profileChangeRequests.id, requestId));
      await reconcilierUneDemande(tx, 'informations', requestId);
    });
  }

  /** Traduit le jsonb en lignes lisibles « avant → après ». */
  private describe(
    changes: Record<string, unknown>,
    previous: Record<string, unknown>,
    gender: string | null,
    person: Record<string, unknown> | null,
  ) {
    const marital = maritalLabelsFor(gender ?? undefined);
    const render = (field: string, value: unknown): string | null => {
      if (value === null || value === undefined || value === '') return null;
      if (field === 'maritalStatus') return marital[String(value)] ?? String(value);
      return String(value);
    };
    return Object.keys(changes)
      .filter((f) => f in PROFILE_CHANGE_ALL_LABELS)
      .map((field) => ({
        field,
        label: PROFILE_CHANGE_ALL_LABELS[field]!,
        previous: render(field, previous[field]),
        next: render(field, changes[field]),
        actuel: person && COLUMN_OF[field] ? render(field, person[COLUMN_OF[field]!]) : null,
        modifieDepuis: Boolean(
          person && COLUMN_OF[field] && !pareil(previous[field], person[COLUMN_OF[field]!]),
        ),
      }));
  }

  private async selfPerson(tx: Tx, user: SessionUser, tolerate = false) {
    const [row] = await tx
      .select({
        employeeId: t.employees.id,
        givenName: t.persons.givenName,
        familyName: t.persons.familyName,
        person: t.persons,
      })
      .from(t.employees)
      .innerJoin(t.persons, eq(t.persons.id, t.employees.personId))
      .where(eq(t.persons.userId, user.userId))
      .limit(1);
    if (!row && !tolerate) {
      problem(
        404,
        'profile.no_employee_record',
        'Aucun dossier employé relié à ce compte',
        'Seuls les employés peuvent signaler un changement.',
      );
    }
    return row as NonNullable<typeof row>;
  }
}
