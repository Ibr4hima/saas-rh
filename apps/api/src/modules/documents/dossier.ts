import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { directionDuPersonnel } from '../acces/dch';
import { debutDeLAnciennete, premierJourDuStage } from '../people/anciennete';
import { DG } from '../people/chaine';
import { problem } from '../../common/problem';
import * as t from '../../db/schema';
import type { Tx } from '../../db/tenant-db';
import type { Personne } from './redaction';

/*
 * Ce que les attestations de la DCH lisent au dossier (ADR-0086) : l'agent,
 * sa date d'entrée, son poste et son contrat, ou son stage ; et qui signe,
 * d'après l'organigramme.
 */

export interface DossierDeLAgent {
  agent: Personne;
  employeeNumber: string;
  /** Le premier jour de l'ancienneté (ADR-0083) ; à défaut, celui de l'embauche. */
  depuis: string;
  poste: string | null;
  /** Le type du contrat en cours ; null : aucun. */
  contrat: string | null;
}

/**
 * Le dossier d'un agent en activité, sous contrat de travail.
 *
 * @param document Le nom du document, que porte le refus d'un stage :
 *   « Attestation de travail réservée aux contrats de travail ».
 */
export async function dossierDeLAgent(
  tx: Tx,
  employeeId: string,
  document: string,
): Promise<DossierDeLAgent> {
  const [row] = await tx
    .select({
      employeeNumber: t.employees.employeeNumber,
      status: t.employees.status,
      hiredOn: t.employees.hiredOn,
      givenName: t.persons.givenName,
      familyName: t.persons.familyName,
      gender: t.persons.gender,
      positionTitle: t.assignments.positionTitle,
    })
    .from(t.employees)
    .innerJoin(t.persons, eq(t.persons.id, t.employees.personId))
    .innerJoin(t.tenants, eq(t.tenants.id, t.employees.tenantId))
    .leftJoin(
      t.assignments,
      and(
        eq(t.assignments.employeeId, t.employees.id),
        sql`${t.assignments.validity} @> CURRENT_DATE`,
      ),
    )
    .where(eq(t.employees.id, employeeId))
    .limit(1);
  if (!row) {
    problem(404, 'people.employee_not_found', 'Employé introuvable');
  }
  if (row.status !== 'active') {
    // Un dossier suspendu ou sorti relève d'un certificat de travail, pas
    // d'une attestation d'emploi en cours : on refuse plutôt que de mentir.
    problem(
      422,
      'documents.not_active',
      'Attestation réservée aux agents en activité',
      'Un dossier inactif relève du certificat de travail.',
    );
  }

  // Le contrat en cours : le dernier COMMENCÉ. Un CDI enregistré d'avance,
  // qui prendra la suite d'un CDD, ne se cite pas avant son premier jour.
  const [contract] = await tx
    .select({ contractType: t.contracts.contractType })
    .from(t.contracts)
    .where(
      and(eq(t.contracts.employeeId, employeeId), sql`${t.contracts.startDate} <= CURRENT_DATE`),
    )
    .orderBy(desc(t.contracts.startDate))
    .limit(1);
  if (contract?.contractType === 'stage') {
    problem(
      422,
      'documents.stage',
      `${document} réservée aux contrats de travail`,
      'Pour un stage, c’est l’attestation de stage qui convient.',
    );
  }

  // La date d'entrée : le début de l'ancienneté, qui ne compte ni le stage ni
  // une suite de contrats interrompue (ADR-0083) ; à défaut, l'embauche.
  const { rows: anciennete } = await tx.execute<{ depuis: string | null }>(
    sql`SELECT ${debutDeLAnciennete(employeeId, sql`CURRENT_DATE`)}::text AS depuis`,
  );

  return {
    agent: {
      nom: `${row.givenName} ${row.familyName.toUpperCase()}`,
      genre: row.gender ?? null,
    },
    employeeNumber: row.employeeNumber,
    depuis: anciennete[0]?.depuis ?? row.hiredOn,
    poste: row.positionTitle ?? null,
    contrat: contract?.contractType ?? null,
  };
}

export interface StageDeLAgent {
  agent: Personne;
  employeeNumber: string;
  /** Le premier jour du stage : renouvelé dans le mois, c'est le même stage. */
  debut: string;
  /** Son dernier jour : la fin du contrat, ou le départ s'il vient avant ; null : pas encore fixé. */
  fin: string | null;
  /** Le poste occupé pendant le stage ; à défaut, celui que prévoyait le contrat. */
  poste: string | null;
}

/**
 * Le dernier stage commencé d'un agent (ADR-0089), que son dossier soit en
 * activité ou non : l'attestation de stage se délivre le plus souvent après
 * le stage, au départ de l'agent ou après son embauche.
 */
export async function stageDeLAgent(tx: Tx, employeeId: string): Promise<StageDeLAgent> {
  const { rows } = await tx.execute<{
    employee_number: string;
    given_name: string;
    family_name: string;
    gender: string | null;
    debut: string | null;
    fin: string | null;
    poste_prevu: string | null;
  }>(sql`
    SELECT e.employee_number, p.given_name, p.family_name, p.gender,
           ${premierJourDuStage(employeeId, sql`st.start_date`)}::text AS debut,
           -- Un départ ne clôt pas le contrat : le stage finit au premier
           -- des deux.
           LEAST(st.end_date,
                 (SELECT min(pi.dernier_jour) FROM periodes_inactivite pi
                   WHERE pi.employee_id = e.id AND pi.dernier_jour >= st.start_date))::text AS fin,
           st.planned_position_title AS poste_prevu
      FROM employees e
      JOIN persons p ON p.id = e.person_id
      LEFT JOIN LATERAL (
        SELECT c.start_date, c.end_date, c.planned_position_title FROM contracts c
         WHERE c.employee_id = e.id AND c.contract_type = 'stage'
           AND c.start_date <= CURRENT_DATE
         ORDER BY c.start_date DESC, c.created_at DESC LIMIT 1) st ON true
     WHERE e.id = ${employeeId}`);
  const row = rows[0];
  if (!row) {
    problem(404, 'people.employee_not_found', 'Employé introuvable');
  }
  if (!row.debut) {
    problem(
      422,
      'documents.sans_stage',
      'Aucun stage au dossier',
      'L’attestation de stage cite le dernier stage commencé de l’agent.',
    );
  }

  // Le poste du stage, pas celui d'aujourd'hui : après une embauche, le
  // poste a changé.
  const { rows: postes } = await tx.execute<{ position_title: string }>(sql`
    SELECT a.position_title FROM assignments a
     WHERE a.employee_id = ${employeeId}
       AND a.validity && daterange(${row.debut}::date, (${row.fin}::date + 1))
     ORDER BY lower(a.validity) DESC LIMIT 1`);

  return {
    agent: {
      nom: `${row.given_name} ${row.family_name.toUpperCase()}`,
      genre: row.gender,
    },
    employeeNumber: row.employee_number,
    debut: row.debut,
    fin: row.fin,
    poste: postes[0]?.position_title ?? row.poste_prevu,
  };
}

/** La personne d'un dossier, d'après son id en SQL ; null : aucun dossier. */
async function personne(tx: Tx, employeeId: SQL): Promise<Personne | null> {
  const { rows } = await tx.execute<{
    given_name: string;
    family_name: string;
    gender: string | null;
  }>(sql`
    SELECT p.given_name, p.family_name, p.gender
      FROM employees e JOIN persons p ON p.id = e.person_id
     WHERE e.id = ${employeeId}`);
  const p = rows[0];
  return p ? { nom: `${p.given_name} ${p.family_name.toUpperCase()}`, genre: p.gender } : null;
}

/** Qui dirige le sommet de l'organigramme, la direction générale ; null : la place est vacante. */
export function quiDirigeLeSommet(tx: Tx): Promise<Personne | null> {
  return personne(tx, DG);
}

/** Qui dirige la DCH, la direction du personnel ; null : la place est vacante. */
export async function quiDirigeLaDCH(tx: Tx): Promise<Personne | null> {
  const dch = await directionDuPersonnel(tx);
  return dch?.directeurEmployeeId ? personne(tx, sql`${dch.directeurEmployeeId}`) : null;
}
