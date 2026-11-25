'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { nomDeLaFiche, personnelDeLaFiche, type FichePourLaDCH } from '@teranga/contracts';
import { Card, EmptyState, Skeleton } from '@teranga/ui';
import {
  CommentairesDuN2Lus,
  FicheDuN1,
} from '../../../../../components/campagne/evaluation-du-n1';
import {
  CarteDEtape,
  Etapes,
  jourCourt,
  RetourALAccueil,
} from '../../../../../components/campagne/fiche';
import { BandeauDeLAgent } from '../../../../../components/campagne/charte';
import { TelechargerLaFiche } from '../../../../../components/campagne/telecharger';
import { Icon } from '../../../../../components/icons';
import { api, ApiError } from '../../../../../lib/api';
import { CLE_CAMPAGNE, SUIVI_DE_LA_DCH } from '../../../../../lib/campagne';

/* ────────────────────────────────────────────────────────────────
   La fiche d'un agent, transmise à la DCH (ADR-0221) : sa fiche, comme
   sur l'accueil, avec à droite le PDF de la fiche complète ; ses étapes,
   chacune avec son jour, de l'auto-évaluation à la transmission ; puis la
   fiche S1/EN05 entière, en lecture, partie réservée comprise et
   commentaires du N+2. La page demande l'habilitation « Tableau de bord ».
   ──────────────────────────────────────────────────────────────── */

export default function FicheDeLaDCHPage() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const vue = useQuery({
    queryKey: [...CLE_CAMPAGNE, 'dch', employeeId],
    queryFn: () => api<FichePourLaDCH>(`/campagne/dch/${employeeId}`),
    retry: false,
  });
  const v = vue.data;

  return (
    <div className="flex flex-col gap-4">
      <RetourALAccueil libelle="Suivi des évaluations" href={SUIVI_DE_LA_DCH} />
      {vue.error ? (
        <Card>
          <EmptyState
            className="py-12"
            icon={<Icon name="folder_managed" size={22} />}
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
        <Fiche vue={v} />
      )}
    </div>
  );
}

function Fiche({ vue: v }: { vue: FichePourLaDCH }) {
  const n1 = v.agent.evaluateur;
  const recus = v.commentairesDuN2;
  const etape = (titre: string, etat: string, qui: string) => (
    <CarteDEtape titre={titre} etat={etat} periode={qui} />
  );
  const le = (iso: string | null) => (iso ? ` le ${jourCourt(iso)}` : '');
  const nom = (p: { prenom: string; nom: string } | null) => (p ? `${p.prenom} ${p.nom}` : '');

  return (
    <>
      <BandeauDeLAgent
        agent={v.agent}
        action={
          // La fiche complète, partie réservée comprise, pour le dossier de l'agent.
          <TelechargerLaFiche
            chemin={`/campagne/dch/${v.agent.employeeId}/pdf`}
            nom={nomDeLaFiche(v.annee, v.agent.matricule, true)}
            libelle="Télécharger"
          />
        }
      />
      {/* Les étapes, chacune avec son jour : qui l'a franchie, et quand. */}
      <Etapes nombre={v.n2 ? 4 : 3}>
        {etape('Auto-évaluation', `Faite${le(v.autoTransmiseLe)}`, nom(v.agent))}
        {etape('Évaluation par le N+1', `Validée${le(v.valideeLe)}`, nom(n1))}
        {/* Transmise à la DCH, une fiche envoyée au N+2 en revient commentée,
            ou reprise ; sinon, elle n'a pas été envoyée au N+2 (ADR-0278). */}
        {v.n2
          ? recus
            ? etape('Commentaires du N+2', `Reçus${le(recus.le)}`, nom(recus.par ?? v.n2))
            : v.repriseAuN2Le
              ? etape('Commentaires du N+2', `Fiche reprise${le(v.repriseAuN2Le)}`, nom(v.n2))
              : etape('Commentaires du N+2', 'Fiche non envoyée', nom(v.n2))
          : null}
        {etape(
          'Transmission à la DCH',
          `Transmise${le(v.transmiseLe)}`,
          v.transmisePar ? `Par ${nom(v.transmisePar)}` : 'Direction du Capital Humain',
        )}
      </Etapes>
      <FicheDuN1
        annee={v.annee}
        objectifs={v.objectifs}
        personnel={personnelDeLaFiche(v.agent.personnel)}
        auto={v.fiche.auto}
        evaluation={v.fiche.evaluation}
        reservee={v.fiche.reservee}
        commentairesDuN2={
          recus ? (
            <CommentairesDuN2Lus texte={recus.texte} par={recus.par} le={recus.le} />
          ) : undefined
        }
      />
    </>
  );
}
