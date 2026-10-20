import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  bloqueLEvaluation,
  type AnomalieHierarchie,
  type ChangementParLaRegle,
  type ControleHierarchie,
  type SessionUser,
} from '@teranga/contracts';
import { problem } from '../../common/problem';
import { TenantDb, type Tx } from '../../db/tenant-db';
import { pasResponsableDeSoi } from '../acces/dch';
import { reconcilierLeCircuit } from '../time/visas';
import { calculerLaChaine } from './calcul-de-la-chaine';
import {
  directionDeLUnite,
  nomsDe,
  photographierLaChaine,
  SOMMET,
  sortDuPerimetre,
  uniteEnVigueur,
  validerN1Fonctionnel,
} from './chaine';
import { compterParType, trierAnomalies } from './hierarchie';
import { recalculerLaChaine } from './recalcul-de-la-chaine';

/* ————————————————————————————————————————————————————————————————
   Le contrôle de la chaîne (ADR-0147).

   Le N+1 hiérarchique se calcule à partir de l'organigramme : le contrôle ne
   signale que ce qui EMPÊCHE de le calculer (un agent sans unité, l'absence
   de DG, le DG hors de la Direction Générale) et ce que la structure a de
   travers (deux sommets, une direction hors de la Direction Générale). Il
   liste aussi, une fois, les agents dont la règle a changé le N+1.
   ———————————————————————————————————————————————————————————————— */

@Injectable()
export class HierarchieService {
  constructor(@Inject(TenantDb) private readonly db: TenantDb) {}

  async controle(user: SessionUser): Promise<ControleHierarchie> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      const { dg, effectif, anomalies, attendu } = await lireLaChaine(tx);
      const { rows: sommets } = await tx.execute<{ name: string }>(sql`
        SELECT name FROM org_units
         WHERE parent_id IS NULL AND deleted_at IS NULL
         ORDER BY created_at, id`);
      const { rows: horsDG } = await tx.execute<{ name: string }>(sql`
        SELECT name FROM org_units
         WHERE unit_type = 'direction' AND deleted_at IS NULL AND parent_id IS NOT NULL
           AND parent_id IS DISTINCT FROM ${SOMMET}
         ORDER BY name`);
      return {
        directeurGeneral: dg,
        sommetsMultiples: sommets.length > 1 ? sommets.map((r) => r.name) : [],
        directionsHorsDG: horsDG.map((r) => r.name),
        effectif,
        anomalies,
        parType: compterParType(anomalies),
        nonEvaluables: anomalies.filter((a) => bloqueLEvaluation(a.type) && !a.responsable).length,
        changesParLaRegle: await changesParLaRegle(tx, attendu),
      };
    });
  }

  /**
   * Revoir un N+1 que la règle a changé : garder l'ancien comme N+1
   * fonctionnel, ou s'en tenir au nouveau. Dans les deux cas, l'agent quitte
   * la liste.
   */
  async revoir(user: SessionUser, employeeId: string, garder: boolean): Promise<void> {
    await this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      const { rows } = await tx.execute<{ avant: string | null; n1: string | null }>(sql`
        SELECT n1_avant_la_regle AS avant, manager_employee_id AS n1
          FROM employees WHERE id = ${employeeId} FOR UPDATE`);
      const r = rows[0];
      if (!r) problem(404, 'people.employee_not_found', 'Cet agent n’existe pas');
      if (garder && r.avant && r.avant !== r.n1) {
        await pasResponsableDeSoi(tx, user.userId, r.avant, r.n1);
        await validerN1Fonctionnel(tx, employeeId, r.avant);
        await tx.execute(sql`
          UPDATE employees SET n1_fonctionnel_employee_id = ${r.avant}, updated_at = now()
           WHERE id = ${employeeId}`);
      }
      await tx.execute(sql`UPDATE employees SET n1_avant_la_regle = NULL WHERE id = ${employeeId}`);
      if (garder) {
        await recalculerLaChaine(tx, user.tenantId);
        await reconcilierLeCircuit(tx, user.tenantId);
      }
    });
  }
}

/**
 * La chaîne telle que l'organigramme la donne, et ce qui empêche de la
 * calculer. Lue par le contrôle, et par l'aperçu d'une réorganisation :
 * avant et après, pour dire qui l'opération laisserait sans N+1.
 */
export async function lireLaChaine(tx: Tx) {
  const photo = await photographierLaChaine(tx);
  const resultat = calculerLaChaine(photo);
  const attendu = new Map([...resultat.hierarchique].map(([id, n]) => [id, n.id]));
  const { rows } = await tx.execute<{
    id: string;
    matricule: string;
    nom: string;
    direction: string | null;
    fonctionnel: string | null;
    fonctionnel_direction: string | null;
  }>(sql`
    SELECT e.id, e.employee_number AS matricule,
           p.given_name || ' ' || p.family_name AS nom,
           ${directionDeLUnite(uniteEnVigueur(sql`e.id`), 'name')} AS direction,
           fp.given_name || ' ' || fp.family_name AS fonctionnel,
           ${directionDeLUnite(uniteEnVigueur(sql`f.id`), 'name')} AS fonctionnel_direction
      FROM employees e
      JOIN persons p ON p.id = e.person_id
      LEFT JOIN employees f ON f.id = e.n1_fonctionnel_employee_id
      LEFT JOIN persons fp ON fp.id = f.person_id
     WHERE e.status = 'active'
     ORDER BY e.employee_number`);
  const infos = new Map(rows.map((r) => [r.id, r]));
  const anomalies: AnomalieHierarchie[] = [];
  const signaler = (id: string, type: AnomalieHierarchie['type']) => {
    const i = infos.get(id);
    if (!i) return;
    anomalies.push({
      employeeId: id,
      matricule: i.matricule,
      nom: i.nom,
      direction: i.direction,
      type,
      responsable: i.fonctionnel,
      directionDuResponsable: i.fonctionnel_direction,
    });
  };
  for (const [id, n] of resultat.hierarchique) {
    if (n.motif === 'sans_unite' || n.motif === 'sans_dg') signaler(id, n.motif);
  }
  const dgId = dgDe(photo);
  if (dgId && photo.sommetId && (await sortDuPerimetre(tx, dgId, photo.sommetId))) {
    signaler(dgId, 'dg_hors_direction_generale');
  }
  const dg = dgId ? { employeeId: dgId, nom: infos.get(dgId)?.nom ?? '' } : null;
  return { dg, effectif: rows.length, anomalies: trierAnomalies(anomalies), attendu };
}

/** Le DG : la tête du sommet, quand l'agent est actif. */
function dgDe(photo: Awaited<ReturnType<typeof photographierLaChaine>>): string | null {
  const tete = photo.unites.find((u) => u.id === photo.sommetId)?.teteId ?? null;
  return tete && photo.agents.some((a) => a.id === tete) ? tete : null;
}

/**
 * Les anomalies qu'une opération fait APPARAÎTRE : celles d'avant ne sont
 * pas les siennes.
 */
export function nouvellesAnomalies(
  avant: { anomalies: AnomalieHierarchie[] },
  apres: { anomalies: AnomalieHierarchie[] },
): AnomalieHierarchie[] {
  const cle = (a: AnomalieHierarchie) => `${a.employeeId}:${a.type}`;
  const connues = new Set(avant.anomalies.map(cle));
  return apres.anomalies.filter((a) => !connues.has(cle(a)));
}

/**
 * Les agents dont la règle de l'ADR-0147 a changé le N+1, tant que la DCH
 * ne les a pas revus : l'ancien est encore en activité, rien n'a été choisi
 * comme N+1 fonctionnel, et le N+1 que l'organigramme donne n'est plus le
 * même.
 */
async function changesParLaRegle(
  tx: Tx,
  attendu: Map<string, string | null>,
): Promise<ChangementParLaRegle[]> {
  const { rows } = await tx.execute<{
    id: string;
    matricule: string;
    nom: string;
    avant: string;
  }>(sql`
    SELECT e.id, e.employee_number AS matricule,
           p.given_name || ' ' || p.family_name AS nom, e.n1_avant_la_regle AS avant
      FROM employees e
      JOIN persons p ON p.id = e.person_id
      JOIN employees a ON a.id = e.n1_avant_la_regle AND a.status = 'active'
     WHERE e.status = 'active' AND e.n1_fonctionnel_employee_id IS NULL
     ORDER BY e.employee_number`);
  const changes = rows.filter((r) => attendu.has(r.id) && attendu.get(r.id) !== r.avant);
  const noms = await nomsDe(tx, [
    ...changes.map((r) => r.avant),
    ...changes.map((r) => attendu.get(r.id) ?? null),
  ]);
  return changes.map((r) => {
    const apres = attendu.get(r.id) ?? null;
    return {
      employeeId: r.id,
      matricule: r.matricule,
      nom: r.nom,
      avant: { id: r.avant, nom: noms.get(r.avant) ?? '' },
      apres: apres ? { id: apres, nom: noms.get(apres) ?? '' } : null,
    };
  });
}
