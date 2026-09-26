/**
 * « Mon équipe » — les règles pures : l'état d'une formation pour un agent,
 * les comptes par état, et l'ordre de lecture d'une fiche.
 */
import { describe, expect, it } from 'vitest';
import { compterStatuts, ordreDeSuivi, statutSuivi } from '../src/modules/academy/equipe';

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

describe('les comptes et l’ordre', () => {
  it('compte chaque état, zéros compris', () => {
    expect(compterStatuts(['en_cours', 'en_cours', 'certifiee'])).toEqual({
      evaluation_a_passer: 0,
      non_reussie: 0,
      en_cours: 2,
      certifiee: 1,
      terminee: 0,
      a_commencer: 0,
    });
  });

  it('ce qui attend l’agent d’abord, puis le plus récent, puis l’alphabet', () => {
    const f = (
      title: string,
      status: Parameters<typeof ordreDeSuivi>[0]['status'],
      lastActivityAt: string | null = null,
    ) => ({ title, status, lastActivityAt });
    const rangees = [
      f('Word', 'a_commencer'),
      f('Excel', 'certifiee', '2026-09-01T00:00:00Z'),
      f('PowerPoint', 'en_cours', '2026-09-10T00:00:00Z'),
      f('Access', 'en_cours', '2026-09-20T00:00:00Z'),
      f('Budget', 'evaluation_a_passer', '2026-09-05T00:00:00Z'),
      f('Outlook', 'a_commencer'),
    ].sort(ordreDeSuivi);
    expect(rangees.map((r) => r.title)).toEqual([
      'Budget',
      'Access',
      'PowerPoint',
      'Excel',
      'Outlook',
      'Word',
    ]);
  });
});
