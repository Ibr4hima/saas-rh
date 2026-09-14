'use client';

import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { cn } from '@teranga/ui';
import { DEFAULT_COUNTRY } from '../lib/countries';

/**
 * Un numéro de téléphone, écrit comme son PAYS l'écrit.
 *
 * Chaque plan de numérotation a son découpage, et le deviner à coups de
 * groupes de deux ne marche que pour le Sénégal : un numéro américain se dit
 * « +1 213 373 4253 », un allemand « +49 1511 2345678 », un français
 * « +33 6 12 34 56 78 ». On délègue donc à libphonenumber — le port de la
 * bibliothèque de Google, qui porte ces règles pour tous les pays — plutôt
 * que d'inventer une mise en forme qui serait fausse partout ailleurs.
 *
 * Un numéro stocké SANS indicatif est lu comme sénégalais : c'est déjà la
 * convention du champ de saisie, qui pré-remplit le Sénégal.
 *
 * Ce qu'on n'arrive pas à reconnaître est rendu TEL QUEL. Un numéro
 * incomplet, un poste interne, une vieille donnée importée : mieux vaut
 * l'afficher brut que le maquiller en numéro valide.
 */
export function formatTelephone(stocke: string | null | undefined): string {
  if (!stocke) return '';
  const n = parsePhoneNumberFromString(stocke, DEFAULT_COUNTRY as 'SN');
  return n ? n.formatInternational() : stocke;
}

/** La forme composable — E.164, sans espace : « +221771234567 ». */
export function telHref(stocke: string | null | undefined): string | null {
  if (!stocke) return null;
  const n = parsePhoneNumberFromString(stocke, DEFAULT_COUNTRY as 'SN');
  return n ? n.number : null;
}

/**
 * Le numéro affiché partout dans le produit.
 *
 * `lien` est vrai par défaut — appeler est le geste qu'on veut permettre —
 * SAUF à l'intérieur d'un bouton ou d'un lien : un `<a>` imbriqué dans un
 * `<a>` ou un `<button>` est du HTML invalide, et les navigateurs le
 * réparent chacun à leur façon.
 */
export function Telephone({
  valeur,
  lien = true,
  className,
  vide = '—',
}: {
  valeur: string | null | undefined;
  lien?: boolean;
  className?: string;
  /** Ce qu'on écrit quand il n'y a pas de numéro. */
  vide?: React.ReactNode;
}) {
  if (!valeur) return <span className={cn('text-ink-muted/70', className)}>{vide}</span>;

  const texte = formatTelephone(valeur);
  const href = telHref(valeur);
  if (!lien || !href) {
    return <span className={cn('whitespace-nowrap tabular-nums', className)}>{texte}</span>;
  }
  return (
    <a
      href={`tel:${href}`}
      className={cn(
        'whitespace-nowrap tabular-nums transition-colors hover:text-primary hover:underline',
        className,
      )}
    >
      {texte}
    </a>
  );
}
