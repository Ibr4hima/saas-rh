'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  dateEnLettres,
  LONGUEURS_DE_LA_FICHE,
  personnelDeLaFiche,
  type FicheComplete,
  type FichePourLeN2,
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
  periodeDeLAuto,
  RetourALAccueil,
  statutDeLAgent,
  statutDeMonEvaluation,
  statutDesCommentaires,
} from '../../../../../components/campagne/fiche';
import { BandeauDeLAgent } from '../../../../../components/campagne/charte';
import { Confirmation, messageDe, ZoneDeTexte } from '../../../../../components/grille-evaluation';
import { Icon } from '../../../../../components/icons';
import { api, ApiError } from '../../../../../lib/api';
import { CLE_CAMPAGNE } from '../../../../../lib/campagne';

/* ────────────────────────────────────────────────────────────────
   La fiche d'un agent, ouverte par son N+2 depuis l'accueil (ADR-0218) :
   l'en-tête de l'agent, ses trois étapes, puis, une fois la fiche validée
   par l'agent, la fiche S1/EN05 entière, en lecture, partie réservée
   comprise. Les commentaires du N+2 ferment la partie réservée : ils
   s'enregistrent seuls, et la barre collée au bas de l'écran porte
   « Transmettre au N+1 », avec ou sans un mot. Transmis, ils se lisent et
   ne changent plus. Cette page ne s'ouvre qu'au N+2 de l'agent.
   ──────────────────────────────────────────────────────────────── */

const cleDe = (employeeId: string) => [...CLE_CAMPAGNE, 'n2', employeeId];

export default function FicheDuN2Page() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const vue = useQuery({
    queryKey: cleDe(employeeId),
    queryFn: () => api<FichePourLeN2>(`/campagne/n2/${employeeId}`),
    retry: false,
    // La saisie garde son propre état : relire la fiche au retour sur
    // l'onglet n'apporterait rien.
    refetchOnWindowFocus: false,
  });
  const v = vue.data;

  return (
    <div className="flex flex-col gap-4">
      <RetourALAccueil libelle="Accueil" />
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
        // Transmis, les commentaires repartent de zéro, en lecture.
        <Fiche key={v.etat === 'transmis' ? 'transmis' : 'saisie'} vue={v} />
      )}
    </div>
  );
}

function Fiche({ vue: v }: { vue: FichePourLeN2 }) {
  const auto = v.agent.auto ? statutDeLAgent(v.agent.auto) : null;
  const evaluation = v.valideeLe
    ? statutDeMonEvaluation({
        etatDeLEvaluation: 'validee',
        evaluationTransmiseLe: v.evaluationTransmiseLe,
        valideeLe: v.valideeLe,
        renvoi: null,
      })
    : null;
  const commentaires = statutDesCommentaires(v.etat, v.transmisLe, 'n2');
  return (
    <>
      <BandeauDeLAgent agent={v.agent} />
      <Etapes nombre={3}>
        <CarteDEtape
          titre="Auto-évaluation"
          marque={auto ? <Badge tone={auto.ton}>{auto.libelle}</Badge> : null}
          periode={periodeDeLAuto(v.periode)}
        />
        <CarteDEtape
          titre="Évaluation du N+1"
          marque={evaluation ? <Badge tone={evaluation.ton}>{evaluation.libelle}</Badge> : null}
          periode={
            v.agent.evaluateur
              ? `${v.agent.evaluateur.prenom} ${v.agent.evaluateur.nom}`
              : 'Sans N+1'
          }
        />
        <CarteDEtape
          titre="Commentaires du N+2"
          marque={
            commentaires ? <Badge tone={commentaires.ton}>{commentaires.libelle}</Badge> : null
          }
          periode={
            v.valideeLe
              ? `Fiche reçue le ${dateEnLettres(v.valideeLe)}`
              : 'Après la validation de l’agent'
          }
        />
      </Etapes>
      {!v.fiche ? (
        <Card>
          <EmptyState
            className="py-12"
            icon={<Icon name="how_to_reg" size={22} />}
            title="La fiche n’est pas encore validée par l’agent"
          />
        </Card>
      ) : v.modifiable ? (
        <Saisie vue={v} fiche={v.fiche} />
      ) : (
        <FicheDuN1
          annee={v.annee}
          objectifs={v.objectifs}
          personnel={personnelDeLaFiche(v.agent.personnel)}
          auto={v.fiche.auto}
          evaluation={v.fiche.evaluation}
          reservee={v.fiche.reservee}
          commentairesDuN2={<CommentairesDuN2Lus texte={v.commentaires} />}
        />
      )}
    </>
  );
}

/** Le corps d'un envoi : les commentaires, tels qu'ils sont écrits. */
const corpsDesCommentaires = (commentaires: string) => ({ commentaires });

/** Les commentaires à écrire, qui s'enregistrent seuls, puis se transmettent au N+1. */
function Saisie({ vue: v, fiche }: { vue: FichePourLeN2; fiche: FicheComplete }) {
  const qc = useQueryClient();
  const chemin = `/campagne/n2/${v.agent.employeeId}/commentaires`;
  const { valeur, etat, changer, vider, contenu } = useEnregistrementAuto(
    chemin,
    v.commentaires,
    corpsDesCommentaires,
  );
  const [confirmer, setConfirmer] = useState(false);
  const sansCommentaire = !valeur.trim();

  const transmettre = useMutation({
    mutationFn: async () => {
      await vider();
      return api<FichePourLeN2>(`${chemin}/transmission`, {
        method: 'POST',
        body: corpsDesCommentaires(contenu()),
      });
    },
    onSuccess: async (vue) => {
      qc.setQueryData(cleDe(v.agent.employeeId), vue);
      await qc.invalidateQueries({ queryKey: CLE_CAMPAGNE, exact: true });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
  });

  return (
    <>
      <FicheDuN1
        annee={v.annee}
        objectifs={v.objectifs}
        personnel={personnelDeLaFiche(v.agent.personnel)}
        auto={fiche.auto}
        evaluation={fiche.evaluation}
        reservee={fiche.reservee}
        commentairesDuN2={
          <ZoneDeTexte
            aria-label="Commentaires du N+2"
            max={LONGUEURS_DE_LA_FICHE.texte}
            value={valeur}
            onChange={(ev) => {
              const texte = ev.target.value;
              changer(() => texte);
            }}
          />
        }
      />
      <BarreDeTransmission
        etat={etat}
        manque={[]}
        libelle="Transmettre au N+1"
        enCours={transmettre.isPending}
        onTransmettre={() => setConfirmer(true)}
      />
      {confirmer ? (
        <Confirmation
          titre={
            sansCommentaire ? 'Transmettre sans commentaire ?' : 'Transmettre vos commentaires ?'
          }
          libelle="Transmettre"
          enCours={transmettre.isPending}
          erreur={transmettre.error ? messageDe(transmettre.error) : null}
          onConfirmer={() => transmettre.mutate()}
          onClose={() => {
            setConfirmer(false);
            transmettre.reset();
          }}
        >
          {/* Les textes de la plateforme de base (ADR-0154). */}
          {sansCommentaire
            ? 'La fiche sera renvoyée au N+1 sans commentaire de votre part. Vous ne pourrez plus la commenter.'
            : 'Vos commentaires seront transmis au N+1. Vous ne pourrez plus les modifier.'}
        </Confirmation>
      ) : null}
    </>
  );
}
