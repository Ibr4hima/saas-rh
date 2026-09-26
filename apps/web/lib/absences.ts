import type { AbsenceRequestView } from '@teranga/contracts';

export const ABSENCE_STATUS_LABELS: Record<string, string> = {
  pending: 'En attente',
  approved: 'Approuvée',
  rejected: 'Refusée',
  cancelled: 'Annulée',
};

export const ABSENCE_STATUS_TONES: Record<string, 'warning' | 'success' | 'danger' | 'neutral'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
};

export const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrateur',
  hr: 'RH',
  payroll: 'Paie',
  manager: 'Manager',
  employee: 'Employé',
};

/**
 * Le circuit de visa d'une demande, en toutes lettres — niveau par niveau,
 * qui a signé, qui reste attendu.
 *
 * Sert d'infobulle au statut, côté RH comme côté portail : le même texte des
 * deux côtés, sinon l'employé et son gestionnaire ne lisent pas la même
 * histoire de la même demande.
 */
export function resumeVisas(r: AbsenceRequestView): string | undefined {
  if (r.chainLevels.length === 0) return undefined;
  return r.chainLevels
    .map((role, i) => {
      const qui = ROLE_LABELS[role] ?? role;
      const visa = r.approvals.find((a) => a.level === i);
      if (visa?.decision === 'approved') return `${qui} — visé par ${visa.decidedByName}`;
      if (visa?.decision === 'rejected') return `${qui} — refusé par ${visa.decidedByName}`;
      return `${qui} — en attente`;
    })
    .join('\n');
}
