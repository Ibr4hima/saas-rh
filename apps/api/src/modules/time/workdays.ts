/**
 * Calcul des jours ouvrés — fonction pure, testée unitairement.
 * Convention Lot 1 : semaine de 5 jours (samedi/dimanche chômés) moins les
 * jours fériés du tenant. La semaine de 6 jours et les demi-journées
 * viendront en paramétrage quand un client le demandera.
 */

/** Itère les dates ISO (AAAA-MM-JJ) de start à end inclus. */
function* eachDay(startIso: string, endIso: string): Generator<string> {
  const current = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  while (current <= end) {
    yield current.toISOString().slice(0, 10);
    current.setUTCDate(current.getUTCDate() + 1);
  }
}

function isWeekend(iso: string): boolean {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
}

export interface WorkdaysResult {
  workingDays: number;
  holidaysSkipped: string[];
}

/**
 * Compte les jours ouvrés entre deux dates incluses, en excluant week-ends et
 * jours fériés. `holidays` : dates ISO du tenant (toutes années confondues).
 */
export function countWorkdays(
  startIso: string,
  endIso: string,
  holidays: ReadonlySet<string>,
): WorkdaysResult {
  let workingDays = 0;
  const holidaysSkipped: string[] = [];
  for (const day of eachDay(startIso, endIso)) {
    if (isWeekend(day)) continue;
    if (holidays.has(day)) {
      holidaysSkipped.push(day);
      continue;
    }
    workingDays += 1;
  }
  return { workingDays, holidaysSkipped };
}

/** Décale une date ISO de `days` jours (négatif = vers le passé). */
function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Jour d'envoi du rappel avant un jour férié : deux jours avant, reculé au
 * dernier jour OUVRÉ si ce jour tombe un week-end ou sur un autre férié.
 * Un férié le lundi prévient donc le vendredi (J−2 = samedi), un férié le
 * mardi aussi (J−2 = dimanche) — personne ne lit ses notifications le
 * week-end. Retourne null si l'on remonte au-delà d'une semaine (garde-fou
 * contre une chaîne de fériés incohérente).
 */
export function holidayReminderDate(
  holidayIso: string,
  holidays: ReadonlySet<string>,
): string | null {
  let day = shiftDays(holidayIso, -2);
  for (let back = 0; back < 7; back += 1) {
    if (!isWeekend(day) && !holidays.has(day)) return day;
    day = shiftDays(day, -1);
  }
  return null;
}
