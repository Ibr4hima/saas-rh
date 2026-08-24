import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
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
  PROFILE_CHANGE_LABELS,
  profileChangeValuesSchema,
  maritalLabelsFor,
} from '@teranga/contracts';
import { problem } from '../../common/problem';
import * as t from '../../db/schema';
import { TenantDb, Tx } from '../../db/tenant-db';
import { NotificationsService } from '../notifications/notifications.service';

const MANAGE_ROLES = new Set(['admin', 'hr']);

/** Colonne `persons` correspondant à chaque champ demandable. */
const COLUMN_OF: Record<ProfileChangeField, keyof typeof t.persons.$inferInsert> = {
  maritalStatus: 'maritalStatus',
  personalEmail: 'personalEmail',
  phone: 'phone',
  addressLine: 'addressLine',
  city: 'city',
  emergencyContactName: 'emergencyContactName',
  emergencyContactPhone: 'emergencyContactPhone',
};

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
        const current = (self.person as Record<string, unknown>)[COLUMN_OF[field]] ?? null;
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

      await this.notifications.notifyHr(tx, user.tenantId, {
        type: 'profile_change_request',
        title: `${self.givenName} ${self.familyName} signale un changement personnel`,
        body: Object.keys(changes)
          .map((f) => PROFILE_CHANGE_LABELS[f as ProfileChangeField])
          .join(', '),
        link: `/employees/${self.employeeId}`,
      });
    });
    return { id };
  }

  /**
   * File RH (tout le tenant) ou historique personnel.
   * `scope=mine` est honoré QUEL QUE SOIT le rôle : un membre RH est aussi
   * salarié, son espace personnel doit rester personnel.
   */
  async list(
    user: SessionUser,
    filters: { employeeId?: string; status?: ProfileChangeStatus; scope?: 'mine' },
  ): Promise<ProfileChangeRequestView[]> {
    return this.db.withTenant(ctxOf(user), async (tx) => {
      const selfOnly = filters.scope === 'mine' || !MANAGE_ROLES.has(user.role);
      const isManage = MANAGE_ROLES.has(user.role) && !selfOnly;
      const conditions = [];

      if (selfOnly) {
        const self = await this.selfPerson(tx, user, true);
        if (!self) return [];
        conditions.push(eq(t.profileChangeRequests.employeeId, self.employeeId));
      } else if (filters.employeeId) {
        conditions.push(eq(t.profileChangeRequests.employeeId, filters.employeeId));
      }
      if (filters.status) conditions.push(eq(t.profileChangeRequests.status, filters.status));

      const handler = t.users;
      const rows = await tx
        .select({
          request: t.profileChangeRequests,
          givenName: t.persons.givenName,
          familyName: t.persons.familyName,
          gender: t.persons.gender,
          employeeNumber: t.employees.employeeNumber,
          handlerGivenName: handler.givenName,
          handlerFamilyName: handler.familyName,
        })
        .from(t.profileChangeRequests)
        .innerJoin(t.employees, eq(t.employees.id, t.profileChangeRequests.employeeId))
        .innerJoin(t.persons, eq(t.persons.id, t.employees.personId))
        .leftJoin(handler, eq(handler.id, t.profileChangeRequests.handledByUserId))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(t.profileChangeRequests.createdAt))
        .limit(100);

      return rows.map((r) => ({
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
        ),
        canDecide: isManage && r.request.status === 'pending',
      }));
    });
  }

  /** La RH tranche. Confirmer applique les valeurs au dossier, immédiatement. */
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

      const [target] = await tx
        .select({ personId: t.employees.personId, userId: t.persons.userId })
        .from(t.employees)
        .innerJoin(t.persons, eq(t.persons.id, t.employees.personId))
        .where(eq(t.employees.id, row.employeeId))
        .limit(1);

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
        for (const [field, value] of Object.entries(parsed.data) as [
          ProfileChangeField,
          string | null,
        ][]) {
          patch[COLUMN_OF[field]] = value ?? null;
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

      if (!target?.userId) return; // dossier sans compte portail : rien à notifier
      const drafts = {
        approve: {
          title: 'Vos informations ont été mises à jour',
          body: 'La Direction du Capital Humain a validé les corrections que vous aviez signalées.',
        },
        reject: {
          title: 'Vos corrections n’ont pas été retenues',
          body: `Motif : ${input.message?.trim()}`,
        },
      } as const;
      const draft = drafts[input.decision];
      await this.notifications.notifyUser(tx, user.tenantId, target.userId, {
        type: `profile_change_${input.decision}`,
        title: draft.title,
        body: draft.body,
        link: '/moi/informations',
      });
    });
  }

  /** Traduit le jsonb en lignes lisibles « avant → après ». */
  private describe(
    changes: Record<string, unknown>,
    previous: Record<string, unknown>,
    gender: string | null,
  ) {
    const marital = maritalLabelsFor(gender ?? undefined);
    const render = (field: ProfileChangeField, value: unknown): string | null => {
      if (value === null || value === undefined || value === '') return null;
      if (field === 'maritalStatus') return marital[String(value)] ?? String(value);
      return String(value);
    };
    return (Object.keys(changes) as ProfileChangeField[])
      .filter((f) => f in PROFILE_CHANGE_LABELS)
      .map((field) => ({
        field,
        label: PROFILE_CHANGE_LABELS[field],
        previous: render(field, previous[field]),
        next: render(field, changes[field]),
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
