import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type {
  ChangementRattachement,
  ConsequencesHierarchie,
  CreateOrgUnitInput,
  DeleteOrgUnitInput,
  OrgUnitMember,
  OrgUnitType,
  OrgUnitView,
  SessionUser,
  UpdateOrgUnitInput,
} from '@teranga/contracts';
import {
  nomAbrege,
  ORG_UNIT_PARENT_TYPES,
  ORG_UNIT_ROOT_TYPES,
  ORG_UNIT_TYPE_LABELS,
} from '@teranga/contracts';
import { problem } from '../../common/problem';
import * as t from '../../db/schema';
import { TenantDb, Tx } from '../../db/tenant-db';
import {
  apresNouveauDG,
  apresNouveauDirecteur,
  directeurGeneral,
  perimetre,
  SOMMET,
  sortDuPerimetre,
  uniteRacine,
  verrouillerLaChaine,
} from './chaine';
import { contratEchu, enActivite, enStage, exigerEnActivite, exigerHorsStage } from './en-activite';
import { pasSurSoi } from '../acces/dch';
import { reconcilierLeCircuit } from '../time/visas';
import { lireLaChaine, nouvellesAnomalies } from './hierarchie.service';
import { inscrireLaPassation } from './passation';

interface TeteHorsPerimetre extends Record<string, unknown> {
  unit_id: string;
  name: string;
  employee_id: string;
  given_name: string;
  family_name: string;
  sommet: boolean;
}

/** Lancée pour annuler la transaction d'un aperçu, une fois tout mesuré. */
class AnnulerLApercu extends Error {}

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
    problem(422, 'org.short_name_taken', 'Cet acronyme est déjà utilisé par une autre direction');
  }
  if (detail.includes('org_units_un_seul_sommet')) {
    problem(
      422,
      'org.sommet_unique',
      'L’organigramme a déjà son sommet',
      'Rattachez cette unité sous la Direction Générale : il n’y a qu’un sommet, et son responsable est le directeur général.',
    );
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

  /**
   * Liste enrichie pour l'organigramme : responsable et effectif. L'effectif
   * d'une unité compte tout son périmètre (ses sous-unités, sans les
   * directions qu'elle coiffe) : une direction de huit agents répartis dans
   * deux départements ne se lit pas « 1 personne ».
   */
  async list(user: SessionUser): Promise<OrgUnitView[]> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      const managerPersons = t.persons;
      const rows = await tx
        // Les colonnes corrélées des sous-requêtes sont NOMMÉES en toutes
        // lettres — « org_units.id » — plutôt qu'interpolées depuis le schéma.
        // Drizzle n'ajoute le préfixe de table que si la requête extérieure
        // porte une jointure ; sans elle il rend « id » tout court, qui se
        // résout alors sur `assignments`, qui en a un aussi, et la sous-requête
        // compare silencieusement une ligne à elle-même. Le préfixe explicite
        // ne dépend pas de la forme de la requête qui l'entoure.
        .select({
          id: t.orgUnits.id,
          name: t.orgUnits.name,
          unitType: t.orgUnits.unitType,
          parentId: t.orgUnits.parentId,
          shortName: t.orgUnits.shortName,
          managerEmployeeId: t.orgUnits.managerEmployeeId,
          managerGivenName: managerPersons.givenName,
          managerFamilyName: managerPersons.familyName,
          managerGender: managerPersons.gender,
          managerNumber: t.employees.employeeNumber,
          sommet: sql<boolean>`(org_units.id = ${SOMMET})`,
          directionDuPersonnel: t.orgUnits.directionDuPersonnel,
          managerPosition: sql<string | null>`(
            SELECT a.position_title FROM assignments a
            WHERE a.employee_id = org_units.manager_employee_id
              AND a.validity @> CURRENT_DATE
            LIMIT 1)`,
          managerDepuis: sql<string | null>`(
            SELECT lower(a.validity)::text FROM assignments a
            WHERE a.employee_id = org_units.manager_employee_id
              AND a.validity @> CURRENT_DATE
              AND ${enActivite(sql`a.employee_id`)}
            LIMIT 1)`,
          // Qui perdrait son rattachement en cas de dissolution : sans filtre
          // de statut, et affectations futures comprises. On compte les
          // PERSONNES, pas les affectations — c'est ce que l'avertissement
          // annonce, et deux affectations d'un même agent ne font pas deux
          // agents à prévenir.
          attachedEmployees: sql<number>`(
            SELECT count(DISTINCT a.employee_id)::int FROM assignments a
            WHERE a.org_unit_id = org_units.id
              AND (upper_inf(a.validity) OR upper(a.validity) > CURRENT_DATE))`,
        })
        .from(t.orgUnits)
        .leftJoin(t.employees, eq(t.employees.id, t.orgUnits.managerEmployeeId))
        .leftJoin(managerPersons, eq(managerPersons.id, t.employees.personId))
        .where(isNull(t.orgUnits.deletedAt))
        .orderBy(asc(t.orgUnits.unitType), asc(t.orgUnits.name));

      // Chaque agent compte pour son unité et pour celles qui la coiffent,
      // jusqu'à la première direction comprise : c'est le périmètre.
      const { rows: effectifs } = await tx.execute<{ unite: string; n: number }>(sql`
        WITH RECURSIVE montee AS (
          SELECT id AS depart, id AS unite, unit_type, parent_id, 0 AS prof
            FROM org_units WHERE deleted_at IS NULL
          UNION ALL
          SELECT m.depart, o.id, o.unit_type, o.parent_id, m.prof + 1
            FROM montee m JOIN org_units o ON o.id = m.parent_id AND o.deleted_at IS NULL
           WHERE m.unit_type <> 'direction' AND m.prof < 64
        )
        SELECT m.unite, count(DISTINCT a.employee_id)::int AS n
          FROM montee m
          JOIN assignments a ON a.org_unit_id = m.depart AND a.validity @> CURRENT_DATE
          JOIN employees e ON e.id = a.employee_id AND e.status = 'active'
         GROUP BY m.unite`);
      const effectif = new Map(effectifs.map((x) => [x.unite, x.n]));

      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        unitType: r.unitType as OrgUnitView['unitType'],
        parentId: r.parentId,
        shortName: r.shortName,
        managerEmployeeId: r.managerEmployeeId,
        managerName: r.managerGivenName ? `${r.managerGivenName} ${r.managerFamilyName}` : null,
        managerShortName: r.managerGivenName
          ? nomAbrege(r.managerGivenName, r.managerFamilyName ?? '')
          : null,
        managerGender:
          r.managerGender === 'female' || r.managerGender === 'male' ? r.managerGender : null,
        managerNumber: r.managerNumber,
        managerPosition: r.managerPosition,
        managerDepuis: r.managerDepuis,
        sommet: Boolean(r.sommet),
        directionDuPersonnel: r.directionDuPersonnel,
        headcount: effectif.get(r.id) ?? 0,
        attachedEmployees: r.attachedEmployees,
      }));
    });
  }

  async create(user: SessionUser, input: CreateOrgUnitInput): Promise<{ id: string }> {
    const id = uuidv7();
    this.assertShortNameAllowed(input.unitType, input.shortName ?? null);
    try {
      await this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
        await verrouillerLaChaine(tx);
        await this.assertParentAllowed(tx, input.unitType, input.parentId ?? null);
        if (!input.parentId) await this.assertSommetLibre(tx, null);
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
  async remove(
    user: SessionUser,
    id: string,
    input: DeleteOrgUnitInput,
  ): Promise<ConsequencesHierarchie> {
    return this.executer(user, (tx) => this.dissoudre(tx, user, id, input), false);
  }

  private async dissoudre(
    tx: Tx,
    user: SessionUser,
    id: string,
    input: DeleteOrgUnitInput,
  ): Promise<void> {
    await this.requireUnit(tx, id, 'org.unit_not_found');
    const tetesAvant = await this.tetesHorsPerimetre(tx);

    // ——— Le sommet ne se dissout pas : sans lui, plus de directeur général,
    // et toute la chaîne perd son point d'arrivée. On le renomme au besoin.
    if ((await uniteRacine(tx))?.id === id) {
      problem(
        422,
        'org.sommet_indissoluble',
        'La Direction Générale ne se supprime pas',
        'Elle porte le sommet de l’organigramme et son responsable est le directeur général. Renommez-la au besoin.',
      );
    }

    // ——— La direction du personnel traite les demandes des agents : sans
    // elle, plus personne pour les congés. On en désigne une autre d'abord.
    const [unite] = await tx
      .select({ dch: t.orgUnits.directionDuPersonnel })
      .from(t.orgUnits)
      .where(eq(t.orgUnits.id, id))
      .limit(1);
    if (unite?.dch) {
      problem(
        422,
        'org.dch_indissoluble',
        'La direction du personnel ne se supprime pas',
        'Elle traite les demandes des agents : désignez d’abord une autre direction du personnel.',
      );
    }

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
        // Rien à historiser tant que l'affectation n'a pas duré un jour.
        // Le seuil est bien « aujourd'hui ou plus tard » et non « plus
        // tard » : clore aujourd'hui une affectation commencée aujourd'hui
        // donne un intervalle VIDE, que la contrainte de la table refuse.
        sansHistorique: sql<boolean>`lower(${t.assignments.validity}) >= CURRENT_DATE`,
        fin: sql<string | null>`upper(${t.assignments.validity})::text`,
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
      // Sans unité d'accueil, on DÉTACHE au lieu de refuser. Exiger une
      // réaffectation bloquait la dissolution d'une direction vidée de sa
      // substance dès qu'un seul agent — fût-il suspendu — y pendait encore,
      // et obligeait à inventer un rattachement faux pour s'en sortir.
      // Détachée, la personne garde son poste, son dossier et son historique ;
      // elle n'a simplement plus d'unité, ce que l'écran annonce avant.
      const accueil = input.reassignTo ?? null;
      if (accueil !== null) {
        if (accueil === id) {
          problem(422, 'org.reassign_to_self', 'Impossible de réaffecter vers l’unité supprimée');
        }
        await this.requireUnit(tx, accueil, 'org.reassign_target_not_found');
      }

      for (const a of openAssignments) {
        if (a.sansHistorique) {
          // Pas encore vécue : on la redirige telle quelle.
          await tx
            .update(t.assignments)
            .set({ orgUnitId: accueil })
            .where(eq(t.assignments.id, a.id));
          continue;
        }
        // Affectation en cours : on la CLÔT aujourd'hui et on en ouvre une
        // nouvelle — sur l'unité d'accueil, ou sans unité. Réécrire
        // org_unit_id ferait dire au dossier que l'employé n'a jamais mis les
        // pieds ici : l'historique mentirait.
        //
        // La nouvelle garde l'ÉCHÉANCE de l'ancienne : un agent dont la
        // mutation est déjà programmée ailleurs la garde, au lieu de la
        // chevaucher. Et « aujourd'hui » est celui de la base, le même que
        // celui des contrôles — pas celui de l'horloge du serveur.
        await tx
          .update(t.assignments)
          .set({ validity: sql`daterange(lower(${t.assignments.validity}), CURRENT_DATE)` })
          .where(eq(t.assignments.id, a.id));
        await tx.execute(sql`
          INSERT INTO assignments (id, tenant_id, employee_id, org_unit_id, position_title, validity)
          VALUES (${uuidv7()}, ${user.tenantId}, ${a.employeeId}, ${accueil}, ${a.positionTitle},
                  daterange(CURRENT_DATE, ${a.fin}::date))`);
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
    await this.assertAucuneTeteSortie(tx, tetesAvant);
  }

  /**
   * Renommage, re-rattachement (anti-cycle) ou changement de responsable —
   * avec les cascades que la règle impose, et le compte de ce qu'elles ont
   * fait.
   */
  async update(
    user: SessionUser,
    id: string,
    input: UpdateOrgUnitInput,
  ): Promise<ConsequencesHierarchie> {
    return this.executer(user, (tx, journal) => this.modifier(tx, user, journal, id, input), false);
  }

  /** La même opération, jouée puis annulée : ce qu'elle FERAIT, avant de valider. */
  async apercu(
    user: SessionUser,
    id: string,
    input: UpdateOrgUnitInput,
  ): Promise<ConsequencesHierarchie> {
    return this.executer(user, (tx, journal) => this.modifier(tx, user, journal, id, input), true);
  }

  /**
   * La désignation, dans la transaction d'une mutation qui met l'agent à la
   * tête de l'unité : les mêmes règles et les mêmes cascades que depuis
   * l'organigramme. L'appelant tient le verrou de la chaîne et relit le
   * circuit ensuite.
   */
  async designerDansLaTransaction(
    tx: Tx,
    user: SessionUser,
    journal: ChangementRattachement[],
    id: string,
    input: UpdateOrgUnitInput,
  ): Promise<void> {
    await this.modifier(tx, user, journal, id, input);
  }

  /** La dissolution, jouée puis annulée. */
  async apercuSuppression(
    user: SessionUser,
    id: string,
    input: DeleteOrgUnitInput,
  ): Promise<ConsequencesHierarchie> {
    return this.executer(user, (tx) => this.dissoudre(tx, user, id, input), true);
  }

  /**
   * Joue une opération sur l'organigramme et mesure ce qu'elle fait à la
   * chaîne hiérarchique : les rattachements changés par cascade (le
   * journal), et les anomalies qu'elle fait APPARAÎTRE — celles d'avant ne
   * sont pas les siennes. En aperçu, tout est annulé une fois mesuré :
   * l'aperçu dit exactement ce que ferait l'opération, puisque c'est elle.
   */
  private async executer(
    user: SessionUser,
    operation: (tx: Tx, journal: ChangementRattachement[]) => Promise<void>,
    apercu: boolean,
  ): Promise<ConsequencesHierarchie> {
    let resultat: ConsequencesHierarchie = { changements: [], aRevoir: [] };
    try {
      await this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
        await verrouillerLaChaine(tx);
        const avant = await lireLaChaine(tx);
        const journal: ChangementRattachement[] = [];
        await operation(tx, journal);
        const apres = await lireLaChaine(tx);
        resultat = { changements: journal, aRevoir: nouvellesAnomalies(avant, apres) };
        if (apercu) throw new AnnulerLApercu();
        // L'organigramme a bougé — des n+1, le directeur du Capital Humain,
        // les membres de sa direction : les demandes de congé vont à qui les
        // attend désormais, qui est prévenu.
        await reconcilierLeCircuit(tx, user.tenantId);
      });
    } catch (err) {
      if (err instanceof AnnulerLApercu) return resultat;
      if (pgCode(err) === '23505') mapUniqueViolation(err);
      if (pgCode(err) === '23P01') {
        problem(
          409,
          'org.affectations_chevauchantes',
          'Deux affectations d’un même agent se chevaucheraient',
          'Un agent concerné a déjà une affectation programmée sur la même période : ajustez-la d’abord.',
        );
      }
      throw err;
    }
    return resultat;
  }

  private async modifier(
    tx: Tx,
    user: SessionUser,
    journal: ChangementRattachement[],
    id: string,
    input: UpdateOrgUnitInput,
  ): Promise<void> {
    await this.requireUnit(tx, id, 'org.unit_not_found');

    const [before] = await tx
      .select({
        unitType: t.orgUnits.unitType,
        parentId: t.orgUnits.parentId,
        managerEmployeeId: t.orgUnits.managerEmployeeId,
        dch: t.orgUnits.directionDuPersonnel,
        shortName: t.orgUnits.shortName,
      })
      .from(t.orgUnits)
      .where(eq(t.orgUnits.id, id))
      .limit(1);

    // ——— Personne ne se désigne lui-même responsable : il deviendrait le
    // N+1 de toute l'unité, sans que personne l'ait décidé.
    if (input.managerEmployeeId && input.managerEmployeeId !== before!.managerEmployeeId) {
      await pasSurSoi(tx, user.userId, [input.managerEmployeeId], 'vous désigner responsable');
    }
    // ——— Qui dirige la DCH a TOUTES les habilitations. Le désigner — ou
    // désigner la direction du personnel — revient à l'administrateur, hors
    // de l'organigramme : un membre habilité à l'organigramme ne peut pas se
    // donner, ni donner à un proche, toutes les habilitations.
    const touchesALaDCH =
      (input.directionDuPersonnel !== undefined && input.directionDuPersonnel !== before!.dch) ||
      (before!.dch &&
        input.managerEmployeeId !== undefined &&
        input.managerEmployeeId !== before!.managerEmployeeId);
    if (touchesALaDCH && user.role !== 'admin') {
      problem(
        403,
        'org.dch_reservee_admin',
        'Seul l’administrateur désigne la DCH et qui la dirige',
        'Qui dirige la Direction du Capital Humain a toutes les habilitations : ce choix revient à l’administrateur.',
      );
    }
    const nextType = (input.unitType ?? before!.unitType) as OrgUnitType;
    const nextParent = input.parentId !== undefined ? input.parentId : before!.parentId;
    const sommet = (await uniteRacine(tx))?.id ?? null;

    // ——— Un seul sommet, et il reste au sommet. Le ranger sous une autre
    // unité ferait d'elle — ou d'un vestige d'avant la règle — le sommet, et
    // de son responsable le directeur général, sans que personne l'ait
    // décidé.
    if (id === sommet && nextParent !== null) {
      problem(
        422,
        'org.sommet_fixe',
        'La Direction Générale reste au sommet',
        'C’est elle que toutes les directions rejoignent, et son responsable est le directeur général.',
      );
    }
    if (nextParent === null && before!.parentId !== null) {
      await this.assertSommetLibre(tx, id);
    }

    if (input.parentId !== undefined && input.parentId !== null) {
      if (input.parentId === id) {
        problem(422, 'org.cycle', 'Une unité ne peut pas être rattachée à elle-même');
      }
      // Anti-cycle : le nouveau parent ne doit pas être un descendant de
      // l'unité. UNION : une boucle déjà présente arrête la remontée.
      const cycle = await tx.execute(sql`
          WITH RECURSIVE ancestors AS (
            SELECT id, parent_id FROM org_units WHERE id = ${input.parentId}
            UNION
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

    // Le type et le rattachement se valident ENSEMBLE : changer l'un peut
    // rendre l'autre absurde (une direction rangée sous un service).
    if (input.unitType !== undefined || input.parentId !== undefined) {
      await this.assertParentAllowed(tx, nextType, nextParent, id);
      await this.assertChildrenAllowed(tx, id, nextType);
    }

    // ——— La direction du personnel est une direction, et il n'y en a qu'une.
    const seraDCH = input.directionDuPersonnel ?? before!.dch;
    if (seraDCH && nextType !== 'direction') {
      problem(
        422,
        'org.dch_est_une_direction',
        'La direction du personnel reste une direction',
        'Désignez d’abord une autre direction du personnel, puis changez le type de celle-ci.',
      );
    }
    if (input.directionDuPersonnel) {
      await tx
        .update(t.orgUnits)
        .set({ directionDuPersonnel: false, updatedAt: new Date() })
        .where(and(eq(t.orgUnits.directionDuPersonnel, true), sql`${t.orgUnits.id} <> ${id}`));
    }

    if (input.shortName !== undefined) {
      this.assertShortNameAllowed(nextType, input.shortName);
    } else if (input.unitType === 'direction' && !before!.shortName) {
      // Une unité qui devient direction prend son acronyme du même geste.
      this.assertShortNameAllowed(nextType, null);
    } else if (input.unitType !== undefined && nextType !== 'direction') {
      // Un département n'a pas d'acronyme : le déclassement l'efface.
      input = { ...input, shortName: null };
    }

    const ancien = before!.managerEmployeeId;
    const prochain = input.managerEmployeeId !== undefined ? input.managerEmployeeId : ancien;
    const responsableChange = input.managerEmployeeId !== undefined && prochain !== ancien;
    // Le sommet, après l'écriture : l'unité qui l'est déjà, ou celle qui le
    // devient faute d'autre. Un vestige d'avant la règle — une seconde unité
    // sans parent — n'est PAS le sommet : son responsable est un directeur.
    const estSommet = nextParent === null && (sommet ?? id) === id;
    const devientSommet = estSommet && before!.parentId !== null;
    const devientDirection =
      nextType === 'direction' && (input.unitType !== undefined || input.parentId !== undefined);
    // Diriger le sommet, c'est être le directeur général.
    const nouveauDG = estSommet && prochain !== null && (responsableChange || devientSommet);
    const nouveauDirecteur =
      !estSommet &&
      nextType === 'direction' &&
      prochain !== null &&
      (responsableChange || devientDirection);

    if (estSommet && responsableChange && prochain === null) {
      problem(
        422,
        'org.dg_requis',
        'La Direction Générale garde toujours un responsable',
        'On ne retire pas le directeur général : on désigne son successeur, qui reprend ce qui relevait de lui.',
      );
    }
    if (nouveauDG) {
      // Il siège à la Direction Générale — aujourd'hui, et sans mutation
      // programmée ailleurs : c'est là que ses collaborateurs directs relèvent
      // de lui, dans la même direction.
      await this.assertEmployeActif(tx, prochain);
      await exigerHorsStage(tx, prochain);
      if (await sortDuPerimetre(tx, prochain, id)) {
        problem(
          422,
          'org.dg_hors_direction_generale',
          'Affectez d’abord le futur directeur général à la Direction Générale',
          'D’abord l’affectation, ensuite la hiérarchie : il siège à la Direction Générale avant d’en prendre la tête.',
        );
      }
    } else if (input.managerEmployeeId) {
      await this.assertManagerEligible(tx, id, input.managerEmployeeId);
    }
    if (nouveauDirecteur && !(await directeurGeneral(tx))) {
      // ——— Un directeur relève du directeur général : il en faut un.
      problem(
        422,
        'org.aucun_directeur_general',
        'Désignez d’abord le directeur général',
        'Un directeur relève du directeur général : la Direction Générale a son responsable avant les directions.',
      );
    }

    // Re-rattacher une unité, ou en changer le type, déplace des PÉRIMÈTRES :
    // un responsable affecté dedans peut se retrouver hors de l'unité qu'il
    // dirige sans qu'aucune mutation d'employé n'ait eu lieu. Même invariant,
    // autre porte : relevé avant, vérifié après, sur l'arbre réel.
    const tetesAvant = await this.tetesHorsPerimetre(tx);

    const changes: Partial<typeof t.orgUnits.$inferInsert> = {};
    if (input.name !== undefined) changes.name = input.name;
    if (input.unitType !== undefined) changes.unitType = input.unitType;
    if (input.parentId !== undefined) changes.parentId = input.parentId;
    if (input.shortName !== undefined) changes.shortName = input.shortName;
    if (input.managerEmployeeId !== undefined) {
      changes.managerEmployeeId = input.managerEmployeeId;
    }
    if (input.directionDuPersonnel !== undefined) {
      changes.directionDuPersonnel = input.directionDuPersonnel;
    }
    if (Object.keys(changes).length === 0) return;
    changes.updatedAt = new Date();
    await tx.update(t.orgUnits).set(changes).where(eq(t.orgUnits.id, id));
    // La passation s'écrit dans les affectations : le nouveau prend le
    // poste de responsable, l'ancien celui qu'on lui donne.
    if (responsableChange) {
      await inscrireLaPassation(tx, user, {
        uniteId: id,
        nouveau: prochain,
        ancien,
        depuis: input.depuis,
        posteDeLAncien: input.posteDeLAncien,
      });
    }
    await this.assertAucuneTeteSortie(tx, tetesAvant);

    // ——— Les cascades : ce que la règle impose, une fois l'unité écrite.
    if (nouveauDG) {
      await apresNouveauDG(tx, journal, estSommet && !devientSommet ? ancien : null, prochain);
    } else if (nouveauDirecteur) {
      await apresNouveauDirecteur(tx, journal, id, responsableChange ? ancien : null, prochain);
    }
  }

  /**
   * Une direction a son acronyme (« DCH ») ; un département ou un service
   * n'en a pas (contrainte CHECK en 0012). Les directions d'avant la règle
   * gardent le leur vide tant qu'on ne touche ni à leur type ni à leur
   * acronyme.
   */
  private assertShortNameAllowed(unitType: OrgUnitType, shortName: string | null): void {
    if (!shortName && unitType === 'direction') {
      problem(
        422,
        'org.acronyme_requis',
        'Une direction a un acronyme',
        '« DCH » pour Direction du Capital Humain.',
      );
    }
    if (shortName && unitType !== 'direction') {
      problem(
        422,
        'org.short_name_direction_only',
        'Seule une direction porte un acronyme',
        'Un département ou un service se désigne par son nom complet.',
      );
    }
  }

  /**
   * Hiérarchie des types : une direction relève d'une autre direction ou de
   * rien, un département d'une direction, un service d'un département ou
   * d'une direction. La boucle, elle, se refuse dans `update` — seul un
   * re-rattachement peut en créer une.
   */
  private async assertParentAllowed(
    tx: Tx,
    unitType: OrgUnitType,
    parentId: string | null,
    selfId?: string,
  ): Promise<void> {
    const allowed = ORG_UNIT_PARENT_TYPES[unitType];
    if (!parentId) {
      // Sans parent : seul un type qui peut tenir le sommet est recevable.
      if (!ORG_UNIT_ROOT_TYPES.includes(unitType)) {
        problem(
          422,
          'org.parent_required',
          `Un ${ORG_UNIT_TYPE_LABELS[unitType].toLowerCase()} doit être rattaché`,
          `Rattachez-le à : ${allowed.map((a) => ORG_UNIT_TYPE_LABELS[a].toLowerCase()).join(' ou ')}.`,
        );
      }
      return;
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
   * Les responsables qui ne travaillent pas dans le PÉRIMÈTRE de l'unité
   * qu'ils dirigent — elle et ce qui en descend, sans ses sous-directions —,
   * aujourd'hui ou d'après une affectation déjà programmée.
   *
   * Contrôle d'INVARIANT, relevé avant l'écriture et relu APRÈS : vérifier
   * seulement avant demandait de simuler l'arbre futur, et c'est précisément
   * ce qui laissait passer un re-rattachement. On écrit, on relit l'état
   * réel, et l'on annule si l'opération a fait sortir quelqu'un. Seuls les
   * NOUVEAUX écarts arrêtent : une anomalie d'avant la règle ne bloque pas
   * une opération qui n'y est pour rien — le contrôle la signale ailleurs.
   */
  private async tetesHorsPerimetre(tx: Tx): Promise<TeteHorsPerimetre[]> {
    const { rows } = await tx.execute<TeteHorsPerimetre>(sql`
      WITH RECURSIVE perim AS (
        SELECT o.id AS tete, o.id FROM org_units o
         WHERE o.manager_employee_id IS NOT NULL AND o.deleted_at IS NULL
        UNION
        SELECT p.tete, c.id FROM org_units c JOIN perim p ON c.parent_id = p.id
         WHERE c.deleted_at IS NULL AND c.unit_type <> 'direction'
      )
      SELECT o.id AS unit_id, o.name, o.manager_employee_id AS employee_id,
             pe.given_name, pe.family_name, (o.id = ${SOMMET}) AS sommet
        FROM org_units o
        JOIN employees e ON e.id = o.manager_employee_id
        JOIN persons pe ON pe.id = e.person_id
       WHERE o.deleted_at IS NULL
         AND (
           NOT EXISTS (
             SELECT 1 FROM assignments a
              WHERE a.employee_id = o.manager_employee_id
                AND a.validity @> CURRENT_DATE
                AND a.org_unit_id IN (SELECT id FROM perim WHERE tete = o.id))
           OR EXISTS (
             SELECT 1 FROM assignments a
              WHERE a.employee_id = o.manager_employee_id
                AND (upper_inf(a.validity) OR upper(a.validity) > CURRENT_DATE)
                AND (a.org_unit_id IS NULL
                     OR a.org_unit_id NOT IN (SELECT id FROM perim WHERE tete = o.id)))
         )
       ORDER BY o.name`);
    return rows;
  }

  private async assertAucuneTeteSortie(tx: Tx, avant: TeteHorsPerimetre[]): Promise<void> {
    const connus = new Set(avant.map((r) => `${r.unit_id}:${r.employee_id}`));
    const rompu = (await this.tetesHorsPerimetre(tx)).find(
      (r) => !connus.has(`${r.unit_id}:${r.employee_id}`),
    );
    if (!rompu) return;
    if (rompu.sommet) {
      problem(
        422,
        'org.dg_hors_direction_generale',
        'Le directeur général sortirait de la Direction Générale',
        'Il siège à la Direction Générale : ce changement l’en ferait sortir. Désignez d’abord son successeur.',
      );
    }
    problem(
      422,
      'org.manager_would_leave_unit',
      `${rompu.given_name} ${rompu.family_name} dirige « ${rompu.name} »`,
      'Ce changement le sortirait de son unité. Désignez d’abord un successeur.',
    );
  }

  /**
   * Un seul sommet : la Direction Générale. Un second ferait deux « DG », et
   * toute la chaîne remonterait vers l'un ou l'autre au hasard.
   */
  private async assertSommetLibre(tx: Tx, sauf: string | null): Promise<void> {
    const [sommet] = await tx
      .select({ id: t.orgUnits.id, name: t.orgUnits.name })
      .from(t.orgUnits)
      .where(
        and(
          isNull(t.orgUnits.parentId),
          isNull(t.orgUnits.deletedAt),
          sauf ? sql`${t.orgUnits.id} <> ${sauf}` : sql`TRUE`,
        ),
      )
      .limit(1);
    if (sommet) {
      problem(
        422,
        'org.sommet_unique',
        `L’organigramme a déjà son sommet : « ${sommet.name} »`,
        'Rattachez cette unité sous la Direction Générale : il n’y a qu’un sommet, et son responsable est le directeur général.',
      );
    }
  }

  private async assertEmployeActif(tx: Tx, employeeId: string): Promise<void> {
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
        'Ce dossier est inactif.',
      );
    }
    // Son contrat arrivé à terme, il n'est plus de l'APIX — même si son
    // dossier n'est pas encore passé dans les inactifs.
    await exigerEnActivite(tx, employeeId, 'diriger une unité');
  }

  /**
   * Un responsable doit être un employé ACTIF, hors stage, et travailler dans le
   * PÉRIMÈTRE de l'unité qu'il dirige — elle ou ce qui en descend, sans ses
   * sous-directions, qui ont leur propre tête — sans mutation déjà
   * programmée ailleurs. Sans quoi l'organigramme affiche un chef parti
   * ailleurs, et ses agents relèvent d'une autre direction que la leur.
   */
  private async assertManagerEligible(tx: Tx, unitId: string, employeeId: string): Promise<void> {
    await this.assertEmployeActif(tx, employeeId);
    await exigerHorsStage(tx, employeeId);
    if (await sortDuPerimetre(tx, employeeId, unitId)) {
      problem(
        422,
        'org.manager_outside_unit',
        'Un responsable doit travailler dans l’unité qu’il dirige',
        'Affectez-le d’abord à cette unité, ou à une unité qui en dépend, sans mutation programmée ailleurs.',
      );
    }
  }

  /** Les personnes actuellement affectées à l'unité (annuaire interne). */
  /**
   * Les membres d'une unité : ceux que son effectif compte, tout son
   * périmètre. Qui travaille dans une sous-unité la nomme.
   */
  async members(user: SessionUser, id: string): Promise<OrgUnitMember[]> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      await this.requireUnit(tx, id, 'org.unit_not_found');
      const { rows } = await tx.execute<{
        employee_id: string;
        employee_number: string;
        given_name: string;
        family_name: string;
        position_title: string | null;
        unite: string | null;
      }>(sql`
        ${perimetre(id)}
        SELECT DISTINCT ON (p.family_name, p.given_name, e.id)
               e.id AS employee_id, e.employee_number, p.given_name, p.family_name,
               a.position_title,
               CASE WHEN a.org_unit_id = ${id} THEN NULL ELSE o.name END AS unite
          FROM assignments a
          JOIN employees e ON e.id = a.employee_id AND e.status = 'active'
          JOIN persons p ON p.id = e.person_id
          JOIN org_units o ON o.id = a.org_unit_id
         WHERE a.org_unit_id IN (SELECT id FROM perimetre)
           AND a.validity @> CURRENT_DATE
         ORDER BY p.family_name, p.given_name, e.id`);
      return rows.map((r) => ({
        employeeId: r.employee_id,
        employeeNumber: r.employee_number,
        givenName: r.given_name,
        familyName: r.family_name,
        positionTitle: r.position_title,
        unite: r.unite,
      }));
    });
  }

  /**
   * Qui peut diriger cette unité : exactement l'ensemble qu'accepte
   * `assertManagerEligible` — le formulaire ne doit pas proposer ce que le
   * serveur refusera. Actifs, hors stage, affectés dans le périmètre, sans
   * mutation programmée ailleurs, et qui ne dirigent pas déjà une autre unité.
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
        depuis: string;
      }>(sql`
        ${perimetre(id)}
        SELECT e.id AS employee_id, e.employee_number, p.given_name, p.family_name,
               a.position_title, lower(a.validity)::text AS depuis
        FROM assignments a
        JOIN employees e ON e.id = a.employee_id
        JOIN persons p ON p.id = e.person_id
        WHERE a.org_unit_id IN (SELECT id FROM perimetre)
          AND a.validity @> CURRENT_DATE
          AND e.status = 'active'
          AND NOT ${contratEchu(sql`e.id`)}
          AND NOT ${enStage(sql`e.id`)}
          AND NOT EXISTS (
            SELECT 1 FROM assignments ai
             WHERE ai.employee_id = e.id
               AND (upper_inf(ai.validity) OR upper(ai.validity) > CURRENT_DATE)
               AND (ai.org_unit_id IS NULL OR ai.org_unit_id NOT IN (SELECT id FROM perimetre)))
          AND NOT EXISTS (
            SELECT 1 FROM org_units h
             WHERE h.manager_employee_id = e.id AND h.deleted_at IS NULL AND h.id <> ${id})
        ORDER BY p.family_name, p.given_name`);
      return rows.rows.map((r) => ({
        employeeId: r.employee_id,
        employeeNumber: r.employee_number,
        givenName: r.given_name,
        familyName: r.family_name,
        positionTitle: r.position_title,
        depuis: r.depuis,
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
