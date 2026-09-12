/**
 * Nationalités : couverture et forme.
 *
 * Deux défauts corrigés successivement. Le dossier affichait « SN » — un code,
 * pas une nationalité — parce que le formulaire de création n'avait aucun champ
 * et que tous les employés héritaient du défaut de la base. Puis le gentilé
 * s'accordait au sexe de la personne, ce qui est une faute : il qualifie le mot
 * « nationalité », qui est féminin.
 *
 * Le test de couverture est le plus important : un pays proposé au choix sans
 * nationalité correspondante réafficherait un code brut, exactement le premier
 * défaut. Il doit échouer si quelqu'un ajoute un pays sans sa nationalité.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NATIONALITY_LABELS, nationalityLabel } from '@teranga/contracts';

/** Codes réellement proposés dans les menus déroulants du produit. */
function codesProposes(): string[] {
  const src = readFileSync(join(__dirname, '../../web/lib/countries.ts'), 'utf8');
  return [...src.matchAll(/\['([A-Z]{2})', '\d+'\]/g)].map((m) => m[1]!);
}

describe('couverture', () => {
  it('chaque pays proposé a sa nationalité', () => {
    const sans = codesProposes().filter((c) => !NATIONALITY_LABELS[c]);
    expect(sans).toEqual([]);
  });

  it('aucune nationalité ne désigne un pays absent de la liste', () => {
    const proposes = new Set(codesProposes());
    expect(Object.keys(NATIONALITY_LABELS).filter((c) => !proposes.has(c))).toEqual([]);
  });

  it('aucun libellé vide', () => {
    expect(Object.entries(NATIONALITY_LABELS).filter(([, v]) => !v.trim())).toEqual([]);
  });
});

describe('forme féminine, toujours', () => {
  it('rend le féminin pour les accords réguliers', () => {
    expect(nationalityLabel('SN')).toBe('Sénégalaise');
    expect(nationalityLabel('ML')).toBe('Malienne');
    expect(nationalityLabel('FR')).toBe('Française');
  });

  it('rend le féminin pour les accords irréguliers', () => {
    // Ceux-là ne se dérivent d'aucune règle : ils sont dans la table.
    expect(nationalityLabel('GR')).toBe('Grecque');
    expect(nationalityLabel('TR')).toBe('Turque');
  });

  it('laisse les gentilés invariables tels quels', () => {
    expect(nationalityLabel('BE')).toBe('Belge');
    expect(nationalityLabel('CH')).toBe('Suisse');
    expect(nationalityLabel('BF')).toBe('Burkinabè');
  });

  it('ne dépend PAS du sexe : « nationalité » est féminin', () => {
    // La fonction ne prend aucun paramètre de sexe — l'homme comme la femme
    // sont « de nationalité sénégalaise ». Aucun appelant ne peut se tromper.
    expect(nationalityLabel.length).toBe(1);
    expect(Object.values(NATIONALITY_LABELS).some((v) => v === 'Sénégalais')).toBe(false);
    expect(Object.values(NATIONALITY_LABELS).some((v) => v === 'Grec')).toBe(false);
  });
});

describe('robustesse', () => {
  it('rend un code inconnu tel quel plutôt que rien', () => {
    expect(nationalityLabel('XX')).toBe('XX');
  });

  it('tolère la casse', () => {
    expect(nationalityLabel('sn')).toBe('Sénégalaise');
  });

  it('rend null pour une valeur absente', () => {
    expect(nationalityLabel(null)).toBeNull();
    expect(nationalityLabel('')).toBeNull();
  });
});
