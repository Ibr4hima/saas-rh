'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import type { DocumentRequestStatus, DocumentRequestView } from '@teranga/contracts';
import {
  DOC_REQUEST_STATUS_LABELS,
  DOC_REQUEST_STATUS_TONES,
  GENERATED_DOCS,
  REQUESTABLE_DOC_LABELS,
} from '@teranga/contracts';
import { Badge, Button, Input } from '@teranga/ui';
import { api, ApiError, apiUrl } from '../lib/api';
import { formatDate } from '../lib/hooks';

/** « il y a 3 jours » — l'ancienneté compte autant que la date en RH. */
export function timeAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) return "aujourd'hui";
  if (days === 1) return 'hier';
  if (days < 31) return `il y a ${days} jours`;
  const months = Math.floor(days / 30);
  if (months < 12) return `il y a ${months} mois`;
  const years = Math.floor(months / 12);
  return `il y a ${years} an${years > 1 ? 's' : ''}`;
}

/**
 * Une demande de documents, vue RH (avec actions) ou vue employé (lecture).
 * Le circuit suit l'ADR-0012 : reçue → en traitement → prête à retirer.
 * « Prête » clôt la demande : la RH ne voit pas l'employé passer chez la
 * personne qui détient le document, elle ne peut donc rien attester de plus.
 */
export function DocumentRequestRow({
  request: r,
  showEmployee,
}: {
  request: DocumentRequestView;
  showEmployee: boolean;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [readyOpen, setReadyOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [pickupContact, setPickupContact] = useState('');
  // Deux états DISTINCTS : un motif de refus ne doit jamais hériter d'une
  // précision de retrait (et inversement) — le statut final est irréversible.
  const [readyMessage, setReadyMessage] = useState('');
  const [rejectReason, setRejectReason] = useState('');

  const advance = useMutation({
    mutationFn: (input: {
      status: DocumentRequestStatus;
      pickupContact?: string;
      message?: string;
    }) => api(`/document-requests/${r.id}/advance`, { method: 'POST', body: input }),
    onSuccess: () => {
      setReadyOpen(false);
      setRejectOpen(false);
      setReadyMessage('');
      setRejectReason('');
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['document-requests'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Action impossible.'),
  });

  const generatable = r.docTypes.filter((d) => (GENERATED_DOCS as string[]).includes(d));

  return (
    <li className="flex flex-col gap-2 border-b border-line-soft py-3 last:border-b-0">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          {showEmployee ? (
            <Link
              href={`/employees/${r.employeeId}`}
              className="text-sm font-semibold text-ink-strong hover:underline"
            >
              {r.employeeName}
              <span className="ml-1.5 font-mono text-xs font-normal text-ink-muted">
                {r.employeeNumber}
              </span>
            </Link>
          ) : null}
          <p className={`text-sm ${showEmployee ? 'text-ink' : 'font-medium text-ink-strong'}`}>
            {r.docTypes.map((d) => REQUESTABLE_DOC_LABELS[d] ?? d).join(' · ')}
          </p>
          <p className="text-xs text-ink-muted">
            Demandée {timeAgo(r.createdAt)} ({formatDate(r.createdAt.slice(0, 10))})
            {r.handledByName ? ` · traitée par ${r.handledByName}` : ''}
          </p>
          {r.note ? <p className="mt-1 text-xs text-ink-muted italic">« {r.note} »</p> : null}
          {r.status === 'ready' && r.pickupContact ? (
            <p className="mt-1 text-xs text-primary">
              À retirer auprès de {r.pickupContact}
              {r.hrMessage ? ` — ${r.hrMessage}` : ''}
              {/* L'ancienneté rend visible un document annoncé prêt et jamais
                  venu chercher. Affichée des DEUX côtés : la RH ne peut plus
                  rien constater une fois le document confié, et l'employé est
                  justement le seul à pouvoir aller le retirer — le lui cacher
                  reviendrait à ne prévenir personne. */}
              {r.readyAt ? (
                <span className="text-ink-muted"> · prête {timeAgo(r.readyAt)}</span>
              ) : null}
            </p>
          ) : null}
          {r.status === 'rejected' && r.hrMessage ? (
            <p className="mt-1 text-xs text-danger">Motif : {r.hrMessage}</p>
          ) : null}
        </div>
        <Badge tone={DOC_REQUEST_STATUS_TONES[r.status]}>
          {DOC_REQUEST_STATUS_LABELS[r.status]}
        </Badge>
      </div>

      {r.canAdvance ? (
        <div className="flex flex-wrap items-center gap-2">
          {r.status === 'received' ? (
            <Button
              size="sm"
              loading={advance.isPending}
              onClick={() => advance.mutate({ status: 'processing' })}
            >
              Prendre en traitement
            </Button>
          ) : null}

          {r.status === 'processing' ? (
            <>
              {r.employeeStatus === 'active' ? (
                generatable.map((d) => (
                  <a
                    key={d}
                    href={apiUrl(`/employees/${r.employeeId}/attestation`)}
                    target="_blank"
                  >
                    <Button size="sm" variant="secondary">
                      Générer : {REQUESTABLE_DOC_LABELS[d]}
                    </Button>
                  </a>
                ))
              ) : generatable.length > 0 ? (
                <span className="text-xs text-ink-muted">
                  Dossier non actif — l&apos;attestation de travail ne peut pas être générée.
                </span>
              ) : null}
              <Button
                size="sm"
                onClick={() => {
                  setRejectOpen(false);
                  setReadyOpen(!readyOpen);
                }}
              >
                Marquer prête à retirer
              </Button>
            </>
          ) : null}

          {r.status === 'ready' ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setPickupContact(r.pickupContact ?? '');
                // Pre-rempli comme le contact : le panneau montre exactement ce
                // que l'employe verra, et vider le champ efface la precision.
                setReadyMessage(r.hrMessage ?? '');
                setReadyOpen(!readyOpen);
              }}
            >
              Corriger le point de retrait
            </Button>
          ) : null}

          {r.status === 'received' || r.status === 'processing' ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setReadyOpen(false);
                setRejectOpen(!rejectOpen);
              }}
            >
              Refuser
            </Button>
          ) : null}
        </div>
      ) : null}

      {readyOpen ? (
        <div className="flex flex-col gap-2 rounded-md bg-bg p-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-ink-muted" htmlFor={`pickup-${r.id}`}>
              À retirer auprès de (laisser vide = vous)
            </label>
            <Input
              id={`pickup-${r.id}`}
              placeholder="Ex : Mme Fatou Sall"
              value={pickupContact}
              onChange={(e) => setPickupContact(e.target.value)}
              className="h-9"
            />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs text-ink-muted" htmlFor={`msg-${r.id}`}>
              Précision (facultatif)
            </label>
            <Input
              id={`msg-${r.id}`}
              placeholder="Ex : bureau 204, 9h–16h"
              value={readyMessage}
              onChange={(e) => setReadyMessage(e.target.value)}
              className="h-9"
            />
          </div>
          <Button
            className="sm:shrink-0"
            loading={advance.isPending}
            onClick={() =>
              advance.mutate({
                status: 'ready',
                pickupContact: pickupContact.trim() || undefined,
                message: readyMessage.trim() || undefined,
              })
            }
          >
            Prévenir l&apos;employé
          </Button>
        </div>
      ) : null}

      {rejectOpen ? (
        <div className="flex flex-col gap-2 rounded-md bg-bg p-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-ink-muted" htmlFor={`reject-${r.id}`}>
              Motif du refus (obligatoire, transmis à l&apos;employé)
            </label>
            <Input
              id={`reject-${r.id}`}
              placeholder="Ex : le bulletin de salaire est délivré par le service paie."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="h-9"
            />
          </div>
          <Button
            variant="danger"
            className="sm:shrink-0"
            disabled={!rejectReason.trim()}
            loading={advance.isPending}
            onClick={() => advance.mutate({ status: 'rejected', message: rejectReason.trim() })}
          >
            Confirmer le refus
          </Button>
        </div>
      ) : null}

      {error ? (
        <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
      ) : null}
    </li>
  );
}
