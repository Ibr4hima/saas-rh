/** Libellés d'état civil, accordés selon le sexe de la personne. */

export const SEX_LABELS: Record<string, string> = {
  male: 'Masculin',
  female: 'Féminin',
};

export function maritalLabels(gender: string | null | undefined): Record<string, string> {
  const suffix = gender === 'female' ? 'e' : gender === 'male' ? '' : '·e';
  return {
    single: 'Célibataire',
    married: `Marié${suffix}`,
    divorced: `Divorcé${suffix}`,
    widowed: gender === 'female' ? 'Veuve' : gender === 'male' ? 'Veuf' : 'Veuf·ve',
  };
}

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
