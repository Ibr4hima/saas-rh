import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type {
  ArchiveEmployeesInput,
  ChangementRattachement,
  ConsequencesHierarchie,
  EmployeeListPage,
  AssignmentView,
  CreateEmployeeInput,
  CursorPage,
  DeleteEmployeesInput,
  EmployeeBatchResult,
  EmployeeDetail,
  EmployeeHistoryEntry,
  EmployeeListItem,
  ListEmployeesQuery,
  MotifInactivite,
  NewAssignmentInput,
  NewContractInput,
  CorrigerAffectationInput,
  CorrigerContratInput,
  SessionUser,
  UpdateEmployeeInput,
} from '@teranga/contracts';
import { peut } from '@teranga/contracts';
import { EncryptionService } from '../../common/encryption.service';
import { problem, ProblemException } from '../../common/problem';
import * as t from '../../db/schema';
import { TenantDb, Tx } from '../../db/tenant-db';
import {
  appliquerReprise,
  DG,
  directionDeEmploye,
  directionDeLUnite,
  directionDeUnite,
  equipeDe,
  perimetre,
  n1DOffice,
  planifierReprise,
  rattacher,
  rattacherDOffice,
  reprendreEquipe,
  sortDuPerimetre,
  uniteRacine,
  validerRattachement,
  verrouillerLaChaine,
  type PlanDeReprise,
} from './chaine';
import { frDate } from '../acces/appels';
import { pasSurSoi } from '../acces/dch';
import { faireSuivreLesDemandes, reconcilierDemande, reconcilierLeCircuit } from '../time/visas';
import {
  arreterLActivite,
  inactiverLesContratsEchus,
  jourDeReprise,
  reprendreLActivite,
} from './activite';
import { dernierContrat, exigerEnActivite, finDeContratPassee } from './en-activite';
import { lireLaChaine, nouvellesAnomalies } from './hierarchie.service';

/** Rôles autorisés à lire les champs ultra-sensibles (CNI). */

function ctxOf(user: SessionUser): { tenantId: string; userId: string } {
  return { tenantId: user.tenantId, userId: user.userId };
}

function pgCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code ?? e?.cause?.code;
}

/** Une ligne du SQL de liste, en snake_case comme la base la rend. */
interface LigneListe extends Record<string, unknown> {
  id: string;
  employee_number: string;
  given_name: string;
  family_name: string;
  status: string;
  hired_on: string;
  work_email: string | null;
  created_at: Date;
  position_title: string | null;
  org_unit_name: string | null;
  direction_short_name: string | null;
  direction_name: string | null;
  contract_start_date: string | null;
  contract_end_date: string | null;
  manager_employee_id: string | null;
  manager_name: string | null;
  manager_number: string | null;
  team_size: number;
  unite: string | null;
  inactivite_motif: string | null;
  archived_at: string | null;
}

interface Cursor {
  createdAt: string;
  id: string;
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}

function decodeCursor(raw: string): Cursor {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Cursor;
    if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string') throw new Error();
    return parsed;
  } catch {
    problem(400, 'pagination.invalid_cursor', 'Curseur de pagination invalide');
  }
}

@Injectable()
export class PeopleService {
  private readonly logger = new Logger(PeopleService.name);

  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(EncryptionService) private readonly crypto: EncryptionService,
  ) {}

  /**
   * La liste du personnel : recherche, onglet, filtres, tri, page.
   *
   * Écrite en SQL plutôt qu'au constructeur de requêtes, pour une raison
   * précise : trois des colonnes affichées sont calculées — la direction se
   * trouve en REMONTANT l'arbre des unités, le contrat est le plus récent des
   * contrats — et l'on doit pouvoir FILTRER et TRIER dessus. En SQL, un alias
   * ne se réutilise pas dans le WHERE de la même requête ; il faudrait donc
   * répéter chaque sous-requête à chaque endroit où elle sert. Une CTE la
   * nomme une fois, et tout le reste — filtres, tri, effectifs, valeurs des
   * listes déroulantes — s'appuie dessus.
   */
  async list(user: SessionUser, query: ListEmployeesQuery): Promise<EmployeeListPage> {
    // Les contrats arrivés à terme passent d'abord dans les inactifs : la
    // liste se lit juste. Dans sa propre transaction, et sans bloquer : un
    // échec ici ne doit pas priver la DCH de la liste.
    try {
      await this.db.withTenant(ctxOf(user), (tx) => inactiverLesContratsEchus(tx, user.tenantId));
    } catch (err) {
      this.logger.error(
        `Fin des contrats échus impossible (tenant ${user.tenantId}) : la liste est servie sans elle.`,
        err instanceof Error ? err.stack : String(err),
      );
    }
    return this.db.withTenant(ctxOf(user), async (tx) => {
      // Chaque mot cherché doit se trouver dans le prénom, le nom ou le
      // matricule, dans n'importe quel ordre : « Awa Diop » comme « Diop Awa ».
      const mots = (query.q ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 6);
      const recherche =
        mots.length === 0
          ? sql`TRUE`
          : sql.join(
              mots.map((mot) => {
                const motif = `%${mot.replace(/[\\%_]/g, '\\$&')}%`;
                return sql`(sans_accents(p.given_name) LIKE sans_accents(${motif})
                         OR sans_accents(p.family_name) LIKE sans_accents(${motif})
                         OR sans_accents(e.employee_number) LIKE sans_accents(${motif}))`;
              }),
              sql` AND `,
            );

      /**
       * Le socle : une ligne par agent, colonnes affichées comprises. La
       * recherche y est appliquée tout de suite — elle vaut pour la page, pour
       * les effectifs des onglets ET pour les listes déroulantes.
       */
      const socle = sql`
        WITH socle AS (
          SELECT
            e.id,
            e.employee_number,
            p.given_name,
            p.family_name,
            e.status,
            e.inactivite_motif,
            e.archived_at::text         AS archived_at,
            e.hired_on::text            AS hired_on,
            e.work_email,
            e.created_at,
            a.position_title,
            o.name                      AS org_unit_name,
            ${directionDeLUnite(sql`a.org_unit_id`, 'short_name')} AS direction_short_name,
            ${directionDeLUnite(sql`a.org_unit_id`, 'name')}       AS direction_name,
            (SELECT c.start_date::text FROM contracts c
              WHERE c.employee_id = e.id ORDER BY c.start_date DESC LIMIT 1)
                                        AS contract_start_date,
            -- Inactif : son dernier jour d'activité — la fin de son contrat, ou
            -- le jour où il est parti.
            COALESCE(CASE WHEN e.status = 'archived' THEN e.fin_activite::text END,
                     (SELECT c.end_date::text FROM contracts c
                       WHERE c.employee_id = e.id ORDER BY c.start_date DESC LIMIT 1))
                                        AS contract_end_date,
            e.manager_employee_id,
            (SELECT mp.given_name || ' ' || mp.family_name
               FROM employees me JOIN persons mp ON mp.id = me.person_id
              WHERE me.id = e.manager_employee_id)
                                        AS manager_name,
            -- Le matricule du n+1 : c'est LUI que la liste affiche, un nom
            -- pouvant être porté par deux agents.
            (SELECT me.employee_number FROM employees me
              WHERE me.id = e.manager_employee_id)
                                        AS manager_number,
            -- Ses agents directs actifs : qui part avec une équipe la confie.
            -- Le DG n'est de l'équipe de personne, même par une donnée ancienne.
            (SELECT count(*)::int FROM employees s
              WHERE s.manager_employee_id = e.id AND s.status = 'active'
                AND s.id IS DISTINCT FROM ${DG})
                                        AS team_size
          FROM employees e
          JOIN persons p ON p.id = e.person_id
          -- L'affectation qui fait foi — en cours, sinon la prochaine : un
          -- agent qui n'a pas encore pris son poste est déjà de sa direction,
          -- comme partout ailleurs dans la chaîne.
          LEFT JOIN assignments a
            ON a.id = (SELECT av.id FROM assignments av
                        WHERE av.employee_id = e.id
                          AND (av.validity @> CURRENT_DATE OR lower(av.validity) > CURRENT_DATE)
                        ORDER BY lower(av.validity) LIMIT 1)
          LEFT JOIN org_units o ON o.id = a.org_unit_id
          WHERE ${recherche}
        ),
        -- L'unité TELLE QU'ELLE S'AFFICHE : la colonne montre l'abrégé de la
        -- direction, et un filtre qui porterait sur autre chose ne
        -- correspondrait pas à ce qu'on lit.
        vue AS (
          SELECT socle.*,
                 COALESCE(direction_short_name, direction_name, org_unit_name) AS unite
          FROM socle
        )`;

      const filtres = [
        query.status ? sql`status = ${query.status}` : null,
        query.positionTitle ? sql`position_title = ${query.positionTitle}` : null,
        query.managerId ? sql`manager_employee_id = ${query.managerId}` : null,
        query.unit
          ? sql`unite IN (${sql.join(
              query.unit.map((u) => sql`${u}`),
              sql`, `,
            )})`
          : null,
      ].filter((c): c is NonNullable<typeof c> => c !== null);
      const ou = filtres.length > 0 ? sql`WHERE ${sql.join(filtres, sql` AND `)}` : sql``;

      // NULLS LAST dans les deux sens : un contrat sans date de fin n'est pas
      // « le plus ancien », il est absent — sa place est en bas de la pile.
      const sens = query.dir === 'asc' ? sql`ASC` : sql`DESC`;
      const ordre = {
        recent: sql`created_at ${sens}, id ${sens}`,
        name: sql`family_name ${sens}, given_name ${sens}, id ASC`,
        contractStart: sql`contract_start_date ${sens} NULLS LAST, family_name ASC`,
        contractEnd: sql`contract_end_date ${sens} NULLS LAST, family_name ASC`,
      }[query.sort];

      const lignes = await tx.execute<LigneListe>(sql`
        ${socle}
        SELECT * FROM vue ${ou}
        ORDER BY ${ordre}
        LIMIT ${query.limit + 1} OFFSET ${query.offset}
      `);
      const trop = lignes.rows.length > query.limit;
      const page = trop ? lignes.rows.slice(0, query.limit) : lignes.rows;

      // Le total de CETTE requête-là, filtres compris : c'est le nombre de
      // pages. Une requête de plus, sur la même vue — `count(*) OVER ()`
      // l'aurait donnée avec les lignes, mais serait revenue vide sur une
      // page au-delà de la fin, précisément le cas où la pagination a besoin
      // de savoir combien de pages il reste.
      const totalRows = await tx.execute<{ n: string }>(sql`
        ${socle}
        SELECT count(*)::text AS n FROM vue ${ou}
      `);

      // Les effectifs ignorent l'onglet — c'est leur raison d'être : dire
      // combien il y en a DE L'AUTRE CÔTÉ.
      const effectifs = await tx.execute<{ status: string; n: string }>(sql`
        ${socle}
        SELECT status, count(*)::text AS n FROM vue GROUP BY status
      `);
      const compte = (s: string) => Number(effectifs.rows.find((r) => r.status === s)?.n ?? 0);

      // Les valeurs proposées suivent l'onglet, pas les autres filtres : sinon
      // choisir un poste viderait la liste des managers, et l'on ne pourrait
      // plus revenir en arrière sans tout défaire.
      const cadre = query.status ? sql` AND status = ${query.status}` : sql``;
      const facettes = await tx.execute<{
        kind: string;
        value: string;
        label: string;
      }>(sql`
        ${socle}
        SELECT 'position' AS kind, position_title AS value, position_title AS label
          FROM vue WHERE position_title IS NOT NULL ${cadre}
        UNION
        SELECT 'unit', unite, unite
          FROM vue WHERE unite IS NOT NULL ${cadre}
        UNION
        SELECT 'manager', manager_employee_id::text,
               manager_name || ' (' || manager_number || ')'
          FROM vue WHERE manager_employee_id IS NOT NULL ${cadre}
        ORDER BY 3
      `);

      return {
        items: page.map((r) => ({
          id: r.id,
          employeeNumber: r.employee_number,
          givenName: r.given_name,
          familyName: r.family_name,
          status: r.status,
          hiredOn: r.hired_on,
          workEmail: r.work_email,
          positionTitle: r.position_title,
          orgUnitName: r.org_unit_name,
          directionShortName: r.direction_short_name,
          directionName: r.direction_name,
          contractStartDate: r.contract_start_date,
          contractEndDate: r.contract_end_date,
          managerId: r.manager_employee_id,
          managerName: r.manager_name,
          managerNumber: r.manager_number,
          teamSize: Number(r.team_size ?? 0),
          inactiviteMotif: (r.inactivite_motif as MotifInactivite | null) ?? null,
          archivedAt: r.archived_at ? new Date(r.archived_at).toISOString() : null,
        })),
        nextOffset: trop ? query.offset + query.limit : null,
        total: Number(totalRows.rows[0]?.n ?? 0),
        counts: { active: compte('active'), archived: compte('archived') },
        facets: {
          positions: facettes.rows.filter((f) => f.kind === 'position').map((f) => f.value),
          units: facettes.rows.filter((f) => f.kind === 'unit').map((f) => f.value),
          managers: facettes.rows
            .filter((f) => f.kind === 'manager')
            .map((f) => ({ id: f.value, name: f.label })),
        },
      };
    });
  }

  /**
   * Un dossier neuf.
   *
   * Le responsable hiérarchique n'est PAS exigé ici, et c'est un choix : on
   * crée souvent un dossier avant de savoir de qui l'agent relèvera, et un
   * import n'en sait rien du tout. Sans n+1 choisi, l'agent relève d'office du
   * responsable de sa direction s'il y en a un ; sinon, la règle de l'APIX —
   * un n+1 pour chacun — se tient par un AVERTISSEMENT (le contrôle de la
   * chaîne hiérarchique) et par une conséquence : sans n+1, ni objectifs ni
   * évaluation.
   *
   * Ce qui est vérifié, en revanche, c'est le rattachement QUAND il est
   * donné : même direction, responsable actif, pas de boucle.
   */
  async create(user: SessionUser, input: CreateEmployeeInput): Promise<{ id: string }> {
    const employeeId = uuidv7();
    const personId = uuidv7();

    try {
      await this.db.withTenant(ctxOf(user), async (tx) => {
        await verrouillerLaChaine(tx);
        if (input.assignment?.orgUnitId) {
          await this.requireLiveOrgUnit(tx, input.assignment.orgUnitId);
        }
        const { nationalId, ...person } = input.person;
        await tx.insert(t.persons).values({
          id: personId,
          tenantId: user.tenantId,
          ...person,
          nationalIdEncrypted: nationalId ? this.crypto.encrypt(nationalId) : null,
        });
        if (input.employee.managerEmployeeId) {
          await validerRattachement(
            tx,
            employeeId,
            input.employee.managerEmployeeId,
            await directionDeUnite(tx, input.assignment?.orgUnitId ?? null),
          );
        }
        await tx.insert(t.employees).values({
          id: employeeId,
          tenantId: user.tenantId,
          personId,
          // En capitales même quand l'appel ne passe pas par le schéma (import).
          employeeNumber: input.employee.employeeNumber.trim().toUpperCase(),
          hiredOn: input.employee.hiredOn,
          workEmail: input.employee.workEmail,
          workPhone: input.employee.workPhone,
          managerEmployeeId: input.employee.managerEmployeeId ?? null,
          customFields: input.employee.customFields ?? {},
        });
        if (input.contract) {
          await tx.insert(t.contracts).values({
            id: uuidv7(),
            tenantId: user.tenantId,
            employeeId,
            contractType: input.contract.contractType,
            startDate: input.contract.startDate,
            endDate: input.contract.endDate,
            trialPeriodEnd: input.contract.trialPeriodEnd,
            notes: input.contract.notes,
          });
        }
        if (input.assignment) {
          await tx.insert(t.assignments).values({
            id: uuidv7(),
            tenantId: user.tenantId,
            employeeId,
            orgUnitId: input.assignment.orgUnitId,
            positionTitle: input.assignment.positionTitle,
            validity: `[${input.assignment.startDate},)`,
          });
        }
        // Sans n+1 choisi, il relève d'office du responsable de sa direction.
        if (!input.employee.managerEmployeeId) await rattacherDOffice(tx, [], employeeId);
      });
    } catch (err) {
      if (pgCode(err) === '23505') {
        problem(409, 'people.employee_number_taken', 'Ce matricule est déjà utilisé');
      }
      throw err;
    }
    return { id: employeeId };
  }

  async detail(user: SessionUser, id: string): Promise<EmployeeDetail> {
    return this.db.withTenant(ctxOf(user), async (tx) => {
      const employee = await this.requireEmployee(tx, id);
      const [person] = await tx
        .select()
        .from(t.persons)
        .where(eq(t.persons.id, employee.personId))
        .limit(1);
      if (!person) {
        problem(500, 'people.person_missing', 'Dossier incohérent : personne absente');
      }

      // Périmètre : qui consulte les dossiers voit tout ; les autres, le leur.
      const isManage = peut(user, 'personnel.consulter');
      const isSelf = person.userId === user.userId;
      if (!isManage && !isSelf) {
        problem(403, 'people.forbidden_scope', 'Accès limité à votre propre dossier');
      }

      const assignmentRows = await tx
        .select({
          id: t.assignments.id,
          positionTitle: t.assignments.positionTitle,
          orgUnitId: t.assignments.orgUnitId,
          orgUnitName: t.orgUnits.name,
          // La direction ne se lit pas sur l'unité : il faut REMONTER l'arbre
          // jusqu'au premier ancêtre de type « direction ». Même remontée que
          // dans la liste du personnel, où la colonne « Unité » affiche déjà
          // l'abrégé.
          directionShortName: sql<
            string | null
          >`${directionDeLUnite(sql`${t.assignments.orgUnitId}`, 'short_name')}`,
          directionName: sql<
            string | null
          >`${directionDeLUnite(sql`${t.assignments.orgUnitId}`, 'name')}`,
          validity: t.assignments.validity,
          current: sql<boolean>`${t.assignments.validity} @> CURRENT_DATE`,
          validFrom: sql<string>`lower(${t.assignments.validity})::text`,
          validTo: sql<string | null>`CASE WHEN upper_inf(${t.assignments.validity})
            THEN NULL ELSE upper(${t.assignments.validity})::text END`,
        })
        .from(t.assignments)
        .leftJoin(t.orgUnits, eq(t.orgUnits.id, t.assignments.orgUnitId))
        .where(eq(t.assignments.employeeId, id))
        .orderBy(desc(sql`lower(${t.assignments.validity})`));

      const contractRows = await tx
        .select()
        .from(t.contracts)
        .where(eq(t.contracts.employeeId, id))
        .orderBy(desc(t.contracts.startDate));

      const [managerRow] = employee.managerEmployeeId
        ? await tx
            .select({ givenName: t.persons.givenName, familyName: t.persons.familyName })
            .from(t.employees)
            .innerJoin(t.persons, eq(t.persons.id, t.employees.personId))
            .where(eq(t.employees.id, employee.managerEmployeeId))
            .limit(1)
        : [];
      const team = await equipeDe(tx, employee.id);
      const { rows: interruptions } = await tx.execute<{
        dernierJour: string;
        repriseLe: string;
      }>(sql`
        SELECT dernier_jour::text AS "dernierJour", reprise_le::text AS "repriseLe"
          FROM periodes_inactivite
         WHERE employee_id = ${employee.id} AND reprise_le IS NOT NULL
         ORDER BY dernier_jour`);
      const repriseParDefaut =
        employee.status === 'archived' && employee.finActivite
          ? ((
              await tx.execute<{ le: string }>(
                sql`SELECT ${jourDeReprise(employee.id, null)}::text AS le`,
              )
            ).rows[0]?.le ?? null)
          : null;

      const canSeeSensitive = peut(user, 'personnel.sensible') || isSelf;
      return {
        id: employee.id,
        soi: isSelf,
        employeeNumber: employee.employeeNumber,
        status: employee.status,
        archivedAt: employee.archivedAt?.toISOString() ?? null,
        inactiviteMotif: (employee.inactiviteMotif as MotifInactivite | null) ?? null,
        finActivite: employee.finActivite ?? null,
        interruptions,
        repriseParDefaut,
        hiredOn: employee.hiredOn,
        workEmail: employee.workEmail,
        workPhone: employee.workPhone,
        managerId: employee.managerEmployeeId,
        managerName: managerRow ? `${managerRow.givenName} ${managerRow.familyName}` : null,
        team,
        customFields: (employee.customFields ?? {}) as Record<string, unknown>,
        person: {
          id: person.id,
          givenName: person.givenName,
          familyName: person.familyName,
          gender: person.gender,
          birthDate: person.birthDate,
          birthPlace: person.birthPlace,
          maritalStatus: person.maritalStatus,
          nationality: person.nationality,
          nationalId:
            canSeeSensitive && person.nationalIdEncrypted
              ? this.crypto.decrypt(person.nationalIdEncrypted)
              : null,
          idDocumentType: person.idDocumentType,
          idDocumentIssuedOn: person.idDocumentIssuedOn,
          idDocumentExpiresOn: person.idDocumentExpiresOn,
          personalEmail: person.personalEmail,
          phone: person.phone,
          addressLine: person.addressLine,
          emergencyContactName: person.emergencyContactName,
          emergencyContactPhone: person.emergencyContactPhone,
        },
        assignments: assignmentRows.map((a): AssignmentView => ({
          id: a.id,
          positionTitle: a.positionTitle,
          orgUnitId: a.orgUnitId,
          orgUnitName: a.orgUnitName,
          directionShortName: a.directionShortName,
          directionName: a.directionName,
          validFrom: a.validFrom,
          validTo: a.validTo,
          current: a.current,
        })),
        contracts: contractRows.map((c) => ({
          id: c.id,
          contractType: c.contractType,
          startDate: c.startDate,
          endDate: c.endDate,
          trialPeriodEnd: c.trialPeriodEnd,
          notes: c.notes,
        })),
        portal: await this.portalStatus(tx, user.tenantId, person.id, person.userId),
      };
    });
  }

  /** Statut d'accès au portail : compte actif, invitation en cours, ou rien. */
  private async portalStatus(
    tx: Tx,
    tenantId: string,
    personId: string,
    personUserId: string | null,
  ): Promise<{ status: 'none' | 'invited' | 'active' | 'coupe'; role: string | null }> {
    if (personUserId) {
      const [membership] = await tx
        .select({
          role: t.userTenantMemberships.role,
          accesCoupeLe: t.userTenantMemberships.accesCoupeLe,
        })
        .from(t.userTenantMemberships)
        .where(
          and(
            eq(t.userTenantMemberships.userId, personUserId),
            eq(t.userTenantMemberships.tenantId, tenantId),
          ),
        )
        .limit(1);
      return {
        status: membership?.accesCoupeLe ? 'coupe' : 'active',
        role: membership?.role ?? null,
      };
    }
    const [pending] = await tx
      .select({ role: t.invitations.role })
      .from(t.invitations)
      .where(
        and(
          eq(t.invitations.personId, personId),
          isNull(t.invitations.acceptedAt),
          gt(t.invitations.expiresAt, new Date()),
        ),
      )
      .limit(1);
    return pending ? { status: 'invited', role: pending.role } : { status: 'none', role: null };
  }

  async update(user: SessionUser, id: string, input: UpdateEmployeeInput): Promise<void> {
    try {
      await this.db.withTenant(ctxOf(user), async (tx) => {
        const employee = await this.requireEmployee(tx, id);
        await pasSurSoi(tx, user.userId, [id], 'modifier votre dossier');
        if (employee.status !== 'active') {
          problem(
            422,
            'people.dossier_inactif',
            'Ce dossier est inactif',
            'La fiche d’un agent inactif ne se modifie pas : réactivez-la d’abord.',
          );
        }
        if (input.employee?.managerEmployeeId !== undefined) await verrouillerLaChaine(tx);

        if (input.person && Object.keys(input.person).length > 0) {
          const { nationalId, ...rest } = input.person;
          await tx
            .update(t.persons)
            .set({
              ...rest,
              ...(nationalId !== undefined
                ? { nationalIdEncrypted: nationalId ? this.crypto.encrypt(nationalId) : null }
                : {}),
            })
            .where(eq(t.persons.id, employee.personId));
        }
        if (input.employee && Object.keys(input.employee).length > 0) {
          if (input.employee.managerEmployeeId) {
            await exigerEnActivite(tx, id, 'recevoir de n+1');
            await validerRattachement(
              tx,
              id,
              input.employee.managerEmployeeId,
              await directionDeEmploye(tx, id),
            );
          }
          // Les colonnes sont nommées une à une, jamais l'objet reçu en bloc.
          // Le schéma Zod ne laisse déjà rien passer d'autre, mais il ne
          // s'applique qu'à la frontière HTTP : un appel interne écrirait le
          // statut sans révoquer une seule session, et le dossier serait
          // archivé avec son portail grand ouvert.
          const champs: Partial<typeof t.employees.$inferInsert> = {};
          const e = input.employee;
          if (e.employeeNumber !== undefined) {
            champs.employeeNumber = e.employeeNumber.trim().toUpperCase();
          }
          if (e.hiredOn !== undefined) champs.hiredOn = e.hiredOn;
          if (e.workEmail !== undefined) champs.workEmail = e.workEmail;
          if (e.workPhone !== undefined) champs.workPhone = e.workPhone;
          if (e.managerEmployeeId !== undefined) champs.managerEmployeeId = e.managerEmployeeId;
          if (Object.keys(champs).length > 0) {
            champs.updatedAt = new Date();
            await tx.update(t.employees).set(champs).where(eq(t.employees.id, id));
          }
          // Vidé, le n+1 revient d'office au responsable de sa direction,
          // s'il en a un : dans une direction pourvue, personne n'est sans n+1.
          if (e.managerEmployeeId === null) await rattacherDOffice(tx, [], id);
          // Un nouveau n+1 reprend les demandes de congé qui attendaient
          // le visa de l'ancien.
          if (
            e.managerEmployeeId !== undefined &&
            e.managerEmployeeId !== employee.managerEmployeeId
          ) {
            await faireSuivreLesDemandes(tx, id);
          }
        }
      });
    } catch (err) {
      if (pgCode(err) === '23505') {
        problem(409, 'people.employee_number_taken', 'Ce matricule est déjà utilisé');
      }
      throw err;
    }
  }

  /**
   * Un nouveau contrat : un CDD renouvelé, un stage suivi d'un CDD, un CDI.
   * Il commence après le précédent ; celui-ci, s'il courait encore, s'arrête
   * la veille. Possible sur un dossier inactif : c'est ce qui permet de le
   * réactiver quand le contrat reprend.
   */
  async newContract(
    user: SessionUser,
    id: string,
    input: NewContractInput,
  ): Promise<{ id: string }> {
    return this.db.withTenant(ctxOf(user), async (tx) => {
      await this.requireEmployee(tx, id);
      await pasSurSoi(tx, user.userId, [id], 'modifier votre propre contrat');
      const [precedent] = await tx
        .select({
          id: t.contracts.id,
          startDate: t.contracts.startDate,
          endDate: t.contracts.endDate,
        })
        .from(t.contracts)
        .where(eq(t.contracts.employeeId, id))
        .orderBy(desc(t.contracts.startDate), desc(t.contracts.createdAt))
        .limit(1);
      if (precedent && input.startDate <= precedent.startDate) {
        problem(
          422,
          'people.contrat_avant_le_precedent',
          'Le nouveau contrat doit commencer après le précédent',
          `Le contrat en place a commencé le ${frDate(precedent.startDate)}.`,
        );
      }
      if (precedent && (precedent.endDate === null || precedent.endDate >= input.startDate)) {
        await tx
          .update(t.contracts)
          .set({ endDate: sql`${input.startDate}::date - 1`, updatedAt: new Date() })
          .where(eq(t.contracts.id, precedent.id));
      }
      // Renouvelé, le précédent ne « prend plus fin » : ses alertes s'en vont.
      if (precedent) {
        await tx.execute(sql`
          DELETE FROM notifications WHERE dedupe_key LIKE ${`contract_deadline:${precedent.id}%`}`);
      }
      const contractId = uuidv7();
      await tx.insert(t.contracts).values({
        id: contractId,
        tenantId: user.tenantId,
        employeeId: id,
        contractType: input.contractType,
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        trialPeriodEnd: input.trialPeriodEnd ?? null,
        notes: input.notes ?? null,
      });
      return { id: contractId };
    });
  }

  /**
   * Corriger le dernier contrat, saisi par erreur : un CDD saisi à un mois au
   * lieu de douze, un stage pour un CDD. Les règles d'un nouveau contrat
   * valent : il commence après le précédent, qui s'arrêtait la veille de son
   * début et s'y recale. Si la fin erronée avait déjà fait passer l'agent dans
   * les inactifs et que le contrat corrigé court encore, son dossier se
   * rouvre ; si la fin corrigée est passée, il y passe.
   */
  async corrigerContrat(
    user: SessionUser,
    id: string,
    contratId: string,
    input: CorrigerContratInput,
  ): Promise<{ rouvert: boolean }> {
    const rouvrir = await this.db.withTenant(ctxOf(user), async (tx) => {
      await this.requireEmployee(tx, id);
      await pasSurSoi(tx, user.userId, [id], 'modifier votre propre contrat');
      const contrats = await tx
        .select({
          id: t.contracts.id,
          startDate: t.contracts.startDate,
          endDate: t.contracts.endDate,
        })
        .from(t.contracts)
        .where(eq(t.contracts.employeeId, id))
        .orderBy(desc(t.contracts.startDate), desc(t.contracts.createdAt))
        .for('update');
      const [dernier, precedent] = contrats;
      if (!dernier || dernier.id !== contratId) {
        problem(
          422,
          'people.contrat_pas_le_dernier',
          'Seul le dernier contrat se corrige',
          'Les contrats précédents sont clos : enregistrez plutôt un nouveau contrat.',
        );
      }
      if (precedent && input.startDate <= precedent.startDate) {
        problem(
          422,
          'people.contrat_avant_le_precedent',
          'Le contrat doit commencer après le précédent',
          `Le contrat précédent a commencé le ${frDate(precedent.startDate)}.`,
        );
      }
      // Le précédent s'arrêtait la veille de ce contrat : il suit son début.
      if (precedent && precedent.endDate && input.startDate !== dernier.startDate) {
        const { rows } = await tx.execute<{ veille: boolean }>(sql`
          SELECT ${precedent.endDate}::date = ${dernier.startDate}::date - 1 AS veille`);
        if (rows[0]?.veille) {
          await tx
            .update(t.contracts)
            .set({ endDate: sql`${input.startDate}::date - 1`, updatedAt: new Date() })
            .where(eq(t.contracts.id, precedent.id));
        }
      }
      await tx
        .update(t.contracts)
        .set({
          contractType: input.contractType,
          startDate: input.startDate,
          endDate: input.endDate ?? null,
          trialPeriodEnd: input.trialPeriodEnd ?? null,
          notes: input.notes ?? null,
          updatedAt: new Date(),
        })
        .where(eq(t.contracts.id, contratId));
      // Les alertes d'échéance parlaient de l'ancienne date de fin.
      await tx.execute(sql`
        DELETE FROM notifications
         WHERE dedupe_key LIKE ${`contract_deadline:${contratId}%`}
            OR dedupe_key = ${`contrat_termine:${contratId}`}`);

      // Passé dans les inactifs par cette fin erronée, et le contrat court
      // encore : le dossier se rouvre (hors de cette transaction, par le même
      // chemin qu'une réactivation).
      const { rows } = await tx.execute<{ rouvrir: boolean }>(sql`
        SELECT e.status = 'archived' AND e.inactivite_motif = 'fin_de_contrat'
               AND e.fin_activite = ${dernier.endDate}::date
               AND (${input.endDate ?? null}::date IS NULL OR ${input.endDate ?? null}::date >= CURRENT_DATE)
               AS rouvrir
          FROM employees e WHERE e.id = ${id}`);
      // Une fin corrigée déjà passée : il passe dans les inactifs.
      await inactiverLesContratsEchus(tx, user.tenantId);
      return Boolean(rows[0]?.rouvrir);
    });
    if (!rouvrir) return { rouvert: false };
    const r = await this.archive(user, { ids: [id], archived: false });
    return { rouvert: r.done === 1 };
  }

  /** L'affectation en cours ou à venir la plus récente, et celle qu'elle a suivie. */
  private async dernieresAffectations(tx: Tx, id: string) {
    const lignes = await tx
      .select({
        id: t.assignments.id,
        du: sql<string>`lower(${t.assignments.validity})::text`,
        au: sql<string | null>`upper(${t.assignments.validity})::text`,
      })
      .from(t.assignments)
      .where(eq(t.assignments.employeeId, id))
      .orderBy(sql`lower(${t.assignments.validity}) DESC`)
      .limit(2)
      .for('update');
    return { derniere: lignes[0], precedente: lignes[1] };
  }

  /**
   * Corriger la dernière affectation, saisie par erreur : l'intitulé du
   * poste, la date de début. L'affectation précédente, qui s'arrêtait à son
   * début, s'y recale. L'unité ne se corrige pas ici : une affectation dans
   * la mauvaise unité s'annule, puis se ressaisit avec ses règles.
   */
  async corrigerAffectation(
    user: SessionUser,
    id: string,
    affectationId: string,
    input: CorrigerAffectationInput,
  ): Promise<void> {
    await this.db.withTenant(ctxOf(user), async (tx) => {
      await this.requireEmployee(tx, id);
      await pasSurSoi(tx, user.userId, [id], 'changer votre propre affectation');
      const { derniere, precedente } = await this.dernieresAffectations(tx, id);
      if (!derniere || derniere.id !== affectationId) {
        problem(
          422,
          'people.affectation_pas_la_derniere',
          'Seule la dernière affectation se corrige',
          'Les affectations précédentes font l’historique du dossier.',
        );
      }
      if (precedente && input.startDate <= precedente.du) {
        problem(
          422,
          'people.assignment_start_too_early',
          "L'affectation doit démarrer après le début de la précédente",
          `L’affectation précédente a commencé le ${frDate(precedente.du)}.`,
        );
      }
      if (derniere.au && input.startDate >= derniere.au) {
        problem(
          422,
          'people.affectation_apres_sa_fin',
          'L’affectation commencerait après sa fin',
          `Elle s’est arrêtée le ${frDate(derniere.au)}.`,
        );
      }
      const recaler = precedente && precedente.au === derniere.du;
      // L'ordre évite le chevauchement : on libère d'abord la place.
      if (recaler && input.startDate < derniere.du) {
        await tx.execute(sql`
          UPDATE assignments SET validity = daterange(lower(validity), ${input.startDate}::date)
           WHERE id = ${precedente.id}`);
      }
      await tx.execute(sql`
        UPDATE assignments
           SET validity = daterange(${input.startDate}::date, upper(validity)),
               position_title = ${input.positionTitle}
         WHERE id = ${derniere.id}`);
      if (recaler && input.startDate > derniere.du) {
        await tx.execute(sql`
          UPDATE assignments SET validity = daterange(lower(validity), ${input.startDate}::date)
           WHERE id = ${precedente.id}`);
      }
    });
  }

  /**
   * Annuler la dernière affectation, saisie par erreur : une mutation vers
   * la mauvaise unité. L'affectation qu'elle avait close reprend, comme si
   * la mutation n'avait pas eu lieu. Ce que la chaîne hiérarchique en garde
   * à revoir se dit tout de suite.
   */
  async annulerAffectation(
    user: SessionUser,
    id: string,
    affectationId: string,
  ): Promise<ConsequencesHierarchie> {
    return this.db.withTenant(ctxOf(user), async (tx) => {
      await this.requireEmployee(tx, id);
      await pasSurSoi(tx, user.userId, [id], 'changer votre propre affectation');
      await verrouillerLaChaine(tx);
      const avant = await lireLaChaine(tx);
      const { derniere, precedente } = await this.dernieresAffectations(tx, id);
      if (!derniere || derniere.id !== affectationId) {
        problem(
          422,
          'people.affectation_pas_la_derniere',
          'Seule la dernière affectation s’annule',
          'Les affectations précédentes font l’historique du dossier.',
        );
      }
      if (!precedente || precedente.au !== derniere.du) {
        problem(
          422,
          'people.affectation_seule',
          'Aucune affectation à laquelle revenir',
          'Corrigez plutôt son poste ou sa date : l’agent resterait sans affectation.',
        );
      }
      await tx.delete(t.assignments).where(eq(t.assignments.id, derniere.id));
      await tx.execute(sql`
        UPDATE assignments SET validity = daterange(lower(validity), ${derniere.au}::date)
         WHERE id = ${precedente.id}`);
      await this.faireSuivre(tx, user.tenantId, []);
      return { changements: [], aRevoir: nouvellesAnomalies(avant, await lireLaChaine(tx)) };
    });
  }

  /**
   * Une affectation ne peut viser qu'une unité VIVANTE. Seule la clé étrangère
   * protégeait : elle accepte une unité dissoute, ce qui annulait la garantie
   * de la dissolution (les membres réaffectés y revenaient aussitôt).
   */
  private async requireLiveOrgUnit(tx: Tx, orgUnitId: string): Promise<void> {
    const [unit] = await tx
      .select({ id: t.orgUnits.id })
      .from(t.orgUnits)
      .where(and(eq(t.orgUnits.id, orgUnitId), isNull(t.orgUnits.deletedAt)))
      .limit(1);
    if (!unit) {
      problem(
        422,
        'people.org_unit_not_found',
        'Cette unité n’existe pas ou a été dissoute',
        'Choisissez une unité de l’organigramme actuel.',
      );
    }
  }

  /**
   * Nouvelle affectation effective-dated (ADR-0003) : clôt l'affectation
   * courante à startDate (borne exclusive) et ouvre la nouvelle [startDate,).
   * Jamais d'UPDATE destructif : l'historique reste intégralement lisible.
   *
   * La chaîne hiérarchique doit y survivre, et les refus viennent dans
   * l'ordre où l'on corrige : d'abord qui dirige quoi (le DG, un responsable
   * d'unité), puis la date, puis l'équipe, puis son propre n+1.
   */
  async newAssignment(
    user: SessionUser,
    id: string,
    input: NewAssignmentInput,
  ): Promise<ConsequencesHierarchie> {
    let resultat: ConsequencesHierarchie = { changements: [], aRevoir: [] };
    try {
      await this.db.withTenant(ctxOf(user), async (tx) => {
        await pasSurSoi(tx, user.userId, [id], 'changer votre propre affectation');
        await exigerEnActivite(tx, id, 'recevoir d’affectation');
        await verrouillerLaChaine(tx);
        const [dossier] = await tx
          .select({ managerId: t.employees.managerEmployeeId })
          .from(t.employees)
          .where(eq(t.employees.id, id))
          .limit(1);
        if (!dossier) problem(404, 'people.employee_not_found', 'Employé introuvable');
        if (input.orgUnitId) await this.requireLiveOrgUnit(tx, input.orgUnitId);
        const avant = await lireLaChaine(tx);
        const journal: ChangementRattachement[] = [];

        // ——— 1. Le directeur général siège à la Direction Générale : il n'en
        // sort pas, sans quoi ses collaborateurs directs relèveraient d'une
        // autre direction que la leur.
        const racine = await uniteRacine(tx);
        const directionVisee = await directionDeUnite(tx, input.orgUnitId ?? null);
        if (racine?.managerId === id && directionVisee?.id !== racine.id) {
          problem(
            422,
            'people.dg_quitte_la_dg',
            'Le directeur général reste affecté à la Direction Générale',
            'Pour lui confier une autre direction, désignez d’abord son successeur à la tête de la Direction Générale.',
          );
        }

        // ——— 2. Un responsable ne quitte pas le périmètre de l'unité qu'il
        // dirige sans qu'un successeur soit désigné : sinon l'organigramme
        // affiche un chef parti ailleurs. On refuse plutôt que de le retirer
        // en douce — la RH décide qui reprend l'unité.
        const [dirigee] = await tx
          .select({ id: t.orgUnits.id, name: t.orgUnits.name })
          .from(t.orgUnits)
          .where(and(eq(t.orgUnits.managerEmployeeId, id), isNull(t.orgUnits.deletedAt)))
          .limit(1);
        if (dirigee) {
          const dedans = input.orgUnitId
            ? await tx.execute(sql`
                ${perimetre(dirigee.id)}
                SELECT 1 FROM perimetre WHERE id = ${input.orgUnitId} LIMIT 1`)
            : { rows: [] };
          if (dedans.rows.length === 0) {
            problem(
              422,
              'people.manager_cannot_leave_unit',
              `Cet employé dirige « ${dirigee.name} »`,
              'Désignez d’abord un nouveau responsable pour cette unité, puis remutez-le.',
            );
          }
        }

        // ——— 3. Le n+1 n'est pas daté : il vaut dès aujourd'hui. Une mutation
        // PROGRAMMÉE vers une autre direction laisserait donc la chaîne
        // fausse jusqu'à la date, ou fausse après — selon qu'on change le
        // n+1 maintenant ou pas. Tant qu'elle touche à la hiérarchie, elle
        // s'enregistre le jour où elle prend effet.
        const equipe = await equipeDe(tx, id);
        const directionActuelle = await directionDeEmploye(tx, id);
        const changeDeDirection = directionVisee?.id !== directionActuelle?.id;
        const [{ futur }] = (
          await tx.execute<{ futur: boolean }>(
            sql`SELECT ${input.startDate}::date > CURRENT_DATE AS futur`,
          )
        ).rows as [{ futur: boolean }];
        if (
          futur &&
          changeDeDirection &&
          (dossier.managerId || input.managerEmployeeId || equipe.length > 0)
        ) {
          problem(
            422,
            'people.mutation_programmee_hors_direction',
            'Une mutation vers une autre direction s’enregistre le jour où elle prend effet',
            'Le n+1 vaut dès aujourd’hui : programmée, la mutation laisserait la chaîne hiérarchique fausse jusqu’à sa date. Enregistrez-la ce jour-là, avec son nouveau n+1.',
          );
        }

        // Ce qui tenait AVANT la mutation doit tenir APRÈS. Une anomalie
        // ancienne ne bloque pas une mutation qui n'y est pour rien : le
        // contrôle de la chaîne continue de la signaler.
        const tenait = async (agent: string, n1: string) => {
          try {
            await validerRattachement(tx, agent, n1, await directionDeEmploye(tx, agent));
            return true;
          } catch (err) {
            if (err instanceof ProblemException) return false;
            throw err;
          }
        };
        const equipeEnRegle = new Set<string>();
        for (const a of equipe) if (await tenait(a.id, id)) equipeEnRegle.add(a.id);
        const n1Garde = input.managerEmployeeId ? null : dossier.managerId;
        const n1GardeEnRegle = n1Garde ? await tenait(id, n1Garde) : false;

        // ——— 4. L'équipe, confiée si l'on en désigne le repreneur.
        if (input.repreneurEquipeId) {
          await reprendreEquipe(tx, journal, id, input.repreneurEquipeId);
        }

        // ——— L'écriture : on clôt l'affectation courante, on ouvre la neuve.
        const [current] = await tx
          .select({
            id: t.assignments.id,
            validFrom: sql<string>`lower(${t.assignments.validity})::text`,
          })
          .from(t.assignments)
          .where(and(eq(t.assignments.employeeId, id), sql`upper_inf(${t.assignments.validity})`))
          .limit(1);
        // Une affectation qui commencerait après la fin de son contrat ne
        // prendrait jamais effet.
        const { rows: finContrat } = await tx.execute<{ fin: string }>(sql`
          SELECT c.end_date::text AS fin FROM contracts c
           WHERE c.id = ${dernierContrat(id)} AND c.end_date IS NOT NULL
             AND c.end_date < ${input.startDate}::date`);
        if (finContrat[0]) {
          problem(
            422,
            'people.affectation_apres_contrat',
            'L’affectation commencerait après la fin de son contrat',
            `Son contrat prend fin le ${frDate(finContrat[0].fin)}. Enregistrez d’abord son nouveau contrat.`,
          );
        }
        if (current) {
          if (input.startDate <= current.validFrom) {
            problem(
              422,
              'people.assignment_start_too_early',
              "La nouvelle affectation doit démarrer après le début de l'affectation courante",
              `Affectation courante depuis le ${current.validFrom}`,
            );
          }
          await tx
            .update(t.assignments)
            .set({
              validity: sql`daterange(lower(${t.assignments.validity}), ${input.startDate}::date)`,
            })
            .where(eq(t.assignments.id, current.id));
        }
        await tx.insert(t.assignments).values({
          id: uuidv7(),
          tenantId: user.tenantId,
          employeeId: id,
          orgUnitId: input.orgUnitId ?? null,
          positionTitle: input.positionTitle,
          validity: `[${input.startDate},)`,
        });

        // ——— Relu sur l'état écrit. Le responsable d'unité, d'abord : une
        // affectation déjà programmée ailleurs le ferait sortir plus tard.
        if (dirigee && (await sortDuPerimetre(tx, id, dirigee.id))) {
          problem(
            422,
            'people.manager_cannot_leave_unit',
            `Cet employé dirige « ${dirigee.name} »`,
            'Désignez d’abord un nouveau responsable pour cette unité, puis remutez-le.',
          );
        }

        // L'équipe qui reste doit pouvoir le suivre ; sinon, un repreneur.
        const restants = (await equipeDe(tx, id)).filter((a) => equipeEnRegle.has(a.id));
        for (const a of restants) {
          if (!(await tenait(a.id, id))) {
            problem(
              422,
              'people.equipe_sans_repreneur',
              `Cet agent encadre ${restants.length > 1 ? `${restants.length} agents` : 'un agent'}`,
              'Ils restent dans leur direction : choisissez qui reprend son équipe, dans la même opération.',
            );
          }
        }

        // ——— 5. Son n+1 : le nouveau, désigné dans le même geste — changer de
        // direction rend l'ancien caduc, et le corriger avant serait refusé
        // (il ne serait pas encore de la direction de l'agent) —, ou celui
        // qu'il garde, s'il tient toujours. Sinon, le responsable de sa
        // nouvelle direction le reprend d'office, s'il y en a un.
        if (input.managerEmployeeId) {
          await validerRattachement(
            tx,
            id,
            input.managerEmployeeId,
            await directionDeEmploye(tx, id),
          );
          await tx
            .update(t.employees)
            .set({ managerEmployeeId: input.managerEmployeeId, updatedAt: new Date() })
            .where(eq(t.employees.id, id));
        } else if (n1Garde && n1GardeEnRegle && !(await tenait(id, n1Garde))) {
          const direction = await directionDeEmploye(tx, id);
          if (!direction) {
            problem(
              422,
              'people.mutation_sans_direction',
              'Un agent rattaché à un n+1 reste affecté à une direction',
              'Choisissez une unité rattachée à une direction, ou retirez d’abord son n+1.',
            );
          }
          const tete = await n1DOffice(tx, id);
          if (!tete || !(await tenait(id, tete.id))) {
            problem(
              422,
              'people.responsable_hors_nouvelle_direction',
              'Le responsable actuel n’appartient pas à la nouvelle direction',
              `L’agent rejoint « ${direction.nom} » : désignez son nouveau responsable dans la même opération.`,
            );
          }
          await rattacher(tx, journal, id, tete.id, tete.motif);
        } else if (!dossier.managerId && !futur) {
          await rattacherDOffice(tx, journal, id);
        }

        await this.faireSuivre(tx, user.tenantId, journal);
        resultat = {
          changements: journal,
          aRevoir: nouvellesAnomalies(avant, await lireLaChaine(tx)),
        };
      });
      return resultat;
    } catch (err) {
      if (pgCode(err) === '23P01') {
        problem(
          409,
          'people.assignment_overlap',
          'Cette affectation chevaucherait une affectation existante',
        );
      }
      throw err;
    }
  }

  /** Historique d'audit du dossier : qui a changé quoi, quand (ADR-0008). */
  async history(user: SessionUser, id: string): Promise<EmployeeHistoryEntry[]> {
    return this.db.withTenant(ctxOf(user), async (tx) => {
      const employee = await this.requireEmployee(tx, id);
      const assignmentIds = (
        await tx
          .select({ id: t.assignments.id })
          .from(t.assignments)
          .where(eq(t.assignments.employeeId, id))
      ).map((r) => r.id);
      const contractIds = (
        await tx
          .select({ id: t.contracts.id })
          .from(t.contracts)
          .where(eq(t.contracts.employeeId, id))
      ).map((r) => r.id);

      const rowIds = [employee.id, employee.personId, ...assignmentIds, ...contractIds];
      const entries = await tx
        .select()
        .from(t.auditLog)
        .where(inArray(t.auditLog.rowId, rowIds))
        .orderBy(desc(t.auditLog.occurredAt))
        .limit(100);

      return entries.map((e) => {
        const oldData = (e.oldData ?? {}) as Record<string, unknown>;
        const newData = (e.newData ?? {}) as Record<string, unknown>;
        const changedFields =
          e.action === 'UPDATE'
            ? Object.keys(newData).filter(
                (k) =>
                  k !== 'updated_at' && JSON.stringify(oldData[k]) !== JSON.stringify(newData[k]),
              )
            : [];
        return {
          id: e.id,
          tableName: e.tableName,
          action: e.action,
          occurredAt: e.occurredAt.toISOString(),
          actorUserId: e.actorUserId,
          changedFields,
        };
      });
    });
  }

  // ---------- Fin de dossier : archiver, ou effacer ----------

  /**
   * Archiver un dossier, ou le rouvrir. Le même geste dans les deux sens.
   *
   * Archiver ne touche pas au compte : ni le mot de passe, ni l'identifiant,
   * ni le rôle ne bougent. L'agent garde un mois son portail, restreint, pour
   * récupérer ses documents ; ensuite il ne se connecte plus. Rouvrir le
   * dossier lui rend l'accès avec ce qu'il connaît déjà.
   */
  async archive(user: SessionUser, input: ArchiveEmployeesInput): Promise<EmployeeBatchResult> {
    return this.db.withTenant(ctxOf(user), async (tx) => {
      await verrouillerLaChaine(tx);
      const avant = await lireLaChaine(tx);
      const cibles = await this.chargerCibles(tx, input.ids);
      const skipped: EmployeeBatchResult['skipped'] = [];
      const geste = input.archived ? 'archive' : 'reouverture';
      const le = input.le ?? null;
      if (le) {
        const { rows } = await tx.execute<{ futur: boolean }>(
          sql`SELECT ${le}::date > CURRENT_DATE AS futur`,
        );
        if (rows[0]?.futur) {
          problem(
            422,
            'people.date_future',
            input.archived
              ? 'Le dernier jour ne peut pas être dans le futur'
              : 'La reprise ne peut pas être dans le futur',
            input.archived
              ? 'Un départ prévu s’enregistre le jour venu, ou par la date de fin de son contrat.'
              : 'Une reprise prévue s’enregistre par le contrat qui la porte.',
          );
        }
      }
      let retenus: typeof cibles = [];
      for (const c of cibles) {
        const motif =
          (await this.motifDeRefus(tx, user, c, geste)) ??
          (le ? await this.dateHorsActivite(tx, c.id, le, input.archived) : null);
        if (motif) skipped.push({ id: c.id, name: c.nom, reason: motif });
        else retenus.push(c);
      }

      const journal: ChangementRattachement[] = [];
      if (input.archived) {
        const depart = await this.planifierLesDeparts(tx, retenus, input.repreneurs);
        skipped.push(...depart.refus);
        retenus = depart.retenus;
        for (const plan of depart.plans) await appliquerReprise(tx, journal, plan);
      }
      if (retenus.length === 0) return { done: 0, skipped, changements: journal, aRevoir: [] };

      const ids = retenus.map((c) => c.id);
      // Rouvert, il retrouve son poste et son unité — avant de redevenir
      // actif : un dossier actif n'a pas de dernier jour.
      if (!input.archived) {
        for (const c of retenus) await reprendreLActivite(tx, user.tenantId, c.id, le);
      }
      await tx
        .update(t.employees)
        .set({
          status: input.archived ? 'archived' : 'active',
          archivedAt: input.archived ? new Date() : null,
          inactiviteMotif: input.archived ? (input.motif ?? null) : null,
          updatedAt: new Date(),
        })
        .where(inArray(t.employees.id, ids));
      // Réactivé sans n+1, il relève d'office du responsable de sa direction.
      if (!input.archived) {
        for (const c of retenus) await rattacherDOffice(tx, journal, c.id);
      }

      if (input.archived) {
        // Son dernier jour, celui qu'on donne, ou aujourd'hui : sa dernière
        // affectation s'arrête là, ses congés validés au-delà n'auront pas lieu.
        for (const c of retenus) {
          await arreterLActivite(
            tx,
            c.id,
            le ? sql`${le}::date` : sql`CURRENT_DATE`,
            input.motif ?? null,
          );
        }
        // Qui part ne prend plus de congé : ses demandes encore en attente
        // sont annulées, et leurs appels à viser retirés des boîtes.
        const annulees = await tx
          .update(t.absenceRequests)
          .set({ status: 'cancelled', decidedAt: new Date() })
          .where(
            and(
              inArray(t.absenceRequests.employeeId, ids),
              eq(t.absenceRequests.status, 'pending'),
            ),
          )
          .returning({ id: t.absenceRequests.id });
        for (const d of annulees) await reconcilierDemande(tx, d.id);
      }
      await this.faireSuivre(tx, user.tenantId, journal);
      // Un dossier rouvert revient avec le n+1 et l'affectation qu'il avait :
      // l'un ou l'autre a pu changer depuis. Ce qu'il faut revoir se dit
      // tout de suite, plutôt que d'attendre le prochain contrôle.
      return {
        done: retenus.length,
        skipped,
        changements: journal,
        aRevoir: nouvellesAnomalies(avant, await lireLaChaine(tx)),
      };
    });
  }

  /**
   * Une date de départ avant le début de son activité, ou une reprise qui
   * ne suit pas son dernier jour : le motif du refus, sinon `null`.
   */
  private async dateHorsActivite(
    tx: Tx,
    id: string,
    le: string,
    depart: boolean,
  ): Promise<string | null> {
    const { rows } = await tx.execute<{ debut: string; fin: string | null }>(sql`
      SELECT GREATEST(e.hired_on,
                      (SELECT max(p.reprise_le) FROM periodes_inactivite p
                        WHERE p.employee_id = e.id))::text AS debut,
             e.fin_activite::text AS fin
        FROM employees e WHERE e.id = ${id}`);
    const r = rows[0];
    if (!r) return null;
    if (depart && le < r.debut) {
      return `Son activité a commencé le ${frDate(r.debut)} : son dernier jour ne peut pas la précéder`;
    }
    if (!depart && r.fin && le <= r.fin) {
      return `Son dernier jour était le ${frDate(r.fin)} : la reprise vient après`;
    }
    return null;
  }

  /**
   * L'organisation vient de bouger — des n+1 ont changé, un agent est parti
   * ou a changé de direction : le circuit des congés se relit. Les demandes
   * vont à qui les attend désormais, et le directeur du Capital Humain
   * apprend que son délégué n'est plus là.
   */
  private async faireSuivre(
    tx: Tx,
    tenantId: string,
    _journal: ChangementRattachement[] = [],
  ): Promise<void> {
    await reconcilierLeCircuit(tx, tenantId);
  }

  /**
   * Qui part avec une équipe la confie : les reprises d'un LOT, vérifiées
   * ensemble avant que rien ne s'écrive.
   *
   * Les agents qui partent dans le même lot ne comptent pas — on ne confie
   * pas une équipe qui s'en va aussi, ni à quelqu'un qui s'en va. Mais un
   * départ refusé change la donne pour les autres : l'agent qui reste
   * redevient un membre d'équipe à confier, un repreneur possible, un n+1 à
   * la place duquel on peut se mettre. On recommence donc jusqu'à ce que
   * plus rien ne bouge — le lot ne fait que rétrécir, le calcul s'arrête.
   */
  private async planifierLesDeparts<C extends { id: string; nom: string }>(
    tx: Tx,
    candidats: C[],
    repreneurs: Record<string, string> | undefined,
  ): Promise<{ retenus: C[]; plans: PlanDeReprise[]; refus: EmployeeBatchResult['skipped'] }> {
    let retenus = candidats;
    const refus: EmployeeBatchResult['skipped'] = [];
    for (;;) {
      const partants = new Set(retenus.map((c) => c.id));
      const plans: PlanDeReprise[] = [];
      const tour: EmployeeBatchResult['skipped'] = [];
      for (const c of retenus) {
        const equipe = (await equipeDe(tx, c.id)).filter((a) => !partants.has(a.id));
        if (equipe.length === 0) continue;
        const repreneur = repreneurs?.[c.id];
        const effectif = equipe.length > 1 ? `${equipe.length} agents` : 'un agent';
        if (!repreneur) {
          tour.push({
            id: c.id,
            name: c.nom,
            reason: `Encadre ${effectif} : choisissez qui reprend son équipe`,
          });
          continue;
        }
        try {
          plans.push(await planifierReprise(tx, c.id, repreneur, equipe, partants));
        } catch (err) {
          if (!(err instanceof ProblemException)) throw err;
          tour.push({
            id: c.id,
            name: c.nom,
            reason: [err.problem.title, err.problem.detail].filter(Boolean).join(' — '),
          });
        }
      }
      if (tour.length === 0) return { retenus, plans, refus };
      refus.push(...tour);
      const refuses = new Set(tour.map((r) => r.id));
      retenus = retenus.filter((c) => !refuses.has(c.id));
    }
  }

  /**
   * Effacer un dossier, définitivement.
   *
   * La règle tient en une phrase : ce qui EST la personne disparaît, ce qu'elle
   * a fait au dossier des AUTRES est anonymisé. On ne peut pas supprimer la
   * ligne de compte de qui a validé les congés d'un collègue sans crever le
   * dossier du collègue ; on la vide donc de son contenu et on la laisse porter
   * la référence. Le reste — état civil, contrats, congés, pièces, demandes,
   * portail — s'en va.
   *
   * Y compris ce que le journal d'audit avait recopié au passage : son
   * déclencheur garde la ligne entière à chaque suppression, si bien qu'un
   * effacement qui l'ignorerait laisserait le dossier complet dans la table
   * qu'on ne peut pas purger. `erase_audit_payload` en retire le contenu et
   * laisse la trace (cf. migration 0018).
   */
  async remove(user: SessionUser, input: DeleteEmployeesInput): Promise<EmployeeBatchResult> {
    return this.db.withTenant(ctxOf(user), async (tx) => {
      await verrouillerLaChaine(tx);
      const avant = await lireLaChaine(tx);
      const cibles = await this.chargerCibles(tx, input.ids);
      const skipped: EmployeeBatchResult['skipped'] = [];
      const candidats: typeof cibles = [];
      for (const c of cibles) {
        const motif = await this.motifDeRefus(tx, user, c, 'suppression');
        if (motif) skipped.push({ id: c.id, name: c.nom, reason: motif });
        else candidats.push(c);
      }

      const journal: ChangementRattachement[] = [];
      const depart = await this.planifierLesDeparts(tx, candidats, input.repreneurs);
      skipped.push(...depart.refus);
      for (const plan of depart.plans) await appliquerReprise(tx, journal, plan);
      const detaches: string[] = [];
      for (const c of depart.retenus) detaches.push(...(await this.effacer(tx, user, c)));
      // Qui s'est retrouvé sans n+1 relève d'office du responsable de sa direction.
      for (const id of detaches) await rattacherDOffice(tx, journal, id);
      await this.faireSuivre(tx, user.tenantId, journal);
      return {
        done: depart.retenus.length,
        skipped,
        changements: journal,
        aRevoir: nouvellesAnomalies(avant, await lireLaChaine(tx)),
      };
    });
  }

  /** Les dossiers visés, avec de quoi les nommer dans un message d'erreur. */
  private async chargerCibles(tx: Tx, ids: string[]) {
    return (
      tx
        .select({
          id: t.employees.id,
          personId: t.employees.personId,
          employeeNumber: t.employees.employeeNumber,
          status: t.employees.status,
          userId: t.persons.userId,
          prenom: t.persons.givenName,
          nom: sql<string>`${t.persons.givenName} || ' ' || ${t.persons.familyName}`,
        })
        .from(t.employees)
        .innerJoin(t.persons, eq(t.persons.id, t.employees.personId))
        .where(inArray(t.employees.id, ids))
        // Un ordre fixe : deux essais du même lot rendent les mêmes refus.
        .orderBy(t.employees.employeeNumber, t.employees.id)
    );
  }

  /**
   * Ce qui interdit de fermer ou d'effacer un dossier — null si rien ne s'y
   * oppose. Trois garde-fous, et chacun a coûté cher ailleurs :
   *
   *  — son propre dossier : on se retirerait l'accès à l'écran d'où l'on agit ;
   *  — le dernier administrateur : plus personne ne pourrait rendre les droits ;
   *  — un responsable d'unité : l'organigramme désignerait un chef parti.
   */
  private async motifDeRefus(
    tx: Tx,
    user: SessionUser,
    cible: { id: string; userId: string | null; prenom: string },
    geste: 'archive' | 'reouverture' | 'suppression',
  ): Promise<string | null> {
    if (cible.userId && cible.userId === user.userId) {
      return 'Vous ne pouvez pas fermer ni effacer votre propre dossier';
    }
    if (cible.userId) {
      const [autreAdmin] = await tx
        .select({ id: t.userTenantMemberships.id })
        .from(t.userTenantMemberships)
        .where(
          and(
            eq(t.userTenantMemberships.tenantId, user.tenantId),
            eq(t.userTenantMemberships.role, 'admin'),
            sql`${t.userTenantMemberships.userId} <> ${cible.userId}`,
          ),
        )
        .limit(1);
      const [estAdmin] = await tx
        .select({ id: t.userTenantMemberships.id })
        .from(t.userTenantMemberships)
        .where(
          and(
            eq(t.userTenantMemberships.tenantId, user.tenantId),
            eq(t.userTenantMemberships.userId, cible.userId),
            eq(t.userTenantMemberships.role, 'admin'),
          ),
        )
        .limit(1);
      if (estAdmin && !autreAdmin) {
        return "Dernier administrateur de l'organisation";
      }
    }
    // Rouvrir le dossier d'un contrat arrivé à terme : il repasserait aussitôt
    // dans les inactifs. Le nouveau contrat d'abord.
    if (geste === 'reouverture') {
      const fin = await finDeContratPassee(tx, cible.id);
      if (fin) {
        return `Le contrat de ${cible.prenom} a pris fin le ${frDate(fin)}. Enregistrez son nouveau contrat avant de réactiver son compte.`;
      }
    }
    // Rouvrir un dossier ne décapite aucune unité : ce garde-fou ne vaut que
    // pour les deux gestes qui ferment.
    if (geste !== 'reouverture') {
      const [unite] = await tx
        .select({ name: t.orgUnits.name })
        .from(t.orgUnits)
        .where(and(eq(t.orgUnits.managerEmployeeId, cible.id), isNull(t.orgUnits.deletedAt)))
        .limit(1);
      if (unite) return `Dirige « ${unite.name} » : nommez d'abord un successeur`;
    }
    return null;
  }

  /**
   * L'effacement lui-même, dans l'ordre imposé par les clés étrangères.
   *
   * Chaque suppression rend les identifiants qu'elle a retirés, et c'est cette
   * récolte-là qu'on donne au journal d'audit à nettoyer. Tenir la liste à la
   * main serait la laisser vieillir : dix-neuf tables portent un déclencheur
   * d'audit, une migration en ajoute une sans y penser, et l'oubli ne se voit
   * pas — il laisse simplement une adresse email de plus dans le journal.
   * Ici la liste est le résultat de ce qu'on a réellement effacé.
   */
  private async effacer(
    tx: Tx,
    user: SessionUser,
    cible: { id: string; personId: string; userId: string | null; nom: string },
  ): Promise<string[]> {
    const { id, personId, userId, nom } = cible;
    const traces: string[] = [];
    const recolter = (lignes: { id: string }[]) => {
      for (const l of lignes) traces.push(l.id);
    };

    // Les demandes d'absence se relèvent avant leurs enfants : c'est par elles
    // que visas et justificatifs se retrouvent.
    const demandeIds = (
      await tx
        .select({ id: t.absenceRequests.id })
        .from(t.absenceRequests)
        .where(eq(t.absenceRequests.employeeId, id))
    ).map((d) => d.id);

    if (demandeIds.length > 0) {
      recolter(
        await tx
          .delete(t.absenceDocuments)
          .where(inArray(t.absenceDocuments.requestId, demandeIds))
          .returning({ id: t.absenceDocuments.id }),
      );
      recolter(
        await tx
          .delete(t.absenceApprovals)
          .where(inArray(t.absenceApprovals.requestId, demandeIds))
          .returning({ id: t.absenceApprovals.id }),
      );
    }
    recolter(
      await tx
        .delete(t.absenceRequests)
        .where(eq(t.absenceRequests.employeeId, id))
        .returning({ id: t.absenceRequests.id }),
    );
    recolter(
      await tx
        .delete(t.absenceBalances)
        .where(eq(t.absenceBalances.employeeId, id))
        .returning({ id: t.absenceBalances.id }),
    );
    recolter(
      await tx
        .delete(t.employeeDocuments)
        .where(eq(t.employeeDocuments.employeeId, id))
        .returning({ id: t.employeeDocuments.id }),
    );
    recolter(
      await tx
        .delete(t.documentRequests)
        .where(eq(t.documentRequests.employeeId, id))
        .returning({ id: t.documentRequests.id }),
    );
    recolter(
      await tx
        .delete(t.profileChangeRequests)
        .where(eq(t.profileChangeRequests.employeeId, id))
        .returning({ id: t.profileChangeRequests.id }),
    );
    recolter(
      await tx
        .delete(t.assignments)
        .where(eq(t.assignments.employeeId, id))
        .returning({ id: t.assignments.id }),
    );
    recolter(
      await tx
        .delete(t.contracts)
        .where(eq(t.contracts.employeeId, id))
        .returning({ id: t.contracts.id }),
    );
    // Ce que la suppression du dossier emporterait en cascade sans le dire :
    // ses certificats (nom et matricule figés), ses habilitations, ses
    // objectifs et ses fiches d'objectifs (évaluations comprises), ses départs
    // et retours. Effacés ici, leurs identifiants rejoignent la récolte, et
    // le journal oublie aussi leur contenu.
    for (const table of [
      sql`academy_certificates`,
      sql`habilitations`,
      sql`objectifs`,
      sql`objectifs_fiches`,
      sql`periodes_inactivite`,
    ]) {
      const { rows } = await tx.execute<{ id: string }>(
        sql`DELETE FROM ${table} WHERE employee_id = ${id} RETURNING id`,
      );
      recolter(rows);
    }

    // Ce qui POINTE vers lui se détache — un successeur se nomme, il ne se
    // devine pas. Les subordonnés remontent sans manager plutôt que de
    // désigner un dossier qui n'existe plus ; l'appelant les rend ensuite au
    // responsable de leur direction.
    const detaches = await tx
      .update(t.employees)
      .set({ managerEmployeeId: null })
      .where(eq(t.employees.managerEmployeeId, id))
      .returning({ id: t.employees.id });
    await tx
      .update(t.orgUnits)
      .set({ managerEmployeeId: null })
      .where(eq(t.orgUnits.managerEmployeeId, id));

    recolter(
      await tx.delete(t.employees).where(eq(t.employees.id, id)).returning({ id: t.employees.id }),
    );
    recolter(
      await tx
        .delete(t.invitations)
        .where(eq(t.invitations.personId, personId))
        .returning({ id: t.invitations.id }),
    );
    recolter(
      await tx.delete(t.persons).where(eq(t.persons.id, personId)).returning({ id: t.persons.id }),
    );

    /**
     * Les notifications qui PARLENT de lui, dans la boîte des autres.
     *
     * « Moussa Ndiaye demande des documents » dort chez la RH : elle nomme la
     * personne et mène à une demande qu'on vient d'effacer. Son lien ou sa
     * clé porte l'identifiant du dossier, ou celui d'une ligne effacée à
     * l'instant (demande, pièce, contrat) : c'est par là qu'on la retrouve,
     * sans risque de toucher à un homonyme.
     */
    const effaces = `{${traces.join(',')}}`;
    const { rows: parIdentifiant } = await tx.execute<{ id: string }>(sql`
      DELETE FROM notifications n
       WHERE EXISTS (
         SELECT 1 FROM unnest(${effaces}::uuid[]) AS x(id)
          WHERE position(x.id::text IN coalesce(n.link, '')) > 0
             OR position(x.id::text IN coalesce(n.dedupe_key, '')) > 0)
      RETURNING n.id`);
    recolter(parIdentifiant);

    // Celles qui ne le citent que par son nom (« Moussa Ndiaye a évalué vos
    // objectifs ») : seulement si ce nom ne désigne personne d'autre ici.
    const [homonyme] = await tx
      .select({ id: t.persons.id })
      .from(t.persons)
      .where(sql`position(${nom} IN ${t.persons.givenName} || ' ' || ${t.persons.familyName}) > 0`)
      .limit(1);
    if (!homonyme) {
      recolter(
        await tx
          .delete(t.notifications)
          .where(
            sql`(position(${nom} IN ${t.notifications.title}) > 0
              OR position(${nom} IN coalesce(${t.notifications.body}, '')) > 0)`,
          )
          .returning({ id: t.notifications.id }),
      );
    }

    if (userId) {
      recolter(
        await tx
          .delete(t.notifications)
          .where(eq(t.notifications.recipientUserId, userId))
          .returning({ id: t.notifications.id }),
      );
      // Une session porte l'adresse IP et le navigateur : la révoquer laisserait
      // ces traces-là. Ici on efface, on ne range pas.
      await tx
        .delete(t.sessions)
        .where(and(eq(t.sessions.userId, userId), eq(t.sessions.tenantId, user.tenantId)));
      recolter(
        await tx
          .delete(t.userTenantMemberships)
          .where(
            and(
              eq(t.userTenantMemberships.userId, userId),
              eq(t.userTenantMemberships.tenantId, user.tenantId),
            ),
          )
          .returning({ id: t.userTenantMemberships.id }),
      );

      const restantes = await tx
        .select({ id: t.userTenantMemberships.id })
        .from(t.userTenantMemberships)
        .where(eq(t.userTenantMemberships.userId, userId))
        .limit(1);
      if (restantes.length === 0) {
        // Plus aucune organisation : le compte ne sert plus qu'à porter les
        // références des dossiers d'autrui. On le vide de la personne.
        await tx
          .update(t.users)
          .set({
            email: `supprime+${userId}@compte.invalide`,
            passwordHash: randomBytes(32).toString('base64'),
            givenName: 'Compte',
            familyName: 'supprimé',
            status: 'deleted',
            mfaTotpSecret: null,
            updatedAt: new Date(),
          })
          .where(eq(t.users.id, userId));
      }
    }

    // Ce que le journal garde de lignes retirées AVANT l'effacement : une pièce
    // annulée, remplacée par une plus récente ou retirée du dossier. Elles ne
    // sont plus là pour être récoltées, mais leur copie porte son dossier.
    const { rows: retirees } = await tx.execute<{ id: string }>(sql`
      SELECT DISTINCT row_id AS id FROM audit_log
       WHERE tenant_id = app_tenant_id() AND row_id IS NOT NULL
         AND (old_data ->> 'employee_id' = ${id} OR new_data ->> 'employee_id' = ${id})`);
    recolter(retirees);

    // En dernier : chaque suppression ci-dessus vient d'écrire dans le journal
    // une copie de la ligne effacée. C'est ce contenu-là qu'on retire, en
    // laissant la trace de l'opération. Un seul paramètre, découpé côté base :
    // passer le tableau tel quel le ferait développer en tuple `($1, $2, …)`,
    // que Postgres refuse de couler en uuid[].
    await tx.execute(
      sql`SELECT erase_audit_payload(string_to_array(${traces.join(',')}, ',')::uuid[])`,
    );
    return detaches.map((d) => d.id).filter((d) => d !== id);
  }

  private async requireEmployee(tx: Tx, id: string) {
    const [employee] = await tx.select().from(t.employees).where(eq(t.employees.id, id)).limit(1);
    if (!employee) {
      problem(404, 'people.employee_not_found', 'Employé introuvable');
    }
    return employee;
  }
}
