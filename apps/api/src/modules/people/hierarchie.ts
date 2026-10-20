import type { AnomalieHierarchie, TypeAnomalieHierarchie } from '@teranga/contracts';

/* ————————————————————————————————————————————————————————————————
   Le classement des anomalies de la chaîne (ADR-0147).

   Le N+1 hiérarchique se calcule : ce N+1 n'est jamais « faux ». Ne reste à
   signaler que ce qui EMPÊCHE de le calculer, dans cet ordre de priorité.
   ———————————————————————————————————————————————————————————————— */

export const TYPES_ANOMALIE: TypeAnomalieHierarchie[] = [
  'dg_hors_direction_generale',
  'sans_dg',
  'sans_unite',
];

/** Les plus bloquantes d'abord, puis par matricule : deux lectures rendent le même ordre. */
export function trierAnomalies(anomalies: AnomalieHierarchie[]): AnomalieHierarchie[] {
  return anomalies.sort(
    (a, b) =>
      TYPES_ANOMALIE.indexOf(a.type) - TYPES_ANOMALIE.indexOf(b.type) ||
      a.matricule.localeCompare(b.matricule, 'fr'),
  );
}

export function compterParType(
  anomalies: AnomalieHierarchie[],
): Record<TypeAnomalieHierarchie, number> {
  const parType = Object.fromEntries(TYPES_ANOMALIE.map((t) => [t, 0])) as Record<
    TypeAnomalieHierarchie,
    number
  >;
  for (const a of anomalies) parType[a.type] += 1;
  return parType;
}
