import { sql } from 'drizzle-orm';
import type { DashboardContractFollowUp } from '@teranga/contracts';
import type { Tx } from '../../db/tenant-db';

/**
 * Les contrats à durée limitée en cours — CDD et stages.
 *
 * Le contrat retenu est le PLUS RÉCENT de l'employé (DISTINCT ON) : un CDD
 * renouvelé en CDI quitte le suivi de lui-même. Les échéances dépassées
 * remontent en tête — un CDD échu sur un dossier resté actif est l'anomalie
 * la plus coûteuse de la liste. Le tableau de bord les montre tous.
 */
const requeteSuiviDesContrats = sql`
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
  ORDER BY days_left ASC NULLS LAST, p.family_name, p.given_name`;

export async function suiviDesContrats(tx: Tx): Promise<DashboardContractFollowUp[]> {
  const { rows } = await tx.execute<{
    employee_id: string;
    employee_number: string;
    given_name: string;
    family_name: string;
    contract_type: string;
    end_date: string | null;
    days_left: number | null;
    position_title: string | null;
  }>(requeteSuiviDesContrats);
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
