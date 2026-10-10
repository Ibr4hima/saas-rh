/**
 * L'année par défaut des congés : celle du jour de la requête, pas celle du
 * démarrage du serveur.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { yearQuerySchema } from '../src/modules/time/absences.controller';

afterEach(() => {
  vi.useRealTimers();
});

describe('l’année par défaut', () => {
  it('suit le calendrier : un serveur lancé en 2026 sert 2027 au 1er janvier', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-12-31T23:30:00Z'));
    expect(yearQuerySchema.parse({}).year).toBe(2026);
    vi.setSystemTime(new Date('2027-01-01T00:05:00Z'));
    expect(yearQuerySchema.parse({}).year).toBe(2027);
  });

  it('l’année demandée prime', () => {
    expect(yearQuerySchema.parse({ year: '2030' }).year).toBe(2030);
  });
});
