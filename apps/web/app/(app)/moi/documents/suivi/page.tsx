'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { DocumentRequestView } from '@teranga/contracts';
import { DOC_REQUEST_STATUS_TONES, documentDemande, statutDeLaDemande } from '@teranga/contracts';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Skeleton,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@teranga/ui';
import { api, ApiError, apiUrl } from '../../../../../lib/api';
import { formatDate } from '../../../../../lib/hooks';
import { de } from '../../../../../lib/mots';
import { timeAgo } from '../../../../../components/document-request-list';
import { FenetreDocument } from '../../../../../components/fenetre-document';
import { Icon } from '../../../../../components/icons';
import { Page } from '../../../../../components/gabarit';
import { Pagination, usePagination } from '../../../../../components/pagination';

/** « Attestation de travail », « Bulletin de salaire · 3 derniers mois ». */
const documentsDe = (r: DocumentRequestView) =>
  r.docTypes.map((d) => documentDemande(d, r.bulletin)).join(' · ');

/**
 * Suivi de mes demandes de documents : où en est chacune, jusqu'à sa remise.
 *
 * Même facture que l'historique des congés, sa voisine dans l'espace
 * personnel : un tableau aux colonnes fixes, quinze lignes par page, le
 * statut en badge. Ce qui appelle un geste (consulter le document déposé,
 * ou aller le chercher) se lit dans la colonne « État traitement ». Une
 * demande annulée, ou remplacée par la même demande faite depuis, n'y figure
 * plus : elle est effacée.
 */
export default function SuiviDemandesDocumentsPage() {
  const queryClient = useQueryClient();
  const [erreur, setErreur] = useState<string | null>(null);
  const [consultee, setConsultee] = useState<string | null>(null);
  const docRequests = useQuery({
    // scope=mine : l'espace personnel reste personnel même pour un membre RH.
    queryKey: ['document-requests', 'me'],
    queryFn: () => api<DocumentRequestView[]>('/document-requests?scope=mine'),
  });
  // Tant que le document n'est pas prêt, la demande s'annule d'un clic.
  const annuler = useMutation({
    mutationFn: (id: string) => api(`/document-requests/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => {
      setErreur(null);
      void queryClient.invalidateQueries({ queryKey: ['document-requests'] });
    },
    onError: (err) => setErreur(err instanceof ApiError ? err.message : 'Annulation impossible.'),
  });
  // La plus récente en tête : on revient ici pour ce qui vient d'arriver.
  const demandes = [...(docRequests.data ?? [])].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  const { tranche, barre } = usePagination(demandes);
  // La colonne des gestes n'existe que si une demande s'annule encore.
  const avecGestes = demandes.some((r) => r.canCancel);
  const aConsulter = demandes.find((r) => r.id === consultee) ?? null;

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

      {docRequests.isLoading ? (
        <Skeleton className="h-48 w-full rounded-[16px]" />
      ) : demandes.length === 0 ? (
        <Card>
          <EmptyState
            className="py-12"
            icon={<Icon name="folder_managed" size={22} />}
            title="Aucune demande pour le moment"
          />
        </Card>
      ) : (
        <>
          {/* Sans titre au-dessus, l'en-tête du tableau touche les coins
              arrondis de la carte : elle le rogne. */}
          <Card className="overflow-hidden">
            {/* Des colonnes de largeur fixe : d'une page à l'autre, les dates
                et les statuts tombent au même endroit. */}
            <Table className="sm:table-fixed">
              {/* Sur téléphone, une seule colonne : l'en-tête n'y apprend rien. */}
              <THead className="hidden sm:table-header-group">
                <tr>
                  <Th className={avecGestes ? 'sm:w-[31%]' : 'sm:w-[35%]'}>Document</Th>
                  <Th className={avecGestes ? 'sm:w-[15%]' : 'sm:w-[17%]'}>Demandée le</Th>
                  <Th className={avecGestes ? 'sm:w-[16%]' : 'sm:w-[18%]'}>Statut</Th>
                  <Th className={avecGestes ? 'sm:w-[28%]' : 'sm:w-[30%]'}>État traitement</Th>
                  {avecGestes ? (
                    <Th className="sm:w-[10%]">
                      <span className="sr-only">Actions</span>
                    </Th>
                  ) : null}
                </tr>
              </THead>
              <TBody>
                {tranche.map((r) => (
                  <Ligne
                    key={r.id}
                    demande={r}
                    avecGestes={avecGestes}
                    onAnnuler={() => annuler.mutate(r.id)}
                    enCours={annuler.isPending && annuler.variables === r.id}
                    onConsulter={() => setConsultee(r.id)}
                  />
                ))}
              </TBody>
            </Table>
          </Card>
          <Pagination {...barre} />
        </>
      )}

      {aConsulter ? (
        <DocumentsDisponibles demande={aConsulter} onClose={() => setConsultee(null)} />
      ) : null}
    </Page>
  );
}

/**
 * Une demande, sur une ligne. Sur téléphone, la date, le statut, le geste
 * et l'état du traitement se rangent sous le document : cinq colonnes n'y
 * tiennent pas.
 */
function Ligne({
  demande: r,
  avecGestes,
  onAnnuler,
  enCours,
  onConsulter,
}: {
  demande: DocumentRequestView;
  avecGestes: boolean;
  onAnnuler: () => void;
  enCours: boolean;
  onConsulter: () => void;
}) {
  const documents = documentsDe(r);
  const demandee = formatDate(r.createdAt.slice(0, 10));
  const statut = <Badge tone={DOC_REQUEST_STATUS_TONES[r.status]}>{statutDeLaDemande(r)}</Badge>;
  const etat = <EtatTraitement demande={r} onConsulter={onConsulter} />;
  const aUnEtat = r.status === 'ready' && (r.fichiers.length > 0 || Boolean(r.pickupContact));
  const geste = r.canCancel ? (
    <Button size="sm" variant="ghost" onClick={onAnnuler} loading={enCours}>
      Annuler
    </Button>
  ) : null;
  return (
    <Tr>
      <Td>
        <p className="truncate font-semibold text-ink-strong" title={documents}>
          {documents}
        </p>
        {r.note ? (
          <p className="mt-0.5 truncate text-[11.5px] text-ink-muted italic" title={r.note}>
            « {r.note} »
          </p>
        ) : null}
        {r.status === 'rejected' && r.hrMessage ? (
          <p className="mt-0.5 text-[11.5px] font-semibold text-danger">Motif : {r.hrMessage}</p>
        ) : null}
        <p className="mt-1 text-[11.5px] text-ink-muted tabular-nums sm:hidden">
          Demandée le {demandee}
        </p>
        <div className="mt-2.5 flex items-center gap-3 sm:hidden">
          {statut}
          <span className="ml-auto">{geste}</span>
        </div>
        {aUnEtat ? <div className="mt-2.5 text-[12.5px] sm:hidden">{etat}</div> : null}
      </Td>
      <Td className="hidden tabular-nums sm:table-cell" title={timeAgo(r.createdAt)}>
        {demandee}
      </Td>
      <Td className="hidden sm:table-cell">{statut}</Td>
      <Td className="hidden sm:table-cell">{etat}</Td>
      {avecGestes ? <Td className="hidden text-right sm:table-cell">{geste}</Td> : null}
    </Tr>
  );
}

/**
 * Où en est le traitement, une fois la demande prête : le document déposé en
 * ligne se consulte (et l'original, s'il y en a un, attend quelque part) ;
 * sinon, on sait auprès de qui le retirer. Avant, la cellule reste vide : le
 * statut suffit.
 */
function EtatTraitement({
  demande: r,
  onConsulter,
}: {
  demande: DocumentRequestView;
  onConsulter: () => void;
}) {
  if (r.status !== 'ready') return null;
  if (r.fichiers.length > 0) {
    return (
      <div className="min-w-0">
        <Button size="sm" variant="secondary" onClick={onConsulter}>
          <Icon name="visibility" size={15} />
          Consulter
        </Button>
        {r.pickupContact ? (
          <p className="mt-1 truncate text-[11.5px] text-ink-muted" title={r.pickupContact}>
            Original auprès {de(r.pickupContact)}
          </p>
        ) : null}
        {r.hrMessage ? <p className="mt-0.5 text-[11.5px] text-ink-muted">{r.hrMessage}</p> : null}
      </div>
    );
  }
  if (!r.pickupContact) return null;
  return (
    <div className="min-w-0">
      <p className="truncate font-semibold text-primary" title={r.pickupContact}>
        Auprès {de(r.pickupContact)}
      </p>
      {r.hrMessage ? <p className="mt-0.5 text-[11.5px] text-ink-muted">{r.hrMessage}</p> : null}
    </div>
  );
}

/**
 * Les documents déposés pour une demande : on les lit l'un après l'autre,
 * et on enregistre celui qu'on veut garder.
 */
function DocumentsDisponibles({
  demande: r,
  onClose,
}: {
  demande: DocumentRequestView;
  onClose: () => void;
}) {
  const [rang, setRang] = useState(0);
  const n = r.fichiers.length;
  const f = r.fichiers[Math.min(rang, n - 1)];
  const doc = useMemo(
    () =>
      f
        ? {
            url: apiUrl(`/document-requests/${r.id}/fichiers/${f.id}`),
            filename: f.filename,
            contentType: f.contentType,
          }
        : null,
    [r.id, f],
  );
  if (!doc) return null;
  return (
    <FenetreDocument
      doc={doc}
      onClose={onClose}
      sousTitre={documentsDe(r)}
      telechargement={doc.url}
      enTete={
        n > 1 ? (
          <div className="flex items-center gap-0.5 rounded-full bg-bg p-0.5">
            <button
              type="button"
              aria-label="Document précédent"
              disabled={rang === 0}
              onClick={() => setRang((x) => x - 1)}
              className="flex size-7 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface hover:text-ink disabled:pointer-events-none disabled:opacity-35"
            >
              <Icon name="chevron_left" size={18} />
            </button>
            <span className="px-1.5 text-[11.5px] font-bold text-ink tabular-nums">
              {rang + 1} / {n}
            </span>
            <button
              type="button"
              aria-label="Document suivant"
              disabled={rang >= n - 1}
              onClick={() => setRang((x) => x + 1)}
              className="flex size-7 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface hover:text-ink disabled:pointer-events-none disabled:opacity-35"
            >
              <Icon name="chevron_right" size={18} />
            </button>
          </div>
        ) : undefined
      }
    />
  );
}
