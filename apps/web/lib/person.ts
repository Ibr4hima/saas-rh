/** Libellés d'état civil, accordés selon le sexe de la personne. */
import { maritalLabelsFor } from '@teranga/contracts';

export const SEX_LABELS: Record<string, string> = {
  male: 'Masculin',
  female: 'Féminin',
};

/** Réexport : la définition vit dans les contrats, partagée avec le serveur. */
export const maritalLabels = maritalLabelsFor;

export const ID_DOCUMENT_LABELS: Record<string, string> = {
  cni: 'CNI',
  passport: 'Passeport',
};

/** Borne haute du champ date de naissance : il faut avoir au moins 15 ans. */
export function maxBirthDate(): string {
  const t = new Date();
  return new Date(Date.UTC(t.getUTCFullYear() - 15, t.getUTCMonth(), t.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

/** Fin de contrat : début + durée en mois, borne exclusive ramenée à la veille. */
export function contractEnd(startIso: string, months: number): string {
  const d = new Date(`${startIso}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
