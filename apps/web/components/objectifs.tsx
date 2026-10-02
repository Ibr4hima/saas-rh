'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  EVALUATIONS_OBJECTIF,
  LIBELLES_DIFFUSION,
  LIBELLES_EVALUATION,
  type CreerObjectifInput,
  type DiffusionObjectif,
  type EvaluationObjectif,
  type FormationProposable,
  type ObjectifView,
} from '@teranga/contracts';
import { Button, cn, Field, Input, Select, Textarea } from '@teranga/ui';
import { api } from '../lib/api';
import { formatDate } from '../lib/hooks';
import { PastilleEtat } from './academy-equipe';
import { Icon, type IconName } from './icons';
import { Modal, ModalSection } from './modal';
import { messageErreur } from './reglages-absences';

/* ————————————————————————————————————————————————————————————————
   Les objectifs, à l'écran — les pièces communes à « Mes objectifs », au
   « Suivi & Évaluation » d'un n+1 et aux « Objectifs de l'APIX » du DG.
   ———————————————————————————————————————————————————————————————— */

/** Tout ce qui touche aux objectifs se relit d'un coup après un geste. */
export const CLE_OBJECTIFS = ['objectifs'] as const;

const TONS_EVALUATION: Record<EvaluationObjectif, string> = {
  atteint: 'bg-success-soft/55 text-success ring-success/25',
  partiel: 'bg-primary-soft/55 text-primary ring-primary/25',
  non_atteint: 'bg-danger-soft/55 text-danger ring-danger/25',
};

const ICONES_EVALUATION: Record<EvaluationObjectif, IconName> = {
  atteint: 'check_circle',
  partiel: 'trending_up',
  non_atteint: 'close',
};

function Pastille({ ton, icone, children }: { ton: string; icone: IconName; children: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-[3px] text-[11px] font-semibold whitespace-nowrap ring-1 ring-inset',
        ton,
      )}
    >
      <Icon name={icone} size={13} />
      {children}
    </span>
  );
}

/** Où en est l'objectif : son évaluation, l'état de la formation, ou son retard. */
export function EtatObjectif({ objectif }: { objectif: ObjectifView }) {
  if (objectif.formation) {
    if (!objectif.formation.statut) {
      return (
        <Pastille ton="bg-line-soft/55 text-ink-muted ring-ink-muted/20" icone="school">
          Formation retirée
        </Pastille>
      );
    }
    return <PastilleEtat statut={objectif.formation.statut} />;
  }
  if (objectif.evaluation) {
    return (
      <Pastille
        ton={TONS_EVALUATION[objectif.evaluation]}
        icone={ICONES_EVALUATION[objectif.evaluation]}
      >
        {LIBELLES_EVALUATION[objectif.evaluation]}
      </Pastille>
    );
  }
  if (objectif.enRetard) {
    return (
      <Pastille ton={TONS_EVALUATION.non_atteint} icone="schedule">
        En retard
      </Pastille>
    );
  }
  return null;
}

export function BoutonIcone({
  icone,
  label,
  onClick,
  danger,
}: {
  icone: IconName;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'inline-flex size-8 items-center justify-center rounded-md text-ink-muted transition-colors duration-150',
        danger
          ? 'hover:bg-danger-soft hover:text-danger'
          : 'hover:bg-primary-soft hover:text-primary',
      )}
    >
      <Icon name={icone} size={17} />
    </button>
  );
}

/**
 * Une ligne d'objectif : l'intitulé, sa description, l'échéance, et son état.
 * `gestes` : les boutons de qui a la main (évaluer, modifier, supprimer).
 */
export function LigneObjectif({
  objectif,
  auteur = false,
  lienFormation = false,
  gestes,
}: {
  objectif: ObjectifView;
  /** Dire qui l'a fixé. */
  auteur?: boolean;
  /** L'agent lui-même : la formation s'ouvre d'un clic. */
  lienFormation?: boolean;
  gestes?: React.ReactNode;
}) {
  const o = objectif;
  const meta: React.ReactNode[] = [];
  if (o.formation) {
    meta.push(
      <span key="f" className="inline-flex items-center gap-1">
        <Icon name="school" size={14} className="text-ink-muted" />
        Formation
        {o.formation.lecons > 0 ? ` · ${o.formation.validees}/${o.formation.lecons} leçons` : ''}
      </span>,
    );
  }
  if (o.echeance) {
    meta.push(
      <span key="e" className={cn(o.enRetard && 'font-semibold text-danger')}>
        Pour le {formatDate(o.echeance)}
      </span>,
    );
  }
  if (o.diffusion) meta.push(<span key="d">{LIBELLES_DIFFUSION[o.diffusion]}</span>);
  if (auteur && o.auteur) meta.push(<span key="a">Fixé par {o.auteur}</span>);

  return (
    <li className="flex flex-col gap-2 rounded-[11px] px-3 py-3 transition-colors duration-150 hover:bg-hover sm:flex-row sm:items-start sm:gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] leading-snug font-semibold text-ink-strong">
          {lienFormation && o.formation?.courseId ? (
            <Link href={`/academy/${o.formation.courseId}`} className="hover:text-primary">
              {o.titre}
            </Link>
          ) : (
            o.titre
          )}
        </p>
        {o.description ? (
          <p className="mt-1 text-[12.5px] leading-relaxed whitespace-pre-line text-ink-muted">
            {o.description}
          </p>
        ) : null}
        {meta.length ? (
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-ink-muted">
            {meta.map((m, i) => (
              <React.Fragment key={i}>
                {i > 0 ? <span aria-hidden>·</span> : null}
                {m}
              </React.Fragment>
            ))}
          </p>
        ) : null}
        {o.commentaire ? (
          <p className="mt-1.5 text-[12px] leading-snug text-ink italic">« {o.commentaire} »</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5 sm:pt-0.5">
        <EtatObjectif objectif={o} />
        {gestes}
      </div>
    </li>
  );
}

/** Ce qu'une fenêtre d'objectif crée : un objectif de l'APIX, d'une direction, d'un agent. */
export type CibleObjectif =
  | { niveau: 'apix' }
  | { niveau: 'direction'; directionId: string; nom: string }
  | { niveau: 'individuel'; employeeId: string; nom: string };

/** Créer ou modifier un objectif. */
export function FenetreObjectif({
  cible,
  objectif,
  onClose,
}: {
  cible: CibleObjectif;
  /** Absent : création. */
  objectif?: ObjectifView;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [nature, setNature] = React.useState<'libre' | 'formation'>(objectif?.nature ?? 'libre');
  const [titre, setTitre] = React.useState(objectif?.titre ?? '');
  const [description, setDescription] = React.useState(objectif?.description ?? '');
  const [echeance, setEcheance] = React.useState(objectif?.echeance ?? '');
  const [diffusion, setDiffusion] = React.useState<DiffusionObjectif>(
    objectif?.diffusion ?? 'tous',
  );
  const [courseId, setCourseId] = React.useState('');
  const [erreur, setErreur] = React.useState<string | null>(null);

  const formations = useQuery({
    queryKey: [...CLE_OBJECTIFS, 'formations'],
    queryFn: () => api<FormationProposable[]>('/objectifs/formations'),
    enabled: cible.niveau === 'individuel' && !objectif,
  });

  const enregistrer = useMutation({
    mutationFn: () => {
      if (objectif) {
        return api(`/objectifs/${objectif.id}`, {
          method: 'PATCH',
          body: {
            ...(objectif.nature === 'libre' ? { titre: titre.trim() } : {}),
            description: description.trim() || null,
            echeance: echeance || null,
            ...(objectif.niveau === 'apix' ? { diffusion } : {}),
          },
        });
      }
      const corps: CreerObjectifInput = {
        niveau: cible.niveau,
        nature,
        description: description.trim() || null,
        echeance: echeance || null,
        ...(nature === 'formation' ? { courseId } : { titre: titre.trim() }),
        ...(cible.niveau === 'apix' ? { diffusion } : {}),
        ...(cible.niveau === 'direction' ? { directionId: cible.directionId } : {}),
        ...(cible.niveau === 'individuel' ? { employeeId: cible.employeeId } : {}),
      };
      return api('/objectifs', { method: 'POST', body: corps });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CLE_OBJECTIFS });
      onClose();
    },
    onError: (err) => setErreur(messageErreur(err, 'Enregistrement impossible.')),
  });

  const pret =
    nature === 'formation' ? Boolean(courseId) || Boolean(objectif) : titre.trim().length >= 2;
  const titreFenetre = objectif
    ? 'Modifier l’objectif'
    : cible.niveau === 'apix'
      ? 'Nouvelle orientation'
      : 'Nouvel objectif';
  const sousTitre = cible.niveau === 'apix' ? 'APIX' : cible.nom;

  return (
    <Modal
      open
      onClose={onClose}
      title={titreFenetre}
      subtitle={sousTitre}
      maxWidth="max-w-xl"
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
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button
            loading={enregistrer.isPending}
            disabled={!pret}
            onClick={() => {
              setErreur(null);
              enregistrer.mutate();
            }}
          >
            {objectif ? 'Enregistrer' : 'Ajouter'}
          </Button>
        </>
      }
    >
      <ModalSection title={cible.niveau === 'apix' ? 'L’orientation' : 'L’objectif'}>
        <div className="flex flex-col gap-3.5">
          {cible.niveau === 'individuel' && !objectif ? (
            <Choix
              label="Nature"
              valeur={nature}
              options={[
                { id: 'libre', label: 'Objectif' },
                { id: 'formation', label: 'Formation à suivre' },
              ]}
              onChange={(v) => setNature(v as 'libre' | 'formation')}
            />
          ) : null}
          {nature === 'formation' && !objectif ? (
            <Field label="Formation de l’APIX Academy" htmlFor="formation" required>
              <Select
                id="formation"
                value={courseId}
                disabled={formations.isLoading}
                onChange={(e) => setCourseId(e.target.value)}
              >
                <option value="">{formations.isLoading ? 'Chargement…' : 'Choisir'}</option>
                {(formations.data ?? []).map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.title}
                  </option>
                ))}
              </Select>
            </Field>
          ) : nature === 'libre' ? (
            <Field label="Intitulé" htmlFor="titre" required>
              <Input
                id="titre"
                value={titre}
                maxLength={200}
                onChange={(e) => setTitre(e.target.value)}
              />
            </Field>
          ) : null}
          <Field label="Précisions" htmlFor="description">
            <Textarea
              id="description"
              rows={3}
              maxLength={2000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <Field label="Échéance" htmlFor="echeance" hint="Facultative">
            <Input
              id="echeance"
              type="date"
              value={echeance}
              onChange={(e) => setEcheance(e.target.value)}
              className="sm:w-56"
            />
          </Field>
          {cible.niveau === 'apix' ? (
            <Choix
              label="Diffusion"
              valeur={diffusion}
              options={[
                { id: 'tous', label: LIBELLES_DIFFUSION.tous },
                { id: 'directeurs', label: LIBELLES_DIFFUSION.directeurs },
              ]}
              onChange={(v) => setDiffusion(v as DiffusionObjectif)}
            />
          ) : null}
        </div>
      </ModalSection>
    </Modal>
  );
}

/** Évaluer un objectif — ou retirer son évaluation. */
export function FenetreEvaluation({
  objectif,
  onClose,
}: {
  objectif: ObjectifView;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [evaluation, setEvaluation] = React.useState<EvaluationObjectif | null>(
    objectif.evaluation,
  );
  const [commentaire, setCommentaire] = React.useState(objectif.commentaire ?? '');
  const [erreur, setErreur] = React.useState<string | null>(null);
  const evaluer = useMutation({
    mutationFn: (valeur: EvaluationObjectif | null) =>
      api(`/objectifs/${objectif.id}/evaluation`, {
        method: 'POST',
        body: { evaluation: valeur, commentaire: valeur ? commentaire.trim() || null : null },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CLE_OBJECTIFS });
      onClose();
    },
    onError: (err) => setErreur(messageErreur(err, 'Évaluation impossible.')),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Évaluer"
      subtitle={objectif.titre}
      maxWidth="max-w-lg"
      footer={
        <>
          {erreur ? (
            <p
              role="alert"
              className="min-w-0 flex-1 rounded-lg bg-danger-soft px-3 py-2 text-xs font-semibold text-danger"
            >
              {erreur}
            </p>
          ) : objectif.evaluation ? (
            <Button
              variant="ghost"
              className="mr-auto"
              disabled={evaluer.isPending}
              onClick={() => evaluer.mutate(null)}
            >
              Retirer l’évaluation
            </Button>
          ) : null}
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button
            loading={evaluer.isPending}
            disabled={!evaluation}
            onClick={() => {
              setErreur(null);
              evaluer.mutate(evaluation);
            }}
          >
            Enregistrer
          </Button>
        </>
      }
    >
      <ModalSection title="Évaluation">
        <div className="flex flex-col gap-3.5">
          <div role="radiogroup" aria-label="Évaluation" className="grid gap-2 sm:grid-cols-3">
            {EVALUATIONS_OBJECTIF.map((e) => (
              <button
                key={e}
                type="button"
                role="radio"
                aria-checked={evaluation === e}
                onClick={() => setEvaluation(e)}
                className={cn(
                  'flex items-center justify-center gap-1.5 rounded-[11px] border px-3 py-2.5 text-[12.5px] font-bold transition-colors',
                  evaluation === e
                    ? cn('border-transparent ring-1 ring-inset', TONS_EVALUATION[e])
                    : 'border-line-soft text-ink-muted hover:text-ink',
                )}
              >
                <Icon name={ICONES_EVALUATION[e]} size={16} />
                {LIBELLES_EVALUATION[e]}
              </button>
            ))}
          </div>
          <Field label="Commentaire" htmlFor="commentaire">
            <Textarea
              id="commentaire"
              rows={3}
              maxLength={1000}
              value={commentaire}
              onChange={(e) => setCommentaire(e.target.value)}
            />
          </Field>
        </div>
      </ModalSection>
    </Modal>
  );
}

/** Un choix entre deux ou trois options, en pilule. */
function Choix({
  label,
  valeur,
  options,
  onChange,
}: {
  label: string;
  valeur: string;
  options: { id: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-semibold text-ink">{label}</span>
      <div
        role="radiogroup"
        aria-label={label}
        className="flex gap-1 rounded-full border border-line-soft bg-bg p-1 sm:w-fit"
      >
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={valeur === o.id}
            onClick={() => onChange(o.id)}
            className={cn(
              'flex-1 rounded-full px-3.5 py-1.5 text-[12.5px] font-bold whitespace-nowrap transition-colors sm:flex-none',
              valeur === o.id
                ? 'bg-surface text-primary shadow-sm'
                : 'text-ink-muted hover:text-ink',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Les gestes de qui a la main sur un objectif : évaluer (sauf une
 * formation, qui s'évalue dans l'Academy), modifier, supprimer.
 */
export function GestesObjectif({
  objectif,
  onEvaluer,
  onModifier,
  onSupprimer,
}: {
  objectif: ObjectifView;
  onEvaluer?: () => void;
  onModifier: () => void;
  onSupprimer: () => void;
}) {
  return (
    <span className="flex items-center">
      {onEvaluer && objectif.nature === 'libre' ? (
        <BoutonIcone icone="rate_review" label="Évaluer" onClick={onEvaluer} />
      ) : null}
      <BoutonIcone icone="edit" label="Modifier" onClick={onModifier} />
      <BoutonIcone icone="delete" label="Supprimer" onClick={onSupprimer} danger />
    </span>
  );
}
