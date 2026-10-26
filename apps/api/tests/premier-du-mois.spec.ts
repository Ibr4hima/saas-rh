/**
 * Le premier du mois est un ordinal : « 1er juin 2023 », jamais « 1 juin
 * 2023 ». Intl ne le sait pas ; `premierDuMois` le corrige, une fois, pour
 * les écrans, les courriels et les messages. Pure fonction.
 */
import { describe, expect, it } from 'vitest';
import { premierDuMois } from '@teranga/contracts';
import { composer } from '../src/modules/courriels/gabarits';

/** Ce que rend Intl, en lettres ou abrégé, avec ou sans le jour de la semaine. */
const intl = (iso: string, options: Intl.DateTimeFormatOptions) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('fr-FR', { ...options, timeZone: 'UTC' });

describe('premierDuMois', () => {
  it('écrit « 1er » devant le mois, en lettres ou abrégé', () => {
    expect(premierDuMois('1 juin 2023')).toBe('1er juin 2023');
    expect(premierDuMois('1 nov. 2026')).toBe('1er nov. 2026');
    expect(premierDuMois('jeudi 1 juin 2023')).toBe('jeudi 1er juin 2023');
    expect(premierDuMois('1 nov. 2026, 09:05')).toBe('1er nov. 2026, 09:05');
  });

  it('laisse les autres jours, et un « 1er » déjà écrit', () => {
    for (const date of [
      '11 juin 2023',
      '21 juin',
      '31 mai 2024',
      '10 oct. 2026',
      '1er juin 2023',
    ]) {
      expect(premierDuMois(date)).toBe(date);
    }
  });

  it('corrige ce que rend Intl, dans chaque forme des écrans', () => {
    const long = { day: 'numeric', month: 'long', year: 'numeric' } as const;
    const court = { day: 'numeric', month: 'short', year: 'numeric' } as const;
    expect(premierDuMois(intl('2023-06-01', long))).toBe('1er juin 2023');
    expect(premierDuMois(intl('2026-11-01', court))).toBe('1er nov. 2026');
    expect(premierDuMois(intl('2023-06-01', { ...long, weekday: 'long' }))).toBe(
      'jeudi 1er juin 2023',
    );
    expect(premierDuMois(intl('2023-06-11', long))).toBe('11 juin 2023');
    expect(premierDuMois(intl('2023-06-21', court))).toBe('21 juin 2023');
  });

  it('le lien du courriel d’invitation est valable jusqu’au 1er du mois', () => {
    const c = composer(
      {
        nom: 'invitation',
        prenom: 'Awa',
        organisation: 'APIX',
        lien: 'https://rh.apix.sn/invitation/x',
        expireLe: '2026-06-01T10:00:00.000Z',
      },
      { logo: null, portail: 'https://rh.apix.sn/', annee: 2026 },
    );
    expect(c.text).toContain('valable jusqu’au 1er juin 2026.');
    expect(c.html).toContain('1er juin 2026');
    expect(c.html).not.toMatch(/(^|[^\d])1 juin/);
  });
});
