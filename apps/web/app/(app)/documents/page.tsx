'use client';

import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AttestationApercu,
  BatchAdvanceResult,
  DocumentRequestView,
  PeriodeDuBulletin,
  RequestableDoc,
} from '@teranga/contracts';
import {
  capaciteDuDocument,
  documentDemande,
  GENERATED_DOCS,
  peut,
  REQUESTABLE_DOC_LABELS,
} from '@teranga/contracts';
import {
  Button,
  CardHeader,
  CardTitle,
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
import { enregistrer } from '../../../lib/fichiers';
import { formatDate, useMe } from '../../../lib/hooks';
import { de } from '../../../lib/mots';
import { DocumentsDeposes } from '../../../components/documents-deposes';
import { Icon } from '../../../components/icons';
import { LoadFailure } from '../../../components/load-failure';
import { Modal, ModalGrid, ModalSection } from '../../../components/modal';
import { CartePleine, CorpsDefilant, Page } from '../../../components/gabarit';
import { Pagination, usePagination } from '../../../components/pagination';
import { DeleguerDocuments, DOCUMENTS_DELEGABLES } from '../../../components/deleguer-documents';
import {
  BandeauDelegation,
  BandeauMessage,
  EnTetePliable,
  listePrenoms,
  Pastille,
  useMembresDCH,
  type Message,
} from '../../../components/traitement-dch';
import {
  BarreSelection,
  LIGNE_COCHEE,
  SqueletteTableau,
  TdCase,
  TdGouttiere,
  ThCases,
  ThGouttiere,
  ThTri,
  useSelection,
  useTriLocal,
} from '../../../components/tableau';

/** Demandes encore à la charge de la DCH — celles qui peuplent le premier tableau. */
const OPEN = ['received', 'processing'];

/** « Bulletin de salaire · 3 derniers mois » : le bulletin se lit avec ses mois. */
function docLabels(r: DocumentRequestView): string {
  return r.docTypes.map((d) => documentDemande(d, r.bulletin)).join(' · ');
}

/** « d’attestation de travail », « de bulletin de salaire ». */
const deDocument = (doc: RequestableDoc) => {
  const l = REQUESTABLE_DOC_LABELS[doc].toLowerCase();
  return /^[aeiouéh]/.test(l) ? `d’${l}` : `de ${l}`;
};

/** « a », « a et b », « a, b et c ». */
const enumerer = (mots: string[]) =>
  mots.length > 1 ? `${mots.slice(0, -1).join(', ')} et ${mots[mots.length - 1]}` : (mots[0] ?? '');

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

  const me = useMe();
  const estDirecteur = Boolean(me.data?.dirigeLaDCH);
  const [panneau, setPanneau] = useState<'traiter' | 'decliner' | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [traiteesOuvertes, setTraiteesOuvertes] = useState(false);
  // La demande prête dont on ouvre les documents remis : on la relit dans la
  // liste à chaque rendu, pour voir le fichier qu'on vient d'ajouter.
  const [documentsDe, setDocumentsDe] = useState<string | null>(null);
  const membres = useMembresDCH().data?.membres ?? [];

  // Le bandeau : au directeur, qui peut traiter ; au membre, ce qui lui est délégué.
  const peutTraiterLeDoc = (m: { capacites: readonly string[] }, doc: RequestableDoc) =>
    m.capacites.includes(capaciteDuDocument(doc));
  const delegues = membres.filter((m) => DOCUMENTS_DELEGABLES.some((d) => peutTraiterLeDoc(m, d)));
  const tousLesDocuments = delegues.every((m) =>
    DOCUMENTS_DELEGABLES.every((d) => peutTraiterLeDoc(m, d)),
  );
  const miens = DOCUMENTS_DELEGABLES.filter((d) => peut(me.data, capaciteDuDocument(d)));

  const items = useMemo(() => requests.data ?? [], [requests.data]);
  // Ce que l'appelant peut traiter — le directeur, tout, délégué ou non —,
  // et sa propre demande, qu'il délègue. Qui consulte seulement voit la file
  // entière, sans geste.
  const traite = estDirecteur || miens.length > 0 || items.some((r) => r.canAdvance);
  const ouvertes = useMemo(
    () =>
      items.filter(
        (r) =>
          OPEN.includes(r.status) && (!traite || r.canAdvance || Boolean(r.traitement?.aConfier)),
      ),
    [items, traite],
  );
  const traitees = useMemo(() => {
    // Un historique se lit du plus récent au plus ancien. Annoncer le retrait
    // CLÔT le travail de la RH : l'employé est prévenu et vient chercher son
    // document, il n'y a plus rien à relancer depuis cet écran. Une demande
    // que l'agent a annulée n'a pas été traitée : elle n'y figure pas.
    return items
      .filter((r) => !OPEN.includes(r.status) && r.status !== 'cancelled')
      .sort((a, b) => (b.handledAt ?? b.createdAt).localeCompare(a.handledAt ?? a.createdAt));
  }, [items]);

  /**
   * L'ordre de la file : les plus ANCIENNES d'abord par défaut — la file se
   * lit du plus urgent au plus frais, à l'inverse de l'historique. Les autres
   * colonnes se trient au clic.
   */
  const tri = useTriLocal(
    ouvertes,
    {
      employeeNumber: (r) => r.employeeNumber,
      employeeName: (r) => r.employeeName,
      requete: (r) => docLabels(r),
      createdAt: (r) => r.createdAt,
    },
    { colonne: 'createdAt', sens: 'asc' },
    { createdAt: 'desc', employeeNumber: 'asc', employeeName: 'asc', requete: 'asc' },
  );
  const aTraiter = tri.lignes;
  // Quinze par page ; comme pour le personnel, la sélection porte sur la
  // page affichée.
  const fileVue = usePagination(aTraiter, `${tri.colonne}|${tri.sens}`);
  const historique = usePagination(traitees);
  const sel = useSelection(fileVue.tranche);
  const selectionnees = sel.choisis;

  if (requests.isError) {
    return <LoadFailure error={requests.error} onRetry={() => void requests.refetch()} />;
  }

  return (
    <Page>
      {message ? <BandeauMessage message={message} /> : null}

      {estDirecteur ? (
        <BandeauDelegation
          icone="arrow_split"
          texte={
            delegues.length > 0
              ? `${listePrenoms(delegues)} ${delegues.length > 1 ? 'peuvent' : 'peut'} désormais traiter ${tousLesDocuments ? 'les' : 'certaines'} demandes de documents.`
              : 'Vous pouvez déléguer cette tâche à votre équipe.'
          }
          action={<DeleguerDocuments membres={membres} onFait={() => setMessage(null)} />}
        />
      ) : miens.length > 0 ? (
        <BandeauDelegation
          icone="how_to_reg"
          texte={
            miens.length === DOCUMENTS_DELEGABLES.length
              ? 'La DCH vous a délégué le traitement des demandes de documents.'
              : `La DCH vous a délégué le traitement des demandes ${enumerer(miens.map(deDocument))}.`
          }
        />
      ) : null}

      <CartePleine>
        <CardHeader className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2">
          <CardTitle className="min-w-0 flex-1">Demandes à traiter</CardTitle>
          {traite ? (
            <BarreSelection sel={sel} quoi="demande" feminin>
              <Button size="sm" onClick={() => setPanneau('traiter')}>
                <Icon name="folder_managed" size={15} />
                Prévisualiser
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setPanneau('decliner')}>
                Décliner
              </Button>
            </BarreSelection>
          ) : null}
          {aTraiter.length > 0 ? <Pastille n={aTraiter.length} /> : null}
        </CardHeader>
        {requests.isLoading ? (
          <CorpsDefilant>
            <SqueletteTableau />
          </CorpsDefilant>
        ) : aTraiter.length === 0 ? (
          <CorpsDefilant className="grid place-items-center">
            <EmptyState
              icon={<Icon name="folder_managed" size={22} />}
              title="Tout est traité"
              description="Aucune demande n'attend de votre part. L'historique est juste en dessous."
            />
          </CorpsDefilant>
        ) : (
          <Table pleine>
            <THead>
              <tr>
                {traite ? <ThCases sel={sel} /> : <ThGouttiere />}
                <ThTri
                  label="Requête"
                  colonne="requete"
                  courant={tri.colonne}
                  sens={tri.sens}
                  onTrier={tri.trier}
                />
                <ThTri
                  label="Demandeur"
                  colonne="employeeName"
                  courant={tri.colonne}
                  sens={tri.sens}
                  onTrier={tri.trier}
                />
                <ThTri
                  label="Matricule"
                  colonne="employeeNumber"
                  courant={tri.colonne}
                  sens={tri.sens}
                  onTrier={tri.trier}
                />
                <ThTri
                  label="Date"
                  colonne="createdAt"
                  courant={tri.colonne}
                  sens={tri.sens}
                  onTrier={tri.trier}
                />
                {/* Le temps écoulé se trie PAR LA DATE, colonne « Date » : deux
                    en-têtes pour le même ordre seraient deux fois le même
                    bouton. Celui-ci reste un intitulé. */}
                <Th className="text-right">Temps écoulé</Th>
                {traite ? null : <Th>Traitée par</Th>}
              </tr>
            </THead>
            <TBody>
              {fileVue.tranche.map((r) => {
                const h = hoursSince(r.createdAt);
                return (
                  <Tr key={r.id} className={cn(sel.coche(r.id) && LIGNE_COCHEE)}>
                    {traite ? (
                      <TdCase sel={sel} id={r.id} quoi={`la demande de ${r.employeeName}`} />
                    ) : (
                      <TdGouttiere />
                    )}
                    <Td>
                      {docLabels(r)}
                      {r.traitement?.aConfier ? (
                        <span className="block text-[11px] font-semibold text-accent-text">
                          Votre propre demande, à déléguer à un membre de la DCH
                        </span>
                      ) : null}
                      {r.note ? (
                        <span className="block text-[11px] text-ink-muted italic">
                          « {r.note} »
                        </span>
                      ) : null}
                      {r.fichiers.length > 0 ? (
                        <span className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-muted">
                          <Icon name="upload_file" size={13} className="shrink-0" />
                          {r.fichiers.length > 1
                            ? `${r.fichiers.length} fichiers déposés`
                            : '1 fichier déposé'}
                        </span>
                      ) : null}
                    </Td>
                    <Td>
                      <Link
                        href={`/employees/${r.employeeId}`}
                        className="font-bold text-ink-strong hover:underline"
                      >
                        {r.employeeName}
                      </Link>
                    </Td>
                    <Td className="font-mono text-[11.5px] text-ink-muted">{r.employeeNumber}</Td>
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
                    {traite ? null : (
                      <Td className="text-[12px] text-ink-muted">{r.traitement?.traitants}</Td>
                    )}
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        )}
      </CartePleine>
      <Pagination
        {...fileVue.barre}
        onPage={(p) => {
          sel.vider();
          fileVue.barre.onPage(p);
        }}
      />

      <CartePleine>
        <EnTetePliable
          titre="Demandes traitées"
          n={traitees.length}
          ouvert={traiteesOuvertes}
          onBasculer={() => setTraiteesOuvertes((o) => !o)}
        />
        {!traiteesOuvertes ? null : requests.isLoading ? (
          <CorpsDefilant>
            <SqueletteTableau />
          </CorpsDefilant>
        ) : traitees.length === 0 ? (
          <CorpsDefilant className="grid place-items-center">
            <EmptyState
              icon={<Icon name="folder_managed" size={22} />}
              title="Aucune demande traitée"
              description="L'historique se remplira au fur et à mesure des demandes que vous clôturez."
            />
          </CorpsDefilant>
        ) : (
          <Table pleine>
            <THead>
              <tr>
                <ThGouttiere />
                <Th>Requête</Th>
                <Th>Demandeur</Th>
                <Th>Matricule</Th>
                <Th>Date</Th>
                <Th className="text-right">Durée traitement</Th>
                <Th>Suite donnée</Th>
              </tr>
            </THead>
            <TBody>
              {historique.tranche.map((r) => (
                <Tr key={r.id}>
                  <TdGouttiere />
                  <Td>{docLabels(r)}</Td>
                  <Td>
                    <Link
                      href={`/employees/${r.employeeId}`}
                      className="font-bold text-ink-strong hover:underline"
                    >
                      {r.employeeName}
                    </Link>
                  </Td>
                  <Td className="font-mono text-[11.5px] text-ink-muted">{r.employeeNumber}</Td>
                  <Td className="whitespace-nowrap text-ink-muted">
                    {formatDate(r.createdAt.slice(0, 10))}
                  </Td>
                  <Td
                    className="text-right font-semibold whitespace-nowrap text-ink-muted"
                    style={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {r.handledAt ? heures(ecartHeures(r.createdAt, r.handledAt)) : null}
                  </Td>
                  {/* Ce qui a été RÉPONDU au demandeur, pas l'étiquette d'un
                        automate : le document déposé dans son espace, le
                        point de retrait annoncé, ou le motif du refus. */}
                  <Td>
                    {r.status === 'rejected' ? (
                      <span className="font-semibold text-danger">
                        Refusée{r.hrMessage ? ` : ${r.hrMessage}` : ''}
                      </span>
                    ) : (
                      <SuiteDonnee demande={r} onDocuments={() => setDocumentsDe(r.id)} />
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </CartePleine>
      {traiteesOuvertes ? <Pagination {...historique.barre} /> : null}

      {panneau === 'traiter' ? (
        <TraiterModal
          requests={selectionnees}
          onClose={() => setPanneau(null)}
          onDone={() => {
            setPanneau(null);
            sel.vider();
          }}
        />
      ) : null}
      {documentsDe ? (
        <DocumentsRemisModal
          demande={items.find((r) => r.id === documentsDe) ?? null}
          onClose={() => setDocumentsDe(null)}
        />
      ) : null}
      {panneau === 'decliner' ? (
        <DeclinerModal
          requests={selectionnees}
          onClose={() => setPanneau(null)}
          onDone={() => {
            setPanneau(null);
            sel.vider();
          }}
        />
      ) : null}
    </Page>
  );
}

/**
 * La suite donnée à une demande prête : déposée dans l'espace de l'agent
 * (l'original parfois à retirer), ou à retirer auprès de quelqu'un. Qui
 * traite ce document ouvre ses fichiers pour les vérifier ou les corriger,
 * et peut encore en déposer un pour qui ne peut pas passer au bureau.
 */
function SuiteDonnee({
  demande: r,
  onDocuments,
}: {
  demande: DocumentRequestView;
  onDocuments: () => void;
}) {
  const n = r.fichiers.length;
  const fichiers = `${n} fichier${n > 1 ? 's' : ''}`;
  return (
    <>
      <span className="text-ink">
        {n > 0
          ? `Déposée en ligne${r.pickupContact ? ` · Original auprès ${de(r.pickupContact)}` : ''}`
          : r.pickupContact
            ? `À retirer auprès ${de(r.pickupContact)}`
            : 'Prête'}
      </span>
      {n > 0 || r.hrMessage || (r.canHandleFiles && r.status === 'ready') ? (
        <span className="block text-[11px] text-ink-muted">
          {r.canHandleFiles && r.status === 'ready' ? (
            <button
              type="button"
              onClick={onDocuments}
              className="font-semibold text-primary hover:underline"
            >
              {n > 0 ? fichiers : 'Déposer en ligne'}
            </button>
          ) : n > 0 ? (
            fichiers
          ) : null}
          {(n > 0 || (r.canHandleFiles && r.status === 'ready')) && r.hrMessage ? ' · ' : null}
          {r.hrMessage}
        </span>
      ) : null}
    </>
  );
}

/**
 * Les documents remis d'une demande prête. Ajouter un fichier le met
 * aussitôt dans l'espace de l'agent, et un avis l'annonce ; un mauvais
 * fichier se retire, sans laisser la demande sans document.
 */
function DocumentsRemisModal({
  demande: r,
  onClose,
}: {
  demande: DocumentRequestView | null;
  onClose: () => void;
}) {
  const [erreur, setErreur] = useState<string | null>(null);
  if (!r) return null;
  return (
    <Modal
      open
      onClose={onClose}
      title={r.fichiers.length > 0 ? 'Documents déposés' : 'Déposer en ligne'}
      subtitle={`${r.employeeName} · ${docLabels(r)}`}
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
            Fermer
          </Button>
        </>
      }
    >
      <section className="rounded-[14px] border border-line-soft bg-surface px-4 py-4 sm:px-[18px]">
        <DocumentsDeposes demande={r} onErreur={setErreur} />
      </section>
    </Modal>
  );
}

/** Un document à produire pour une demande donnée. */
interface Piece {
  key: string;
  requestId: string;
  employeeId: string;
  employeeName: string;
  /** Ce qui nomme le fichier téléchargé — un nom se répète, un matricule non. */
  employeeNumber: string;
  employeeStatus: string;
  doc: RequestableDoc;
  /** Les mois d'un bulletin de salaire. */
  bulletin: PeriodeDuBulletin | null;
  /** L'application sait la produire elle-même (attestation de travail). */
  generable: boolean;
}

/**
 * Enregistre sur le poste de la RH les pièces que l'application produit.
 *
 * Une pièce que l'application ne produit pas (contrat, bulletin) n'a rien à
 * télécharger : elle est préparée à la main, hors de l'outil.
 *
 * Rend le nombre de fichiers réellement enregistrés : un échec ne doit pas
 * passer pour un succès. Un fichier manquant n'arrête pas les autres.
 */
async function telechargerLesPieces(pieces: Piece[]): Promise<number> {
  let n = 0;
  for (const p of pieces.filter((x) => x.generable)) {
    const ok = await enregistrer(
      `/employees/${p.employeeId}/attestation`,
      `attestation-travail-${p.employeeNumber}.pdf`,
    );
    if (ok) n += 1;
  }
  return n;
}

function piecesOf(requests: DocumentRequestView[]): Piece[] {
  return requests.flatMap((r) =>
    r.docTypes.map((d) => ({
      key: `${r.id}:${d}`,
      requestId: r.id,
      employeeId: r.employeeId,
      employeeName: r.employeeName,
      employeeNumber: r.employeeNumber,
      employeeStatus: r.employeeStatus,
      doc: d,
      bulletin: r.bulletin,
      generable: (GENERATED_DOCS as string[]).includes(d) && r.employeeStatus === 'active',
    })),
  );
}

/**
 * Qui demande quoi : le nom, le matricule et la demande. Sur téléphone, le
 * matricule passe à côté du nom et la demande dessous.
 */
function DemandesDuLot({ requests }: { requests: DocumentRequestView[] }) {
  return (
    <>
      <div className="hidden grid-cols-[minmax(0,1.1fr)_minmax(0,0.7fr)_minmax(0,1.5fr)] gap-x-4 gap-y-2 text-[12.5px] sm:grid">
        <span className="text-[11px] font-semibold text-ink-muted">Demandeur</span>
        <span className="text-[11px] font-semibold text-ink-muted">Matricule</span>
        <span className="text-[11px] font-semibold text-ink-muted">Demande</span>
        {requests.map((r) => (
          <Fragment key={r.id}>
            <span className="truncate font-bold text-ink-strong" title={r.employeeName}>
              {r.employeeName}
            </span>
            <span className="font-mono text-[11.5px] text-ink-muted">{r.employeeNumber}</span>
            <span className="text-ink">{docLabels(r)}</span>
          </Fragment>
        ))}
      </div>
      <ul className="flex flex-col gap-2.5 text-[12.5px] sm:hidden">
        {requests.map((r) => (
          <li key={r.id}>
            <p className="flex items-baseline gap-2">
              <span className="font-bold text-ink-strong">{r.employeeName}</span>
              <span className="font-mono text-[11.5px] text-ink-muted">{r.employeeNumber}</span>
            </p>
            <p className="text-ink">{docLabels(r)}</p>
          </li>
        ))}
      </ul>
    </>
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
  const [etape, setEtape] = useState<'apercu' | 'remise'>('apercu');
  // En main propre, ou dans l'espace de l'agent. Un lot dont un document
  // est déjà déposé reprend là où on l'avait laissé.
  const [remise, setRemise] = useState<'main_propre' | 'en_ligne'>(() =>
    requests.some((r) => r.fichiers.length > 0) ? 'en_ligne' : 'main_propre',
  );
  const envois = useIsMutating({ mutationKey: ['documents-deposes'] });
  const [telechargement, setTelechargement] = useState(false);
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
    mutationFn: async () => {
      if (remise === 'main_propre') {
        // Remis en main propre, rien ne part dans l'espace de l'agent : un
        // fichier déposé puis laissé de côté n'y apparaît pas.
        for (const r of requests) {
          for (const f of r.fichiers) {
            await api(`/document-requests/${r.id}/fichiers/${f.id}`, { method: 'DELETE' });
          }
        }
      }
      // En ligne, ni point de retrait ni précision : le document est là.
      const enMain = remise === 'main_propre';
      return api<BatchAdvanceResult>('/document-requests/batch-advance', {
        method: 'POST',
        body: {
          ids: requests.map((r) => r.id),
          status: 'ready',
          pickupContact: (enMain && pickupContact.trim()) || undefined,
          message: (enMain && message.trim()) || undefined,
        },
      });
    },
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
            Les autres ont bien été traitées. Celles-ci avaient changé d&apos;état entre-temps :
          </p>
          <ul className="flex flex-col gap-1.5">
            {ecartees.map((s) => (
              <li key={s.id} className="flex items-center gap-2 text-[12.5px]">
                <Icon name="error" size={15} className="shrink-0 text-warning" />
                <span className="font-semibold text-ink-strong">{s.employeeName || 'Demande'}</span>
                <span className="text-ink-muted">· {s.reason}</span>
              </li>
            ))}
          </ul>
        </ModalSection>
      </Modal>
    );
  }

  const nbDemandes = `${requests.length} demande${requests.length > 1 ? 's' : ''}`;

  if (etape === 'remise') {
    const enLigne = remise === 'en_ligne';
    const sansDocument = requests.some((r) => r.fichiers.length === 0);
    // Le pluriel compte les DOCUMENTS, pas les demandes : une seule demande
    // peut en porter deux (attestation de travail et de salaire).
    const plusieurs = pieces.length > 1;
    return (
      <Modal
        open
        onClose={onClose}
        title="Mise à disposition"
        subtitle="Étape 2 sur 2 · Remise"
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
            {enLigne ? (
              <Button
                disabled={sansDocument || envois > 0}
                loading={valider.isPending}
                onClick={() => {
                  setErreur(null);
                  valider.mutate();
                }}
              >
                Déposer et prévenir
              </Button>
            ) : (
              <Button
                loading={telechargement || valider.isPending}
                onClick={async () => {
                  setErreur(null);
                  // Les fichiers PARTENT D'ABORD. Annoncer le retrait puis
                  // échouer au téléchargement annoncerait un document que la
                  // RH n'a pas ; l'inverse se rattrape d'un clic.
                  setTelechargement(true);
                  await telechargerLesPieces(pieces);
                  setTelechargement(false);
                  valider.mutate();
                }}
              >
                Télécharger et prévenir
              </Button>
            )}
          </>
        }
      >
        <ModalSection title={plusieurs ? 'Documents demandés' : 'Document demandé'}>
          <DemandesDuLot requests={requests} />
        </ModalSection>

        <ModalSection title="Remise">
          <div
            role="radiogroup"
            aria-label="Remise"
            className="flex gap-1 rounded-full border border-line-soft bg-bg p-1 sm:w-fit"
          >
            {(
              [
                ['main_propre', 'En main propre'],
                ['en_ligne', 'En ligne'],
              ] as const
            ).map(([valeur, libelle]) => (
              <button
                key={valeur}
                type="button"
                role="radio"
                aria-checked={remise === valeur}
                onClick={() => {
                  setErreur(null);
                  setRemise(valeur);
                }}
                className={cn(
                  'flex-1 rounded-full px-3.5 py-1.5 text-[12.5px] font-bold whitespace-nowrap transition-colors sm:flex-none',
                  remise === valeur
                    ? 'bg-surface text-primary shadow-sm'
                    : 'text-ink-muted hover:text-ink',
                )}
              >
                {libelle}
              </button>
            ))}
          </div>
        </ModalSection>

        {enLigne ? (
          <ModalSection title={plusieurs ? 'Documents à déposer' : 'Document à déposer'}>
            {requests.length > 1 ? (
              <div className="flex flex-col gap-2">
                {requests.map((r) => (
                  <DocumentsDeposes key={r.id} demande={r} lot attendu onErreur={setErreur} />
                ))}
              </div>
            ) : requests[0] ? (
              <DocumentsDeposes demande={requests[0]} attendu onErreur={setErreur} />
            ) : null}
          </ModalSection>
        ) : (
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
        )}
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
          <Button disabled={restantes > 0} onClick={() => setEtape('remise')}>
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
                    'flex w-full items-center gap-2.5 rounded-[12px] px-3 py-2.5 text-left',
                    'ring-1 ring-inset transition-all duration-150',
                    active
                      ? 'bg-primary/[0.06] ring-primary/35'
                      : 'bg-surface ring-line-soft hover:bg-hover hover:ring-line',
                  )}
                >
                  {/* La pastille dit où l'on en est : un numéro tant qu'il
                      reste à voir, une coche une fois vu, un point pour ce qui
                      n'entre pas dans le contrôle. */}
                  <span
                    className={cn(
                      'flex size-[20px] shrink-0 items-center justify-center rounded-full text-[10px] font-bold transition-colors',
                      vue
                        ? 'bg-success-soft text-success ring-1 ring-success/35 ring-inset'
                        : active
                          ? 'bg-primary text-primary-ink'
                          : 'text-ink-muted ring-1 ring-line ring-inset',
                    )}
                  >
                    {vue ? <Icon name="check" size={13} /> : p.generable ? i + 1 : '·'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        'block truncate text-[12px] leading-tight font-bold',
                        active ? 'text-primary' : 'text-ink-strong',
                      )}
                    >
                      {documentDemande(p.doc, p.bulletin)}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] leading-tight text-ink-muted">
                      {p.employeeName}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {/* L'aperçu : le document tel qu'il sera remis, pas une promesse. */}
        <div className="flex min-h-[19rem] min-w-0 flex-1 flex-col overflow-hidden rounded-[16px] border border-card-line bg-surface shadow-xs">
          {piece ? <Apercu piece={piece} onVue={marquerVue} /> : null}
        </div>
      </div>
    </Modal>
  );
}

/**
 * Aperçu d'une pièce : le texte que le PDF imprimera, mot pour mot.
 *
 * Une A4 encastrée, réduite à la taille d'une fenêtre, ne se lit pas. Le
 * serveur rend donc les textes de l'attestation, ceux-là mêmes qu'il met dans
 * le PDF, et l'écran les compose comme la feuille. Le PDF reste à un clic.
 */
function Apercu({ piece, onVue }: { piece: Piece; onVue: (key: string) => void }) {
  const detail = useQuery({
    queryKey: ['attestation-apercu', piece.employeeId],
    queryFn: () => api<AttestationApercu>(`/employees/${piece.employeeId}/attestation/apercu`),
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
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line-soft bg-surface-raised px-5 py-3">
      <div className="min-w-0">
        <p className="truncate text-[13.5px] leading-tight font-bold text-ink-strong">
          {documentDemande(piece.doc, piece.bulletin)}
        </p>
        <p className="mt-0.5 truncate text-[11.5px] leading-tight text-ink-muted">
          {piece.employeeName}
        </p>
      </div>
      {detail.isSuccess ? (
        <a
          href={apiUrl(`/employees/${piece.employeeId}/attestation?disposition=inline`)}
          target="_blank"
          rel="noreferrer"
          tabIndex={-1}
        >
          <Button size="sm" variant="secondary">
            <Icon name="picture_as_pdf" size={15} />
            Ouvrir le PDF
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

  const a = detail.data;
  return (
    <>
      {entete}
      <div className="flex-1 overflow-y-auto bg-surface-raised/60 px-3 py-4 sm:px-6 sm:py-6">
        <article className="mx-auto max-w-[38rem] rounded-[6px] bg-surface px-5 py-8 text-[13px] leading-[1.8] text-ink-strong shadow-xs ring-1 ring-line-soft sm:px-12 sm:py-12">
          <h3 className="text-center">
            <span className="border-b border-current pb-0.5 text-[14.5px] font-bold tracking-[0.12em]">
              {a.titre}
            </span>
          </h3>
          <div className="mt-9 flex flex-col gap-4 text-justify">
            {a.paragraphes.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </div>
          <p className="mt-10 text-right">{a.lieuEtDate}</p>
          <div className="mt-6 text-right">
            {a.signature.map((ligne, i) => (
              <p key={ligne} className={i === 0 ? 'font-bold' : undefined}>
                {ligne}
              </p>
            ))}
          </div>
        </article>
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
              <span className="text-ink-muted"> · {docLabels(r)}</span>
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
