import { describe, expect, it } from 'vitest';
import {
  ABSENCE,
  absence,
  de,
  duAu,
  frDate,
  leLa,
  rappel,
  sonSa,
} from '../src/modules/notifications/phrases';

describe('les mots des notifications', () => {
  it('écrit les dates comme on les dit', () => {
    expect(frDate('2026-10-01')).toBe('1er octobre 2026');
    expect(frDate('2026-06-01', true)).toBe('lundi 1er juin 2026');
    expect(frDate('2026-10-11')).toBe('11 octobre 2026');
  });

  it('dit une période sans répéter le mois ni l’année', () => {
    expect(duAu('2027-05-10', '2027-05-10')).toBe('le 10 mai 2027');
    expect(duAu('2027-05-10', '2027-05-12')).toBe('du 10 au 12 mai 2027');
    expect(duAu('2027-04-28', '2027-05-03')).toBe('du 28 avril au 3 mai 2027');
    expect(duAu('2026-12-28', '2027-01-02')).toBe('du 28 décembre 2026 au 2 janvier 2027');
  });

  it('élide devant une voyelle', () => {
    expect(de('Awa Diop')).toBe('d’Awa Diop');
    expect(de('attestation de travail')).toBe('d’attestation de travail');
    expect(de('Mme Fatou Sall')).toBe('de Mme Fatou Sall');
  });

  it('nomme un type d’absence dans une phrase', () => {
    expect(absence('Congé annuel')).toMatchObject({ nom: 'congé annuel', article: 'un' });
    expect(absence('Maladie')).toMatchObject({ nom: 'congé maladie', article: 'un' });
    expect(absence('Mission')).toMatchObject({ nom: 'mission', article: 'une', feminin: true });
  });

  it('accorde l’article et le possessif, élision comprise', () => {
    expect(`${leLa(absence('Maladie'))}${absence('Maladie').nom}`).toBe('Le congé maladie');
    expect(`${leLa(absence('Mission'))}${absence('Mission').nom}`).toBe('La mission');
    expect(`${leLa(ABSENCE)}${ABSENCE.nom}`).toBe('L’absence');
    expect(sonSa(absence('Mission'))).toBe('sa');
    expect(sonSa(ABSENCE)).toBe('son');
    expect(sonSa(absence('Congé annuel'))).toBe('son');
  });

  it('un rappel garde le nom propre, et met le reste en minuscule', () => {
    expect(rappel('Moussa Ndiaye demande un congé')).toBe(
      'Rappel : Moussa Ndiaye demande un congé',
    );
    expect(rappel('Le CDD de Fatou Sall prend fin')).toBe(
      'Rappel : le CDD de Fatou Sall prend fin',
    );
    expect(rappel('Votre demande est à confier')).toBe('Rappel : votre demande est à confier');
  });
});
