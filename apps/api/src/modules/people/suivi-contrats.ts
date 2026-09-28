import { sql } from 'drizzle-orm';
import type { ContratArriveATerme, DashboardContractFollowUp } from '@teranga/contracts';
import type { Tx } from '../../db/tenant-db';

/**
 * Les contrats à durée limitée en cours — CDD et stages.
 *
 * Le contrat retenu est le PLUS RÉCENT de l'employé (DISTINCT ON) : un CDD
 * renouvelé en CDI quitte le suivi de lui-même. Les échéances dépassées
 * remontent en tête — un CDD échu sur un dossier resté actif est l'anomalie
 * la plus coûteuse de la liste. Le tableau de bord en montre les premiers ;
 * « Échéances de contrat », tous.
 */
export const requeteSuiviDesContrats = (limite: number | null) => sql`
  WITH dernier AS (
    SELECT DISTINCT ON (c.employee_id)
           c.employee_id, c.contract_type, c.end_date
    FROM contracts c
    ORDER BY c.employee_id, c.start_date DESC, c.created_at DESC
  )
  SELECT e.id AS employee_id, e.employee_number,
         p.given_name, p.family_name,
         d.contract_type, d.end_date::text AS end_date,
         (d.end_date - CURRENT_DATE)::int AS days_left,
         (SELECT a.position_title FROM assignments a
           WHERE a.employee_id = e.id AND a.validity @> CURRENT_DATE
           LIMIT 1) AS position_title
  FROM dernier d
  JOIN employees e ON e.id = d.employee_id AND e.status = 'active'
  JOIN persons p ON p.id = e.person_id
  WHERE d.contract_type IN ('cdd', 'stage')
  ORDER BY days_left ASC NULLS LAST, p.family_name, p.given_name
  ${limite === null ? sql`` : sql`LIMIT ${limite}`}`;

export async function suiviDesContrats(
  tx: Tx,
  limite: number | null = null,
): Promise<DashboardContractFollowUp[]> {
  const { rows } = await tx.execute<{
    employee_id: string;
    employee_number: string;
    given_name: string;
    family_name: string;
    contract_type: string;
    end_date: string | null;
    days_left: number | null;
    position_title: string | null;
  }>(requeteSuiviDesContrats(limite));
  return rows.map((c) => ({
    employeeId: c.employee_id,
    employeeNumber: c.employee_number,
    name: `${c.given_name} ${c.family_name}`,
    positionTitle: c.position_title,
    contractType: c.contract_type,
    endDate: c.end_date,
    daysLeft: c.days_left,
  }));
}

export async function compterLeSuiviDesContrats(tx: Tx): Promise<number> {
  const { rows } = await tx.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM (${requeteSuiviDesContrats(null)}) s`,
  );
  return rows[0]?.n ?? 0;
}

/** Les contrats arrivés à terme ces 90 derniers jours — leurs agents sont inactifs. */
export async function contratsArrivesATerme(tx: Tx): Promise<ContratArriveATerme[]> {
  const { rows } = await tx.execute<{
    employee_id: string;
    employee_number: string;
    given_name: string;
    family_name: string;
    contract_type: string;
    end_date: string;
  }>(sql`
    SELECT e.id AS employee_id, e.employee_number, p.given_name, p.family_name,
           c.contract_type, c.end_date::text AS end_date
      FROM employees e
      JOIN persons p ON p.id = e.person_id
      JOIN contracts c ON c.id = (SELECT dc.id FROM contracts dc WHERE dc.employee_id = e.id
                                   ORDER BY dc.start_date DESC, dc.created_at DESC LIMIT 1)
     WHERE e.status = 'archived' AND e.inactivite_motif = 'fin_de_contrat'
       AND c.end_date >= CURRENT_DATE - 90
     ORDER BY c.end_date DESC, p.family_name, p.given_name`);
  return rows.map((r) => ({
    employeeId: r.employee_id,
    employeeNumber: r.employee_number,
    name: `${r.given_name} ${r.family_name}`,
    contractType: r.contract_type,
    endDate: r.end_date,
  }));
}
