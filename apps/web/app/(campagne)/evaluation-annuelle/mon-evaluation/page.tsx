'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dateEnLettres, TITRE_DE_LA_FICHE, type MonEvaluation } from '@teranga/contracts';
import { Button, Card, EmptyState, Skeleton } from '@teranga/ui';
import { FicheDuN1 } from '../../../../components/campagne/evaluation-du-n1';
import {
  EvaluationValidee,
  RetourALAccueil,
  superieurHierarchique,
} from '../../../../components/campagne/fiche';
import { Repere } from '../../../../components/fiche';
import { BandeauDePage } from '../../../../components/campagne/charte';
import { Confirmation, messageDe } from '../../../../components/grille-evaluation';
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
   « Valider mon évaluation », le seul geste de l'agent : le renvoi au N+1
   n'existe plus (ADR-0267). Validée, la fiche se lit et ne change plus.
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
        <Skeleton className="h-[212px] w-full rounded-barre" />
        <Skeleton className="mt-5 h-72 w-full rounded-bloc" />
      </div>
    );
  }
  // Validée, la page repart de zéro.
  return <Evaluation key={requete.data.etat} vue={requete.data} />;
}

function Evaluation({ vue: v }: { vue: MonEvaluation }) {
  const qc = useQueryClient();
  const [aConfirmer, setAConfirmer] = useState(false);
  const n1 = v.evaluateur;
  const nomDuN1 = n1 ? `${n1.prenom} ${n1.nom}` : null;

  const valider = useMutation({
    mutationFn: () => api<MonEvaluation>(`${CHEMIN}/validation`, { method: 'POST' }),
    onSuccess: async (nouvelle) => {
      qc.setQueryData(CLE, nouvelle);
      await qc.invalidateQueries({ queryKey: CLE_CAMPAGNE, exact: true });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
  });
  const fermer = () => {
    setAConfirmer(false);
    valider.reset();
  };

  return (
    <div className="flex flex-col gap-4">
      <RetourALAccueil libelle="Accueil" />
      <BandeauDePage
        icone="task_alt"
        titre="Mon évaluation"
        marque={v.etat === 'validee' ? <EvaluationValidee le={v.valideeLe} /> : null}
        sousTitre={`${TITRE_DE_LA_FICHE} ${v.annee}`}
        reperes={[
          <Repere key="n1" label={superieurHierarchique(n1)} valeur={nomDuN1} />,
          <Repere
            key="recue"
            label="Reçue le"
            valeur={v.transmiseLe ? dateEnLettres(v.transmiseLe) : null}
          />,
          <Repere key="objectifs" label="Objectifs" valeur={String(v.objectifs.length)} />,
          <Repere
            key="validee"
            label="Validée le"
            valeur={v.valideeLe ? dateEnLettres(v.valideeLe) : null}
          />,
        ]}
      />

      {v.etat === 'en_attente' ? (
        <Card>
          <EmptyState
            className="py-12"
            icon={<Icon name="checklist" size={22} />}
            title="Votre N+1 n’a pas encore transmis votre évaluation"
          />
        </Card>
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
                <Button className="h-9 shrink-0 px-5" onClick={() => setAConfirmer(true)}>
                  <Icon name="task_alt" size={15} />
                  Valider mon évaluation
                </Button>
              </Card>
            </div>
          ) : null}
        </>
      ) : null}

      {aConfirmer ? (
        <Confirmation
          titre="Valider votre évaluation ?"
          libelle="Valider"
          enCours={valider.isPending}
          erreur={valider.error ? messageDe(valider.error) : null}
          onConfirmer={() => valider.mutate()}
          onClose={fermer}
        >
          Elle devient définitive : elle ne pourra plus être modifiée.
        </Confirmation>
      ) : null}
    </div>
  );
}
