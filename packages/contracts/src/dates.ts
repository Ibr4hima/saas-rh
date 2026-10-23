import { z } from 'zod';

/*
 * Les bornes des dates saisies (ADR-0133) : ce qui ne vient pas après
 * aujourd'hui, ce qui le précède, la naissance, la validité d'une CNI.
 * Aujourd'hui se lit à l'heure de Dakar, qui est celle de l'UTC.
 */

/** Une date complète, au format AAAA-MM-JJ : un champ à moitié saisi n'en est pas une. */
export const estUnJour = (jour: string | undefined): jour is string =>
  jour !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(jour);

/** Aujourd'hui, au format AAAA-MM-JJ. */
export const aujourdhuiIso = (): string => new Date().toISOString().slice(0, 10);

/** Le jour décalé de `jours` jours, au format AAAA-MM-JJ. */
export function plusJours(jour: string, jours: number): string {
  const d = new Date(`${jour}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + jours);
  return d.toISOString().slice(0, 10);
}

/**
 * Le dernier jour d'une durée de `mois` mois qui commence le `debut` : la
 * veille du même quantième, `mois` mois plus tard (du 19 août au 18
 * novembre) ; si ce quantième n'existe pas, le dernier jour du mois (du 31
 * janvier au 28 février). Un stage, un contrat, une disponibilité de trois
 * ans (36 mois) se terminent ainsi.
 */
export function finDeLaDuree(debut: string, mois: number): string {
  const [a, m, j] = debut.split('-').map(Number) as [number, number, number];
  const cible = new Date(Date.UTC(a, m - 1 + mois, 1));
  const joursDuMois = new Date(
    Date.UTC(cible.getUTCFullYear(), cible.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const fin =
    j > joursDuMois
      ? new Date(Date.UTC(cible.getUTCFullYear(), cible.getUTCMonth(), joursDuMois))
      : new Date(Date.UTC(cible.getUTCFullYear(), cible.getUTCMonth(), j - 1));
  return fin.toISOString().slice(0, 10);
}

/** Le même jour, `ans` années plus tôt ; un 29 février devient le 28. */
export function ansPlusTot(jour: string, ans: number): string {
  const [a, m, j] = jour.split('-').map(Number) as [number, number, number];
  const d = new Date(Date.UTC(a - ans, m - 1, j));
  if (d.getUTCMonth() !== m - 1) d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

/** On travaille, et l'on se déclare, à 15 ans au moins : le dossier de l'agent le veut déjà. */
export const AGE_MINIMUM = 15;

/** La dernière date de naissance admise aujourd'hui : quinze ans révolus. */
export const neAuPlusTard = (): string => ansPlusTot(aujourdhuiIso(), AGE_MINIMUM);

/** Une carte nationale d'identité vaut dix ans à compter de sa délivrance. */
export const VALIDITE_DE_LA_CNI_ANS = 10;

/** La première délivrance d'une CNI encore valide aujourd'hui : il y a dix ans, plus un jour. */
export const cniDelivreeAuPlusTot = (): string =>
  plusJours(ansPlusTot(aujourdhuiIso(), VALIDITE_DE_LA_CNI_ANS), 1);

/** Une date de naissance : dans le passé, quinze ans révolus. */
export const dateDeNaissanceSchema = z.iso
  .date()
  .refine(
    (d) => d <= neAuPlusTard(),
    'La personne doit avoir au moins 15 ans (date dans le passé)',
  );

/** Une date d'aujourd'hui au plus tard. */
export const jusquAujourdhuiSchema = z.iso
  .date()
  .refine((d) => d <= aujourdhuiIso(), 'Pas après aujourd’hui');

/** Une date passée, aujourd'hui exclu. */
export const avantAujourdhuiSchema = z.iso
  .date()
  .refine((d) => d < aujourdhuiIso(), 'Avant aujourd’hui');

/** Ce que dit une CNI délivrée il y a dix ans ou plus. */
export const CNI_EXPIREE = 'CNI expirée : délivrée il y a plus de dix ans';

/**
 * La délivrance d'une CNI encore valide : il y a moins de dix ans, pas dans
 * l'avenir. Délivrée le 10 octobre 2019, elle vaut jusqu'au 9 octobre 2029.
 */
export const delivranceDeLaCniSchema = jusquAujourdhuiSchema.refine(
  (d) => d >= cniDelivreeAuPlusTot(),
  CNI_EXPIREE,
);
