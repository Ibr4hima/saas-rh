'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
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
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@teranga/ui';
import { type ViewableDoc } from '../../../../../components/doc-viewer';
import { EnTete, Repere } from '../../../../../components/fiche';
import { FenetreDocument } from '../../../../../components/fenetre-document';
import { Icon } from '../../../../../components/icons';
import { StatutAbsence } from '../../../../../components/statut-absence';
import { Page } from '../../../../../components/gabarit';
import { api, ApiError, apiUrl } from '../../../../../lib/api';
import { resumeVisas } from '../../../../../lib/absences';
import { formatDate } from '../../../../../lib/hooks';
import { compte } from '../../../../../lib/mots';

/* ————————————————————————————————————————————————————————————————
   L'historique des absences et congés — la même grammaire que « Mes infos
   personnelles » : une carte de tête (où en sont ses demandes, en quatre
   repères), puis une carte par année, en tableau comme les affectations et
   les contrats de la fiche.
   ———————————————————————————————————————————————————————————————— */

/** Ce qui se dit sous le type : qui est attendu, pourquoi c'est refusé, le motif. */
function precisions(r: AbsenceRequestView): { texte: string; ton: 'attente' | 'danger' | null }[] {
  const lignes: { texte: string; ton: 'attente' | 'danger' | null }[] = [];
  if (r.status === 'pending' && r.etapeAttendue) {
    const qui = r.circuit.find((e) => e.etape === r.etapeAttendue)?.qui;
    const etape = r.etapeAttendue === 'dch' ? 'la DCH' : 'votre N+1';
    lignes.push({ texte: `Visa attendu : ${etape}${qui ? ` (${qui})` : ''}`, ton: 'attente' });
  }
  if (r.status === 'rejected') {
    const refus = r.circuit.find((e) => e.etat === 'refusee');
    if (refus) {
      lignes.push({
        texte: `Refusée par ${refus.qui ?? '—'}${refus.comment ? ` : « ${refus.comment} »` : ''}`,
        ton: 'danger',
      });
    }
  }
  if (r.reason) lignes.push({ texte: r.reason, ton: null });
  return lignes;
}

export default function HistoriqueCongesPage() {
  const router = useRouter();
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

  const chargement = myEmployee.isLoading || requests.isLoading;
  // La plus récente en tête : on revient à l'historique pour ce qui vient
  // ou ce qui vient de se passer.
  const demandes = (requests.data ?? [])
    .filter((r) => r.employeeId === employeeId)
    .sort((a, b) => b.startDate.localeCompare(a.startDate));
  const annees = [...new Set(demandes.map((r) => r.startDate.slice(0, 4)))];
  const anneeCourante = String(new Date().getFullYear());

  const nb = (statut: string) => demandes.filter((r) => r.status === statut).length;
  const enAttente = nb('pending');
  const joursApprouves = demandes
    .filter((r) => r.status === 'approved' && r.startDate.startsWith(anneeCourante))
    .reduce((t, r) => t + r.daysCount, 0);
  const plusAncienne = demandes.length ? demandes[demandes.length - 1]!.startDate : null;

  return (
    <Page>
      <EnTete
        titre="Mes demandes"
        sousTitre={
          chargement
            ? ' '
            : demandes.length === 0
              ? 'Aucune demande'
              : `${compte(demandes.length, 'demande')}${
                  plusAncienne
                    ? ` depuis ${new Date(`${plusAncienne}T00:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}`
                    : ''
                }`
        }
        action={
          <Button variant="secondary" size="sm" onClick={() => router.push('/moi/conges')}>
            <Icon name="add" size={15} />
            Poser une demande
          </Button>
        }
        reperes={
          chargement ? (
            <>
              {[0, 1, 2, 3].map((i) => (
                <div key={i}>
                  <Skeleton className="h-2.5 w-16" />
                  <Skeleton className="mt-2.5 h-4 w-20" />
                </div>
              ))}
            </>
          ) : (
            <>
              <Repere
                label="En attente"
                valeur={String(enAttente)}
                ton={enAttente > 0 ? 'attente' : undefined}
              />
              <Repere label="Approuvées" valeur={String(nb('approved'))} />
              <Repere label="Refusées" valeur={String(nb('rejected'))} />
              <Repere
                label={`Jours approuvés ${anneeCourante}`}
                valeur={compte(joursApprouves, 'jour')}
              />
            </>
          )
        }
      />

      {erreur ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-[12px] bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger ring-1 ring-current/15 ring-inset"
        >
          <Icon name="error" size={15} className="mt-px shrink-0" />
          {erreur}
        </p>
      ) : null}

      {chargement ? (
        <Skeleton className="h-48 w-full rounded-[16px]" />
      ) : demandes.length === 0 ? (
        <Card>
          <EmptyState
            className="py-12"
            icon={<Icon name="free_cancellation" size={22} />}
            title="Aucune demande pour le moment"
          />
        </Card>
      ) : (
        annees.map((annee) => (
          <Card key={annee}>
            <CardHeader>
              <CardTitle>Demandes {annee}</CardTitle>
            </CardHeader>
            <Table>
              {/* Sur téléphone, une seule colonne : l'en-tête n'y apprend rien. */}
              <THead className="hidden sm:table-header-group">
                <tr>
                  <Th>Type</Th>
                  <Th className="hidden sm:table-cell">Période</Th>
                  <Th className="hidden text-right sm:table-cell">Durée</Th>
                  <Th>Statut</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </THead>
              <TBody>
                {demandes
                  .filter((r) => r.startDate.startsWith(annee))
                  .map((r) => (
                    <Ligne
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
              </TBody>
            </Table>
          </Card>
        ))
      )}

      <FenetreDocument doc={viewedDoc} onClose={() => setViewedDoc(null)} />
    </Page>
  );
}

/**
 * Une demande : son type et ce qu'il faut en savoir (le visa attendu, le
 * motif d'un refus, le sien), la période, la durée, l'état, et les gestes —
 * le justificatif, l'annulation tant qu'elle attend. Sur téléphone, tout se
 * range sous le type : quatre colonnes n'y tiennent pas.
 */
function Ligne({
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
  const periode = `${formatDate(r.startDate)} → ${formatDate(r.endDate)}`;
  const gestes = (
    <Gestes
      demande={r}
      onJustificatif={onJustificatif}
      onAnnuler={onAnnuler}
      annulationEnCours={annulationEnCours}
    />
  );
  return (
    <Tr>
      <Td className="max-w-0 sm:w-[38%] sm:min-w-44">
        <p className="truncate text-[13px] font-semibold text-ink-strong">{r.absenceTypeName}</p>
        <p className="mt-0.5 text-[11.5px] text-ink-muted tabular-nums sm:hidden">
          {periode} · {compte(r.daysCount, 'jour')}
        </p>
        {precisions(r).map((l) => (
          <p
            key={l.texte}
            className={
              l.ton === 'attente'
                ? 'mt-0.5 line-clamp-2 text-[11.5px] text-accent-text'
                : l.ton === 'danger'
                  ? 'mt-0.5 line-clamp-2 text-[11.5px] text-danger'
                  : 'mt-0.5 truncate text-[11.5px] text-ink-muted'
            }
          >
            {l.texte}
          </p>
        ))}
        <div className="mt-2.5 flex items-center justify-between gap-2 sm:hidden">
          <StatutAbsence statut={r.status} titre={resumeVisas(r)} />
          {gestes}
        </div>
      </Td>
      <Td className="hidden whitespace-nowrap tabular-nums sm:table-cell">{periode}</Td>
      <Td className="hidden text-right whitespace-nowrap tabular-nums sm:table-cell">
        {compte(r.daysCount, 'jour')}
      </Td>
      <Td className="hidden whitespace-nowrap sm:table-cell">
        <StatutAbsence statut={r.status} titre={resumeVisas(r)} />
      </Td>
      <Td className="hidden w-px whitespace-nowrap sm:table-cell">{gestes}</Td>
    </Tr>
  );
}

/** Le justificatif, et l'annulation tant que la demande attend. */
function Gestes({
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
  if (!r.documentName && r.status !== 'pending') return null;
  return (
    <div className="flex items-center justify-end gap-1">
      {r.documentName ? (
        <button
          type="button"
          onClick={onJustificatif}
          aria-label="Voir le justificatif"
          title="Voir le justificatif"
          className="flex size-8 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-primary-soft hover:text-primary"
        >
          <Icon name="description" size={17} />
        </button>
      ) : null}
      {r.status === 'pending' ? (
        <Button size="sm" variant="ghost" onClick={onAnnuler} loading={annulationEnCours}>
          Annuler
        </Button>
      ) : null}
    </div>
  );
}
