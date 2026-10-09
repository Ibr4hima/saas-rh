'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { DocumentRequestView } from '@teranga/contracts';
import {
  DOC_REQUEST_STATUS_TONES,
  documentDemande,
  OPEN_DOCUMENT_REQUEST_STATUSES,
  statutDeLaDemande,
} from '@teranga/contracts';
import {
  Badge,
  Button,
  CardHeader,
  CardTitle,
  EmptyState,
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
import { CartePleine, CorpsDefilant, Page } from '../../../../../components/gabarit';
import { Pagination, usePagination } from '../../../../../components/pagination';
import { SqueletteTableau } from '../../../../../components/tableau';
import { EnTetePliable, Pastille } from '../../../../../components/traitement-dch';

/** « Attestation de travail », « Bulletin de salaire · 3 derniers mois ». */
const documentsDe = (r: DocumentRequestView) =>
  r.docTypes.map((d) => documentDemande(d, r.bulletin)).join(' · ');

/** Prête, la demande dit où trouver le document : en ligne, ou auprès de qui. */
const aUnEtat = (r: DocumentRequestView) =>
  r.status === 'ready' && (r.fichiers.length > 0 || Boolean(r.pickupContact));

/**
 * Suivi de mes demandes de documents : où en est chacune, jusqu'à sa remise.
 *
 * Deux cartes, comme la file de la DCH : les demandes en cours, qui
 * s'annulent encore, puis les demandes traitées (prêtes, remises, refusées),
 * pliées par défaut. Une demande traitée dit, dans la colonne « État
 * traitement », où trouver le document. Une demande annulée, ou remplacée
 * par la même demande faite depuis, n'y figure plus : elle est effacée.
 */
export default function SuiviDemandesDocumentsPage() {
  const queryClient = useQueryClient();
  const [erreur, setErreur] = useState<string | null>(null);
  const [consultee, setConsultee] = useState<string | null>(null);
  const [traiteesOuvertes, setTraiteesOuvertes] = useState(false);
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
  // Dans chaque carte, la plus récente en tête : on revient ici pour ce qui
  // vient d'arriver.
  const { enCours, traitees } = useMemo(() => {
    const demandes = [...(docRequests.data ?? [])].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
    return {
      enCours: demandes.filter((r) => OPEN_DOCUMENT_REQUEST_STATUSES.includes(r.status)),
      traitees: demandes.filter((r) => !OPEN_DOCUMENT_REQUEST_STATUSES.includes(r.status)),
    };
  }, [docRequests.data]);
  const fileVue = usePagination(enCours);
  const historique = usePagination(traitees);
  const aConsulter = traitees.find((r) => r.id === consultee) ?? null;

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

      <CartePleine>
        <CardHeader className="flex shrink-0 items-center gap-2">
          <CardTitle className="min-w-0 flex-1">Demandes en cours</CardTitle>
          {enCours.length > 0 ? <Pastille n={enCours.length} /> : null}
        </CardHeader>
        {docRequests.isLoading ? (
          <CorpsDefilant>
            <SqueletteTableau lignes={3} />
          </CorpsDefilant>
        ) : enCours.length === 0 ? (
          <CorpsDefilant className="grid place-items-center">
            <EmptyState
              icon={<Icon name="folder_managed" size={22} />}
              title="Aucune demande en cours"
            />
          </CorpsDefilant>
        ) : (
          <TableauDesDemandes derniere={<span className="sr-only">Actions</span>}>
            {fileVue.tranche.map((r) => (
              <Ligne
                key={r.id}
                demande={r}
                geste={
                  r.canCancel ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => annuler.mutate(r.id)}
                      loading={annuler.isPending && annuler.variables === r.id}
                    >
                      Annuler
                    </Button>
                  ) : null
                }
              />
            ))}
          </TableauDesDemandes>
        )}
      </CartePleine>
      <Pagination {...fileVue.barre} />

      <CartePleine>
        <EnTetePliable
          titre="Demandes traitées"
          n={traitees.length}
          ouvert={traiteesOuvertes}
          onBasculer={() => setTraiteesOuvertes((o) => !o)}
        />
        {!traiteesOuvertes ? null : docRequests.isLoading ? (
          <CorpsDefilant>
            <SqueletteTableau lignes={3} />
          </CorpsDefilant>
        ) : traitees.length === 0 ? (
          <CorpsDefilant className="grid place-items-center">
            <EmptyState
              icon={<Icon name="folder_managed" size={22} />}
              title="Aucune demande traitée"
            />
          </CorpsDefilant>
        ) : (
          <TableauDesDemandes derniere="État traitement">
            {historique.tranche.map((r) => (
              <Ligne
                key={r.id}
                demande={r}
                etat={
                  aUnEtat(r) ? (
                    <EtatTraitement demande={r} onConsulter={() => setConsultee(r.id)} />
                  ) : null
                }
              />
            ))}
          </TableauDesDemandes>
        )}
      </CartePleine>
      {traiteesOuvertes ? <Pagination {...historique.barre} /> : null}

      {aConsulter ? (
        <DocumentsDisponibles demande={aConsulter} onClose={() => setConsultee(null)} />
      ) : null}
    </Page>
  );
}

/**
 * Le tableau d'une carte. Les deux cartes partagent leurs trois premières
 * colonnes, de largeur fixe : les dates et les statuts de l'une tombent sous
 * ceux de l'autre, et d'une page à l'autre au même endroit.
 */
function TableauDesDemandes({
  derniere,
  children,
}: {
  /** L'intitulé de la dernière colonne : le geste, ou l'état du traitement. */
  derniere: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Table pleine className="sm:table-fixed">
      {/* Sur téléphone, une seule colonne : l'en-tête n'y apprend rien. */}
      <THead className="hidden sm:table-header-group">
        <tr>
          <Th className="sm:w-[35%]">Document</Th>
          <Th className="sm:w-[17%]">Demandée le</Th>
          <Th className="sm:w-[18%]">Statut</Th>
          <Th className="sm:w-[30%]">{derniere}</Th>
        </tr>
      </THead>
      <TBody>{children}</TBody>
    </Table>
  );
}

/**
 * Une demande, sur une ligne. Sur téléphone, la date, le statut, le geste
 * et l'état du traitement se rangent sous le document : quatre colonnes n'y
 * tiennent pas.
 */
function Ligne({
  demande: r,
  geste,
  etat,
}: {
  demande: DocumentRequestView;
  /** En cours : « Annuler ». */
  geste?: React.ReactNode;
  /** Traitée : où trouver le document. */
  etat?: React.ReactNode;
}) {
  const documents = documentsDe(r);
  const demandee = formatDate(r.createdAt.slice(0, 10));
  const statut = <Badge tone={DOC_REQUEST_STATUS_TONES[r.status]}>{statutDeLaDemande(r)}</Badge>;
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
          {geste ? <span className="ml-auto">{geste}</span> : null}
        </div>
        {etat ? <div className="mt-2.5 text-[12.5px] sm:hidden">{etat}</div> : null}
      </Td>
      <Td className="hidden tabular-nums sm:table-cell" title={timeAgo(r.createdAt)}>
        {demandee}
      </Td>
      <Td className="hidden sm:table-cell">{statut}</Td>
      <Td className={geste ? 'hidden text-right sm:table-cell' : 'hidden sm:table-cell'}>
        {geste ?? etat}
      </Td>
    </Tr>
  );
}

/**
 * Où trouver le document d'une demande prête : déposé en ligne, il se
 * consulte (et l'original, s'il y en a un, attend quelque part) ; sinon, on
 * sait auprès de qui le retirer.
 */
function EtatTraitement({
  demande: r,
  onConsulter,
}: {
  demande: DocumentRequestView;
  onConsulter: () => void;
}) {
  if (r.fichiers.length > 0) {
    return (
      <div className="min-w-0">
        <Button size="sm" variant="secondary" onClick={onConsulter}>
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
