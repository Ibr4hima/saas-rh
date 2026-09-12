'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ApplicationView, JobPostingView } from '@teranga/contracts';
import { nomAbrege } from '@teranga/contracts';
import { Button, Card, CardContent, cn, EmptyState, Skeleton } from '@teranga/ui';
import { api, apiUrl } from '../../../../lib/api';
import { ApercuDocument, type ViewableDoc } from '../../../../components/doc-viewer';
import { formatDate } from '../../../../lib/hooks';
import { phoneLisible } from '../../../../lib/countries';
import { CONTRACT_LABELS, libelleDocument } from '../../../../lib/recruitment';
import {
  anciennete,
  DescriptionOffre,
  FaitOffre,
  jourFr,
} from '../../../../components/offre-fiche';
import { LoadFailure } from '../../../../components/load-failure';
import { Icon, type IconName } from '../../../../components/icons';
import { Modal } from '../../../../components/modal';
import { usePageTitle } from '../../../../components/page-title';

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

      <FenetreCandidat dossier={candidat} onClose={() => setOuvert(null)} />
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
          {/* La direction et le lieu tiennent sous le titre, là où on les
              cherche — et disparaissent quand ils ne sont pas renseignés,
              plutôt que d'afficher deux tirets dans la grille des faits. */}
          {j.orgUnitName || j.location ? (
            <p className="mt-1 text-[12.5px] text-ink-muted">
              {[j.orgUnitName, j.location].filter(Boolean).join(' · ')}
            </p>
          ) : null}
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
              jourFr(j.deadline)
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

/** Un moyen de joindre le candidat, en un clic. */
function Joindre({
  href,
  icon,
  children,
}: {
  href: string;
  icon: IconName;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-bg px-2 py-[3px] text-[11.5px] font-semibold text-ink transition-colors hover:bg-primary/[0.08] hover:text-primary focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
    >
      <Icon name={icon} size={13} className="shrink-0 text-ink-muted" />
      <span className="truncate">{children}</span>
    </a>
  );
}

/**
 * Le dossier ouvert EST la pièce qu'on vient lire.
 *
 * On ouvre une candidature pour lire un CV — pas pour arriver sur une liste
 * de fichiers et cliquer une deuxième fois. La fenêtre affiche donc
 * directement la première pièce, et les autres s'atteignent par les onglets
 * de son en-tête. Le message du candidat, quand il en a écrit un, est un
 * onglet comme les autres : il ne mérite pas de repousser le CV plus bas,
 * mais il ne mérite pas non plus de disparaître.
 */
function FenetreCandidat({
  dossier: a,
  onClose,
}: {
  dossier: ApplicationView | null;
  onClose: () => void;
}) {
  const [onglet, setOnglet] = useState(0);

  // Le dossier change : on repart de sa première pièce.
  useEffect(() => setOnglet(0), [a?.id]);

  if (!a) return null;

  const vues = a.documents.map((d) => ({
    cle: d.id,
    titre: d.label,
    doc: {
      url: apiUrl(`/application-documents/${d.id}`),
      filename: d.filename,
      contentType: d.contentType,
      titre: libelleDocument(d.label),
    } satisfies ViewableDoc,
  }));
  // L'onglet retenu peut dépasser après une suppression de pièce : on le
  // ramène dans les bornes ici plutôt que de laisser une vue vide.
  const index = Math.min(onglet, Math.max(0, vues.length - 1));
  const courante = vues[index] ?? null;

  return (
    <Modal
      open
      onClose={onClose}
      avatar={
        <span className="flex size-11 items-center justify-center rounded-full bg-primary-soft text-[14px] font-bold text-primary uppercase">
          {a.givenName[0]}
          {a.familyName[0]}
        </span>
      }
      title={`${a.givenName} ${a.familyName}`}
      subtitle={
        // Le courriel et le téléphone deviennent CLIQUABLES : c'est par là
        // qu'on rappelle un candidat, et les recopier à la main était le
        // geste le plus probable de cette fenêtre.
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <Joindre href={`mailto:${a.email}`} icon="mail">
            {a.email}
          </Joindre>
          {a.phone ? (
            // Le lien porte le numéro INTERNATIONAL : composer « 764443322 »
            // depuis un poste hors du Sénégal ne mène nulle part.
            <Joindre href={`tel:${phoneLisible(a.phone).replace(/\s/g, '')}`} icon="call">
              {phoneLisible(a.phone)}
            </Joindre>
          ) : null}
          <span className="inline-flex items-center gap-1.5 px-1 text-[11.5px] text-ink-muted">
            <Icon name="event" size={13} className="shrink-0 text-ink-muted/70" />
            Candidature du {formatDate(a.createdAt.slice(0, 10))}
          </span>
        </span>
      }
      maxWidth="max-w-4xl"
      enTete={
        vues.length > 1 ? (
          <div className="flex items-center gap-0.5 rounded-full bg-bg p-0.5">
            {vues.map((v, i) => (
              <button
                key={v.cle}
                type="button"
                onClick={() => setOnglet(i)}
                aria-pressed={i === index}
                className={cn(
                  'rounded-full px-3 py-1 text-[11.5px] font-bold whitespace-nowrap transition-colors',
                  i === index
                    ? 'bg-surface text-primary shadow-sm'
                    : 'text-ink-muted hover:text-ink',
                )}
              >
                {v.titre}
              </button>
            ))}
          </div>
        ) : null
      }
      footer={
        // Les deux décisions du tri. Elles n'agissent pas encore : le champ
        // `stage` existe en base, la route aussi, mais le geste et ce qu'il
        // déclenche — un courriel ? une trace ? — restent à décider.
        <div className="flex w-full items-center justify-end gap-2">
          <Button variant="secondary" size="sm">
            Rejeter
          </Button>
          <Button size="sm">Présélectionner</Button>
        </div>
      }
    >
      {courante === null ? (
        <Card>
          <CardContent className="py-10 text-center text-[13px] text-ink-muted">
            Ce dossier ne contient aucune pièce.
          </CardContent>
        </Card>
      ) : (
        // Hauteur fixée plutôt que `h-full` : la fenêtre se dimensionne sur son
        // contenu, et un enfant qui demande « toute la hauteur » d'un parent
        // sans hauteur propre se réduit à zéro.
        <div className="h-[min(68vh,660px)] overflow-hidden rounded-[12px] border border-card-line">
          {/* La clé force un lecteur NEUF par pièce : sans elle, passer du CV à
              la lettre réutiliserait l'état de défilement et de zoom du
              précédent, et la première page s'afficherait au mauvais endroit. */}
          <ApercuDocument key={courante.cle} doc={courante.doc} />
        </div>
      )}
    </Modal>
  );
}
