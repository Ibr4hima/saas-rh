import { sql, type SQL } from 'drizzle-orm';
import {
  AGENTS_DE_LA_CIBLE_MAX,
  CIBLES_DES_DOCUMENTS,
  horsCible,
  REQUESTABLE_DOC_LABELS,
  type AgentDeLaCible,
  type CibleDuDocument,
  type ContractType,
  type DocumentAvecAgent,
  type EmployeeStatus,
  type Gender,
  type HorsCible,
  type SituationDeLAgent,
} from '@teranga/contracts';
import { problem } from '../../common/problem';
import type { Tx } from '../../db/tenant-db';
import { rechercheDesAgents } from '../people/recherche';

/*
 * La cible de chaque document (ADR-0130) : les agents que « Générer des
 * documents » propose, et le refus de générer pour un autre. La règle vit au
 * contrat, partagée avec la page ; ici se lit, au dossier, la situation de
 * chaque agent.
 */

type Ligne = {
  id: string;
  employee_number: string;
  given_name: string;
  family_name: string;
  position_title: string | null;
  status: string;
  contrat: string | null;
  stage: boolean;
  genre: string | null;
  age: number | null;
};

/** Les dossiers retenus par `filtre`, et leur situation, par nom. */
async function lireLesSituations(tx: Tx, filtre: SQL): Promise<Ligne[]> {
  const { rows } = await tx.execute<Ligne>(sql`
    SELECT e.id, e.employee_number, p.given_name, p.family_name, e.status,
           -- Le poste en cours, sinon le prochain ; pour un dossier inactif, le dernier.
           (SELECT a.position_title FROM assignments a
             WHERE a.employee_id = e.id
             ORDER BY a.validity @> CURRENT_DATE DESC, lower(a.validity) DESC
             LIMIT 1) AS position_title,
           -- Le contrat qui fait foi : le dernier commencé, au dernier jour
           -- d'un dossier inactif (comme le certificat de travail le lit).
           (SELECT c.contract_type FROM contracts c
             WHERE c.employee_id = e.id
               AND c.start_date <= CASE WHEN e.status = 'active' THEN CURRENT_DATE
                 ELSE COALESCE(e.fin_activite,
                               (SELECT max(pi.dernier_jour) FROM periodes_inactivite pi
                                 WHERE pi.employee_id = e.id AND pi.reprise_le IS NULL),
                               (e.archived_at AT TIME ZONE 'UTC')::date - 1,
                               CURRENT_DATE) END
             ORDER BY c.start_date DESC, c.created_at DESC LIMIT 1) AS contrat,
           EXISTS (SELECT 1 FROM contracts c
                    WHERE c.employee_id = e.id AND c.contract_type = 'stage'
                      AND c.start_date <= CURRENT_DATE) AS stage,
           p.gender AS genre,
           date_part('year', age(CURRENT_DATE, p.birth_date))::int AS age
      FROM employees e
      JOIN persons p ON p.id = e.person_id
     WHERE ${filtre}
     ORDER BY p.family_name, p.given_name, e.id`);
  return rows;
}

const situationDe = (l: Ligne): SituationDeLAgent => ({
  enActivite: l.status === 'active',
  contrat: l.contrat as ContractType | null,
  stage: l.stage,
  genre: l.genre as Gender | null,
  age: l.age,
});

/**
 * Les agents de la cible d'un document qui répondent à la recherche, par nom.
 * Son propre dossier ne se propose pas : personne ne génère pour soi.
 */
export async function agentsDeLaCible(
  tx: Tx,
  doc: DocumentAvecAgent,
  q: string,
  userId: string,
): Promise<AgentDeLaCible[]> {
  const cible = CIBLES_DES_DOCUMENTS[doc];
  // Un premier tri en base, que la règle refait : le statut, le genre.
  const filtres = [
    sql`p.user_id IS DISTINCT FROM ${userId}`,
    rechercheDesAgents(q),
    cible.dossiers === 'en_activite'
      ? sql`e.status = 'active'`
      : cible.dossiers === 'inactifs'
        ? sql`e.status <> 'active'`
        : null,
    cible.genre ? sql`p.gender = ${cible.genre}` : null,
  ].filter((f): f is SQL => f !== null);
  const lignes = await lireLesSituations(tx, sql.join(filtres, sql` AND `));
  return lignes
    .map((l) => ({ l, situation: situationDe(l) }))
    .filter(({ situation }) => horsCible(cible, situation) === null)
    .slice(0, AGENTS_DE_LA_CIBLE_MAX)
    .map(({ l, situation }) => ({
      id: l.id,
      employeeNumber: l.employee_number,
      givenName: l.given_name,
      familyName: l.family_name,
      positionTitle: l.position_title,
      status: l.status as EmployeeStatus,
      situation,
    }));
}

/** Le refus, en le disant : le titre nomme le document, le détail la règle. */
function refuser(
  doc: DocumentAvecAgent,
  cible: CibleDuDocument,
  s: SituationDeLAgent,
  raison: HorsCible,
): never {
  const libelle = REQUESTABLE_DOC_LABELS[doc];
  const [titre, detail] = {
    not_active: [
      `${libelle} : dossier inactif`,
      'Ce document se délivre à un agent en activité ; un dossier inactif relève du certificat de travail.',
    ],
    en_activite: [
      `${libelle} : dossier en activité`,
      'Le certificat de travail se délivre au départ ; pour un agent en activité, c’est l’attestation de travail qui convient.',
    ],
    stage: [
      `${libelle} : contrat de stage`,
      'Ce document suppose un contrat de travail ; pour un stage, c’est l’attestation de stage qui convient.',
    ],
    sans_stage: [
      `${libelle} : aucun stage au dossier`,
      'L’attestation de stage cite le dernier stage commencé de l’agent.',
    ],
    genre: [
      `${libelle} : genre du dossier`,
      cible.genre === 'female'
        ? 'Le dossier de l’agent doit porter le genre féminin.'
        : 'Le dossier de l’agent doit porter le genre masculin.',
    ],
    age: [
      s.age === null
        ? `${libelle} : date de naissance manquante`
        : `${libelle} : moins de ${cible.ageMin} ans`,
      `La retraite se prend au plus tôt à ${cible.ageMin} ans ; l’âge se lit à la date de naissance du dossier.`,
    ],
  }[raison] as [string, string];
  problem(422, `documents.${raison}`, titre, detail);
}

/** Le document ne se génère que pour un agent de sa cible ; sinon, le refus. */
export async function exigerLaCible(
  tx: Tx,
  doc: DocumentAvecAgent,
  employeeId: string,
): Promise<void> {
  const [ligne] = await lireLesSituations(tx, sql`e.id = ${employeeId}`);
  if (!ligne) problem(404, 'people.employee_not_found', 'Employé introuvable');
  const cible = CIBLES_DES_DOCUMENTS[doc];
  const situation = situationDe(ligne);
  const raison = horsCible(cible, situation);
  if (raison) refuser(doc, cible, situation, raison);
}
