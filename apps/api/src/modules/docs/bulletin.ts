import type { PeriodeDuBulletin } from '@teranga/contracts';

/*
   La période d'un bulletin de salaire en base (0098) : un mois ou une
   période y sont le premier et le dernier mois, au 1er du mois ; les N
   derniers, leur nombre.
*/

/** Les colonnes de la demande, depuis la période choisie. */
export function colonnesDuBulletin(p: PeriodeDuBulletin | undefined): {
  payslipFrom: string | null;
  payslipTo: string | null;
  payslipLastMonths: number | null;
} {
  if (!p) return { payslipFrom: null, payslipTo: null, payslipLastMonths: null };
  if (p.type === 'derniers') {
    return { payslipFrom: null, payslipTo: null, payslipLastMonths: p.nombre };
  }
  const [du, au] = p.type === 'mois' ? [p.mois, p.mois] : [p.du, p.au];
  return { payslipFrom: `${du}-01`, payslipTo: `${au}-01`, payslipLastMonths: null };
}

/** La période, depuis les colonnes ; `null` : un autre document, ou un bulletin demandé avant. */
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
