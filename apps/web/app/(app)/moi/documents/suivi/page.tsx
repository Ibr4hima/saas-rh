'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type { DocumentRequestView, ProfileChangeRequestView } from '@teranga/contracts';
import {
  DOC_REQUEST_STATUS_TONES,
  documentDemande,
  OPEN_DOCUMENT_REQUEST_STATUSES,
  PROFILE_CHANGE_STATUS_LABELS,
  PROFILE_CHANGE_STATUS_TONES,
  statutDeLaDemande,
} from '@teranga/contracts';
import {
  Badge,
  Button,
  CardHeader,
  CardTitle,
  cn,
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
import { useMesSignalements } from '../../../../../components/signalement';
import { SqueletteTableau } from '../../../../../components/tableau';
import { valeurSignalee } from '../../../../../components/telephone';
import { EnTetePliable, Pastille } from '../../../../../components/traitement-dch';

/** « Attestation de travail », « Bulletin de salaire · 3 derniers mois ». */
const documentsDe = (r: DocumentRequestView) =>
  r.docTypes.map((d) => documentDemande(d, r.bulletin)).join(' · ');

/** Prête, la demande dit où trouver le document : en ligne, ou auprès de qui. */
const aUnEtat = (r: DocumentRequestView) =>
  r.status === 'ready' && (r.fichiers.length > 0 || Boolean(r.pickupContact));

/** Une demande suivie : des documents, ou une mise à jour d'informations (ADR-0081). */
type Demande =
  | { genre: 'document'; id: string; createdAt: string; d: DocumentRequestView }
  | { genre: 'informations'; id: string; createdAt: string; d: ProfileChangeRequestView };

const enAttente = (x: Demande) =>
  x.genre === 'document'
    ? OPEN_DOCUMENT_REQUEST_STATUSES.includes(x.d.status)
    : x.d.status === 'pending';

/** « Avant → après » : un côté vide se dit, comme sur la fiche. */
const lisible = (champ: string, valeur: string | null | undefined) =>
  valeurSignalee(champ, valeur) ?? 'non renseigné';

/**
 * Suivi de mes demandes : où en est chacune, jusqu'à sa remise.
 *
 * Les demandes de documents, et les mises à jour d'informations signalées
 * depuis la fiche (ADR-0081). En cours, une mise à jour s'annule ; refusée,
 * elle dit son motif, pour corriger. Validée, elle n'y figure pas : la fiche
 * porte le changement (ADR-0082). Annulée non plus.
 *
 * Deux cartes, comme la file de la DCH : les demandes en cours, qui
 * s'annulent encore, puis les demandes traitées (prêtes, remises, refusées),
 * pliées par défaut. Une demande traitée dit, dans la colonne « État
 * traitement », où trouver le document. Une demande annulée, ou remplacée
 * par la même demande faite depuis, n'y figure plus : elle est effacée.
 *
 * Arrivé par l'avis d'une demande traitée (`?traitee=<id>`), « Demandes
 * traitées » s'ouvre sur les seules demandes nouvellement traitées, en
 * évidence : celle de l'avis, et celles dont l'avis attend encore d'être
 * lu. Les autres suivent, sur demande. Vues, leurs avis passent pour lus
 * (ADR-0048).
 */
export default function SuiviDemandesDocumentsPage() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const cible = useSearchParams().get('traitee');
  const [erreur, setErreur] = useState<string | null>(null);
  const [consultee, setConsultee] = useState<string | null>(null);
  const [traiteesOuvertes, setTraiteesOuvertes] = useState(false);
  /**
   * L'arrivée par l'avis : la demande qu'il désigne, et l'heure. On n'en
   * juge que sur une liste relue depuis : celle du cache peut dater d'avant
   * le traitement.
   */
  const [arrivee, setArrivee] = useState<{ cible: string; depuis: number } | null>(null);
  /** Les demandes nouvellement traitées, retenues pour toute la visite. */
  const [enEvidence, setEnEvidence] = useState<string[]>([]);
  const [suite, setSuite] = useState(false);
  const docRequests = useQuery({
    // scope=mine : l'espace personnel reste personnel même pour un membre RH.
    queryKey: ['document-requests', 'me'],
    queryFn: () => api<DocumentRequestView[]>('/document-requests?scope=mine'),
  });
  const signalements = useMesSignalements();
  // Vues, elles restent en évidence à l'écran, mais leurs avis passent pour
  // lus : la cloche ne les compte plus.
  const vues = useMutation({
    mutationFn: (ids: string[]) =>
      api('/document-requests/vues', { method: 'POST', body: { ids } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const marquerVues = vues.mutate;

  useEffect(() => {
    if (!cible) return;
    setArrivee({ cible, depuis: Date.now() });
    void queryClient.invalidateQueries({ queryKey: ['document-requests', 'me'] });
    void queryClient.invalidateQueries({ queryKey: ['profile-changes', 'me'] });
    // L'adresse redevient celle du suivi : la recharger ne rejoue pas l'arrivée.
    router.replace('/moi/documents/suivi', { scroll: false });
  }, [cible, queryClient, router]);
  // Tant que le document n'est pas prêt, ou la mise à jour décidée, la
  // demande s'annule d'un clic.
  const annuler = useMutation({
    mutationFn: (x: Demande) =>
      api(
        x.genre === 'document'
          ? `/document-requests/${x.id}/cancel`
          : `/profile-changes/${x.id}/cancel`,
        { method: 'POST' },
      ),
    onSuccess: (_, x) => {
      setErreur(null);
      void queryClient.invalidateQueries({
        queryKey: [x.genre === 'document' ? 'document-requests' : 'profile-changes'],
      });
    },
    onError: (err) => setErreur(err instanceof ApiError ? err.message : 'Annulation impossible.'),
  });
  // Dans chaque carte, la plus récente en tête : on revient ici pour ce qui
  // vient d'arriver.
  const { enCours, traitees } = useMemo(() => {
    const demandes: Demande[] = [
      ...(docRequests.data ?? []).map((d) => ({
        genre: 'document' as const,
        id: d.id,
        createdAt: d.createdAt,
        d,
      })),
      // D'une mise à jour, le suivi ne garde que l'attente et le refus.
      ...(signalements.data ?? [])
        .filter((d) => d.status === 'pending' || d.status === 'rejected')
        .map((d) => ({ genre: 'informations' as const, id: d.id, createdAt: d.createdAt, d })),
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return {
      enCours: demandes.filter(enAttente),
      traitees: demandes.filter((x) => !enAttente(x)),
    };
  }, [docRequests.data, signalements.data]);
  // Les deux listes relues depuis l'arrivée, ou en échec depuis : on n'attend
  // plus l'une pour l'autre.
  const enLecture = docRequests.isFetching || signalements.isFetching;
  const luesA = Math.min(
    Math.max(docRequests.dataUpdatedAt, docRequests.errorUpdatedAt),
    Math.max(signalements.dataUpdatedAt, signalements.errorUpdatedAt),
  );
  // Les listes relues : les nouvellement traitées sont celle de l'avis, et
  // les demandes de documents dont l'avis attend encore d'être lu. Celui
  // d'une mise à jour l'est au clic.
  useEffect(() => {
    if (!arrivee || enLecture || luesA < arrivee.depuis) return;
    const neuves = traitees.filter(
      (x) => x.id === arrivee.cible || (x.genre === 'document' && x.d.nouvelle),
    );
    setArrivee(null);
    setEnEvidence(neuves.map((x) => x.id));
    setSuite(false);
    setTraiteesOuvertes(true);
    const documents = neuves.filter((x) => x.genre === 'document').map((x) => x.id);
    if (documents.length > 0) marquerVues(documents);
  }, [arrivee, enLecture, luesA, traitees, marquerVues]);

  // La carte vient sous les yeux si elle n'y est pas déjà.
  useEffect(() => {
    if (enEvidence.length === 0) return;
    const carte = document.getElementById('demandes-traitees');
    const r = carte?.getBoundingClientRect();
    if (!carte || !r || (r.top >= 0 && r.top < window.innerHeight - 160)) return;
    const doux = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    carte.scrollIntoView({ behavior: doux ? 'smooth' : 'auto', block: 'start' });
  }, [enEvidence]);

  // En évidence, les nouvellement traitées seules, en tête ; les autres
  // derrière, une fois la suite demandée.
  const { lignesTraitees, reste } = useMemo(() => {
    const neuves = traitees.filter((r) => enEvidence.includes(r.id));
    if (neuves.length === 0) return { lignesTraitees: traitees, reste: 0 };
    const autres = traitees.filter((r) => !enEvidence.includes(r.id));
    return suite
      ? { lignesTraitees: [...neuves, ...autres], reste: 0 }
      : { lignesTraitees: neuves, reste: autres.length };
  }, [traitees, enEvidence, suite]);
  const fileVue = usePagination(enCours);
  const historique = usePagination(lignesTraitees, `${enEvidence.join()}:${suite}`);
  const consultable = traitees.find((x) => x.id === consultee);
  const aConsulter = consultable?.genre === 'document' ? consultable.d : null;

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
        {docRequests.isLoading || signalements.isLoading ? (
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
            {fileVue.tranche.map((x) => (
              <Ligne
                key={x.id}
                demande={x}
                geste={
                  x.d.canCancel ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => annuler.mutate(x)}
                      loading={annuler.isPending && annuler.variables?.id === x.id}
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

      <CartePleine id="demandes-traitees" className="scroll-mt-4">
        <EnTetePliable
          titre="Demandes traitées"
          n={traitees.length}
          ouvert={traiteesOuvertes}
          onBasculer={() => setTraiteesOuvertes((o) => !o)}
        />
        {!traiteesOuvertes ? null : docRequests.isLoading || signalements.isLoading ? (
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
            {historique.tranche.map((x) => (
              <Ligne
                key={x.id}
                demande={x}
                nouvelle={enEvidence.includes(x.id)}
                etat={
                  x.genre === 'document' && aUnEtat(x.d) ? (
                    <EtatTraitement demande={x.d} onConsulter={() => setConsultee(x.id)} />
                  ) : null
                }
              />
            ))}
          </TableauDesDemandes>
        )}
        {traiteesOuvertes && reste > 0 ? (
          <div className="flex justify-center border-t border-line-soft px-5 py-3">
            <Button size="sm" variant="secondary" onClick={() => setSuite(true)}>
              Afficher la suite
              <Icon name="chevron_right" size={16} className="-mr-1 rotate-90" />
            </Button>
          </div>
        ) : null}
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
          <Th className="sm:w-[35%]">Demande</Th>
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
 * et l'état du traitement se rangent sous la demande : quatre colonnes n'y
 * tiennent pas.
 *
 * Une mise à jour d'informations dit ce qui change, avant et après ;
 * refusée, son motif suit, comme celui d'une demande de documents.
 *
 * Nouvellement traitée, la ligne se teinte du bleu de la marque, un filet
 * la borde à gauche et « Nouveau » suit le document : à l'arrivée, elle
 * s'éclaire un instant, puis se pose (ADR-0048).
 */
function Ligne({
  demande: x,
  geste,
  etat,
  nouvelle,
}: {
  demande: Demande;
  /** En cours : « Annuler ». */
  geste?: React.ReactNode;
  /** Traitée : où trouver le document. */
  etat?: React.ReactNode;
  /** Nouvellement traitée : en évidence. */
  nouvelle?: boolean;
}) {
  const titre = x.genre === 'document' ? documentsDe(x.d) : 'Mise à jour d’infos';
  const demandee = formatDate(x.createdAt.slice(0, 10));
  const statut =
    x.genre === 'document' ? (
      <Badge tone={DOC_REQUEST_STATUS_TONES[x.d.status]}>{statutDeLaDemande(x.d)}</Badge>
    ) : (
      <Badge tone={PROFILE_CHANGE_STATUS_TONES[x.d.status]}>
        {PROFILE_CHANGE_STATUS_LABELS[x.d.status]}
      </Badge>
    );
  const r = x.d;
  return (
    <Tr className={cn(nouvelle && 'tg-nouvelle bg-primary-soft/60 hover:bg-primary-soft')}>
      <Td
        className={cn(
          nouvelle &&
            'relative before:absolute before:inset-y-2.5 before:left-0 before:w-[3px] before:rounded-r-full before:bg-primary',
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <p className="min-w-0 truncate font-semibold text-ink-strong" title={titre}>
            {titre}
          </p>
          {nouvelle ? (
            <span className="shrink-0 rounded-full bg-primary px-[7px] text-[9.5px] leading-[17px] font-extrabold tracking-[0.06em] text-primary-ink uppercase">
              Nouveau
            </span>
          ) : null}
        </div>
        {x.genre === 'informations'
          ? x.d.fields.map((f) => (
              <p key={f.field} className="mt-0.5 text-[11.5px] text-ink-muted">
                {f.label} : {lisible(f.field, f.previous)} <span aria-hidden>→</span>{' '}
                <span className="font-semibold text-ink">{lisible(f.field, f.next)}</span>
              </p>
            ))
          : null}
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
      <Td className="hidden tabular-nums sm:table-cell" title={timeAgo(x.createdAt)}>
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
