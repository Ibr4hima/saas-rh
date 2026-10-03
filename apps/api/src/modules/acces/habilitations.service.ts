import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import {
  CAPACITES_DELEGABLES,
  estDelegable,
  type AccorderInput,
  type EtatHabilitations,
  type SessionUser,
} from '@teranga/contracts';
import { problem } from '../../common/problem';
import { TenantDb } from '../../db/tenant-db';
import { reconcilierLeCircuit } from '../time/visas';
import { agentDuCompte, directionDuPersonnel, estDeLaDCH, membresDeLaDCH, nomDe } from './dch';

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
          prenom: m.prenom,
          poste: m.poste,
          absent: m.absent,
          compte: m.compte,
          capacites: CAPACITES_DELEGABLES.filter((c) =>
            rows.some((r) => r.employee_id === m.employeeId && r.capacite === c),
          ),
        })),
      };
    });
  }

  /**
   * Accorder ou retirer une habilitation à un membre de la DCH, sans
   * notification : il le voit dans son espace. Les demandes en attente vont
   * aussitôt à qui les traite désormais.
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
      if (!input.accordee) {
        const h = enCours[0];
        if (!h) return;
        await tx.execute(sql`
          UPDATE habilitations SET fin_at = now(), fin_motif = 'retiree' WHERE id = ${h.id}`);
        await reconcilierLeCircuit(tx, user.tenantId);
        return;
      }

      if (enCours.length > 0) return;
      if (!estDelegable(input.capacite)) {
        problem(
          422,
          'habilitations.reservee_admin',
          'Réservé à l’administrateur',
          'Les textes de référence sont gérés par l’administrateur.',
        );
      }
      if (input.employeeId === moi) {
        problem(422, 'habilitations.directeur', 'Vous avez déjà toutes les habilitations');
      }
      if (!(await estDeLaDCH(tx, dch, input.employeeId))) {
        problem(
          422,
          'habilitations.pas_membre_dch',
          'Choisissez un membre de la DCH',
          'Les habilitations se confient aux agents de votre direction, sous contrat.',
        );
      }
      const id = uuidv7();
      await tx.execute(sql`
        INSERT INTO habilitations (id, tenant_id, capacite, employee_id, accordee_par_employee_id)
        VALUES (${id}, ${user.tenantId}, ${input.capacite}, ${input.employeeId}, ${moi})`);
      await reconcilierLeCircuit(tx, user.tenantId);
    });
  }
}
