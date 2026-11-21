'use client';

import { useParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { nomDeLaFiche, personnelDeLaFiche, type FichePourLaDCH } from '@teranga/contracts';
import { Badge, Button, Card, EmptyState, Skeleton, type BadgeTone } from '@teranga/ui';
import {
  CommentairesDuN2Lus,
  FicheDuN1,
} from '../../../../../components/campagne/evaluation-du-n1';
import {
  BOUTON_DU_BANDEAU,
  CarteDEtape,
  Etapes,
  jourCourt,
  RetourALAccueil,
} from '../../../../../components/campagne/fiche';
import { BandeauDeLAgent } from '../../../../../components/campagne/charte';
import { messageDe } from '../../../../../components/grille-evaluation';
import { Icon } from '../../../../../components/icons';
import { api, ApiError } from '../../../../../lib/api';
import { CLE_CAMPAGNE, SUIVI_DE_LA_DCH } from '../../../../../lib/campagne';
import { enregistrerFichier, lireFichier } from '../../../../../lib/fichiers';

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
      <RetourALAccueil libelle="Suivi de la DCH" href={SUIVI_DE_LA_DCH} />
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
  const etape = (titre: string, libelle: string, ton: BadgeTone, qui: string) => (
    <CarteDEtape titre={titre} marque={<Badge tone={ton}>{libelle}</Badge>} periode={qui} />
  );
  const le = (iso: string | null) => (iso ? ` le ${jourCourt(iso)}` : '');
  const nom = (p: { prenom: string; nom: string } | null) => (p ? `${p.prenom} ${p.nom}` : '');

  return (
    <>
      <BandeauDeLAgent agent={v.agent} action={<TelechargerLePdf vue={v} />} />
      {/* Les étapes, chacune avec son jour : qui l'a franchie, et quand. */}
      <Etapes nombre={v.n2 ? 4 : 3}>
        {etape('Auto-évaluation', `Faite${le(v.autoTransmiseLe)}`, 'vert', nom(v.agent))}
        {etape('Évaluation du N+1', `Validée${le(v.valideeLe)}`, 'vert', nom(n1))}
        {v.n2
          ? recus
            ? etape('Commentaires du N+2', `Reçus${le(recus.le)}`, 'vert', nom(recus.par ?? v.n2))
            : etape('Commentaires du N+2', `Fiche reprise${le(v.repriseAuN2Le)}`, 'gris', nom(v.n2))
          : null}
        {etape(
          'Transmission à la DCH',
          `Transmise${le(v.transmiseLe)}`,
          'vert',
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

/** Le PDF de la fiche complète, partie réservée comprise, pour le dossier de l'agent. */
function TelechargerLePdf({ vue: v }: { vue: FichePourLaDCH }) {
  const pdf = useMutation({
    mutationFn: () => lireFichier(`/campagne/dch/${v.agent.employeeId}/pdf`),
    onSuccess: (contenu) =>
      enregistrerFichier(
        new Blob([contenu], { type: 'application/pdf' }),
        nomDeLaFiche(v.annee, v.agent.matricule, true),
      ),
  });
  return (
    // Dans le bandeau : le bouton blanc des gestes du bandeau, l'erreur en
    // clair sur le bleu.
    <div className="flex flex-col items-stretch gap-1.5 sm:items-end">
      <Button className={BOUTON_DU_BANDEAU} loading={pdf.isPending} onClick={() => pdf.mutate()}>
        <Icon name="download" size={17} />
        Télécharger le PDF
      </Button>
      {pdf.error ? (
        <p role="alert" className="text-[12px] font-semibold text-[#ffd0c9]">
          {messageDe(pdf.error)}
        </p>
      ) : null}
    </div>
  );
}
