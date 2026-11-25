'use client';

import { Button } from '@teranga/ui';

/**
 * Le serveur ne répond pas (réseau coupé, redémarrage) : la session tient
 * peut-être encore, la connexion n'est pas redemandée pour autant
 * (ADR-0291). Seul un refus de la session (401) ramène à la connexion.
 */
export function ServeurInjoignable({ onReessayer }: { onReessayer: () => void }) {
  return (
    <div
      role="alert"
      className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center"
    >
      <p className="text-[14px] font-semibold text-danger">
        Le serveur ne répond pas pour l’instant.
      </p>
      <Button size="sm" variant="secondary" onClick={onReessayer}>
        Réessayer
      </Button>
    </div>
  );
}
