'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ceQuiManqueALEvaluationDuN1,
  personnelDeLaFiche,
  type AutoEvaluation,
  type EcritureDeLEvaluation,
  type EvaluationDeLAgent,
} from '@teranga/contracts';
import { Badge, Card, EmptyState, Skeleton } from '@teranga/ui';
import {
  BarreDeTransmission,
  useEnregistrementAuto,
} from '../../../../../components/campagne/enregistrement';
import {
  CommentairesDuN2Lus,
  FicheDuN1,
} from '../../../../../components/campagne/evaluation-du-n1';
import {
  CarteDEtape,
  Etapes,
  IdentiteDeLaCampagne,
  MotDeRenvoi,
  periodeDeLAuto,
  periodeDeLEvaluation,
  RetourALAccueil,
  statutDeLAgent,
  statutDeMonEvaluation,
  statutDesCommentaires,
} from '../../../../../components/campagne/fiche';
import { Confirmation, messageDe } from '../../../../../components/grille-evaluation';
import { Icon } from '../../../../../components/icons';
import { api, ApiError } from '../../../../../lib/api';
import { CLE_CAMPAGNE } from '../../../../../lib/campagne';

/* ────────────────────────────────────────────────────────────────
   Un agent de l'équipe, ouvert depuis sa carte (ADR-0211) : sa fiche,
   comme sur l'accueil ; ses deux étapes, l'auto-évaluation et l'évaluation
   du N+1, côte à côte sur un grand écran ; puis, l'auto-évaluation
   transmise, la fiche S1/EN05 entière, que le N+1 remplit (ADR-0216).
   Chaque modification s'enregistre seule ; la barre collée au bas de
   l'écran dit ce qui manque et porte « Transmettre à l'agent ».
   Transmise, l'évaluation se lit ; l'agent la valide, ou la renvoie avec un
   mot, qui s'affiche alors au-dessus de la fiche, de nouveau à remplir
   (ADR-0217). Validée, la fiche passe au N+2 s'il y en a un : une troisième
   étape le dit, et ses commentaires ferment la partie réservée une fois
   transmis (ADR-0218). Cette page ne s'ouvre qu'à l'évaluateur de l'agent.
   ──────────────────────────────────────────────────────────────── */

export default function AgentDeLEquipePage() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const vue = useQuery({
    queryKey: [...CLE_CAMPAGNE, 'equipe', employeeId],
    queryFn: () => api<EvaluationDeLAgent>(`/campagne/equipe/${employeeId}`),
    retry: false,
    // La saisie garde son propre état : relire la fiche au retour sur
    // l'onglet n'apporterait rien.
    refetchOnWindowFocus: false,
  });
  const v = vue.data;

  return (
    <div className="flex flex-col gap-4">
      <RetourALAccueil libelle="Mon équipe" />
      {vue.error ? (
        <Card>
          <EmptyState
            className="py-12"
            icon={<Icon name="groups" size={22} />}
            title={
              vue.error instanceof ApiError
                ? vue.error.problem.title
                : 'Impossible d’afficher la fiche de cet agent'
            }
          />
        </Card>
      ) : !v ? (
        <>
          <Skeleton className="mb-4 h-[158px] w-full rounded-bloc" />
          <Skeleton className="h-[86px] w-full rounded-bloc" />
        </>
      ) : (
        // Transmise, la fiche repart de zéro, en lecture.
        <Agent key={v.etatDeLEvaluation} vue={v} />
      )}
    </div>
  );
}

function Agent({ vue: v }: { vue: EvaluationDeLAgent }) {
  const auto = v.agent.auto ? statutDeLAgent(v.agent.auto) : null;
  const evaluation = statutDeMonEvaluation(v);
  const commentaires = statutDesCommentaires(
    v.etatDesCommentaires,
    v.commentairesDuN2?.le ?? null,
    'n1',
  );
  const n2 = v.commentairesDuN2;
  const carteDeLAuto = auto ? (
    <CarteDEtape
      icone="rate_review"
      titre="Auto-évaluation"
      marque={<Badge tone={auto.ton}>{auto.libelle}</Badge>}
      periode={periodeDeLAuto(v.periode)}
    />
  ) : null;
  return (
    <>
      <IdentiteDeLaCampagne agent={v.agent} />
      {v.autoEvaluation ? (
        <>
          {/* Les étapes côte à côte : l'auto-évaluation faite, celle du N+1, puis le N+2. */}
          <Etapes nombre={v.n2 ? 3 : 2}>
            {carteDeLAuto}
            <CarteDEtape
              icone="checklist"
              titre="Évaluation du N+1"
              marque={evaluation ? <Badge tone={evaluation.ton}>{evaluation.libelle}</Badge> : null}
              periode={periodeDeLEvaluation(v.periode)}
            />
            {v.n2 ? (
              <CarteDEtape
                icone="how_to_reg"
                titre="Commentaires du N+2"
                marque={
                  commentaires ? (
                    <Badge tone={commentaires.ton}>{commentaires.libelle}</Badge>
                  ) : null
                }
                periode={`${v.n2.prenom} ${v.n2.nom}`}
              />
            ) : null}
          </Etapes>
          {v.renvoi ? (
            <MotDeRenvoi
              titre={`Renvoyée par ${v.agent.prenom} ${v.agent.nom}`}
              renvoi={v.renvoi}
            />
          ) : null}
          {v.modifiable ? (
            <Saisie vue={v} auto={v.autoEvaluation} />
          ) : (
            <FicheDuN1
              annee={v.annee}
              objectifs={v.objectifs}
              personnel={personnelDeLaFiche(v.agent.personnel)}
              auto={v.autoEvaluation}
              evaluation={v.evaluation}
              reservee={v.reservee}
              commentairesDuN2={
                n2 ? <CommentairesDuN2Lus texte={n2.texte} par={n2.par} le={n2.le} /> : undefined
              }
            />
          )}
        </>
      ) : (
        carteDeLAuto
      )}
    </>
  );
}

/** Le corps d'un envoi : l'évaluation et la partie réservée, telles qu'elles sont écrites. */
const corpsDeLEvaluation = (e: EcritureDeLEvaluation) => e;

/** L'évaluation à remplir, qui s'enregistre seule, puis se transmet à l'agent. */
function Saisie({ vue: v, auto }: { vue: EvaluationDeLAgent; auto: AutoEvaluation }) {
  const qc = useQueryClient();
  const chemin = `/campagne/equipe/${v.agent.employeeId}/evaluation`;
  const { valeur, etat, changer, vider, contenu } = useEnregistrementAuto(
    chemin,
    { evaluation: v.evaluation, reservee: v.reservee },
    corpsDeLEvaluation,
  );
  const [confirmer, setConfirmer] = useState(false);
  const personnel = personnelDeLaFiche(v.agent.personnel);
  const manque = ceQuiManqueALEvaluationDuN1(
    valeur.evaluation,
    valeur.reservee,
    v.objectifs,
    personnel,
  );

  const transmettre = useMutation({
    mutationFn: async () => {
      await vider();
      return api<EvaluationDeLAgent>(`${chemin}/transmission`, {
        method: 'POST',
        body: contenu(),
      });
    },
    onSuccess: async (vue) => {
      qc.setQueryData([...CLE_CAMPAGNE, 'equipe', v.agent.employeeId], vue);
      await qc.invalidateQueries({ queryKey: CLE_CAMPAGNE, exact: true });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
  });

  return (
    <>
      <FicheDuN1
        annee={v.annee}
        objectifs={v.objectifs}
        personnel={personnel}
        auto={auto}
        evaluation={valeur.evaluation}
        reservee={valeur.reservee}
        onChange={changer}
      />
      <BarreDeTransmission
        etat={etat}
        manque={manque}
        libelle="Transmettre à l’agent"
        enCours={transmettre.isPending}
        onTransmettre={() => setConfirmer(true)}
      />
      {confirmer ? (
        <Confirmation
          titre="Transmettre l’évaluation ?"
          libelle="Transmettre"
          enCours={transmettre.isPending}
          erreur={transmettre.error ? messageDe(transmettre.error) : null}
          onConfirmer={() => transmettre.mutate()}
          onClose={() => {
            setConfirmer(false);
            transmettre.reset();
          }}
        >
          Elle part à{' '}
          <span className="font-semibold text-ink-strong">
            {v.agent.prenom} {v.agent.nom}
          </span>
          , sans la partie réservée à la hiérarchie. Elle ne pourra plus être modifiée, sauf si
          l’agent vous la renvoie.
        </Confirmation>
      ) : null}
    </>
  );
}
