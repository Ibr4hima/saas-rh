'use client';

import { Calendrier } from '../../../components/calendrier';

/**
 * Le calendrier a sa fenêtre depuis le bandeau — c'est le geste courant.
 * Cette page reste pour qui arrive par un lien ou veut la pleine largeur.
 */
export default function CalendrierPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <Calendrier />
    </div>
  );
}
