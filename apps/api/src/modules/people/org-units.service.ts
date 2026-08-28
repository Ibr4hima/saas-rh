import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type {
  CreateOrgUnitInput,
  DeleteOrgUnitInput,
  OrgUnitMember,
  OrgUnitType,
  OrgUnitView,
  SessionUser,
  UpdateOrgUnitInput,
} from '@teranga/contracts';
import { ORG_UNIT_PARENT_TYPES, ORG_UNIT_TYPE_LABELS } from '@teranga/contracts';
import { problem } from '../../common/problem';
import * as t from '../../db/schema';
import { TenantDb, Tx } from '../../db/tenant-db';

/** Drizzle enveloppe l'erreur pg : le code est sur la cause (cf. les autres services). */
function pgCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code ?? e?.cause?.code;
}

/** Index uniques de 0012 → message métier plutôt qu'une 500 opaque. */
function mapUniqueViolation(err: unknown): never {
  const e = err as { constraint?: string; cause?: { constraint?: string } };
  const detail = e?.constraint ?? e?.cause?.constraint ?? '';
  if (detail.includes('one_unit_per_manager')) {
    problem(
      422,
      'org.manager_already_assigned',
      'Cet employé dirige déjà une autre unité',
      "Un responsable ne peut diriger qu'une seule unité : retirez-le de l'autre d'abord.",
    );
  }
  if (detail.includes('short_name_unique')) {
    problem(422, 'org.short_name_taken', 'Cet abrégé est déjà utilisé par une autre direction');
  }
  if (detail.includes('sibling_name_unique')) {
    problem(
      422,
      'org.name_taken',
      'Une unité porte déjà ce nom au même niveau',
      'Deux unités sœurs homonymes seraient indiscernables dans l’organigramme.',
    );
  }
  throw err;
}

@Injectable()
export class OrgUnitsService {
  constructor(@Inject(TenantDb) private readonly db: TenantDb) {}

  /** Liste enrichie pour l'organigramme : responsable et effectif direct. */
  async list(user: SessionUser): Promise<OrgUnitView[]> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      const managerPersons = t.persons;
      const rows = await tx
        .select({
          id: t.orgUnits.id,
          name: t.orgUnits.name,
          unitType: t.orgUnits.unitType,
          parentId: t.orgUnits.parentId,
          shortName: t.orgUnits.shortName,
          managerEmployeeId: t.orgUnits.managerEmployeeId,
          managerGivenName: managerPersons.givenName,
          managerFamilyName: managerPersons.familyName,
          managerPosition: sql<string | null>`(
            SELECT a.position_title FROM assignments a
            WHERE a.employee_id = ${t.orgUnits.managerEmployeeId}
              AND a.validity @> CURRENT_DATE
            LIMIT 1)`,
          headcount: sql<number>`(
            SELECT count(*)::int FROM assignments a
            JOIN employees e ON e.id = a.employee_id
            WHERE a.org_unit_id = ${t.orgUnits.id}
              AND a.validity @> CURRENT_DATE
              AND e.status = 'active')`,
          // Tout ce qui devra être réaffecté en cas de dissolution : sans
          // filtre de statut, et affectations futures comprises.
          openAssignments: sql<number>`(
            SELECT count(*)::int FROM assignments a
            WHERE a.org_unit_id = ${t.orgUnits.id}
              AND (upper_inf(a.validity) OR upper(a.validity) > CURRENT_DATE))`,
        })
        .from(t.orgUnits)
        .leftJoin(t.employees, eq(t.employees.id, t.orgUnits.managerEmployeeId))
        .leftJoin(managerPersons, eq(managerPersons.id, t.employees.personId))
        .where(isNull(t.orgUnits.deletedAt))
        .orderBy(asc(t.orgUnits.unitType), asc(t.orgUnits.name));

      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        unitType: r.unitType as OrgUnitView['unitType'],
        parentId: r.parentId,
        shortName: r.shortName,
        managerEmployeeId: r.managerEmployeeId,
        managerName: r.managerGivenName ? `${r.managerGivenName} ${r.managerFamilyName}` : null,
        managerPosition: r.managerPosition,
        headcount: r.headcount,
        openAssignments: r.openAssignments,
      }));
    });
  }

  async create(user: SessionUser, input: CreateOrgUnitInput): Promise<{ id: string }> {
    const id = uuidv7();
    this.assertShortNameAllowed(input.unitType, input.shortName ?? null);
    try {
      await this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
        await this.assertParentAllowed(tx, input.unitType, input.parentId ?? null);
        await tx.insert(t.orgUnits).values({
          id,
          tenantId: user.tenantId,
          name: input.name,
          unitType: input.unitType,
          parentId: input.parentId || null,
          shortName: input.shortName ?? null,
        });
      });
    } catch (err) {
      if (pgCode(err) === '23505') mapUniqueViolation(err);
      throw err;
    }
    return { id };
  }

  /**
   * Suppression d'une unité (effacement doux : l'historique des affectations
   * continue de la référencer). Ses membres ne peuvent pas rester en l'air —
   * l'appelant désigne l'unité d'accueil, et le transfert est daté du jour
   * comme n'importe quelle mutation.
   */
  async remove(user: SessionUser, id: string, input: DeleteOrgUnitInput): Promise<void> {
    await this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      await this.requireUnit(tx, id, 'org.unit_not_found');

      // Une unité parente emporterait ses descendants dans sa chute : on exige
      // qu'ils soient rattachés ailleurs d'abord, décision par décision.
      const children = await tx
        .select({ name: t.orgUnits.name })
        .from(t.orgUnits)
        .where(and(eq(t.orgUnits.parentId, id), isNull(t.orgUnits.deletedAt)));
      if (children.length > 0) {
        problem(
          422,
          'org.unit_has_children',
          'Cette unité en contient d’autres',
          `Rattachez d’abord ailleurs : ${children.map((c) => c.name).join(', ')}.`,
        );
      }

      // Une offre de recrutement ouverte annoncerait une direction disparue —
      // y compris sur la page publique de candidature.
      const postings = await tx
        .select({ title: t.jobPostings.title })
        .from(t.jobPostings)
        .where(and(eq(t.jobPostings.orgUnitId, id), sql`${t.jobPostings.status} <> 'closed'`));
      if (postings.length > 0) {
        problem(
          422,
          'org.unit_has_job_postings',
          'Des offres de recrutement visent cette unité',
          `Clôturez ou rattachez ailleurs : ${postings.map((j) => j.title).join(', ')}.`,
        );
      }

      // TOUTES les affectations qui n'ont pas pris fin, quel que soit le statut
      // de l'employé : une personne suspendue ou une affectation qui démarre le
      // mois prochain resterait sinon rattachée à une unité fantôme.
      const openAssignments = await tx
        .select({
          id: t.assignments.id,
          employeeId: t.assignments.employeeId,
          positionTitle: t.assignments.positionTitle,
          startsLater: sql<boolean>`lower(${t.assignments.validity}) > CURRENT_DATE`,
        })
        .from(t.assignments)
        .where(
          and(
            eq(t.assignments.orgUnitId, id),
            // Parenthèses OBLIGATOIRES : AND lie plus fort que OR, et sans
            // elles la condition capturait les affectations des AUTRES unités
            // dont la validité court encore.
            sql`(upper_inf(${t.assignments.validity}) OR upper(${t.assignments.validity}) > CURRENT_DATE)`,
          ),
        );

      if (openAssignments.length > 0) {
        if (!input.reassignTo) {
          problem(
            422,
            'org.reassign_required',
            'Ces employés doivent être réaffectés',
            `${openAssignments.length} affectation(s) pointent sur cette unité : indiquez où les rattacher.`,
          );
        }
        if (input.reassignTo === id) {
          problem(422, 'org.reassign_to_self', 'Impossible de réaffecter vers l’unité supprimée');
        }
        await this.requireUnit(tx, input.reassignTo, 'org.reassign_target_not_found');

        const today = new Date().toISOString().slice(0, 10);
        for (const a of openAssignments) {
          if (a.startsLater) {
            // Pas encore commencée : rien à historiser, on la redirige.
            await tx
              .update(t.assignments)
              .set({ orgUnitId: input.reassignTo })
              .where(eq(t.assignments.id, a.id));
            continue;
          }
          // Affectation en cours : on la CLÔT aujourd'hui et on en ouvre une
          // nouvelle sur l'unité d'accueil, comme une mutation ordinaire.
          // Réécrire org_unit_id ferait dire au dossier que l'employé était
          // dans l'unité d'accueil depuis son arrivée — l'historique mentirait.
          await tx
            .update(t.assignments)
            .set({ validity: sql`daterange(lower(${t.assignments.validity}), ${today}::date)` })
            .where(eq(t.assignments.id, a.id));
          await tx.insert(t.assignments).values({
            id: uuidv7(),
            tenantId: user.tenantId,
            employeeId: a.employeeId,
            orgUnitId: input.reassignTo,
            positionTitle: a.positionTitle,
            validity: `[${today},)`,
          });
        }
      }

      // Les affectations closes gardent leur unité : l'historique doit rester
      // lisible (« était au Service X, dissous depuis »).
      await tx
        .update(t.orgUnits)
        .set({ deletedAt: new Date(), managerEmployeeId: null, updatedAt: new Date() })
        .where(eq(t.orgUnits.id, id));

      // Invariant relu sur l'état final : dissoudre l'unité d'un chef pour le
      // faire atterrir ailleurs est exactement ce que la mutation refuse.
      await this.assertManagersStillInScope(
        tx,
        openAssignments.map((a) => a.employeeId),
      );
    });
  }

  /** Renommage, re-rattachement (anti-cycle) ou changement de responsable. */
  async update(user: SessionUser, id: string, input: UpdateOrgUnitInput): Promise<void> {
    try {
      await this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
        await this.requireUnit(tx, id, 'org.unit_not_found');

        if (input.parentId !== undefined && input.parentId !== null) {
          if (input.parentId === id) {
            problem(422, 'org.cycle', 'Une unité ne peut pas être rattachée à elle-même');
          }
          // Anti-cycle : le nouveau parent ne doit pas être un descendant de l'unité.
          const cycle = await tx.execute(sql`
          WITH RECURSIVE ancestors AS (
            SELECT id, parent_id FROM org_units WHERE id = ${input.parentId}
            UNION ALL
            SELECT o.id, o.parent_id FROM org_units o
            JOIN ancestors anc ON o.id = anc.parent_id
          )
          SELECT 1 FROM ancestors WHERE id = ${id} LIMIT 1`);
          if (cycle.rows.length > 0) {
            problem(
              422,
              'org.cycle',
              'Rattachement impossible : cela créerait une boucle dans la structure',
            );
          }
        }

        const [before] = await tx
          .select({ unitType: t.orgUnits.unitType, parentId: t.orgUnits.parentId })
          .from(t.orgUnits)
          .where(eq(t.orgUnits.id, id))
          .limit(1);
        const nextType = (input.unitType ?? before!.unitType) as OrgUnitType;
        const nextParent = input.parentId !== undefined ? input.parentId : before!.parentId;

        // Le type et le rattachement se valident ENSEMBLE : changer l'un peut
        // rendre l'autre absurde (une direction rangée sous un service).
        if (input.unitType !== undefined || input.parentId !== undefined) {
          await this.assertParentAllowed(tx, nextType, nextParent, id);
          await this.assertChildrenAllowed(tx, id, nextType);
        }

        if (input.shortName !== undefined) {
          this.assertShortNameAllowed(nextType, input.shortName);
        } else if (input.unitType !== undefined && nextType !== 'direction') {
          // Un département n'a pas d'abrégé : le déclassement l'efface.
          input = { ...input, shortName: null };
        }

        if (input.managerEmployeeId) {
          await this.assertManagerEligible(tx, id, input.managerEmployeeId);
        }

        // Re-rattacher une unité déplace TOUT son sous-arbre : un responsable
        // affecté dedans peut se retrouver hors de l'unité qu'il dirige, sans
        // qu'aucune mutation d'employé n'ait eu lieu. Même invariant, autre porte.
        // Les employés concernés sont relevés AVANT le déplacement, l'invariant
        // est vérifié APRÈS — sur l'arbre réel, pas sur une simulation.
        const deplaces =
          input.parentId !== undefined && input.parentId !== before!.parentId
            ? (
                await tx.execute<{ employee_id: string }>(sql`
                  WITH RECURSIVE subtree AS (
                    SELECT id FROM org_units WHERE id = ${id} AND deleted_at IS NULL
                    UNION ALL
                    SELECT o.id FROM org_units o
                    JOIN subtree s ON o.parent_id = s.id
                    WHERE o.deleted_at IS NULL
                  )
                  SELECT DISTINCT a.employee_id FROM assignments a
                  WHERE a.org_unit_id IN (SELECT id FROM subtree)
                    AND a.validity @> CURRENT_DATE`)
              ).rows.map((r) => r.employee_id)
            : [];

        const changes: Partial<typeof t.orgUnits.$inferInsert> = {};
        if (input.name !== undefined) changes.name = input.name;
        if (input.unitType !== undefined) changes.unitType = input.unitType;
        if (input.parentId !== undefined) changes.parentId = input.parentId;
        if (input.shortName !== undefined) changes.shortName = input.shortName;
        if (input.managerEmployeeId !== undefined) {
          changes.managerEmployeeId = input.managerEmployeeId;
        }
        if (Object.keys(changes).length === 0) return;
        changes.updatedAt = new Date();
        await tx.update(t.orgUnits).set(changes).where(eq(t.orgUnits.id, id));
        await this.assertManagersStillInScope(tx, deplaces);
      });
    } catch (err) {
      if (pgCode(err) === '23505') mapUniqueViolation(err);
      throw err;
    }
  }

  /** Un abrégé ne se pose que sur une direction (contrainte CHECK en 0012). */
  private assertShortNameAllowed(unitType: OrgUnitType, shortName: string | null): void {
    if (shortName && unitType !== 'direction') {
      problem(
        422,
        'org.short_name_direction_only',
        'Seule une direction porte un abrégé',
        'Un département ou un service se désigne par son nom complet.',
      );
    }
  }

  /**
   * Hiérarchie des types : une direction est racine, un département relève
   * d'une direction, un service d'un département ou d'une direction.
   */
  private async assertParentAllowed(
    tx: Tx,
    unitType: OrgUnitType,
    parentId: string | null,
    selfId?: string,
  ): Promise<void> {
    const allowed = ORG_UNIT_PARENT_TYPES[unitType];
    if (!parentId) {
      if (allowed.length > 0) {
        problem(
          422,
          'org.parent_required',
          `Un ${ORG_UNIT_TYPE_LABELS[unitType].toLowerCase()} doit être rattaché`,
          `Rattachez-le à : ${allowed.map((a) => ORG_UNIT_TYPE_LABELS[a].toLowerCase()).join(' ou ')}.`,
        );
      }
      return;
    }
    if (allowed.length === 0) {
      problem(
        422,
        'org.direction_is_root',
        'Une direction ne se rattache à rien',
        'Les directions sont au sommet de l’organigramme.',
      );
    }
    if (selfId && parentId === selfId) {
      problem(422, 'org.cycle', 'Une unité ne peut pas être rattachée à elle-même');
    }
    const [parent] = await tx
      .select({ unitType: t.orgUnits.unitType, name: t.orgUnits.name })
      .from(t.orgUnits)
      .where(and(eq(t.orgUnits.id, parentId), isNull(t.orgUnits.deletedAt)))
      .limit(1);
    if (!parent) {
      problem(422, 'org.parent_not_found', "Cette unité n'existe pas");
    }
    if (!allowed.includes(parent.unitType as OrgUnitType)) {
      problem(
        422,
        'org.parent_type_invalid',
        `Un ${ORG_UNIT_TYPE_LABELS[unitType].toLowerCase()} ne peut pas relever d’un ${ORG_UNIT_TYPE_LABELS[parent.unitType as OrgUnitType].toLowerCase()}`,
        `« ${parent.name} » n’est pas un rattachement valide.`,
      );
    }
  }

  /** Changer le type d'une unité ne doit pas rendre ses enfants illégitimes. */
  private async assertChildrenAllowed(tx: Tx, id: string, nextType: OrgUnitType): Promise<void> {
    const children = await tx
      .select({ unitType: t.orgUnits.unitType, name: t.orgUnits.name })
      .from(t.orgUnits)
      .where(and(eq(t.orgUnits.parentId, id), isNull(t.orgUnits.deletedAt)));
    const faulty = children.filter(
      (c) => !ORG_UNIT_PARENT_TYPES[c.unitType as OrgUnitType].includes(nextType),
    );
    if (faulty.length > 0) {
      problem(
        422,
        'org.children_type_invalid',
        'Ce changement de type contredit les unités rattachées',
        `À rattacher ailleurs d’abord : ${faulty.map((c) => c.name).join(', ')}.`,
      );
    }
  }

  /**
   * Contrôle d'INVARIANT, joué APRÈS l'écriture : chaque employé cité qui
   * dirige une unité doit toujours travailler dedans (ou en dessous).
   *
   * Vérifier avant l'écriture demandait de simuler l'arbre futur — et c'est
   * précisément ce qui a laissé passer le re-rattachement : le sous-arbre lu
   * était encore l'ancien. On écrit, on relit l'état réel, et on annule la
   * transaction si l'invariant est rompu. La règle « un responsable travaille
   * dans l'unité qu'il dirige » porte sur le COUPLE (affectation, unité) : la
   * tenir seulement quand on mute l'employé laissait deux portes ouvertes —
   * dissoudre son unité, ou re-rattacher celle-ci ailleurs.
   */
  private async assertManagersStillInScope(tx: Tx, employeeIds: string[]): Promise<void> {
    if (employeeIds.length === 0) return;
    const rompus = await tx.execute<{ given_name: string; family_name: string; name: string }>(sql`
      WITH heads AS (
        SELECT o.id AS unit_id, o.name, o.manager_employee_id AS employee_id
        FROM org_units o
        WHERE o.manager_employee_id IN ${employeeIds} AND o.deleted_at IS NULL
      )
      SELECT p.given_name, p.family_name, h.name
      FROM heads h
      JOIN employees e ON e.id = h.employee_id
      JOIN persons p ON p.id = e.person_id
      WHERE NOT EXISTS (
        WITH RECURSIVE subtree AS (
          SELECT id FROM org_units WHERE id = h.unit_id AND deleted_at IS NULL
          UNION ALL
          SELECT o.id FROM org_units o
          JOIN subtree s ON o.parent_id = s.id
          WHERE o.deleted_at IS NULL
        )
        SELECT 1 FROM assignments a
        WHERE a.employee_id = h.employee_id
          AND a.validity @> CURRENT_DATE
          AND a.org_unit_id IN (SELECT id FROM subtree)
      )`);
    const [rompu] = rompus.rows;
    if (rompu) {
      problem(
        422,
        'org.manager_would_leave_unit',
        `${rompu.given_name} ${rompu.family_name} dirige « ${rompu.name} »`,
        'Ce changement le sortirait de son unité. Désignez d’abord un successeur.',
      );
    }
  }

  /**
   * Un responsable doit être un employé ACTIF, et travailler dans l'unité qu'il
   * dirige ou dans une unité en dessous. Sans quoi l'organigramme affiche un
   * chef parti ailleurs — ou licencié.
   */
  private async assertManagerEligible(tx: Tx, unitId: string, employeeId: string): Promise<void> {
    const [emp] = await tx
      .select({ id: t.employees.id, status: t.employees.status })
      .from(t.employees)
      .where(eq(t.employees.id, employeeId))
      .limit(1);
    if (!emp) {
      problem(422, 'org.manager_not_found', "Cet employé n'existe pas");
    }
    if (emp.status !== 'active') {
      problem(
        422,
        'org.manager_not_active',
        'Seul un employé actif peut diriger une unité',
        'Ce dossier est suspendu ou clos.',
      );
    }
    const inScope = await tx.execute(sql`
      WITH RECURSIVE subtree AS (
        SELECT id FROM org_units WHERE id = ${unitId} AND deleted_at IS NULL
        UNION ALL
        SELECT o.id FROM org_units o
        JOIN subtree s ON o.parent_id = s.id
        WHERE o.deleted_at IS NULL
      )
      SELECT 1 FROM assignments a
      WHERE a.employee_id = ${employeeId}
        AND a.validity @> CURRENT_DATE
        AND a.org_unit_id IN (SELECT id FROM subtree)
      LIMIT 1`);
    if (inScope.rows.length === 0) {
      problem(
        422,
        'org.manager_outside_unit',
        'Un responsable doit travailler dans l’unité qu’il dirige',
        'Affectez-le d’abord à cette unité (ou à une unité qui en dépend).',
      );
    }
  }

  /** Les personnes actuellement affectées à l'unité (annuaire interne). */
  async members(user: SessionUser, id: string): Promise<OrgUnitMember[]> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      await this.requireUnit(tx, id, 'org.unit_not_found');
      const rows = await tx
        .select({
          employeeId: t.employees.id,
          employeeNumber: t.employees.employeeNumber,
          givenName: t.persons.givenName,
          familyName: t.persons.familyName,
          positionTitle: t.assignments.positionTitle,
        })
        .from(t.assignments)
        .innerJoin(t.employees, eq(t.employees.id, t.assignments.employeeId))
        .innerJoin(t.persons, eq(t.persons.id, t.employees.personId))
        .where(
          and(
            eq(t.assignments.orgUnitId, id),
            sql`${t.assignments.validity} @> CURRENT_DATE`,
            eq(t.employees.status, 'active'),
          ),
        )
        .orderBy(asc(t.persons.familyName), asc(t.persons.givenName));
      return rows;
    });
  }

  /**
   * Qui peut diriger cette unité : les employés ACTIFS affectés à l'unité ou à
   * une unité en dessous. Exactement l'ensemble qu'accepte assertManagerEligible
   * — le formulaire ne doit pas proposer ce que le serveur refusera.
   */
  async eligibleManagers(user: SessionUser, id: string): Promise<OrgUnitMember[]> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      await this.requireUnit(tx, id, 'org.unit_not_found');
      const rows = await tx.execute<{
        employee_id: string;
        employee_number: string;
        given_name: string;
        family_name: string;
        position_title: string | null;
      }>(sql`
        WITH RECURSIVE subtree AS (
          SELECT id FROM org_units WHERE id = ${id} AND deleted_at IS NULL
          UNION ALL
          SELECT o.id FROM org_units o
          JOIN subtree s ON o.parent_id = s.id
          WHERE o.deleted_at IS NULL
        )
        SELECT e.id AS employee_id, e.employee_number, p.given_name, p.family_name,
               a.position_title
        FROM assignments a
        JOIN employees e ON e.id = a.employee_id
        JOIN persons p ON p.id = e.person_id
        WHERE a.org_unit_id IN (SELECT id FROM subtree)
          AND a.validity @> CURRENT_DATE
          AND e.status = 'active'
        ORDER BY p.family_name, p.given_name`);
      return rows.rows.map((r) => ({
        employeeId: r.employee_id,
        employeeNumber: r.employee_number,
        givenName: r.given_name,
        familyName: r.family_name,
        positionTitle: r.position_title,
      }));
    });
  }

  private async requireUnit(tx: Tx, id: string, code: string) {
    const [unit] = await tx
      .select({ id: t.orgUnits.id })
      .from(t.orgUnits)
      .where(and(eq(t.orgUnits.id, id), isNull(t.orgUnits.deletedAt)))
      .limit(1);
    if (!unit) {
      problem(code === 'org.parent_not_found' ? 422 : 404, code, "Cette unité n'existe pas");
    }
    return unit;
  }
}
