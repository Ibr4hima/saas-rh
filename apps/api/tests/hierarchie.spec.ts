/**
 * Le classement des anomalies de la chaîne hiérarchique (ADR-0147).
 *
 * Le N+1 hiérarchique se calcule : ne reste à signaler que ce qui EMPÊCHE de
 * le calculer, les plus bloquantes d'abord. Sans base : les fonctions sont
 * pures.
 */
import { describe, expect, it } from 'vitest';
import {
  ANOMALIES_BLOQUANTES,
  bloqueLEvaluation,
  type AnomalieHierarchie,
} from '@teranga/contracts';
import { compterParType, trierAnomalies } from '../src/modules/people/hierarchie';

function anomalie(matricule: string, type: AnomalieHierarchie['type']): AnomalieHierarchie {
  return {
    employeeId: `id-${matricule}`,
    matricule,
    nom: `Agent ${matricule}`,
    direction: null,
    type,
    responsable: null,
    directionDuResponsable: null,
  };
}

describe('les anomalies de la chaîne', () => {
  it('se trient par gravité, puis par matricule', () => {
    const triees = trierAnomalies([
      anomalie('APIX-3', 'sans_unite'),
      anomalie('APIX-2', 'sans_dg'),
      anomalie('APIX-1', 'sans_unite'),
      anomalie('APIX-9', 'dg_hors_direction_generale'),
    ]);
    expect(triees.map((a) => `${a.matricule}:${a.type}`)).toEqual([
      'APIX-9:dg_hors_direction_generale',
      'APIX-2:sans_dg',
      'APIX-1:sans_unite',
      'APIX-3:sans_unite',
    ]);
  });

  it('se comptent par type, chaque type présent même à zéro', () => {
    expect(compterParType([anomalie('A', 'sans_unite'), anomalie('B', 'sans_unite')])).toEqual({
      dg_hors_direction_generale: 0,
      sans_dg: 0,
      sans_unite: 2,
    });
  });

  it('sans unité ou sans DG, personne ne peut évaluer', () => {
    expect(ANOMALIES_BLOQUANTES.sort()).toEqual(['sans_dg', 'sans_unite']);
    expect(bloqueLEvaluation('sans_unite')).toBe(true);
    expect(bloqueLEvaluation('dg_hors_direction_generale')).toBe(false);
  });
});
