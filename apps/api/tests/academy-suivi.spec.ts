/**
 * La règle pure : l'état d'une formation pour un agent.
 */
import { describe, expect, it } from 'vitest';
import { statutSuivi } from '../src/modules/academy/suivi';

const base = {
  lecons: 4,
  validees: 0,
  commencee: false,
  evaluation: true,
  certifiee: false,
  echec: false,
};

describe('l’état d’une formation pour un agent', () => {
  it('rien d’ouvert : à commencer', () => {
    expect(statutSuivi(base)).toBe('a_commencer');
  });

  it('une leçon ouverte suffit pour « en cours », même sans validation', () => {
    expect(statutSuivi({ ...base, commencee: true })).toBe('en_cours');
    expect(statutSuivi({ ...base, commencee: true, validees: 3 })).toBe('en_cours');
  });

  it('toutes les leçons validées : l’évaluation attend l’agent', () => {
    expect(statutSuivi({ ...base, commencee: true, validees: 4 })).toBe('evaluation_a_passer');
  });

  it('une copie rendue sans succès : « pas encore réussie »', () => {
    expect(statutSuivi({ ...base, commencee: true, validees: 4, echec: true })).toBe('non_reussie');
  });

  it('sans évaluation, des leçons toutes validées font une formation terminée', () => {
    expect(statutSuivi({ ...base, evaluation: false, commencee: true, validees: 4 })).toBe(
      'terminee',
    );
  });

  it('un certificat valide l’emporte — même si la RH a ajouté des leçons depuis', () => {
    expect(statutSuivi({ ...base, commencee: true, validees: 4, certifiee: true })).toBe(
      'certifiee',
    );
    expect(statutSuivi({ ...base, lecons: 6, commencee: true, validees: 4, certifiee: true })).toBe(
      'certifiee',
    );
  });

  it('une leçon ajoutée après coup rouvre le parcours : l’évaluation n’attend plus', () => {
    expect(statutSuivi({ ...base, lecons: 5, commencee: true, validees: 4 })).toBe('en_cours');
  });

  it('une formation sans leçon prête n’est jamais « terminée »', () => {
    expect(statutSuivi({ ...base, lecons: 0 })).toBe('a_commencer');
  });
});
