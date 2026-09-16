'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

/* ————————————————————————————————————————————————————————————————
   Le thème appartient au PRODUIT, plus au navigateur.

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
   ———————————————————————————————————————————————————————————————— */

export type Theme = 'clair' | 'sombre';

export const CLE_THEME = 'teranga-theme';

/** Le script inline du <head>. Écrit en une ligne, sans dépendance, et
    tolérant à l'échec : en navigation privée, `localStorage` peut lever. */
export const SCRIPT_AMORCAGE = `try{document.documentElement.dataset.theme=localStorage.getItem('${CLE_THEME}')==='sombre'?'dark':'light'}catch(e){}`;

const Contexte = createContext<{ theme: Theme; basculer: () => void }>({
  theme: 'clair',
  basculer: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Le rendu serveur ne connaît pas le choix : il part du défaut, et le
  // premier effet relit l'attribut que le script d'amorçage a déjà posé. Ce
  // n'est pas une seconde source de vérité — c'est la même, lue une fois.
  const [theme, setTheme] = useState<Theme>('clair');
  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'sombre' : 'clair');
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

  return <Contexte.Provider value={{ theme, basculer }}>{children}</Contexte.Provider>;
}

export function useTheme() {
  return useContext(Contexte);
}
