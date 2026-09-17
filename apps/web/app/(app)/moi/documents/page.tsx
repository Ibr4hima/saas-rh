'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import type {
  AbsenceRequestView,
  DocumentRequestView,
  MyEmployeeView,
  RequestableDoc,
} from '@teranga/contracts';
import {
  MAX_OPEN_DOCUMENT_REQUESTS,
  OPEN_DOCUMENT_REQUEST_STATUSES,
  REQUESTABLE_DOC_LABELS,
} from '@teranga/contracts';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  EmptyState,
  Field,
  Input,
  Skeleton,
} from '@teranga/ui';
import { api, ApiError, apiUrl } from '../../../../lib/api';
import { EmployeeDocumentsCard } from '../../../../components/employee-documents-card';
import { DocumentRequestRow } from '../../../../components/document-request-list';
import { type ViewableDoc } from '../../../../components/doc-viewer';
import { FenetreDocument } from '../../../../components/fenetre-document';
import { Icon } from '../../../../components/icons';
import { formatDate } from '../../../../lib/hooks';
import { LoadFailure } from '../../../../components/load-failure';
import { Page } from '../../../../components/gabarit';
import { compte } from '../../../../lib/mots';

/* ————————————————————————————————————————————————————————————————
   « Mes documents » traite deux mouvements contraires, et l'écran doit les
   garder distincts :

   — ce que JE DEMANDE à la Direction du Capital Humain (attestation, contrat,
     bulletin) : je coche, j'envoie, je suis l'avancement ;
   — ce que JE FOURNIS et qui reste à mon dossier (pièce d'identité, diplômes,
     justificatifs d'absence).

   D'où l'ordre des quatre cartes : les deux premières sont la demande et son
   suivi, les deux dernières le dossier. La grammaire est celle du reste du
   portail : intitulés en petites capitales, rangées, états vides dessinés,
   aucun aplat teinté hors des messages.
   ———————————————————————————————————————————————————————————————— */

const REQUESTABLE: RequestableDoc[] = [
  'attestation_travail',
  'contrat_travail',
  'bulletin_salaire',
  'attestation_salaire',
  'certificat_travail',
  'autre',
];

const TABULAIRE = { fontVariantNumeric: 'tabular-nums' } as const;

/** « a, b et c » — la virgule pour la liste, « et » pour le dernier. */
function enumerer(mots: string[]): string {
  if (mots.length <= 1) return mots[0] ?? '';
  return `${mots.slice(0, -1).join(', ')} et ${mots[mots.length - 1]}`;
}

export default function MyDocumentsPage() {
  const queryClient = useQueryClient();
  const [viewedDoc, setViewedDoc] = useState<ViewableDoc | null>(null);
  const [selected, setSelected] = useState<RequestableDoc[]>([]);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const myEmployee = useQuery({
    queryKey: ['me-employee'],
    queryFn: () => api<MyEmployeeView>('/me/employee'),
    retry: false,
  });
  const employeeId = myEmployee.data?.employeeId;

  const absences = useQuery({
    queryKey: ['my-requests', employeeId],
    queryFn: () =>
      api<AbsenceRequestView[]>(`/absence-requests?employeeId=${employeeId}&limit=100`),
    enabled: Boolean(employeeId),
  });

  const docRequests = useQuery({
    // scope=mine : l'espace personnel reste personnel même pour un membre RH.
    queryKey: ['document-requests', 'me'],
    queryFn: () => api<DocumentRequestView[]>('/document-requests?scope=mine'),
  });

  const submit = useMutation({
    mutationFn: () =>
      api('/document-requests', {
        method: 'POST',
        body: { docTypes: selected, note: note.trim() || undefined },
      }),
    onSuccess: () => {
      setSelected([]);
      setNote('');
      setError(null);
      setSent(true);
      void queryClient.invalidateQueries({ queryKey: ['document-requests'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Envoi impossible.'),
  });

  if (myEmployee.isLoading) {
    return (
      <Page>
        <Skeleton className="h-[280px] w-full rounded-[16px]" />
        <Skeleton className="h-36 w-full rounded-[16px]" />
      </Page>
    );
  }
  if (myEmployee.isError || !myEmployee.data) {
    return <LoadFailure error={myEmployee.error} onRetry={() => void myEmployee.refetch()} />;
  }

  const emp = myEmployee.data;
  const withDocument = (absences.data ?? []).filter((r) => r.documentName);
  const demandes = docRequests.data ?? [];
  const aRetirer = demandes.filter((r) => r.status === 'ready').length;
  // Le serveur refuse au-delà de trois demandes ouvertes. Le dire ici évite à
  // l'agent de composer une demande pour se la voir rejeter à l'envoi.
  const enCours = demandes.filter((r) =>
    (OPEN_DOCUMENT_REQUEST_STATUSES as string[]).includes(r.status),
  ).length;
  const fileSaturee = enCours >= MAX_OPEN_DOCUMENT_REQUESTS;
  const toggle = (doc: RequestableDoc) => {
    setSent(false);
    setSelected(selected.includes(doc) ? selected.filter((d) => d !== doc) : [...selected, doc]);
  };

  return (
    <Page>
      <div className="shrink-0">
        <Link
          href="/moi"
          className="inline-flex items-center gap-1 text-[12.5px] text-ink-muted transition-colors hover:text-ink"
        >
          <Icon name="chevron_left" size={15} />
          Mon espace
        </Link>
      </div>

      {/* Deux colonnes, parce que la page en avait la place et ne s'en
          servait pas : une seule pile de cartes dans huit cent quatre-vingts
          pixels laissait un tiers de l'écran vide à droite et allongeait la
          page de six cents pixels à défiler. */}
      <div className="grid items-start gap-4 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* La colonne principale */}
        <div className="flex min-w-0 flex-col gap-4">
          {/* ———— Demander ———— */}
          <Card>
            <CardHeader>
              <CardTitle>Demander un document</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <p className="max-w-[72ch] text-[12.5px] leading-relaxed text-ink-muted">
                La Direction du Capital Humain prépare vos documents, les signe et les cachette. Ils
                se retirent en main propre : vous êtes prévenu·e dès qu&apos;ils sont prêts.
              </p>

              <div className="flex flex-wrap gap-2">
                {REQUESTABLE.map((doc) => (
                  <ChoixDocument
                    key={doc}
                    libelle={REQUESTABLE_DOC_LABELS[doc]}
                    choisi={selected.includes(doc)}
                    onToggle={() => toggle(doc)}
                  />
                ))}
              </div>

              <Field
                label="Précision"
                htmlFor="doc-note"
                hint="Facultatif — la période, ou l'usage prévu. Ex. : bulletin de juillet 2026, pour un dossier bancaire."
              >
                <Input id="doc-note" value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>

              {/* ———— Ce qui part, en toutes lettres ————
                Deux pastilles cochées se lisent d'un coup d'œil ; à quatre,
                relire la ligne est plus sûr que recompter les bordures bleues.
                Et quand rien n'est coché, le bouton grisé s'explique au lieu
                de se subir. */}
              <div className="-mx-5 border-t border-line-soft px-5 pt-4 pb-1">
                {fileSaturee ? (
                  <p className="text-[12.5px] leading-snug text-accent-text">
                    Vous portez déjà {compte(enCours, 'demande')} en cours. La Direction du Capital
                    Humain doit les traiter avant que vous puissiez en formuler une nouvelle.
                  </p>
                ) : selected.length === 0 ? (
                  <p className="text-[12px] text-ink-muted">
                    Choisissez au moins un document ci-dessus.
                  </p>
                ) : (
                  <p className="text-[12.5px] leading-snug text-ink">
                    <span className="font-semibold text-ink-strong">
                      Vous demandez {compte(selected.length, 'document')}
                    </span>{' '}
                    {/* Les libellés gardent leur majuscule : « et autre document »
                      en bas de casse se lit comme une phrase inachevée, alors
                      que « et Autre document » se lit comme l'entrée cochée. */}
                    — {enumerer(selected.map((d) => REQUESTABLE_DOC_LABELS[d]))}.
                  </p>
                )}
              </div>

              {error ? (
                <p className="flex items-start gap-2 rounded-[12px] bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger ring-1 ring-current/15 ring-inset">
                  <Icon name="error" size={15} className="mt-px shrink-0" />
                  {error}
                </p>
              ) : null}
              {sent ? (
                <p className="flex items-start gap-2 rounded-[12px] bg-success-soft px-3.5 py-2.5 text-[12.5px] text-success ring-1 ring-current/15 ring-inset">
                  <Icon name="check_circle" size={15} className="mt-px shrink-0" />
                  Demande envoyée — la Direction du Capital Humain a été prévenue. Son avancement se
                  suit juste en dessous.
                </p>
              ) : null}

              <Button
                disabled={selected.length === 0 || fileSaturee}
                loading={submit.isPending}
                onClick={() => submit.mutate()}
              >
                Envoyer ma demande
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* La colonne d'à côté */}
        <div className="flex min-w-0 flex-col gap-4">
          {/* ———— Suivre ———— */}
          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
              <CardTitle>Suivi de mes demandes</CardTitle>
              <div className="flex shrink-0 items-center gap-2.5">
                {/* La seule ligne de cette carte qui appelle un geste : aller
                  chercher le document. Elle se dit dans le titre. */}
                {aRetirer > 0 ? (
                  <span className="rounded-full bg-primary/[0.09] px-2 py-px text-[10.5px] font-bold text-primary">
                    {aRetirer} à retirer
                  </span>
                ) : null}
                {demandes.length > 0 ? (
                  <span className="text-[11.5px] text-ink-muted" style={TABULAIRE}>
                    {compte(demandes.length, 'demande')}
                  </span>
                ) : null}
              </div>
            </CardHeader>
            <CardContent>
              {docRequests.isLoading ? (
                <div className="flex flex-col gap-3 py-1">
                  {[0, 1].map((i) => (
                    <Skeleton key={i} className="h-3 w-56" />
                  ))}
                </div>
              ) : demandes.length === 0 ? (
                <EmptyState
                  className="py-7"
                  icon={<Icon name="folder_managed" size={22} />}
                  title="Aucune demande pour le moment"
                  description="Cochez ce dont vous avez besoin ci-dessus : l’avancement s’affichera ici, jusqu’au lieu de retrait."
                />
              ) : (
                <ul className="flex flex-col">
                  {demandes.map((r) => (
                    <DocumentRequestRow key={r.id} request={r} showEmployee={false} />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* ———— Mon dossier ———— */}
          <EmployeeDocumentsCard employeeId={emp.employeeId} />

          <Card>
            <CardHeader className="flex items-center justify-between gap-3">
              <CardTitle>Mes justificatifs d&apos;absence</CardTitle>
              {withDocument.length > 0 ? (
                <span className="shrink-0 text-[11.5px] text-ink-muted" style={TABULAIRE}>
                  {compte(withDocument.length, 'pièce')}
                </span>
              ) : null}
            </CardHeader>
            <CardContent className="px-2 pb-2">
              {absences.isLoading ? (
                <div className="flex flex-col gap-3 px-3 py-1">
                  {[0, 1].map((i) => (
                    <Skeleton key={i} className="h-3 w-56" />
                  ))}
                </div>
              ) : withDocument.length === 0 ? (
                <p className="flex items-start gap-2.5 px-3 py-2.5 text-[12px] leading-snug text-ink-muted">
                  <Icon name="upload_file" size={17} className="mt-px shrink-0 text-ink-muted/60" />
                  Aucun justificatif joint — ils se rangent ici dès que vous joignez un PDF à une
                  demande d’absence (maladie, mission…).
                </p>
              ) : (
                <ul className="flex flex-col">
                  {withDocument.map((r) => (
                    <li
                      key={r.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[11px] px-3 py-3 transition-colors duration-150 hover:bg-hover"
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-primary/[0.07] text-primary">
                        <Icon name="description" size={17} />
                      </span>
                      <div className="min-w-0 flex-1 basis-48">
                        <p className="truncate text-[12.5px] font-semibold text-ink-strong">
                          {r.documentName}
                        </p>
                        <p
                          className="mt-0.5 truncate text-[11.5px] text-ink-muted"
                          style={TABULAIRE}
                        >
                          {r.absenceTypeName} · {formatDate(r.startDate)} → {formatDate(r.endDate)}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="ml-auto shrink-0"
                        onClick={() =>
                          setViewedDoc({
                            url: apiUrl(`/absence-requests/${r.id}/document`),
                            filename: r.documentName!,
                            contentType: 'application/pdf',
                            titre: 'Justificatif',
                          })
                        }
                      >
                        Aperçu
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <FenetreDocument doc={viewedDoc} onClose={() => setViewedDoc(null)} />
    </Page>
  );
}

/**
 * Une pastille de choix.
 *
 * L'ancienne collait un « ✓ » devant le libellé : la pastille s'allongeait au
 * clic et toute la ligne se réorganisait. La coche vit maintenant dans un
 * rond de taille fixe, présent coché comme décoché — rien ne bouge, et l'état
 * ne tient pas qu'à la couleur du bord. `aria-pressed` le dit aux lecteurs
 * d'écran, à qui la bordure bleue n'apprend rien.
 */
function ChoixDocument({
  libelle,
  choisi,
  onToggle,
}: {
  libelle: string;
  choisi: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={choisi}
      onClick={onToggle}
      className={cn(
        'inline-flex items-center gap-2 rounded-full border py-[7px] pr-3.5 pl-2.5 text-[12.5px] transition-colors duration-150',
        choisi
          ? 'border-primary bg-primary-soft font-semibold text-primary'
          : 'border-line text-ink hover:border-ink-muted/40 hover:bg-hover',
      )}
    >
      <span
        aria-hidden
        className={cn(
          // Un carré arrondi, PAS un rond : le rond promet un choix
          // exclusif, alors qu'on coche ici autant de documents qu'on veut.
          'flex size-[15px] shrink-0 items-center justify-center rounded-[5px] border transition-colors duration-150',
          choisi ? 'border-primary bg-primary text-primary-ink' : 'border-line bg-surface',
        )}
      >
        {choisi ? <Icon name="check" size={11} /> : null}
      </span>
      {libelle}
    </button>
  );
}
