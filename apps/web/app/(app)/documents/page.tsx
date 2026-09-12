'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  BatchAdvanceResult,
  DocumentRequestView,
  EmployeeDetail,
  RequestableDoc,
} from '@teranga/contracts';
import { GENERATED_DOCS, REQUESTABLE_DOC_LABELS } from '@teranga/contracts';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  cn,
  DataBlock,
  DataGrid,
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
import { CONTRACT_LABELS } from '../../../lib/recruitment';
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
    // Un historique se lit du plus récent au plus ancien. Annoncer le retrait
    // CLÔT le travail de la RH : l'employé est prévenu et vient chercher son
    // document, il n'y a plus rien à relancer depuis cet écran.
    return items
      .filter((r) => !OPEN.includes(r.status))
      .sort((a, b) => (b.handledAt ?? b.createdAt).localeCompare(a.handledAt ?? a.createdAt));
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
                Prévisualiser
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
                  <Th>Suite donnée</Th>
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
                    {/* Ce qui a été RÉPONDU au demandeur, pas l'étiquette d'un
                        automate : une fois le retrait annoncé, la RH n'a plus
                        rien à faire, et la seule chose qu'on relit ici c'est
                        l'instruction envoyée — ou le motif du refus. */}
                    <Td>
                      {r.status === 'rejected' ? (
                        <span className="font-semibold text-danger">
                          Refusée{r.hrMessage ? ` — ${r.hrMessage}` : ''}
                        </span>
                      ) : (
                        <>
                          <span className="text-ink">
                            À retirer auprès de {r.pickupContact ?? '—'}
                          </span>
                          {r.hrMessage ? (
                            <span className="block text-[11px] text-ink-muted">{r.hrMessage}</span>
                          ) : null}
                        </>
                      )}
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
 * Traiter un lot, en deux temps : PRÉVISUALISER, puis mettre à disposition.
 *
 * Valider annonce à l'employé que son document l'attend. Le faire sans avoir
 * regardé le document, c'est convoquer quelqu'un pour une feuille qu'on n'a
 * pas lue — et découvrir la coquille une fois qu'il est devant le bureau. La
 * première étape affiche donc chaque pièce telle qu'elle sera remise, et la
 * seconde ne s'ouvre qu'une fois toutes les pièces passées sous les yeux.
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
  const [etape, setEtape] = useState<'apercu' | 'retrait'>('apercu');
  const [courante, setCourante] = useState(0);
  const [vues, setVues] = useState<string[]>([]);
  const [pickupContact, setPickupContact] = useState('');
  const [message, setMessage] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [ecartees, setEcartees] = useState<BatchAdvanceResult['skipped']>([]);

  const pieces = useMemo(() => piecesOf(requests), [requests]);
  const piece = pieces[courante];
  // Seules les pièces que l'application produit se vérifient ici : un bulletin
  // de salaire vient de la paie, il n'y a rien à relire à l'écran.
  const aVerifier = pieces.filter((p) => p.generable);
  const restantes = aVerifier.filter((p) => !vues.includes(p.key)).length;

  const marquerVue = useCallback((key: string) => {
    setVues((v) => (v.includes(key) ? v : [...v, key]));
  }, []);

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

  const nbDemandes = `${requests.length} demande${requests.length > 1 ? 's' : ''}`;

  if (etape === 'retrait') {
    return (
      <Modal
        open
        onClose={onClose}
        title="Mise à disposition"
        subtitle="Étape 2 sur 2 · Point de retrait"
        maxWidth="max-w-2xl"
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
            <Button variant="secondary" onClick={() => setEtape('apercu')}>
              Retour à l&apos;aperçu
            </Button>
            <Button
              loading={valider.isPending}
              onClick={() => {
                setErreur(null);
                valider.mutate();
              }}
            >
              Valider et prévenir
            </Button>
          </>
        }
      >
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

        <ModalSection title="Ce qui part">
          <ul className="flex flex-col gap-1.5">
            {requests.map((r) => (
              <li key={r.id} className="text-[12.5px]">
                <span className="font-bold text-ink-strong">{r.employeeName}</span>
                <span className="text-ink-muted"> — {docLabels(r)}</span>
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
      title={`Prévisualiser ${nbDemandes}`}
      subtitle="Étape 1 sur 2 · Vérification des informations"
      maxWidth="max-w-6xl"
      footer={
        <>
          <p className="min-w-0 flex-1 text-[11.5px] text-ink-muted">
            {restantes > 0
              ? `${restantes} document${restantes > 1 ? 's' : ''} encore à vérifier.`
              : 'Tous les documents ont été vérifiés.'}
          </p>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button disabled={restantes > 0} onClick={() => setEtape('retrait')}>
            Continuer
            <Icon name="chevron_right" size={15} />
          </Button>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
        {/* La pile de documents, dans l'ordre où elle sera signée. */}
        <ul className="flex shrink-0 flex-col gap-1.5 self-start lg:w-[14rem]">
          {pieces.map((p, i) => {
            // Une pièce que l'application ne produit pas n'entre pas dans le
            // contrôle : lui poser une coche « vérifiée » serait mentir, et la
            // laisser numérotée ferait croire qu'il reste quelque chose à voir.
            const vue = p.generable && vues.includes(p.key);
            const active = i === courante;
            return (
              <li key={p.key}>
                <button
                  type="button"
                  onClick={() => setCourante(i)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-[10px] border px-2.5 py-2 text-left transition-colors',
                    active
                      ? 'border-primary/35 bg-primary/[0.07]'
                      : 'border-line-soft bg-surface hover:border-primary/20',
                  )}
                >
                  <span
                    className={cn(
                      'flex size-[18px] shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                      vue ? 'bg-success text-primary-ink' : 'border border-line text-ink-muted',
                    )}
                  >
                    {vue ? <Icon name="check" size={12} /> : p.generable ? i + 1 : '·'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-bold text-ink-strong">
                      {REQUESTABLE_DOC_LABELS[p.doc] ?? p.doc}
                    </span>
                    <span className="block truncate text-[11px] text-ink-muted">
                      {p.employeeName}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {/* L'aperçu : le document tel qu'il sera remis, pas une promesse. */}
        <div className="flex min-h-[19rem] min-w-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-line-soft bg-surface">
          {piece ? <Apercu piece={piece} onVue={marquerVue} /> : null}
        </div>
      </div>
    </Modal>
  );
}

/**
 * Aperçu d'une pièce : les informations qui seront IMPRIMÉES dessus.
 *
 * On a d'abord essayé d'encastrer le PDF. Une A4 réduite à la taille d'une
 * fenêtre n'est pas lisible — on y voit une page, pas ce qu'elle dit, et la
 * visionneuse du navigateur ajoute sa propre barre et ses marges. Or ce qu'on
 * vérifie avant d'annoncer un document, c'est bien précis : est-ce la bonne
 * personne, la bonne fonction, les bonnes dates. Ces champs sont donc affichés
 * en clair, exactement ceux que l'attestation reprend, et le document lui-même
 * reste à un clic pour qui veut le lire en entier ou l'imprimer.
 */
function Apercu({ piece, onVue }: { piece: Piece; onVue: (key: string) => void }) {
  const detail = useQuery({
    queryKey: ['employee', piece.employeeId],
    queryFn: () => api<EmployeeDetail>(`/employees/${piece.employeeId}`),
    enabled: piece.generable,
    retry: false,
  });

  // Vue dès qu'elle est affichée — ou dès qu'on sait qu'elle ne peut pas
  // l'être : bloquer sur un document impossible à produire enfermerait la RH.
  const affichee = detail.isSuccess || detail.isError || !piece.generable;
  useEffect(() => {
    if (affichee) onVue(piece.key);
  }, [affichee, onVue, piece.key]);

  const entete = (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line-soft px-4 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-[12.5px] font-bold text-ink-strong">
          {REQUESTABLE_DOC_LABELS[piece.doc] ?? piece.doc}
        </p>
        <p className="truncate text-[11px] text-ink-muted">{piece.employeeName}</p>
      </div>
      {piece.generable ? (
        <a
          href={apiUrl(`/employees/${piece.employeeId}/attestation?disposition=inline`)}
          target="_blank"
          rel="noreferrer"
        >
          <Button size="sm" variant="secondary">
            <Icon name="print" size={15} />
            Ouvrir et imprimer
          </Button>
        </a>
      ) : null}
    </div>
  );

  if (!piece.generable) {
    // Deux raisons de ne rien avoir à montrer, et elles n'appellent pas le
    // même geste : soit l'application ne produit pas ce document, soit elle
    // le produit mais refuse pour ce dossier-là.
    const dossierInactif = (GENERATED_DOCS as string[]).includes(piece.doc);
    return (
      <>
        {entete}
        <EmptyState
          className="flex-1"
          icon={<Icon name={dossierInactif ? 'error' : 'folder_managed'} size={22} />}
          title={dossierInactif ? 'Dossier non actif' : 'Préparé hors application'}
          description={
            dossierInactif
              ? "L'attestation de travail est réservée aux employés en activité : pour ce dossier, elle est à établir à la main."
              : 'Veuillez vérifier l’exactitude des informations demandées dans le service de paie avant de valider.'
          }
        />
      </>
    );
  }

  if (detail.isLoading) {
    return (
      <>
        {entete}
        <div className="flex-1 p-4">
          <Skeleton className="h-full w-full" />
        </div>
      </>
    );
  }

  if (detail.isError || !detail.data) {
    return (
      <>
        {entete}
        <EmptyState
          className="flex-1"
          icon={<Icon name="error" size={22} />}
          title="Dossier illisible"
          description={
            detail.error instanceof ApiError
              ? (detail.error.problem.detail ?? detail.error.problem.title)
              : 'Réessayez dans un instant.'
          }
          action={
            <Button size="sm" variant="secondary" onClick={() => void detail.refetch()}>
              Réessayer
            </Button>
          }
        />
      </>
    );
  }

  const e = detail.data;
  const affectation = e.assignments.find((a) => a.current) ?? e.assignments[0];
  // Le contrat le plus récemment commencé : c'est celui que l'attestation cite.
  const contrat = [...e.contracts].sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
  // Composé AVANT d'entrer dans le bloc : un enfant fait de plusieurs morceaux
  // vides n'est pas « vide » pour DataBlock, qui afficherait du blanc là où le
  // tiret dit « on ne sait pas ».
  const naissance =
    [e.person.birthDate ? formatDate(e.person.birthDate) : null, e.person.birthPlace]
      .filter(Boolean)
      .join(' — ') || null;

  return (
    <>
      {entete}
      <div className="flex-1 overflow-y-auto p-4">
        <DataGrid>
          <DataBlock label="Nom et prénom">
            {e.person.givenName} {e.person.familyName}
          </DataBlock>
          <DataBlock label="Matricule">{e.employeeNumber}</DataBlock>
          <DataBlock label="Naissance">{naissance}</DataBlock>
          <DataBlock label="Fonction">{affectation?.positionTitle}</DataBlock>
          <DataBlock label="Direction">{affectation?.orgUnitName}</DataBlock>
          <DataBlock label="Type de contrat">
            {contrat ? (CONTRACT_LABELS[contrat.contractType] ?? contrat.contractType) : null}
          </DataBlock>
          <DataBlock label="Date d'embauche">{formatDate(e.hiredOn)}</DataBlock>
          <DataBlock label="Fin de contrat">
            {contrat?.endDate ? formatDate(contrat.endDate) : 'Sans terme'}
          </DataBlock>
        </DataGrid>

        <p className="mt-3.5 text-[11.5px] leading-relaxed text-ink-muted">
          Ce sont les informations que l&apos;attestation reprend. Une erreur ici se corrige sur la{' '}
          <Link
            href={`/employees/${piece.employeeId}`}
            className="font-semibold text-primary hover:underline"
          >
            fiche de l&apos;employé
          </Link>{' '}
          avant de valider.
        </p>
      </div>
    </>
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
