import { and, eq, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { ConsequencesHierarchie, NewAssignmentInput } from '@teranga/contracts';
import { problem } from '../../common/problem';
import * as t from '../../db/schema';
import type { Tx } from '../../db/tenant-db';
import { frDate } from '../acces/appels';
import { reconcilierLeCircuit } from '../time/visas';
import {
  directionDeUnite,
  perimetre,
  sortDuPerimetre,
  uniteRacine,
  verrouillerLaChaine,
} from './chaine';
import { dernierContrat, exigerEnActivite } from './en-activite';
import { lireLaChaine, nouvellesAnomalies } from './hierarchie.service';
import { recalculerLaChaine } from './recalcul-de-la-chaine';

/*
   La mutation d'un agent : depuis sa fiche, ou par le nouveau contrat qui
   lui donne une autre place, le jour où il commence.
*/

/** Ce que la mutation écrit : le poste est connu, saisi ou celui de responsable. */
export type Mutation = Omit<
  NewAssignmentInput,
  'positionTitle' | 'responsable' | 'posteDeLAncien' | 'devenirDeLAncien'
> & {
  positionTitle: string;
};

/**
 * Une affectation ne peut viser qu'une unité VIVANTE. Seule la clé étrangère
 * protégeait : elle accepte une unité dissoute, ce qui annulait la garantie
 * de la dissolution (les membres réaffectés y revenaient aussitôt).
 */
export async function exigerUniteVivante(tx: Tx, orgUnitId: string): Promise<void> {
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
 * Les refus viennent dans l'ordre où l'on corrige : d'abord qui dirige quoi
 * (le DG, la tête d'une unité), puis la date. Le N+1 hiérarchique se
 * recalcule ensuite à partir de l'organigramme (ADR-0147) : rien à choisir,
 * ni pour l'agent ni pour son équipe, et une mutation vers une autre
 * direction peut se programmer : la chaîne change le jour venu.
 *
 * `parContrat` : la place vient d'un nouveau contrat. Changer ainsi de
 * direction vaut départ : les unités dirigées par l'agent restent sans tête
 * (le premier niveau occupé au-dessus reprend leurs agents). Le DG reste à
 * la Direction Générale.
 *
 * `responsable` : il prend la tête de l'unité dans la même opération.
 * L'appelant le désigne ensuite, puis recalcule la chaîne.
 */
export async function muter(
  tx: Tx,
  tenantId: string,
  id: string,
  input: Mutation,
  { parContrat = false, responsable = false }: { parContrat?: boolean; responsable?: boolean } = {},
): Promise<ConsequencesHierarchie> {
  await exigerEnActivite(tx, id, 'recevoir d’affectation');
  await verrouillerLaChaine(tx);
  const [dossier] = await tx
    .select({ id: t.employees.id })
    .from(t.employees)
    .where(eq(t.employees.id, id))
    .limit(1);
  if (!dossier) problem(404, 'people.employee_not_found', 'Employé introuvable');
  if (input.orgUnitId) await exigerUniteVivante(tx, input.orgUnitId);
  const avant = await lireLaChaine(tx);

  // 1. Le directeur général siège à la Direction Générale : il n'en
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

  // 2. Un responsable ne quitte pas le périmètre de l'unité qu'il
  // dirige sans qu'un successeur soit désigné : sinon l'organigramme
  // affiche un chef parti ailleurs. On refuse plutôt que de le retirer
  // en douce : la RH décide qui reprend l'unité. Par un nouveau contrat,
  // il part : l'unité le perd (plus bas).
  const [dirigee] = await tx
    .select({ id: t.orgUnits.id, name: t.orgUnits.name })
    .from(t.orgUnits)
    .where(and(eq(t.orgUnits.managerEmployeeId, id), isNull(t.orgUnits.deletedAt)))
    .limit(1);
  if (dirigee && !parContrat) {
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

  // L'écriture : on clôt l'affectation courante, on ouvre la neuve.
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
        `L’affectation en cours a commencé le ${frDate(current.validFrom)} : la nouvelle commence au plus tôt le lendemain.`,
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
    tenantId,
    employeeId: id,
    orgUnitId: input.orgUnitId ?? null,
    positionTitle: input.positionTitle,
    responsable,
    validity: `[${input.startDate},)`,
  });

  if (parContrat) {
    // Un départ : les unités quittées n'ont plus de tête, et leurs agents
    // relèvent du premier niveau occupé au-dessus.
    const { rows: dirigees } = await tx.execute<{ id: string }>(sql`
      SELECT id FROM org_units WHERE manager_employee_id = ${id} AND deleted_at IS NULL`);
    for (const u of dirigees) {
      if (!(await sortDuPerimetre(tx, id, u.id))) continue;
      await tx.execute(sql`
        UPDATE org_units SET manager_employee_id = NULL, updated_at = now() WHERE id = ${u.id}`);
    }
  } else if (dirigee && (await sortDuPerimetre(tx, id, dirigee.id))) {
    // Relu sur l'état écrit : une affectation déjà programmée ailleurs ferait
    // sortir plus tard l'agent de l'unité dirigée.
    problem(
      422,
      'people.manager_cannot_leave_unit',
      `Cet agent dirige « ${dirigee.name} »`,
      'Désignez d’abord une autre tête pour cette unité, puis reprenez la mutation.',
    );
  }

  // Sa désignation suit, dans la même opération : l'appelant recalcule ensuite.
  if (responsable) return { changements: [], aRevoir: [] };
  const changements = await recalculerLaChaine(tx, tenantId);
  await reconcilierLeCircuit(tx, tenantId);
  return { changements, aRevoir: nouvellesAnomalies(avant, await lireLaChaine(tx)) };
}
