import { describe, expect, it } from 'vitest';
import { countWorkdays } from '../src/modules/time/workdays';

const noHolidays = new Set<string>();

describe('countWorkdays', () => {
  it('compte une semaine complète comme 5 jours ouvrés', () => {
    // lundi 2026-08-03 → dimanche 2026-08-09
    expect(countWorkdays('2026-08-03', '2026-08-09', noHolidays).workingDays).toBe(5);
  });

  it('un week-end seul compte 0 jour', () => {
    expect(countWorkdays('2026-08-08', '2026-08-09', noHolidays).workingDays).toBe(0);
  });

  it('un même jour ouvré compte 1', () => {
    expect(countWorkdays('2026-08-05', '2026-08-05', noHolidays).workingDays).toBe(1);
  });

  it('exclut les jours fériés et les liste', () => {
    // Tabaski (exemple) un jeudi
    const holidays = new Set(['2026-08-06']);
    const r = countWorkdays('2026-08-03', '2026-08-07', holidays);
    expect(r.workingDays).toBe(4);
    expect(r.holidaysSkipped).toEqual(['2026-08-06']);
  });

  it('un férié tombant un week-end ne change rien', () => {
    const holidays = new Set(['2026-08-08']); // samedi
    const r = countWorkdays('2026-08-03', '2026-08-09', holidays);
    expect(r.workingDays).toBe(5);
    expect(r.holidaysSkipped).toEqual([]);
  });

  it('traverse les mois et les années sans dérive', () => {
    // 2026-12-28 (lundi) → 2027-01-03 (dimanche) : 5 ouvrés sans férié
    expect(countWorkdays('2026-12-28', '2027-01-03', noHolidays).workingDays).toBe(5);
    // avec le 1er janvier férié (vendredi) : 4
    const r = countWorkdays('2026-12-28', '2027-01-03', new Set(['2027-01-01']));
    expect(r.workingDays).toBe(4);
  });
});
