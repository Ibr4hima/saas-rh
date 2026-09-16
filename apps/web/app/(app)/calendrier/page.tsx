'use client';

import { FriseFeries } from '../../../components/frise-feries';

/**
 * Le calendrier de l'année : ses jours fériés, en frise.
 *
 * La grille du mois a quitté cette page. Elle y répétait la même absence sur
 * trente cases — un congé de maternité couvrait tout septembre, et le mois
 * n'était plus qu'une colonne du même libellé quinze fois de suite. Le
 * planning des absences se lit là où on le cherche : dans la fenêtre du
 * bandeau, d'un clic sur la date, et dans « Calendrier des absences » sur la
 * page des demandes, où il porte les noms sans les répéter.
 *
 * Reste ici ce qu'aucun autre écran ne montrait : l'année entière de fériés,
 * dans l'ordre, avec ce qui les sépare d'aujourd'hui.
 */
export default function CalendrierPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <FriseFeries />
    </div>
  );
}
