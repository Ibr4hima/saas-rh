'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  dateEnLettres,
  LONGUEURS_DE_LA_FICHE,
  TITRE_DE_LA_FICHE,
  type MonEvaluation,
} from '@teranga/contracts';
import { Button, Card, EmptyState, Field, Skeleton } from '@teranga/ui';
import { FicheDuN1 } from '../../../../components/campagne/evaluation-du-n1';
import {
  EvaluationValidee,
  MotDeRenvoi,
  RetourALAccueil,
} from '../../../../components/campagne/fiche';
import { EnTete, Repere } from '../../../../components/fiche';
import { Confirmation, messageDe, ZoneDeTexte } from '../../../../components/grille-evaluation';
import { Icon } from '../../../../components/icons';
import { api, ApiError } from '../../../../lib/api';
import { ACCUEIL_DE_LA_CAMPAGNE, CLE_CAMPAGNE } from '../../../../lib/campagne';

/* ────────────────────────────────────────────────────────────────
   Son évaluation par le N+1 (ADR-0217), ouverte par le bouton « Valider mon
   évaluation » de l'accueil, ou par la carte de l'étape.

   En tête : le N+1, le jour où l'évaluation est arrivée, le nombre
   d'objectifs, sa validation. Dessous, la fiche telle que le N+1 l'a
   transmise, qui s'arrête avant la partie réservée à la hiérarchie : la
   page ne la reçoit pas. Une barre, collée au bas de l'écran, porte
   « Renvoyer à mon N+1 » et « Valider mon évaluation ». Validée, la fiche
   se lit et ne change plus. Renvoyée, la page montre le mot de l'agent,
   jusqu'à ce que le N+1 la transmette de nouveau.
   ──────────────────────────────────────────────────────────────── */

const CHEMIN = '/campagne/mon-evaluation';
const CLE = [...CLE_CAMPAGNE, 'mon-evaluation'] as const;

export default function MonEvaluationPage() {
  const router = useRouter();
  const requete = useQuery({
    queryKey: CLE,
    queryFn: () => api<MonEvaluation>(CHEMIN),
    retry: false,
  });
  // Sans évaluation (au sommet de l'organigramme, en stage), retour à l'accueil.
  const sansEvaluation = requete.error instanceof ApiError && requete.error.problem.status === 404;
  useEffect(() => {
    if (sansEvaluation) router.replace(ACCUEIL_DE_LA_CAMPAGNE);
  }, [sansEvaluation, router]);

  if (requete.error && !sansEvaluation) {
    return (
      <div className="flex flex-col gap-4">
        <RetourALAccueil libelle="Accueil" />
        <Card>
          <EmptyState
            className="py-12"
            icon={<Icon name="checklist" size={22} />}
            title={messageDe(requete.error, 'Impossible d’afficher votre évaluation')}
          />
        </Card>
      </div>
    );
  }
  if (!requete.data) {
    return (
      <div className="flex flex-col gap-4">
        <RetourALAccueil libelle="Accueil" />
        <Skeleton className="mb-4 h-[158px] w-full rounded-bloc" />
        <Skeleton className="h-72 w-full rounded-bloc" />
      </div>
    );
  }
  // Validée ou renvoyée, la page repart de zéro.
  return <Evaluation key={requete.data.etat} vue={requete.data} />;
}

function Evaluation({ vue: v }: { vue: MonEvaluation }) {
  const qc = useQueryClient();
  const [geste, setGeste] = useState<'valider' | 'renvoyer' | null>(null);
  const [mot, setMot] = useState('');
  const idDuMot = useId();
  const n1 = v.evaluateur;
  const nomDuN1 = n1 ? `${n1.prenom} ${n1.nom}` : null;

  const apres = async (nouvelle: MonEvaluation) => {
    qc.setQueryData(CLE, nouvelle);
    await qc.invalidateQueries({ queryKey: CLE_CAMPAGNE, exact: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const valider = useMutation({
    mutationFn: () => api<MonEvaluation>(`${CHEMIN}/validation`, { method: 'POST' }),
    onSuccess: apres,
  });
  const renvoyer = useMutation({
    mutationFn: () =>
      api<MonEvaluation>(`${CHEMIN}/renvoi`, { method: 'POST', body: { mot: mot.trim() } }),
    onSuccess: apres,
  });
  const fermer = () => {
    setGeste(null);
    valider.reset();
    renvoyer.reset();
  };

  return (
    <div className="flex flex-col gap-4">
      <RetourALAccueil libelle="Accueil" />
      <EnTete
        titre="Mon évaluation"
        marque={v.etat === 'validee' ? <EvaluationValidee le={v.valideeLe} /> : null}
        sousTitre={`${TITRE_DE_LA_FICHE} ${v.annee}`}
        reperes={
          <>
            <Repere label="N+1" valeur={nomDuN1}>
              {n1?.poste}
            </Repere>
            <Repere label="Reçue le" valeur={v.transmiseLe ? dateEnLettres(v.transmiseLe) : null} />
            <Repere label="Objectifs" valeur={String(v.objectifs.length)} />
            {v.etat === 'renvoyee' ? (
              <Repere
                label="Renvoyée le"
                valeur={v.renvoyeeLe ? dateEnLettres(v.renvoyeeLe) : null}
              />
            ) : (
              <Repere label="Validée le" valeur={v.valideeLe ? dateEnLettres(v.valideeLe) : null} />
            )}
          </>
        }
      />

      {v.etat === 'en_attente' ? (
        <Card>
          <EmptyState
            className="py-12"
            icon={<Icon name="checklist" size={22} />}
            title="Votre N+1 n’a pas encore transmis votre évaluation"
          />
        </Card>
      ) : v.etat === 'renvoyee' && v.renvoi ? (
        <MotDeRenvoi
          titre={nomDuN1 ? `Renvoyée à ${nomDuN1}` : 'Renvoyée à votre N+1'}
          renvoi={v.renvoi}
        />
      ) : v.evaluation ? (
        <>
          <FicheDuN1
            annee={v.annee}
            objectifs={v.objectifs}
            personnel={v.personnel}
            auto={v.auto}
            evaluation={v.evaluation}
            reservee={null}
          />
          {v.validable ? (
            <div className="sticky bottom-4 z-20">
              <Card className="flex flex-col gap-3 px-5 py-3.5 shadow-[0_10px_30px_-12px_rgb(0_40_90/0.3)] sm:flex-row sm:items-center sm:gap-5">
                {/* La mention de la fiche, mot pour mot. */}
                <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-ink-muted">
                  La fiche n’est valable qu’une fois validée par l’agent.
                </p>
                <div className="flex shrink-0 flex-col-reverse gap-2 sm:flex-row">
                  {v.renvoyable ? (
                    <Button
                      variant="secondary"
                      className="h-9 px-4"
                      onClick={() => setGeste('renvoyer')}
                    >
                      <Icon name="replay" size={15} />
                      Renvoyer à mon N+1
                    </Button>
                  ) : null}
                  <Button className="h-9 px-5" onClick={() => setGeste('valider')}>
                    <Icon name="task_alt" size={15} />
                    Valider mon évaluation
                  </Button>
                </div>
              </Card>
            </div>
          ) : null}
        </>
      ) : null}

      {geste === 'valider' ? (
        <Confirmation
          titre="Valider votre évaluation ?"
          libelle="Valider"
          enCours={valider.isPending}
          erreur={valider.error ? messageDe(valider.error) : null}
          onConfirmer={() => valider.mutate()}
          onClose={fermer}
        >
          Elle devient définitive : elle ne pourra plus être modifiée ni renvoyée.
        </Confirmation>
      ) : null}
      {geste === 'renvoyer' ? (
        <Confirmation
          titre="Renvoyer à votre N+1 ?"
          libelle="Renvoyer"
          enCours={renvoyer.isPending}
          erreur={renvoyer.error ? messageDe(renvoyer.error) : null}
          desactive={!mot.trim()}
          onConfirmer={() => renvoyer.mutate()}
          onClose={fermer}
        >
          <p>
            L’évaluation repart chez{' '}
            {nomDuN1 ? (
              <span className="font-semibold text-ink-strong">{nomDuN1}</span>
            ) : (
              'votre N+1'
            )}
            , qui pourra la reprendre avant de vous la transmettre de nouveau.
          </p>
          <Field label="Votre message" htmlFor={idDuMot} required className="mt-4">
            <ZoneDeTexte
              id={idDuMot}
              max={LONGUEURS_DE_LA_FICHE.texte}
              value={mot}
              onChange={(e) => setMot(e.target.value)}
              autoFocus
            />
          </Field>
        </Confirmation>
      ) : null}
    </div>
  );
}
