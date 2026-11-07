import { sql } from 'drizzle-orm';
import {
  CAPACITES_DEMANDES,
  type AlerteDeContinuite,
  type CapaciteDemande,
  type Continuite,
  type TrouDeContinuite,
} from '@teranga/contracts';
import { memoriser } from '../../common/memoire';
import type { Tx } from '../../db/tenant-db';
import { joursOuvresDe } from '../time/workdays';
import { detenteursDe, directionDuPersonnel, joursFeries, membreDCH } from './dch';

/* La continuité du service (ADR-0129).

   Une délégation de demandes confiée à plusieurs personnes garde toujours
   quelqu'un, sauf force majeure. Une demande d'absence qui laisserait, un
   jour ouvré de sa période, une délégation sans personne porte une alerte :
   ce jour-là, toutes les autres personnes déléguées sont absentes, en congé
   validé ou demandé, à la journée (une mission laisse joignable). La demande
   part quand même, et la DCH l'apprécie.

   Une délégation à une seule personne n'en porte pas : qui dirige la DCH la
   reprend en son absence, comme toujours. */

/** Les délégations de demandes d'une personne, dans l'ordre de la liste. */
function demandesDeLaPersonne(tx: Tx, employeeId: string): Promise<CapaciteDemande[]> {
  return memoriser(`demandes-de:${employeeId}`, async () => {
    const { rows } = await tx.execute<{ capacite: string }>(sql`
      SELECT capacite FROM habilitations
       WHERE employee_id = ${employeeId} AND fin_at IS NULL AND capacite LIKE 'demandes.%'`);
    const siennes = new Set(rows.map((r) => r.capacite));
    return CAPACITES_DEMANDES.filter((c) => siennes.has(c));
  });
}

/** Une absence qui rend une personne déléguée indisponible, ces jours-là. */
interface Indisponibilite {
  employeeId: string;
  nom: string;
  du: string;
  au: string;
  demandee: boolean;
}

async function indisponibilites(
  tx: Tx,
  employeeIds: readonly string[],
  du: string,
  au: string,
  sauf: string | null,
): Promise<Indisponibilite[]> {
  const { rows } = await tx.execute<{
    employee_id: string;
    nom: string;
    du: string;
    au: string;
    demandee: boolean;
  }>(sql`
    SELECT r.employee_id, p.given_name || ' ' || p.family_name AS nom,
           r.start_date::text AS du, r.end_date::text AS au, r.status = 'pending' AS demandee
      FROM absence_requests r
      JOIN absence_types ty ON ty.id = r.absence_type_id AND NOT ty.reste_joignable
      JOIN employees e ON e.id = r.employee_id
      JOIN persons p ON p.id = e.person_id
     WHERE r.employee_id = ANY (${`{${employeeIds.join(',')}}`}::uuid[])
       AND r.status IN ('approved', 'pending') AND r.start_time IS NULL
       AND r.start_date <= ${au}::date AND r.end_date >= ${du}::date
       ${sauf ? sql`AND r.id <> ${sauf}` : sql``}
     ORDER BY r.start_date, nom`);
  return rows.map((r) => ({
    employeeId: r.employee_id,
    nom: r.nom,
    du: r.du,
    au: r.au,
    demandee: r.demandee,
  }));
}

/** Une délégation sans personne : ses jours ouvrés, et les absences qui les font. */
interface Trou {
  capacite: CapaciteDemande;
  jours: string[];
  absences: Indisponibilite[];
}

/** La demande, telle que la continuité la lit : qui, et quand. */
export interface AbsenceDemandee {
  /** Null : pas encore posée (l'alerte du formulaire). */
  id: string | null;
  employeeId: string;
  du: string;
  au: string;
}

/**
 * Les délégations de demandes que l'absence laisserait sans personne, jour
 * ouvré par jour ouvré, à partir d'aujourd'hui : le passé ne se rattrape pas.
 * `seulement` : une délégation, sans regarder les autres.
 */
async function trousDeContinuite(
  tx: Tx,
  demande: AbsenceDemandee,
  seulement?: CapaciteDemande,
): Promise<Trou[]> {
  const dch = await directionDuPersonnel(tx);
  if (!dch) return [];
  const capacites = (await demandesDeLaPersonne(tx, demande.employeeId)).filter(
    (c) => !seulement || c === seulement,
  );
  if (capacites.length === 0) return [];
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const jours = joursOuvresDe(
    demande.du < aujourdhui ? aujourdhui : demande.du,
    demande.au,
    await joursFeries(tx),
  );
  if (jours.length === 0) return [];
  // Les autres personnes de chaque délégation qui peuvent traiter : membres
  // de la DCH, avec un accès ouvert.
  const autresDe = new Map<CapaciteDemande, string[]>();
  for (const capacite of capacites) {
    const autres: string[] = [];
    for (const id of await detenteursDe(tx, capacite)) {
      if (id === demande.employeeId) continue;
      if ((await membreDCH(tx, dch, id)) !== 'parti') autres.push(id);
    }
    if (autres.length > 0) autresDe.set(capacite, autres);
  }
  if (autresDe.size === 0) return [];
  const absences = await indisponibilites(
    tx,
    [...new Set([...autresDe.values()].flat())],
    jours[0]!,
    jours[jours.length - 1]!,
    demande.id,
  );
  const absent = (id: string, jour: string) =>
    absences.some((a) => a.employeeId === id && a.du <= jour && jour <= a.au);
  const trous: Trou[] = [];
  for (const [capacite, autres] of autresDe) {
    const sansPersonne = jours.filter((j) => autres.every((id) => absent(id, j)));
    if (sansPersonne.length === 0) continue;
    const premier = sansPersonne[0]!;
    const dernier = sansPersonne[sansPersonne.length - 1]!;
    trous.push({
      capacite,
      jours: sansPersonne,
      absences: absences.filter(
        (a) => autres.includes(a.employeeId) && a.du <= dernier && a.au >= premier,
      ),
    });
  }
  return trous;
}

/**
 * La personne resterait seule à traiter les absences et congés pendant son
 * absence : sa demande va à qui dirige la DCH, quels que soient son type et
 * sa durée (ADR-0129).
 */
export async function seuleAuxConges(tx: Tx, demande: AbsenceDemandee): Promise<boolean> {
  return (await trousDeContinuite(tx, demande, 'demandes.conges')).length > 0;
}

/**
 * Ce que la demande laisserait sans personne, et à qui elle va. Son type dit
 * s'il est soumis à la continuité : toujours, au-delà d'un jour, ou jamais ;
 * les absences et congés se regardent toujours, pour la règle de qui dirige
 * la DCH. Null : rien à signaler.
 */
export async function alerteDeContinuite(
  tx: Tx,
  demande: AbsenceDemandee & { continuite: Continuite; jours: number },
): Promise<AlerteDeContinuite | null> {
  const soumise =
    demande.continuite === 'toujours' ||
    (demande.continuite === 'au_dela_d_un_jour' && demande.jours > 1);
  const trous = await trousDeContinuite(tx, demande, soumise ? undefined : 'demandes.conges');
  if (trous.length === 0) return null;
  return {
    trous: regrouper(trous),
    auDirecteur: trous.some((t) => t.capacite === 'demandes.conges'),
  };
}

/** Les délégations aux mêmes jours sans personne, pour les mêmes absences, se disent ensemble. */
function regrouper(trous: Trou[]): TrouDeContinuite[] {
  const parCle = new Map<string, TrouDeContinuite>();
  for (const t of trous) {
    const absences = t.absences.map((a) => ({
      nom: a.nom,
      du: a.du,
      au: a.au,
      demandee: a.demandee,
    }));
    const du = t.jours[0]!;
    const au = t.jours[t.jours.length - 1]!;
    const cle = JSON.stringify([du, au, absences]);
    const deja = parCle.get(cle);
    if (deja) deja.capacites.push(t.capacite);
    else parCle.set(cle, { capacites: [t.capacite], du, au, absences });
  }
  return [...parCle.values()];
}
