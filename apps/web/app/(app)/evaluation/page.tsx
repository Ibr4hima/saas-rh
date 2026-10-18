'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  dateEnLettres,
  JOURS_PAR_MOIS,
  jourEtMoisEnLettres,
  MOIS_DE_L_ANNEE,
  ouvertureDeLAutoEvaluation,
  type DateEvaluation,
} from '@teranga/contracts';
import { Button, Select, Skeleton } from '@teranga/ui';
import { EnTete, Repere } from '../../../components/fiche';
import { Page } from '../../../components/gabarit';
import { Icon } from '../../../components/icons';
import { Modal } from '../../../components/modal';
import { api, ApiError } from '../../../lib/api';
import { formatDate } from '../../../lib/hooks';

/*
   Évaluation des objectifs : le jour de l'année où les notes de A à D se
   donnent, une fois par an (ADR-0075), dans la carte de tête de « Poser une
   demande ». Qui dirige la DCH en fixe le jour et le mois, au crayon : ils
   reviennent chaque année. L'auto-évaluation s'ouvre deux semaines avant
   (ADR-0076).
*/

const CLE = ['objectifs', 'evaluations', 'date'];

/** « 12-15 » : le mois et le jour, en nombres. */
const enNombres = (jour: string) => jour.split('-').map(Number) as [number, number];

export default function EvaluationPage() {
  const [ouverte, setOuverte] = useState(false);
  const date = useQuery({
    queryKey: CLE,
    queryFn: () => api<DateEvaluation>('/objectifs/evaluations/date'),
  });
  const vue = date.data;

  return (
    <Page>
      <EnTete
        titre={vue ? `Évaluation ${vue.annee}` : 'Évaluation des objectifs'}
        sousTitre={vue ? `Prochaine évaluation le ${formatDate(vue.date)}` : undefined}
        colonnes={2}
        action={
          vue?.modifiable ? (
            <button
              type="button"
              onClick={() => setOuverte(true)}
              aria-label="Modifier la date"
              title="Modifier la date"
              className="flex size-9 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-ink-muted transition-colors duration-200 hover:border-primary/40 hover:bg-primary/[0.06] hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
            >
              <Icon name="edit" size={18} />
            </button>
          ) : null
        }
        reperes={
          vue ? (
            <>
              <Repere label="Date d’évaluation" valeur={jourEtMoisEnLettres(vue.jour)} />
              {/* Deux semaines avant (ADR-0076). */}
              <Repere
                label="Auto-évaluation"
                valeur={`Dès le ${dateEnLettres(ouvertureDeLAutoEvaluation(vue.annee, vue.jour), false)}`}
              />
            </>
          ) : date.isLoading ? (
            <div>
              <Skeleton className="h-2.5 w-16" />
              <Skeleton className="mt-2.5 h-4 w-24" />
            </div>
          ) : null
        }
      />
      {ouverte && vue ? <FenetreDate vue={vue} onClose={() => setOuverte(false)} /> : null}
    </Page>
  );
}

/** Le jour et le mois de l'évaluation, qui reviennent chaque année. */
function FenetreDate({ vue, onClose }: { vue: DateEvaluation; onClose: () => void }) {
  const qc = useQueryClient();
  const [[mois, jour], setDate] = useState(() => enNombres(vue.jour));
  const [erreur, setErreur] = useState<string | null>(null);
  const enTexte = `${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}`;

  const enregistrer = useMutation({
    mutationFn: () =>
      api<DateEvaluation>('/objectifs/evaluations/date', {
        method: 'PUT',
        body: { jour: enTexte },
      }),
    onSuccess: async (nouvelle) => {
      qc.setQueryData(CLE, nouvelle);
      await qc.invalidateQueries({ queryKey: CLE });
      onClose();
    },
    onError: (err) =>
      setErreur(err instanceof ApiError ? err.message : 'Enregistrement impossible.'),
  });
  // Un mois plus court ramène le jour à son dernier : le 31 passe au 30 en juin.
  const changer = (m: number, j: number) => setDate([m, Math.min(j, JOURS_PAR_MOIS[m - 1]!)]);

  return (
    <Modal
      open
      onClose={onClose}
      title="Date d’évaluation"
      subtitle="Chaque année"
      maxWidth="max-w-md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button
            disabled={enTexte === vue.jour}
            loading={enregistrer.isPending}
            onClick={() => {
              setErreur(null);
              enregistrer.mutate();
            }}
          >
            Enregistrer
          </Button>
        </>
      }
    >
      {erreur ? (
        <p role="alert" className="rounded-bloc bg-danger-soft px-3 py-2 text-[12.5px] text-danger">
          {erreur}
        </p>
      ) : null}
      <div className="grid grid-cols-[4.75rem_minmax(0,1fr)] gap-2 pt-1">
        <Select
          aria-label="Jour"
          value={String(jour)}
          onChange={(e) => changer(mois, Number(e.target.value))}
        >
          {Array.from({ length: JOURS_PAR_MOIS[mois - 1]! }, (_, k) => k + 1).map((j) => (
            <option key={j} value={j}>
              {j === 1 ? '1er' : j}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Mois"
          value={String(mois)}
          onChange={(e) => changer(Number(e.target.value), jour)}
        >
          {MOIS_DE_L_ANNEE.map((nom, k) => (
            <option key={nom} value={k + 1}>
              {nom.charAt(0).toUpperCase() + nom.slice(1)}
            </option>
          ))}
        </Select>
      </div>
    </Modal>
  );
}
