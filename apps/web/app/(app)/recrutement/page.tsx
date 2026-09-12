'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { DeleteJobPostingsResult, JobPostingView } from '@teranga/contracts';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  cn,
  EmptyState,
  Skeleton,
  TBody,
  Td,
  Th,
  THead,
  Table,
  Tr,
} from '@teranga/ui';
import { api, ApiError } from '../../../lib/api';
import { formatDate } from '../../../lib/hooks';
import { Icon } from '../../../components/icons';
import { JobModal } from '../../../components/job-modal';
import { LoadFailure } from '../../../components/load-failure';
import { Modal, ModalSection } from '../../../components/modal';
import { CONTRACT_LABELS } from '../../../lib/recruitment';

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

export default function OffresPage() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const [selection, setSelection] = useState<string[]>([]);
  const [panneau, setPanneau] = useState<'modifier' | 'supprimer' | null>(null);
  const [ecartees, setEcartees] = useState<DeleteJobPostingsResult['skipped']>([]);

  const jobs = useQuery({ queryKey: ['jobs'], queryFn: () => api<JobPostingView[]>('/jobs') });
  const offres = useMemo(() => jobs.data ?? [], [jobs.data]);
  // La sélection ne survit pas à la disparition d'une ligne : une offre
  // supprimée ailleurs ne doit pas rester cochée dans un lot invisible.
  const choisies = useMemo(
    () => offres.filter((o) => selection.includes(o.id)),
    [offres, selection],
  );
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
    mutationFn: ({ id, status }: { id: string; status: 'published' | 'closed' }) =>
      api(`/jobs/${id}`, { method: 'PATCH', body: { status } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['jobs'] }),
  });

  if (jobs.isError) {
    return <LoadFailure error={jobs.error} onRetry={() => void jobs.refetch()} />;
  }

  const bascule = (id: string) =>
    setSelection((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const toutBasculer = () =>
    setSelection((s) => (s.length === offres.length ? [] : offres.map((o) => o.id)));

  return (
    <div className="mx-auto w-full max-w-6xl">
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <CardTitle>Offres d&apos;emploi</CardTitle>
            {offres.length > 0 ? (
              <span
                className="rounded-full bg-primary/[0.09] px-2 py-px text-[10.5px] font-extrabold text-primary"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {offres.length}
              </span>
            ) : null}
          </div>
          {/* La barre d'action n'apparaît qu'avec une sélection : au repos,
              des boutons désactivés en permanence ne feraient que du bruit. */}
          {choisies.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11.5px] font-semibold text-ink-muted">
                {choisies.length} sélectionnée{choisies.length > 1 ? 's' : ''}
              </span>
              {seule && seule.status === 'draft' ? (
                <Button
                  size="sm"
                  loading={changerStatut.isPending}
                  onClick={() => changerStatut.mutate({ id: seule.id, status: 'published' })}
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
                  onClick={() => changerStatut.mutate({ id: seule.id, status: 'closed' })}
                >
                  Archiver
                </Button>
              ) : null}
              {seule && seule.status === 'closed' ? (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={changerStatut.isPending}
                  onClick={() => changerStatut.mutate({ id: seule.id, status: 'published' })}
                >
                  Rouvrir
                </Button>
              ) : null}
              <Button size="sm" variant="danger" onClick={() => setPanneau('supprimer')}>
                Supprimer
              </Button>
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {jobs.isLoading ? (
            <Skeleton className="mx-[18px] mb-[18px] h-24" />
          ) : offres.length === 0 ? (
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
          ) : (
            <Table>
              <THead>
                <tr>
                  <Th className="w-9 pr-0">
                    <Checkbox
                      aria-label="Tout sélectionner"
                      checked={selection.length > 0 && choisies.length === offres.length}
                      indeterminate={choisies.length > 0 && choisies.length < offres.length}
                      onChange={toutBasculer}
                    />
                  </Th>
                  <Th>Référence</Th>
                  <Th>Poste</Th>
                  <Th>Type contrat</Th>
                  <Th>Publiée il y a</Th>
                  <Th>Date limite</Th>
                  <Th>Lien</Th>
                </tr>
              </THead>
              <TBody>
                {offres.map((o) => {
                  const coche = selection.includes(o.id);
                  return (
                    <Tr key={o.id} className={cn(coche && 'bg-primary/[0.04]')}>
                      <Td className="pr-0">
                        <Checkbox
                          aria-label={`Sélectionner ${o.title}`}
                          checked={coche}
                          onChange={() => bascule(o.id)}
                        />
                      </Td>
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
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

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
            setSelection([]);
            setEcartees(s);
          }}
          onFini={() => {
            setPanneau(null);
            setSelection([]);
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
    </div>
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
        await navigator.clipboard.writeText(
          `${window.location.origin}/postuler/${offre.publicSlug}`,
        );
        setCopie(true);
        setTimeout(() => setCopie(false), 2000);
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
  onFini: () => void;
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
      else onFini();
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
