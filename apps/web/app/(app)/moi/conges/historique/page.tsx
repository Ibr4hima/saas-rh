'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { AbsenceRequestView, MyEmployeeView } from '@teranga/contracts';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Skeleton,
} from '@teranga/ui';
import { type ViewableDoc } from '../../../../../components/doc-viewer';
import { FenetreDocument } from '../../../../../components/fenetre-document';
import { Icon } from '../../../../../components/icons';
import { StatutAbsence } from '../../../../../components/statut-absence';
import { api, ApiError, apiUrl } from '../../../../../lib/api';
import { resumeVisas } from '../../../../../lib/absences';
import { formatDate } from '../../../../../lib/hooks';
import { Page } from '../../../../../components/gabarit';
import { compte } from '../../../../../lib/mots';

/* ————————————————————————————————————————————————————————————————
   L'historique des absences et congés de l'agent : chaque demande, où elle
   en est dans le circuit de visa, son justificatif. Tant qu'elle attend, il
   peut l'annuler.
   ———————————————————————————————————————————————————————————————— */

const TABULAIRE = { fontVariantNumeric: 'tabular-nums' } as const;

export default function HistoriqueCongesPage() {
  const queryClient = useQueryClient();
  const [viewedDoc, setViewedDoc] = useState<ViewableDoc | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const myEmployee = useQuery({
    queryKey: ['me-employee'],
    queryFn: () => api<MyEmployeeView>('/me/employee'),
    retry: false,
  });
  const employeeId = myEmployee.data?.employeeId;

  const requests = useQuery({
    queryKey: ['my-requests', employeeId],
    queryFn: () =>
      api<AbsenceRequestView[]>(`/absence-requests?employeeId=${employeeId}&limit=100`),
    enabled: Boolean(employeeId),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => api(`/absence-requests/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => {
      setErreur(null);
      void queryClient.invalidateQueries({ queryKey: ['my-requests'] });
      void queryClient.invalidateQueries({ queryKey: ['balances'] });
    },
    onError: (err) => setErreur(err instanceof ApiError ? err.message : 'Annulation impossible.'),
  });

  const myRequests = (requests.data ?? []).filter((r) => r.employeeId === employeeId);

  return (
    <Page>
      <Card>
        <CardHeader className="flex items-center justify-between gap-3">
          <CardTitle>Mes demandes</CardTitle>
          {myRequests.length > 0 ? (
            <span className="shrink-0 text-[11.5px] text-ink-muted" style={TABULAIRE}>
              {compte(myRequests.length, 'demande')}
            </span>
          ) : null}
        </CardHeader>
        {erreur ? (
          <CardContent className="pb-2">
            <p
              role="alert"
              className="flex items-start gap-2 rounded-[12px] bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger ring-1 ring-current/15 ring-inset"
            >
              <Icon name="error" size={15} className="mt-px shrink-0" />
              {erreur}
            </p>
          </CardContent>
        ) : null}
        <CardContent className="px-2 pb-2">
          {myEmployee.isLoading || requests.isLoading ? (
            <div className="flex flex-col gap-1 px-3">
              {[0, 1, 2].map((i) => (
                <span key={i} className="flex items-center gap-3 py-2.5">
                  <Skeleton className="h-3 w-52" />
                </span>
              ))}
            </div>
          ) : myRequests.length === 0 ? (
            <EmptyState
              className="py-8"
              icon={<Icon name="free_cancellation" size={22} />}
              title="Aucune demande pour le moment"
            />
          ) : (
            <ul className="flex flex-col">
              {myRequests.map((r) => (
                <LigneDemande
                  key={r.id}
                  demande={r}
                  onJustificatif={() =>
                    setViewedDoc({
                      url: apiUrl(`/absence-requests/${r.id}/document`),
                      filename: r.documentName!,
                      contentType: 'application/pdf',
                      titre: 'Justificatif',
                    })
                  }
                  onAnnuler={() => cancel.mutate(r.id)}
                  annulationEnCours={cancel.isPending && cancel.variables === r.id}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <FenetreDocument doc={viewedDoc} onClose={() => setViewedDoc(null)} />
    </Page>
  );
}

/**
 * Une demande, en une ligne.
 *
 * L'étape du visa s'écrit, avec son sujet — « Visa attendu : votre N+1
 * (Awa Diop) », « Visa attendu : la DCH » —, et le justificatif est un bouton
 * visible plutôt qu'un mot souligné noyé dans la ligne de dates.
 */
function LigneDemande({
  demande: r,
  onJustificatif,
  onAnnuler,
  annulationEnCours,
}: {
  demande: AbsenceRequestView;
  onJustificatif: () => void;
  onAnnuler: () => void;
  annulationEnCours: boolean;
}) {
  const qui = r.circuit.find((e) => e.etape === r.etapeAttendue)?.qui;
  const attendu =
    r.status !== 'pending'
      ? null
      : r.etapeAttendue === 'dch'
        ? `Visa attendu : la DCH${qui ? ` (${qui})` : ''}`
        : `Visa attendu : votre N+1${qui ? ` (${qui})` : ''}`;

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[11px] px-3 py-3 transition-colors duration-150 hover:bg-hover">
      {/* Trois lignes empilées plutôt qu'une seule coupée : sur un téléphone,
          une ligne unique en `truncate` perdait tout ce qui suit les dates —
          l'étape du visa ET le motif. */}
      <div className="min-w-0 flex-1 basis-52">
        <p className="truncate text-[13px] font-semibold text-ink-strong">{r.absenceTypeName}</p>
        <p className="mt-0.5 text-[11.5px] text-ink-muted" style={TABULAIRE}>
          {formatDate(r.startDate)} → {formatDate(r.endDate)} · {compte(r.daysCount, 'jour')}
        </p>
        {attendu || r.reason ? (
          <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-ink-muted">
            {[attendu, r.reason].filter(Boolean).join(' · ')}
          </p>
        ) : null}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {r.documentName ? (
          <button
            type="button"
            onClick={onJustificatif}
            className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11.5px] font-medium text-primary transition-colors hover:bg-primary-soft"
          >
            <Icon name="description" size={14} />
            Justificatif
          </button>
        ) : null}

        <StatutAbsence statut={r.status} titre={resumeVisas(r)} />

        {r.status === 'pending' ? (
          <Button size="sm" variant="ghost" onClick={onAnnuler} loading={annulationEnCours}>
            Annuler
          </Button>
        ) : null}
      </div>
    </li>
  );
}
