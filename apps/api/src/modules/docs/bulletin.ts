import type { PeriodeDuBulletin } from '@teranga/contracts';

/*
   La période d'un bulletin de salaire en base (0098) : un mois ou une
   période y sont le premier et le dernier mois, au 1er du mois ; les N
   derniers, leur nombre. Le bulletin ne se demande plus (ADR-0084) : seules
   les demandes anciennes en portent une.
*/

/** La période, depuis les colonnes ; `null` : un autre document, ou un bulletin demandé sans mois. */
export function periodeDu(
  du: string | null,
  au: string | null,
  derniers: number | null,
): PeriodeDuBulletin | null {
  if (derniers) return { type: 'derniers', nombre: derniers };
  if (!du || !au) return null;
  const [premier, dernier] = [du.slice(0, 7), au.slice(0, 7)];
  return premier === dernier
    ? { type: 'mois', mois: premier }
    : { type: 'periode', du: premier, au: dernier };
}
