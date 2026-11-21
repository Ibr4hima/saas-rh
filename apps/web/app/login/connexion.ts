'use client';

import { useEffect, useState } from 'react';
import type { AttenteDuCode } from '@teranga/contracts';

/**
 * Ce que la connexion garde d'un écran à l'autre, le temps de l'onglet : le
 * nom et l'adresse saisis (« Modifier mes informations » les retrouve), la
 * réponse à la demande du code, et l'erreur à montrer au retour sur le
 * premier écran. Rien n'est écrit dans le navigateur.
 */
export const memoire: {
  nom: string;
  email: string;
  attente: AttenteDuCode | null;
  erreur: string | null;
} = { nom: '', email: '', attente: null, erreur: null };

/**
 * Le nom de famille tel qu'il s'écrit dans le champ : en capitales, sans
 * accents, « Sène » donne SENE (ADR-0229). Le serveur le compare de la même
 * façon, espaces et traits d'union en moins : la saisie ne change rien à la
 * reconnaissance du compte. Sa longueur ne bouge pas, le curseur reste en
 * place.
 */
export function nomEnCapitales(saisie: string): string {
  return saisie
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .normalize('NFC')
    .toUpperCase();
}

/**
 * La page d'où l'on venait (le lien d'un courriel), si c'en est une du
 * portail : un chemin, jamais une adresse d'un autre site.
 */
function suiteDeLaPage(): string | null {
  const suite = new URLSearchParams(window.location.search).get('suite');
  return suite && /^\/(?![/\\])/.test(suite) ? suite : null;
}

/** Où aller une fois la session ouverte. */
export const pageDeRetour = (): string => suiteDeLaPage() ?? '/';

const avecLaSuite = (chemin: string, suite: string | null) =>
  suite ? `${chemin}?suite=${encodeURIComponent(suite)}` : chemin;

/**
 * Le chemin d'un autre écran de la connexion, qui garde la page de retour.
 * Pour un geste : l'adresse de la page se lit au moment où il se fait.
 */
export const versLEcran = (chemin: string): string => avecLaSuite(chemin, suiteDeLaPage());

/**
 * Le même chemin, pour un lien de la page. Lu après le premier rendu : le
 * serveur ne connaît pas l'adresse.
 */
export function useEcranDeConnexion(): (chemin: string) => string {
  const [suite, setSuite] = useState<string | null>(null);
  useEffect(() => setSuite(suiteDeLaPage()), []);
  return (chemin) => avecLaSuite(chemin, suite);
}
