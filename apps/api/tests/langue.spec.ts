/**
 * Deux règles de langue qui s'écrivent dans un message lu par un candidat.
 *
 * « Votre candidature pour le poste de Analyste marketing » se remarque
 * immédiatement, et « Merci Mouhamadou Moustapha Salih » sonne comme un
 * formulaire. Ce sont des détails qui disent si le produit a été écrit par
 * quelqu'un qui parle la langue.
 */
import { describe, expect, it } from 'vitest';
import { deElide, premierPrenom } from '@teranga/contracts';

describe('premierPrenom', () => {
  it('ne garde que le premier', () => {
    expect(premierPrenom('Mouhamadou Moustapha Salih')).toBe('Mouhamadou');
  });
  it('laisse un prénom seul intact', () => {
    expect(premierPrenom('Awa')).toBe('Awa');
  });
  it('ne coupe pas un prénom composé', () => {
    expect(premierPrenom('Jean-Baptiste Pierre')).toBe('Jean-Baptiste');
  });
});

describe('deElide', () => {
  it('élide devant une voyelle', () => {
    expect(deElide('Analyste marketing')).toBe("d'");
    expect(deElide('Ingénieur réseaux')).toBe("d'");
    expect(deElide('Économiste')).toBe("d'");
  });
  it('élide devant un h muet', () => {
    expect(deElide('Hôtesse d’accueil')).toBe("d'");
  });
  it('ne s’élide pas devant une consonne', () => {
    expect(deElide('Chargé d’affaires')).toBe('de ');
    expect(deElide('Comptable')).toBe('de ');
  });
});
