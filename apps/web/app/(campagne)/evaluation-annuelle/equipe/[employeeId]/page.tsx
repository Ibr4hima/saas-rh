'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ceQuiManqueALEvaluationDuN1,
  dateEnLettres,
  personnelDeLaFiche,
  type AutoEvaluation,
  type EcritureDeLEvaluation,
  type EvaluationDeLAgent,
} from '@teranga/contracts';
import { Badge, Button, Card, EmptyState, Skeleton } from '@teranga/ui';
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
  jourCourt,
  MotDeRenvoi,
  periodeDeLAuto,
  periodeDeLEvaluation,
  RetourALAccueil,
  statutDeLAgent,
  statutDeMonEvaluation,
  statutDesCommentaires,
  type Statut,
} from '../../../../../components/campagne/fiche';
import { BandeauDeLAgent } from '../../../../../components/campagne/charte';
import { Confirmation, messageDe } from '../../../../../components/grille-evaluation';
import { Icon } from '../../../../../components/icons';
import { api, ApiError } from '../../../../../lib/api';
import { CLE_CAMPAGNE } from '../../../../../lib/campagne';

/* ────────────────────────────────────────────────────────────────
   Un agent de l'équipe, ouvert depuis sa carte (ADR-0211) : sa fiche,
   comme sur l'accueil ; ses deux étapes, l'auto-évaluation et l'évaluation
   du N+1, côte à côte sur un grand écran ; puis, l'auto-évaluation
   transmise, la fiche S1/EN05 entière, que le N+1 remplit (ADR-0216).
   Chaque modification s'enregistre seule ; la barre au bas de la page dit
   ce qui manque et porte « Transmettre à l'agent » (ADR-0241).
   Transmise, l'évaluation se lit ; l'agent la valide, ou la renvoie avec un
   mot, qui s'affiche alors au-dessus de la fiche, de nouveau à remplir
   (ADR-0217). Validée, la fiche passe au N+2 s'il y en a un : une troisième
   étape le dit, et ses commentaires ferment la partie réservée une fois
   transmis (ADR-0218). La dernière étape est la transmission à la DCH : la
   barre du bas porte « Transmettre à la DCH » une fois la fiche revenue du
   N+2, ou dès la validation sans N+2, et « Reprendre au N+2 » tant que le
   N+2 la garde (ADR-0221). Cette page ne s'ouvre qu'à l'évaluateur de
   l'agent.
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
    v.commentairesDuN2?.le ?? v.repriseAuN2Le,
    'n1',
  );
  const dch = statutDeLaTransmission(v);
  const n2 = v.commentairesDuN2;
  const carteDeLAuto = auto ? (
    <CarteDEtape
      titre="Auto-évaluation"
      marque={<Badge tone={auto.ton}>{auto.libelle}</Badge>}
      periode={periodeDeLAuto(v.periode)}
    />
  ) : null;
  return (
    <>
      <BandeauDeLAgent agent={v.agent} />
      {v.autoEvaluation ? (
        <>
          {/* Les étapes côte à côte : l'auto-évaluation faite, celle du N+1, le N+2, la DCH. */}
          <Etapes nombre={v.n2 ? 4 : 3}>
            {carteDeLAuto}
            <CarteDEtape
              titre="Évaluation du N+1"
              marque={evaluation ? <Badge tone={evaluation.ton}>{evaluation.libelle}</Badge> : null}
              periode={periodeDeLEvaluation(v.periode)}
            />
            {v.n2 ? (
              <CarteDEtape
                titre="Commentaires du N+2"
                marque={
                  commentaires ? (
                    <Badge tone={commentaires.ton}>{commentaires.libelle}</Badge>
                  ) : null
                }
                periode={`${v.n2.prenom} ${v.n2.nom}`}
              />
            ) : null}
            <CarteDEtape
              titre="Transmission à la DCH"
              marque={dch ? <Badge tone={dch.ton}>{dch.libelle}</Badge> : null}
              periode="Direction du Capital Humain"
            />
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
            <>
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
              <VersLaDCH vue={v} />
            </>
          )}
        </>
      ) : (
        // Sans auto-évaluation transmise, la première étape seule.
        <Etapes nombre={1}>{carteDeLAuto}</Etapes>
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

/** La transmission à la DCH, sur sa carte : à faire en orange, faite en vert ; rien avant. */
function statutDeLaTransmission(v: EvaluationDeLAgent): Statut | null {
  if (v.dch === 'transmise') {
    return {
      libelle: v.transmiseALaDCHLe ? `Transmise le ${jourCourt(v.transmiseALaDCHLe)}` : 'Transmise',
      ton: 'vert',
    };
  }
  return v.dch === 'a_transmettre' ? { libelle: 'À transmettre', ton: 'orange' } : null;
}

type GesteVersLaDCH = 'dch' | 'reprise-n2' | 'renvoi-n2';

/**
 * La fiche validée par l'agent, vers la DCH (ADR-0221). Revenue du N+2, ou
 * sans N+2, le N+1 la transmet. Chez le N+2, le N+1 la reprend s'il le
 * faut ; reprise, elle repart au N+2 ou à la DCH. À gauche, la dernière
 * étape franchie, avec son jour.
 */
function VersLaDCH({ vue: v }: { vue: EvaluationDeLAgent }) {
  const qc = useQueryClient();
  const [confirmer, setConfirmer] = useState<'dch' | 'reprise-n2' | null>(null);
  const geste = useMutation({
    mutationFn: (route: GesteVersLaDCH) =>
      api<EvaluationDeLAgent>(`/campagne/equipe/${v.agent.employeeId}/${route}`, {
        method: 'POST',
      }),
    onSuccess: async (vue) => {
      setConfirmer(null);
      qc.setQueryData([...CLE_CAMPAGNE, 'equipe', v.agent.employeeId], vue);
      await qc.invalidateQueries({ queryKey: CLE_CAMPAGNE, exact: true });
    },
  });
  const chezLeN2 =
    v.dch === 'en_attente' &&
    (v.etatDesCommentaires === 'a_commenter' || v.etatDesCommentaires === 'en_cours');
  if (v.dch !== 'a_transmettre' && !chezLeN2) return null;

  const agent = `${v.agent.prenom} ${v.agent.nom}`;
  const n2 = v.n2 ? `${v.n2.prenom} ${v.n2.nom}` : null;
  const recus = v.commentairesDuN2;
  const etape = chezLeN2
    ? `Chez le N+2, ${n2}, depuis le ${v.valideeLe ? dateEnLettres(v.valideeLe) : ''}`
    : recus
      ? `Commentaires du N+2 reçus le ${dateEnLettres(recus.le)}`
      : v.repriseAuN2Le
        ? `Reprise au N+2 le ${dateEnLettres(v.repriseAuN2Le)}`
        : v.valideeLe
          ? `Validée par ${agent} le ${dateEnLettres(v.valideeLe)}`
          : null;
  const enCours = (route: GesteVersLaDCH) => geste.isPending && geste.variables === route;
  const fermer = () => {
    setConfirmer(null);
    geste.reset();
  };

  return (
    <>
      <div className="sticky bottom-4 z-20">
        <Card className="flex flex-col gap-3 px-5 py-3.5 shadow-[0_10px_30px_-12px_rgb(0_40_90/0.3)] sm:flex-row sm:items-center sm:gap-5">
          <div className="min-w-0 flex-1">
            <p className="text-[12px] leading-relaxed text-ink-muted">{etape}</p>
            {geste.error && !confirmer ? (
              <p role="alert" className="mt-1 text-[12px] text-danger">
                {messageDe(geste.error)}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col-reverse gap-2 sm:flex-row">
            {chezLeN2 ? (
              <Button
                variant="secondary"
                className="h-9 px-4"
                onClick={() => setConfirmer('reprise-n2')}
              >
                <Icon name="replay" size={15} />
                Reprendre au N+2
              </Button>
            ) : null}
            {v.dch === 'a_transmettre' && v.etatDesCommentaires === 'reprise' ? (
              <Button
                variant="secondary"
                className="h-9 px-4"
                loading={enCours('renvoi-n2')}
                onClick={() => geste.mutate('renvoi-n2')}
              >
                <Icon name="arrow_forward" size={15} />
                Renvoyer au N+2
              </Button>
            ) : null}
            {v.dch === 'a_transmettre' ? (
              <Button className="h-9 px-5" onClick={() => setConfirmer('dch')}>
                <Icon name="task_alt" size={15} />
                Transmettre à la DCH
              </Button>
            ) : null}
          </div>
        </Card>
      </div>
      {confirmer === 'dch' ? (
        <Confirmation
          titre="Transmettre la fiche à la DCH ?"
          libelle="Transmettre"
          enCours={enCours('dch')}
          erreur={geste.error ? messageDe(geste.error) : null}
          onConfirmer={() => geste.mutate('dch')}
          onClose={fermer}
        >
          La fiche d’évaluation {v.annee} de{' '}
          <span className="font-semibold text-ink-strong">{agent}</span> sera transmise à la DCH.
          Elle ne pourra plus être modifiée.
        </Confirmation>
      ) : null}
      {confirmer === 'reprise-n2' ? (
        <Confirmation
          titre="Reprendre la fiche au N+2 ?"
          libelle="Reprendre"
          enCours={enCours('reprise-n2')}
          erreur={geste.error ? messageDe(geste.error) : null}
          onConfirmer={() => geste.mutate('reprise-n2')}
          onClose={fermer}
        >
          {n2 ? <span className="font-semibold text-ink-strong">{n2}</span> : 'Le N+2'} ne pourra
          plus la commenter. Vous pourrez ensuite la transmettre à la DCH.
        </Confirmation>
      ) : null}
    </>
  );
}
