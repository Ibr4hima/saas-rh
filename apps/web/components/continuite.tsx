'use client';

import {
  CAPACITE_INFOS,
  type AbsenceDUnePersonneDeleguee,
  type AlerteDeContinuite,
  type CapaciteDemande,
} from '@teranga/contracts';

/* La continuité du service (ADR-0129) : ce qu'une absence laisserait sans
   personne, dit à qui la demande, à qui la vise et à qui l'apprécie. */

/** « 12 octobre », « 1er novembre » */
function jourEnLettres(iso: string, avecMois = true): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const jour = d.getUTCDate() === 1 ? '1er' : String(d.getUTCDate());
  if (!avecMois) return jour;
  return `${jour} ${d.toLocaleDateString('fr-FR', { month: 'long', timeZone: 'UTC' })}`;
}

/** « du 12 au 15 octobre », « du 28 octobre au 3 novembre », « le 12 octobre » */
function periode(du: string, au: string): string {
  if (du === au) return `le ${jourEnLettres(du)}`;
  const memeMois = du.slice(0, 7) === au.slice(0, 7);
  return `du ${jourEnLettres(du, !memeMois)} au ${jourEnLettres(au)}`;
}

/** « Awa Diop sera en congé du 10 au 20 octobre » : l’absence d’une autre personne déléguée. */
function absenceEnMots(a: AbsenceDUnePersonneDeleguee, aujourdhui: string): string {
  if (a.demandee) return `${a.nom} a demandé un congé ${periode(a.du, a.au)}`;
  if (a.du <= aujourdhui) return `${a.nom} est en congé jusqu’au ${jourEnLettres(a.au)}`;
  return `${a.nom} sera en congé ${periode(a.du, a.au)}`;
}

/** « les attestations de travail et les demandes de congé » */
function delegationsEnMots(capacites: readonly CapaciteDemande[]): string {
  const mots = capacites.map((c) => {
    const libelle = CAPACITE_INFOS[c].libelle;
    return `les ${libelle[0]!.toLowerCase()}${libelle.slice(1)}`;
  });
  return mots.length <= 1 ? (mots[0] ?? '') : `${mots.slice(0, -1).join(', ')} et ${mots.at(-1)}`;
}

const aujourdhuiIso = () => new Date().toISOString().slice(0, 10);

/**
 * L'alerte entière : qui manque, ce qui resterait sans personne, et qui
 * apprécie. `qui` : la personne qui demande, nommée ; sans nom, « vous ».
 * `appreciation` : la dernière ligne, pour qui demande.
 */
export function AlerteContinuite({
  alerte,
  qui,
  appreciation = true,
}: {
  alerte: AlerteDeContinuite;
  qui?: string;
  appreciation?: boolean;
}) {
  const aujourdhui = aujourdhuiIso();
  return (
    <div
      role="status"
      className="rounded-bloc bg-accent/[0.08] px-3.5 py-3 text-[12.5px] leading-relaxed text-ink"
    >
      {alerte.trous.map((t) => (
        <p key={`${t.du}-${t.capacites.join()}`}>
          {t.absences.map((a) => absenceEnMots(a, aujourdhui)).join(' ; ')} :{' '}
          {qui ? `${qui} serait` : 'vous seriez'} la seule personne restante pour{' '}
          {delegationsEnMots(t.capacites)} {periode(t.du, t.au)}.
        </p>
      ))}
      {appreciation ? (
        <p className="mt-1 font-semibold text-ink-strong">
          {alerte.auDirecteur
            ? 'La demande sera laissée à l’appréciation de la personne qui dirige la DCH.'
            : 'La demande sera laissée à l’appréciation de la DCH.'}
        </p>
      ) : null}
    </div>
  );
}

/** L'alerte en une mention, sous la période d'une demande en attente. */
export function MentionContinuite({ alerte }: { alerte: AlerteDeContinuite }) {
  const aujourdhui = aujourdhuiIso();
  return (
    <span className="mt-1 block text-[11.5px] leading-snug font-semibold whitespace-normal text-accent-text">
      {alerte.trous
        .map(
          (t) =>
            `Seule personne restante pour ${delegationsEnMots(t.capacites)} ${periode(t.du, t.au)} (${t.absences
              .map((a) => absenceEnMots(a, aujourdhui))
              .join(' ; ')})`,
        )
        .join(' ; ')}
    </span>
  );
}
