'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LIMITES_DE_LA_GRILLE, type MesEvaluations, type VueDeGrille } from '@teranga/contracts';
import { Button, Card, CardTitle, EmptyState, Field, Skeleton } from '@teranga/ui';
import { api, ApiError } from '../../../../lib/api';
import { EnTete, Repere } from '../../../../components/fiche';
import { Page } from '../../../../components/gabarit';
import {
  anneeDeLAdresse,
  CLE_EVALUATIONS,
  cleDeLaGrille,
  Confirmation,
  Erreur,
  GrilleEnLecture,
  leEnLettres,
  messageDe,
  periodeEnTete,
  useGardeDeSaisie,
  ZoneDeTexte,
} from '../../../../components/grille-evaluation';
import { Icon } from '../../../../components/icons';
import { Modal } from '../../../../components/modal';
import { Onglets, OngletsDeLEntete } from '../../../../components/onglets';

/*
   Mon évaluation (ADR-0149) : la grille que le N+1 a remplie et envoyée,
   telle que l'agent a le droit de la lire, sans la partie réservée à la
   hiérarchie. L'agent la valide, avec ses commentaires éventuels : c'est sa
   ratification de l'entretien. En désaccord, l'agent la renvoie au N+1 avec
   un mot.
*/

export default function MonEvaluationPage() {
  const router = useRouter();
  const demandee = anneeDeLAdresse(useSearchParams().get('annee'));
  const mes = useQuery({
    queryKey: [...CLE_EVALUATIONS, 'moi'],
    queryFn: () => api<MesEvaluations>('/evaluations/moi'),
  });
  const annees = mes.data?.annees ?? [];
  const employeeId = mes.data?.employeeId ?? null;
  const annee =
    demandee !== null && annees.some((a) => a.annee === demandee)
      ? demandee
      : (annees[0]?.annee ?? null);
  const grille = useQuery({
    queryKey: cleDeLaGrille(employeeId ?? '', annee),
    queryFn: () => api<VueDeGrille>(`/evaluations/grilles/${employeeId}/${annee}`),
    enabled: employeeId !== null && annee !== null,
    retry: false,
  });
  const vue = grille.data;
  const onglets = annees.map((a) => ({ cle: String(a.annee), label: String(a.annee) }));
  const choisir = (cle: string) =>
    router.replace(`/moi/evaluation?annee=${cle}`, { scroll: false });
  // Renvoyée au N+1, la grille quitte la page : le message reste, lui.
  const [renvoyee, setRenvoyee] = useState<number | null>(null);
  const messageDuRenvoi =
    renvoyee !== null ? `Grille d’évaluation ${renvoyee} renvoyée à votre N+1` : null;

  if (mes.isLoading || (grille.isLoading && annee !== null)) {
    return (
      <Page>
        <Skeleton className="h-[158px] w-full rounded-bloc" />
        <Skeleton className="h-72 w-full rounded-bloc" />
      </Page>
    );
  }
  const erreur = mes.error ?? grille.error;
  if (erreur || annee === null || !vue) {
    const probleme = erreur instanceof ApiError ? erreur.problem : null;
    return (
      <Page>
        <Card>
          <EmptyState
            className="py-14"
            icon={<Icon name="rate_review" size={22} />}
            title={
              erreur
                ? (probleme?.title ?? 'Votre grille d’évaluation ne s’affiche pas')
                : (messageDuRenvoi ?? 'Votre grille d’évaluation n’est pas encore disponible')
            }
          />
        </Card>
      </Page>
    );
  }

  return (
    <Page>
      {onglets.length > 1 ? (
        <>
          <OngletsDeLEntete courant={String(annee)} onChange={choisir} onglets={onglets} />
          <Onglets
            courant={String(annee)}
            onChange={choisir}
            onglets={onglets}
            label="Choisir l’année"
            className="w-max lg:hidden"
          />
        </>
      ) : null}
      {messageDuRenvoi ? (
        <p
          role="status"
          className="flex items-center gap-2 rounded-bloc bg-success-soft px-3.5 py-2.5 text-[12.5px] text-success ring-1 ring-current/15 ring-inset"
        >
          <Icon name="check_circle" size={16} />
          {messageDuRenvoi}
        </p>
      ) : null}
      <EnTete
        titre={`Évaluation annuelle ${vue.annee}`}
        sousTitre={vue.agent.poste ?? undefined}
        reperes={
          <>
            <Repere
              label="Étape"
              valeur={
                vue.etat === 'chez_agent'
                  ? 'À valider'
                  : vue.etat === 'terminee'
                    ? 'Transmise à la DCH'
                    : 'Validée'
              }
              ton={vue.etat === 'chez_agent' ? 'attente' : undefined}
            />
            <Repere label="Évaluateur (N+1)" valeur={vue.evaluateur} />
            <Repere
              label="Reçue le"
              valeur={vue.dates.envoyeeLe ? leEnLettres(vue.dates.envoyeeLe) : null}
            />
            <Repere label="Période" valeur={periodeEnTete(vue.periode)} />
          </>
        }
      />
      <Card>
        <div className="px-5 py-4">
          <CardTitle>Grille d’évaluation</CardTitle>
        </div>
        <GrilleEnLecture vue={vue} />
      </Card>
      <Ratification
        key={`${vue.annee}-${vue.etat}`}
        vue={vue}
        onRenvoyee={() => setRenvoyee(vue.annee)}
      />
    </Page>
  );
}

/**
 * La ratification de l'entretien : les commentaires éventuels de l'agent,
 * puis « Valider » ; ou « Renvoyer au N+1 », avec un mot. Validée, la carte
 * garde la date et les commentaires.
 */
function Ratification({ vue, onRenvoyee }: { vue: VueDeGrille; onRenvoyee: () => void }) {
  const qc = useQueryClient();
  const [commentaires, setCommentaires] = useState(vue.commentairesAgent);
  const [mot, setMot] = useState('');
  const [fenetre, setFenetre] = useState<'valider' | 'renvoyer' | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  useGardeDeSaisie(vue.actions.valider && (commentaires.trim() !== '' || mot.trim() !== ''));

  const geste = useMutation({
    // Le renvoi ne rend rien : la grille quitte la page de l'agent.
    mutationFn: ({ route, corps }: { route: 'validation' | 'renvoi'; corps: unknown }) =>
      api<VueDeGrille | undefined>(`/evaluations/grilles/${vue.employeeId}/${vue.annee}/${route}`, {
        method: 'POST',
        body: corps,
      }),
    onMutate: () => setErreur(null),
    onSuccess: async (nouvelle, { route }) => {
      setFenetre(null);
      if (route === 'renvoi' || !nouvelle) {
        // Renvoyée, la grille retourne au N+1 : elle quitte la page de l'agent.
        onRenvoyee();
        await qc.invalidateQueries({ queryKey: [...CLE_EVALUATIONS, 'moi'] });
        qc.removeQueries({ queryKey: cleDeLaGrille(vue.employeeId, vue.annee) });
        return;
      }
      qc.setQueryData(cleDeLaGrille(vue.employeeId, vue.annee), nouvelle);
      await qc.invalidateQueries({ queryKey: [...CLE_EVALUATIONS, 'moi'] });
    },
    onError: (e) => setErreur(messageDe(e)),
  });

  if (!vue.actions.valider) {
    return (
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 pt-4">
          <CardTitle>Ratification de l’entretien</CardTitle>
          {vue.dates.valideeAgentLe ? (
            <span className="text-[11.5px] text-ink-muted">
              Validée le {leEnLettres(vue.dates.valideeAgentLe)}
            </span>
          ) : null}
        </div>
        <div className="px-5 pt-3 pb-5">
          <p className="mb-1.5 text-[9.5px] font-bold tracking-[0.1em] text-ink-muted uppercase">
            Commentaires éventuels de l’évalué
          </p>
          {vue.commentairesAgent ? (
            <p className="text-[12.5px] leading-relaxed break-words whitespace-pre-line text-ink-strong">
              {vue.commentairesAgent}
            </p>
          ) : (
            <p className="text-[12.5px] text-ink-muted/70">Sans commentaire</p>
          )}
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="px-5 pt-4">
        <CardTitle>Ratification de l’entretien</CardTitle>
      </div>
      <div className="px-5 pt-4 pb-5">
        <Field label="Commentaires éventuels de l’évalué" htmlFor="commentaires-agent">
          <ZoneDeTexte
            id="commentaires-agent"
            max={LIMITES_DE_LA_GRILLE.commentairesAgent}
            value={commentaires}
            onChange={(e) => setCommentaires(e.target.value)}
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line-soft px-5 py-4">
        {erreur && !fenetre ? (
          <p role="alert" className="mr-auto text-[12px] text-danger">
            {erreur}
          </p>
        ) : null}
        <Button variant="secondary" onClick={() => setFenetre('renvoyer')}>
          <Icon name="replay" size={15} />
          Renvoyer au N+1
        </Button>
        <Button onClick={() => setFenetre('valider')}>
          <Icon name="check" size={15} />
          Valider
        </Button>
      </div>

      {fenetre === 'valider' ? (
        <Confirmation
          titre="Valider la grille ?"
          libelle="Valider"
          enCours={geste.isPending}
          erreur={erreur}
          onConfirmer={() =>
            geste.mutate({ route: 'validation', corps: { commentaires: commentaires.trim() } })
          }
          onClose={() => setFenetre(null)}
        >
          Votre grille d’évaluation {vue.annee} repart à votre N+1
          {commentaires.trim() ? ', avec vos commentaires' : ''}. Elle ne pourra plus être modifiée.
        </Confirmation>
      ) : null}
      {fenetre === 'renvoyer' ? (
        <Modal
          open
          onClose={() => setFenetre(null)}
          title="Renvoyer la grille au N+1"
          maxWidth="max-w-md"
          footer={
            <>
              <Button variant="secondary" onClick={() => setFenetre(null)}>
                Annuler
              </Button>
              <Button
                disabled={mot.trim() === ''}
                loading={geste.isPending}
                onClick={() => geste.mutate({ route: 'renvoi', corps: { mot: mot.trim() } })}
              >
                Renvoyer
              </Button>
            </>
          }
        >
          {erreur ? <Erreur>{erreur}</Erreur> : null}
          <Field label="Votre mot au N+1" htmlFor="mot-renvoi" required>
            <ZoneDeTexte
              id="mot-renvoi"
              autoFocus
              max={LIMITES_DE_LA_GRILLE.renvoi}
              value={mot}
              onChange={(e) => setMot(e.target.value)}
            />
          </Field>
        </Modal>
      ) : null}
    </Card>
  );
}
