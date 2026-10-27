import type { EtapeConge } from '@teranga/contracts';
import { Badge } from '@teranga/ui';
import { ABSENCE_STATUS_LABELS, ABSENCE_STATUS_TONES } from '../lib/absences';

/** Une demande en attente dit QUI elle attend — l'étape, pas la personne. */
const EN_ATTENTE_DE: Record<EtapeConge, string> = {
  n1: 'En attente du N+1',
  dch: 'En attente de la DCH',
};

/**
 * Le statut d'une demande d'absence.
 *
 * Le mot porte lui-même la couleur : l'état se lit d'un coup d'œil sur vingt
 * lignes sans que la couleur soit seule à le dire — un daltonien, une
 * impression en noir et blanc lisent le mot.
 */
export function StatutAbsence({
  statut,
  etape,
  titre,
  className,
}: {
  statut: string;
  /** L'étape qui attend un visa, pour une demande en attente. */
  etape?: EtapeConge | null;
  /** Le détail du circuit de visa, au survol : niveau par niveau, qui a signé. */
  titre?: string;
  className?: string;
}) {
  const ton = ABSENCE_STATUS_TONES[statut] ?? 'gris';
  const libelle =
    statut === 'pending' && etape
      ? EN_ATTENTE_DE[etape]
      : (ABSENCE_STATUS_LABELS[statut] ?? statut);
  return (
    <Badge tone={ton} title={titre} className={className}>
      {libelle}
    </Badge>
  );
}
