/**
 * Le classement des anomalies de la chaîne hiérarchique.
 *
 * Deux règles de l'APIX à éprouver : un n+1 pour tous sauf le directeur
 * général, et ce n+1 dans la même direction — le directeur faisant exception,
 * puisqu'il relève du directeur général.
 *
 * Sans base : la fonction est pure, et c'est exprès. Fabriquer une boucle
 * hiérarchique en SQL demanderait de contourner la validation qui l'interdit ;
 * ici on la pose en trois lignes, et l'on vérifie que seuls SES membres sont
 * signalés — pas la moitié de l'organigramme qui y mène.
 */
import { describe, expect, it } from 'vitest';
import { ANOMALIES_BLOQUANTES, bloqueLEvaluation } from '@teranga/contracts';
import {
  classerAnomalies,
  compterParType,
  type LigneHierarchie,
} from '../src/modules/people/hierarchie';

const DSID = { id: 'u-dsid', nom: 'Direction des Systèmes' };
const DCH = { id: 'u-dch', nom: 'Direction du Capital Humain' };
const DG = { id: 'u-dg', nom: 'Direction Générale' };

/** Un agent ordinaire : affecté, rattaché, dans les règles. */
function agent(id: string, plus: Partial<LigneHierarchie> = {}): LigneHierarchie {
  return {
    employeeId: id,
    matricule: `APIX-${id}`,
    nom: `Agent ${id}`,
    directionId: DSID.id,
    directionNom: DSID.nom,
    responsableId: 'chef',
    responsableNom: 'Le Chef',
    responsableActif: true,
    responsableDirectionId: DSID.id,
    responsableDirectionNom: DSID.nom,
    dirigeUneDirection: false,
    estDirecteurGeneral: false,
    ...plus,
  };
}

const types = (lignes: LigneHierarchie[], dg: string | null = 'dg') =>
  classerAnomalies(lignes, dg).map((a) => `${a.employeeId}:${a.type}`);

describe('la chaîne en règle', () => {
  it('ne signale rien quand chacun relève de sa direction', () => {
    expect(types([agent('a'), agent('b')])).toEqual([]);
  });

  it('ne réclame pas de n+1 au directeur général', () => {
    const dg = agent('dg', {
      responsableId: null,
      responsableNom: null,
      responsableActif: null,
      responsableDirectionId: null,
      responsableDirectionNom: null,
      directionId: DG.id,
      directionNom: DG.nom,
      dirigeUneDirection: true,
      estDirecteurGeneral: true,
    });
    expect(types([dg])).toEqual([]);
  });

  it('accepte qu’un directeur relève du directeur général, hors de sa direction', () => {
    const directeur = agent('directeur', {
      responsableId: 'dg',
      responsableDirectionId: DG.id,
      responsableDirectionNom: DG.nom,
      dirigeUneDirection: true,
    });
    expect(types([directeur])).toEqual([]);
  });
});

describe('ce qui manque', () => {
  it('signale un agent sans responsable', () => {
    expect(
      types([agent('a', { responsableId: null, responsableNom: null, responsableActif: null })]),
    ).toEqual(['a:sans_responsable']);
  });

  it('signale un responsable dont le dossier est archivé', () => {
    expect(types([agent('a', { responsableActif: false })])).toEqual(['a:responsable_archive']);
  });

  it('signale une affectation absente : la règle n’est plus vérifiable', () => {
    expect(types([agent('a', { directionId: null, directionNom: null })])).toEqual([
      'a:sans_direction',
    ]);
  });
});

describe('la règle de direction', () => {
  it('signale un n+1 d’une autre direction', () => {
    const a = agent('a', {
      responsableDirectionId: DCH.id,
      responsableDirectionNom: DCH.nom,
    });
    expect(types([a])).toEqual(['a:hors_direction']);
    expect(classerAnomalies([a], 'dg')[0]?.directionDuResponsable).toBe(DCH.nom);
  });

  it('signale un directeur rattaché à quelqu’un d’autre que le directeur général', () => {
    const directeur = agent('directeur', {
      responsableId: 'un-autre',
      responsableDirectionId: DG.id,
      dirigeUneDirection: true,
    });
    expect(types([directeur])).toEqual(['directeur:directeur_mal_rattache']);
  });

  it('signale un directeur quand AUCUN directeur général n’est désigné', () => {
    const directeur = agent('directeur', { dirigeUneDirection: true, responsableId: 'x' });
    expect(types([directeur], null)).toEqual(['directeur:directeur_mal_rattache']);
  });

  it('ne reproche pas à l’agent que SON n+1 soit sans affectation', () => {
    // C'est le n+1 qui est en défaut, et sa propre ligne le dira.
    const a = agent('a', { responsableDirectionId: null, responsableDirectionNom: null });
    expect(types([a])).toEqual([]);
  });
});

describe('les boucles', () => {
  it('signale les DEUX membres d’un aller-retour', () => {
    const a = agent('a', { responsableId: 'b' });
    const b = agent('b', { responsableId: 'a' });
    expect(types([a, b]).sort()).toEqual(['a:boucle', 'b:boucle']);
  });

  it('ne signale QUE les membres de la boucle, pas ceux qui y mènent', () => {
    // c → a → b → a : la boucle est {a, b} ; c n'est qu'une victime.
    const a = agent('a', { responsableId: 'b' });
    const b = agent('b', { responsableId: 'a' });
    const c = agent('c', { responsableId: 'a' });
    const trouves = types([a, b, c]);
    expect(trouves.sort()).toEqual(['a:boucle', 'b:boucle']);
  });

  it('remonte une boucle de trois, et s’arrête', () => {
    const a = agent('a', { responsableId: 'b' });
    const b = agent('b', { responsableId: 'c' });
    const c = agent('c', { responsableId: 'a' });
    expect(types([a, b, c]).sort()).toEqual(['a:boucle', 'b:boucle', 'c:boucle']);
  });

  it('ne voit pas de boucle dans une chaîne qui monte jusqu’au sommet', () => {
    const dg = agent('dg', {
      responsableId: null,
      responsableActif: null,
      dirigeUneDirection: true,
      estDirecteurGeneral: true,
      directionId: DG.id,
    });
    const directeur = agent('directeur', {
      responsableId: 'dg',
      responsableDirectionId: DG.id,
      dirigeUneDirection: true,
    });
    const agentSimple = agent('a', { responsableId: 'directeur' });
    expect(types([dg, directeur, agentSimple])).toEqual([]);
  });
});

describe('l’ordre et les décomptes', () => {
  it('range les anomalies de la plus bloquante à la plus bénigne', () => {
    const lignes = [
      agent('z', { directionId: null, directionNom: null }),
      agent('y', { responsableDirectionId: DCH.id }),
      agent('x', { responsableId: null, responsableActif: null }),
      agent('w', { responsableId: 'v' }),
      agent('v', { responsableId: 'w' }),
    ];
    expect(classerAnomalies(lignes, 'dg').map((a) => a.type)).toEqual([
      'boucle',
      'boucle',
      'sans_responsable',
      'hors_direction',
      'sans_direction',
    ]);
  });

  it('compte par type, zéros compris', () => {
    const parType = compterParType(
      classerAnomalies([agent('a', { responsableId: null, responsableActif: null })], 'dg'),
    );
    expect(parType.sans_responsable).toBe(1);
    expect(parType.hors_direction).toBe(0);
    expect(Object.keys(parType)).toHaveLength(6);
  });

  it('dit lesquelles empêchent d’évaluer', () => {
    // Sans n+1, personne ne peut fixer d'objectifs ni évaluer : c'est une
    // impossibilité, pas une punition. Un rattachement hors direction, lui,
    // est une entorse — quelqu'un peut évaluer.
    expect(ANOMALIES_BLOQUANTES).toEqual(['boucle', 'sans_responsable', 'responsable_archive']);
    expect(bloqueLEvaluation('sans_responsable')).toBe(true);
    expect(bloqueLEvaluation('hors_direction')).toBe(false);
    expect(bloqueLEvaluation('sans_direction')).toBe(false);
  });
});
