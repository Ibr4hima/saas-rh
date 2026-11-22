'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ceQuiManqueALAutoEvaluation,
  dateEnLettres,
  reponsesObligatoiresDeLAuto,
  type AutoEvaluation,
  type MonAutoEvaluation,
} from '@teranga/contracts';
import { Button, Card, EmptyState, Skeleton } from '@teranga/ui';
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
  BOUTON_DU_BANDEAU,
  nomAvecCivilite,
  periodeDeLAuto,
  RetourALAccueil,
  superieurHierarchique,
} from '../../../../components/campagne/fiche';
import { Repere } from '../../../../components/fiche';
import { BandeauDePage } from '../../../../components/campagne/charte';
import { Confirmation, messageDe } from '../../../../components/grille-evaluation';
import { Icon } from '../../../../components/icons';
import { PdfEnLargeur } from '../../../../components/pdf-viewer';
import { api, ApiError } from '../../../../lib/api';
import { ACCUEIL_DE_LA_CAMPAGNE, CLE_CAMPAGNE } from '../../../../lib/campagne';
import { lireFichier } from '../../../../lib/fichiers';

/* ────────────────────────────────────────────────────────────────
   L'auto-évaluation de la personne connectée (ADR-0214, ADR-0215), ouverte
   par le bouton « M’auto-évaluer » de sa fiche.

   En tête : le titre, la période, et ce qui compte pour la remplir, le N+1
   qui la recevra, la date limite, l'avancement des réponses obligatoires.
   Dessous, les cartes de la fiche. Chaque modification s'enregistre seule,
   un peu après la dernière frappe ; au bas de la page, une barre dit où en
   est l'enregistrement, ce qui manque, et porte « Valider » et
   « Transmettre à mon N+1 » (ADR-0241). « Valider » replie la saisie et
   montre la fiche de l'agent en PDF, comme un document généré ;
   « Modifier » rouvre la saisie. Transmise, l'auto-évaluation se lit et ne
   change plus. Sans auto-évaluation à faire (au sommet de l'organigramme,
   en stage), la page renvoie à l'accueil.
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
  // Validée, la saisie se replie : la fiche s'affiche en PDF (ADR-0241).
  const [validee, setValidee] = useState(false);
  const transmise = vue.etat === 'transmise';
  const manque = ceQuiManqueALAutoEvaluation(auto, vue.objectifs);
  const total = reponsesObligatoiresDeLAuto(vue.objectifs);
  const n1 = vue.evaluateur;
  const fin = vue.periode ? (vue.periode.autoAu ?? vue.periode.au) : null;
  /** Valider, ou revenir à la saisie : la page repart de son haut. */
  const basculer = (valider: boolean) => {
    setValidee(valider);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
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
        titre="Mon auto-évaluation"
        marque={transmise ? <AutoFaite le={vue.transmiseLe} /> : null}
        sousTitre={periodeDeLAuto(vue.periode)}
        // La fiche affichée, « Modifier » rouvre la saisie depuis le bandeau (ADR-0242).
        action={
          vue.modifiable && validee ? (
            <button type="button" className={BOUTON_DU_BANDEAU} onClick={() => basculer(false)}>
              <Icon name="edit" size={17} />
              Modifier
            </button>
          ) : undefined
        }
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
          {validee ? (
            <ApercuDeLaFiche auto={auto} titre={`Mon auto-évaluation ${vue.annee}`} />
          ) : (
            <SaisieDeLAuto
              annee={vue.annee}
              objectifs={vue.objectifs}
              auto={auto}
              onChange={changer}
            />
          )}
          <BarreDeTransmission
            etat={etat}
            manque={manque}
            libelle="Transmettre à mon N+1"
            enCours={transmettre.isPending}
            onTransmettre={() => setConfirmer(true)}
            avant={
              validee ? (
                <Button variant="secondary" className="h-9 px-5" onClick={() => basculer(false)}>
                  <Icon name="edit" size={15} />
                  Modifier
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  className="h-9 px-5"
                  disabled={manque.length > 0 || transmettre.isPending}
                  onClick={() => basculer(true)}
                >
                  Valider
                </Button>
              )
            }
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
          {/* « Monsieur » ou « Madame » selon le dossier du N+1 (ADR-0248). */}
          Votre auto-évaluation sera transmise à{' '}
          {n1 ? (
            <span className="font-semibold text-ink-strong">{nomAvecCivilite(n1)}</span>
          ) : (
            'votre N+1'
          )}
          . Vous ne pourrez plus la modifier après transmission.
        </Confirmation>
      ) : null}
    </div>
  );
}

/**
 * La fiche de l'agent, telle que « Valider » la montre (ADR-0241) : la
 * partie remplie par l'agent, en PDF, à la largeur de la page, comme un
 * document généré ; « Modifier » se tient sur le bandeau et dans la barre
 * (ADR-0242). Le PDF suit ce que montre la saisie, enregistré ou non.
 */
function ApercuDeLaFiche({ auto, titre }: { auto: AutoEvaluation; titre: string }) {
  const pdf = useQuery({
    queryKey: [...CLE_AUTO, 'apercu', auto],
    queryFn: ({ signal }) => lireFichier(`${CHEMIN}/apercu`, { signal, corps: { auto } }),
    retry: false,
    refetchOnWindowFocus: false,
  });
  return (
    <>
      {pdf.isError ? (
        <Card>
          <EmptyState
            className="py-12"
            icon={<Icon name="error" size={22} />}
            title={messageDe(pdf.error, 'Impossible d’afficher la fiche')}
            action={
              <Button size="sm" variant="secondary" onClick={() => void pdf.refetch()}>
                Réessayer
              </Button>
            }
          />
        </Card>
      ) : pdf.data ? (
        <PdfEnLargeur data={pdf.data} titre={titre} />
      ) : (
        // Une feuille blanche, le temps que le PDF arrive : rien ne saute à son arrivée.
        <div className="grid aspect-[595/842] place-items-center rounded-bloc bg-white shadow-xs ring-1 ring-card-line">
          <span className="size-5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
        </div>
      )}
    </>
  );
}
