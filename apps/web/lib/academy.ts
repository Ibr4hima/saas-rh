import type { AcademyCategory, EtatLecon } from '@teranga/contracts';
import { ACADEMY_CATEGORY_LABELS } from '@teranga/contracts';
import type { IconName } from '../components/icons';

/* ————————————————————————————————————————————————————————————————
   APIX Academy, côté écran : les mots, les durées, les familles.
   ———————————————————————————————————————————————————————————————— */

/** « 48 min », « 1 h 05 » : la durée d'une formation, à la minute. */
export function dureeLisible(secondes: number): string {
  const minutes = Math.max(1, Math.round(secondes / 60));
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
}

/** « 3:07 » : la position dans une vidéo, comme la montrent tous les lecteurs. */
export function horloge(secondes: number): string {
  const s = Math.max(0, Math.floor(secondes));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function pourcent(part: number): string {
  return `${Math.floor(Math.min(1, Math.max(0, part)) * 100)} %`;
}

/**
 * La famille d'une formation : son nom, son icône, et la nuance de sa
 * couverture.
 *
 * Toutes les couvertures restent dans le BLEU de la marque — c'est lui qui
 * structure. L'orange est réservé à ce qui attend une action : une couverture
 * orange dirait « à traiter » d'une formation qui n'attend rien. Les
 * familles se distinguent par leur icône, et par une nuance de bleu qui
 * suffit à l'œil sans rien lui faire lire.
 */
export const FAMILLES: Record<
  AcademyCategory,
  { label: string; icone: IconName; degrade: string }
> = {
  bureautique: {
    label: ACADEMY_CATEGORY_LABELS.bureautique,
    icone: 'computer',
    degrade: 'linear-gradient(135deg, #004f91 0%, #0a6cc2 100%)',
  },
  digital: {
    label: ACADEMY_CATEGORY_LABELS.digital,
    icone: 'devices',
    degrade: 'linear-gradient(135deg, #03457a 0%, #1b7fc4 100%)',
  },
  economie: {
    label: ACADEMY_CATEGORY_LABELS.economie,
    icone: 'trending_up',
    degrade: 'linear-gradient(135deg, #0b3a6b 0%, #1f5f9c 100%)',
  },
  droit: {
    label: ACADEMY_CATEGORY_LABELS.droit,
    icone: 'gavel',
    degrade: 'linear-gradient(135deg, #1c2f55 0%, #34588f 100%)',
  },
  metier: {
    label: ACADEMY_CATEGORY_LABELS.metier,
    icone: 'business_center',
    degrade: 'linear-gradient(135deg, #00325f 0%, #004f91 100%)',
  },
  management: {
    label: ACADEMY_CATEGORY_LABELS.management,
    icone: 'group',
    degrade: 'linear-gradient(135deg, #1b3f73 0%, #3a6fb0 100%)',
  },
  projets: {
    label: ACADEMY_CATEGORY_LABELS.projets,
    icone: 'account_tree',
    degrade: 'linear-gradient(135deg, #0d3b63 0%, #2667a8 100%)',
  },
  communication: {
    label: ACADEMY_CATEGORY_LABELS.communication,
    icone: 'campaign',
    degrade: 'linear-gradient(135deg, #123f6e 0%, #2f7ab8 100%)',
  },
  langues: {
    label: ACADEMY_CATEGORY_LABELS.langues,
    icone: 'translate',
    degrade: 'linear-gradient(135deg, #0d3566 0%, #3868a8 100%)',
  },
  conformite: {
    label: ACADEMY_CATEGORY_LABELS.conformite,
    icone: 'verified_user',
    degrade: 'linear-gradient(135deg, #16294a 0%, #2d4d7e 100%)',
  },
};

export const MOTS_ETAT: Record<EtatLecon, string> = {
  verrouillee: 'Terminez d’abord la leçon précédente',
  a_suivre: 'À suivre',
  en_cours: 'En cours',
  validee: 'Validée',
};
