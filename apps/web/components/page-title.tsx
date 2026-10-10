'use client';

import * as React from 'react';

/**
 * Titre du bandeau, quand l'URL ne suffit pas à le dire.
 *
 * Le layout déduit le titre du chemin — « Gestion du personnel », « Congés ».
 * Ça marche partout sauf sur les écrans qui portent UN objet : sur
 * /employees/<id>, « Fiche employé » ne dit pas DE QUI il s'agit, alors que
 * c'est la seule chose qu'on veut savoir en levant les yeux.
 *
 * L'écran annonce donc son propre titre quand il connaît son objet, et le
 * reprend au démontage — sans quoi le nom d'un employé resterait affiché sur
 * l'écran suivant.
 */
const PageTitleContext = React.createContext<{
  title: string | null;
  setTitle: (t: string | null) => void;
}>({ title: null, setTitle: () => {} });

export function PageTitleProvider({ children }: { children: React.ReactNode }) {
  const [title, setTitle] = React.useState<string | null>(null);
  const value = React.useMemo(() => ({ title, setTitle }), [title]);
  return <PageTitleContext.Provider value={value}>{children}</PageTitleContext.Provider>;
}

/** Lu par le layout : le titre annoncé par l'écran, ou null. */
export function usePageTitleOverride(): string | null {
  return React.useContext(PageTitleContext).title;
}

/**
 * Appelé par un écran pour annoncer son titre. `null` pendant le chargement :
 * le titre déduit du chemin tient la place, plutôt qu'un vide qui clignote.
 */
export function usePageTitle(title: string | null): void {
  const { setTitle } = React.useContext(PageTitleContext);
  React.useEffect(() => {
    if (title === null) return;
    setTitle(title);
    return () => setTitle(null);
  }, [title, setTitle]);
}
