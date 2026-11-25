import { sql, type SQL } from 'drizzle-orm';
import { typeDeContratAu } from './en-activite';

/*
 * L'ancienneté (ADR-0083) : celle de la suite de contrats en cours, au jour
 * dit. Elle ne court que sous un CDI ou un CDD, depuis le premier contrat de
 * la suite. Un stage ne donne pas d'ancienneté, un autre contrat non plus :
 * l'un comme l'autre interrompt la suite. Un écart d'un mois ou plus
 * l'interrompt aussi, entre la fin d'un contrat et le début du suivant comme
 * entre un départ et un retour : l'ancienneté repart alors du premier jour
 * du nouveau contrat, ou du retour. Un écart plus court ne l'interrompt pas :
 * les contrats se cumulent, et seuls les jours de l'écart ne comptent pas.
 *
 * Les écarts se lisent aussi dans les départs : un départ ne clôt pas le
 * contrat, et un nouveau contrat arrête le précédent la veille de son
 * premier jour, si longue qu'ait été l'absence.
 *
 * La fiche et le tableau de bord la lisent ici.
 */

const EMPLOI = sql`('cdi', 'cdd')`;
const STAGE = sql`('stage')`;

/**
 * Le premier jour de la suite de contrats d'une famille qui couvre le jour
 * dit, en SQL ; null : le contrat de ce jour-là n'en est pas, ou aucun ne le
 * couvre. Elle commence au dernier contrat de la famille qui ne prolonge pas
 * le précédent, ou au dernier retour après un mois ou plus d'absence.
 */
const debutDeLaSuite = (employeeId: SQL | string, jour: SQL, famille: SQL) => sql`(
  CASE WHEN ${typeDeContratAu(employeeId, jour)} IN ${famille} THEN GREATEST(
    (SELECT max(s.debut)
       FROM (SELECT c.start_date AS debut, c.contract_type AS type,
                    lag(c.contract_type) OVER suite AS type_avant,
                    lag(c.end_date) OVER suite AS fin_avant,
                    row_number() OVER suite AS rang
               FROM contracts c
              WHERE c.employee_id = ${employeeId} AND c.start_date <= ${jour}
             WINDOW suite AS (ORDER BY c.start_date, c.created_at)) s
      WHERE s.type IN ${famille}
        AND (s.rang = 1 OR s.type_avant NOT IN ${famille}
             OR s.debut >= (s.fin_avant + 1 + interval '1 month')::date)),
    (SELECT max(pi.reprise_le) FROM periodes_inactivite pi
      WHERE pi.employee_id = ${employeeId} AND pi.reprise_le <= ${jour}
        AND pi.reprise_le >= (pi.dernier_jour + 1 + interval '1 month')::date))
  END)`;

/** Le premier jour de l'ancienneté au jour dit, en SQL ; null : aucune. */
export const debutDeLAnciennete = (employeeId: SQL | string, jour: SQL) =>
  debutDeLaSuite(employeeId, jour, EMPLOI);

/**
 * Les jours qui ne comptent pas entre `debut` et le jour dit, en SQL : ceux
 * des écarts de moins d'un mois, qui n'interrompent pas l'ancienneté. Ce
 * sont les jours sans CDI ni CDD, ou passés hors de l'APIX après un départ,
 * chacun compté une fois.
 */
export const joursHorsDeLAnciennete = (employeeId: SQL | string, debut: SQL, jour: SQL) => sql`(
  SELECT (${jour} - ${debut} + 1) - COALESCE(sum(upper(r) - lower(r)), 0)::int
    FROM unnest(
      (SELECT range_agg(daterange(c.start_date, c.end_date + 1))
         FROM contracts c
        WHERE c.employee_id = ${employeeId} AND c.contract_type IN ${EMPLOI})
      * datemultirange(daterange(${debut}, ${jour} + 1))
      - COALESCE((SELECT range_agg(daterange(pi.dernier_jour + 1, pi.reprise_le))
                    FROM periodes_inactivite pi
                   WHERE pi.employee_id = ${employeeId}), '{}'::datemultirange)) r)`;

/**
 * En stage au jour dit : le premier jour de ce stage, en SQL ; null : pas
 * en stage ce jour-là. Prolongé par un nouveau contrat de stage dans le
 * mois, c'est le même stage.
 */
export const premierJourDuStage = (employeeId: SQL | string, jour: SQL) =>
  debutDeLaSuite(employeeId, jour, STAGE);
