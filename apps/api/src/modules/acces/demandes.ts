import { sql, type SQL } from 'drizzle-orm';
import {
  capaciteDeLaPiece,
  capaciteDuDocument,
  type DocumentCategory,
  capacitesDuType,
  PROFILE_CHANGE_ALL_LABELS,
  REQUESTABLE_DOC_LABELS,
  type CapaciteDemande,
  type RequestableDoc,
  type SessionUser,
  type TraitementView,
  type TypeDemande,
} from '@teranga/contracts';
import { problem } from '../../common/problem';
import type { Tx } from '../../db/tenant-db';
import { retirerLesAppels, tenirLesAppels } from './appels';
import {
  agentDuCompte,
  decideur,
  detenteursDe,
  directionDuPersonnel,
  membreDCH,
  nomDe,
  nomsDe,
  traitementDe,
  type DirectionDuPersonnel,
  type Traitement,
} from './dch';

/* ————————————————————————————————————————————————————————————————
   Les demandes du personnel qui vont droit à la DCH : documents,
   changements d'informations, pièces justificatives.

   Pas de N+1 ici : la demande arrive à la DCH, et la règle commune
   (`traitementDe`) dit qui la traite — le membre à qui elle est confiée,
   les membres habilités à ce type, sinon le directeur du Capital Humain.
   Pour les documents, le type est celui du DOCUMENT : chaque document
   demandé est une demande à part, qui va à qui traite ce document-là.
   Ceux-là, et eux seuls, sont appelés ; le directeur voit tout, reprend la
   main quand il veut, et n'est pas dérangé pour ce qu'il a confié.

   Les congés suivent la même règle à leur seconde étape (visas.ts).
   ———————————————————————————————————————————————————————————————— */

export type TypeDCH = Exclude<TypeDemande, 'conges'>;
export const TYPES_DCH: readonly TypeDCH[] = ['documents', 'informations', 'pieces'];

interface Definition {
  prefixe: string;
  table: SQL;
  /** La demande attend la DCH (alias `r`). */
  enAttente: SQL;
  /** Ce qu'elle demande, brut (alias `r`). */
  detail: SQL;
  /** L'habilitation qui la traite. */
  capacite: (detail: unknown) => CapaciteDemande;
  objet: (detail: unknown) => string;
  titre: (nom: string) => string;
  lien: string;
}

const DEFINITIONS: Record<TypeDCH, Definition> = {
  documents: {
    prefixe: 'document',
    table: sql.raw('document_requests'),
    enAttente: sql.raw(`r.status IN ('received', 'processing')`),
    detail: sql.raw('to_jsonb(r.doc_types)'),
    // Un document par demande (cf. DocumentRequestsService.create).
    capacite: (d) => capaciteDuDocument((d as RequestableDoc[])[0]!),
    objet: (d) =>
      (d as string[])
        .map((x) => REQUESTABLE_DOC_LABELS[x as keyof typeof REQUESTABLE_DOC_LABELS] ?? x)
        .join(', '),
    titre: (nom) => `Demande de document : ${nom}`,
    lien: '/documents',
  },
  informations: {
    prefixe: 'information',
    table: sql.raw('profile_change_requests'),
    enAttente: sql.raw(`r.status = 'pending'`),
    detail: sql.raw('r.changes'),
    capacite: () => 'demandes.informations',
    objet: (d) =>
      `À mettre à jour : ${Object.keys(d as Record<string, unknown>)
        .map((k) => (PROFILE_CHANGE_ALL_LABELS[k] ?? k).toLowerCase())
        .join(', ')}`,
    titre: (nom) => `Changement d’informations : ${nom}`,
    lien: '/demandes/informations',
  },
  pieces: {
    prefixe: 'piece',
    table: sql.raw('employee_documents'),
    // Déposée par l'agent sur son dossier : la DCH la vérifie.
    enAttente: sql.raw(`r.status = 'pending'`),
    detail: sql.raw(`jsonb_build_object('label', r.label, 'categorie', r.category)`),
    // Un type de document officiel, une délégation (cf. CAPACITES_PIECES).
    capacite: (d) => capaciteDeLaPiece((d as { categorie: DocumentCategory }).categorie),
    objet: (d) =>
      `« ${(d as { label: string }).label} » à vérifier, puis à valider pour l’ajouter au dossier`,
    titre: (nom) => `Pièce à vérifier : ${nom}`,
    lien: '/demandes/pieces',
  },
};

/** Une demande qui attend la DCH. */
export interface DemandeDCH {
  type: TypeDCH;
  id: string;
  tenantId: string;
  employeeId: string;
  confieeA: string | null;
  nom: string;
  detail: unknown;
  /** L'habilitation qui la traite. */
  capacite: CapaciteDemande;
}

async function enAttente(tx: Tx, type: TypeDCH, id?: string): Promise<DemandeDCH[]> {
  const def = DEFINITIONS[type];
  const { rows } = await tx.execute<{
    id: string;
    tenant_id: string;
    employee_id: string;
    confiee_a_employee_id: string | null;
    nom: string;
    detail: unknown;
  }>(sql`
    SELECT r.id, r.tenant_id, r.employee_id, r.confiee_a_employee_id, ${def.detail} AS detail,
           p.given_name || ' ' || p.family_name AS nom
      FROM ${def.table} r
      JOIN employees e ON e.id = r.employee_id
      JOIN persons p ON p.id = e.person_id
     WHERE ${def.enAttente} ${id ? sql`AND r.id = ${id}` : sql``}
     ORDER BY r.created_at`);
  return rows.map((r) => ({
    type,
    id: r.id,
    tenantId: r.tenant_id,
    employeeId: r.employee_id,
    confieeA: r.confiee_a_employee_id,
    nom: r.nom,
    detail: r.detail,
    capacite: def.capacite(r.detail),
  }));
}

/** L'habilitation qui traite un document : celle de son type. */
export const capaciteDesDocuments = (docTypes: readonly string[]): CapaciteDemande =>
  capaciteDuDocument(docTypes[0] as RequestableDoc);

async function tenir(tx: Tx, d: DemandeDCH, dch: DirectionDuPersonnel | null): Promise<void> {
  const def = DEFINITIONS[d.type];
  const prefixe = `${def.prefixe}:${d.id}`;
  const t = await traitementDe(tx, d.capacite, d, dch);
  const objet = def.objet(d.detail);
  if (t.aConfier && t.dch?.directeur) {
    await tenirLesAppels(tx, d.tenantId, prefixe, 'a-confier', [t.dch.directeur.userId], {
      type: 'demande_a_confier',
      title: `Votre demande est à confier`,
      body: `${objet}. Personne d’autre à la DCH n’est habilité à la traiter : confiez-la à un membre de votre direction.`,
      link: def.lien,
    });
    return;
  }
  const directeurTraite = t.traitants[0]?.employeeId === t.dch?.directeurEmployeeId;
  await tenirLesAppels(
    tx,
    d.tenantId,
    prefixe,
    'dch',
    t.traitants.map((v) => v.userId),
    {
      type: 'demande_a_traiter',
      title: def.titre(d.nom),
      body: t.parDelegationDe
        ? `${objet}. Confiée par ${t.parDelegationDe.nom} (DCH).`
        : directeurTraite
          ? `${objet}. Vous pouvez la traiter, ou la confier à un membre de la DCH.`
          : `${objet}.`,
      link: def.lien,
    },
  );
}

/**
 * Tient les appels d'UNE demande : à l'arrivée, après une décision, un
 * « confier à ». Close, elle n'appelle plus personne.
 */
export async function reconcilierUneDemande(tx: Tx, type: TypeDCH, id: string): Promise<void> {
  const [d] = await enAttente(tx, type, id);
  if (!d) {
    await retirerLesAppels(tx, `${DEFINITIONS[type].prefixe}:${id}`);
    return;
  }
  await tenir(tx, d, await directionDuPersonnel(tx));
}

/** L'organisation a bougé : toutes les demandes vont à qui les traite désormais. */
export async function reconcilierLesDemandes(tx: Tx, _tenantId: string): Promise<void> {
  const dch = await directionDuPersonnel(tx);
  for (const type of TYPES_DCH) {
    for (const d of await enAttente(tx, type)) await tenir(tx, d, dch);
  }
}

/** Les demandes que personne ne peut traiter — pour l'alerte à l'administrateur. */
export async function compterLesBloquees(tx: Tx): Promise<number> {
  const dch = await directionDuPersonnel(tx);
  let n = 0;
  for (const type of TYPES_DCH) {
    for (const d of await enAttente(tx, type)) {
      const t = await traitementDe(tx, d.capacite, d, dch);
      if (t.traitants.length === 0 && !t.aConfier) n += 1;
    }
  }
  return n;
}

/**
 * Ce qui attend CET agent, par type : ce qu'il traite, ou ce qu'il doit
 * confier. Ce qui est délégué reste aussi au directeur : déléguer autorise
 * les membres, sans lui retirer la main.
 */
export async function aTraiterPar(tx: Tx, moi: string | null): Promise<Record<TypeDCH, number>> {
  const compte: Record<TypeDCH, number> = { documents: 0, informations: 0, pieces: 0 };
  if (!moi) return compte;
  const dch = await directionDuPersonnel(tx);
  if (!dch) return compte;
  const dirige = dch.directeurEmployeeId === moi;
  for (const type of TYPES_DCH) {
    for (const d of await enAttente(tx, type)) {
      const t = await traitementDe(tx, d.capacite, d, dch);
      const aConfier = t.aConfier && dirige;
      const garde = dirige && d.employeeId !== moi;
      if (aConfier || garde || t.traitants.some((v) => v.employeeId === moi)) compte[type] += 1;
    }
  }
  return compte;
}

/**
 * Ce que l'écran montre du traitement d'une demande en attente, et si
 * l'appelant peut la traiter.
 */
export async function vueDuTraitement(
  tx: Tx,
  capacite: CapaciteDemande,
  d: { employeeId: string; confieeA: string | null },
  moi: string | null,
  dch: DirectionDuPersonnel | null,
): Promise<{ vue: TraitementView; peutTraiter: boolean }> {
  const t = await traitementDe(tx, capacite, d, dch);
  const confiee =
    d.confieeA && d.confieeA !== dch?.directeurEmployeeId
      ? { employeeId: d.confieeA, nom: await nomDe(tx, d.confieeA) }
      : null;
  return {
    vue: {
      traitants: nomsDe(t.traitants),
      confiee,
      peutConfier: Boolean(moi && dch?.directeurEmployeeId === moi),
      aConfier: t.aConfier,
      pourMoi: Boolean(
        moi &&
        (t.traitants.some((v) => v.employeeId === moi) ||
          (t.aConfier && dch?.directeurEmployeeId === moi)),
      ),
    },
    peutTraiter: decideur(t, moi, d.employeeId),
  };
}

/**
 * Qui voit toute la file d'un type : le directeur, les membres habilités à
 * le traiter (pour les documents : à l'un d'eux), et l'administrateur, qui
 * la lit sans la traiter. Rien d'autre n'y donne accès, pas même la
 * consultation des dossiers du personnel.
 */
export async function voitToutLaFile(
  tx: Tx,
  user: SessionUser,
  type: TypeDemande,
): Promise<boolean> {
  if (user.role === 'admin') return true;
  const moi = await agentDuCompte(tx, user.userId);
  if (!moi) return false;
  const dch = await directionDuPersonnel(tx);
  if (!dch) return false;
  if (dch.directeurEmployeeId === moi) return true;
  let habilite = false;
  for (const c of capacitesDuType(type)) {
    if ((await detenteursDe(tx, c)).includes(moi)) habilite = true;
  }
  if (!habilite) return false;
  return (await membreDCH(tx, dch, moi)) !== 'parti';
}

/** Refuse (403) qui ne peut pas traiter cette demande. */
export async function exigerDeTraiter(
  tx: Tx,
  user: SessionUser,
  capacite: CapaciteDemande,
  d: { employeeId: string; confieeA: string | null },
): Promise<void> {
  const moi = await agentDuCompte(tx, user.userId);
  if (moi && moi === d.employeeId) {
    problem(
      403,
      'demandes.la_sienne',
      'Personne ne traite sa propre demande',
      'Elle va aux membres de la DCH habilités, ou au directeur du Capital Humain.',
    );
  }
  const t = await traitementDe(tx, capacite, d);
  if (!decideur(t, moi, d.employeeId)) {
    const qui = nomsDe(t.traitants);
    problem(
      403,
      'demandes.pas_traitant',
      'Cette demande ne vous est pas confiée',
      qui ? `${qui} la traite pour la DCH.` : undefined,
    );
  }
}

/**
 * Le directeur du Capital Humain confie UNE demande à un membre de sa
 * direction — ou la reprend (`null`). Rend `proposerHabilitation` : le
 * membre n'est pas encore habilité à ce type ; l'écran propose de lui
 * confier aussi les suivantes.
 */
export async function confierLaDemande(
  tx: Tx,
  user: SessionUser,
  type: TypeDCH,
  id: string,
  employeeId: string | null,
): Promise<{ proposerHabilitation: boolean }> {
  const def = DEFINITIONS[type];
  await tx.execute(sql`SELECT 1 FROM ${def.table} WHERE id = ${id} FOR UPDATE`);
  const [d] = await enAttente(tx, type, id);
  if (!d) {
    problem(
      422,
      'demandes.close',
      'Cette demande n’attend plus la DCH',
      'Elle est déjà traitée, ou introuvable.',
    );
  }
  const moi = await agentDuCompte(tx, user.userId);
  const dch = await directionDuPersonnel(tx);
  if (!dch || !moi || dch.directeurEmployeeId !== moi) {
    problem(
      403,
      'demandes.reserve_au_directeur_dch',
      'Seul le directeur du Capital Humain confie les demandes',
    );
  }
  if (employeeId) {
    if (employeeId === d.employeeId) {
      problem(422, 'demandes.confiee_au_demandeur', 'On ne confie pas une demande à qui la pose');
    }
    const m = await membreDCH(tx, dch, employeeId);
    if (m === 'parti' || employeeId === moi) {
      problem(422, 'demandes.pas_membre_dch', 'Choisissez un membre de la DCH');
    }
    if (m.absent) {
      problem(
        422,
        'demandes.membre_absent',
        `${m.nom} est en congé aujourd’hui`,
        'Confiez la demande à un autre membre, ou traitez-la vous-même.',
      );
    }
  } else if (d.employeeId === moi) {
    problem(
      422,
      'demandes.la_sienne',
      'Personne ne traite sa propre demande',
      'Confiez-la à un membre de votre direction.',
    );
  }
  await tx.execute(sql`
    UPDATE ${def.table} SET confiee_a_employee_id = ${employeeId ?? moi} WHERE id = ${id}`);
  await reconcilierUneDemande(tx, type, id);
  return {
    proposerHabilitation: Boolean(
      employeeId && !(await detenteursDe(tx, d.capacite)).includes(employeeId),
    ),
  };
}
