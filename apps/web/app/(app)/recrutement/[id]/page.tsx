'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import type { ApplicationView, JobPostingView } from '@teranga/contracts';
import { Badge, Button, Card, CardContent, EmptyState, Skeleton } from '@teranga/ui';
import { api, ApiError, apiUrl } from '../../../../lib/api';
import { DocViewer, type ViewableDoc } from '../../../../components/doc-viewer';
import { formatDate } from '../../../../lib/hooks';
import { CONTRACT_LABELS, JOB_STATUS_LABELS, JOB_STATUS_TONES } from '../../../../lib/recruitment';
import { LoadFailure } from '../../../../components/load-failure';
import { Icon } from '../../../../components/icons';
import { Modal } from '../../../../components/modal';
import { usePageTitle } from '../../../../components/page-title';

/**
 * Le poids d'une pièce. Sous le kilo-octet, `Math.round` rendait « 0 Ko » —
 * un fichier de 400 octets n'est pas vide, il est petit.
 */
function poids(octets: number): string {
  if (octets < 1024) return `${octets} o`;
  if (octets < 1024 * 1024) return `${Math.round(octets / 1024)} Ko`;
  return `${(octets / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`;
}

/**
 * Une offre et ses candidatures.
 *
 * La page montrait un TABLEAU DE FLUX à six colonnes — Reçues, Présélection,
 * Entretien, Offre, Embauché·e, Refusées. Sur une offre d'agence publique qui
 * reçoit une dizaine de dossiers et dont les entretiens se tiennent hors de
 * l'outil, cinq de ces colonnes étaient vides en permanence : elles occupaient
 * les deux tiers de l'écran pour n'afficher que « Aucun dossier », et l'offre
 * elle-même — le contrat, le lieu, la date limite, ce qu'on demande au
 * candidat — tenait sur une ligne de gris au-dessus.
 *
 * L'ordre est inversé : l'offre en haut, en toutes lettres ; les dossiers
 * reçus en dessous, tous ensemble.
 */
export default function JobPage() {
  const { id } = useParams<{ id: string }>();
  const [ouvert, setOuvert] = useState<string | null>(null);

  const job = useQuery({
    queryKey: ['job', id],
    queryFn: () => api<JobPostingView>(`/jobs/${id}`),
  });
  const applications = useQuery({
    queryKey: ['job-applications', id],
    queryFn: () => api<ApplicationView[]>(`/jobs/${id}/applications`),
  });

  // Le bandeau dit l'offre, comme il dit le nom sur une fiche employé : la
  // carte ci-dessous n'a donc pas à répéter le titre soixante pixels plus bas.
  usePageTitle(job.data?.title ?? null);

  if (job.isLoading) {
    return (
      <div className="mx-auto w-full max-w-5xl">
        <Skeleton className="mb-4 h-6 w-40" />
        <Skeleton className="mb-6 h-44 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (job.isError || !job.data) {
    return <LoadFailure error={job.error} onRetry={() => void job.refetch()} />;
  }

  const j = job.data;
  const dossiers = applications.data ?? [];
  const candidat = dossiers.find((a) => a.id === ouvert) ?? null;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <Link
        href="/recrutement"
        className="inline-flex w-fit items-center gap-1 text-[12.5px] font-semibold text-ink-muted transition-colors hover:text-primary"
      >
        <Icon name="chevron_left" size={16} />
        Offres d&apos;emploi
      </Link>

      <CarteOffre offre={j} />

      <section>
        <div className="mb-3 flex items-center gap-2 px-0.5">
          <h2 className="text-[10.5px] font-extrabold tracking-[0.14em] text-primary uppercase">
            Candidatures
          </h2>
          {dossiers.length > 0 ? (
            <span
              className="rounded-full bg-primary/[0.09] px-1.5 py-px text-[10px] font-extrabold text-primary"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {dossiers.length}
            </span>
          ) : null}
        </div>

        {applications.isError ? (
          <LoadFailure error={applications.error} onRetry={() => void applications.refetch()} />
        ) : applications.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Skeleton className="h-[104px] w-full" />
            <Skeleton className="h-[104px] w-full" />
          </div>
        ) : dossiers.length === 0 ? (
          <Card>
            <EmptyState
              className="py-10"
              icon={<Icon name="person_add" size={22} />}
              title="Aucune candidature"
              description={
                j.status === 'published'
                  ? "Partagez le lien public de l'offre : les dossiers déposés arriveront ici."
                  : "L'offre n'est pas encore publiée — personne ne peut y postuler."
              }
            />
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {dossiers.map((a) => (
              <CarteCandidat key={a.id} dossier={a} onOuvrir={() => setOuvert(a.id)} />
            ))}
          </div>
        )}
      </section>

      <FenetreCandidat dossier={candidat} jobId={j.id} onClose={() => setOuvert(null)} />
    </div>
  );
}

/** L'offre, en toutes lettres : ce qu'on publie et ce qu'on demande. */
function CarteOffre({ offre: j }: { offre: JobPostingView }) {
  const [copie, setCopie] = useState(false);
  const [deplie, setDeplie] = useState(false);
  const lienPublic =
    typeof window !== 'undefined' ? `${window.location.origin}/postuler/${j.publicSlug}` : '';
  // Au-delà de cette longueur, la description repousserait les candidatures
  // hors de l'écran : on en montre l'amorce, le reste au clic.
  const longue = j.description.length > 420;

  return (
    <Card>
      <CardContent className="flex flex-col gap-5 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={JOB_STATUS_TONES[j.status] ?? 'neutral'}>
              {JOB_STATUS_LABELS[j.status] ?? j.status}
            </Badge>
            <span className="font-mono text-[11.5px] font-semibold text-ink-muted">
              {j.reference}
            </span>
          </div>
          {j.status === 'draft' ? (
            <BoutonPublier jobId={j.id} />
          ) : j.status === 'published' ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                await navigator.clipboard.writeText(lienPublic);
                setCopie(true);
                setTimeout(() => setCopie(false), 2000);
              }}
            >
              <Icon name={copie ? 'check' : 'content_copy'} size={15} />
              {copie ? 'Lien copié' : 'Copier le lien public'}
            </Button>
          ) : null}
        </div>

        {j.description ? (
          <div>
            <p
              className={`text-[13px] leading-relaxed whitespace-pre-wrap text-ink ${
                longue && !deplie ? 'line-clamp-4' : ''
              }`}
            >
              {j.description}
            </p>
            {longue ? (
              <button
                type="button"
                onClick={() => setDeplie(!deplie)}
                className="mt-1.5 text-[12px] font-semibold text-primary hover:underline"
              >
                {deplie ? 'Réduire' : 'Lire la suite'}
              </button>
            ) : null}
          </div>
        ) : null}

        {/* Les faits de l'offre, chacun sous son étiquette. En ligne de prose
            grise, on relisait trois fois pour retrouver la date limite. */}
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line-soft pt-4 sm:grid-cols-4">
          <Fait label="Contrat" valeur={CONTRACT_LABELS[j.contractType] ?? j.contractType} />
          <Fait label="Direction" valeur={j.orgUnitName} />
          <Fait label="Lieu" valeur={j.location} />
          <Fait
            label="Date limite"
            valeur={j.deadline ? formatDate(j.deadline) : null}
            vide="Sans date limite"
          />
        </dl>

        {j.requiredDocuments.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[9.5px] font-extrabold tracking-[0.12em] text-ink-muted uppercase">
              Pièces demandées
            </span>
            {j.requiredDocuments.map((d) => (
              <span
                key={d}
                className="rounded-full bg-bg px-2.5 py-[3px] text-[11px] font-semibold text-ink"
              >
                {d}
              </span>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Fait({
  label,
  valeur,
  vide = '—',
}: {
  label: string;
  valeur: string | null;
  vide?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[9.5px] font-extrabold tracking-[0.12em] text-ink-muted uppercase">
        {label}
      </dt>
      <dd
        className={`mt-1 truncate text-[13px] font-semibold ${valeur ? 'text-ink-strong' : 'text-ink-muted/70'}`}
      >
        {valeur ?? vide}
      </dd>
    </div>
  );
}

/** Un dossier reçu. La carte tient ce qu'on lit avant d'ouvrir : qui, quand, combien de pièces. */
function CarteCandidat({
  dossier: a,
  onOuvrir,
}: {
  dossier: ApplicationView;
  onOuvrir: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOuvrir}
      className="group flex w-full items-start gap-3 rounded-[14px] border border-card-line bg-surface px-4 py-3.5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-card-line-hover hover:shadow-sm focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[12.5px] font-bold text-primary uppercase">
        {a.givenName[0]}
        {a.familyName[0]}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-bold text-ink-strong">
          {a.givenName} {a.familyName}
        </span>
        <span className="block truncate text-[11.5px] text-ink-muted">{a.email}</span>
        <span className="mt-1.5 block text-[11px] font-semibold text-ink-muted">
          {formatDate(a.createdAt.slice(0, 10))} · {a.documents.length} pièce
          {a.documents.length > 1 ? 's' : ''}
        </span>
      </span>
      <Icon
        name="chevron_right"
        size={16}
        className="mt-0.5 shrink-0 text-ink-muted/50 transition-transform duration-200 group-hover:translate-x-0.5"
      />
    </button>
  );
}

function BoutonPublier({ jobId }: { jobId: string }) {
  const queryClient = useQueryClient();
  const publish = useMutation({
    mutationFn: () => api(`/jobs/${jobId}`, { method: 'PATCH', body: { status: 'published' } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['job', jobId] }),
  });
  return (
    <Button onClick={() => publish.mutate()} loading={publish.isPending}>
      Publier l&apos;offre
    </Button>
  );
}

/** Le dossier ouvert : le message du candidat et ses pièces. */
function FenetreCandidat({
  dossier: a,
  jobId,
  onClose,
}: {
  dossier: ApplicationView | null;
  jobId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [erreur, setErreur] = useState<string | null>(null);
  const [confirme, setConfirme] = useState(false);
  const [piece, setPiece] = useState<ViewableDoc | null>(null);

  const supprimer = useMutation({
    mutationFn: () => api(`/applications/${a!.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      fermer();
      void queryClient.invalidateQueries({ queryKey: ['job-applications', jobId] });
      void queryClient.invalidateQueries({ queryKey: ['job', jobId] });
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (err) => setErreur(err instanceof ApiError ? err.message : 'Suppression impossible.'),
  });

  const fermer = () => {
    setErreur(null);
    setConfirme(false);
    onClose();
  };

  return (
    <>
      <Modal
        open={a !== null}
        onClose={fermer}
        title={a ? `${a.givenName} ${a.familyName}` : ''}
        subtitle={
          a
            ? `${a.email}${a.phone ? ` · ${a.phone}` : ''} · candidature du ${formatDate(a.createdAt.slice(0, 10))}`
            : undefined
        }
        maxWidth="max-w-2xl"
        footer={
          a ? (
            // Deux temps plutôt qu'une boîte du navigateur : la phrase dit ce
            // que la suppression emporte, et le geste reste dans la fenêtre.
            <div className="flex w-full flex-wrap items-center justify-between gap-3">
              {confirme ? (
                <>
                  <p className="text-[12px] text-ink-muted">
                    Le dossier et ses pièces seront effacés. {a.email} pourra postuler à nouveau.
                  </p>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setConfirme(false)}>
                      Annuler
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      loading={supprimer.isPending}
                      onClick={() => supprimer.mutate()}
                    >
                      Supprimer définitivement
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setConfirme(true)}
                    className="text-[12px] font-semibold text-ink-muted transition-colors hover:text-danger"
                  >
                    Supprimer la candidature
                  </button>
                  <Button variant="secondary" size="sm" onClick={fermer}>
                    Fermer
                  </Button>
                </>
              )}
            </div>
          ) : null
        }
      >
        {a ? (
          <>
            <Card>
              <CardContent className="py-4">
                <p className="text-[9.5px] font-extrabold tracking-[0.12em] text-ink-muted uppercase">
                  Message
                </p>
                <p className="mt-2 text-[13px] leading-relaxed whitespace-pre-wrap text-ink">
                  {a.message?.trim() ? (
                    a.message
                  ) : (
                    <span className="text-ink-muted/70">Aucun message joint.</span>
                  )}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="py-4">
                <p className="text-[9.5px] font-extrabold tracking-[0.12em] text-ink-muted uppercase">
                  Pièces jointes
                </p>
                {a.documents.length === 0 ? (
                  <p className="mt-2 text-[13px] text-ink-muted/70">Aucune pièce déposée.</p>
                ) : (
                  <ul className="mt-2 flex flex-col divide-y divide-line-soft">
                    {a.documents.map((d) => (
                      <li
                        key={d.id}
                        className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-[12.5px] font-semibold text-ink-strong">
                            {d.label}
                          </span>
                          <span className="block truncate text-[11px] text-ink-muted">
                            {d.filename} · {poids(d.sizeBytes)}
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setPiece({
                              url: apiUrl(`/application-documents/${d.id}`),
                              filename: d.filename,
                              contentType: d.contentType,
                            })
                          }
                          className="shrink-0 rounded-full border border-line px-2.5 py-[3px] text-[11px] font-semibold text-primary transition-colors hover:border-primary/40 hover:bg-primary/[0.07] focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
                        >
                          Prévisualiser
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            {erreur ? (
              <p className="rounded-md bg-danger-soft px-3 py-2 text-[12.5px] text-danger">
                {erreur}
              </p>
            ) : null}
          </>
        ) : null}
      </Modal>

      <DocViewer doc={piece} onClose={() => setPiece(null)} />
    </>
  );
}
