/**
 * Une unité dans une phrase : « Les agents de la DCH », « Rattachée à la
 * Direction Générale (DG) ». Pure fonction ; les accords suivent
 * `posteDeResponsable` : une direction au féminin, le Secrétariat général au
 * masculin, un département ou un service nommé par sa nature.
 */
import { describe, expect, it } from 'vitest';
import { uniteAvecArticle } from '@teranga/contracts';

const dch = {
  name: 'Direction du Capital Humain',
  unitType: 'direction',
  shortName: 'DCH',
} as const;
const dg = { name: 'Direction Générale', unitType: 'direction', shortName: 'DG' } as const;
const sg = { name: 'Secrétariat général', unitType: 'direction', shortName: 'SG' } as const;
const etudes = { name: 'Département Études', unitType: 'department', shortName: null } as const;
const compta = { name: 'Comptabilité', unitType: 'service', shortName: null } as const;

describe('uniteAvecArticle', () => {
  it('met l’article féminin devant une direction, désignée par son acronyme', () => {
    expect(uniteAvecArticle('de', dch)).toBe('de la DCH');
    expect(uniteAvecArticle('à', dch)).toBe('à la DCH');
    expect(uniteAvecArticle('dans', dch)).toBe('dans la DCH');
  });

  it('écrit le libellé demandé à la place de l’acronyme', () => {
    expect(uniteAvecArticle('de', dch, 'Direction du Capital Humain')).toBe(
      'de la Direction du Capital Humain',
    );
    expect(uniteAvecArticle('à', dg, 'Direction Générale (DG)')).toBe(
      'à la Direction Générale (DG)',
    );
  });

  it('prend le nom d’une direction sans acronyme', () => {
    expect(uniteAvecArticle('dans', { name: 'Direction des Moyens', unitType: 'direction' })).toBe(
      'dans la Direction des Moyens',
    );
  });

  it('dit le Secrétariat général au masculin', () => {
    expect(uniteAvecArticle('de', sg)).toBe('du SG');
    expect(uniteAvecArticle('à', sg)).toBe('au SG');
    expect(uniteAvecArticle('dans', sg)).toBe('dans le SG');
  });

  it('nomme un département ou un service par sa nature, en minuscule', () => {
    expect(uniteAvecArticle('dans', etudes)).toBe('dans le département Études');
    expect(uniteAvecArticle('à', compta)).toBe('au service Comptabilité');
    expect(uniteAvecArticle('de', compta)).toBe('du service Comptabilité');
  });

  it('garde le libellé d’un département qui dit déjà sa nature', () => {
    expect(uniteAvecArticle('à', etudes, 'Département Études')).toBe('au Département Études');
  });

  it('élide l’article devant une voyelle', () => {
    expect(
      uniteAvecArticle('à', {
        name: 'Inspection Générale',
        unitType: 'direction',
        shortName: 'IG',
      }),
    ).toBe('à l’IG');
    expect(
      uniteAvecArticle('de', {
        name: 'Inspection Générale',
        unitType: 'direction',
        shortName: null,
      }),
    ).toBe('de l’Inspection Générale');
  });
});
