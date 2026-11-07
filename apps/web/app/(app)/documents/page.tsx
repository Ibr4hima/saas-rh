'use client';

import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { BatchAdvanceResult, DocumentRequestView } from '@teranga/contracts';
import {
  capaciteDuDocument,
  DELAI_DE_TRAITEMENT_HEURES,
  depuisLeDossier,
  documentDemande,
  FENETRE_DU_PRINCIPAL_HEURES,
  peut,
} from '@teranga/contracts';
import {
  Button,
  CardHeader,
  CardTitle,
  cn,
  EmptyState,
  Input,
  TBody,
  Td,
  Th,
  THead,
  Table,
  Tr,
} from '@teranga/ui';
import { api, ApiError, apiUrl } from '../../../lib/api';
import { formatDate, useMe } from '../../../lib/hooks';
import { DocumentsDeposes } from '../../../components/documents-deposes';
import { FenetreDocument } from '../../../components/fenetre-document';
import { Icon } from '../../../components/icons';
import { GESTE_DE_LA_LIGNE, VoirLaLettre } from '../../../components/lettre-de-demande';
import { LoadFailure } from '../../../components/load-failure';
import { Modal, ModalSection } from '../../../components/modal';
import { CartePleine, CorpsDefilant, Page } from '../../../components/gabarit';
import { Pagination, usePagination } from '../../../components/pagination';
import { DOCUMENTS_DELEGABLES } from '../../../components/deleguer-documents';
import {
  AuPrincipal,
  BandeauMessage,
  ConfierAuxBackups,
  EnTetePliable,
  Pastille,
  type Message,
} from '../../../components/traitement-dch';
import {
  BarreSelection,
  LIGNE_COCHEE,
  SqueletteTableau,
  TdCase,
  TdGouttiere,
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

/**
 * Une décision de disponibilité ou une domiciliation demandée, ouverte, que
 * la session traite : son document se génère depuis la demande (ADR-0189).
 */
function seGenereDepuisLaDemande(r: DocumentRequestView): boolean {
  const doc = r.docTypes[0];
  return (
    r.canAdvance &&
    OPEN.includes(r.status) &&
    r.docTypes.length === 1 &&
    doc !== undefined &&
    depuisLeDossier(doc)
  );
}

/**
 * Une attestation de travail demandée, ouverte, que la session traite :
 * l'application la produit, et on la génère avant de notifier l'agent. Le
 * droit de la lire s'éteint avec la demande.
 */
function attestationAGenerer(r: DocumentRequestView): boolean {
  return (
    r.canAdvance &&
    OPEN.includes(r.status) &&
    r.docTypes.includes('attestation_travail') &&
    r.employeeStatus === 'active'
  );
}

/** Lire la lettre de la demande, et générer son document : sous la requête. */
function GestesDeLaDemande({ demande: r }: { demande: DocumentRequestView }) {
  const [attestation, setAttestation] = useState(false);
  const generer = seGenereDepuisLaDemande(r);
  const aGenerer = attestationAGenerer(r);
  if (!r.lettre && !generer && !aGenerer) return null;
  return (
    <span className="mt-1.5 flex flex-wrap gap-1.5">
      <VoirLaLettre demande={r} />
      {generer ? (
        <Link href={`/documents/${r.id}/generer`} className={GESTE_DE_LA_LIGNE}>
          <Icon name="description" size={13} className="shrink-0" />
          Générer le document
        </Link>
      ) : null}
      {aGenerer ? (
        <button type="button" onClick={() => setAttestation(true)} className={GESTE_DE_LA_LIGNE}>
          <Icon name="description" size={13} className="shrink-0" />
          Générer le document
        </button>
      ) : null}
      {attestation ? (
        <FenetreDocument
          doc={{
            url: apiUrl(`/employees/${r.employeeId}/attestation?disposition=inline`),
            filename: `attestation-travail-${r.employeeNumber}.pdf`,
            contentType: 'application/pdf',
            titre: `Attestation de travail · ${r.employeeName}`,
          }}
          telechargement={apiUrl(`/employees/${r.employeeId}/attestation`)}
          onClose={() => setAttestation(false)}
        />
      ) : null}
    </span>
  );
}

/**
 * Le temps réellement écoulé depuis la demande (ADR-0196) : « 12 min » sous
 * l'heure, « 3 h 5 min » sous le jour, puis « 2 j 4 h ». La couleur de la
 * colonne, elle, compte les heures ouvrées (ADR-0128).
 */
function duree(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  if (h < 24) {
    const m = minutes % 60;
    return m === 0 ? `${h} h` : `${h} h ${m} min`;
  }
  const j = Math.floor(h / 24);
  return h % 24 === 0 ? `${j} j` : `${j} j ${h % 24} h`;
}

export default function DocumentRequestsPage() {
  const queryClient = useQueryClient();
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

  // Les documents que la DCH a délégués à l'appelant.
  const miens = DOCUMENTS_DELEGABLES.filter((d) => peut(me.data, capaciteDuDocument(d)));

  const items = useMemo(() => requests.data ?? [], [requests.data]);
  // Ce que l'appelant peut traiter — le directeur, tout, délégué ou non —,
  // sa propre demande, à déléguer, et ce que les backups voient sans
  // pouvoir encore le traiter (ADR-0128). Qui consulte seulement voit la
  // file entière, sans geste.
  const traite = estDirecteur || miens.length > 0 || items.some((r) => r.canAdvance);
  const ouvertes = useMemo(
    () =>
      items.filter(
        (r) =>
          OPEN.includes(r.status) &&
          (!traite ||
            r.canAdvance ||
            Boolean(r.traitement?.aConfier) ||
            Boolean(r.traitement?.fenetre?.enAttente)),
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
  // Quinze par page.
  const fileVue = usePagination(aTraiter, `${tri.colonne}|${tri.sens}`);
  const historique = usePagination(traitees);
  // Ne se coche que ce qu'on traite : jamais sa propre demande, qui
  // s'annule depuis l'espace personnel (ADR-0060). Et une seule à la fois :
  // une demande se traite seule (ADR-0192).
  const cochables = useMemo(() => fileVue.tranche.filter((r) => r.canAdvance), [fileVue.tranche]);
  const sel = useSelection(cochables, { unique: true });
  // Relue dans la liste à chaque rendu : un document déposé s'y voit aussitôt.
  const choisie = sel.choisis[0] ?? null;

  if (requests.isError) {
    return <LoadFailure error={requests.error} onRetry={() => void requests.refetch()} />;
  }

  return (
    <Page>
      {message ? <BandeauMessage message={message} /> : null}

      <CartePleine>
        <CardHeader className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2">
          <CardTitle className="min-w-0 flex-1">Demandes à traiter</CardTitle>
          {traite ? (
            <BarreSelection sel={sel} quoi="demande" feminin>
              <Button size="sm" onClick={() => setPanneau('traiter')}>
                <Icon name="folder_managed" size={15} />
                Traiter
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
              title="Aucune demande en attente"
              description="Les demandes déjà traitées sont listées ci-dessous."
            />
          </CorpsDefilant>
        ) : (
          <Table pleine>
            <THead>
              <tr>
                <ThGouttiere />
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
                const h = r.heuresOuvrees ?? 0;
                return (
                  <Tr key={r.id} className={cn(sel.coche(r.id) && LIGNE_COCHEE)}>
                    {traite && r.canAdvance ? (
                      <TdCase sel={sel} id={r.id} quoi={`la demande de ${r.employeeName}`} />
                    ) : (
                      <TdGouttiere />
                    )}
                    <Td>
                      {docLabels(r)}
                      {r.traitement?.aConfier ? (
                        <span className="block text-[11px] font-semibold text-accent-text">
                          Déléguer à un membre de la DCH
                        </span>
                      ) : null}
                      {r.traitement?.fenetre?.enAttente ? (
                        <span className="mt-0.5 block">
                          <AuPrincipal fenetre={r.traitement.fenetre} />
                        </span>
                      ) : null}
                      {r.traitement?.fenetre?.peutOuvrir ? (
                        <span className="mt-1.5 block">
                          <ConfierAuxBackups
                            chemin={`/demandes/documents/${r.id}/ouvrir`}
                            employe={r.employeeName}
                            onFait={async () => {
                              setMessage({
                                ton: 'ok',
                                texte: `Demande de ${r.employeeName} confiée à vos backups.`,
                              });
                              await queryClient.invalidateQueries({
                                queryKey: ['document-requests'],
                              });
                              await queryClient.invalidateQueries({
                                queryKey: ['validations-compteurs'],
                              });
                            }}
                            onErreur={(texte) => setMessage({ ton: 'erreur', texte })}
                          />
                        </span>
                      ) : null}
                      {r.note ? (
                        <span className="block text-[11px] text-ink-muted italic">
                          « {r.note} »
                        </span>
                      ) : null}
                      <GestesDeLaDemande demande={r} />
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
                        // Le retard se signale seul : passé 48 heures ouvrées,
                        // la fenêtre de la personne principale est close ;
                        // passé 72, le délai de traitement (ADR-0128).
                        h >= DELAI_DE_TRAITEMENT_HEURES
                          ? 'text-danger'
                          : h >= FENETRE_DU_PRINCIPAL_HEURES
                            ? 'text-warning'
                            : 'text-ink-muted',
                      )}
                      style={{ fontVariantNumeric: 'tabular-nums' }}
                    >
                      {duree(r.minutesEcoulees ?? 0)}
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
      <Pagination {...fileVue.barre} />

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
              description="Les demandes que vous traiterez apparaîtront ici."
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
                  <Td>
                    {docLabels(r)}
                    <GestesDeLaDemande demande={r} />
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
                      // Traitée hors délai : plus de 72 heures ouvrées, sans
                      // les week-ends ni les jours fériés (ADR-0196).
                      r.heuresOuvrees !== null && r.heuresOuvrees >= DELAI_DE_TRAITEMENT_HEURES
                        ? 'text-danger'
                        : 'text-ink-muted',
                    )}
                    style={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {r.handledAt && r.minutesEcoulees !== null ? duree(r.minutesEcoulees) : null}
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

      {panneau === 'traiter' && choisie ? (
        <TraiterModal
          demande={choisie}
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
      {panneau === 'decliner' && choisie ? (
        <DeclinerModal
          demande={choisie}
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
 * La suite donnée à une demande prête : déposée en ligne (l'original parfois
 * à retirer), ou à retirer auprès de quelqu'un. Qui traite ce document ouvre
 * d'un clic ce qui est déposé, pour le vérifier ou le corriger, et peut
 * encore déposer pour qui ne peut pas passer au bureau (ADR-0040).
 */
function SuiteDonnee({
  demande: r,
  onDocuments,
}: {
  demande: DocumentRequestView;
  onDocuments: () => void;
}) {
  const deposee = r.fichiers.length > 0;
  const gere = r.canHandleFiles && r.status === 'ready';
  const suite = deposee
    ? `Déposée en ligne${r.pickupContact ? ` · Original auprès de ${r.pickupContact}` : ''}`
    : r.pickupContact
      ? `À retirer auprès de ${r.pickupContact}`
      : 'Prête';
  const deposer = gere && !deposee;
  return (
    <>
      {deposee && gere ? (
        <button
          type="button"
          onClick={onDocuments}
          className="text-left text-ink hover:text-primary hover:underline"
        >
          {suite}
        </button>
      ) : (
        <span className="text-ink">{suite}</span>
      )}
      {deposer || r.hrMessage ? (
        <span className="block text-[11px] text-ink-muted">
          {deposer ? (
            <button
              type="button"
              onClick={onDocuments}
              className="font-semibold text-primary hover:underline"
            >
              Déposer en ligne
            </button>
          ) : null}
          {deposer && r.hrMessage ? ' · ' : null}
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
      <section className="rounded-bloc border border-line-soft bg-surface px-4 py-4 sm:px-[18px]">
        <DocumentsDeposes demande={r} onErreur={setErreur} />
      </section>
    </Modal>
  );
}

/**
 * Qui demande quoi : le nom, le matricule et la demande. Sur téléphone, le
 * matricule passe à côté du nom et la demande dessous.
 */
function LaDemande({ demande: r }: { demande: DocumentRequestView }) {
  return (
    <>
      <div className="hidden grid-cols-[minmax(0,1.1fr)_minmax(0,0.7fr)_minmax(0,1.5fr)] gap-x-4 gap-y-2 text-[12.5px] sm:grid">
        <span className="text-[11px] font-semibold text-ink-muted">Demandeur</span>
        <span className="text-[11px] font-semibold text-ink-muted">Matricule</span>
        <span className="text-[11px] font-semibold text-ink-muted">Demande</span>
        <span className="truncate font-bold text-ink-strong" title={r.employeeName}>
          {r.employeeName}
        </span>
        <span className="font-mono text-[11.5px] text-ink-muted">{r.employeeNumber}</span>
        <span className="text-ink">{docLabels(r)}</span>
      </div>
      <div className="text-[12.5px] sm:hidden">
        <p className="flex items-baseline gap-2">
          <span className="font-bold text-ink-strong">{r.employeeName}</span>
          <span className="font-mono text-[11.5px] text-ink-muted">{r.employeeNumber}</span>
        </p>
        <p className="text-ink">{docLabels(r)}</p>
      </div>
    </>
  );
}

/**
 * Traiter une demande : la mise à disposition, en un écran (ADR-0191). Le
 * document se prépare avant, depuis la ligne de la demande (« Générer le
 * document ») ; ici, on dit comment il se remet, et l'agent est notifié. En
 * main propre, avec le point de retrait ; en ligne, le PDF déposé dans son
 * espace.
 */
function TraiterModal({
  demande,
  onClose,
  onDone,
}: {
  demande: DocumentRequestView;
  onClose: () => void;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  // En main propre, ou dans l'espace de l'agent. Une demande dont un document
  // est déjà déposé reprend là où on l'avait laissée.
  const [remise, setRemise] = useState<'main_propre' | 'en_ligne'>(() =>
    demande.fichiers.length > 0 ? 'en_ligne' : 'main_propre',
  );
  const envois = useIsMutating({ mutationKey: ['documents-deposes'] });
  const [pickupContact, setPickupContact] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);

  const valider = useMutation({
    mutationFn: async () => {
      if (remise === 'main_propre') {
        // Remis en main propre, rien ne part dans l'espace de l'agent : un
        // fichier déposé puis laissé de côté n'y apparaît pas.
        for (const f of demande.fichiers) {
          await api(`/document-requests/${demande.id}/fichiers/${f.id}`, { method: 'DELETE' });
        }
      }
      // En ligne, pas de point de retrait : le document est là.
      return api<BatchAdvanceResult>('/document-requests/batch-advance', {
        method: 'POST',
        body: {
          ids: [demande.id],
          status: 'ready',
          pickupContact: (remise === 'main_propre' && pickupContact.trim()) || undefined,
        },
      });
    },
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: ['document-requests'] });
      await queryClient.invalidateQueries({ queryKey: ['notifications'] });
      // La pastille de la barre de menu compte les demandes ouvertes : sans
      // ça elle continue d'annoncer un travail qui vient d'être fait.
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      // Modifiée entre-temps (annulée, traitée par quelqu'un d'autre) : on le
      // dit, plutôt que de refermer comme si tout était parti.
      const ecartee = res.skipped[0];
      if (ecartee) {
        setErreur(ecartee.reason);
        return;
      }
      onDone();
    },
    onError: (err) =>
      setErreur(err instanceof ApiError ? err.message : 'Enregistrement impossible.'),
  });

  const enLigne = remise === 'en_ligne';
  const sansDocument = demande.fichiers.length === 0;
  // Une demande ancienne peut porter deux documents.
  const plusieurs = demande.docTypes.length > 1;
  const notifier = () => {
    setErreur(null);
    valider.mutate();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Mise à disposition"
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
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          {enLigne ? (
            <Button
              disabled={sansDocument || envois > 0}
              loading={valider.isPending}
              onClick={notifier}
            >
              Déposer et notifier
            </Button>
          ) : (
            <Button loading={valider.isPending} onClick={notifier}>
              Notifier
            </Button>
          )}
        </>
      }
    >
      <ModalSection title={plusieurs ? 'Documents demandés' : 'Document demandé'}>
        <LaDemande demande={demande} />
      </ModalSection>

      {/* La remise, et en main propre le point de retrait à côté. */}
      <div className={cn('grid gap-3', !enLigne && 'sm:grid-cols-2')}>
        <ModalSection title="Remise">
          <div
            role="radiogroup"
            aria-label="Remise"
            className="flex gap-1 rounded-groupe border border-line-soft bg-bg p-[3px] sm:w-fit"
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
                  'flex-1 h-7 rounded-controle-sm px-3.5 text-[12.5px] font-bold whitespace-nowrap transition-colors sm:flex-none',
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
        {enLigne ? null : (
          <ModalSection title="Point de retrait">
            <Input
              id="pickupContact"
              aria-label="À retirer auprès de"
              placeholder="Par défaut : vous"
              value={pickupContact}
              onChange={(e) => setPickupContact(e.target.value)}
              className="h-9"
            />
          </ModalSection>
        )}
      </div>

      {enLigne ? (
        <ModalSection title={plusieurs ? 'Documents à déposer' : 'Document à déposer'}>
          <DocumentsDeposes demande={demande} onErreur={setErreur} />
        </ModalSection>
      ) : null}
    </Modal>
  );
}

/** Décliner une demande : le motif du refus part tel quel à l'agent (ADR-0191). */
function DeclinerModal({
  demande,
  onClose,
  onDone,
}: {
  demande: DocumentRequestView;
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
        body: { ids: [demande.id], status: 'rejected', message: motif.trim() },
      }),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: ['document-requests'] });
      await queryClient.invalidateQueries({ queryKey: ['notifications'] });
      // La pastille de la barre de menu compte les demandes ouvertes : sans
      // ça elle continue d'annoncer un travail qui vient d'être fait.
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      const ecartee = res.skipped[0];
      if (ecartee) {
        setErreur(ecartee.reason);
        return;
      }
      onDone();
    },
    onError: (err) => setErreur(err instanceof ApiError ? err.message : 'Refus impossible.'),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Décliner la demande"
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
      <ModalSection title={demande.docTypes.length > 1 ? 'Documents demandés' : 'Document demandé'}>
        <LaDemande demande={demande} />
      </ModalSection>
      <ModalSection title="Motif du refus">
        <Input
          id="motif"
          aria-label="Motif du refus"
          value={motif}
          onChange={(e) => setMotif(e.target.value)}
        />
      </ModalSection>
    </Modal>
  );
}
