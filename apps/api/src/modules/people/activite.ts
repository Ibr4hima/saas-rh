import { sql, type SQL } from 'drizzle-orm';
import type { ChangementRattachement, ContractType, MotifChangement } from '@teranga/contracts';
import { ProblemException } from '../../common/problem';
import type { Tx } from '../../db/tenant-db';
import { administrateursEnFonction, alerterLaDCH } from '../acces/dch';
import { CONTRAT } from '../notifications/phrases';
import { reconcilierDemande, reconcilierLeCircuit, reconcilierReprise } from '../time/visas';
import {
  directionDeEmploye,
  directionDeLUnite,
  equipeDe,
  n1DOffice,
  rattacher,
  rattacherDOffice,
  validerRattachement,
  verrouillerLaChaine,
} from './chaine';
import {
  debutDuContratAVenir,
  dernierContrat,
  effacerLesMotsDePasseEchus,
  sousContrat,
} from './en-activite';
import { muter } from './mutation';
import { parLeSysteme } from '../../db/systeme';
import { expediteurEnService } from '../courriels/expediteur';
import { preparerInvitation } from '../portal/invitation';

/* ————————————————————————————————————————————————————————————————
   La fin de contrat, d'elle-même : les dossiers des contrats arrivés à
   terme passent dans les inactifs (cf. en-activite.ts pour la règle).
   ———————————————————————————————————————————————————————————————— */

/**
 * L'activité s'arrête : le dernier jour se note au dossier et dans ses
 * départs, et sa dernière affectation s'arrête ce jour-là ; une affectation
 * prévue après n'aura pas lieu. `fin` : le dernier jour, en SQL (une date).
 * `repriseLe` : le premier jour d'un contrat déjà enregistré ; ses congés
 * validés à partir de ce jour-là tiennent.
 */
export async function arreterLActivite(
  tx: Tx,
  employeeId: string,
  fin: SQL,
  motif: string | null,
  repriseLe: string | null = null,
): Promise<void> {
  await tx.execute(sql`UPDATE employees SET fin_activite = ${fin} WHERE id = ${employeeId}`);
  await tx.execute(sql`
    INSERT INTO periodes_inactivite (tenant_id, employee_id, dernier_jour, motif)
    SELECT tenant_id, id, (${fin})::date, ${motif} FROM employees WHERE id = ${employeeId}
    ON CONFLICT (employee_id) WHERE reprise_le IS NULL
    DO UPDATE SET dernier_jour = EXCLUDED.dernier_jour, motif = EXCLUDED.motif`);
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
       AND (${repriseLe}::date IS NULL OR start_date < ${repriseLe}::date)
    RETURNING id`);
  for (const { id } of [...annules, ...ecourtes]) await reconcilierReprise(tx, id);
  // Une invitation en attente ne s'ouvre plus : le portail lui serait fermé.
  await tx.execute(sql`
    UPDATE invitations SET expires_at = now()
     WHERE person_id = (SELECT person_id FROM employees WHERE id = ${employeeId})
       AND accepted_at IS NULL AND expires_at > now()`);
}

/**
 * Le jour où l'activité reprend : celui qu'on donne ; sinon le début du
 * contrat enregistré depuis le départ, s'il y en a un ; sinon aujourd'hui.
 * Jamais avant le lendemain du dernier jour. En SQL, pour un dossier inactif.
 */
export const jourDeReprise = (employeeId: string, demandee: string | null) => sql`(
  SELECT GREATEST(
           COALESCE(${demandee}::date,
                    CASE WHEN c.created_at > e.archived_at THEN c.start_date END,
                    CURRENT_DATE),
           e.fin_activite + 1)
    FROM employees e
    LEFT JOIN contracts c ON c.id = ${dernierContrat(employeeId)}
   WHERE e.id = ${employeeId})`;

/**
 * L'activité reprend, le jour dit (cf. `jourDeReprise`).
 *
 * Revenu le lendemain de son dernier jour, l'agent n'est jamais parti : son
 * départ s'efface, et son affectation, arrêtée ce jour-là, reprend son cours.
 * Revenu plus tard, son départ garde sa date et reçoit celle du retour ;
 * il retrouve le poste et l'unité de sa dernière affectation, dans une
 * affectation neuve qui commence au jour de la reprise, pas au lendemain du
 * départ : l'intervalle n'est pas une période d'activité. Une unité dissoute
 * entre-temps ne revient pas : l'affectation est alors sans unité, et le
 * contrôle de la chaîne le signale.
 */
export async function reprendreLActivite(
  tx: Tx,
  tenantId: string,
  employeeId: string,
  demandee: string | null = null,
  /** Le poste et l'unité où il reprend, quand un nouveau contrat les dit. */
  affectation?: { positionTitle: string; orgUnitId: string | null },
): Promise<void> {
  const { rows } = await tx.execute<{
    reprise: string | null;
    lendemain: string | null;
    affectation: string | null;
    au: string | null;
    poste: string | null;
    unite: string | null;
    uniteDOrigine: string | null;
  }>(sql`
    SELECT ${jourDeReprise(employeeId, demandee)}::text AS reprise,
           (e.fin_activite + 1)::text AS lendemain,
           a.id AS affectation, upper(a.validity)::text AS au, a.position_title AS poste,
           (SELECT o.id FROM org_units o WHERE o.id = a.org_unit_id AND o.deleted_at IS NULL) AS unite,
           a.org_unit_id AS "uniteDOrigine"
      FROM employees e
      LEFT JOIN assignments a ON a.id = (SELECT ax.id FROM assignments ax WHERE ax.employee_id = e.id
                                          ORDER BY lower(ax.validity) DESC LIMIT 1)
     WHERE e.id = ${employeeId}`);
  const r = rows[0];
  // Parti depuis plus de trente jours, il revient sans mot de passe : une
  // invitation le lui fera choisir, sur le même compte.
  await effacerLesMotsDePasseEchus(tx, employeeId);
  await tx.execute(sql`UPDATE employees SET fin_activite = NULL WHERE id = ${employeeId}`);
  if (!r?.reprise || !r.lendemain) {
    await tx.execute(sql`
      DELETE FROM periodes_inactivite WHERE employee_id = ${employeeId} AND reprise_le IS NULL`);
    return;
  }

  // Un nouveau contrat dit où il reprend : la même place, ou une autre.
  const memePlace =
    !affectation ||
    (affectation.positionTitle === r.poste && affectation.orgUnitId === r.uniteDOrigine);
  const poste = affectation?.positionTitle ?? r.poste;
  const unite = affectation ? affectation.orgUnitId : r.unite;

  if (r.reprise === r.lendemain) {
    await tx.execute(sql`
      DELETE FROM periodes_inactivite WHERE employee_id = ${employeeId} AND reprise_le IS NULL`);
    // L'affectation arrêtée au départ reprend, si son unité existe encore et
    // qu'il revient à la même place.
    if (r.affectation && r.au === r.lendemain && r.unite && memePlace) {
      await tx.execute(sql`
        UPDATE assignments SET validity = daterange(lower(validity), NULL)
         WHERE id = ${r.affectation}`);
      return;
    }
  } else {
    await tx.execute(sql`
      UPDATE periodes_inactivite SET reprise_le = ${r.reprise}::date
       WHERE employee_id = ${employeeId} AND reprise_le IS NULL`);
  }

  if (!poste) return;
  const { rows: ouverte } = await tx.execute(sql`
    SELECT 1 FROM assignments WHERE employee_id = ${employeeId}
       AND (upper_inf(validity) OR upper(validity) > ${r.reprise}::date) LIMIT 1`);
  if (ouverte.length > 0) return;
  await tx.execute(sql`
    INSERT INTO assignments (id, tenant_id, employee_id, org_unit_id, position_title, validity)
    VALUES (gen_random_uuid(), ${tenantId}, ${employeeId}, ${unite}, ${poste},
            daterange(${r.reprise}::date, NULL))`);
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
 *     ouvert trente jours, restreint, puis se ferme.
 * Les comptes partis depuis plus de trente jours perdent leur mot de passe.
 * Qui suit les échéances pour la DCH l'apprend.
 * Rend le nombre de dossiers passés dans les inactifs.
 */
export async function inactiverLesContratsEchus(tx: Tx, tenantId: string): Promise<number> {
  return parLeSysteme(tx, async () => {
    const n = await inactiverLesEchus(tx, tenantId);
    await appliquerLesContratsQuiCommencent(tx, tenantId);
    await effacerLesMotsDePasseEchus(tx);
    return n;
  });
}

/**
 * Les contrats qui commencent : leur place s'applique, le jour venu, pas
 * avant. L'agent hors contrat depuis la fin du précédent reprend son
 * activité, à cette place : son dossier se réactive, et son portail lui
 * est rendu en entier. Parti depuis plus de trente jours, il a perdu son
 * mot de passe : son invitation part d'elle-même. L'agent qui enchaîne
 * sans interruption change de place comme par un nouveau contrat du jour
 * (cf. `muter`).
 */
async function appliquerLesContratsQuiCommencent(tx: Tx, tenantId: string): Promise<void> {
  const { rows } = await tx.execute<{
    contrat: string;
    id: string;
    debut: string;
    fini: boolean;
    poste: string;
    unite: string | null;
    status: string;
    finActivite: string | null;
  }>(sql`
    SELECT c.id AS contrat, c.employee_id AS id, c.start_date::text AS debut,
           COALESCE(c.end_date < CURRENT_DATE, false) AS fini,
           c.planned_position_title AS poste, c.planned_org_unit_id AS unite,
           e.status, e.fin_activite::text AS "finActivite"
      FROM contracts c JOIN employees e ON e.id = c.employee_id
     WHERE c.planned_position_title IS NOT NULL AND c.start_date <= CURRENT_DATE
     ORDER BY c.start_date, c.id`);
  if (rows.length === 0) return;
  await verrouillerLaChaine(tx);
  const expediteur = expediteurEnService();
  const journal: ChangementRattachement[] = [];
  for (const c of rows) {
    await tx.execute(sql`
      UPDATE contracts SET planned_position_title = NULL, planned_org_unit_id = NULL
       WHERE id = ${c.contrat}`);
    // Un contrat déjà terminé n'a plus de place à prendre.
    if (c.fini) continue;
    const place = { positionTitle: c.poste, orgUnitId: c.unite };

    if (c.status === 'active') {
      const { rows: actuelle } = await tx.execute<{ poste: string; unite: string | null }>(sql`
        SELECT position_title AS poste, org_unit_id AS unite FROM assignments
         WHERE employee_id = ${c.id} AND validity @> CURRENT_DATE LIMIT 1`);
      const a = actuelle[0];
      if (a && a.poste === place.positionTitle && a.unite === place.orgUnitId) continue;
      try {
        await tx.transaction((sp) =>
          muter(sp, tenantId, c.id, { ...place, startDate: c.debut }, { parContrat: true }),
        );
      } catch (err) {
        if (!(err instanceof ProblemException)) throw err;
      }
      continue;
    }

    // Parti avant que ce contrat commence : il revient.
    if (!c.finActivite || c.finActivite >= c.debut) continue;
    const { rows: avant } = await tx.execute<{ autre: boolean }>(sql`
      SELECT ${directionDeLUnite(sql`a.org_unit_id`, 'id')}
               IS DISTINCT FROM ${directionDeLUnite(sql`${place.orgUnitId}::uuid`, 'id')} AS autre
        FROM assignments a WHERE a.employee_id = ${c.id}
       ORDER BY lower(a.validity) DESC LIMIT 1`);
    // Une autre direction : son ancien n+1 n'en est plus.
    if (avant[0]?.autre) {
      await tx.execute(sql`UPDATE employees SET manager_employee_id = NULL WHERE id = ${c.id}`);
    }
    await reprendreLActivite(tx, tenantId, c.id, c.debut, place);
    await tx.execute(sql`
      UPDATE employees
         SET status = 'active', archived_at = NULL, inactivite_motif = NULL, updated_at = now()
       WHERE id = ${c.id}`);
    await rattacherDOffice(tx, journal, c.id);
    const { rows: compte } = await tx.execute<{ ferme: boolean }>(sql`
      SELECT u.password_hash IS NULL AS ferme
        FROM employees e JOIN persons p ON p.id = e.person_id JOIN users u ON u.id = p.user_id
       WHERE e.id = ${c.id}`);
    if (expediteur?.actif && compte[0]?.ferme) {
      try {
        await tx.transaction((sp) =>
          preparerInvitation(sp, expediteur, { tenantId, userId: null }, c.id, 'employee'),
        );
        expediteur.bientot();
      } catch (err) {
        if (!(err instanceof ProblemException)) throw err;
      }
    }
  }
  await reconcilierLeCircuit(tx, tenantId);
}

async function inactiverLesEchus(tx: Tx, tenantId: string): Promise<number> {
  const { rows } = await tx.execute<{
    id: string;
    nom: string;
    contrat: string;
    type: string;
    fin: string;
    reprise: string | null;
    n1: string | null;
    admin: string | null;
  }>(sql`
    SELECT e.id, p.given_name || ' ' || p.family_name AS nom, c.id AS contrat,
           c.contract_type AS type, c.end_date::text AS fin,
           (${debutDuContratAVenir(sql`e.id`)})::text AS reprise,
           e.manager_employee_id AS n1,
           (SELECT m.user_id FROM user_tenant_memberships m
             WHERE m.user_id = p.user_id AND m.tenant_id = e.tenant_id AND m.role = 'admin') AS admin
      FROM employees e
      JOIN persons p ON p.id = e.person_id
      JOIN contracts c ON c.id = (SELECT cf.id FROM contracts cf
                                   WHERE cf.employee_id = e.id AND cf.end_date < CURRENT_DATE
                                   ORDER BY cf.end_date DESC LIMIT 1)
     WHERE e.status = 'active' AND NOT ${sousContrat(sql`e.id`)}
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
    await arreterLActivite(tx, a.id, sql`${a.fin}::date`, 'fin_de_contrat', a.reprise);
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

    // Le contrat d'un administrateur prend fin : ses droits s'arrêtent avec.
    // S'il était le dernier, l'organisation n'en a plus : qu'on le sache.
    if (a.admin && (await administrateursEnFonction(tx, tenantId)).length === 0) {
      await alerterLaDCH(
        tx,
        tenantId,
        'personnel.gerer',
        {
          type: 'contract_ended',
          title: `${a.nom} était le dernier administrateur : l’organisation n’en a plus`,
          link: `/employees/${a.id}`,
          dedupeKey: `dernier_admin:${a.id}`,
        },
        a.id,
      );
    }
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
