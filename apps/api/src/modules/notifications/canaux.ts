import { sql, type SQL } from 'drizzle-orm';
import { CANAUX_PAR_DEFAUT, type SujetNotification } from '@teranga/contracts';
import type { Tx } from '../../db/tenant-db';

/* Où une notification trouve chacun de ses destinataires.

   Ses réglages pour le sujet (sans réglage : plateforme et courriel), puis
   ce qui vaut pour tous ses sujets : en congé, qui l'a demandé ne reçoit
   pas de courriel, la notification l'attend dans la plateforme. « En
   congé » se lit comme pour la DCH (cf. acces/dch.ts) : une absence
   approuvée couvre ce jour, et elle éloigne (une mission laisse joignable,
   quelques heures aussi). */

/** L'utilisateur est en congé aujourd'hui (absence approuvée qui l'éloigne). */
export const enCongeAujourdhui = (userId: SQL) => sql`EXISTS (
  SELECT 1 FROM absence_requests ab
    JOIN absence_types ty ON ty.id = ab.absence_type_id AND NOT ty.reste_joignable
    JOIN employees e ON e.id = ab.employee_id
    JOIN persons pe ON pe.id = e.person_id
   WHERE pe.user_id = ${userId} AND ab.status = 'approved' AND ab.start_time IS NULL
     AND CURRENT_DATE BETWEEN ab.start_date AND ab.end_date)`;

export interface CanauxDuDestinataire {
  plateforme: boolean;
  courriel: boolean;
}

/** Les canaux de chaque destinataire, pour ce sujet. */
export async function canauxDe(
  tx: Tx,
  userIds: readonly string[],
  sujet: SujetNotification,
): Promise<Map<string, CanauxDuDestinataire>> {
  const canaux = new Map<string, CanauxDuDestinataire>();
  const uniques = [...new Set(userIds)];
  if (uniques.length === 0) return canaux;
  const { rows } = await tx.execute<{
    user_id: string;
    plateforme: boolean | null;
    courriel: boolean | null;
    en_pause: boolean;
  }>(sql`
    SELECT x.id AS user_id, p.plateforme, p.courriel,
           coalesce(r.pause_conges, false) AND ${enCongeAujourdhui(sql`x.id`)} AS en_pause
      FROM unnest(${`{${uniques.join(',')}}`}::uuid[]) AS x(id)
      LEFT JOIN notification_preferences p ON p.user_id = x.id AND p.sujet = ${sujet}
      LEFT JOIN notification_reglages r ON r.user_id = x.id`);
  for (const r of rows) {
    canaux.set(r.user_id, {
      plateforme: r.plateforme ?? CANAUX_PAR_DEFAUT.plateforme,
      courriel: (r.courriel ?? CANAUX_PAR_DEFAUT.courriel) && !r.en_pause,
    });
  }
  return canaux;
}
