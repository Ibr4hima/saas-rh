'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { AbsenceRequestView } from '@teranga/contracts';
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  EmptyState,
  Field,
  Skeleton,
  Textarea,
} from '@teranga/ui';
import { BoutonDecision } from '../../../../components/bouton-decision';
import { CartePleine, CorpsDefilant, Page } from '../../../../components/gabarit';
import { Icon } from '../../../../components/icons';
import { Modal } from '../../../../components/modal';
import { StatutAbsence } from '../../../../components/statut-absence';
import { resumeVisas } from '../../../../lib/absences';
import { api, ApiError } from '../../../../lib/api';
import { formatDate } from '../../../../lib/hooks';
import { compte } from '../../../../lib/mots';

/* ————————————————————————————————————————————————————————————————
   Les congés de l'équipe : ce que le n+1 vise.

   Le circuit de l'APIX : le N+1 de l'agent vise d'abord ; la DCH, prévenue
   dès son visa, traite ensuite. Cet écran est la première étape — le seul
   endroit où un agent décide pour un autre. Il n'apparaît dans le menu qu'à
   qui encadre quelqu'un : c'est l'organigramme qui fait le n+1, pas le rôle.

   Deux cartes : en haut ce qui attend SON visa, à traiter ; en bas le suivi
   de ce qu'il a déjà visé et des absences de son équipe — pour savoir qui
   sera là la semaine prochaine.
   ———————————————————————————————————————————————————————————————— */

const TABULAIRE = { fontVariantNumeric: 'tabular-nums' } as const;

export default function CongesEquipePage() {
  const queryClient = useQueryClient();
  const demandes = useQuery({
    queryKey: ['absence-requests', 'equipe'],
    queryFn: () => api<AbsenceRequestView[]>('/absence-requests?equipe=true&limit=100'),
  });
  const [refus, setRefus] = useState<AbsenceRequestView | null>(null);
  const [motif, setMotif] = useState('');
  const [message, setMessage] = useState<{ ton: 'ok' | 'erreur'; texte: string } | null>(null);

  const rafraichir = async () => {
    await queryClient.invalidateQueries({ queryKey: ['absence-requests'] });
    await queryClient.invalidateQueries({ queryKey: ['validations-compteurs'] });
  };
  const decider = useMutation({
    mutationFn: (v: { demande: AbsenceRequestView; decision: 'approved' | 'rejected' }) =>
      api(`/absence-requests/${v.demande.id}/decision`, {
        method: 'POST',
        body: {
          decision: v.decision,
          ...(v.decision === 'rejected' && motif.trim() ? { comment: motif.trim() } : {}),
        },
      }),
    onSuccess: async (_, v) => {
      setRefus(null);
      setMotif('');
      setMessage({
        ton: 'ok',
        texte:
          v.decision === 'approved'
            ? `Demande de ${v.demande.employeeName} visée — la DCH est prévenue.`
            : `Demande de ${v.demande.employeeName} refusée — un message lui est envoyé.`,
      });
      await rafraichir();
    },
    onError: (err) =>
      setMessage({
        ton: 'erreur',
        texte: err instanceof ApiError ? err.message : 'Décision impossible.',
      }),
  });

  const toutes = demandes.data ?? [];
  const aViser = toutes
    .filter((r) => r.canDecide)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const suivi = toutes.filter((r) => !r.canDecide);

  return (
    <Page>
      {message ? (
        <p
          role="status"
          className={
            message.ton === 'ok'
              ? 'flex shrink-0 items-center gap-2 rounded-[12px] bg-success-soft px-3.5 py-2.5 text-[12.5px] text-success ring-1 ring-current/15 ring-inset'
              : 'flex shrink-0 items-center gap-2 rounded-[12px] bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger ring-1 ring-current/15 ring-inset'
          }
        >
          <Icon name={message.ton === 'ok' ? 'check_circle' : 'error'} size={16} />
          {message.texte}
        </p>
      ) : null}

      {/* ———— À valider ———— */}
      <Card className="shrink-0">
        <CardHeader className="flex items-center justify-between gap-3">
          <CardTitle>À valider</CardTitle>
          {aViser.length > 0 ? (
            <span className="shrink-0 text-[11.5px] text-ink-muted" style={TABULAIRE}>
              {compte(aViser.length, 'demande')}
            </span>
          ) : null}
        </CardHeader>
        <div className="px-2 pb-2">
          {demandes.isLoading ? (
            <Squelette />
          ) : aViser.length === 0 ? (
            <EmptyState
              className="py-8"
              icon={<Icon name="how_to_reg" size={22} />}
              title="Rien à valider"
            />
          ) : (
            <ul className="flex flex-col">
              {aViser.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[11px] px-3 py-3 transition-colors duration-150 hover:bg-hover"
                >
                  <Resume demande={r} />
                  <div className="ml-auto flex shrink-0 items-center gap-1.5">
                    <BoutonDecision
                      geste="approuver"
                      employe={r.employeeName}
                      enCours={
                        decider.isPending &&
                        decider.variables?.demande.id === r.id &&
                        decider.variables.decision === 'approved'
                      }
                      bloque={decider.isPending}
                      onClick={() => {
                        setMessage(null);
                        decider.mutate({ demande: r, decision: 'approved' });
                      }}
                    />
                    <BoutonDecision
                      geste="refuser"
                      employe={r.employeeName}
                      enCours={false}
                      bloque={decider.isPending}
                      onClick={() => {
                        setMessage(null);
                        setMotif('');
                        setRefus(r);
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      {/* ———— Suivi de l'équipe ———— */}
      <CartePleine>
        <CardHeader className="flex shrink-0 items-center justify-between gap-3">
          <CardTitle>Suivi de l’équipe</CardTitle>
        </CardHeader>
        <CorpsDefilant className="px-2 pb-2">
          {demandes.isLoading ? (
            <Squelette />
          ) : suivi.length === 0 ? (
            <EmptyState
              className="py-8"
              icon={<Icon name="free_cancellation" size={22} />}
              title="Aucune demande à suivre"
            />
          ) : (
            <ul className="flex flex-col">
              {suivi.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[11px] px-3 py-3 transition-colors duration-150 hover:bg-hover"
                >
                  <Resume demande={r} />
                  <div className="ml-auto flex shrink-0 items-center">
                    <StatutAbsence
                      statut={r.status}
                      etape={r.etapeAttendue}
                      titre={resumeVisas(r)}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CorpsDefilant>
      </CartePleine>

      {refus ? (
        <Modal
          open
          onClose={() => setRefus(null)}
          title={`Refuser le congé de ${refus.employeeName}`}
          subtitle={`${refus.absenceTypeName} · ${formatDate(refus.startDate)} → ${formatDate(refus.endDate)} · ${compte(refus.daysCount, 'jour')}`}
          maxWidth="max-w-lg"
          footer={
            <div className="flex w-full justify-end gap-2">
              <Button variant="secondary" onClick={() => setRefus(null)}>
                Annuler
              </Button>
              <Button
                variant="danger"
                loading={decider.isPending}
                onClick={() => decider.mutate({ demande: refus, decision: 'rejected' })}
              >
                Refuser la demande
              </Button>
            </div>
          }
        >
          <Field
            label="Motif"
            htmlFor="motif-refus"
            hint="Facultatif — il est transmis à l’agent avec le refus. La demande s’arrête là : la DCH n’est pas sollicitée."
          >
            <Textarea
              id="motif-refus"
              value={motif}
              maxLength={1000}
              placeholder="Ex. : clôture des comptes cette semaine-là — proposez une autre date."
              onChange={(e) => setMotif(e.target.value)}
            />
          </Field>
        </Modal>
      ) : null}
    </Page>
  );
}

/** Qui, quoi, quand — et, s'il y a lieu, qui la demande attend. */
function Resume({ demande: r }: { demande: AbsenceRequestView }) {
  return (
    <div className="min-w-0 flex-1 basis-56">
      <p className="truncate text-[13px] font-semibold text-ink-strong">{r.employeeName}</p>
      <p className="mt-0.5 text-[11.5px] text-ink-muted" style={TABULAIRE}>
        {r.absenceTypeName} · {formatDate(r.startDate)} → {formatDate(r.endDate)} ·{' '}
        {compte(r.daysCount, 'jour')}
      </p>
      {r.reason ? (
        <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-ink-muted">{r.reason}</p>
      ) : null}
    </div>
  );
}

function Squelette() {
  return (
    <div className="flex flex-col gap-1 px-3">
      {[0, 1, 2].map((i) => (
        <span key={i} className="flex items-center gap-3 py-2.5">
          <Skeleton className="h-3 w-52" />
        </span>
      ))}
    </div>
  );
}
