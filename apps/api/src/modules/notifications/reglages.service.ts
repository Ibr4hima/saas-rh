import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import {
  CANAUX_PAR_DEFAUT,
  type ChangerReglagesInput,
  type ChangerSujetsInput,
  type ProfilDeNotification,
  type ReglagesNotifications,
  type SessionUser,
  SUJETS,
  sujetsDe,
} from '@teranga/contracts';
import { problem } from '../../common/problem';
import { TenantDb, type Tx } from '../../db/tenant-db';
import { employeActif } from '../academy/academy-evaluation.service';
import { DG } from '../people/chaine';

/* Les réglages des notifications d'une personne : ses sujets, chacun dans
   la plateforme ou non, par courriel ou non, et sa pause pendant ses
   congés (ADR-0074). */

@Injectable()
export class NotificationsReglagesService {
  constructor(@Inject(TenantDb) private readonly db: TenantDb) {}

  private ctx(user: SessionUser) {
    return { tenantId: user.tenantId, userId: user.userId };
  }

  /** Ce qu'il faut savoir de la personne pour lui proposer ses sujets. */
  private async profil(tx: Tx, user: SessionUser): Promise<ProfilDeNotification> {
    const moi = await employeActif(tx, user.userId);
    let aUneEquipe = false;
    if (moi) {
      const { rows } = await tx.execute<{ oui: boolean }>(sql`
        SELECT EXISTS (
          SELECT 1 FROM employees e
           WHERE (e.manager_employee_id = ${moi} OR e.n1_fonctionnel_employee_id = ${moi})
             AND e.status = 'active'
             AND e.id IS DISTINCT FROM ${DG}) AS oui`);
      aUneEquipe = Boolean(rows[0]?.oui);
    }
    return {
      role: user.role,
      capacites: user.capacites,
      estAgent: user.estAgent,
      estDG: user.estDG,
      dirigeLaDCH: user.dirigeLaDCH,
      aUneEquipe,
    };
  }

  async lire(user: SessionUser): Promise<ReglagesNotifications> {
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const profil = await this.profil(tx, user);
      const { rows: prefs } = await tx.execute<{
        sujet: string;
        plateforme: boolean;
        courriel: boolean;
      }>(sql`
        SELECT sujet, plateforme, courriel FROM notification_preferences
         WHERE user_id = ${user.userId}`);
      const { rows: reglages } = await tx.execute<{ pause_conges: boolean }>(sql`
        SELECT pause_conges FROM notification_reglages WHERE user_id = ${user.userId}`);
      const parSujet = new Map(prefs.map((p) => [p.sujet, p]));
      return {
        sujets: sujetsDe(profil).map((sujet) => {
          const p = parSujet.get(sujet);
          const d = SUJETS[sujet];
          return {
            sujet,
            groupe: d.groupe,
            libelle: d.libelle,
            icone: d.icone,
            plateforme: p?.plateforme ?? CANAUX_PAR_DEFAUT.plateforme,
            courriel: p?.courriel ?? CANAUX_PAR_DEFAUT.courriel,
          };
        }),
        pauseConges: user.estAgent ? (reglages[0]?.pause_conges ?? false) : null,
      };
    });
  }

  async changerSujets(
    user: SessionUser,
    input: ChangerSujetsInput,
  ): Promise<ReglagesNotifications> {
    await this.db.withTenant(this.ctx(user), async (tx) => {
      const permis = new Set(sujetsDe(await this.profil(tx, user)));
      if (input.sujets.some((s) => !permis.has(s.sujet))) {
        problem(422, 'notifications.sujet_hors_profil', 'Ce sujet ne vous concerne pas');
      }
      for (const s of input.sujets) {
        // Une ligne par sujet changé ; inchangée, elle n'écrit rien (ni au journal).
        await tx.execute(sql`
          INSERT INTO notification_preferences
            (id, tenant_id, user_id, sujet, plateforme, courriel)
          VALUES (${uuidv7()}, ${user.tenantId}, ${user.userId}, ${s.sujet},
                  ${s.plateforme}, ${s.courriel})
          ON CONFLICT (tenant_id, user_id, sujet) DO UPDATE
             SET plateforme = EXCLUDED.plateforme, courriel = EXCLUDED.courriel,
                 updated_at = now()
           WHERE (notification_preferences.plateforme, notification_preferences.courriel)
                 IS DISTINCT FROM (EXCLUDED.plateforme, EXCLUDED.courriel)`);
      }
    });
    return this.lire(user);
  }

  async changerReglages(
    user: SessionUser,
    input: ChangerReglagesInput,
  ): Promise<ReglagesNotifications> {
    await this.db.withTenant(this.ctx(user), async (tx) => {
      // La ligne des réglages naît au premier changement.
      await tx.execute(sql`
        INSERT INTO notification_reglages (id, tenant_id, user_id)
        VALUES (${uuidv7()}, ${user.tenantId}, ${user.userId})
        ON CONFLICT (tenant_id, user_id) DO NOTHING`);
      await tx.execute(sql`
        UPDATE notification_reglages
           SET pause_conges = coalesce(${user.estAgent ? input.pauseConges : null}::boolean, pause_conges),
               updated_at = now()
         WHERE user_id = ${user.userId}`);
    });
    return this.lire(user);
  }
}
