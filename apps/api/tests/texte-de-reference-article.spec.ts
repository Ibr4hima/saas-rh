/**
 * Un texte de référence dans une phrase : « Rechercher dans le Code du
 * travail ». L'article se fixe texte par texte.
 */
import { describe, expect, it } from 'vitest';
import { texteDeReferenceAvecArticle } from '@teranga/contracts';

describe('texteDeReferenceAvecArticle', () => {
  it('nomme chaque texte avec son article', () => {
    expect(texteDeReferenceAvecArticle({ slug: 'code-du-travail', title: 'Code du travail' })).toBe(
      'le Code du travail',
    );
    expect(
      texteDeReferenceAvecArticle({ slug: 'reglement-interieur', title: 'Règlement intérieur' }),
    ).toBe('le Règlement intérieur');
  });

  it('garde le titre déposé par la DCH', () => {
    expect(
      texteDeReferenceAvecArticle({
        slug: 'reglement-interieur',
        title: 'Règlement intérieur de l’APIX',
      }),
    ).toBe('le Règlement intérieur de l’APIX');
  });

  it('ne devine pas l’article d’un texte qui n’en a pas de fixé', () => {
    expect(
      texteDeReferenceAvecArticle({
        slug: 'convention-collective',
        title: 'Convention collective',
      }),
    ).toBeNull();
  });
});
