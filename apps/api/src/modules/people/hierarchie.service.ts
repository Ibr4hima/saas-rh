import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { bloqueLEvaluation, type ControleHierarchie, type SessionUser } from '@teranga/contracts';
import { TenantDb, type Tx } from '../../db/tenant-db';
import { classerAnomalies, compterParType, type LigneHierarchie } from './hierarchie';

/* ————————————————————————————————————————————————————————————————
   La chaîne hiérarchique : sa lecture, et son contrôle.

   Ce service ne connaît qu'une chose, mais tout le module d'évaluation en
   dépendra : QUI RELÈVE DE QUI, et dans quelle direction. Les deux règles de
   l'APIX — un n+1 pour tous sauf le directeur général, et ce n+1 dans la même
   direction — sont écrites au contrat (`hierarchie.ts` des contrats) ; ici on
   les VÉRIFIE sur les données réelles.

   L'organigramme se lit en UNE requête : remonter d'unité en unité jusqu'à la
   direction, pour chaque agent et pour son n+1. Le jugement, lui, est une
   fonction pure — c'est elle qu'on éprouve, boucles comprises.
   ———————————————————————————————————————————————————————————————— */

/** La direction d'une unité : elle-même si c'en est une, sinon son aïeule. */
const DIRECTION_DES_UNITES = sql`
  remontee AS (
    SELECT id AS depart, id, parent_id, unit_type, name, 0 AS prof
      FROM org_units WHERE deleted_at IS NULL
    UNION ALL
    SELECT r.depart, o.id, o.parent_id, o.unit_type, o.name, r.prof + 1
      FROM remontee r
      JOIN org_units o ON o.id = r.parent_id AND o.deleted_at IS NULL
  ),
  direction_de AS (
    SELECT DISTINCT ON (depart) depart AS unite_id, id AS direction_id, name AS direction_nom
      FROM remontee WHERE unit_type = 'direction'
     ORDER BY depart, prof
  )`;

interface LigneBrute extends Record<string, unknown> {
  employee_id: string;
  matricule: string;
  nom: string;
  direction_id: string | null;
  direction_nom: string | null;
  responsable_id: string | null;
  responsable_nom: string | null;
  responsable_statut: string | null;
  responsable_direction_id: string | null;
  responsable_direction_nom: string | null;
  dirige_une_direction: boolean;
  est_directeur_general: boolean;
}

@Injectable()
export class HierarchieService {
  constructor(@Inject(TenantDb) private readonly db: TenantDb) {}

  async controle(user: SessionUser): Promise<ControleHierarchie> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      const lignes = await this.photo(tx);
      // Le directeur général est le responsable de l'unité RACINE. Il n'est
      // pas désigné par un rôle ni par une case à cocher : l'organigramme le
      // dit déjà, et deux sources se contrediraient.
      const dg = lignes.find((l) => l.estDirecteurGeneral) ?? null;
      const anomalies = classerAnomalies(lignes, dg?.employeeId ?? null);
      return {
        directeurGeneral: dg ? { employeeId: dg.employeeId, nom: dg.nom } : null,
        effectif: lignes.length,
        anomalies,
        parType: compterParType(anomalies),
        nonEvaluables: anomalies.filter((a) => bloqueLEvaluation(a.type)).length,
      };
    });
  }

  /** La photo des agents ACTIFS : leur direction, leur n+1, et la sienne. */
  private async photo(tx: Tx): Promise<LigneHierarchie[]> {
    const rows = await tx.execute<LigneBrute>(sql`
      WITH RECURSIVE ${DIRECTION_DES_UNITES},
      racine AS (
        SELECT manager_employee_id AS employee_id
          FROM org_units
         WHERE parent_id IS NULL AND deleted_at IS NULL AND manager_employee_id IS NOT NULL
      ),
      directions AS (
        SELECT DISTINCT manager_employee_id AS employee_id
          FROM org_units
         WHERE unit_type = 'direction' AND deleted_at IS NULL AND manager_employee_id IS NOT NULL
      )
      SELECT
        e.id                                    AS employee_id,
        e.employee_number                       AS matricule,
        p.given_name || ' ' || p.family_name    AS nom,
        d.direction_id,
        d.direction_nom,
        e.manager_employee_id                   AS responsable_id,
        rp.given_name || ' ' || rp.family_name  AS responsable_nom,
        r.status                                AS responsable_statut,
        rd.direction_id                         AS responsable_direction_id,
        rd.direction_nom                        AS responsable_direction_nom,
        (e.id IN (SELECT employee_id FROM directions)) AS dirige_une_direction,
        (e.id IN (SELECT employee_id FROM racine))     AS est_directeur_general
      FROM employees e
      JOIN persons p ON p.id = e.person_id
      LEFT JOIN assignments a ON a.employee_id = e.id AND a.validity @> CURRENT_DATE
      LEFT JOIN direction_de d ON d.unite_id = a.org_unit_id
      LEFT JOIN employees r ON r.id = e.manager_employee_id
      LEFT JOIN persons rp ON rp.id = r.person_id
      LEFT JOIN assignments ra ON ra.employee_id = r.id AND ra.validity @> CURRENT_DATE
      LEFT JOIN direction_de rd ON rd.unite_id = ra.org_unit_id
      WHERE e.status = 'active'
      ORDER BY e.employee_number`);

    return rows.rows.map((r) => ({
      employeeId: r.employee_id,
      matricule: r.matricule,
      nom: r.nom,
      directionId: r.direction_id,
      directionNom: r.direction_nom,
      responsableId: r.responsable_id,
      responsableNom: r.responsable_nom,
      responsableActif: r.responsable_statut === null ? null : r.responsable_statut === 'active',
      responsableDirectionId: r.responsable_direction_id,
      responsableDirectionNom: r.responsable_direction_nom,
      dirigeUneDirection: r.dirige_une_direction,
      estDirecteurGeneral: r.est_directeur_general,
    }));
  }
}
