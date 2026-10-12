'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import type {
  DeleteApplicationsResult,
  ReconsiderApplicationsResult,
  RejectedApplicationsPage,
  RejectedApplicationView,
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
import { api, ApiError } from '../../../../lib/api';
import { formatDate } from '../../../../lib/hooks';
import { FenetreCandidat } from '../../../../components/fenetre-candidat';
import { Icon } from '../../../../components/icons';
import { LoadFailure } from '../../../../components/load-failure';
import { Modal, ModalSection } from '../../../../components/modal';
import { CartePleine, CorpsDefilant, Page } from '../../../../components/gabarit';
import { LIGNES_PAR_PAGE, Pagination } from '../../../../components/pagination';
import {
  BarreSelection,
  LIGNE_COCHEE,
  SqueletteTableau,
  TdCase,
  ThCases,
  useSelection,
} from '../../../../components/tableau';

/**
 * Ce qu'un geste fait relire : cette page et l'entrée du menu, les offres
 * (leurs comptes) et les dossiers de chacune.
 */
const A_RELIRE = [['candidatures-non-retenues'], ['jobs'], ['job-applications']];

/**
 * Les candidatures non retenues, toutes offres confondues, la plus récente
 * d'abord. Le dossier reste consultable, CV et lettre compris. Cochées, elles
 * se reconsidèrent (elles retrouvent les dossiers de leur offre, à l'étape où
 * elles étaient) ou se suppriment définitivement.
 */
export default function CandidaturesNonRetenuesPage() {
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [recherche, setRecherche] = useState('');
  const [page, setPage] = useState(1);
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [suppression, setSuppression] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  // La recherche part au serveur (ADR-0068) : un quart de seconde après la
  // dernière touche, et elle repart de la première page.
  useEffect(() => {
    const id = setTimeout(() => setRecherche(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);
  useEffect(() => setPage(1), [recherche]);

  // Une page à la fois : le serveur déchiffre les noms pour chercher et ne
  // renvoie que les quinze dossiers affichés.
  const nonRetenues = useQuery({
    queryKey: ['candidatures-non-retenues', 'liste', recherche, page],
    queryFn: () => {
      const params = new URLSearchParams({
        limit: String(LIGNES_PAR_PAGE),
        offset: String((page - 1) * LIGNES_PAR_PAGE),
      });
      if (recherche) params.set('q', recherche);
      return api<RejectedApplicationsPage>(`/applications/rejected?${params.toString()}`);
    },
    // La page affichée reste à l'écran pendant que la suivante arrive.
    placeholderData: keepPreviousData,
  });

  const tranche = useMemo(() => nonRetenues.data?.items ?? [], [nonRetenues.data]);
  const pages = Math.max(1, Math.ceil((nonRetenues.data?.total ?? 0) / LIGNES_PAR_PAGE));
  // Une page qui n'existe plus (la dernière vidée par un geste) : on retombe
  // sur la dernière page réelle.
  useEffect(() => {
    if (page > pages) setPage(pages);
  }, [page, pages]);
  const barre = { page: Math.min(page, pages), pages, onPage: setPage, remonter: true };
  // Comme pour les offres : la sélection porte sur la page affichée.
  const sel = useSelection(tranche);
  const dossier = tranche.find((a) => a.id === ouvert) ?? null;

  const relire = () =>
    Promise.all(A_RELIRE.map((queryKey) => queryClient.invalidateQueries({ queryKey })));

  const reconsiderer = useMutation({
    mutationFn: (ids: string[]) =>
      api<ReconsiderApplicationsResult>('/applications/reconsider', {
        method: 'POST',
        body: { ids },
      }),
    onSuccess: async () => {
      setErreur(null);
      sel.vider();
      await relire();
    },
    onError: (err) =>
      setErreur(err instanceof ApiError ? err.message : 'Reconsidération impossible.'),
  });

  if (nonRetenues.isError) {
    return <LoadFailure error={nonRetenues.error} onRetry={() => void nonRetenues.refetch()} />;
  }

  return (
    <Page>
      <CartePleine>
        <CardHeader className="flex shrink-0 flex-wrap items-center justify-between gap-3">
          <CardTitle>Candidatures non retenues</CardTitle>
          {/* Des lignes cochées, la barre de sélection prend la place de la
              recherche, qui revient telle quelle ensuite : les deux sur la
              ligne du titre débordaient à 1280 px, et le tableau descendait. */}
          {sel.choisis.length > 0 ? (
            // La hauteur du champ : cocher ne fait pas bouger le tableau.
            <div className="flex min-h-8 items-center">
              <BarreSelection sel={sel} quoi="candidature" feminin>
                {erreur ? (
                  <span role="alert" className="text-[11.5px] font-semibold text-danger">
                    {erreur}
                  </span>
                ) : null}
                <Button
                  size="sm"
                  variant="secondary"
                  loading={reconsiderer.isPending}
                  onClick={() => reconsiderer.mutate(sel.choisis.map((a) => a.id))}
                >
                  Reconsidérer
                </Button>
                <Button size="sm" variant="danger" onClick={() => setSuppression(true)}>
                  Supprimer
                </Button>
              </BarreSelection>
            </div>
          ) : (
            <Input
              placeholder="Rechercher un candidat…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                sel.vider();
              }}
              className="h-8 w-56"
              aria-label="Rechercher une candidature"
            />
          )}
        </CardHeader>
        {nonRetenues.isLoading ? (
          <CorpsDefilant>
            <SqueletteTableau />
          </CorpsDefilant>
        ) : tranche.length === 0 ? (
          <CorpsDefilant className="grid place-items-center">
            <EmptyState
              icon={<Icon name="inbox" size={22} />}
              title={
                recherche ? 'Aucune candidature ne correspond' : 'Aucune candidature non retenue'
              }
              description={
                recherche ? 'Changez de recherche pour voir les autres candidatures.' : undefined
              }
            />
          </CorpsDefilant>
        ) : (
          <Table pleine>
            <THead>
              <tr>
                <ThCases sel={sel} />
                <Th>Nom</Th>
                <Th>Offre postulée</Th>
                <Th>Référence</Th>
                <Th>Publiée le</Th>
                <Th className="text-right">Dossier</Th>
              </tr>
            </THead>
            <TBody>
              {tranche.map((a) => (
                <Tr key={a.id} className={cn(sel.coche(a.id) && LIGNE_COCHEE)}>
                  <TdCase sel={sel} id={a.id} quoi={`${a.givenName} ${a.familyName}`} />
                  <Td className="font-semibold whitespace-nowrap text-ink-strong">
                    {a.givenName} {a.familyName}
                  </Td>
                  <Td>{a.jobTitle}</Td>
                  <Td className="font-mono text-[11.5px] whitespace-nowrap text-ink-muted">
                    {a.jobReference}
                  </Td>
                  <Td className="whitespace-nowrap text-ink-muted">
                    {formatDate(a.jobCreatedAt.slice(0, 10))}
                  </Td>
                  <Td className="text-right">
                    <Button variant="secondary" size="sm" onClick={() => setOuvert(a.id)}>
                      Consulter
                    </Button>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </CartePleine>
      <Pagination
        {...barre}
        onPage={(p) => {
          sel.vider();
          barre.onPage(p);
        }}
      />
      <FenetreCandidat dossier={dossier} onClose={() => setOuvert(null)} />
      {suppression ? (
        <SupprimerModal
          candidatures={sel.choisis}
          onClose={() => setSuppression(false)}
          onFini={async () => {
            setSuppression(false);
            setErreur(null);
            sel.vider();
            await relire();
          }}
        />
      ) : null}
    </Page>
  );
}

/** Confirmation de la suppression définitive : nommer ce qui part avant de le faire partir. */
function SupprimerModal({
  candidatures,
  onClose,
  onFini,
}: {
  candidatures: RejectedApplicationView[];
  onClose: () => void;
  onFini: () => Promise<void>;
}) {
  const [erreur, setErreur] = useState<string | null>(null);
  const supprimer = useMutation({
    mutationFn: () =>
      api<DeleteApplicationsResult>('/applications/delete', {
        method: 'POST',
        body: { ids: candidatures.map((a) => a.id) },
      }),
    onSuccess: onFini,
    onError: (err) => setErreur(err instanceof ApiError ? err.message : 'Suppression impossible.'),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={'Supprimer définitivement\u00a0?'}
      titreEntier
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
      <ModalSection title="Candidatures concernées">
        <ul className="flex flex-col gap-1.5">
          {candidatures.map((a) => (
            <li key={a.id} className="text-[12.5px]">
              <span className="font-bold text-ink-strong">
                {a.givenName} {a.familyName}
              </span>
              <span className="text-ink-muted">
                {' · '}
                <span className="font-mono text-[11.5px] whitespace-nowrap">{a.jobReference}</span>
              </span>
            </li>
          ))}
        </ul>
      </ModalSection>
    </Modal>
  );
}
