import { and, eq, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type {
  ChangementRattachement,
  ConsequencesHierarchie,
  NewAssignmentInput,
} from '@teranga/contracts';
import { problem, ProblemException } from '../../common/problem';
import * as t from '../../db/schema';
import type { Tx } from '../../db/tenant-db';
import { frDate } from '../acces/appels';
import { reconcilierLeCircuit } from '../time/visas';
import {
  directionDeEmploye,
  directionDeUnite,
  equipeDe,
  n1DOffice,
  perimetre,
  rattacher,
  rattacherDOffice,
  reprendreEquipe,
  sortDuPerimetre,
  uniteRacine,
  validerRattachement,
  verrouillerLaChaine,
} from './chaine';
import { dernierContrat, exigerEnActivite } from './en-activite';
import { lireLaChaine, nouvellesAnomalies } from './hierarchie.service';

/*
   La mutation d'un agent : depuis sa fiche, ou par le nouveau contrat qui
   lui donne une autre place, le jour où il commence.
*/

/** Ce que la mutation écrit : le poste est connu, saisi ou celui de responsable. */
export type Mutation = Omit<
  NewAssignmentInput,
  'positionTitle' | 'responsable' | 'posteDeLAncien'
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
 * La chaîne hiérarchique doit y survivre, et les refus viennent dans
 * l'ordre où l'on corrige : d'abord qui dirige quoi (le DG, un responsable
 * d'unité), puis la date, puis l'équipe, puis son propre n+1.
 *
 * `parContrat` : la place vient d'un nouveau contrat. Qui change ainsi de
 * direction part, comme un départ : les unités qu'il dirigeait restent sans
 * responsable (le contrôle de la chaîne les signale), son équipe remonte
 * d'un cran, à son propre n+1, sinon au responsable de sa direction ; et
 * faute de responsable dans sa nouvelle direction, il garde son n+1, que
 * le contrôle signale aussi. Le directeur général, lui, reste à la
 * Direction Générale.
 *
 * `responsable` : il prend la tête de l'unité dans la même opération.
 * L'appelant le désigne ensuite, puis relit le circuit : le n+1 d'un
 * responsable, c'est la désignation qui le pose.
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
    .select({ managerId: t.employees.managerEmployeeId })
    .from(t.employees)
    .where(eq(t.employees.id, id))
    .limit(1);
  if (!dossier) problem(404, 'people.employee_not_found', 'Employé introuvable');
  if (input.orgUnitId) await exigerUniteVivante(tx, input.orgUnitId);
  const avant = await lireLaChaine(tx);
  const journal: ChangementRattachement[] = [];

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

  // 3. Le n+1 n'est pas daté : il vaut dès aujourd'hui. Une mutation
  // PROGRAMMÉE vers une autre direction laisserait donc la chaîne
  // fausse jusqu'à la date, ou fausse après : selon qu'on change le
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

  // 4. L'équipe, confiée si l'on en désigne le repreneur.
  if (input.repreneurEquipeId) {
    await reprendreEquipe(tx, journal, id, input.repreneurEquipeId);
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
    tenantId,
    employeeId: id,
    orgUnitId: input.orgUnitId ?? null,
    positionTitle: input.positionTitle,
    responsable,
    validity: `[${input.startDate},)`,
  });

  if (parContrat) {
    // Il part : les unités qu'il quitte n'ont plus de responsable, et
    // son équipe remonte d'un cran, ou passe au responsable de sa
    // direction. Celui qu'aucune règle n'accueille reste rattaché à lui,
    // et le contrôle de la chaîne le signale.
    const { rows: dirigees } = await tx.execute<{ id: string }>(sql`
      SELECT id FROM org_units WHERE manager_employee_id = ${id} AND deleted_at IS NULL`);
    for (const u of dirigees) {
      if (!(await sortDuPerimetre(tx, id, u.id))) continue;
      await tx.execute(sql`
        UPDATE org_units SET manager_employee_id = NULL, updated_at = now() WHERE id = ${u.id}`);
    }
    for (const m of await equipeDe(tx, id)) {
      if (await tenait(m.id, id)) continue;
      const candidats = [
        [dossier.managerId, 'reprise_equipe'],
        [(await n1DOffice(tx, m.id))?.id ?? null, 'responsable_de_sa_direction'],
      ] as const;
      for (const [cible, motif] of candidats) {
        if (!cible || cible === id || !(await tenait(m.id, cible))) continue;
        await rattacher(tx, journal, m.id, cible, motif);
        break;
      }
    }
  } else {
    // Relu sur l'état écrit. Le responsable d'unité, d'abord : une
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
  }

  // 5. Son n+1 : le nouveau, désigné dans le même geste : changer de
  // direction rend l'ancien caduc, et le corriger avant serait refusé
  // (il ne serait pas encore de la direction de l'agent), ou celui
  // qu'il garde, s'il tient toujours. Sinon, le responsable de sa
  // nouvelle direction le reprend d'office, s'il y en a un.
  if (responsable) {
    // Il prend la tête de l'unité : son n+1 est celui qu'impose sa place
    // (le DG pour un directeur, l'unité au-dessus pour un chef), et c'est
    // sa désignation qui l'y rattache.
  } else if (input.managerEmployeeId) {
    await validerRattachement(tx, id, input.managerEmployeeId, await directionDeEmploye(tx, id));
    await tx
      .update(t.employees)
      .set({ managerEmployeeId: input.managerEmployeeId, updatedAt: new Date() })
      .where(eq(t.employees.id, id));
  } else if (n1Garde && n1GardeEnRegle && !(await tenait(id, n1Garde))) {
    const direction = await directionDeEmploye(tx, id);
    if (!direction && !parContrat) {
      problem(
        422,
        'people.mutation_sans_direction',
        'Un agent rattaché à un n+1 reste affecté à une direction',
        'Choisissez une unité rattachée à une direction, ou retirez d’abord son n+1.',
      );
    }
    const tete = direction ? await n1DOffice(tx, id) : null;
    if (tete && (await tenait(id, tete.id))) {
      await rattacher(tx, journal, id, tete.id, tete.motif);
    } else if (!parContrat) {
      problem(
        422,
        'people.responsable_hors_nouvelle_direction',
        'Le responsable actuel n’appartient pas à la nouvelle direction',
        `L’agent rejoint « ${direction!.nom} » : désignez son nouveau responsable dans la même opération.`,
      );
    }
  } else if (!dossier.managerId && !futur) {
    await rattacherDOffice(tx, journal, id);
  }

  // Sa désignation suit, dans la même opération : l'appelant relit ensuite.
  if (responsable) return { changements: journal, aRevoir: [] };
  await reconcilierLeCircuit(tx, tenantId);
  return {
    changements: journal,
    aRevoir: nouvellesAnomalies(avant, await lireLaChaine(tx)),
  };
}
