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

/**
 * Arrondi par défaut — 79,6 % ne s'affiche jamais « 80 % » —, avec la marge
 * qu'il faut aux flottants : 29/50 × 100 vaut 57,999… et doit rester 58 %.
 */
export function pourcent(part: number): string {
  return `${Math.floor(Math.min(1, Math.max(0, part)) * 100 + 1e-9)} %`;
}

/**
 * Le fond des couvertures : le bleu de la BANDE SUPÉRIEURE, exactement — le
 * même jeton, qui suit donc le mode sombre. Une nuance par famille donnait
 * un catalogue qui paraissait mal assorti plutôt que classé ; les familles se
 * distinguent par leur nom et leur icône, pas par la couleur. L'orange reste
 * réservé à ce qui attend une action.
 */
export const FOND_COUVERTURE = 'var(--tg-hero)';

/** La famille d'une formation : son nom et son icône. */
export const FAMILLES: Record<AcademyCategory, { label: string; icone: IconName }> = {
  bureautique: {
    label: ACADEMY_CATEGORY_LABELS.bureautique,
    icone: 'computer',
  },
  digital: {
    label: ACADEMY_CATEGORY_LABELS.digital,
    icone: 'devices',
  },
  economie: {
    label: ACADEMY_CATEGORY_LABELS.economie,
    icone: 'trending_up',
  },
  droit: {
    label: ACADEMY_CATEGORY_LABELS.droit,
    icone: 'gavel',
  },
  metier: {
    label: ACADEMY_CATEGORY_LABELS.metier,
    icone: 'business_center',
  },
  management: {
    label: ACADEMY_CATEGORY_LABELS.management,
    icone: 'group',
  },
  projets: {
    label: ACADEMY_CATEGORY_LABELS.projets,
    icone: 'account_tree',
  },
  communication: {
    label: ACADEMY_CATEGORY_LABELS.communication,
    icone: 'campaign',
  },
  langues: {
    label: ACADEMY_CATEGORY_LABELS.langues,
    icone: 'translate',
  },
  conformite: {
    label: ACADEMY_CATEGORY_LABELS.conformite,
    icone: 'verified_user',
  },
};

export const MOTS_ETAT: Record<EtatLecon, string> = {
  verrouillee: 'Terminez d’abord la leçon précédente',
  a_suivre: 'À suivre',
  en_cours: 'En cours',
  validee: 'Validée',
};

/**
 * « aujourd'hui à 14 h 05 », « demain à 9 h 00 », « le 28 septembre à 9 h 00 » :
 * l'heure d'une prochaine tentative, dite comme on la dirait.
 */
export function quandLisible(iso: string, maintenant = new Date()): string {
  const d = new Date(iso);
  const heure = `${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}`;
  const jour = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const ecart = Math.round((jour(d) - jour(maintenant)) / 86_400_000);
  if (ecart === 0) return `aujourd’hui à ${heure}`;
  if (ecart === 1) return `demain à ${heure}`;
  return `le ${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} à ${heure}`;
}

export const STATUTS_CERTIFICAT = {
  valide: { label: 'Valide', tone: 'success' },
  // Un certificat expiré attend d'être renouvelé : c'est l'orange de l'attente.
  expire: { label: 'Expiré', tone: 'warning' },
  revoque: { label: 'Révoqué', tone: 'danger' },
} as const;
