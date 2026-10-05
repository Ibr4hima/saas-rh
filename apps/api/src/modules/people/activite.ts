import { sql, type SQL } from 'drizzle-orm';
import type { ChangementRattachement, ContractType, MotifChangement } from '@teranga/contracts';
import { ProblemException } from '../../common/problem';
import type { Tx } from '../../db/tenant-db';
import { alerterLaDCH } from '../acces/dch';
import { CONTRAT } from '../notifications/phrases';
import { reconcilierDemande, reconcilierLeCircuit, reconcilierReprise } from '../time/visas';
import {
  directionDeEmploye,
  equipeDe,
  n1DOffice,
  rattacher,
  validerRattachement,
  verrouillerLaChaine,
} from './chaine';
import { dernierContrat } from './en-activite';

/* ————————————————————————————————————————————————————————————————
   La fin de contrat, d'elle-même : les dossiers des contrats arrivés à
   terme passent dans les inactifs (cf. en-activite.ts pour la règle).
   ———————————————————————————————————————————————————————————————— */

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
  // Ses congés validés s'arrêtent avec lui : ceux qui commencent après son
  // dernier jour n'auront pas lieu, ceux qui le dépassent s'arrêtent ce jour-là
  // (les jours au-delà lui reviennent).
  const { rows: ecourtes } = await tx.execute<{ id: string }>(sql`
    WITH coupe AS (
      SELECT r.id,
             (SELECT count(*) FROM generate_series(r.start_date, (${fin})::date, interval '1 day') g(d)
               WHERE extract(isodow FROM g.d) < 6
                 AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.day = g.d::date)) AS jours
        FROM absence_requests r
       WHERE r.employee_id = ${employeeId} AND r.status = 'approved'
         AND r.start_date <= (${fin})::date AND r.end_date > (${fin})::date
    )
    UPDATE absence_requests r
       SET fin_initiale = COALESCE(r.fin_initiale, r.end_date), end_date = (${fin})::date,
           days_count = coupe.jours, reprise_demandee = NULL
      FROM coupe
     WHERE r.id = coupe.id AND coupe.jours > 0
    RETURNING r.id`);
  // Ce qui va encore au-delà commence après son dernier jour (ou n'en garde
  // aucun jour ouvré) : il n'aura pas lieu.
  const { rows: annules } = await tx.execute<{ id: string }>(sql`
    UPDATE absence_requests SET status = 'cancelled', decided_at = now(), reprise_demandee = NULL
     WHERE employee_id = ${employeeId} AND status = 'approved' AND end_date > (${fin})::date
    RETURNING id`);
  for (const { id } of [...annules, ...ecourtes]) await reconcilierReprise(tx, id);
  // Une invitation en attente ne s'ouvre plus : le portail lui serait fermé.
  await tx.execute(sql`
    UPDATE invitations SET expires_at = now()
     WHERE person_id = (SELECT person_id FROM employees WHERE id = ${employeeId})
       AND accepted_at IS NULL AND expires_at > now()`);
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
 *   - une unité qu'il dirigeait reste sans responsable (le contrôle de la
 *     chaîne la signale) ;
 *   - son équipe remonte d'un cran, à son propre n+1, si la règle le
 *     permet ; sinon au responsable de sa direction ; sinon elle attend
 *     un n+1 ;
 *   - ses demandes de congé en attente sont annulées ; son portail reste
 *     ouvert un mois, restreint, puis se ferme.
 * Qui suit les échéances pour la DCH l'apprend.
 * Rend le nombre de dossiers passés dans les inactifs.
 */
export async function inactiverLesContratsEchus(tx: Tx, tenantId: string): Promise<number> {
  const { rows } = await tx.execute<{
    id: string;
    nom: string;
    contrat: string;
    type: string;
    fin: string;
    n1: string | null;
  }>(sql`
    SELECT e.id, p.given_name || ' ' || p.family_name AS nom, c.id AS contrat,
           c.contract_type AS type, c.end_date::text AS fin,
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
    await tx.execute(sql`
      UPDATE org_units SET manager_employee_id = NULL, updated_at = now()
       WHERE manager_employee_id = ${a.id} AND deleted_at IS NULL`);

    // L'équipe remonte d'un cran — rattachement par rattachement, sous la
    // règle —, ou passe au responsable de sa direction.
    const journal: ChangementRattachement[] = [];
    for (const m of equipe) {
      const candidats: [string | null, MotifChangement][] = [
        [a.n1, 'reprise_equipe'],
        [(await n1DOffice(tx, m.id))?.id ?? null, 'responsable_de_sa_direction'],
      ];
      for (const [cible, motif] of candidats) {
        if (!cible || cible === a.id) continue;
        try {
          await validerRattachement(tx, m.id, cible, await directionDeEmploye(tx, m.id));
          await rattacher(tx, journal, m.id, cible, motif);
          break;
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

    await alerterLaDCH(
      tx,
      tenantId,
      'personnel.gerer',
      {
        type: 'contract_ended',
        title: `Le ${CONTRAT[a.type as ContractType] ?? 'contrat'} de ${a.nom} a pris fin`,
        link: `/employees/${a.id}`,
        dedupeKey: `contrat_termine:${a.contrat}`,
        // Ses rappels d'échéance n'ont plus d'objet.
        remplace: `contract_deadline:${a.contrat}`,
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
