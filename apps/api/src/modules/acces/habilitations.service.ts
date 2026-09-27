import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import {
  CAPACITE_INFOS,
  CAPACITES,
  type AccorderInput,
  type Capacite,
  type EtatHabilitations,
  type SessionUser,
} from '@teranga/contracts';
import { problem } from '../../common/problem';
import { TenantDb } from '../../db/tenant-db';
import { notifier } from '../notifications/notifier';
import { reconcilierLeCircuit } from '../time/visas';
import { agentDuCompte, directionDuPersonnel, membreDCH, membresDeLaDCH, nomDe } from './dch';

/** Où l'on exerce une habilitation — le lien de la notification qui l'annonce. */
const LIEN: Record<Capacite, string> = {
  'demandes.conges': '/moi/dch',
  'demandes.documents.attestation_travail': '/documents',
  'demandes.documents.contrat_travail': '/documents',
  'demandes.documents.bulletin_salaire': '/documents',
  'demandes.documents.attestation_salaire': '/documents',
  'demandes.documents.certificat_travail': '/documents',
  'demandes.documents.autre': '/documents',
  'demandes.informations': '/demandes/informations',
  'demandes.pieces': '/demandes/pieces',
  'personnel.consulter': '/employees',
  'personnel.gerer': '/employees',
  'personnel.sensible': '/employees',
  'personnel.effacer': '/employees',
  'conges.soldes': '/employees',
  'conges.parametres': '/absences/parametres',
  organigramme: '/organisation',
  recrutement: '/recrutement',
  academy: '/academy/gerer',
  textes: '/reglementations',
  pilotage: '/dashboard',
};

/**
 * Les délégations du directeur du Capital Humain : ce qu'il confie, membre
 * par membre, habilitation par habilitation.
 */
@Injectable()
export class HabilitationsService {
  constructor(@Inject(TenantDb) private readonly db: TenantDb) {}

  /**
   * Le tableau des délégations. Le directeur le voit pour le modifier ;
   * l'administrateur, pour savoir qui peut quoi.
   */
  async etat(user: SessionUser): Promise<EtatHabilitations> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      const moi = await agentDuCompte(tx, user.userId);
      const dch = await directionDuPersonnel(tx);
      const estDirecteur = Boolean(moi && dch?.directeurEmployeeId === moi);
      if (!estDirecteur && user.role !== 'admin') {
        problem(
          403,
          'habilitations.reserve_au_directeur_dch',
          'Seul le directeur du Capital Humain gère les délégations',
        );
      }
      if (!dch) return { estDirecteur, directeur: null, direction: null, membres: [] };
      const { rows } = await tx.execute<{ employee_id: string; capacite: string }>(sql`
        SELECT employee_id, capacite FROM habilitations WHERE fin_at IS NULL`);
      const membres = await membresDeLaDCH(tx, dch);
      return {
        estDirecteur,
        directeur: dch.directeurEmployeeId
          ? { employeeId: dch.directeurEmployeeId, nom: await nomDe(tx, dch.directeurEmployeeId) }
          : null,
        direction: { id: dch.uniteId, nom: dch.nom },
        membres: membres.map((m) => ({
          employeeId: m.employeeId,
          nom: m.nom,
          poste: m.poste,
          absent: m.absent,
          capacites: CAPACITES.filter((c) =>
            rows.some((r) => r.employee_id === m.employeeId && r.capacite === c),
          ),
        })),
      };
    });
  }

  /**
   * Accorder ou retirer une habilitation à un membre de la DCH. Le membre
   * l'apprend ; les demandes en attente vont aussitôt à qui les traite
   * désormais.
   */
  async accorder(user: SessionUser, input: AccorderInput): Promise<void> {
    await this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      const moi = await agentDuCompte(tx, user.userId);
      const dch = await directionDuPersonnel(tx);
      if (!dch || !moi || dch.directeurEmployeeId !== moi) {
        problem(
          403,
          'habilitations.reserve_au_directeur_dch',
          'Seul le directeur du Capital Humain gère les délégations',
        );
      }
      const { rows: enCours } = await tx.execute<{ id: string }>(sql`
        SELECT id FROM habilitations
         WHERE employee_id = ${input.employeeId} AND capacite = ${input.capacite}
           AND fin_at IS NULL
         FOR UPDATE`);
      const info = CAPACITE_INFOS[input.capacite];
      const libelle = info.libelle.charAt(0).toLowerCase() + info.libelle.slice(1);
      const directeur = `${user.givenName} ${user.familyName}`;
      const prevenir = async (
        id: string,
        cle: 'accordee' | 'retiree',
        title: string,
        body: string,
      ) => {
        const { rows } = await tx.execute<{ user_id: string | null }>(sql`
          SELECT p.user_id FROM employees e JOIN persons p ON p.id = e.person_id
           WHERE e.id = ${input.employeeId}`);
        if (!rows[0]?.user_id) return;
        await notifier(tx, user.tenantId, rows[0].user_id, {
          type: 'delegation',
          title,
          body,
          link: cle === 'accordee' ? LIEN[input.capacite] : undefined,
          dedupeKey: `habilitation:${id}:${cle}`,
        });
      };

      if (!input.accordee) {
        const h = enCours[0];
        if (!h) return;
        await tx.execute(sql`
          UPDATE habilitations SET fin_at = now(), fin_motif = 'retiree' WHERE id = ${h.id}`);
        await prevenir(
          h.id,
          'retiree',
          `Délégation retirée : ${info.libelle}`,
          `${directeur}, qui dirige la DCH, reprend : ${libelle}.`,
        );
        await reconcilierLeCircuit(tx, user.tenantId);
        return;
      }

      if (enCours.length > 0) return;
      if (input.employeeId === moi) {
        problem(422, 'habilitations.directeur', 'Vous avez déjà toutes les habilitations');
      }
      const m = await membreDCH(tx, dch, input.employeeId);
      if (m === 'parti') {
        problem(
          422,
          'habilitations.pas_membre_dch',
          'Choisissez un membre de la DCH',
          'Les habilitations se confient aux agents actifs de votre direction, qui ont accès au portail.',
        );
      }
      const id = uuidv7();
      await tx.execute(sql`
        INSERT INTO habilitations (id, tenant_id, capacite, employee_id, accordee_par_employee_id)
        VALUES (${id}, ${user.tenantId}, ${input.capacite}, ${input.employeeId}, ${moi})`);
      await prevenir(
        id,
        'accordee',
        `Nouvelle délégation : ${info.libelle}`,
        `${directeur}, qui dirige la DCH, vous confie : ${libelle}. ${info.description}${
          input.capacite.startsWith('demandes.')
            ? ' Elles vous arrivent directement, avec une notification.'
            : ''
        }`,
      );
      await reconcilierLeCircuit(tx, user.tenantId);
    });
  }
}
