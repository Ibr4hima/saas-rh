'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import type { ApplicationView, JobPostingView } from '@teranga/contracts';
import { nomAbrege } from '@teranga/contracts';
import { Badge, Button, Card, CardContent, cn, EmptyState, Skeleton } from '@teranga/ui';
import { api, ApiError, apiUrl } from '../../../../lib/api';
import { DocViewer, type ViewableDoc } from '../../../../components/doc-viewer';
import { formatDate } from '../../../../lib/hooks';
import { CONTRACT_LABELS, JOB_STATUS_LABELS, JOB_STATUS_TONES } from '../../../../lib/recruitment';
import {
  anciennete,
  DescriptionOffre,
  FaitOffre,
  joursRestants,
  jourFr,
} from '../../../../components/offre-fiche';
import { LoadFailure } from '../../../../components/load-failure';
import { Icon, type IconName } from '../../../../components/icons';
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

  // Le bandeau nomme l'ÉCRAN, pas l'offre : le titre de l'offre est le titre
  // de la carte, soixante pixels plus bas, et l'écrire deux fois de suite ne
  // dit pas deux fois plus.
  usePageTitle('Dossiers de candidature');

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
        href="/recrutement/candidatures"
        className="inline-flex w-fit items-center gap-1 text-[12.5px] font-semibold text-ink-muted transition-colors hover:text-primary"
      >
        <Icon name="chevron_left" size={16} />
        Dossiers de candidature
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
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-[100px] w-full" />
            <Skeleton className="h-[100px] w-full" />
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
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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

/**
 * L'offre, montrée à la RH comme elle l'est au candidat.
 *
 * Mêmes faits, même ordre, même rendu de la description que sur la page
 * publique : ce que la RH relit ici est exactement ce que le candidat a lu
 * avant de postuler, et non une seconde mise en forme qui en diverge.
 */
function CarteOffre({ offre: j }: { offre: JobPostingView }) {
  const [copie, setCopie] = useState(false);
  const [deplie, setDeplie] = useState(false);
  const lienPublic =
    typeof window !== 'undefined' ? `${window.location.origin}/postuler/${j.publicSlug}` : '';
  // Au-delà de cette longueur, la description repousserait les candidatures
  // hors de l'écran : on en montre l'amorce, le reste au clic.
  const longue = j.description.length > 520;
  const restants = j.deadline ? joursRestants(j.deadline) : null;
  const urgence = restants !== null && restants >= 0 && restants <= 7;

  return (
    <Card>
      <CardContent className="flex flex-col gap-5 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <Badge tone={JOB_STATUS_TONES[j.status] ?? 'neutral'}>
              {JOB_STATUS_LABELS[j.status] ?? j.status}
            </Badge>
            <h1 className="mt-2.5 text-[22px] leading-tight font-extrabold text-balance text-ink-strong">
              {j.title}
            </h1>
            {/* La direction et le lieu tiennent sous le titre, là où on les
                cherche — et disparaissent quand ils ne sont pas renseignés,
                plutôt que d'afficher deux tirets dans la grille des faits. */}
            {j.orgUnitName || j.location ? (
              <p className="mt-1 text-[12.5px] text-ink-muted">
                {[j.orgUnitName, j.location].filter(Boolean).join(' · ')}
              </p>
            ) : null}
          </div>
          <div className="shrink-0">
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
        </div>

        <div className="grid grid-cols-1 gap-4 border-t border-line-soft pt-5 sm:grid-cols-2 lg:grid-cols-4">
          <FaitOffre icon="description" label="Référence">
            <span className="font-mono">{j.reference}</span>
          </FaitOffre>
          <FaitOffre icon="badge" label="Type de contrat">
            {CONTRACT_LABELS[j.contractType] ?? j.contractType}
          </FaitOffre>
          <FaitOffre icon="schedule" label="Publiée il y a">
            {anciennete(j.createdAt)}
          </FaitOffre>
          <FaitOffre icon="event" label="Date limite">
            {j.deadline ? (
              <>
                {jourFr(j.deadline)}
                {restants !== null && restants >= 0 ? (
                  <span
                    className={cn(
                      'ml-1.5 text-[12px] font-bold',
                      urgence ? 'text-accent-text' : 'text-ink-muted',
                    )}
                  >
                    {restants === 0
                      ? '· dernier jour'
                      : `· plus que ${restants} jour${restants > 1 ? 's' : ''}`}
                  </span>
                ) : (
                  <span className="ml-1.5 text-[12px] font-bold text-ink-muted">· dépassée</span>
                )}
              </>
            ) : (
              <span className="font-normal text-ink-muted">Sans date limite</span>
            )}
          </FaitOffre>
        </div>

        {j.description ? (
          <div className="border-t border-line-soft pt-5">
            <p className="mb-3 text-[10px] font-extrabold tracking-[0.12em] text-primary uppercase">
              Description du poste
            </p>
            {/* Repli par la HAUTEUR, pas par le nombre de lignes : la
                description est une liste de puces, et `line-clamp` ne sait pas
                couper une liste — il couperait la première puce. */}
            <div className={cn('relative', longue && !deplie && 'max-h-[164px] overflow-hidden')}>
              <DescriptionOffre texte={j.description} />
              {longue && !deplie ? (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-surface to-transparent"
                />
              ) : null}
            </div>
            {longue ? (
              <button
                type="button"
                onClick={() => setDeplie(!deplie)}
                className="mt-2.5 text-[12.5px] font-semibold text-primary hover:underline"
              >
                {deplie ? 'Réduire' : 'Lire la suite'}
              </button>
            ) : null}
          </div>
        ) : null}

        {j.requiredDocuments.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-line-soft pt-4">
            <span className="text-[10px] font-extrabold tracking-[0.12em] text-ink-muted uppercase">
              Pièces demandées
            </span>
            {j.requiredDocuments.map((d) => (
              <span
                key={d}
                className="rounded-full bg-bg px-2.5 py-[3px] text-[11.5px] font-semibold text-ink"
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

/**
 * Un dossier reçu, en une carte compacte : le nom, puis les trois lignes par
 * lesquelles on rappelle quelqu'un — courriel, téléphone, date de dépôt.
 */
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
      className="group flex w-full items-start gap-3 rounded-[14px] border border-card-line bg-surface px-3.5 py-3 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-card-line-hover hover:shadow-sm focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[11.5px] font-bold text-primary uppercase">
        {a.givenName[0]}
        {a.familyName[0]}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-bold text-ink-strong">
          {nomAbrege(a.givenName, a.familyName)}
        </span>
        <span className="mt-1 flex flex-col gap-[3px]">
          <Ligne icon="mail">{a.email}</Ligne>
          {a.phone ? <Ligne icon="call">{a.phone}</Ligne> : null}
          <Ligne icon="event">{formatDate(a.createdAt.slice(0, 10))}</Ligne>
        </span>
      </span>
      <Icon
        name="chevron_right"
        size={15}
        className="mt-1 shrink-0 text-ink-muted/50 transition-transform duration-200 group-hover:translate-x-0.5"
      />
    </button>
  );
}

function Ligne({ icon, children }: { icon: IconName; children: React.ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-ink-muted">
      <Icon name={icon} size={13} className="shrink-0 text-ink-muted/70" />
      <span className="truncate">{children}</span>
    </span>
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
