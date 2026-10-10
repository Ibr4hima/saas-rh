import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { posteDeResponsable, type OrgUnitType, type SessionUser } from '@teranga/contracts';
import { problem } from '../../common/problem';
import type { Tx } from '../../db/tenant-db';
import { frDate } from '../acces/appels';
import { de } from '../notifications/phrases';
import { pasSurSoi } from '../acces/dch';
import { SOMMET } from './chaine';
import { enActivite } from './en-activite';

/*
   La fonction de responsable, écrite dans les affectations (ADR-0033).

   Désigné à la tête d'une unité, l'agent y prend le poste de responsable à
   compter du jour où il prend ses fonctions : son affectation en cours est
   remplacée si elle commence ce jour-là (il dirige depuis qu'il y est),
   close la veille sinon. Celui qu'il remplace quitte la tête ce même jour,
   pour le poste qu'on lui donne, dans son unité ; ou il part ailleurs, ou
   quitte l'APIX, et c'est l'appelant qui l'écrit (ADR-0038).
*/

interface Place extends Record<string, unknown> {
  id: string;
  du: string;
  au: string | null;
  org_unit_id: string | null;
  position_title: string;
  responsable: boolean;
}

/** L'affectation en cours d'un agent, verrouillée : celle que la passation découpe. */
async function placeEnCours(tx: Tx, employeeId: string): Promise<Place | null> {
  const { rows } = await tx.execute<Place>(sql`
    SELECT id, lower(validity)::text AS du, upper(validity)::text AS au,
           org_unit_id, position_title, responsable
      FROM assignments
     WHERE employee_id = ${employeeId} AND validity @> CURRENT_DATE
     FOR UPDATE`);
  return rows[0] ?? null;
}

async function nomEtGenre(
  tx: Tx,
  employeeId: string,
): Promise<{ nom: string; genre: string | null }> {
  const { rows } = await tx.execute<{ nom: string; genre: string | null }>(sql`
    SELECT p.given_name || ' ' || p.family_name AS nom, p.gender AS genre
      FROM employees e JOIN persons p ON p.id = e.person_id
     WHERE e.id = ${employeeId}`);
  return rows[0] ?? { nom: '', genre: null };
}

/**
 * Le nouveau poste, à compter de `depuis`. Il remplace l'affectation en
 * cours quand il commence avec elle ; sinon il la prolonge, et garde son
 * échéance.
 */
async function changerDePoste(
  tx: Tx,
  tenantId: string,
  employeeId: string,
  place: Place,
  depuis: string,
  poste: { orgUnitId: string | null; titre: string; responsable: boolean },
): Promise<void> {
  if (place.du === depuis) {
    await tx.execute(sql`
      UPDATE assignments
         SET position_title = ${poste.titre}, org_unit_id = ${poste.orgUnitId},
             responsable = ${poste.responsable}
       WHERE id = ${place.id}`);
    return;
  }
  await tx.execute(sql`
    UPDATE assignments SET validity = daterange(lower(validity), ${depuis}::date)
     WHERE id = ${place.id}`);
  await tx.execute(sql`
    INSERT INTO assignments
      (id, tenant_id, employee_id, org_unit_id, position_title, responsable, validity)
    VALUES (${uuidv7()}, ${tenantId}, ${employeeId}, ${poste.orgUnitId}, ${poste.titre},
            ${poste.responsable}, daterange(${depuis}::date, ${place.au}::date))`);
}

export interface Passation {
  uniteId: string;
  /** Qui prend la tête ; `null` : l'unité n'a plus de responsable. */
  nouveau: string | null;
  /** Qui la quitte ; `null` : l'unité n'en avait pas. */
  ancien: string | null;
  /** Le jour de la passation ; par défaut, aujourd'hui. */
  depuis?: string;
  /** Le poste de l'ancien ensuite, dans son unité. */
  posteDeLAncien?: string;
  /** L'ancien ne reste pas dans l'unité : ce qu'il devient s'écrit ensuite. */
  devenirAilleurs?: boolean;
}

/**
 * Écrit la passation dans les affectations. L'unité porte déjà son nouveau
 * responsable : l'intitulé de son poste se lit sur elle.
 */
export async function inscrireLaPassation(tx: Tx, user: SessionUser, p: Passation): Promise<void> {
  const { rows: jour } = await tx.execute<{ aujourdhui: string }>(
    sql`SELECT CURRENT_DATE::text AS aujourdhui`,
  );
  const aujourdhui = jour[0]!.aujourdhui;
  const depuis = p.depuis ?? aujourdhui;
  if (depuis > aujourdhui) {
    problem(422, 'org.passation_future', 'La prise de fonction se date au plus tard aujourd’hui');
  }

  const ancien = p.ancien && p.ancien !== p.nouveau ? await placeDeLAncien(tx, p.ancien) : null;
  const nouveau = p.nouveau ? await placeEnCours(tx, p.nouveau) : null;

  // Les dates d'abord, pour l'un et l'autre : rien ne s'écrit sur une
  // passation qui ne tient pas.
  for (const [qui, place] of [
    [p.nouveau, nouveau],
    [p.ancien, ancien],
  ] as const) {
    if (!qui || !place || depuis >= place.du) continue;
    const { nom } = await nomEtGenre(tx, qui);
    problem(
      422,
      'org.passation_trop_tot',
      `La passation ne peut pas précéder le ${frDate(place.du)}`,
      `${nom} occupe son poste actuel depuis le ${frDate(place.du)} : la passation se date au plus tôt ce jour-là.`,
    );
  }

  if (p.nouveau && nouveau) {
    // Une affectation déjà programmée le ferait quitter son poste de
    // responsable, à sa date, sans qu'on l'ait remplacé.
    const { rows: programmee } = await tx.execute<{ du: string }>(sql`
      SELECT lower(validity)::text AS du FROM assignments
       WHERE employee_id = ${p.nouveau} AND lower(validity) > CURRENT_DATE
       ORDER BY lower(validity) LIMIT 1`);
    const { nom, genre } = await nomEtGenre(tx, p.nouveau);
    if (programmee[0]) {
      problem(
        422,
        'org.responsable_affectation_programmee',
        `${nom} a une affectation programmée le ${frDate(programmee[0].du)}`,
        `${nom} a une affectation programmée le ${frDate(programmee[0].du)} : annulez-la d’abord, puis reprenez la désignation.`,
      );
    }
    const { rows: unite } = await tx.execute<{
      name: string;
      unit_type: OrgUnitType;
      short_name: string | null;
      sommet: boolean;
    }>(sql`
      SELECT name, unit_type, short_name, (id = ${SOMMET}) AS sommet
        FROM org_units WHERE id = ${p.uniteId}`);
    const u = unite[0]!;
    await changerDePoste(tx, user.tenantId, p.nouveau, nouveau, depuis, {
      orgUnitId: p.uniteId,
      titre: posteDeResponsable(
        { name: u.name, unitType: u.unit_type, shortName: u.short_name, sommet: u.sommet },
        genre,
      ),
      responsable: true,
    });
  }

  if (p.ancien && ancien && !p.devenirAilleurs) {
    const { nom } = await nomEtGenre(tx, p.ancien);
    if (!p.posteDeLAncien) {
      problem(
        422,
        'org.poste_de_l_ancien_requis',
        `Indiquez le nouveau poste ${de(nom)}`,
        `Indiquez le nouveau poste ${de(nom)}, qui quitte la tête de l’unité.`,
      );
    }
    // Le même poste, dans la même unité, sur une affectation qui ne disait
    // pas la fonction : rien ne change.
    if (p.posteDeLAncien === ancien.position_title && !ancien.responsable) return;
    await pasSurSoi(tx, user.userId, [p.ancien], 'changer votre propre affectation');
    await changerDePoste(tx, user.tenantId, p.ancien, ancien, depuis, {
      orgUnitId: ancien.org_unit_id,
      titre: p.posteDeLAncien,
      responsable: false,
    });
  }
}

/**
 * L'affectation en cours de l'ancien responsable, s'il est encore en
 * activité. Parti, ou son contrat arrivé à terme, il ne reçoit plus de
 * poste : la passation ne touche pas à ses affectations.
 */
async function placeDeLAncien(tx: Tx, employeeId: string): Promise<Place | null> {
  const { rows } = await tx.execute<{ actif: boolean }>(
    sql`SELECT COALESCE(${enActivite(sql`${employeeId}::uuid`)}, false) AS actif`,
  );
  return rows[0]?.actif ? placeEnCours(tx, employeeId) : null;
}
