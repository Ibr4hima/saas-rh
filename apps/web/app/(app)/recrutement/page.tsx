'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { DeleteJobPostingsResult, JobPostingView, JobStatus } from '@teranga/contracts';
import {
  Button,
  CardHeader,
  CardTitle,
  cn,
  EmptyState,
  TBody,
  Td,
  Th,
  THead,
  Table,
  Tr,
} from '@teranga/ui';
import { api, ApiError, detailErreur } from '../../../lib/api';
import { formatDate } from '../../../lib/hooks';
import { Icon } from '../../../components/icons';
import { JobModal } from '../../../components/job-modal';
import { LoadFailure } from '../../../components/load-failure';
import { Modal, ModalSection } from '../../../components/modal';
import { CartePleine, CorpsDefilant, Page, PiedCarte } from '../../../components/gabarit';
import { CONTRACT_LABELS, JOB_STATUS_LABELS } from '../../../lib/recruitment';
import { accorde, compte } from '../../../lib/mots';
import {
  BarreSelection,
  BoutonExport,
  exporterCSV,
  LIGNE_COCHEE,
  SqueletteTableau,
  TdCase,
  ThCases,
  ThTri,
  useSelection,
  useTriLocal,
} from '../../../components/tableau';
import { useToast } from '../../../components/toasts';

/** « il y a 3 jours » — l'âge d'une offre dit s'il faut la relancer. */
function depuis(iso: string): string {
  const jours = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (jours <= 0) return "aujourd'hui";
  if (jours === 1) return 'hier';
  if (jours < 31) return `${jours} jours`;
  const mois = Math.floor(jours / 30);
  if (mois < 12) return `${mois} mois`;
  const ans = Math.floor(mois / 12);
  return `${ans} an${ans > 1 ? 's' : ''}`;
}

/** Ce que dit le toast pour chaque statut — au participe, pas à l'infinitif. */
const ANNONCE: Record<JobStatus, string> = {
  draft: 'remise en brouillon',
  published: 'publiée',
  closed: 'archivée',
};

export default function OffresPage() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const [panneau, setPanneau] = useState<'modifier' | 'supprimer' | null>(null);
  const [ecartees, setEcartees] = useState<DeleteJobPostingsResult['skipped']>([]);

  const jobs = useQuery({ queryKey: ['jobs'], queryFn: () => api<JobPostingView[]>('/jobs') });
  const brutes = useMemo(() => jobs.data ?? [], [jobs.data]);

  /** L'ordre de la liste : la référence par défaut, le reste au clic. */
  const tri = useTriLocal(
    brutes,
    {
      reference: (o) => o.reference,
      title: (o) => o.title,
      contractType: (o) => CONTRACT_LABELS[o.contractType] ?? o.contractType,
      // On trie sur la DATE, pas sur « il y a trois jours » : un texte se
      // classerait par ordre alphabétique, et « il y a 2 mois » précéderait
      // « il y a 3 jours ».
      createdAt: (o) => o.createdAt,
      deadline: (o) => o.deadline,
    },
    { colonne: 'createdAt', sens: 'desc' },
    { createdAt: 'desc', deadline: 'asc', reference: 'asc', title: 'asc', contractType: 'asc' },
  );
  const offres = tri.lignes;
  const toast = useToast();
  const sel = useSelection(offres);
  const choisies = sel.choisis;
  const seule = choisies.length === 1 ? choisies[0] : undefined;

  // Le « + » du bandeau ouvre la fenêtre : une URL plutôt qu'un état local,
  // pour que le bouton de la barre supérieure puisse y mener sans la connaître.
  const creation = params.get('nouvelle') === '1';
  const fermerCreation = () => router.replace('/recrutement');

  /**
   * Publier, archiver, rouvrir : le même geste, un statut différent.
   *
   * « Archiver » ferme la campagne — l'offre n'accepte plus de candidature et
   * son lien public ne mène plus nulle part. Elle n'est pas supprimée pour
   * autant : les dossiers déjà reçus restent consultables, et une campagne
   * close se rouvre.
   */
  const changerStatut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: JobStatus; avant?: JobStatus }) =>
      api(`/jobs/${id}`, { method: 'PATCH', body: { status } }),
    onSuccess: async (_res, { id, status, avant }) => {
      await queryClient.invalidateQueries({ queryKey: ['jobs'] });
      // Le statut se DÉFAIT : c'est le même appel dans l'autre sens. On ne
      // le propose donc pas seulement par politesse — publier une campagne
      // envoie son lien au monde, et se reprendre doit tenir en un clic.
      if (!avant) return toast.succes(`Offre ${ANNONCE[status]}`);
      toast.succes(`Offre ${ANNONCE[status]}`, {
        action: {
          libelle: 'Annuler',
          onAction: () => changerStatut.mutate({ id, status: avant }),
        },
      });
    },
    onError: (err) =>
      toast.erreur('Le statut n’a pas pu être changé', { detail: detailErreur(err) }),
  });

  if (jobs.isError) {
    return <LoadFailure error={jobs.error} onRetry={() => void jobs.refetch()} />;
  }

  return (
    <Page>
      <CartePleine>
        <CardHeader className="flex shrink-0 flex-wrap items-center justify-between gap-3">
          <CardTitle>Offres d&apos;emploi</CardTitle>
          <BarreSelection sel={sel} quoi="offre" feminin>
            {seule && seule.status === 'draft' ? (
              <Button
                size="sm"
                loading={changerStatut.isPending}
                onClick={() =>
                  changerStatut.mutate({ id: seule.id, status: 'published', avant: seule.status })
                }
              >
                Publier
              </Button>
            ) : null}
            {seule ? (
              <Button size="sm" variant="secondary" onClick={() => setPanneau('modifier')}>
                <Icon name="edit" size={15} />
                Modifier
              </Button>
            ) : null}
            {seule && seule.status === 'published' ? (
              <Button
                size="sm"
                variant="secondary"
                loading={changerStatut.isPending}
                onClick={() =>
                  changerStatut.mutate({ id: seule.id, status: 'closed', avant: seule.status })
                }
              >
                Archiver
              </Button>
            ) : null}
            {seule && seule.status === 'closed' ? (
              <Button
                size="sm"
                variant="secondary"
                loading={changerStatut.isPending}
                onClick={() =>
                  changerStatut.mutate({ id: seule.id, status: 'published', avant: seule.status })
                }
              >
                Rouvrir
              </Button>
            ) : null}
            <Button size="sm" variant="danger" onClick={() => setPanneau('supprimer')}>
              Supprimer
            </Button>
          </BarreSelection>
        </CardHeader>
        {jobs.isLoading ? (
          <CorpsDefilant>
            <SqueletteTableau />
          </CorpsDefilant>
        ) : offres.length === 0 ? (
          <CorpsDefilant className="grid place-items-center">
            <EmptyState
              icon={<Icon name="person_add" size={22} />}
              title="Aucune offre pour le moment"
              description="Créez votre première offre : vous obtiendrez un lien public de candidature à partager."
              action={
                <Link href="/recrutement?nouvelle=1">
                  <Button size="sm">Nouvelle offre</Button>
                </Link>
              }
            />
          </CorpsDefilant>
        ) : (
          <Table pleine>
            <THead>
              <tr>
                <ThCases sel={sel} />
                <ThTri
                  label="Référence"
                  colonne="reference"
                  courant={tri.colonne}
                  sens={tri.sens}
                  onTrier={tri.trier}
                />
                <ThTri
                  label="Poste"
                  colonne="title"
                  courant={tri.colonne}
                  sens={tri.sens}
                  onTrier={tri.trier}
                />
                <ThTri
                  label="Type contrat"
                  colonne="contractType"
                  courant={tri.colonne}
                  sens={tri.sens}
                  onTrier={tri.trier}
                />
                <ThTri
                  label="Publiée il y a"
                  colonne="createdAt"
                  courant={tri.colonne}
                  sens={tri.sens}
                  onTrier={tri.trier}
                />
                <ThTri
                  label="Date limite"
                  colonne="deadline"
                  courant={tri.colonne}
                  sens={tri.sens}
                  onTrier={tri.trier}
                />
                <Th>Lien</Th>
              </tr>
            </THead>
            <TBody>
              {offres.map((o) => (
                <Tr key={o.id} className={cn(sel.coche(o.id) && LIGNE_COCHEE)}>
                  <TdCase sel={sel} id={o.id} quoi={o.title} />
                  <Td className="font-mono text-[11.5px] whitespace-nowrap text-ink-muted">
                    {o.reference}
                  </Td>
                  <Td>
                    <Link
                      href={`/recrutement/${o.id}`}
                      className="font-bold text-ink-strong hover:underline"
                    >
                      {o.title}
                    </Link>
                  </Td>
                  <Td className="whitespace-nowrap">
                    {CONTRACT_LABELS[o.contractType] ?? o.contractType}
                  </Td>
                  <Td className="whitespace-nowrap text-ink-muted">{depuis(o.createdAt)}</Td>
                  <Td
                    className={cn(
                      'whitespace-nowrap',
                      o.deadline && o.deadline < new Date().toISOString().slice(0, 10)
                        ? 'font-semibold text-danger'
                        : 'text-ink-muted',
                    )}
                  >
                    {o.deadline ? formatDate(o.deadline) : '—'}
                  </Td>
                  <Td>
                    <LienPublic offre={o} />
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
        {offres.length > 0 ? (
          <PiedCarte
            droite={
              <BoutonExport
                quoi="les offres"
                onClick={() =>
                  exporterCSV(
                    'offres-emploi',
                    [
                      'Référence',
                      'Poste',
                      'Type de contrat',
                      'Publiée le',
                      'Date limite',
                      'Statut',
                    ],
                    offres.map((o) => [
                      o.reference,
                      o.title,
                      CONTRACT_LABELS[o.contractType] ?? o.contractType,
                      o.createdAt.slice(0, 10),
                      o.deadline,
                      JOB_STATUS_LABELS[o.status] ?? o.status,
                    ]),
                  )
                }
              />
            }
          >
            {compte(offres.length, 'offre')}
          </PiedCarte>
        ) : null}
      </CartePleine>

      {creation ? <JobModal open onClose={fermerCreation} /> : null}
      {panneau === 'modifier' && seule ? (
        <JobModal open offre={seule} onClose={() => setPanneau(null)} />
      ) : null}
      {panneau === 'supprimer' ? (
        <SupprimerModal
          offres={choisies}
          onClose={() => setPanneau(null)}
          onEcartees={(s) => {
            setPanneau(null);
            sel.vider();
            setEcartees(s);
          }}
          onFini={(n) => {
            setPanneau(null);
            sel.vider();
            if (n > 0) toast.succes(`${compte(n, 'offre')} ${accorde(n, 'supprimé', true)}`);
          }}
        />
      ) : null}
      {ecartees.length > 0 ? (
        <Modal
          open
          onClose={() => setEcartees([])}
          title="Offres conservées"
          maxWidth="max-w-lg"
          footer={<Button onClick={() => setEcartees([])}>J&apos;ai compris</Button>}
        >
          <ModalSection title="Non supprimées">
            <ul className="flex flex-col gap-1.5">
              {ecartees.map((s) => (
                <li key={s.id} className="flex items-start gap-2 text-[12.5px]">
                  <Icon name="error" size={15} className="mt-0.5 shrink-0 text-warning" />
                  <span>
                    <span className="font-semibold text-ink-strong">{s.title || 'Offre'}</span>
                    <span className="text-ink-muted"> — {s.reason}</span>
                  </span>
                </li>
              ))}
            </ul>
          </ModalSection>
        </Modal>
      ) : null}
    </Page>
  );
}

/**
 * Le lien public, en un geste.
 *
 * Une offre non publiée n'en a pas : le slug existe, mais le partager mènerait
 * à une page qui refuse — mieux vaut le dire que de livrer un lien mort.
 */
function LienPublic({ offre }: { offre: JobPostingView }) {
  const [copie, setCopie] = useState(false);
  const toast = useToast();
  if (offre.status === 'closed') {
    return <span className="text-[11.5px] font-semibold text-ink-muted">Archivée</span>;
  }
  if (offre.status !== 'published') {
    return <span className="text-[11.5px] text-ink-muted">Non publiée</span>;
  }
  return (
    <Button
      size="sm"
      variant={copie ? 'ghost' : 'secondary'}
      onClick={async () => {
        const lien = `${window.location.origin}/postuler/${offre.publicSlug}`;
        // Le presse-papiers n'est pas toujours accessible — un réseau
        // d'administration servi en clair le refuse. Le bouton ne doit pas
        // rester muet : on montre le lien à recopier à la main.
        try {
          await navigator.clipboard.writeText(lien);
          setCopie(true);
          setTimeout(() => setCopie(false), 2000);
        } catch {
          toast.erreur('Copie impossible depuis ce navigateur', { detail: lien });
        }
      }}
    >
      <Icon name={copie ? 'check' : 'content_copy'} size={15} />
      {copie ? 'Copié' : 'Copier'}
    </Button>
  );
}

/** Confirmation de suppression — nommer ce qui part avant de le faire partir. */
function SupprimerModal({
  offres,
  onClose,
  onEcartees,
  onFini,
}: {
  offres: JobPostingView[];
  onClose: () => void;
  onEcartees: (s: DeleteJobPostingsResult['skipped']) => void;
  onFini: (supprimees: number) => void;
}) {
  const queryClient = useQueryClient();
  const [erreur, setErreur] = useState<string | null>(null);

  const supprimer = useMutation({
    mutationFn: () =>
      api<DeleteJobPostingsResult>('/jobs/delete', {
        method: 'POST',
        body: { ids: offres.map((o) => o.id) },
      }),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: ['jobs'] });
      if (res.skipped.length > 0) onEcartees(res.skipped);
      else onFini(res.deleted);
    },
    onError: (err) => setErreur(err instanceof ApiError ? err.message : 'Suppression impossible.'),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Supprimer ${offres.length} offre${offres.length > 1 ? 's' : ''} ?`}
      maxWidth="max-w-lg"
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
            loading={supprimer.isPending}
            onClick={() => {
              setErreur(null);
              supprimer.mutate();
            }}
          >
            Supprimer
          </Button>
        </>
      }
    >
      <ModalSection title="Offres concernées">
        <ul className="flex flex-col gap-1.5">
          {offres.map((o) => (
            <li key={o.id} className="text-[12.5px]">
              <span className="font-mono text-[11.5px] text-ink-muted">{o.reference}</span>{' '}
              <span className="font-bold text-ink-strong">{o.title}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11.5px] leading-relaxed text-ink-muted">
          Une offre qui a déjà reçu des candidatures ne sera pas supprimée : les dossiers déposés
          appartiennent aux candidats. Fermez-la plutôt.
        </p>
      </ModalSection>
    </Modal>
  );
}
