import { describe, expect, it } from 'vitest';
import { countWorkdays, holidayReminderDate } from '../src/modules/time/workdays';

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

describe('holidayReminderDate', () => {
  it('prévient deux jours avant quand ce jour est ouvré', () => {
    // 2026-08-13 est un jeudi → J−2 = mardi 11
    expect(holidayReminderDate('2026-08-13', noHolidays)).toBe('2026-08-11');
  });

  it('férié un lundi : prévient le vendredi (J−2 tombe un samedi)', () => {
    // 2026-08-17 lundi → J−2 = samedi 15 → recule au vendredi 14
    expect(holidayReminderDate('2026-08-17', noHolidays)).toBe('2026-08-14');
  });

  it('férié un mardi : prévient aussi le vendredi (J−2 tombe un dimanche)', () => {
    // 2026-08-18 mardi → J−2 = dimanche 16 → recule au vendredi 14
    expect(holidayReminderDate('2026-08-18', noHolidays)).toBe('2026-08-14');
  });

  it('férié un mercredi : prévient le lundi', () => {
    expect(holidayReminderDate('2026-08-19', noHolidays)).toBe('2026-08-17');
  });

  it('recule encore si le jour de rappel est lui-même férié', () => {
    // Lundi 17 férié → rappel vendredi 14, mais le 14 est férié aussi → jeudi 13
    expect(holidayReminderDate('2026-08-17', new Set(['2026-08-14']))).toBe('2026-08-13');
  });

  it('renvoie null si une semaine entière est chômée avant le férié', () => {
    const allOff = new Set([
      '2026-08-14',
      '2026-08-13',
      '2026-08-12',
      '2026-08-11',
      '2026-08-10',
      '2026-08-07',
      '2026-08-06',
    ]);
    expect(holidayReminderDate('2026-08-17', allOff)).toBeNull();
  });
});
