'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ceQuiManqueALAutoEvaluation,
  dateEnLettres,
  heureEnLettres,
  type AutoEvaluation,
  type MonAutoEvaluation,
} from '@teranga/contracts';
import { Button, Card, EmptyState, Skeleton } from '@teranga/ui';
import {
  AutoEvaluationEnLecture,
  SaisieDeLAuto,
  type ChangementDeLAuto,
} from '../../../../components/campagne/auto-evaluation';
import { AutoFaite, periodeDeLAuto, RetourALAccueil } from '../../../../components/campagne/fiche';
import { EnTete, Repere } from '../../../../components/fiche';
import {
  Confirmation,
  messageDe,
  useGardeDeSaisie,
} from '../../../../components/grille-evaluation';
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

/** Le temps, après la dernière frappe, avant d'enregistrer. */
const DELAI = 1200;

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
        <Skeleton className="mb-4 h-[158px] w-full rounded-bloc" />
        <Skeleton className="h-72 w-full rounded-bloc" />
      </div>
    );
  }
  // Transmise, la fiche repart de zéro, en lecture.
  return <AutoEvaluation key={requete.data.etat} vue={requete.data} />;
}

type EtatDeLEnregistrement =
  | { etat: 'au_repos' }
  | { etat: 'a_enregistrer' }
  | { etat: 'en_cours' }
  | { etat: 'enregistre'; heure: string }
  | { etat: 'erreur'; message: string };

const maintenant = () => {
  const d = new Date();
  const deux = (n: number) => String(n).padStart(2, '0');
  return heureEnLettres(`${deux(d.getHours())}:${deux(d.getMinutes())}`);
};

/**
 * L'enregistrement automatique de la saisie : chaque modification part un
 * peu après la dernière frappe, un envoi à la fois. Une modification faite
 * pendant un envoi part juste après. `vider` enregistre sans attendre ce qui
 * ne l'est pas encore, avant la transmission ; en quittant la page, ce qui
 * reste part aussi.
 */
function useEnregistrementAuto(initial: AutoEvaluation) {
  const [auto, setAuto] = useState(initial);
  const [etat, setEtat] = useState<EtatDeLEnregistrement>({ etat: 'au_repos' });
  const dernier = useRef(initial);
  const enregistre = useRef(initial);
  const minuterie = useRef<ReturnType<typeof setTimeout>>(undefined);
  const enVol = useRef<Promise<unknown> | null>(null);

  const vider = useCallback(async (): Promise<void> => {
    clearTimeout(minuterie.current);
    while (enVol.current) await enVol.current;
    const contenu = dernier.current;
    if (contenu === enregistre.current) return;
    setEtat({ etat: 'en_cours' });
    const envoi = api<MonAutoEvaluation>(CHEMIN, { method: 'PUT', body: { auto: contenu } });
    enVol.current = envoi.catch(() => undefined);
    try {
      await envoi;
      enregistre.current = contenu;
      setEtat(
        dernier.current === contenu
          ? { etat: 'enregistre', heure: maintenant() }
          : { etat: 'a_enregistrer' },
      );
    } catch (e) {
      setEtat({ etat: 'erreur', message: messageDe(e, 'Enregistrement impossible, réessayez.') });
      throw e;
    } finally {
      enVol.current = null;
    }
  }, []);

  const changer: ChangementDeLAuto = useCallback(
    (maj) => {
      setAuto((a) => {
        const suivant = maj(a);
        dernier.current = suivant;
        return suivant;
      });
      setEtat({ etat: 'a_enregistrer' });
      clearTimeout(minuterie.current);
      minuterie.current = setTimeout(() => void vider().catch(() => undefined), DELAI);
    },
    [vider],
  );

  // En quittant la page par un lien, ce qui n'est pas encore parti part.
  useEffect(
    () => () => {
      clearTimeout(minuterie.current);
      if (dernier.current !== enregistre.current) {
        void api(CHEMIN, { method: 'PUT', body: { auto: dernier.current } }).catch(() => undefined);
      }
    },
    [],
  );

  return { auto, etat, changer, vider, contenu: () => dernier.current };
}

/** « Le vécu de l'année, les difficultés rencontrées, le niveau de l'objectif 1 et 3 autres. » */
function ceQuiManqueEnBref(manque: readonly string[]): string {
  const vus = manque.slice(0, 3);
  const reste = manque.length - vus.length;
  const liste =
    reste > 0 ? `${vus.join(', ')} et ${reste} autre${reste > 1 ? 's' : ''}` : vus.join(', ');
  return `À compléter : ${liste}.`;
}

function AutoEvaluation({ vue }: { vue: MonAutoEvaluation }) {
  const qc = useQueryClient();
  const { auto, etat, changer, vider, contenu } = useEnregistrementAuto(vue.auto);
  const [confirmer, setConfirmer] = useState(false);
  const transmise = vue.etat === 'transmise';
  const manque = ceQuiManqueALAutoEvaluation(auto, vue.objectifs);
  const total = 2 + 2 * vue.objectifs.length;
  const n1 = vue.evaluateur;
  const fin = vue.periode ? (vue.periode.autoAu ?? vue.periode.au) : null;
  useGardeDeSaisie(
    etat.etat === 'a_enregistrer' || etat.etat === 'en_cours' || etat.etat === 'erreur',
  );

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
      <EnTete
        titre="Mon auto-évaluation"
        marque={transmise ? <AutoFaite le={vue.transmiseLe} /> : null}
        sousTitre={periodeDeLAuto(vue.periode)}
        // Quatre repères : quatre colonnes sur un grand écran, deux sur un
        // téléphone, où trois serraient la date limite jusqu'à la couper.
        reperes={
          <>
            <Repere label="N+1" valeur={n1 ? `${n1.prenom} ${n1.nom}` : null}>
              {n1?.poste}
            </Repere>
            <Repere label="Date limite" valeur={fin ? dateEnLettres(fin) : null} />
            <Repere label="Objectifs" valeur={String(vue.objectifs.length)} />
            {transmise ? (
              <Repere
                label="Transmise le"
                valeur={vue.transmiseLe ? dateEnLettres(vue.transmiseLe) : null}
              />
            ) : (
              <Repere label="Avancement" valeur={`${total - manque.length} sur ${total}`}>
                réponses obligatoires
              </Repere>
            )}
          </>
        }
      />

      {vue.modifiable ? (
        <>
          <SaisieDeLAuto
            annee={vue.annee}
            objectifs={vue.objectifs}
            auto={auto}
            onChange={changer}
          />
          <div className="sticky bottom-4 z-20">
            <Card className="flex flex-col gap-3 px-5 py-3.5 shadow-[0_10px_30px_-12px_rgb(0_40_90/0.3)] sm:flex-row sm:items-center sm:gap-5">
              <div className="min-w-0 flex-1 text-[12px] leading-relaxed">
                <EtatEcrit etat={etat} />
                {manque.length > 0 ? (
                  <p className="text-ink-muted">{ceQuiManqueEnBref(manque)}</p>
                ) : null}
              </div>
              <Button
                className="h-9 shrink-0 px-5"
                disabled={manque.length > 0 || transmettre.isPending}
                onClick={() => setConfirmer(true)}
              >
                <Icon name="arrow_forward" size={15} />
                Transmettre à mon N+1
              </Button>
            </Card>
          </div>
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

/** Où en est l'enregistrement de la saisie. */
function EtatEcrit({ etat }: { etat: EtatDeLEnregistrement }) {
  switch (etat.etat) {
    case 'au_repos':
      return null;
    case 'a_enregistrer':
    case 'en_cours':
      return <p className="text-ink-muted">Enregistrement…</p>;
    case 'enregistre':
      return (
        <p className="flex items-center gap-1.5 font-semibold text-ink-muted">
          <Icon name="check" size={14} />
          Brouillon enregistré à {etat.heure}
        </p>
      );
    case 'erreur':
      return (
        <p role="alert" className="text-danger">
          {etat.message}
        </p>
      );
  }
}
