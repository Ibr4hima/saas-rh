import { sql, type SQL } from 'drizzle-orm';
import { CANAUX_PAR_DEFAUT, type SujetNotification } from '@teranga/contracts';
import type { Tx } from '../../db/tenant-db';

/* Où une notification trouve chacun de ses destinataires.

   Ses réglages pour le sujet (sans réglage : plateforme et courriel), puis
   ce qui vaut pour tous ses sujets :
   · WhatsApp ne part que vers un numéro vérifié ;
   · en congé, qui l'a demandé ne reçoit ni courriel ni WhatsApp : la
     notification l'attend dans la plateforme. « En congé » se lit comme
     pour la DCH (cf. acces/dch.ts) : une absence approuvée couvre ce jour,
     et elle éloigne (une mission laisse joignable). */

/** L'utilisateur est en congé aujourd'hui (absence approuvée qui l'éloigne). */
export const enCongeAujourdhui = (userId: SQL) => sql`EXISTS (
  SELECT 1 FROM absence_requests ab
    JOIN absence_types ty ON ty.id = ab.absence_type_id AND NOT ty.reste_joignable
    JOIN employees e ON e.id = ab.employee_id
    JOIN persons pe ON pe.id = e.person_id
   WHERE pe.user_id = ${userId} AND ab.status = 'approved'
     AND CURRENT_DATE BETWEEN ab.start_date AND ab.end_date)`;

export interface CanauxDuDestinataire {
  plateforme: boolean;
  courriel: boolean;
  whatsapp: boolean;
  /** Pour WhatsApp : attendre le prochain créneau ouvré. */
  heuresCalmes: boolean;
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
    whatsapp: boolean | null;
    verifie: boolean;
    heures_calmes: boolean | null;
    en_pause: boolean;
  }>(sql`
    SELECT x.id AS user_id, p.plateforme, p.courriel, p.whatsapp,
           r.whatsapp_verifie_le IS NOT NULL AS verifie,
           r.heures_calmes,
           coalesce(r.pause_conges, false) AND ${enCongeAujourdhui(sql`x.id`)} AS en_pause
      FROM unnest(${`{${uniques.join(',')}}`}::uuid[]) AS x(id)
      LEFT JOIN notification_preferences p ON p.user_id = x.id AND p.sujet = ${sujet}
      LEFT JOIN notification_reglages r ON r.user_id = x.id`);
  for (const r of rows) {
    const courriel = r.courriel ?? CANAUX_PAR_DEFAUT.courriel;
    const whatsapp = (r.whatsapp ?? CANAUX_PAR_DEFAUT.whatsapp) && r.verifie;
    canaux.set(r.user_id, {
      plateforme: r.plateforme ?? CANAUX_PAR_DEFAUT.plateforme,
      courriel: courriel && !r.en_pause,
      whatsapp: whatsapp && !r.en_pause,
      heuresCalmes: r.heures_calmes ?? true,
    });
  }
  return canaux;
}
