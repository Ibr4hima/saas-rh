'use client';

import { type Capacite } from '@teranga/contracts';
import { Badge } from '@teranga/ui';
import { Icon } from './icons';

/**
 * La gestion du personnel se délègue d'un bloc : tout ce que sa page
 * demande — consulter, gérer, les données sensibles, effacer un dossier, et
 * les soldes de congés, qui se règlent depuis la fiche.
 */
export const CAPACITES_PERSONNEL = [
  'personnel.consulter',
  'personnel.gerer',
  'personnel.sensible',
  'personnel.effacer',
  'conges.soldes',
] as const satisfies readonly Capacite[];

/** « Sensible » — comme sur « Déléguer des tâches ». */
export function PastilleSensible() {
  return (
    <Badge
      tone="gris"
      size="sm"
      title="Données sensibles : à confier avec soin."
      className="ml-2 translate-y-[-1px] align-middle"
    >
      <Icon name="lock" size={11} />
      Sensible
    </Badge>
  );
}
