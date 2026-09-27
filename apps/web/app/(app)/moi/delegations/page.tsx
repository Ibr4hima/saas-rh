'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import {
  CAPACITE_INFOS,
  CAPACITES,
  type Capacite,
  type InfoCapacite,
  type MembreHabilite,
} from '@teranga/contracts';
import { Card, CardContent, CardHeader, CardTitle, cn, EmptyState, Skeleton } from '@teranga/ui';
import { CorpsDefilant, CartePleine, Page } from '../../../../components/gabarit';
import { Icon } from '../../../../components/icons';
import {
  BandeauMessage,
  texteErreur,
  useMembresDCH,
  type Message,
} from '../../../../components/traitement-dch';
import { api } from '../../../../lib/api';

/* ————————————————————————————————————————————————————————————————
   Les délégations du directeur du Capital Humain.

   Toutes les demandes du personnel et tous les accès de gestion reviennent
   au directeur. Il les confie, une à une, aux membres de sa direction : il
   connaît son équipe, et certaines parties sont sensibles. Ce qui est confié
   arrive directement au membre ; le directeur voit tout, et garde la main.

   Les délégations appartiennent à la DCH : quand elle change de
   responsable, elles restent en place — le nouveau les trouve ici. Un
   membre qui quitte la direction perd les siennes.

   Une ligne par habilitation, les membres en pastilles : pleine, c'est
   confié ; un clic confie ou retire. La grille tient sur un téléphone, là
   où un tableau membres × habilitations déborderait.
   ———————————————————————————————————————————————————————————————— */

const GROUPES: InfoCapacite['groupe'][] = [
  'Demandes',
  'Documents',
  'Personnel',
  'Congés',
  'Organisation',
];

/** Ce que dit chaque famille — au directeur (« vous »), ou à qui ne fait que lire. */
const introGroupe = (groupe: InfoCapacite['groupe'], directeur: boolean): string =>
  ({
    Demandes: `Les demandes des agents vont directement aux membres choisis — tous sont prévenus, le premier qui la traite l’emporte. Sans membre disponible, elles ${directeur ? 'vous reviennent' : 'reviennent à qui dirige la DCH'}.`,
    Documents:
      'Chaque type de document se confie à part : les attestations de travail à l’un, les bulletins de salaire à l’autre. Chaque document demandé va à qui traite son type.',
    Personnel: 'L’accès aux dossiers du personnel.',
    Congés: 'Les soldes, les types d’absence et les jours fériés.',
    Organisation: 'Les autres espaces de gestion.',
  })[groupe];

export default function DelegationsPage() {
  const queryClient = useQueryClient();
  const etat = useMembresDCH();
  const [message, setMessage] = useState<Message>(null);

  const basculer = useMutation({
    mutationFn: (v: { membre: MembreHabilite; capacite: Capacite; accordee: boolean }) =>
      api('/habilitations', {
        method: 'PUT',
        body: { employeeId: v.membre.employeeId, capacite: v.capacite, accordee: v.accordee },
      }),
    onSuccess: async (_, v) => {
      const libelle = CAPACITE_INFOS[v.capacite].libelle.toLowerCase();
      setMessage({
        ton: 'ok',
        texte: v.accordee
          ? `${v.membre.nom} : ${libelle}, confié — une notification lui est envoyée.`
          : `${v.membre.nom} : ${libelle}, retiré — vous reprenez la main.`,
      });
      await queryClient.invalidateQueries({ queryKey: ['habilitations'] });
      await queryClient.invalidateQueries({ queryKey: ['validations-compteurs'] });
    },
    onError: (err) => setMessage({ ton: 'erreur', texte: texteErreur(err) }),
  });

  const d = etat.data;
  const modifiable = Boolean(d?.estDirecteur);

  return (
    <Page>
      {message ? <BandeauMessage message={message} /> : null}

      <Card className="shrink-0">
        <CardContent className="flex items-start gap-3 pt-5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-[11px] bg-primary/[0.07] text-primary">
            <Icon name="verified_user" size={19} />
          </span>
          <div className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-ink">
            {etat.isLoading ? (
              <Skeleton className="h-4 w-64" />
            ) : !d?.direction ? (
              <>
                Aucune direction n’est désignée comme Direction du Capital Humain.{' '}
                <Link href="/organisation" className="font-semibold text-primary hover:underline">
                  Organigramme
                </Link>
              </>
            ) : modifiable ? (
              <>
                Vous dirigez la <span className="font-semibold">{d.direction.nom}</span> : toutes
                les demandes et tous les accès vous reviennent. Confiez-en aux membres de votre
                direction. Ces délégations restent en place si la direction change de responsable.
              </>
            ) : (
              <>
                Qui peut quoi à la <span className="font-semibold">{d.direction.nom}</span>
                {d.directeur ? `, que dirige ${d.directeur.nom}` : ''}. Seule la personne qui dirige
                la DCH modifie les délégations.
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <CartePleine>
        <CardHeader className="shrink-0">
          <CardTitle>{modifiable ? 'Ce que vous confiez' : 'Qui peut quoi'}</CardTitle>
        </CardHeader>
        <CorpsDefilant className="px-4 pb-4">
          {etat.isLoading ? (
            <div className="flex flex-col gap-3">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : !d || d.membres.length === 0 ? (
            <EmptyState
              className="py-10"
              icon={<Icon name="groups" size={22} />}
              title="Personne à qui confier"
              description="Aucun autre membre de la DCH n’a encore accès au portail. Ouvrez-leur un accès depuis leur fiche."
            />
          ) : (
            <div className="flex flex-col gap-6">
              {GROUPES.map((groupe) => (
                <section key={groupe}>
                  <h2 className="text-[11px] font-bold tracking-[0.08em] text-ink-muted uppercase">
                    {groupe}
                  </h2>
                  <p className="mt-1 text-[12px] leading-snug text-ink-muted">
                    {introGroupe(groupe, modifiable)}
                  </p>
                  <ul className="mt-2 flex flex-col divide-y divide-line-soft">
                    {CAPACITES.filter((c) => CAPACITE_INFOS[c].groupe === groupe).map((c) => (
                      <LigneCapacite
                        key={c}
                        capacite={c}
                        membres={d.membres}
                        modifiable={modifiable}
                        enCours={
                          basculer.isPending && basculer.variables?.capacite === c
                            ? basculer.variables.membre.employeeId
                            : null
                        }
                        onBasculer={(membre, accordee) => {
                          setMessage(null);
                          basculer.mutate({ membre, capacite: c, accordee });
                        }}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </CorpsDefilant>
      </CartePleine>
    </Page>
  );
}

function LigneCapacite({
  capacite,
  membres,
  modifiable,
  enCours,
  onBasculer,
}: {
  capacite: Capacite;
  membres: MembreHabilite[];
  modifiable: boolean;
  /** Le membre dont la pastille attend la réponse du serveur. */
  enCours: string | null;
  onBasculer: (membre: MembreHabilite, accordee: boolean) => void;
}) {
  const info = CAPACITE_INFOS[capacite];
  const qui = membres.filter((m) => m.capacites.includes(capacite));
  return (
    <li className="flex flex-col gap-2 py-3 lg:flex-row lg:items-start lg:gap-6">
      <div className="min-w-0 lg:w-72 lg:shrink-0">
        <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-strong">
          {info.libelle}
          {info.sensible ? (
            <span
              title="Données sensibles : à confier avec soin."
              className="inline-flex items-center gap-0.5 rounded-full bg-hover px-1.5 py-px text-[10px] font-semibold text-ink-muted"
            >
              <Icon name="lock" size={11} />
              Sensible
            </span>
          ) : null}
        </p>
        <p className="mt-0.5 text-[11.5px] leading-snug text-ink-muted">{info.description}</p>
        {qui.length === 0 ? (
          <p className="mt-0.5 text-[11.5px] text-ink-muted italic">
            {modifiable
              ? 'Personne d’autre que vous, pour l’instant.'
              : 'Personne d’autre que qui dirige la DCH, pour l’instant.'}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1.5 lg:flex-1 lg:justify-end">
        {membres.map((m) => {
          const accordee = m.capacites.includes(capacite);
          return (
            <button
              key={m.employeeId}
              type="button"
              disabled={!modifiable || enCours !== null}
              aria-pressed={accordee}
              title={
                accordee
                  ? `${m.nom} — confié. Cliquer pour retirer.`
                  : `${m.nom} — cliquer pour confier.`
              }
              onClick={() => onBasculer(m, !accordee)}
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-semibold ring-1 transition-colors duration-150 ring-inset focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none disabled:cursor-default',
                accordee
                  ? 'bg-primary text-primary-ink ring-primary'
                  : 'bg-surface text-ink ring-card-line enabled:hover:bg-hover',
                enCours === m.employeeId && 'opacity-60',
              )}
            >
              {accordee ? <Icon name="check" size={13} /> : null}
              {m.nom}
              {m.absent ? <span className="font-normal opacity-75">· en congé</span> : null}
            </button>
          );
        })}
      </div>
    </li>
  );
}
