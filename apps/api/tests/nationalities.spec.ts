/**
 * Gentilés : couverture et accord.
 *
 * Le dossier affichait « SN » — un code, pas une nationalité. Et le formulaire
 * de création n'avait aucun champ, donc TOUS les employés héritaient du défaut
 * quel que soit leur pays de naissance.
 *
 * Le test de couverture est le plus important : un pays proposé au choix sans
 * gentilé correspondant réafficherait un code brut, exactement le défaut qu'on
 * corrige. Il doit échouer si quelqu'un ajoute un pays sans son gentilé.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEMONYMS, nationalityLabel } from '@teranga/contracts';

/** Codes réellement proposés dans les menus déroulants du produit. */
function codesProposes(): string[] {
  const src = readFileSync(join(__dirname, '../../web/lib/countries.ts'), 'utf8');
  return [...src.matchAll(/\['([A-Z]{2})', '\d+'\]/g)].map((m) => m[1]!);
}

describe('couverture', () => {
  it('chaque pays proposé a son gentilé', () => {
    const sans = codesProposes().filter((c) => !DEMONYMS[c]);
    expect(sans).toEqual([]);
  });

  it('aucun gentilé ne désigne un pays absent de la liste', () => {
    const proposes = new Set(codesProposes());
    expect(Object.keys(DEMONYMS).filter((c) => !proposes.has(c))).toEqual([]);
  });

  it('aucune forme vide', () => {
    const vides = Object.entries(DEMONYMS).filter(([, [m, f]]) => !m.trim() || !f.trim());
    expect(vides).toEqual([]);
  });
});

describe('accord au sexe', () => {
  it('accorde au féminin', () => {
    expect(nationalityLabel('SN', 'female')).toBe('Sénégalaise');
    expect(nationalityLabel('ML', 'female')).toBe('Malienne');
    expect(nationalityLabel('GR', 'female')).toBe('Grecque');
  });

  it('accorde au masculin', () => {
    expect(nationalityLabel('SN', 'male')).toBe('Sénégalais');
    expect(nationalityLabel('TR', 'male')).toBe('Turc');
  });

  it('rend les gentilés invariables tels quels', () => {
    expect(nationalityLabel('BE', 'female')).toBe('Belge');
    expect(nationalityLabel('BE', 'male')).toBe('Belge');
    expect(nationalityLabel('BE', null)).toBe('Belge');
  });
});

describe('sexe non renseigné', () => {
  it('rend une forme inclusive quand l’accord est régulier', () => {
    expect(nationalityLabel('SN', null)).toBe('Sénégalais·e');
    expect(nationalityLabel('ML', undefined)).toBe('Malien·ne');
  });

  it('retombe sur le masculin quand l’accord est irrégulier', () => {
    // « Grec·que » ne se lit pas : la forme générique vaut mieux.
    expect(nationalityLabel('GR', null)).toBe('Grec');
    expect(nationalityLabel('TR', null)).toBe('Turc');
  });
});

describe('robustesse', () => {
  it('rend un code inconnu tel quel plutôt que rien', () => {
    expect(nationalityLabel('XX', 'female')).toBe('XX');
  });

  it('tolère la casse', () => {
    expect(nationalityLabel('sn', 'female')).toBe('Sénégalaise');
  });

  it('rend null pour une valeur absente', () => {
    expect(nationalityLabel(null)).toBeNull();
    expect(nationalityLabel('')).toBeNull();
  });
});
