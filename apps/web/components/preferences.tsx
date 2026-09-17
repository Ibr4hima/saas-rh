'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

/* ————————————————————————————————————————————————————————————————
   Les préférences d'AFFICHAGE : le thème, et la densité des tableaux.

   Deux réglages de même nature — ils ne changent rien aux données, ils
   changent la façon de les regarder —, gardés au même endroit, amorcés par
   le même script et offerts dans le même menu.

   ——— Le thème appartient au PRODUIT, plus au navigateur.

   Jusqu'ici l'application suivait `prefers-color-scheme` : on ouvrait la
   plateforme en sombre parce que le système l'était, sans jamais l'avoir
   demandé, et rien dans l'écran ne permettait d'en sortir. Le choix est
   désormais explicite, gardé d'une visite à l'autre, et le clair est le
   défaut — c'est la plateforme APIX telle qu'elle se présente.

   Deux morceaux se partagent le travail :

   — le script d'amorçage (app/layout.tsx) pose `data-theme` sur <html> AVANT
     le premier pixel. Sans lui, la page s'afficherait en clair puis
     basculerait en sombre une fois React monté : le clignotement se voit.
   — ce contexte relit ce que le script a posé, et le fait basculer.

   La feuille de tokens fait le reste : `[data-theme="dark"]` allume la nuit,
   `[data-theme="light"]` neutralise la préférence système.

   ——— La densité est un réglage GLOBAL, pas un réglage par tableau.

   Quatorze tableaux, quatorze petits sélecteurs de densité dans quatorze
   pieds de carte : personne ne règle sa densité tableau par tableau, et
   quatorze contrôles identiques ne sont pas quatorze réglages, c'est le même
   réglage répété. Il vit donc à côté du thème, dans le menu du compte, et
   `[data-densite="compact"]` resserre les lignes partout d'un coup.
   ———————————————————————————————————————————————————————————————— */

export type Theme = 'clair' | 'sombre';
export type Densite = 'confort' | 'compact';

export const CLE_THEME = 'teranga-theme';
export const CLE_DENSITE = 'teranga-densite';

/** Le script inline du <head>. Écrit en une ligne, sans dépendance, et
    tolérant à l'échec : en navigation privée, `localStorage` peut lever.

    La densité s'amorce ELLE AUSSI avant le premier pixel : appliquée après
    hydratation, elle ferait sauter de dix pixels par ligne un tableau qu'on
    est déjà en train de lire. */
export const SCRIPT_AMORCAGE = `try{var d=document.documentElement.dataset;d.theme=localStorage.getItem('${CLE_THEME}')==='sombre'?'dark':'light';d.densite=localStorage.getItem('${CLE_DENSITE}')==='compact'?'compact':'confort'}catch(e){}`;

const Contexte = createContext<{
  theme: Theme;
  basculer: () => void;
  densite: Densite;
  basculerDensite: () => void;
}>({
  theme: 'clair',
  basculer: () => {},
  densite: 'confort',
  basculerDensite: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Le rendu serveur ne connaît pas le choix : il part du défaut, et le
  // premier effet relit l'attribut que le script d'amorçage a déjà posé. Ce
  // n'est pas une seconde source de vérité — c'est la même, lue une fois.
  const [theme, setTheme] = useState<Theme>('clair');
  const [densite, setDensite] = useState<Densite>('confort');
  useEffect(() => {
    const d = document.documentElement.dataset;
    setTheme(d.theme === 'dark' ? 'sombre' : 'clair');
    setDensite(d.densite === 'compact' ? 'compact' : 'confort');
  }, []);

  const basculer = useCallback(() => {
    setTheme((actuel) => {
      const suivant: Theme = actuel === 'clair' ? 'sombre' : 'clair';
      document.documentElement.dataset.theme = suivant === 'sombre' ? 'dark' : 'light';
      try {
        localStorage.setItem(CLE_THEME, suivant);
      } catch {
        // Navigation privée, stockage refusé : le thème tient pour la session,
        // ce qui vaut mieux que de refuser le geste.
      }
      return suivant;
    });
  }, []);

  const basculerDensite = useCallback(() => {
    setDensite((actuelle) => {
      const suivante: Densite = actuelle === 'confort' ? 'compact' : 'confort';
      document.documentElement.dataset.densite = suivante;
      try {
        localStorage.setItem(CLE_DENSITE, suivante);
      } catch {
        // Même tolérance que pour le thème : le réglage tient pour la session.
      }
      return suivante;
    });
  }, []);

  return (
    <Contexte.Provider value={{ theme, basculer, densite, basculerDensite }}>
      {children}
    </Contexte.Provider>
  );
}

export function usePreferences() {
  return useContext(Contexte);
}
