import * as React from 'react';
import { cn } from '@teranga/ui';
import manifest from './icon-font.manifest.json';

/**
 * Icônes du produit — Material Symbols Outlined, rendues par ligature.
 *
 * Un seul jeu d'icônes dans toute l'application : mélanger deux familles
 * (traits fins d'un côté, pleins de l'autre) se voit immédiatement sur un
 * même écran — la barre latérale et le tableau de bord se regardent.
 *
 * La police est SOUS-ENSEMBLÉE aux seules icônes listées ci-dessous et servie
 * depuis /fonts (23 Ko) : aucune requête vers un tiers à l'exécution. Cette
 * liste est la source de vérité — `scripts/fetch-icon-font.mjs` la lit pour
 * fabriquer la police. Après y avoir ajouté une icône :
 *
 *     pnpm --filter @teranga/web icons:fetch
 *
 * Sans cela l'icône manquerait de la police et s'afficherait comme son nom en
 * toutes lettres ; le garde de développement ci-dessous prévient avant.
 */
export const ICON_NAMES = [
  'add',
  'badge',
  'calendar_month',
  'check',
  'chevron_left',
  'chevron_right',
  'close',
  'content_copy',
  'dashboard',
  'edit',
  'error',
  'event',
  'event_busy',
  'family_history',
  'flag',
  'folder_managed',
  'free_cancellation',
  'gavel',
  'group',
  'how_to_reg',
  'logout',
  'notifications',
  'person_add',
  'rule',
  'schedule',
  'settings',
] as const;

export type IconName = (typeof ICON_NAMES)[number];

if (process.env.NODE_ENV !== 'production') {
  const gravees = new Set<string>(manifest.icons);
  const manquantes = ICON_NAMES.filter((n) => !gravees.has(n));
  if (manquantes.length > 0) {
    console.warn(
      `[icons] ${manquantes.join(', ')} ne sont pas dans la police servie — ` +
        'lancez « pnpm --filter @teranga/web icons:fetch », sinon ces icônes ' +
        "s'afficheront sous forme de texte.",
    );
  }
}

type IconProps = Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> & {
  name: IconName;
  size?: number;
  /** Icône pleine — réservée à l'état actif, jamais au repos. */
  fill?: boolean;
  weight?: 300 | 400 | 500 | 600;
};

export function Icon({
  name,
  size = 18,
  fill = false,
  weight = 400,
  className,
  style,
  ...rest
}: IconProps) {
  return (
    <span
      aria-hidden
      className={cn('ms-icon', className)}
      style={{
        fontSize: size,
        width: size,
        height: size,
        // L'axe optique suit la taille de rendu : les contre-formes s'ouvrent en
        // petit, les traits s'affinent en grand. Borné à la plage servie.
        fontVariationSettings: `'FILL' ${fill ? 1 : 0}, 'wght' ${weight}, 'GRAD' 0, 'opsz' ${Math.min(48, Math.max(20, size))}`,
        ...style,
      }}
      {...rest}
    >
      {name}
    </span>
  );
}
