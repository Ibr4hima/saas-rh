'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { DatesEvaluation } from '@teranga/contracts';
import { Button, Field, Input, Skeleton } from '@teranga/ui';
import { EnTete, Repere } from '../../../components/fiche';
import { Page } from '../../../components/gabarit';
import { Icon } from '../../../components/icons';
import { Modal, ModalGrid, ModalSection } from '../../../components/modal';
import { api, ApiError } from '../../../lib/api';
import { formatDate } from '../../../lib/hooks';
import { aujourdhui } from '../../../lib/temps';

/*
   Évaluation des objectifs : les deux dates de l'année où les notes de A à D
   se donnent, dans la carte de tête de « Poser une demande ». Qui dirige la
   DCH les déplace au crayon, tant qu'elles ne sont pas passées.
*/

const CLE = ['objectifs', 'evaluations', 'dates'];

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
          vue?.dates.some((d) => d.modifiable) ? (
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
                valeur={formatDate(d.date)}
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

/** Les deux dates, enregistrées ensemble ; celle d'une évaluation passée ne bouge plus. */
function FenetreDates({ vue, onClose }: { vue: DatesEvaluation; onClose: () => void }) {
  const qc = useQueryClient();
  const [valeurs, setValeurs] = useState(() => vue.dates.map((d) => d.date));
  const [erreur, setErreur] = useState<string | null>(null);
  const premier = aujourdhui() > `${vue.annee}-01-01` ? aujourdhui() : `${vue.annee}-01-01`;

  const enregistrer = useMutation({
    mutationFn: () =>
      api<DatesEvaluation>(`/objectifs/evaluations/dates/${vue.annee}`, {
        method: 'PUT',
        body: { semestre1: valeurs[0], semestre2: valeurs[1] },
      }),
    onSuccess: async (nouvelle) => {
      qc.setQueryData(CLE, nouvelle);
      await qc.invalidateQueries({ queryKey: CLE });
      onClose();
    },
    onError: (err) =>
      setErreur(err instanceof ApiError ? err.message : 'Enregistrement impossible.'),
  });
  const inchangees = vue.dates.every((d, i) => d.date === valeurs[i]);

  return (
    <Modal
      open
      onClose={onClose}
      title={`Évaluations ${vue.annee}`}
      maxWidth="max-w-lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button
            disabled={inchangees || valeurs.some((v) => !v)}
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
      <ModalSection title="Dates d’évaluation">
        <ModalGrid>
          {vue.dates.map((d, i) => (
            <Field
              key={d.semestre}
              label={`Semestre ${d.semestre}`}
              htmlFor={`date-s${d.semestre}`}
            >
              <Input
                id={`date-s${d.semestre}`}
                type="date"
                disabled={!d.modifiable}
                min={d.modifiable ? premier : undefined}
                max={`${vue.annee}-12-31`}
                value={valeurs[i] ?? ''}
                onChange={(e) => setValeurs((v) => v.map((x, j) => (j === i ? e.target.value : x)))}
              />
            </Field>
          ))}
        </ModalGrid>
      </ModalSection>
    </Modal>
  );
}
