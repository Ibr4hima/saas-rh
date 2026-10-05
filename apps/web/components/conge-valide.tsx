'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import type { AbsenceRequestView } from '@teranga/contracts';
import { Button, Field, Input, Textarea } from '@teranga/ui';
import { api, ApiError } from '../lib/api';
import { formatDate } from '../lib/hooks';
import { compte, de } from '../lib/mots';
import { Modal } from './modal';

/* ────────────────────────────────────────────────────────────────
   Un congé validé qui change.

   L'agent annule le sien tant qu'il n'a pas commencé, ou revient plus tôt :
   son N+1 confirme le retour (la DCH, à défaut). Le N+1 ou la DCH rappellent
   un agent en congé ; la DCH annule un congé à venir. Ici, les fenêtres de
   ces gestes, et la mention qui dit, sous la période, ce qu'il est arrivé
   au congé.
   ──────────────────────────────────────────────────────────────── */

function decaler(iso: string, jours: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + jours);
  return d.toISOString().slice(0, 10);
}

/** Aujourd'hui, dans le calendrier LOCAL : `toISOString()` donnerait la date UTC. */
function aujourdhui(): string {
  const d = new Date();
  const p2 = (v: number) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

/** Le jour de reprise : d'aujourd'hui à la veille de la fin prévue (décidé avec l'APIX). */
function bornesDeReprise(r: AbsenceRequestView): { min: string; max: string } {
  return { min: aujourdhui(), max: decaler(r.endDate, -1) };
}

const periodeDe = (r: AbsenceRequestView) =>
  `${r.absenceTypeName} · ${formatDate(r.startDate)} → ${formatDate(r.endDate)} · ${compte(r.daysCount, 'jour')}`;

const message = (err: unknown) => (err instanceof ApiError ? err.message : 'Action impossible.');

/**
 * Ce qu'il est arrivé au congé, en une ligne sous sa période : une reprise
 * qui attend d'être confirmée (en orange : elle attend), un congé écourté,
 * un congé annulé par la DCH.
 */
export function MentionConge({ demande: r }: { demande: AbsenceRequestView }) {
  if (r.repriseDemandee) {
    return (
      <p className="mt-0.5 text-[11.5px] font-semibold text-warning tabular-nums">
        Reprise le {formatDate(r.repriseDemandee)}, à confirmer
      </p>
    );
  }
  if (r.ecourtement && r.finInitiale) {
    return (
      <p
        className="mt-0.5 text-[11.5px] text-ink-muted tabular-nums"
        title={r.ecourtement.motif ?? undefined}
      >
        {r.ecourtement.nature === 'rappel' ? 'Rappel' : 'Retour anticipé'} · prévu jusqu’au{' '}
        {formatDate(r.finInitiale)}
      </p>
    );
  }
  if (r.annulation) {
    return (
      <p className="mt-0.5 line-clamp-2 text-[11.5px] text-ink-muted">
        Annulé par {r.annulation.par ?? 'la DCH'}
        {r.annulation.motif ? ` : ${r.annulation.motif}` : ''}
      </p>
    );
  }
  return null;
}

/** L'agent revient plus tôt : il choisit le jour où il reprend. */
export function FenetreReprise({
  demande: r,
  onClose,
  onFait,
}: {
  demande: AbsenceRequestView;
  onClose: () => void;
  onFait: () => void;
}) {
  const [reprise, setReprise] = useState('');
  const { min, max } = bornesDeReprise(r);
  const valide = reprise >= min && reprise <= max;
  const envoyer = useMutation({
    mutationFn: () =>
      api(`/absence-requests/${r.id}/reprise`, { method: 'POST', body: { reprise } }),
    onSuccess: onFait,
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Écourter mon congé"
      subtitle={periodeDe(r)}
      maxWidth="max-w-md"
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button disabled={!valide} loading={envoyer.isPending} onClick={() => envoyer.mutate()}>
            Envoyer
          </Button>
        </div>
      }
    >
      <Field
        label="Jour de reprise"
        htmlFor="jour-reprise"
        required
        error={envoyer.error ? message(envoyer.error) : undefined}
        hint={valide ? `Dernier jour de congé : ${formatDate(decaler(reprise, -1))}` : undefined}
      >
        <Input
          id="jour-reprise"
          type="date"
          min={min}
          max={max}
          value={reprise}
          onChange={(e) => setReprise(e.target.value)}
        />
      </Field>
    </Modal>
  );
}

/** Le N+1 ou la DCH rappellent un agent en congé : le jour où il reprend, et pourquoi. */
export function FenetreRappel({
  demande: r,
  onClose,
  onFait,
}: {
  demande: AbsenceRequestView;
  onClose: () => void;
  onFait: () => void;
}) {
  const [reprise, setReprise] = useState('');
  const [motif, setMotif] = useState('');
  const { min, max } = bornesDeReprise(r);
  const dateValide = reprise >= min && reprise <= max;
  const valide = dateValide && motif.trim().length > 0;
  const rappeler = useMutation({
    mutationFn: () =>
      api(`/absence-requests/${r.id}/rappel`, {
        method: 'POST',
        body: { reprise, motif: motif.trim() },
      }),
    onSuccess: onFait,
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Rappeler ${r.employeeName}`}
      subtitle={periodeDe(r)}
      maxWidth="max-w-md"
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button disabled={!valide} loading={rappeler.isPending} onClick={() => rappeler.mutate()}>
            Rappeler
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Field
          label="Jour de reprise"
          htmlFor="jour-rappel"
          required
          hint={
            dateValide ? `Dernier jour de congé : ${formatDate(decaler(reprise, -1))}` : undefined
          }
        >
          <Input
            id="jour-rappel"
            type="date"
            min={min}
            max={max}
            value={reprise}
            onChange={(e) => setReprise(e.target.value)}
          />
        </Field>
        <Field
          label="Motif"
          htmlFor="motif-rappel"
          required
          error={rappeler.error ? message(rappeler.error) : undefined}
        >
          <Textarea
            id="motif-rappel"
            value={motif}
            maxLength={1000}
            onChange={(e) => setMotif(e.target.value)}
          />
        </Field>
      </div>
    </Modal>
  );
}

/**
 * Annuler un congé validé qui n'a pas commencé. L'agent annule le sien d'un
 * mot ; la DCH qui annule celui d'un autre dit pourquoi.
 */
export function FenetreAnnulation({
  demande: r,
  sienne,
  onClose,
  onFait,
}: {
  demande: AbsenceRequestView;
  /** L'agent annule son propre congé : pas de motif à donner. */
  sienne: boolean;
  onClose: () => void;
  onFait: () => void;
}) {
  const [motif, setMotif] = useState('');
  const annuler = useMutation({
    mutationFn: () =>
      api(`/absence-requests/${r.id}/cancel`, {
        method: 'POST',
        body: sienne ? {} : { motif: motif.trim() },
      }),
    onSuccess: onFait,
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={sienne ? 'Annuler mon congé' : `Annuler le congé ${de(r.employeeName)}`}
      subtitle={periodeDe(r)}
      maxWidth="max-w-md"
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Garder le congé
          </Button>
          <Button
            variant="danger"
            disabled={!sienne && motif.trim().length === 0}
            loading={annuler.isPending}
            onClick={() => annuler.mutate()}
          >
            Annuler le congé
          </Button>
        </div>
      }
    >
      {sienne ? (
        <div>
          <p className="text-[13px] text-ink">
            {r.deductsBalance
              ? `${compte(r.daysCount, 'jour')} ${r.daysCount > 1 ? 'reviennent' : 'revient'} sur votre solde.`
              : 'Votre N+1 et la DCH en sont informés.'}
          </p>
          {annuler.error ? (
            <p role="alert" className="mt-2 text-[12.5px] text-danger">
              {message(annuler.error)}
            </p>
          ) : null}
        </div>
      ) : (
        <Field
          label="Motif"
          htmlFor="motif-annulation"
          required
          error={annuler.error ? message(annuler.error) : undefined}
        >
          <Textarea
            id="motif-annulation"
            value={motif}
            maxLength={1000}
            onChange={(e) => setMotif(e.target.value)}
          />
        </Field>
      )}
    </Modal>
  );
}
