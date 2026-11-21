'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ceQuiManqueALAutoEvaluation,
  dateEnLettres,
  type AutoEvaluation,
  type MonAutoEvaluation,
} from '@teranga/contracts';
import { Card, EmptyState, Skeleton } from '@teranga/ui';
import {
  AutoEvaluationEnLecture,
  SaisieDeLAuto,
} from '../../../../components/campagne/auto-evaluation';
import {
  BarreDeTransmission,
  useEnregistrementAuto,
} from '../../../../components/campagne/enregistrement';
import {
  AutoFaite,
  periodeDeLAuto,
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
   L'auto-évaluation de la personne connectée (ADR-0214, ADR-0215), ouverte
   par le bouton « M’auto-évaluer » de sa fiche.

   En tête : le titre, la période, et ce qui compte pour la remplir, le N+1
   qui la recevra, la date limite, l'avancement des réponses obligatoires.
   Dessous, les cartes de la fiche. Chaque modification s'enregistre seule,
   un peu après la dernière frappe ; une barre, collée au bas de l'écran,
   dit où en est l'enregistrement, ce qui manque, et porte « Transmettre à
   mon N+1 ». Transmise, l'auto-évaluation se lit et ne change plus. Sans
   auto-évaluation à faire (au sommet de l'organigramme, en stage), la page
   renvoie à l'accueil.
   ──────────────────────────────────────────────────────────────── */

const CHEMIN = '/campagne/auto-evaluation';
const CLE_AUTO = [...CLE_CAMPAGNE, 'auto-evaluation'] as const;

export default function AutoEvaluationPage() {
  const router = useRouter();
  const requete = useQuery({
    queryKey: CLE_AUTO,
    queryFn: () => api<MonAutoEvaluation>(CHEMIN),
    retry: false,
    // La saisie garde son propre état : relire la fiche au retour sur
    // l'onglet n'apporterait rien.
    refetchOnWindowFocus: false,
  });
  const sansAuto = requete.error instanceof ApiError && requete.error.problem.status === 404;
  useEffect(() => {
    if (sansAuto) router.replace(ACCUEIL_DE_LA_CAMPAGNE);
  }, [sansAuto, router]);

  if (requete.error && !sansAuto) {
    return (
      <div className="flex flex-col gap-4">
        <RetourALAccueil libelle="Accueil" />
        <Card>
          <EmptyState
            className="py-12"
            icon={<Icon name="rate_review" size={22} />}
            title={messageDe(requete.error, 'Impossible d’afficher votre auto-évaluation')}
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
  // Transmise, la fiche repart de zéro, en lecture.
  return <AutoEvaluation key={requete.data.etat} vue={requete.data} />;
}

/** Le corps d'un envoi : l'auto-évaluation, telle qu'elle est écrite. */
const corpsDeLAuto = (auto: AutoEvaluation) => ({ auto });

function AutoEvaluation({ vue }: { vue: MonAutoEvaluation }) {
  const qc = useQueryClient();
  const {
    valeur: auto,
    etat,
    changer,
    vider,
    contenu,
  } = useEnregistrementAuto(CHEMIN, vue.auto, corpsDeLAuto);
  const [confirmer, setConfirmer] = useState(false);
  const transmise = vue.etat === 'transmise';
  const manque = ceQuiManqueALAutoEvaluation(auto, vue.objectifs);
  const total = 2 + 2 * vue.objectifs.length;
  const n1 = vue.evaluateur;
  const fin = vue.periode ? (vue.periode.autoAu ?? vue.periode.au) : null;
  const transmettre = useMutation({
    mutationFn: async () => {
      await vider();
      return api<MonAutoEvaluation>(`${CHEMIN}/transmission`, {
        method: 'POST',
        body: { auto: contenu() },
      });
    },
    onSuccess: async (v) => {
      qc.setQueryData(CLE_AUTO, v);
      await qc.invalidateQueries({ queryKey: CLE_CAMPAGNE, exact: true });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <RetourALAccueil libelle="Accueil" />
      <BandeauDePage
        icone="edit"
        titre="Mon auto-évaluation"
        marque={transmise ? <AutoFaite le={vue.transmiseLe} /> : null}
        sousTitre={periodeDeLAuto(vue.periode)}
        // Quatre repères : quatre colonnes sur un grand écran, deux sur un
        // téléphone, où trois serraient la date limite jusqu'à la couper.
        reperes={[
          <Repere
            key="n1"
            label={superieurHierarchique(n1)}
            valeur={n1 ? `${n1.prenom} ${n1.nom}` : null}
          />,
          <Repere key="fin" label="Date limite" valeur={fin ? dateEnLettres(fin) : null} />,
          <Repere key="objectifs" label="Objectifs" valeur={String(vue.objectifs.length)} />,
          transmise ? (
            <Repere
              key="transmise"
              label="Transmise le"
              valeur={vue.transmiseLe ? dateEnLettres(vue.transmiseLe) : null}
            />
          ) : (
            <Repere
              key="avancement"
              label="Avancement"
              valeur={`${total - manque.length} sur ${total}`}
            >
              réponses obligatoires
            </Repere>
          ),
        ]}
      />

      {vue.modifiable ? (
        <>
          <SaisieDeLAuto
            annee={vue.annee}
            objectifs={vue.objectifs}
            auto={auto}
            onChange={changer}
          />
          <BarreDeTransmission
            etat={etat}
            manque={manque}
            libelle="Transmettre à mon N+1"
            enCours={transmettre.isPending}
            onTransmettre={() => setConfirmer(true)}
          />
        </>
      ) : (
        <AutoEvaluationEnLecture annee={vue.annee} objectifs={vue.objectifs} auto={vue.auto} />
      )}

      {confirmer ? (
        <Confirmation
          titre="Transmettre votre auto-évaluation ?"
          libelle="Transmettre"
          enCours={transmettre.isPending}
          erreur={transmettre.error ? messageDe(transmettre.error) : null}
          onConfirmer={() => transmettre.mutate()}
          onClose={() => {
            setConfirmer(false);
            transmettre.reset();
          }}
        >
          {n1 ? (
            <>
              Elle part à{' '}
              <span className="font-semibold text-ink-strong">
                {n1.prenom} {n1.nom}
              </span>
              , votre N+1, et ne pourra plus être modifiée.
            </>
          ) : (
            'Elle ne pourra plus être modifiée.'
          )}
        </Confirmation>
      ) : null}
    </div>
  );
}
