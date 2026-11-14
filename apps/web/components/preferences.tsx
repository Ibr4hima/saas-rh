'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
} from 'react';

/* ————————————————————————————————————————————————————————————————
   La préférence d'AFFICHAGE : le thème.

   (La densité des tableaux en était une seconde ; elle a été retirée. Les
   tableaux sont confortables pour tout le monde, et un réglage que presque
   personne ne touche encombrait le menu du compte.)

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
   ———————————————————————————————————————————————————————————————— */

export type Theme = 'clair' | 'sombre';

export const CLE_THEME = 'teranga-theme';

/** Le script inline du <head>. Écrit en une ligne, sans dépendance, et
    tolérant à l'échec : en navigation privée, `localStorage` peut lever.
    Les pages toujours en clair (cf. useThemeClair) le sont dès le premier
    pixel : les pages publiques, et les écrans d'avant le compte. */
export const SCRIPT_AMORCAGE = `try{document.documentElement.dataset.theme=/^\\/(postuler|verifier|invitation|reinitialisation)\\/|^\\/(login|register|mot-de-passe-oublie)\\/?$/.test(location.pathname)||localStorage.getItem('${CLE_THEME}')!=='sombre'?'light':'dark'}catch(e){}`;

/** Le thème gardé dans ce navigateur, le clair à défaut. */
function themeGarde(): Theme {
  try {
    return localStorage.getItem(CLE_THEME) === 'sombre' ? 'sombre' : 'clair';
  } catch {
    return 'clair';
  }
}

/**
 * Une seule teinte, la claire, quelle que soit la préférence gardée dans ce
 * navigateur : sur les pages publiques (une offre, la vérification d'un
 * certificat), vues par des personnes extérieures, et sur les écrans d'avant
 * le compte (ADR-0187). Le script d'amorçage le fait au premier pixel ; ce
 * crochet le tient quand on y arrive depuis l'application, et rend le thème
 * choisi en repartant : celui qui est gardé, pas celui que la page a trouvé.
 * Sur l'écran de connexion, le thème est clair d'emblée ; après la
 * connexion, on retrouve le sien.
 *
 * Avant que l'écran ne s'affiche, et non après : en sortant de l'application
 * en sombre, la page de connexion paraîtrait une image en sombre.
 */
export function useThemeClair(): void {
  useLayoutEffect(() => {
    const html = document.documentElement;
    html.dataset.theme = 'light';
    return () => {
      html.dataset.theme = themeGarde() === 'sombre' ? 'dark' : 'light';
    };
  }, []);
}

const Contexte = createContext<{
  theme: Theme;
  basculer: () => void;
}>({
  theme: 'clair',
  basculer: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Le rendu serveur ne connaît pas le choix : il part du défaut, et le
  // premier effet relit le choix gardé, celui que le script d'amorçage a lu.
  // Pas l'attribut de la page : sur un écran toujours en clair, il ne dit
  // rien du choix qu'on retrouvera après la connexion.
  const [theme, setTheme] = useState<Theme>('clair');
  useEffect(() => {
    setTheme(themeGarde());
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

export function usePreferences() {
  return useContext(Contexte);
}
