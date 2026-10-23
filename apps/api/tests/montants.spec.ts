/**
 * Les montants des documents, en chiffres et en lettres (ADR-0087) : « 250 000
 * (deux cent cinquante mille) francs CFA ».
 *
 * Un montant en lettres fait foi quand les chiffres sont mal lus : une faute
 * d'orthographe n'y est pas une coquille. Ce fichier tient les règles des
 * actes, l'orthographe traditionnelle : « et » devant un et onze, le pluriel
 * de vingt et de cent quand rien ne les suit, mille invariable.
 */
import { describe, expect, it } from 'vitest';
import { enChiffres, enLettres, saisiesDuDocumentSchema, SALAIRE_MAX } from '@teranga/contracts';

describe('en lettres', () => {
  it('de zéro à seize, un mot chacun ; puis dix-sept, dix-huit, dix-neuf', () => {
    expect(enLettres(0)).toBe('zéro');
    expect(enLettres(1)).toBe('un');
    expect(enLettres(11)).toBe('onze');
    expect(enLettres(16)).toBe('seize');
    expect(enLettres(17)).toBe('dix-sept');
    expect(enLettres(19)).toBe('dix-neuf');
  });

  it('« et » devant un et onze, jusqu’à soixante et onze ; un trait d’union ailleurs', () => {
    expect(enLettres(21)).toBe('vingt et un');
    expect(enLettres(22)).toBe('vingt-deux');
    expect(enLettres(31)).toBe('trente et un');
    expect(enLettres(61)).toBe('soixante et un');
    expect(enLettres(71)).toBe('soixante et onze');
    // Quatre-vingts ne prend pas « et » : « quatre-vingt-un », « quatre-vingt-onze ».
    expect(enLettres(81)).toBe('quatre-vingt-un');
    expect(enLettres(91)).toBe('quatre-vingt-onze');
  });

  it('soixante-dix et quatre-vingt-dix comptent sur la dizaine d’avant', () => {
    expect(enLettres(70)).toBe('soixante-dix');
    expect(enLettres(72)).toBe('soixante-douze');
    expect(enLettres(77)).toBe('soixante-dix-sept');
    expect(enLettres(79)).toBe('soixante-dix-neuf');
    expect(enLettres(90)).toBe('quatre-vingt-dix');
    expect(enLettres(97)).toBe('quatre-vingt-dix-sept');
    expect(enLettres(99)).toBe('quatre-vingt-dix-neuf');
  });

  it('quatre-vingts et cents au pluriel quand rien ne les suit', () => {
    expect(enLettres(80)).toBe('quatre-vingts');
    expect(enLettres(89)).toBe('quatre-vingt-neuf');
    expect(enLettres(100)).toBe('cent');
    expect(enLettres(101)).toBe('cent un');
    expect(enLettres(180)).toBe('cent quatre-vingts');
    expect(enLettres(200)).toBe('deux cents');
    expect(enLettres(201)).toBe('deux cent un');
    expect(enLettres(999)).toBe('neuf cent quatre-vingt-dix-neuf');
  });

  it('mille invariable, sans « un » devant ; vingt et cent perdent leur s devant lui', () => {
    expect(enLettres(1000)).toBe('mille');
    expect(enLettres(1001)).toBe('mille un');
    expect(enLettres(2000)).toBe('deux mille');
    expect(enLettres(21_000)).toBe('vingt et un mille');
    expect(enLettres(80_000)).toBe('quatre-vingt mille');
    expect(enLettres(100_000)).toBe('cent mille');
    expect(enLettres(200_000)).toBe('deux cent mille');
    expect(enLettres(280_000)).toBe('deux cent quatre-vingt mille');
  });

  it('million et milliard sont des noms : ils prennent le pluriel, et vingt et cent devant eux', () => {
    expect(enLettres(1_000_000)).toBe('un million');
    expect(enLettres(2_000_000)).toBe('deux millions');
    expect(enLettres(80_000_000)).toBe('quatre-vingts millions');
    expect(enLettres(200_000_000)).toBe('deux cents millions');
    expect(enLettres(1_001_000)).toBe('un million mille');
    expect(enLettres(1_000_000_000)).toBe('un milliard');
    expect(enLettres(3_000_000_000)).toBe('trois milliards');
  });

  it('des salaires', () => {
    expect(enLettres(250_000)).toBe('deux cent cinquante mille');
    expect(enLettres(487_381)).toBe(
      'quatre cent quatre-vingt-sept mille trois cent quatre-vingt-un',
    );
    expect(enLettres(1_175_500)).toBe('un million cent soixante-quinze mille cinq cents');
    expect(enLettres(SALAIRE_MAX)).toBe(
      'neuf cent quatre-vingt-dix-neuf millions neuf cent quatre-vingt-dix-neuf mille ' +
        'neuf cent quatre-vingt-dix-neuf',
    );
  });

  it('refuse ce qui n’est pas un entier positif sous le billion', () => {
    for (const n of [-1, 1.5, Number.NaN, 1e12]) {
      expect(() => enLettres(n)).toThrow(RangeError);
    }
  });
});

describe('en chiffres', () => {
  it('les milliers séparés d’une espace insécable', () => {
    expect(enChiffres(999)).toBe('999');
    expect(enChiffres(1000)).toBe('1\u00a0000');
    expect(enChiffres(250_000)).toBe('250\u00a0000');
    expect(enChiffres(1_250_000)).toBe('1\u00a0250\u00a0000');
  });
});

describe('le salaire saisi', () => {
  it('un entier, de 1 à 999 999 999 francs CFA', () => {
    expect(saisiesDuDocumentSchema.safeParse({ salaire: 250_000 }).success).toBe(true);
    expect(saisiesDuDocumentSchema.safeParse({}).success).toBe(true);
    for (const salaire of [0, -5, 1.5, SALAIRE_MAX + 1, '250000']) {
      expect(saisiesDuDocumentSchema.safeParse({ salaire }).success).toBe(false);
    }
  });

  it('rien d’autre', () => {
    expect(saisiesDuDocumentSchema.safeParse({ salaire: 1, prime: 2 }).success).toBe(false);
  });
});
