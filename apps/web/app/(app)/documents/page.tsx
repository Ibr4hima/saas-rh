'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { BatchAdvanceResult, DocumentRequestView, RequestableDoc } from '@teranga/contracts';
import {
  DOC_REQUEST_STATUS_LABELS,
  DOC_REQUEST_STATUS_TONES,
  GENERATED_DOCS,
  REQUESTABLE_DOC_LABELS,
} from '@teranga/contracts';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  cn,
  EmptyState,
  Field,
  Input,
  Skeleton,
  TBody,
  Td,
  Th,
  THead,
  Table,
  Tr,
} from '@teranga/ui';
import { api, ApiError, apiUrl } from '../../../lib/api';
import { formatDate } from '../../../lib/hooks';
import { Icon } from '../../../components/icons';
import { LoadFailure } from '../../../components/load-failure';
import { Modal, ModalGrid, ModalSection } from '../../../components/modal';

/** Demandes encore à la charge de la RH — celles qui peuplent le premier tableau. */
const OPEN = ['received', 'processing'];

function docLabels(r: DocumentRequestView): string {
  return r.docTypes.map((d) => REQUESTABLE_DOC_LABELS[d] ?? d).join(' · ');
}

/** Heures écoulées depuis un instant — l'unité de la file d'attente RH. */
function hoursSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000));
}

/**
 * Une durée, toujours en heures.
 *
 * C'est l'unité de la file : deux demandes ne se comparent d'un coup d'œil que
 * dans la même unité, et une demande de document se compte en heures, pas en
 * jours ouvrés. L'urgence, elle, est portée par la couleur de la colonne.
 */
function heures(h: number): string {
  return h < 1 ? '< 1 h' : `${h} h`;
}

/** Heures écoulées entre deux instants. */
function ecartHeures(depuis: string, jusqu: string): number {
  return Math.max(
    0,
    Math.floor((new Date(jusqu).getTime() - new Date(depuis).getTime()) / 3_600_000),
  );
}

export default function DocumentRequestsPage() {
  const requests = useQuery({
    queryKey: ['document-requests', 'toutes'],
    queryFn: () => api<DocumentRequestView[]>('/document-requests'),
  });

  const [selection, setSelection] = useState<string[]>([]);
  const [panneau, setPanneau] = useState<'traiter' | 'decliner' | null>(null);

  const items = useMemo(() => requests.data ?? [], [requests.data]);
  const aTraiter = useMemo(() => {
    // Les plus anciennes d'abord : la file se lit du plus urgent au plus frais,
    // à l'inverse de l'historique.
    return items
      .filter((r) => OPEN.includes(r.status))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [items]);
  const traitees = useMemo(() => {
    // « Prête à retirer » remonte en tête, la plus ancienne devant : personne
    // ne vient clore la demande une fois le document annoncé, donc un document
    // jamais retiré ne se signalerait plus tout seul. Le reste est un
    // historique, du plus récent au plus ancien.
    const enAttenteDeRetrait = items
      .filter((r) => r.status === 'ready')
      .sort((a, b) => (a.handledAt ?? '').localeCompare(b.handledAt ?? ''));
    const closes = items
      .filter((r) => !OPEN.includes(r.status) && r.status !== 'ready')
      .sort((a, b) => (b.handledAt ?? b.createdAt).localeCompare(a.handledAt ?? a.createdAt));
    return [...enAttenteDeRetrait, ...closes];
  }, [items]);

  // La sélection ne survit pas à la disparition d'une ligne : une demande
  // traitée ailleurs ne doit pas rester cochée dans un lot invisible.
  const selectionnees = useMemo(
    () => aTraiter.filter((r) => selection.includes(r.id)),
    [aTraiter, selection],
  );

  if (requests.isError) {
    return <LoadFailure error={requests.error} onRetry={() => void requests.refetch()} />;
  }

  const bascule = (id: string) =>
    setSelection((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const toutBasculer = () =>
    setSelection((s) => (s.length === aTraiter.length ? [] : aTraiter.map((r) => r.id)));

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <CardTitle>À traiter</CardTitle>
            {aTraiter.length > 0 ? (
              <span
                className="rounded-full bg-primary/[0.09] px-2 py-px text-[10.5px] font-extrabold text-primary"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {aTraiter.length}
              </span>
            ) : null}
          </div>
          {/* La barre d'action n'apparaît qu'avec une sélection : au repos,
              deux boutons désactivés en permanence ne feraient que du bruit. */}
          {selectionnees.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11.5px] font-semibold text-ink-muted">
                {selectionnees.length} sélectionnée{selectionnees.length > 1 ? 's' : ''}
              </span>
              <Button size="sm" onClick={() => setPanneau('traiter')}>
                <Icon name="folder_managed" size={15} />
                Traiter
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setPanneau('decliner')}>
                Décliner
              </Button>
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {requests.isLoading ? (
            <Skeleton className="mx-[18px] mb-[18px] h-24" />
          ) : aTraiter.length === 0 ? (
            <EmptyState
              icon={<Icon name="folder_managed" size={22} />}
              title="Tout est traité"
              description="Aucune demande n'attend de votre part. L'historique est juste en dessous."
            />
          ) : (
            <Table>
              <THead>
                <tr>
                  <Th className="w-9 pr-0">
                    <Checkbox
                      aria-label="Tout sélectionner"
                      checked={selection.length > 0 && selectionnees.length === aTraiter.length}
                      indeterminate={
                        selectionnees.length > 0 && selectionnees.length < aTraiter.length
                      }
                      onChange={toutBasculer}
                    />
                  </Th>
                  <Th>Matricule</Th>
                  <Th>Demandeur</Th>
                  <Th>Requête</Th>
                  <Th>Date</Th>
                  <Th className="text-right">Temps écoulé</Th>
                </tr>
              </THead>
              <TBody>
                {aTraiter.map((r) => {
                  const coche = selection.includes(r.id);
                  const h = hoursSince(r.createdAt);
                  return (
                    <Tr key={r.id} className={cn(coche && 'bg-primary/[0.04]')}>
                      <Td className="pr-0">
                        <Checkbox
                          aria-label={`Sélectionner la demande de ${r.employeeName}`}
                          checked={coche}
                          onChange={() => bascule(r.id)}
                        />
                      </Td>
                      <Td className="font-mono text-[11.5px] text-ink-muted">{r.employeeNumber}</Td>
                      <Td>
                        <Link
                          href={`/employees/${r.employeeId}`}
                          className="font-bold text-ink-strong hover:underline"
                        >
                          {r.employeeName}
                        </Link>
                      </Td>
                      <Td>
                        {docLabels(r)}
                        {r.note ? (
                          <span className="block text-[11px] text-ink-muted italic">
                            « {r.note} »
                          </span>
                        ) : null}
                      </Td>
                      <Td className="whitespace-nowrap text-ink-muted">
                        {formatDate(r.createdAt.slice(0, 10))}
                      </Td>
                      <Td
                        className={cn(
                          'text-right font-semibold whitespace-nowrap',
                          // Le retard se signale seul : au-delà de 48 h une
                          // demande de document devient un sujet.
                          h >= 48 ? 'text-danger' : h >= 24 ? 'text-warning' : 'text-ink-muted',
                        )}
                        style={{ fontVariantNumeric: 'tabular-nums' }}
                      >
                        {heures(h)}
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Traitées</CardTitle>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
            Les demandes prêtes à retirer remontent en tête, la plus ancienne devant : personne ne
            vient clore une demande une fois le document annoncé.
          </p>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {requests.isLoading ? (
            <Skeleton className="mx-[18px] mb-[18px] h-24" />
          ) : traitees.length === 0 ? (
            <EmptyState
              icon={<Icon name="folder_managed" size={22} />}
              title="Aucune demande traitée"
              description="L'historique se remplira au fur et à mesure des demandes que vous clôturez."
            />
          ) : (
            <Table>
              <THead>
                <tr>
                  <Th>Matricule</Th>
                  <Th>Demandeur</Th>
                  <Th>Requête</Th>
                  <Th>Date</Th>
                  <Th className="text-right">Durée traitement</Th>
                  <Th>Statut</Th>
                  <Th className="w-8" />
                </tr>
              </THead>
              <TBody>
                {traitees.map((r) => (
                  <Tr key={r.id}>
                    <Td className="font-mono text-[11.5px] text-ink-muted">{r.employeeNumber}</Td>
                    <Td>
                      <Link
                        href={`/employees/${r.employeeId}`}
                        className="font-bold text-ink-strong hover:underline"
                      >
                        {r.employeeName}
                      </Link>
                    </Td>
                    <Td>{docLabels(r)}</Td>
                    <Td className="whitespace-nowrap text-ink-muted">
                      {formatDate(r.createdAt.slice(0, 10))}
                    </Td>
                    <Td
                      className="text-right font-semibold whitespace-nowrap text-ink-muted"
                      style={{ fontVariantNumeric: 'tabular-nums' }}
                    >
                      {r.handledAt ? heures(ecartHeures(r.createdAt, r.handledAt)) : '—'}
                    </Td>
                    <Td>
                      <Badge tone={DOC_REQUEST_STATUS_TONES[r.status]}>
                        {DOC_REQUEST_STATUS_LABELS[r.status]}
                      </Badge>
                      {r.status === 'ready' && r.pickupContact ? (
                        <span className="block text-[11px] text-ink-muted">
                          auprès de {r.pickupContact}
                        </span>
                      ) : null}
                      {r.status === 'rejected' && r.hrMessage ? (
                        <span className="block text-[11px] text-ink-muted">{r.hrMessage}</span>
                      ) : null}
                    </Td>
                    <Td className="pl-0 text-right">
                      {/* Corriger un point de retrait erroné reste possible :
                          une coquille sur le nom envoie l'employé au mauvais
                          bureau, et lui seul peut aller chercher le document. */}
                      {r.status === 'ready' && r.canAdvance ? (
                        <CorrigerRetrait request={r} />
                      ) : null}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {panneau === 'traiter' ? (
        <TraiterModal
          requests={selectionnees}
          onClose={() => setPanneau(null)}
          onDone={() => {
            setPanneau(null);
            setSelection([]);
          }}
        />
      ) : null}
      {panneau === 'decliner' ? (
        <DeclinerModal
          requests={selectionnees}
          onClose={() => setPanneau(null)}
          onDone={() => {
            setPanneau(null);
            setSelection([]);
          }}
        />
      ) : null}
    </div>
  );
}

/** Un document à produire pour une demande donnée. */
interface Piece {
  key: string;
  requestId: string;
  employeeId: string;
  employeeName: string;
  employeeStatus: string;
  doc: RequestableDoc;
  /** L'application sait la produire elle-même (attestation de travail). */
  generable: boolean;
}

function piecesOf(requests: DocumentRequestView[]): Piece[] {
  return requests.flatMap((r) =>
    r.docTypes.map((d) => ({
      key: `${r.id}:${d}`,
      requestId: r.id,
      employeeId: r.employeeId,
      employeeName: r.employeeName,
      employeeStatus: r.employeeStatus,
      doc: d,
      generable: (GENERATED_DOCS as string[]).includes(d) && r.employeeStatus === 'active',
    })),
  );
}

/**
 * Traiter un lot : produire les documents, les relire, puis valider.
 *
 * L'ordre compte. Valider annonce à l'employé que son document l'attend : le
 * faire avant d'avoir ouvert le document, c'est convoquer quelqu'un pour une
 * feuille qu'on n'a pas lue. Le bouton reste donc fermé tant qu'une pièce
 * générable n'a pas été ouverte au moins une fois.
 */
function TraiterModal({
  requests,
  onClose,
  onDone,
}: {
  requests: DocumentRequestView[];
  onClose: () => void;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [pickupContact, setPickupContact] = useState('');
  const [message, setMessage] = useState('');
  const [vues, setVues] = useState<string[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [ecartees, setEcartees] = useState<BatchAdvanceResult['skipped']>([]);

  const pieces = useMemo(() => piecesOf(requests), [requests]);
  const generables = pieces.filter((p) => p.generable);
  const restantes = generables.filter((p) => !vues.includes(p.key)).length;

  const valider = useMutation({
    mutationFn: () =>
      api<BatchAdvanceResult>('/document-requests/batch-advance', {
        method: 'POST',
        body: {
          ids: requests.map((r) => r.id),
          status: 'ready',
          pickupContact: pickupContact.trim() || undefined,
          message: message.trim() || undefined,
        },
      }),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: ['document-requests'] });
      await queryClient.invalidateQueries({ queryKey: ['notifications'] });
      // La pastille de la barre de menu compte les demandes ouvertes : sans
      // ça elle continue d'annoncer un travail qui vient d'être fait.
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      // Un lot partiellement appliqué se dit : refermer sans rien montrer
      // laisserait croire que tout est parti.
      if (res.skipped.length > 0) {
        setEcartees(res.skipped);
        return;
      }
      onDone();
    },
    onError: (err) =>
      setErreur(err instanceof ApiError ? err.message : 'Enregistrement impossible.'),
  });

  if (ecartees.length > 0) {
    return (
      <Modal
        open
        onClose={onDone}
        title="Lot partiellement traité"
        maxWidth="max-w-lg"
        footer={<Button onClick={onDone}>J&apos;ai compris</Button>}
      >
        <ModalSection title="Demandes écartées">
          <p className="mb-3 text-[12.5px] text-ink-muted">
            Les autres sont bien passées en « prête à retirer ». Celles-ci avaient changé
            d&apos;état entre-temps :
          </p>
          <ul className="flex flex-col gap-1.5">
            {ecartees.map((s) => (
              <li key={s.id} className="flex items-center gap-2 text-[12.5px]">
                <Icon name="error" size={15} className="shrink-0 text-warning" />
                <span className="font-semibold text-ink-strong">{s.employeeName || 'Demande'}</span>
                <span className="text-ink-muted">— {s.reason}</span>
              </li>
            ))}
          </ul>
        </ModalSection>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Traiter ${requests.length} demande${requests.length > 1 ? 's' : ''}`}
      subtitle="Produisez les documents, relisez-les, puis annoncez le retrait."
      footer={
        <>
          {erreur ? (
            <p
              role="alert"
              className="min-w-0 flex-1 rounded-lg bg-danger-soft px-3 py-2 text-xs font-semibold text-danger"
            >
              {erreur}
            </p>
          ) : restantes > 0 ? (
            <p className="min-w-0 flex-1 text-[11.5px] text-ink-muted">
              Ouvrez {restantes} document{restantes > 1 ? 's' : ''} avant de valider.
            </p>
          ) : null}
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button
            disabled={restantes > 0}
            loading={valider.isPending}
            onClick={() => {
              setErreur(null);
              valider.mutate();
            }}
          >
            Valider et imprimer
          </Button>
        </>
      }
    >
      <ModalSection title="Documents à produire">
        <ul className="flex flex-col divide-y divide-line-soft">
          {pieces.map((p) => {
            const vue = vues.includes(p.key);
            return (
              <li key={p.key} className="flex flex-wrap items-center gap-3 py-2.5 first:pt-0">
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] font-bold text-ink-strong">
                    {REQUESTABLE_DOC_LABELS[p.doc] ?? p.doc}
                  </p>
                  <p className="text-[11.5px] text-ink-muted">{p.employeeName}</p>
                </div>
                {p.generable ? (
                  <a
                    href={apiUrl(`/employees/${p.employeeId}/attestation?disposition=inline`)}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => setVues((v) => (v.includes(p.key) ? v : [...v, p.key]))}
                  >
                    <Button size="sm" variant={vue ? 'ghost' : 'secondary'}>
                      <Icon name={vue ? 'check' : 'folder_managed'} size={15} />
                      {vue ? 'Relu' : 'Ouvrir et imprimer'}
                    </Button>
                  </a>
                ) : (
                  <span className="text-[11.5px] font-semibold text-ink-muted">
                    {(GENERATED_DOCS as string[]).includes(p.doc)
                      ? 'Dossier non actif — à établir à la main'
                      : 'Préparé hors application'}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </ModalSection>

      <ModalSection title="Point de retrait">
        <ModalGrid>
          <Field label="À retirer auprès de" htmlFor="pickupContact">
            <Input
              id="pickupContact"
              placeholder="Vous, si laissé vide"
              value={pickupContact}
              onChange={(e) => setPickupContact(e.target.value)}
            />
          </Field>
          <Field label="Précision (facultatif)" htmlFor="pickupMessage">
            <Input
              id="pickupMessage"
              placeholder="Ex : bureau 204, 9h–16h"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </Field>
        </ModalGrid>
      </ModalSection>
    </Modal>
  );
}

/** Décliner un lot — le motif part tel quel à chaque employé concerné. */
function DeclinerModal({
  requests,
  onClose,
  onDone,
}: {
  requests: DocumentRequestView[];
  onClose: () => void;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [motif, setMotif] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);

  const decliner = useMutation({
    mutationFn: () =>
      api<BatchAdvanceResult>('/document-requests/batch-advance', {
        method: 'POST',
        body: { ids: requests.map((r) => r.id), status: 'rejected', message: motif.trim() },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['document-requests'] });
      await queryClient.invalidateQueries({ queryKey: ['notifications'] });
      // La pastille de la barre de menu compte les demandes ouvertes : sans
      // ça elle continue d'annoncer un travail qui vient d'être fait.
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      onDone();
    },
    onError: (err) => setErreur(err instanceof ApiError ? err.message : 'Refus impossible.'),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Décliner ${requests.length} demande${requests.length > 1 ? 's' : ''}`}
      subtitle="Le motif est transmis tel quel à chaque demandeur."
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
            variant="danger"
            disabled={!motif.trim()}
            loading={decliner.isPending}
            onClick={() => {
              setErreur(null);
              decliner.mutate();
            }}
          >
            Décliner
          </Button>
        </>
      }
    >
      <ModalSection title="Demandes concernées">
        <ul className="flex flex-col gap-1.5">
          {requests.map((r) => (
            <li key={r.id} className="text-[12.5px]">
              <span className="font-bold text-ink-strong">{r.employeeName}</span>
              <span className="text-ink-muted"> — {docLabels(r)}</span>
            </li>
          ))}
        </ul>
      </ModalSection>
      <ModalSection title="Motif">
        <Field label="Transmis au demandeur" htmlFor="motif">
          <Input
            id="motif"
            placeholder="Ex : le bulletin de salaire est délivré par le service paie."
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
          />
        </Field>
      </ModalSection>
    </Modal>
  );
}

/** Rectifier le point de retrait d'une demande déjà annoncée. */
function CorrigerRetrait({ request: r }: { request: DocumentRequestView }) {
  const queryClient = useQueryClient();
  const [ouvert, setOuvert] = useState(false);
  const [contact, setContact] = useState(r.pickupContact ?? '');
  const [message, setMessage] = useState(r.hrMessage ?? '');
  const [erreur, setErreur] = useState<string | null>(null);

  const corriger = useMutation({
    mutationFn: () =>
      api(`/document-requests/${r.id}/advance`, {
        method: 'POST',
        body: {
          status: 'ready',
          pickupContact: contact.trim() || undefined,
          message: message.trim() || undefined,
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['document-requests'] });
      await queryClient.invalidateQueries({ queryKey: ['notifications'] });
      // La pastille de la barre de menu compte les demandes ouvertes : sans
      // ça elle continue d'annoncer un travail qui vient d'être fait.
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setOuvert(false);
    },
    onError: (err) => setErreur(err instanceof ApiError ? err.message : 'Correction impossible.'),
  });

  return (
    <>
      <button
        type="button"
        title="Corriger le point de retrait"
        aria-label={`Corriger le point de retrait — ${r.employeeName}`}
        onClick={() => setOuvert(true)}
        className="rounded-[7px] p-1.5 text-ink-muted transition-colors hover:bg-primary/[0.07] hover:text-primary"
      >
        <Icon name="edit" size={15} />
      </button>
      {ouvert ? (
        <Modal
          open
          onClose={() => setOuvert(false)}
          title="Corriger le point de retrait"
          subtitle={r.employeeName}
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
              <Button variant="secondary" onClick={() => setOuvert(false)}>
                Annuler
              </Button>
              <Button
                loading={corriger.isPending}
                onClick={() => {
                  setErreur(null);
                  corriger.mutate();
                }}
              >
                Prévenir à nouveau
              </Button>
            </>
          }
        >
          <ModalSection title="Où retirer">
            <ModalGrid>
              <Field label="À retirer auprès de" htmlFor={`c-${r.id}`}>
                <Input
                  id={`c-${r.id}`}
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                />
              </Field>
              <Field label="Précision (facultatif)" htmlFor={`m-${r.id}`}>
                <Input
                  id={`m-${r.id}`}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </Field>
            </ModalGrid>
          </ModalSection>
        </Modal>
      ) : null}
    </>
  );
}
