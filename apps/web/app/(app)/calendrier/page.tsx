'use client';

import { Calendrier } from '../../../components/calendrier';
import { FriseFeries } from '../../../components/frise-feries';

/**
 * Le calendrier a sa fenêtre depuis le bandeau — c'est le geste courant.
 * Cette page reste pour qui arrive par le menu, par un lien, ou veut la
 * pleine largeur.
 *
 * Elle porte deux lectures du même temps, et l'ordre compte : la grille du
 * mois répond à « qui est absent le 12 ? », la frise à « quand tombe le
 * prochain férié et qu'est-ce qui reste avant la fin de l'année ? ». La
 * première est l'outil de travail, la seconde la vue d'ensemble — on la
 * déroule quand on la cherche.
 */
export default function CalendrierPage() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <Calendrier />
      <FriseFeries />
    </div>
  );
}
