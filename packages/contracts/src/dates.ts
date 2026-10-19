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

/** La première date de délivrance d'une CNI encore valide aujourd'hui. */
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

/** La délivrance d'une CNI encore valide : il y a moins de dix ans, pas dans l'avenir. */
export const delivranceDeLaCniSchema = jusquAujourdhuiSchema.refine(
  (d) => d >= cniDelivreeAuPlusTot(),
  'CNI expirée : délivrée il y a plus de dix ans',
);
