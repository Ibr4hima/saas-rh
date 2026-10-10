'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { JOURS_PAR_MOIS, MOIS_DE_L_ANNEE, type DatesEvaluation } from '@teranga/contracts';
import { Button, Field, Select, Skeleton } from '@teranga/ui';
import { EnTete, Repere } from '../../../components/fiche';
import { Page } from '../../../components/gabarit';
import { Icon } from '../../../components/icons';
import { Modal, ModalGrid, ModalSection } from '../../../components/modal';
import { api, ApiError } from '../../../lib/api';
import { formatDate } from '../../../lib/hooks';
import { aujourdhui } from '../../../lib/temps';

/*
   Évaluation des objectifs : les deux jours de l'année où les notes de A à D
   se donnent, dans la carte de tête de « Poser une demande ». Qui dirige la
   DCH en fixe le jour et le mois, au crayon : ils reviennent chaque année.
*/

const CLE = ['objectifs', 'evaluations', 'dates'];

/** « 06-30 » : le jour et le mois, en nombres. */
const enNombres = (jour: string) => jour.split('-').map(Number) as [number, number];

/** « 30 juin », « 1er janvier ». */
function jourEtMois(jour: string): string {
  const [m, j] = enNombres(jour);
  return `${j === 1 ? '1er' : j} ${MOIS_DE_L_ANNEE[m - 1]}`;
}

export default function EvaluationPage() {
  const [ouverte, setOuverte] = useState(false);
  const dates = useQuery({
    queryKey: CLE,
    queryFn: () => api<DatesEvaluation>('/objectifs/evaluations/dates'),
  });
  const vue = dates.data;
  const prochaine = vue?.dates.find((d) => d.date >= aujourdhui());

  return (
    <Page>
      <EnTete
        titre={vue ? `Évaluations ${vue.annee}` : 'Évaluation des objectifs'}
        sousTitre={prochaine ? `Prochaine évaluation le ${formatDate(prochaine.date)}` : undefined}
        colonnes={2}
        action={
          vue?.modifiables ? (
            <button
              type="button"
              onClick={() => setOuverte(true)}
              aria-label="Modifier les dates"
              title="Modifier les dates"
              className="flex size-9 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-ink-muted transition-colors duration-200 hover:border-primary/40 hover:bg-primary/[0.06] hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
            >
              <Icon name="edit" size={18} />
            </button>
          ) : null
        }
        reperes={
          vue ? (
            vue.dates.map((d) => (
              <Repere
                key={d.semestre}
                label={`Semestre ${d.semestre}`}
                valeur={jourEtMois(d.jour)}
              />
            ))
          ) : dates.isLoading ? (
            <>
              {[0, 1].map((i) => (
                <div key={i}>
                  <Skeleton className="h-2.5 w-16" />
                  <Skeleton className="mt-2.5 h-4 w-24" />
                </div>
              ))}
            </>
          ) : null
        }
      />
      {ouverte && vue ? <FenetreDates vue={vue} onClose={() => setOuverte(false)} /> : null}
    </Page>
  );
}

/** Le jour et le mois de chaque semestre, enregistrés ensemble. */
function FenetreDates({ vue, onClose }: { vue: DatesEvaluation; onClose: () => void }) {
  const qc = useQueryClient();
  const [jours, setJours] = useState(() => vue.dates.map((d) => enNombres(d.jour)));
  const [erreur, setErreur] = useState<string | null>(null);
  const enTexte = ([m, j]: [number, number]) =>
    `${String(m).padStart(2, '0')}-${String(j).padStart(2, '0')}`;

  const enregistrer = useMutation({
    mutationFn: () =>
      api<DatesEvaluation>('/objectifs/evaluations/dates', {
        method: 'PUT',
        body: { semestre1: enTexte(jours[0]!), semestre2: enTexte(jours[1]!) },
      }),
    onSuccess: async (nouvelle) => {
      qc.setQueryData(CLE, nouvelle);
      await qc.invalidateQueries({ queryKey: CLE });
      onClose();
    },
    onError: (err) =>
      setErreur(err instanceof ApiError ? err.message : 'Enregistrement impossible.'),
  });
  const inchanges = vue.dates.every((d, i) => d.jour === enTexte(jours[i]!));
  // Un mois plus court ramène le jour à son dernier : le 31 passe au 30 en juin.
  const changer = (i: number, mois: number, jour: number) =>
    setJours((js) =>
      js.map((x, k) => (k === i ? [mois, Math.min(jour, JOURS_PAR_MOIS[mois - 1]!)] : x)),
    );

  return (
    <Modal
      open
      onClose={onClose}
      title="Dates d’évaluation"
      maxWidth="max-w-xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button
            disabled={inchanges}
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
        <p
          role="alert"
          className="rounded-[9px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger"
        >
          {erreur}
        </p>
      ) : null}
      <ModalSection title="Chaque année">
        <ModalGrid>
          {jours.map(([mois, jour], i) => (
            <Field key={i} label={`Semestre ${i + 1}`} htmlFor={`jour-s${i + 1}`}>
              <div className="grid grid-cols-[4.75rem_minmax(0,1fr)] gap-2">
                <Select
                  id={`jour-s${i + 1}`}
                  aria-label={`Jour du semestre ${i + 1}`}
                  value={String(jour)}
                  onChange={(e) => changer(i, mois, Number(e.target.value))}
                >
                  {Array.from({ length: JOURS_PAR_MOIS[mois - 1]! }, (_, k) => k + 1).map((j) => (
                    <option key={j} value={j}>
                      {j === 1 ? '1er' : j}
                    </option>
                  ))}
                </Select>
                <Select
                  aria-label={`Mois du semestre ${i + 1}`}
                  value={String(mois)}
                  onChange={(e) => changer(i, Number(e.target.value), jour)}
                >
                  {MOIS_DE_L_ANNEE.map((nom, k) => (
                    <option key={nom} value={k + 1}>
                      {nom}
                    </option>
                  ))}
                </Select>
              </div>
            </Field>
          ))}
        </ModalGrid>
      </ModalSection>
    </Modal>
  );
}
