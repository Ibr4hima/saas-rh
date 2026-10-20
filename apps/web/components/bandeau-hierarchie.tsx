'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import {
  bloqueLEvaluation,
  type AnomalieHierarchie,
  type ChangementParLaRegle,
  type ControleHierarchie,
  type TypeAnomalieHierarchie,
  peut,
} from '@teranga/contracts';
import { Badge, Button } from '@teranga/ui';
import { api, ApiError } from '../lib/api';
import { useMe } from '../lib/hooks';
import { compte } from '../lib/mots';
import { Icon } from './icons';
import { Modal } from './modal';
import { BandeauDelegation } from './traitement-dch';

/* ————————————————————————————————————————————————————————————————
   L'avertissement de la chaîne hiérarchique (ADR-0147).

   Le N+1 hiérarchique se calcule à partir de l'organigramme : ce N+1 ne
   peut plus être « faux ». Ce bandeau dit seulement ce qui EMPÊCHE de le
   calculer (un agent sans affectation, une Direction Générale sans DG), et,
   le temps du passage à la règle, les N+1 qu'elle a changés, à revoir une
   fois.

   Il ne s'affiche que s'il a quelque chose à dire. Un bandeau permanent
   « tout va bien » se met à ne plus se lire au bout d'une semaine, et le jour
   où il change, personne ne le voit.

   L'ORANGE est celui de l'attente, comme partout dans le produit : ces
   dossiers ne sont pas en faute, ils sont incomplets. Le rouge dirait « vous
   avez cassé quelque chose », ce qui serait faux.
   ———————————————————————————————————————————————————————————————— */

export const MOTS: Record<TypeAnomalieHierarchie, { court: string; explication: string }> = {
  sans_unite: {
    court: 'Sans affectation',
    explication: 'Sans unité, son N+1 hiérarchique ne peut pas se calculer.',
  },
  sans_dg: {
    court: 'Sans DG',
    explication: 'La Direction Générale n’a pas de DG : personne au-dessus.',
  },
  dg_hors_direction_generale: {
    court: 'DG hors Direction Générale',
    explication: 'Le DG siège à la Direction Générale : réaffectez cette personne.',
  },
};

export function BandeauHierarchie() {
  const me = useMe();
  // La route est réservée à l'administration et à la RH : ne pas la demander
  // pour les autres évite un 403 périodique dans la console.
  const autorise =
    peut(me.data, 'organigramme') || peut(me.data, 'personnel.gerer') || peut(me.data, 'pilotage');
  const revoit = peut(me.data, 'personnel.gerer');
  const controle = useQuery({
    queryKey: ['hierarchie-controle'],
    queryFn: () => api<ControleHierarchie>('/hierarchie/controle'),
    enabled: autorise,
    staleTime: 60_000,
  });
  const [ouvert, setOuvert] = useState<'anomalies' | 'changes' | null>(null);

  const c = controle.data;
  if (!c) return null;
  const changes = revoit ? c.changesParLaRegle : [];
  const aSignaler =
    c.anomalies.length > 0 ||
    c.sommetsMultiples.length > 0 ||
    c.directionsHorsDG.length > 0 ||
    c.directeurGeneral === null;
  if (!aSignaler && changes.length === 0) return null;

  return (
    <>
      {aSignaler ? (
        <BandeauDelegation
          ton="orange"
          icone="warning"
          texte={
            <>
              {c.sommetsMultiples.length > 1 ? (
                <>
                  L’organigramme a {c.sommetsMultiples.length} sommets (
                  {c.sommetsMultiples.join(', ')}) : rattachez-les sous la Direction Générale, il
                  n’en faut qu’un.{' '}
                </>
              ) : null}
              {c.directionsHorsDG.length > 0 ? (
                <>
                  {c.directionsHorsDG.join(', ')} : une direction se rattache à la Direction
                  Générale.{' '}
                </>
              ) : null}
              {c.anomalies.length > 0 ? (
                <>{compte(c.anomalies.length, 'dossier')} à compléter.</>
              ) : null}
              {c.directeurGeneral === null ? (
                <> Aucun DG n’est désigné à la tête de l’organigramme.</>
              ) : null}
            </>
          }
          action={
            c.anomalies.length > 0 ? (
              <Button size="sm" variant="secondary" onClick={() => setOuvert('anomalies')}>
                Consulter
              </Button>
            ) : undefined
          }
        />
      ) : null}
      {changes.length > 0 ? (
        <BandeauDelegation
          icone="account_tree"
          texte={
            <>
              {compte(changes.length, 'agent')} dont le N+1 hiérarchique a changé avec
              l’organigramme
            </>
          }
          action={
            <Button size="sm" variant="secondary" onClick={() => setOuvert('changes')}>
              Revoir
            </Button>
          }
        />
      ) : null}

      {ouvert === 'anomalies' ? (
        <FenetreAnomalies controle={c} onClose={() => setOuvert(null)} />
      ) : null}
      {ouvert === 'changes' && changes.length > 0 ? (
        <FenetreChanges changes={changes} onClose={() => setOuvert(null)} />
      ) : null}
    </>
  );
}

/**
 * La liste, pour corriger.
 *
 * Chaque ligne mène à SA fiche : la correction se fait là, sur le dossier, et
 * non dans un écran de réglages où l'on perdrait le contexte. On revient
 * ensuite ici : le bandeau se recompte tout seul.
 */
function FenetreAnomalies({
  controle,
  onClose,
}: {
  controle: ControleHierarchie;
  onClose: () => void;
}) {
  return (
    <Modal
      open
      onClose={onClose}
      title="Chaîne hiérarchique à compléter"
      subtitle={`${compte(controle.anomalies.length, 'dossier')} sur ${compte(controle.effectif, 'agent')} · ${controle.nonEvaluables} hors du champ de l’évaluation`}
      maxWidth="max-w-3xl"
      footer={<Button onClick={onClose}>Fermer</Button>}
    >
      <ul className="flex flex-col gap-1.5">
        {controle.anomalies.map((a) => (
          <Ligne key={`${a.employeeId}-${a.type}`} anomalie={a} />
        ))}
      </ul>
    </Modal>
  );
}

function Ligne({ anomalie }: { anomalie: AnomalieHierarchie }) {
  const mots = MOTS[anomalie.type];
  const bloquant = bloqueLEvaluation(anomalie.type);
  return (
    <li>
      <Link
        href={`/employees/${anomalie.employeeId}`}
        className="group flex flex-wrap items-center gap-x-3 gap-y-1 rounded-bloc border border-line-soft px-3.5 py-2.5 transition-colors hover:border-primary/40 hover:bg-hover"
      >
        <span className="w-20 shrink-0 font-mono text-[11.5px] text-ink-muted">
          {anomalie.matricule}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-bold text-ink-strong">
            {anomalie.nom}
          </span>
          <span className="block truncate text-[11.5px] text-ink-muted">
            {anomalie.direction ?? 'Sans direction'}
            {anomalie.responsable ? (
              <>
                {' · N+1 fonctionnel '}
                {anomalie.responsable}
                {anomalie.directionDuResponsable ? ` (${anomalie.directionDuResponsable})` : ''}
              </>
            ) : null}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          {/* L'orange pour ce qui ARRÊTE l'évaluation, le gris pour ce qui se
              corrige sans bloquer : la RH doit savoir par où commencer. */}
          <Badge tone={bloquant ? 'orange' : 'gris'}>{mots.court}</Badge>
          <span className="hidden max-w-xs text-right text-[11px] leading-snug text-ink-muted sm:block">
            {mots.explication}
          </span>
        </span>
        <Icon
          name="chevron_right"
          size={15}
          className="shrink-0 text-ink-muted/60 transition-transform group-hover:translate-x-0.5"
        />
      </Link>
    </li>
  );
}

/**
 * Les N+1 que le passage à la règle a changés, revus un par un : l'ancien
 * N+1 peut rester N+1 fonctionnel (et fixe alors les objectifs, puis évalue),
 * ou le nouveau est validé. Dans les deux cas, l'agent quitte la liste.
 */
function FenetreChanges({
  changes,
  onClose,
}: {
  changes: ChangementParLaRegle[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [erreur, setErreur] = useState<string | null>(null);
  const revoir = useMutation({
    mutationFn: ({ id, garder }: { id: string; garder: boolean }) =>
      api(`/hierarchie/regle/${id}`, { method: 'POST', body: { garder } }),
    onSuccess: async (_r, { id }) => {
      setErreur(null);
      // La liste se vide au fil des revues : vide, la fenêtre n'a plus d'objet.
      if (changes.every((c) => c.employeeId === id)) onClose();
      await queryClient.invalidateQueries({ queryKey: ['hierarchie-controle'] });
      await queryClient.invalidateQueries({ queryKey: ['employee', id] });
      await queryClient.invalidateQueries({ queryKey: ['employees'] });
    },
    onError: (err) =>
      setErreur(err instanceof ApiError ? err.message : 'Enregistrement impossible.'),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="N+1 hiérarchiques changés"
      subtitle={compte(changes.length, 'agent')}
      maxWidth="max-w-3xl"
      footer={
        <>
          {erreur ? (
            <p
              role="alert"
              className="min-w-0 flex-1 rounded-lg bg-danger-soft px-3 py-2 text-xs font-semibold text-danger"
            >
              {erreur}
            </p>
          ) : null}
          <Button onClick={onClose}>Fermer</Button>
        </>
      }
    >
      <ul className="flex flex-col gap-1.5">
        {changes.map((c) => {
          const enCours = revoir.isPending && revoir.variables?.id === c.employeeId;
          return (
            <li
              key={c.employeeId}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-bloc border border-line-soft px-3.5 py-2.5"
            >
              <span className="w-20 shrink-0 font-mono text-[11.5px] text-ink-muted">
                {c.matricule}
              </span>
              <span className="min-w-0 flex-1">
                <Link
                  href={`/employees/${c.employeeId}`}
                  className="block truncate text-[12.5px] font-bold text-ink-strong transition-colors hover:text-primary"
                >
                  {c.nom}
                </Link>
                <span className="block truncate text-[11.5px] text-ink-muted">
                  {c.avant.nom}
                  <Icon name="arrow_forward" size={13} className="mx-1 align-[-2px]" />
                  <span className="font-semibold text-ink">{c.apres?.nom ?? 'aucun N+1'}</span>
                </span>
              </span>
              <span className="flex w-full flex-wrap gap-2 sm:w-auto sm:shrink-0">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={revoir.isPending}
                  loading={enCours && revoir.variables?.garder === true}
                  onClick={() => revoir.mutate({ id: c.employeeId, garder: true })}
                >
                  Garder {c.avant.nom} comme N+1 fonctionnel
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={revoir.isPending}
                  loading={enCours && revoir.variables?.garder === false}
                  onClick={() => revoir.mutate({ id: c.employeeId, garder: false })}
                >
                  Valider
                </Button>
              </span>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
