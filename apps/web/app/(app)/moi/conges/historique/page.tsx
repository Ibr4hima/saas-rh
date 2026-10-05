'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { AbsenceRequestView, MyEmployeeView } from '@teranga/contracts';
import {
  Button,
  Card,
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
import {
  FenetreAnnulation,
  FenetreReprise,
  MentionConge,
} from '../../../../../components/conge-valide';
import { type ViewableDoc } from '../../../../../components/doc-viewer';
import { FenetreDocument } from '../../../../../components/fenetre-document';
import { Icon } from '../../../../../components/icons';
import { JoindreJustificatif } from '../../../../../components/joindre-justificatif';
import { StatutAbsence } from '../../../../../components/statut-absence';
import { Page } from '../../../../../components/gabarit';
import { api, ApiError, apiUrl } from '../../../../../lib/api';
import { resumeVisas } from '../../../../../lib/absences';
import { formatDate } from '../../../../../lib/hooks';
import { compte } from '../../../../../lib/mots';

/* ————————————————————————————————————————————————————————————————
   L'historique des absences et congés : une carte par année, un tableau
   d'une ligne par demande — type, période, durée, statut. Le détail du
   circuit (qui a visé, pourquoi un refus) se lit au survol du statut.
   ———————————————————————————————————————————————————————————————— */

export default function HistoriqueCongesPage() {
  const queryClient = useQueryClient();
  const [viewedDoc, setViewedDoc] = useState<ViewableDoc | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  // Un congé validé : l'annuler (pas commencé) ou l'écourter (en cours).
  const [aAnnuler, setAAnnuler] = useState<AbsenceRequestView | null>(null);
  const [aEcourter, setAEcourter] = useState<AbsenceRequestView | null>(null);

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

  const rafraichir = () => {
    setErreur(null);
    setAAnnuler(null);
    setAEcourter(null);
    void queryClient.invalidateQueries({ queryKey: ['my-requests'] });
    void queryClient.invalidateQueries({ queryKey: ['balances'] });
  };
  // Une demande en attente s'annule d'un clic ; un retour pas encore
  // confirmé se retire de même.
  const cancel = useMutation({
    mutationFn: (id: string) => api(`/absence-requests/${id}/cancel`, { method: 'POST' }),
    onSuccess: rafraichir,
    onError: (err) => setErreur(err instanceof ApiError ? err.message : 'Annulation impossible.'),
  });
  const retirerReprise = useMutation({
    mutationFn: (id: string) => api(`/absence-requests/${id}/reprise`, { method: 'DELETE' }),
    onSuccess: rafraichir,
    onError: (err) => setErreur(err instanceof ApiError ? err.message : 'Action impossible.'),
  });

  const chargement = myEmployee.isLoading || requests.isLoading;
  // La plus récente en tête : on revient à l'historique pour ce qui vient
  // ou ce qui vient de se passer.
  const demandes = (requests.data ?? [])
    .filter((r) => r.employeeId === employeeId)
    .sort((a, b) => b.startDate.localeCompare(a.startDate));
  const annees = [...new Set(demandes.map((r) => r.startDate.slice(0, 4)))];

  return (
    <Page>
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
            {/* Des colonnes de largeur fixe : d'une année à l'autre, les
                périodes et les statuts tombent au même endroit. */}
            <Table className="sm:table-fixed">
              {/* Sur téléphone, une seule colonne : l'en-tête n'y apprend rien. */}
              <THead className="hidden sm:table-header-group">
                <tr>
                  <Th className="sm:w-[20%]">Type</Th>
                  <Th className="sm:w-[26%]">Période</Th>
                  <Th className="text-right sm:w-[9%]">Durée</Th>
                  <Th className="sm:w-[14%]">Justificatif</Th>
                  <Th className="sm:w-[19%]">Statut</Th>
                  <Th className="sm:w-[12%]">
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
                      onAnnuler={() =>
                        r.status === 'pending' ? cancel.mutate(r.id) : setAAnnuler(r)
                      }
                      onEcourter={() => setAEcourter(r)}
                      onRetirerReprise={() => retirerReprise.mutate(r.id)}
                      onJoint={rafraichir}
                      onErreur={setErreur}
                      enCours={
                        (cancel.isPending && cancel.variables === r.id) ||
                        (retirerReprise.isPending && retirerReprise.variables === r.id)
                      }
                    />
                  ))}
              </TBody>
            </Table>
          </Card>
        ))
      )}

      <FenetreDocument doc={viewedDoc} onClose={() => setViewedDoc(null)} />
      {aAnnuler ? (
        <FenetreAnnulation
          demande={aAnnuler}
          sienne
          onClose={() => setAAnnuler(null)}
          onFait={rafraichir}
        />
      ) : null}
      {aEcourter ? (
        <FenetreReprise
          demande={aEcourter}
          onClose={() => setAEcourter(null)}
          onFait={rafraichir}
        />
      ) : null}
    </Page>
  );
}

/**
 * Une demande, sur une ligne. Sur téléphone, la période, la durée, le statut,
 * le justificatif et les gestes se rangent sous le type : six colonnes n'y
 * tiennent pas.
 */
function Ligne({
  demande: r,
  onJustificatif,
  onAnnuler,
  onEcourter,
  onRetirerReprise,
  onJoint,
  onErreur,
  enCours,
}: {
  demande: AbsenceRequestView;
  onJustificatif: () => void;
  onAnnuler: () => void;
  onEcourter: () => void;
  onRetirerReprise: () => void;
  onJoint: () => void;
  onErreur: (texte: string) => void;
  enCours: boolean;
}) {
  const periode = `${formatDate(r.startDate)} → ${formatDate(r.endDate)}`;
  const statut = <StatutAbsence statut={r.status} etape={r.etapeAttendue} titre={resumeVisas(r)} />;
  const justificatif = r.documentName ? (
    <button
      type="button"
      onClick={onJustificatif}
      title={r.documentName}
      className="inline-flex items-center rounded-full border border-line px-2.5 py-[3px] text-[11px] font-semibold text-primary transition-colors hover:border-primary/40 hover:bg-primary/[0.07] focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
    >
      Prévisualiser
    </button>
  ) : r.justificatifAttendu ? (
    <JoindreJustificatif demande={r} onFait={onJoint} onErreur={onErreur} />
  ) : null;
  // Un geste par ligne au plus : annuler (en attente, ou validé à venir),
  // écourter (en cours), ou retirer un retour qui attend sa confirmation.
  const geste = r.repriseDemandee ? (
    <Button size="sm" variant="ghost" onClick={onRetirerReprise} loading={enCours}>
      Retirer
    </Button>
  ) : r.gestes.annuler ? (
    <Button size="sm" variant="ghost" onClick={onAnnuler} loading={enCours}>
      Annuler
    </Button>
  ) : r.gestes.demanderReprise ? (
    <Button size="sm" variant="ghost" onClick={onEcourter}>
      Écourter
    </Button>
  ) : null;
  return (
    <Tr>
      <Td>
        <p className="truncate font-semibold text-ink-strong" title={r.reason ?? undefined}>
          {r.absenceTypeName}
        </p>
        <p className="mt-0.5 text-[11.5px] text-ink-muted tabular-nums sm:hidden">
          {periode} · {compte(r.daysCount, 'jour')}
        </p>
        <div className="sm:hidden">
          <MentionConge demande={r} />
        </div>
        <div className="mt-2.5 flex items-center gap-3 sm:hidden">
          {statut}
          {justificatif}
          <span className="ml-auto">{geste}</span>
        </div>
      </Td>
      <Td className="hidden tabular-nums sm:table-cell">
        {periode}
        <MentionConge demande={r} />
      </Td>
      <Td className="hidden text-right whitespace-nowrap tabular-nums sm:table-cell">
        {compte(r.daysCount, 'jour')}
      </Td>
      <Td className="hidden sm:table-cell">{justificatif}</Td>
      <Td className="hidden sm:table-cell">{statut}</Td>
      <Td className="hidden text-right sm:table-cell">{geste}</Td>
    </Tr>
  );
}
