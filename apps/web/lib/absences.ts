import { ETAPE_CONGE_LABELS, type AbsenceRequestView } from '@teranga/contracts';

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
 * Le circuit de visa d'une demande, en toutes lettres — étape par étape, qui
 * a signé, qui reste attendu : le n+1, puis la RH.
 *
 * Sert d'infobulle au statut, côté RH comme côté portail : le même texte des
 * deux côtés, sinon l'employé et son gestionnaire ne lisent pas la même
 * histoire de la même demande.
 */
export function resumeVisas(r: AbsenceRequestView): string | undefined {
  if (r.circuit.length === 0) return undefined;
  return r.circuit
    .map((e) => {
      const qui = ETAPE_CONGE_LABELS[e.etape];
      switch (e.etat) {
        case 'visee':
          return `${qui} — visé par ${e.qui}`;
        case 'refusee':
          return `${qui} — refusé par ${e.qui}${e.comment ? ` : « ${e.comment} »` : ''}`;
        case 'attendue':
          return `${qui} — en attente${e.qui ? ` de ${e.qui}` : ''}`;
        case 'a_venir':
          return `${qui} — ensuite`;
        case 'passee':
          return `${qui} — aucun n+1 pour viser : directement à la RH`;
        default:
          return `${qui} — sans objet`;
      }
    })
    .join('\n');
}

/**
 * Qui la demande attend, en une ligne — « Attend son n+1 · Awa Diop »,
 * « Attend la RH » — ou rien quand elle n'attend plus.
 */
export function visaAttendu(r: AbsenceRequestView): string | null {
  if (r.status !== 'pending' || !r.etapeAttendue) return null;
  if (r.etapeAttendue === 'rh') return 'Attend la RH';
  const qui = r.circuit.find((e) => e.etape === 'n1')?.qui;
  return qui ? `Attend son n+1 · ${qui}` : 'Attend son n+1';
}
