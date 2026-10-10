import {
  dureeEnLettres,
  ETAPE_CONGE_LABELS,
  heureEnLettres,
  type AbsenceRequestView,
} from '@teranga/contracts';
import { formatDate } from './hooks';
import { compte } from './mots';

type Periode = Pick<
  AbsenceRequestView,
  'startDate' | 'endDate' | 'startTime' | 'endTime' | 'daysCount'
>;

/** « 8 oct. 2026 → 10 oct. 2026 » ; à l'heure, « 8 oct. 2026, 10 h → 12 h ». */
export function periodeAbsence(r: Periode): string {
  if (r.startTime && r.endTime) {
    // Les heures d'un seul tenant : la ligne ne se coupe pas entre elles.
    return `${formatDate(r.startDate)}, ${heureEnLettres(r.startTime)}\u00a0→\u00a0${heureEnLettres(r.endTime)}`;
  }
  return `${formatDate(r.startDate)} → ${formatDate(r.endDate)}`;
}

/** « 3 jours » ; à l'heure, « 2 h ». */
export function dureeAbsence(r: Periode): string {
  return r.startTime && r.endTime
    ? dureeEnLettres(r.startTime, r.endTime)
    : compte(r.daysCount, 'jour');
}

export const ABSENCE_STATUS_LABELS: Record<string, string> = {
  pending: 'En attente',
  approved: 'Approuvée',
  rejected: 'Refusée',
  cancelled: 'Annulée',
  expired: 'Expirée',
};

export const ABSENCE_STATUS_TONES: Record<string, 'orange' | 'teal' | 'rouge' | 'gris'> = {
  pending: 'orange',
  approved: 'teal',
  rejected: 'rouge',
  cancelled: 'gris',
  expired: 'gris',
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
 * a signé, qui reste attendu : le N+1, puis la DCH.
 *
 * Sert d'infobulle au statut, côté DCH comme côté portail : le même texte
 * des deux côtés, sinon l'employé et son gestionnaire ne lisent pas la même
 * histoire de la même demande.
 */
export function resumeVisas(r: AbsenceRequestView): string | undefined {
  if (r.circuit.length === 0) return undefined;
  return r.circuit
    .map((e) => {
      const qui = ETAPE_CONGE_LABELS[e.etape];
      const signe = `${e.qui}${e.parDelegationDe ? `, par délégation de ${e.parDelegationDe}` : ''}`;
      switch (e.etat) {
        case 'visee':
          return `${qui} : visé par ${signe}`;
        case 'refusee':
          return `${qui} : refusé par ${signe}${e.comment ? ` : « ${e.comment} »` : ''}`;
        case 'attendue':
          return `${qui} : en attente${e.qui ? ` de ${e.qui}` : ''}`;
        case 'a_venir':
          return `${qui} : ensuite`;
        case 'passee':
          return `${qui} : personne pour viser : directement à la DCH`;
        case 'sans_reponse':
          return `${qui} : sans réponse dans le délai`;
        default:
          return `${qui} : sans objet`;
      }
    })
    .join('\n');
}
