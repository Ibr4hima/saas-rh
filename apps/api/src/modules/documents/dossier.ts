import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { directionDuPersonnel } from '../acces/dch';
import { debutDeLAnciennete } from '../people/anciennete';
import { DG } from '../people/chaine';
import { problem } from '../../common/problem';
import * as t from '../../db/schema';
import type { Tx } from '../../db/tenant-db';
import type { Personne } from './redaction';

/*
 * Ce que les attestations de la DCH lisent au dossier (ADR-0086) : l'agent,
 * sa date d'entrée, son poste et son contrat ; et qui signe, d'après
 * l'organigramme.
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
