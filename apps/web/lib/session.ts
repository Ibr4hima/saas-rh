'use client';

import type { QueryClient } from '@tanstack/react-query';
import type { SessionUser } from '@teranga/contracts';
import { useEffect } from 'react';

/* Un cache, un compte.

   Le cache des requêtes vit aussi longtemps que l'onglet ; ce qu'il garde
   appartient au compte qui l'a lu et ne doit jamais s'afficher sous un autre
   nom. Sans garde, « Bonsoir, Hawa » coiffait la fiche de Rokhaya : /me se
   relit à la minute, la fiche, elle, restait celle du compte précédent.

   · Ouvrir une session (connexion, invitation acceptée) part d'un cache vide.
   · Fermer la session le vide.
   · Les onglets se préviennent : une session fermée ailleurs fait relire, et
     la connexion redemandée ; une session ouverte ailleurs fait relire /me.
   · Et quel que soit le chemin (session reprise dans un autre onglet, page
     rendue par le bouton Retour du navigateur), dès que /me répond un autre
     compte que celui du cache, tout le reste est relu. */

type Evenement = 'ouverte' | 'fermee';

// Un seul canal par onglet : il n'entend pas ce qu'il annonce lui-même.
let canal: BroadcastChannel | null | undefined;
function leCanal(): BroadcastChannel | null {
  if (canal === undefined) {
    try {
      canal = new BroadcastChannel('teranga-session');
    } catch {
      // Navigateur sans BroadcastChannel : la garde sur /me suffit.
      canal = null;
    }
  }
  return canal;
}

function annoncer(evenement: Evenement) {
  leCanal()?.postMessage(evenement);
}

/** Une session vient de s'ouvrir dans cet onglet. */
export function ouvrirSession(client: QueryClient) {
  client.clear();
  annoncer('ouverte');
}

/** La session de cet onglet vient de se fermer. */
export function fermerSession(client: QueryClient) {
  client.clear();
  annoncer('fermee');
}

const toutSaufMoi = { predicate: (q: { queryKey: readonly unknown[] }) => q.queryKey[0] !== 'me' };

/** Veille sur le cache : il ne sert qu'au compte qui l'a rempli. */
export function useGardeDeSession(client: QueryClient) {
  useEffect(() => {
    let proprietaire: string | null = null;
    const desabonner = client.getQueryCache().subscribe((e) => {
      if (e.type !== 'updated' || e.query.queryKey[0] !== 'me') return;
      const u = e.query.state.data as SessionUser | undefined;
      if (!u) return;
      const compte = `${u.tenantId}:${u.userId}`;
      if (proprietaire !== null && proprietaire !== compte) {
        // Hors de la notification en cours, mais avant le rendu suivant.
        queueMicrotask(() => void client.resetQueries(toutSaufMoi));
      }
      proprietaire = compte;
    });

    const ailleurs = (m: MessageEvent<Evenement>) => {
      // Fermée ailleurs : tout se relit, /me répond 401 et la page de
      // connexion prend le relais. Ouverte ailleurs : /me dira qui.
      if (m.data === 'fermee') void client.resetQueries();
      else if (m.data === 'ouverte') void client.invalidateQueries({ queryKey: ['me'] });
    };
    leCanal()?.addEventListener('message', ailleurs);

    // Une page rendue telle quelle par le bouton Retour (cache du navigateur)
    // revient avec la mémoire d'avant : on redemande qui est connecté.
    const auRetour = (e: PageTransitionEvent) => {
      if (e.persisted) void client.invalidateQueries({ queryKey: ['me'] });
    };
    window.addEventListener('pageshow', auRetour);

    return () => {
      desabonner();
      leCanal()?.removeEventListener('message', ailleurs);
      window.removeEventListener('pageshow', auRetour);
    };
  }, [client]);
}
