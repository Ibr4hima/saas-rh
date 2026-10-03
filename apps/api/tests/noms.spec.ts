/**
 * Le nom d'affichage — pure fonction, mais avec assez de cas particuliers
 * pour qu'une relecture ne suffise pas.
 *
 * Deux ou trois prénoms sont la règle au Sénégal, et c'est le nom de famille
 * — en fin de chaîne — qui saute quand la place manque. La règle est donc :
 * premier prénom entier, les suivants en initiales, nom de famille intact.
 */
import { describe, expect, it } from 'vitest';
import { nomAbrege, nomCourt } from '@teranga/contracts';

describe('nomAbrege', () => {
  it('laisse intact un prénom unique', () => {
    expect(nomAbrege('Awa', 'Diop')).toBe('Awa Diop');
  });

  it('réduit les prénoms suivants à leur initiale', () => {
    expect(nomAbrege('Mouhamadou Moustapha Habib', 'Kane')).toBe('Mouhamadou M. H. Kane');
  });

  it('ne coupe pas un prénom composé sur son trait d’union', () => {
    expect(nomAbrege('Jean-Baptiste', 'Ndiaye')).toBe('Jean-Baptiste Ndiaye');
    expect(nomAbrege('Jean-Baptiste Pierre', 'Ndiaye')).toBe('Jean-Baptiste P. Ndiaye');
  });

  it('met l’initiale en capitale, accents compris', () => {
    expect(nomAbrege('Awa élisabeth', 'Sow')).toBe('Awa É. Sow');
  });

  it('absorbe les espaces en trop', () => {
    expect(nomAbrege('  Fatou   Bintou  ', '  Sall ')).toBe('Fatou B. Sall');
  });

  it('rend le seul nom de famille quand le prénom manque', () => {
    expect(nomAbrege('', 'Kane')).toBe('Kane');
  });
});

describe('nomCourt', () => {
  it('garde le premier prénom et l’initiale du deuxième seulement', () => {
    expect(nomCourt('Mouhamadou Moustapha Amine', 'Ba')).toBe('Mouhamadou M. Ba');
    expect(nomCourt('Mouhamadou Moustapha', 'Ba')).toBe('Mouhamadou M. Ba');
  });

  it('laisse intact un prénom unique, composé ou non', () => {
    expect(nomCourt('Awa', 'Diop')).toBe('Awa Diop');
    expect(nomCourt('Jean-Baptiste', 'Ndiaye')).toBe('Jean-Baptiste Ndiaye');
  });

  it('met l’initiale en capitale et absorbe les espaces en trop', () => {
    expect(nomCourt('  Awa   élisabeth  ', ' Sow ')).toBe('Awa É. Sow');
  });
});
