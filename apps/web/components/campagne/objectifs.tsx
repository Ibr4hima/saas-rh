'use client';

import {
  dateEnLettres,
  LONGUEURS_DE_LA_FICHE,
  NOMBRE_D_OBJECTIFS_A_VENIR,
  type ObjectifDeLAnneeAVenir,
} from '@teranga/contracts';
import { DateInput } from '@teranga/ui';
import { CelluleDeTexte, Tableau } from './evaluation-du-n1';

/* ────────────────────────────────────────────────────────────────
   Les objectifs de l'année, tels que les fixe le N+1 pendant la campagne
   des objectifs (ADR-0274) : de trois à cinq, chacun avec son indicateur
   de réussite et son échéance, dans l'année. Le même tableau se remplit
   chez le N+1 et se lit chez l'agent.
   ──────────────────────────────────────────────────────────────── */

/** Les objectifs de l'année `annee` : à remplir avec `onChange`, en lecture sans. */
export function TableauDesObjectifs({
  annee,
  objectifs,
  onChange,
}: {
  annee: number;
  objectifs: readonly ObjectifDeLAnneeAVenir[];
  onChange?: (objectifs: ObjectifDeLAnneeAVenir[]) => void;
}) {
  return (
    <Tableau<ObjectifDeLAnneeAVenir>
      nom="Objectif"
      leNom="l’objectif"
      colonnes={['Objectif', 'Indicateur de réussite (quantifiable ou qualifiable)', 'Échéance']}
      requises
      gabarit="@[46rem]:grid-cols-[1.75rem_minmax(0,2.25fr)_minmax(0,2.05fr)_10.5rem_1.75rem]"
      lignes={objectifs}
      min={NOMBRE_D_OBJECTIFS_A_VENIR.min}
      max={NOMBRE_D_OBJECTIFS_A_VENIR.max}
      ajouter="Ajouter un objectif"
      vide={() => ({ objectif: '', indicateur: '', echeance: null })}
      lecture={(o) => [o.objectif, o.indicateur, o.echeance ? dateEnLettres(o.echeance) : '']}
      saisie={(o, changer, attrs) => [
        <CelluleDeTexte
          key="objectif"
          {...attrs(0)}
          max={LONGUEURS_DE_LA_FICHE.intitule}
          valeur={o.objectif}
          onChange={(objectif) => changer({ objectif })}
        />,
        <CelluleDeTexte
          key="indicateur"
          {...attrs(1)}
          max={LONGUEURS_DE_LA_FICHE.indicateurs}
          valeur={o.indicateur}
          onChange={(indicateur) => changer({ indicateur })}
        />,
        // L'échéance tombe dans l'année des objectifs.
        <DateInput
          key="echeance"
          {...attrs(2)}
          value={o.echeance ?? ''}
          min={`${annee}-01-01`}
          max={`${annee}-12-31`}
          onChange={(ev) => changer({ echeance: ev.target.value || null })}
          className="text-[12.5px]"
        />,
      ]}
      onChange={onChange}
    />
  );
}
