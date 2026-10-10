import { z } from 'zod';

/* WhatsApp : le numéro qui reçoit, et les heures où il reçoit.

   Un numéro se saisit comme on le dit (« 77 123 45 67 », « +33 6 12 34 56
   78 ») et se garde au format international (+221771234567). Sans
   indicatif, c'est un mobile sénégalais. WhatsApp ne vit que sur un mobile :
   au Sénégal, un numéro qui commence par 7.

   Les heures calmes : un message WhatsApp sonne dans la poche. En dehors des
   jours ouvrés (week-end, jour férié) et de 8 h à 19 h, il attend le
   prochain créneau ; la plateforme et le courriel, eux, ne sonnent pas et
   partent tout de suite. */

/** Le fuseau de l'organisation : celui de la base (cf. 0061). */
export const FUSEAU = 'Africa/Dakar';
/** Le créneau des heures ouvrées, en heures locales : [début, fin[. */
export const CRENEAU_WHATSAPP = { debut: 8, fin: 19 } as const;

/** Le numéro au format international (+221771234567), ou null s'il ne peut pas recevoir WhatsApp. */
export function numeroWhatsApp(saisie: string): string | null {
  let n = saisie.trim().replace(/[\s.\-()/]/g, '');
  if (n.startsWith('00')) n = `+${n.slice(2)}`;
  if (!n.startsWith('+')) {
    // Sans indicatif : un mobile sénégalais, neuf chiffres qui commencent par 7.
    return /^7\d{8}$/.test(n) ? `+221${n}` : null;
  }
  if (!/^\+[1-9]\d{7,14}$/.test(n)) return null;
  if (n.startsWith('+221')) return /^\+2217\d{8}$/.test(n) ? n : null;
  return n;
}

/** « +221 77 123 45 67 » ; un autre pays, par groupes de deux après l'indicatif. */
export function numeroLisible(e164: string): string {
  const sn = /^\+221(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(e164);
  if (sn) return `+221 ${sn[1]} ${sn[2]} ${sn[3]} ${sn[4]}`;
  return e164.replace(/(\d{2})(?=(\d{2})+$)/g, '$1 ');
}

/** « +221 77 ••• •• 67 » : ce que l'écran en montre une fois vérifié. */
export function numeroMasque(e164: string): string {
  const sn = /^\+221(\d{2})\d{5}(\d{2})$/.exec(e164);
  if (sn) return `+221 ${sn[1]} ••• •• ${sn[2]}`;
  return `${e164.slice(0, 4)} ••• ${e164.slice(-2)}`;
}

export const numeroWhatsAppSchema = z
  .string()
  .max(30)
  .transform((v, ctx) => {
    const n = numeroWhatsApp(v);
    if (!n) {
      ctx.addIssue({ code: 'custom', message: 'Ce numéro ne peut pas recevoir WhatsApp' });
      return z.NEVER;
    }
    return n;
  });

export const codeWhatsAppSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Le code a six chiffres'),
});

/** L'heure et le jour, là-bas : « 2026-10-07 », 14 (h), 3 (mercredi). */
function local(instant: Date, fuseau: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: fuseau,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(instant);
  const v = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const jours = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    jour: `${v('year')}-${v('month')}-${v('day')}`,
    heure: Number(v('hour')),
    semaine: jours.indexOf(v('weekday')),
  };
}

/** L'instant où il est `heure` h pile, ce jour-là, dans le fuseau. */
function instantLocal(jour: string, heure: number, fuseau: string): Date {
  const naif = new Date(`${jour}T${String(heure).padStart(2, '0')}:00:00Z`);
  // Le décalage du fuseau à cet instant : ce que l'horloge locale y lit, moins l'UTC.
  const lu = local(naif, fuseau);
  const ecart =
    Date.parse(`${lu.jour}T${String(lu.heure).padStart(2, '0')}:00:00Z`) - naif.getTime();
  return new Date(naif.getTime() - ecart);
}

const ouvre = (jour: string, semaine: number, feries: ReadonlySet<string>) =>
  semaine >= 1 && semaine <= 5 && !feries.has(jour);

/**
 * Quand un message WhatsApp peut partir : tout de suite, ou au début du
 * prochain créneau ouvré. Les jours fériés sont ceux de l'organisation
 * (« 2026-12-25 »).
 */
export function creneauWhatsApp(
  maintenant: Date,
  feries: ReadonlySet<string>,
  fuseau: string = FUSEAU,
): Date {
  const ici = local(maintenant, fuseau);
  if (
    ouvre(ici.jour, ici.semaine, feries) &&
    ici.heure >= CRENEAU_WHATSAPP.debut &&
    ici.heure < CRENEAU_WHATSAPP.fin
  ) {
    return maintenant;
  }
  // Le premier jour ouvré : aujourd'hui s'il est encore tôt, sinon après.
  let jour = ici.jour;
  if (!(ouvre(ici.jour, ici.semaine, feries) && ici.heure < CRENEAU_WHATSAPP.debut)) {
    for (let i = 1; i <= 31; i += 1) {
      const suivant = new Date(Date.parse(`${ici.jour}T12:00:00Z`) + i * 86_400_000);
      const j = suivant.toISOString().slice(0, 10);
      if (ouvre(j, suivant.getUTCDay(), feries)) {
        jour = j;
        break;
      }
    }
  }
  return instantLocal(jour, CRENEAU_WHATSAPP.debut, fuseau);
}
