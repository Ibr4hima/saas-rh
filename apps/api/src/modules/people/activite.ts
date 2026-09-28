import { sql, type SQL } from 'drizzle-orm';
import type { ChangementRattachement } from '@teranga/contracts';
import { ProblemException } from '../../common/problem';
import type { Tx } from '../../db/tenant-db';
import { frDate } from '../acces/appels';
import { alerterLaDCH } from '../acces/dch';
import { reconcilierDemande, reconcilierLeCircuit } from '../time/visas';
import {
  directionDeEmploye,
  equipeDe,
  rattacher,
  validerRattachement,
  verrouillerLaChaine,
} from './chaine';
import { dernierContrat } from './en-activite';

/* ————————————————————————————————————————————————————————————————
   La fin de contrat, d'elle-même : les dossiers des contrats arrivés à
   terme passent dans les inactifs (cf. en-activite.ts pour la règle).
   ———————————————————————————————————————————————————————————————— */

const TYPES: Record<string, string> = { cdd: 'CDD', stage: 'Stage' };

/**
 * L'activité s'arrête : le dernier jour se note au dossier, et sa dernière
 * affectation s'arrête ce jour-là — une affectation prévue après n'aura pas
 * lieu. `fin` : le dernier jour, en SQL (une date).
 */
export async function arreterLActivite(tx: Tx, employeeId: string, fin: SQL): Promise<void> {
  await tx.execute(sql`UPDATE employees SET fin_activite = ${fin} WHERE id = ${employeeId}`);
  await tx.execute(sql`
    DELETE FROM assignments WHERE employee_id = ${employeeId} AND lower(validity) > ${fin}`);
  await tx.execute(sql`
    UPDATE assignments SET validity = daterange(lower(validity), (${fin})::date + 1)
     WHERE employee_id = ${employeeId}
       AND (upper_inf(validity) OR upper(validity) > (${fin})::date + 1)`);
}

/**
 * L'activité reprend : l'agent retrouve le poste et l'unité de sa dernière
 * affectation — une affectation neuve, qui commence au lendemain de son
 * dernier jour, ou au début de son nouveau contrat s'il est plus tard. Une
 * unité dissoute entre-temps ne revient pas : l'affectation est alors sans
 * unité, et le contrôle de la chaîne le signale.
 */
export async function reprendreLActivite(
  tx: Tx,
  tenantId: string,
  employeeId: string,
): Promise<void> {
  const { rows } = await tx.execute<{
    fin: string | null;
    poste: string | null;
    unite: string | null;
    debut: string | null;
  }>(sql`
    SELECT e.fin_activite::text AS fin, a.position_title AS poste,
           (SELECT o.id FROM org_units o WHERE o.id = a.org_unit_id AND o.deleted_at IS NULL) AS unite,
           GREATEST(e.fin_activite + 1,
                    (SELECT c.start_date FROM contracts c WHERE c.id = ${dernierContrat(employeeId)}))::text
             AS debut
      FROM employees e
      LEFT JOIN assignments a ON a.id = (SELECT ax.id FROM assignments ax WHERE ax.employee_id = e.id
                                          ORDER BY lower(ax.validity) DESC LIMIT 1)
     WHERE e.id = ${employeeId}`);
  const r = rows[0];
  await tx.execute(sql`UPDATE employees SET fin_activite = NULL WHERE id = ${employeeId}`);
  if (!r?.fin || !r.poste || !r.debut) return;
  const { rows: ouverte } = await tx.execute(sql`
    SELECT 1 FROM assignments WHERE employee_id = ${employeeId}
       AND (upper_inf(validity) OR upper(validity) > CURRENT_DATE) LIMIT 1`);
  if (ouverte.length > 0) return;
  await tx.execute(sql`
    INSERT INTO assignments (id, tenant_id, employee_id, org_unit_id, position_title, validity)
    VALUES (gen_random_uuid(), ${tenantId}, ${employeeId}, ${r.unite}, ${r.poste},
            daterange(${r.debut}::date, NULL))`);
}

/**
 * Les contrats arrivés à terme : leurs agents passent dans les inactifs.
 *
 * Ce qu'un départ ordonné demanderait à la DCH — un successeur à la tête de
 * l'unité, un repreneur pour l'équipe —, la date ne l'attend pas :
 *   — une unité qu'il dirigeait reste sans responsable (le contrôle de la
 *     chaîne la signale) ;
 *   — son équipe remonte d'un cran, à son propre n+1, si la règle le
 *     permet ; sinon elle attend un n+1 ;
 *   — ses demandes de congé en attente sont annulées, ses sessions fermées.
 * Qui suit les échéances pour la DCH l'apprend, avec ce qui reste à faire.
 * Rend le nombre de dossiers passés dans les inactifs.
 */
export async function inactiverLesContratsEchus(tx: Tx, tenantId: string): Promise<number> {
  const { rows } = await tx.execute<{
    id: string;
    nom: string;
    contrat: string;
    type: string;
    fin: string;
    user_id: string | null;
    n1: string | null;
  }>(sql`
    SELECT e.id, p.given_name || ' ' || p.family_name AS nom, c.id AS contrat,
           c.contract_type AS type, c.end_date::text AS fin, p.user_id,
           e.manager_employee_id AS n1
      FROM employees e
      JOIN persons p ON p.id = e.person_id
      JOIN contracts c ON c.id = ${dernierContrat(sql`e.id`)}
     WHERE e.status = 'active' AND c.end_date < CURRENT_DATE
     ORDER BY c.end_date, e.id`);
  if (rows.length === 0) return 0;
  await verrouillerLaChaine(tx);

  for (const a of rows) {
    const equipe = await equipeDe(tx, a.id);

    // Le lendemain de son dernier jour : c'est de là qu'il est inactif.
    await tx.execute(sql`
      UPDATE employees
         SET status = 'archived', inactivite_motif = 'fin_de_contrat',
             archived_at = (${a.fin}::date + 1)::timestamptz, updated_at = now()
       WHERE id = ${a.id}`);
    await arreterLActivite(tx, a.id, sql`${a.fin}::date`);
    const { rows: unites } = await tx.execute<{ name: string }>(sql`
      UPDATE org_units SET manager_employee_id = NULL, updated_at = now()
       WHERE manager_employee_id = ${a.id} AND deleted_at IS NULL
      RETURNING name`);

    // L'équipe remonte d'un cran — rattachement par rattachement, sous la règle.
    const journal: ChangementRattachement[] = [];
    let reprise = 0;
    if (a.n1) {
      for (const m of equipe) {
        try {
          await validerRattachement(tx, m.id, a.n1, await directionDeEmploye(tx, m.id));
          await rattacher(tx, journal, m.id, a.n1, 'reprise_equipe');
          reprise += 1;
        } catch (err) {
          if (!(err instanceof ProblemException)) throw err;
        }
      }
    }

    const { rows: annulees } = await tx.execute<{ id: string }>(sql`
      UPDATE absence_requests SET status = 'cancelled', decided_at = now()
       WHERE employee_id = ${a.id} AND status = 'pending'
      RETURNING id`);
    for (const d of annulees) await reconcilierDemande(tx, d.id);
    if (a.user_id) {
      await tx.execute(sql`
        UPDATE sessions SET revoked_at = now()
         WHERE user_id = ${a.user_id} AND tenant_id = ${tenantId} AND revoked_at IS NULL`);
    }

    const suite: string[] = [];
    if (unites.length > 0) {
      const noms = unites.map((u) => `« ${u.name} »`).join(', ');
      suite.push(`${noms} n’a plus de responsable : nommez un successeur.`);
    }
    if (equipe.length > 0) {
      const n1 = reprise > 0 ? journal[0]?.apres : null;
      suite.push(
        reprise === equipe.length && n1
          ? `Son équipe relève désormais de ${n1}.`
          : `Son équipe attend un nouveau n+1 (${equipe.length - reprise} agent${equipe.length - reprise > 1 ? 's' : ''}).`,
      );
    }
    await alerterLaDCH(
      tx,
      tenantId,
      'contrats.echeances',
      {
        type: 'contract_ended',
        title: `Contrat de ${a.nom} arrivé à terme`,
        body: [
          `${TYPES[a.type] ?? 'Contrat'} terminé le ${frDate(a.fin)} : le dossier est passé dans les inactifs et l’accès au portail est fermé.`,
          ...suite,
        ].join(' '),
        link: '/contrats',
        dedupeKey: `contrat_termine:${a.contrat}`,
      },
      a.id,
    );
  }
  await reconcilierLeCircuit(tx, tenantId);
  return rows.length;
}

const derniereFois = new Map<string, number>();

/**
 * Au plus une fois par minute et par organisation : c'est la relève des
 * notifications, faite par chaque session ouverte, qui la déclenche.
 */
export async function inactiverSiLeTempsEstVenu(tx: Tx, tenantId: string): Promise<void> {
  const maintenant = Date.now();
  if (maintenant - (derniereFois.get(tenantId) ?? 0) < 60_000) return;
  derniereFois.set(tenantId, maintenant);
  await inactiverLesContratsEchus(tx, tenantId);
}
