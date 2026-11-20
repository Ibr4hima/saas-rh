'use client';

import { useQuery } from '@tanstack/react-query';
import type { AccueilDeLaCampagne, SessionUser } from '@teranga/contracts';
import { api } from './api';

/** L'accueil de la campagne d'évaluation annuelle (ADR-0211). */
export const ACCUEIL_DE_LA_CAMPAGNE = '/evaluation-annuelle';

/** Son auto-évaluation (ADR-0214). */
export const AUTO_EVALUATION = `${ACCUEIL_DE_LA_CAMPAGNE}/auto-evaluation`;

/** Son évaluation par le N+1, à lire et à valider (ADR-0217). */
export const MON_EVALUATION = `${ACCUEIL_DE_LA_CAMPAGNE}/mon-evaluation`;

export const CLE_CAMPAGNE = ['campagne'] as const;

/**
 * En campagne, un agent ne voit que l'évaluation annuelle ; l'administration
 * garde la plateforme complète.
 */
export const enCampagne = (me: SessionUser | undefined): boolean =>
  Boolean(me?.campagne) && me?.role !== 'admin';

/**
 * L'année de la campagne en cours, pour les écrans d'avant la connexion :
 * `null` hors campagne, `undefined` le temps de la demander.
 */
export function useAnneeDeLaCampagne(): number | null | undefined {
  const q = useQuery({
    queryKey: ['campagne-en-cours'],
    queryFn: () => api<{ annee: number | null }>('/auth/campagne'),
    staleTime: Infinity,
    retry: false,
  });
  return q.isError ? null : q.data?.annee;
}

/** Ce que l'accueil montre : la fiche de la personne, son auto-évaluation, son équipe. */
export function useAccueilDeLaCampagne() {
  return useQuery({
    queryKey: CLE_CAMPAGNE,
    queryFn: () => api<AccueilDeLaCampagne>('/campagne'),
  });
}
