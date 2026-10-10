'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import {
  bloqueLEvaluation,
  type AnomalieHierarchie,
  type ControleHierarchie,
  type TypeAnomalieHierarchie,
  peut,
} from '@teranga/contracts';
import { Badge, Button } from '@teranga/ui';
import { api } from '../lib/api';
import { useMe } from '../lib/hooks';
import { compte } from '../lib/mots';
import { Icon } from './icons';
import { Modal } from './modal';
import { BandeauDelegation } from './traitement-dch';

/* ————————————————————————————————————————————————————————————————
   L'avertissement de la chaîne hiérarchique.

   Deux règles à l'APIX : chaque agent a un n+1 — seul le directeur général
   n'en a pas —, et ce n+1 est de sa direction. Elles ne se tiennent pas par
   un refus : on crée souvent un dossier avant de savoir de qui l'agent
   relèvera, et un import n'en sait rien. Elles se tiennent par CE BANDEAU, et
   par une conséquence : sans n+1, ni objectifs ni évaluation.

   Il ne s'affiche que s'il a quelque chose à dire. Un bandeau permanent
   « tout va bien » se met à ne plus se lire au bout d'une semaine, et le jour
   où il change, personne ne le voit.

   L'ORANGE est celui de l'attente, comme partout dans le produit : ces
   dossiers ne sont pas en faute, ils sont incomplets. Le rouge dirait « vous
   avez cassé quelque chose », ce qui serait faux.
   ———————————————————————————————————————————————————————————————— */

export const MOTS: Record<TypeAnomalieHierarchie, { court: string; explication: string }> = {
  boucle: {
    court: 'Boucle',
    explication: 'Sa chaîne de n+1 revient sur elle-même : elle ne remonte plus.',
  },
  dg_rattache: {
    court: 'DG rattaché',
    explication: 'Le directeur général ne relève de personne : retirez son n+1.',
  },
  sans_responsable: {
    court: 'Sans n+1',
    explication: 'Personne ne peut lui fixer d’objectifs ni l’évaluer.',
  },
  responsable_archive: {
    court: 'n+1 inactif',
    explication: 'Son responsable a quitté l’agence : il faut le remplacer.',
  },
  responsable_stagiaire: {
    court: 'n+1 stagiaire',
    explication: 'Son responsable est en stage : il faut le remplacer.',
  },
  dg_hors_direction_generale: {
    court: 'DG hors Direction Générale',
    explication: 'Le directeur général siège à la Direction Générale : réaffectez-le.',
  },
  directeur_mal_rattache: {
    court: 'Directeur mal rattaché',
    explication: 'Un directeur relève du directeur général, de personne d’autre.',
  },
  chef_mal_rattache: {
    court: 'Chef mal rattaché',
    explication:
      'Le responsable d’un département ou d’un service relève du responsable de l’unité au-dessus de la sienne.',
  },
  hors_direction: {
    court: 'Autre direction',
    explication: 'Son responsable appartient à une autre direction que la sienne.',
  },
  sans_direction: {
    court: 'Sans affectation',
    explication: 'Sans direction, la règle de rattachement ne peut pas être vérifiée.',
  },
  responsable_sans_direction: {
    court: 'n+1 sans affectation',
    explication: 'Son responsable n’est affecté à aucune direction : affectez-le d’abord.',
  },
};

export function BandeauHierarchie() {
  const me = useMe();
  // La route est réservée à l'administration et à la RH : ne pas la demander
  // pour les autres évite un 403 périodique dans la console.
  const autorise =
    peut(me.data, 'organigramme') || peut(me.data, 'personnel.gerer') || peut(me.data, 'pilotage');
  const controle = useQuery({
    queryKey: ['hierarchie-controle'],
    queryFn: () => api<ControleHierarchie>('/hierarchie/controle'),
    enabled: autorise,
    staleTime: 60_000,
  });
  const [ouvert, setOuvert] = useState(false);

  const c = controle.data;
  if (!c || (c.anomalies.length === 0 && c.sommetsMultiples.length === 0)) return null;

  return (
    <>
      <BandeauDelegation
        ton="orange"
        icone="warning"
        texte={
          <>
            {c.sommetsMultiples.length > 1 ? (
              <>
                L’organigramme a {c.sommetsMultiples.length} sommets (
                {c.sommetsMultiples.join(', ')}) : rattachez-les sous la Direction Générale, il n’en
                faut qu’un.{' '}
              </>
            ) : null}
            {c.anomalies.length > 0 ? (
              <>{compte(c.anomalies.length, 'dossier')} à compléter</>
            ) : null}
            {c.directeurGeneral === null ? (
              <> Aucun directeur général n’est désigné à la tête de l’organigramme.</>
            ) : null}
          </>
        }
        action={
          c.anomalies.length > 0 ? (
            <Button size="sm" variant="secondary" onClick={() => setOuvert(true)}>
              Consulter
            </Button>
          ) : undefined
        }
      />

      {ouvert ? <FenetreAnomalies controle={c} onClose={() => setOuvert(false)} /> : null}
    </>
  );
}

/**
 * La liste, pour corriger.
 *
 * Chaque ligne mène à SA fiche : la correction se fait là, sur le dossier, et
 * non dans un écran de réglages où l'on perdrait le contexte. On revient
 * ensuite ici — le bandeau se recompte tout seul.
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
          <Ligne key={a.employeeId} anomalie={a} />
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
        className="group flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[10px] border border-line-soft px-3.5 py-2.5 transition-colors hover:border-primary/40 hover:bg-hover"
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
                {' · n+1 '}
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
