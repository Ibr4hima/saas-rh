'use client';

import { createContext, useCallback, useContext, useState } from 'react';

/* ————————————————————————————————————————————————————————————————
   Un compte, deux espaces.

   Tout le monde est agent. Qui traite aussi pour la DCH — ou administre —
   passe d'un espace à l'autre, sans changer de compte :

   · « Mon espace » : il s'y comporte comme tous les agents. Ses congés, ses
     documents, ses informations, les congés de son équipe s'il en a une,
     l'Academy pour apprendre. C'est là, et seulement là, qu'on DEMANDE.
   · « Gestion RH » : il y traite ce que ses délégations lui confient.
     Aucune demande ne s'y fait.

   La page dit souvent d'elle-même où l'on est : « Mes congés » est à
   l'agent, « Documents à traiter » à la gestion. Quelques pages sont des
   deux — le calendrier, l'organigramme, les textes, le catalogue de
   l'Academy : elles restent dans l'espace qu'on a choisi, et n'y montrent
   leurs gestes de gestion que côté Gestion RH.
   ———————————————————————————————————————————————————————————————— */

export type Espace = 'agent' | 'gestion';

export const LIBELLES_ESPACE: Record<Espace, string> = {
  agent: 'Mon espace',
  gestion: 'Gestion RH',
};

/** L'espace qu'une page impose — `null` : elle est des deux. */
export function espaceDeLaPage(path: string): Espace | null {
  const sous = (p: string) => path === p || path.startsWith(`${p}/`);
  // Traiter pour la DCH, confier : de la gestion, même rangé sous /moi.
  if (sous('/moi/dch') || sous('/moi/delegations')) return 'gestion';
  if (sous('/moi')) return 'agent';
  if (sous('/academy/gerer')) return 'gestion';
  if (sous('/academy') || sous('/calendrier') || sous('/organisation')) return null;
  if (sous('/reglementations')) return path.endsWith('/deposer') ? 'gestion' : null;
  return 'gestion';
}

const CLE = 'teranga-espace';

/** Le dernier espace choisi, retenu d'une visite à l'autre sur ce navigateur. */
export function useEspaceChoisi(): [Espace | null, (e: Espace) => void] {
  const [choix, setChoix] = useState<Espace | null>(() => {
    try {
      const v = localStorage.getItem(CLE);
      return v === 'agent' || v === 'gestion' ? v : null;
    } catch {
      return null;
    }
  });
  const choisir = useCallback((e: Espace) => {
    setChoix(e);
    try {
      localStorage.setItem(CLE, e);
    } catch {
      // Stockage refusé : le choix tient pour la session.
    }
  }, []);
  return [choix, choisir];
}

const EspaceContext = createContext<Espace>('agent');

export const EspaceProvider = EspaceContext.Provider;

/**
 * L'espace où se trouve la personne. Une page des deux espaces s'en sert
 * pour ne montrer ses gestes de gestion (créer une unité, gérer le
 * catalogue…) que côté Gestion RH.
 */
export function useEspace(): Espace {
  return useContext(EspaceContext);
}
