'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import type { ApplicationView, JobPostingView } from '@teranga/contracts';
import {
  LANGUE_LABELS,
  NIVEAU_ETUDES_LABELS,
  nomAbrege,
  peut,
  premierPrenom,
} from '@teranga/contracts';
import { Badge, Button, Card, CardContent, cn, EmptyState, Skeleton } from '@teranga/ui';
import { api, ApiError } from '../../../../lib/api';
import { formatDate, useMe } from '../../../../lib/hooks';
import { Telephone } from '../../../../components/telephone';
import { experienceExigee, libelleContrat } from '../../../../lib/recruitment';
import { DescriptionOffre, FaitOffre, jourFr } from '../../../../components/offre-fiche';
import { LoadFailure } from '../../../../components/load-failure';
import { Icon, type IconName } from '../../../../components/icons';
import { FenetreCandidat } from '../../../../components/fenetre-candidat';
import { Modal } from '../../../../components/modal';
import { usePageTitle } from '../../../../components/page-title';
import { Page } from '../../../../components/gabarit';
import { anciennete, useHorlogeMinute } from '../../../../lib/temps';

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
  const [aRejeter, setARejeter] = useState<ApplicationView | null>(null);
  // Les dossiers se confient à part : qui rédige les offres voit le texte seul.
  const lit = peut(useMe().data, 'recrutement.candidatures');

  const job = useQuery({
    queryKey: ['job', id],
    queryFn: () => api<JobPostingView>(`/jobs/${id}`),
  });
  const applications = useQuery({
    queryKey: ['job-applications', id],
    queryFn: () => api<ApplicationView[]>(`/jobs/${id}/applications`),
    enabled: lit,
  });

  // Le bandeau nomme l'ÉCRAN, pas l'offre : le titre de l'offre est le titre
  // de la carte, soixante pixels plus bas, et l'écrire deux fois de suite ne
  // dit pas deux fois plus.
  usePageTitle(lit ? 'Dossiers de candidature' : 'Offre de recrutement');

  if (job.isLoading) {
    return (
      <Page>
        <Skeleton className="mb-4 h-6 w-40" />
        <Skeleton className="mb-6 h-44 w-full" />
        <Skeleton className="h-32 w-full" />
      </Page>
    );
  }
  if (job.isError || !job.data) {
    return <LoadFailure error={job.error} onRetry={() => void job.refetch()} />;
  }

  const j = job.data;
  const dossiers = applications.data ?? [];
  const candidat = dossiers.find((a) => a.id === ouvert) ?? null;

  return (
    <Page>
      <Link
        href={lit ? '/recrutement/candidatures' : '/recrutement'}
        className="inline-flex w-fit items-center gap-1 text-[12.5px] font-semibold text-ink-muted transition-colors hover:text-primary"
      >
        <Icon name="chevron_left" size={16} />
        {lit ? 'Dossiers de candidature' : 'Offres d’emploi'}
      </Link>

      <CarteOffre offre={j} />

      {!lit ? (
        <p className="flex items-center gap-2 px-0.5 text-[12.5px] text-ink-muted">
          <Icon name="lock" size={15} />
          Les dossiers de candidature sont confiés à un autre membre de la DCH.
        </p>
      ) : (
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
                    : "L'offre n'est pas encore publiée : personne ne peut y postuler."
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
      )}

      <FenetreCandidat
        dossier={candidat}
        onClose={() => setOuvert(null)}
        onRejeter={() => setARejeter(candidat)}
      />
      {/* Par-dessus le dossier, et après lui dans la page : elle le recouvre. */}
      {aRejeter ? (
        <ConfirmerRejet jobId={id} dossier={aRejeter} onClose={() => setARejeter(null)} />
      ) : null}
    </Page>
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
  // L'âge affiché avance tout seul : une fiche reste ouverte longtemps.
  useHorlogeMinute();
  const [deplie, setDeplie] = useState(false);
  // Au-delà de cette longueur, la description repousserait les candidatures
  // hors de l'écran : on en montre l'amorce, le reste au clic.
  const longue = j.description.length > 520;

  return (
    <Card>
      <CardContent className="flex flex-col gap-5 py-5">
        <div className="min-w-0">
          <h1 className="text-[22px] leading-tight font-extrabold text-balance text-ink-strong">
            {j.title}
          </h1>
          {/* La référence sous le titre, comme sur la page publique. */}
          <p className="mt-1.5 text-[11.5px] font-semibold text-ink-muted">
            <span className="tracking-[0.12em] uppercase">Réf</span> ·{' '}
            <span className="font-mono">{j.reference}</span>
          </p>
          {/* La direction et le lieu tiennent sous le titre, là où on les
              cherche — et disparaissent quand ils ne sont pas renseignés,
              plutôt que d'afficher deux tirets dans la grille des faits. */}
          {j.orgUnitName || j.location ? (
            <p className="mt-1 text-[12.5px] text-ink-muted">
              {[j.orgUnitName, j.location].filter(Boolean).join(' · ')}
            </p>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-4 border-t border-line-soft pt-5 sm:grid-cols-3">
          <FaitOffre icon="badge" label="Type de contrat">
            {libelleContrat(j.contractType, j.dureeMois)}
          </FaitOffre>
          <FaitOffre icon="schedule" label={j.publishedAt ? 'Publiée il y a' : 'Créée il y a'}>
            {anciennete(j.publishedAt ?? j.createdAt)}
          </FaitOffre>
          <FaitOffre icon="event" label="Date limite">
            {j.deadline ? (
              jourFr(j.deadline)
            ) : (
              <span className="font-normal text-ink-muted">Sans date limite</span>
            )}
          </FaitOffre>
        </div>

        {/* Le profil recherché, sous un trait fin, avec ses icônes comme les
            faits du dessus. Une offre antérieure peut ne pas le porter :
            « Non renseigné » le signale à la RH, qui le complète en modifiant
            l'offre. */}
        <div className="grid grid-cols-1 gap-4 border-t border-line-soft pt-5 sm:grid-cols-3">
          <FaitOffre icon="school" label="Niveau d’études">
            {j.niveauEtudes ? NIVEAU_ETUDES_LABELS[j.niveauEtudes] : <NonRenseigne />}
          </FaitOffre>
          <FaitOffre icon="trending_up" label="Expérience">
            {j.experienceMin === null ? <NonRenseigne /> : experienceExigee(j.experienceMin)}
          </FaitOffre>
          <FaitOffre icon="translate" label="Langues">
            {j.langues.length > 0 ? (
              j.langues.map((l) => LANGUE_LABELS[l]).join(', ')
            ) : (
              <NonRenseigne />
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
              <Badge key={d} tone="gris">
                {d}
              </Badge>
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
          {a.phone ? (
            <Ligne icon="call">
              <Telephone valeur={a.phone} lien={false} />
            </Ligne>
          ) : null}
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

/**
 * Rejeter, c'est répondre au candidat : un courriel de refus part avec le
 * geste, et la candidature ne se rouvre plus. La fenêtre le dit avant.
 */
function ConfirmerRejet({
  jobId,
  dossier: a,
  onClose,
}: {
  jobId: string;
  dossier: ApplicationView;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [erreur, setErreur] = useState<string | null>(null);
  const rejeter = useMutation({
    mutationFn: () =>
      api(`/applications/${a.id}`, { method: 'PATCH', body: { stage: 'rejected' } }),
    onSuccess: async () => {
      // Le dossier quitte l'offre pour « Candidatures non retenues » : la liste,
      // les comptes et l'entrée du menu se relisent.
      await Promise.all(
        [['job-applications', jobId], ['jobs'], ['candidatures-non-retenues']].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      );
      onClose();
    },
    onError: (err) => setErreur(err instanceof ApiError ? err.message : 'Rejet impossible.'),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Rejeter la candidature ?"
      maxWidth="max-w-md"
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
            loading={rejeter.isPending}
            onClick={() => {
              setErreur(null);
              rejeter.mutate();
            }}
          >
            Rejeter
          </Button>
        </>
      }
    >
      <Card>
        <CardContent className="py-4 text-[13.5px] leading-relaxed text-ink">
          Un courriel de refus sera envoyé à{' '}
          <span className="font-semibold text-ink-strong">{premierPrenom(a.givenName)}</span> à
          l’adresse <span className="font-semibold text-ink-strong">{a.email}</span>. Confirmez-vous
          votre décision ?
        </CardContent>
      </Card>
    </Modal>
  );
}

function NonRenseigne() {
  return <span className="font-normal text-ink-muted">Non renseigné</span>;
}
