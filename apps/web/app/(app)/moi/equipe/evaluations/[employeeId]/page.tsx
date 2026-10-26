'use client';

// La feuille de l'éditeur part avec la page, pas avec l'éditeur chargé à la
// demande : une feuille venue d'un module différé peut manquer à l'affichage.
import '@blocknote/mantine/style.css';
import { use, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ceQuiManque,
  champsTropLongs,
  dateEnLettres,
  LIMITES_DE_LA_GRILLE,
  type ContenuDeGrille,
  type EvaluationsDeLEquipe,
  type VueDeGrille,
} from '@teranga/contracts';
import { Button, Card, CardTitle, cn, EmptyState, Field, Skeleton } from '@teranga/ui';
import { api, ApiError } from '../../../../../../lib/api';
import { RetourDeLEcran } from '../../../../../../components/entete';
import { EnTete, Repere } from '../../../../../../components/fiche';
import { Page } from '../../../../../../components/gabarit';
import {
  anneeDeLAdresse,
  ApercuDeLaGrille,
  CircuitDeLaGrille,
  CLE_EVALUATIONS,
  cleDeLaGrille,
  Confirmation,
  leEnLettres,
  libelleDeLEtape,
  messageDe,
  ouEnEstDe,
  periodeEnTete,
  SaisieDeLaGrille,
  tonDeLEtape,
  useGardeDeSaisie,
  useMessageBref,
  versionDe,
  ZoneDeTexte,
} from '../../../../../../components/grille-evaluation';
import { Icon } from '../../../../../../components/icons';
import { usePageTitle } from '../../../../../../components/page-title';

/*
   La grille d'évaluation d'un agent, côté hiérarchie (ADR-0149).

   Le N+1 la remplit, section par section, comme on prépare un document
   généré : « Valider » la replie et montre le PDF tel qu'il s'imprimera,
   puis elle part à l'agent. Revenue validée, le N+1 l'envoie au N+2, au
   choix, et à la DCH à tout moment : le N+2 n'est jamais un passage
   obligé. Le N+2 qui l'a reçue la lit, la commente et la valide. Tous voient
   le circuit : qui l'a eue, quand, et ce qu'en ont dit l'agent et le N+2.
*/

export default function GrilleDEvaluationPage({
  params,
}: {
  params: Promise<{ employeeId: string }>;
}) {
  const { employeeId } = use(params);
  const router = useRouter();
  const demandee = anneeDeLAdresse(useSearchParams().get('annee'));
  // Sans année dans l'adresse, celle que montre la liste de l'équipe.
  const equipe = useQuery({
    queryKey: [...CLE_EVALUATIONS, 'equipe', null],
    queryFn: () => api<EvaluationsDeLEquipe>('/evaluations/equipe'),
    enabled: demandee === null,
  });
  const annee = demandee ?? equipe.data?.annee ?? null;
  const grille = useQuery({
    queryKey: cleDeLaGrille(employeeId, annee),
    queryFn: () => api<VueDeGrille>(`/evaluations/grilles/${employeeId}/${annee}`),
    enabled: annee !== null,
    retry: false,
  });
  const vue = grille.data;
  usePageTitle(annee ? `Grille d’évaluation ${annee}` : null);
  // L'agent qui arrive ici lit sa grille sur sa propre page.
  useEffect(() => {
    if (vue?.role === 'agent') router.replace(`/moi/evaluation?annee=${vue.annee}`);
  }, [vue, router]);

  const retour = (
    <RetourDeLEcran
      href={annee ? `/moi/equipe/evaluations?annee=${annee}` : '/moi/equipe/evaluations'}
      libelle="Évaluations"
    />
  );
  const erreur = grille.error ?? equipe.error;
  if (erreur) {
    const probleme = erreur instanceof ApiError ? erreur.problem : null;
    return (
      <Page>
        {retour}
        <Card>
          <EmptyState
            className="py-14"
            icon={<Icon name="rate_review" size={22} />}
            title={probleme?.title ?? 'Impossible d’afficher la grille d’évaluation'}
          />
        </Card>
      </Page>
    );
  }
  if (!vue || vue.role === 'agent') {
    return (
      <Page>
        {retour}
        <Skeleton className="h-[158px] w-full rounded-bloc" />
        <Skeleton className="h-72 w-full rounded-bloc" />
      </Page>
    );
  }
  return (
    <Page>
      {retour}
      <TeteDeLaGrille vue={vue} />
      <CorpsDeLaGrille key={`${vue.employeeId}-${vue.annee}`} vue={vue} />
    </Page>
  );
}

/** La carte de tête : l'agent, sa grille, l'étape, la période. */
function TeteDeLaGrille({ vue }: { vue: VueDeGrille }) {
  const o = ouEnEstDe(vue);
  const aCommenter = vue.role === 'n2' && vue.etat === 'chez_n2';
  const aRenseigner = !vue.etat && !vue.personnel;
  return (
    <EnTete
      titre={vue.agent.nom}
      sousTitre={vue.agent.poste ?? undefined}
      reperes={
        <>
          <Repere
            label="Grille"
            valeur={
              aRenseigner
                ? 'Cadre ou non-cadre à renseigner'
                : (vue.etat ? vue.modele : vue.personnel) === 'non_cadre'
                  ? 'Personnel non cadre'
                  : 'Personnel cadre'
            }
            ton={aRenseigner ? 'attente' : undefined}
          />
          <Repere
            label="Étape"
            valeur={aCommenter ? 'À commenter' : libelleDeLEtape(o)}
            ton={tonDeLEtape(o, vue.role === 'n2') === 'orange' ? 'attente' : undefined}
          />
          <Repere label="Période" valeur={periodeEnTete(vue.periode) ?? 'Non fixée'} />
          {vue.role === 'n1' ? (
            <Repere label="N+2" valeur={vue.n2?.nom} />
          ) : (
            <Repere label="Évaluateur (N+1)" valeur={vue.evaluateur} />
          )}
        </>
      }
    />
  );
}

/** Ce que la grille montre à la personne qui l'ouvre, selon l'étape. */
function CorpsDeLaGrille({ vue }: { vue: VueDeGrille }) {
  if (vue.role === 'n1' && (vue.etat === null || vue.etat === 'brouillon')) {
    if (!vue.etat && !vue.personnel) {
      return (
        <Vide
          titre="Cadre ou non-cadre à renseigner"
          description="La DCH doit l’indiquer sur la fiche de l’agent."
        />
      );
    }
    if (!vue.etat && vue.personnel === 'non_cadre') {
      return <Vide titre="La grille du personnel non cadre n’est pas encore disponible" />;
    }
    if (!vue.actions.enregistrer) {
      return (
        <Vide
          titre={
            vue.periode
              ? `La période d’évaluation ${vue.annee} s’ouvre le ${dateEnLettres(vue.periode.du)}`
              : `La période d’évaluation ${vue.annee} n’est pas encore fixée`
          }
        />
      );
    }
    return <Remplissage vue={vue} />;
  }
  return <SuiviDeLaGrille vue={vue} />;
}

function Vide({ titre, description }: { titre: string; description?: string }) {
  return (
    <Card>
      <EmptyState
        className="py-14"
        icon={<Icon name="rate_review" size={22} />}
        title={titre}
        description={description}
      />
    </Card>
  );
}

const minuscule = (texte: string) => texte.charAt(0).toLowerCase() + texte.slice(1);

/**
 * Le N+1 remplit la grille. « Enregistrer » la garde telle qu'elle est ;
 * « Valider », une fois tout rempli, l'enregistre, la replie et montre le
 * PDF, avec « Envoyer à l'agent » au circuit. « Modifier » la rouvre.
 */
function Remplissage({ vue }: { vue: VueDeGrille }) {
  const qc = useQueryClient();
  const [contenu, setContenu] = useState<ContenuDeGrille>(vue.contenu);
  const [modifie, setModifie] = useState(false);
  const [valide, setValide] = useState(false);
  const [enregistrements, setEnregistrements] = useState(0);
  const [geste, setGeste] = useState<'enregistrer' | 'valider' | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useMessageBref();
  const carte = useRef<HTMLDivElement>(null);
  const manque = ceQuiManque(contenu, vue.commandement);
  const tropLongs = champsTropLongs(contenu);
  useGardeDeSaisie(modifie);
  // Un seul geste, stable, pour toute la grille : chaque champ y applique sa
  // modification au dernier état, sans faire redessiner les autres.
  const changer = useCallback((maj: (c: ContenuDeGrille) => ContenuDeGrille) => {
    setContenu(maj);
    setModifie(true);
    setErreur(null);
  }, []);

  const chemin = `/evaluations/grilles/${vue.employeeId}/${vue.annee}`;
  const rafraichir = async (nouvelle: VueDeGrille) => {
    qc.setQueryData(cleDeLaGrille(vue.employeeId, vue.annee), nouvelle);
    await qc.invalidateQueries({ queryKey: [...CLE_EVALUATIONS, 'equipe'] });
  };
  const enregistrer = useMutation({
    mutationFn: (c: ContenuDeGrille) =>
      api<VueDeGrille>(chemin, { method: 'PUT', body: { contenu: c } }),
    onSuccess: async (nouvelle) => {
      setModifie(false);
      setEnregistrements((n) => n + 1);
      await rafraichir(nouvelle);
    },
  });
  const envoyer = useMutation({
    mutationFn: () => api<VueDeGrille>(`${chemin}/envoi`, { method: 'POST' }),
    onSuccess: rafraichir,
    onError: (e) => setErreur(messageDe(e)),
  });

  const sauver = (quoi: 'enregistrer' | 'valider', ensuite: () => void) => {
    setErreur(null);
    setGeste(quoi);
    enregistrer.mutate(contenu, {
      onSuccess: ensuite,
      onError: (e) => setErreur(messageDe(e)),
      onSettled: () => setGeste(null),
    });
  };
  const valider = () => {
    const replier = () => {
      setValide(true);
      requestAnimationFrame(() => carte.current?.scrollIntoView({ block: 'start' }));
    };
    // Une grille jamais enregistrée (les objectifs repris de l'an passé)
    // s'enregistre avant de s'imprimer.
    if (modifie || !vue.etat) sauver('valider', replier);
    else replier();
  };

  return (
    <>
      {vue.renvoi ? (
        <Card className="px-5 py-4">
          <p className="flex items-center gap-2 text-[12.5px] font-semibold text-accent-text">
            <Icon name="replay" size={16} />
            Renvoyée par {vue.agent.nom} le {leEnLettres(vue.renvoi.le)}
          </p>
          <p className="mt-2 text-[12.5px] leading-relaxed break-words whitespace-pre-line text-ink-strong">
            {vue.renvoi.mot}
          </p>
        </Card>
      ) : null}

      <div ref={carte} className="scroll-mt-4">
        <Card>
          {/* Repliée, elle prend la forme du bloc « Préremplissage » des
              documents générés : sur téléphone, le bouton passe dessous. */}
          <div
            className={cn(
              'flex px-5 py-4',
              valide ? 'flex-col gap-3 sm:flex-row sm:items-center sm:gap-5' : 'items-center gap-5',
            )}
          >
            <CardTitle className="min-w-0 flex-1">Grille d’évaluation</CardTitle>
            {valide ? (
              <Button
                variant="secondary"
                className="h-9 w-full sm:w-auto"
                onClick={() => setValide(false)}
              >
                <Icon name="edit" size={15} />
                Modifier
              </Button>
            ) : (
              <span aria-hidden className="hidden h-9 sm:block" />
            )}
          </div>
          <div hidden={valide}>
            <SaisieDeLaGrille vue={vue} contenu={contenu} onChange={changer} />
            <div className="flex flex-col gap-3 border-t border-line-soft px-5 py-4 sm:flex-row sm:items-center sm:gap-5">
              <div className="min-w-0 flex-1 text-[12px] leading-relaxed">
                {erreur ? (
                  <p role="alert" className="text-danger">
                    {erreur}
                  </p>
                ) : message ? (
                  <p role="status" className="font-semibold text-success">
                    {message}
                  </p>
                ) : tropLongs.length > 0 ? (
                  <p role="alert" className="text-danger">
                    Texte trop long pour le PDF : {tropLongs.map(minuscule).join(', ')}.
                  </p>
                ) : manque.length > 0 ? (
                  <p className="text-ink-muted">
                    À compléter : {manque.map(minuscule).join(', ')}.
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  variant="secondary"
                  className="h-9 flex-1 px-4 sm:flex-none"
                  disabled={
                    (!modifie && Boolean(vue.etat)) || tropLongs.length > 0 || geste !== null
                  }
                  loading={geste === 'enregistrer'}
                  onClick={() => sauver('enregistrer', () => setMessage('Grille enregistrée'))}
                >
                  Enregistrer
                </Button>
                <Button
                  className="h-9 flex-1 px-5 sm:flex-none"
                  disabled={manque.length > 0 || tropLongs.length > 0 || geste !== null}
                  loading={geste === 'valider'}
                  onClick={valider}
                >
                  Valider
                </Button>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {valide ? (
        <>
          <CircuitDeLaGrille vue={vue}>
            {erreur ? (
              <p role="alert" className="mr-auto text-[12px] text-danger">
                {erreur}
              </p>
            ) : null}
            <Button loading={envoyer.isPending} onClick={() => envoyer.mutate()}>
              <Icon name="arrow_forward" size={15} />
              Envoyer à l’agent
            </Button>
          </CircuitDeLaGrille>
          <ApercuDeLaGrille
            vue={vue}
            matricule={vue.identification.matricule}
            version={versionDe(vue, enregistrements)}
          />
        </>
      ) : null}
    </>
  );
}

/**
 * La grille partie du N+1 : le circuit, les gestes de l'étape, et le PDF.
 * Le N+1 la reprend tant que l'agent ne l'a pas validée ; validée, elle part
 * au N+2 ou à la DCH, au choix du N+1, et à la DCH à tout moment quand elle
 * est chez le N+2. Le N+2 la commente et la valide : elle revient au N+1,
 * qui seul l'envoie à la DCH (ADR-0154).
 */
function SuiviDeLaGrille({ vue }: { vue: VueDeGrille }) {
  const qc = useQueryClient();
  const [commentaires, setCommentaires] = useState(vue.commentairesN2);
  const [confirmer, setConfirmer] = useState<'dch' | 'n2' | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const a = vue.actions;
  useGardeDeSaisie(a.commenter && commentaires.trim() !== '');

  const geste = useMutation({
    mutationFn: ({ route, corps }: { route: string; corps?: unknown }) =>
      api<VueDeGrille>(`/evaluations/grilles/${vue.employeeId}/${vue.annee}/${route}`, {
        method: 'POST',
        body: corps,
      }),
    onMutate: () => setErreur(null),
    onSuccess: async (nouvelle) => {
      setConfirmer(null);
      qc.setQueryData(cleDeLaGrille(vue.employeeId, vue.annee), nouvelle);
      await qc.invalidateQueries({ queryKey: [...CLE_EVALUATIONS, 'equipe'] });
    },
    onError: (e) => setErreur(messageDe(e)),
  });
  const enCours = (route: string) => geste.isPending && geste.variables?.route === route;
  const gestes = a.reprendre || a.transmettreAuN2 || a.terminer || a.commenter;

  return (
    <>
      <CircuitDeLaGrille
        vue={vue}
        avant={
          a.commenter ? (
            <Field label="Commentaires du N+2" htmlFor="commentaires-n2">
              <ZoneDeTexte
                id="commentaires-n2"
                max={LIMITES_DE_LA_GRILLE.commentairesN2}
                value={commentaires}
                onChange={(e) => setCommentaires(e.target.value)}
              />
            </Field>
          ) : undefined
        }
      >
        {gestes ? (
          <>
            {erreur && !confirmer ? (
              <p role="alert" className="mr-auto text-[12px] text-danger">
                {erreur}
              </p>
            ) : null}
            {a.reprendre ? (
              <Button
                variant="secondary"
                loading={enCours('reprise')}
                onClick={() => geste.mutate({ route: 'reprise' })}
              >
                <Icon name="edit" size={15} />
                Reprendre
              </Button>
            ) : null}
            {a.transmettreAuN2 ? (
              <Button
                variant="secondary"
                loading={enCours('n2')}
                onClick={() => geste.mutate({ route: 'n2' })}
              >
                <Icon name="arrow_forward" size={15} />
                Envoyer au N+2
              </Button>
            ) : null}
            {a.terminer ? (
              <Button onClick={() => setConfirmer('dch')}>
                <Icon name="task_alt" size={15} />
                Envoyer à la DCH
              </Button>
            ) : null}
            {a.commenter ? (
              <Button onClick={() => setConfirmer('n2')}>
                <Icon name="check" size={15} />
                Valider
              </Button>
            ) : null}
          </>
        ) : null}
      </CircuitDeLaGrille>

      <ApercuDeLaGrille
        vue={vue}
        matricule={vue.identification.matricule}
        version={versionDe(vue)}
      />

      {confirmer === 'dch' ? (
        <Confirmation
          titre="Envoyer la grille à la DCH ?"
          libelle="Envoyer"
          enCours={enCours('dch')}
          erreur={erreur}
          onConfirmer={() => geste.mutate({ route: 'dch' })}
          onClose={() => setConfirmer(null)}
        >
          La grille d’évaluation {vue.annee} de {vue.agent.nom} sera envoyée à la DCH
          {vue.etat === 'chez_n2' ? ', sans attendre les commentaires du N+2' : ''}. Elle ne pourra
          plus être modifiée.
        </Confirmation>
      ) : null}
      {confirmer === 'n2' ? (
        <Confirmation
          titre="Valider la grille ?"
          libelle="Valider"
          enCours={enCours('commentaires-n2')}
          erreur={erreur}
          onConfirmer={() => geste.mutate({ route: 'commentaires-n2', corps: { commentaires } })}
          onClose={() => setConfirmer(null)}
        >
          {commentaires.trim()
            ? 'Vos commentaires seront transmis au N+1. Vous ne pourrez plus les modifier.'
            : 'La grille sera renvoyée au N+1 sans commentaire de votre part. Vous ne pourrez plus la commenter.'}
        </Confirmation>
      ) : null}
    </>
  );
}
