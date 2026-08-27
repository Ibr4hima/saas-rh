'use client';

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type { CursorPage, EmployeeBatchResult, EmployeeListItem } from '@teranga/contracts';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  cn,
  EmptyState,
  Input,
  Select,
  Skeleton,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@teranga/ui';
import { api, ApiError } from '../../../lib/api';
import { formatDate } from '../../../lib/hooks';
import { EmployeeCreateModal } from '../../../components/employee-create-modal';
import { Icon } from '../../../components/icons';
import { Modal, ModalSection } from '../../../components/modal';

/** Ce qu'on tape pour confirmer un effacement — court, mais pas cliquable. */
const MOT_DE_CONFIRMATION = 'SUPPRIMER';

export default function EmployeesPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  // L'ouverture passe par l'URL (?nouveau) : le bouton de la barre supérieure
  // est un lien, la fenêtre se partage, et le bouton Retour la referme au lieu
  // de quitter la liste.
  const createOpen = useSearchParams().get('nouveau') !== null;
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState('');
  const [selection, setSelection] = useState<string[]>([]);
  const [panneau, setPanneau] = useState<'supprimer' | null>(null);
  const [ecartes, setEcartes] = useState<EmployeeBatchResult['skipped']>([]);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(id);
  }, [search]);

  const query = useInfiniteQuery({
    queryKey: ['employees', debounced, status],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (debounced) params.set('q', debounced);
      if (status) params.set('status', status);
      if (pageParam) params.set('cursor', pageParam);
      params.set('limit', '25');
      return api<CursorPage<EmployeeListItem>>(`/employees?${params.toString()}`);
    },
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const choisis = useMemo(() => items.filter((e) => selection.includes(e.id)), [items, selection]);
  const actifsChoisis = choisis.filter((e) => e.status === 'active');
  const archivesChoisis = choisis.filter((e) => e.status === 'archived');

  const bascule = (id: string) =>
    setSelection((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const toutBasculer = () =>
    setSelection((s) => (s.length === items.length ? [] : items.map((e) => e.id)));

  const apresLot = async (res: EmployeeBatchResult) => {
    await queryClient.invalidateQueries({ queryKey: ['employees'] });
    await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    setSelection([]);
    if (res.skipped.length > 0) setEcartes(res.skipped);
  };

  const archiver = useMutation({
    mutationFn: (archived: boolean) =>
      api<EmployeeBatchResult>('/employees/archive', {
        method: 'POST',
        body: { ids: (archived ? actifsChoisis : archivesChoisis).map((e) => e.id), archived },
      }),
    onSuccess: apresLot,
  });

  const filtre = Boolean(debounced || status);

  return (
    <div className="mx-auto w-full max-w-6xl">
      <EmployeeCreateModal open={createOpen} onClose={() => router.replace('/employees')} />
      <div className="mb-4 flex gap-3">
        <Input
          placeholder="Rechercher par nom ou matricule…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setSelection([]);
          }}
          className="w-44"
        >
          <option value="">Tous les statuts</option>
          <option value="active">Actifs</option>
          <option value="archived">Archivés</option>
        </Select>
      </div>

      <Card>
        {items.length > 0 ? (
          <CardHeader className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <CardTitle>Personnel</CardTitle>
              <span
                className="rounded-full bg-primary/[0.09] px-2 py-px text-[10.5px] font-extrabold text-primary"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {items.length}
              </span>
            </div>
            {/* La barre d'action n'apparaît qu'avec une sélection : au repos,
                des boutons désactivés en permanence ne feraient que du bruit. */}
            {choisis.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11.5px] font-semibold text-ink-muted">
                  {choisis.length} sélectionné{choisis.length > 1 ? 's' : ''}
                </span>
                {actifsChoisis.length > 0 ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={archiver.isPending}
                    onClick={() => archiver.mutate(true)}
                  >
                    Désactiver le profil
                    {actifsChoisis.length < choisis.length ? ` (${actifsChoisis.length})` : ''}
                  </Button>
                ) : null}
                {archivesChoisis.length > 0 ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={archiver.isPending}
                    onClick={() => archiver.mutate(false)}
                  >
                    Réactiver
                    {archivesChoisis.length < choisis.length ? ` (${archivesChoisis.length})` : ''}
                  </Button>
                ) : null}
                <Button size="sm" variant="danger" onClick={() => setPanneau('supprimer')}>
                  Supprimer
                </Button>
              </div>
            ) : null}
          </CardHeader>
        ) : null}

        <CardContent className="px-0 pb-0">
          {query.isLoading ? (
            <div className="flex flex-col gap-3 p-5">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              icon={<Icon name="group" size={22} />}
              title={filtre ? 'Aucun résultat' : 'Aucun employé pour le moment'}
              description={
                filtre
                  ? 'Essayez une autre recherche ou retirez les filtres.'
                  : 'Créez votre premier employé pour démarrer le dossier du personnel.'
              }
              action={
                !filtre ? (
                  <Link href="/employees/new">
                    <Button size="sm">Nouvel employé</Button>
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <>
              <Table>
                <THead>
                  <tr>
                    <Th className="w-9 pr-0">
                      <Checkbox
                        aria-label="Tout sélectionner"
                        checked={selection.length === items.length}
                        onChange={toutBasculer}
                      />
                    </Th>
                    <Th>Matricule</Th>
                    <Th>Nom</Th>
                    <Th>Poste</Th>
                    <Th>Manager</Th>
                    <Th>Unité</Th>
                    <Th>Début contrat</Th>
                    <Th>Fin contrat</Th>
                  </tr>
                </THead>
                <TBody>
                  {items.map((e) => {
                    const coche = selection.includes(e.id);
                    return (
                      <Tr
                        key={e.id}
                        className={cn('cursor-pointer', coche && 'bg-primary/[0.04]')}
                        onClick={() => router.push(`/employees/${e.id}`)}
                      >
                        {/* La case ne suit pas la ligne : cliquer pour choisir
                            ne doit pas quitter l'écran où l'on choisit. */}
                        <Td className="pr-0" onClick={(ev) => ev.stopPropagation()}>
                          <Checkbox
                            aria-label={`Sélectionner ${e.givenName} ${e.familyName}`}
                            checked={coche}
                            onChange={() => bascule(e.id)}
                          />
                        </Td>
                        <Td className="font-mono text-xs text-ink-muted">{e.employeeNumber}</Td>
                        <Td className="font-medium text-ink-strong">
                          <span className="flex items-center gap-2">
                            {e.givenName} {e.familyName}
                            {/* Actif est la norme et ne se signale pas ; archivé
                                se voit, sinon rien ne distingue les deux. */}
                            {e.status === 'archived' ? (
                              <span className="rounded-full bg-bg px-1.5 py-px text-[10px] font-bold tracking-wide text-ink-muted uppercase">
                                Archivé
                              </span>
                            ) : null}
                          </span>
                          {e.workEmail ? (
                            <span className="block text-xs font-normal text-ink-muted">
                              {e.workEmail}
                            </span>
                          ) : null}
                        </Td>
                        <Td>{e.positionTitle ?? '—'}</Td>
                        <Td>{e.managerName ?? '—'}</Td>
                        {/* L'abrégé tient dans une colonne, pas le nom complet :
                            l'infobulle garde le nom entier pour qui hésite. */}
                        <Td title={e.directionName ?? e.orgUnitName ?? undefined}>
                          {e.directionShortName ?? e.directionName ?? e.orgUnitName ?? '—'}
                        </Td>
                        <Td className="whitespace-nowrap">
                          {e.contractStartDate ? formatDate(e.contractStartDate) : '—'}
                        </Td>
                        <Td className="whitespace-nowrap">
                          {e.contractEndDate ? formatDate(e.contractEndDate) : '—'}
                        </Td>
                      </Tr>
                    );
                  })}
                </TBody>
              </Table>
              {query.hasNextPage ? (
                <div className="border-t border-line-soft p-3 text-center">
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={query.isFetchingNextPage}
                    onClick={() => query.fetchNextPage()}
                  >
                    Charger plus
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      {panneau === 'supprimer' ? (
        <SupprimerModal
          employes={choisis}
          onClose={() => setPanneau(null)}
          onFini={async (res) => {
            setPanneau(null);
            await apresLot(res);
          }}
        />
      ) : null}

      {ecartes.length > 0 ? (
        <Modal
          open
          onClose={() => setEcartes([])}
          title="Dossiers laissés en place"
          maxWidth="max-w-lg"
          footer={<Button onClick={() => setEcartes([])}>J&apos;ai compris</Button>}
        >
          <ModalSection title="Non traités">
            <ul className="flex flex-col gap-1.5">
              {ecartes.map((s) => (
                <li key={s.id} className="flex items-start gap-2 text-[12.5px]">
                  <Icon name="error" size={15} className="mt-0.5 shrink-0 text-warning" />
                  <span>
                    <span className="font-semibold text-ink-strong">{s.name}</span>
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
 * Effacer un dossier, définitivement.
 *
 * Un bouton rouge ne suffit pas : celui-ci ne défait rien et ne s'annule pas.
 * On dit donc ce qui disparaît, on nomme les dossiers visés, on rappelle le
 * geste réversible qui existe à côté, et on demande un mot à taper — le seul
 * geste qu'on ne fait pas par réflexe.
 */
function SupprimerModal({
  employes,
  onClose,
  onFini,
}: {
  employes: EmployeeListItem[];
  onClose: () => void;
  onFini: (res: EmployeeBatchResult) => void | Promise<void>;
}) {
  const [saisie, setSaisie] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const confirme = saisie.trim().toUpperCase() === MOT_DE_CONFIRMATION;

  const supprimer = useMutation({
    mutationFn: () =>
      api<EmployeeBatchResult>('/employees/delete', {
        method: 'POST',
        body: { ids: employes.map((e) => e.id) },
      }),
    onSuccess: onFini,
    onError: (err) => setErreur(err instanceof ApiError ? err.message : 'Suppression impossible.'),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Supprimer ${employes.length} dossier${employes.length > 1 ? 's' : ''} ?`}
      subtitle="Cette action ne peut pas être annulée."
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
            disabled={!confirme}
            loading={supprimer.isPending}
            onClick={() => {
              setErreur(null);
              supprimer.mutate();
            }}
          >
            Supprimer définitivement
          </Button>
        </>
      }
    >
      <ModalSection title="Dossiers concernés">
        <ul className="flex flex-col gap-1.5">
          {employes.map((e) => (
            <li key={e.id} className="flex items-baseline gap-2 text-[12.5px]">
              <span className="font-mono text-[11.5px] text-ink-muted">{e.employeeNumber}</span>
              <span className="font-semibold text-ink-strong">
                {e.givenName} {e.familyName}
              </span>
            </li>
          ))}
        </ul>
      </ModalSection>

      <ModalSection title="Ce qui disparaît">
        <ul className="flex flex-col gap-1.5 text-[12.5px] text-ink">
          {[
            'L’état civil, les contrats et les affectations',
            'Les congés, leurs soldes et leurs justificatifs',
            'Les pièces du dossier et les demandes de documents',
            'L’accès au portail, ses sessions et ses notifications',
          ].map((l) => (
            <li key={l} className="flex items-start gap-2">
              <Icon name="close" size={14} className="mt-0.5 shrink-0 text-danger" />
              <span>{l}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 rounded-[9px] bg-bg px-3 py-2 text-[12px] text-ink-muted">
          Si l’employé a quitté l’organisation mais que vous avez encore le droit de conserver ses
          données, désactivez son profil : le dossier reste, le portail se ferme, et le rendre actif
          rouvre l’accès avec les mêmes identifiants.
        </p>
      </ModalSection>

      <ModalSection title="Confirmation">
        <label
          htmlFor="confirmation"
          className="mb-2 block text-[12.5px] font-medium text-ink-strong"
        >
          Tapez <span className="font-mono font-bold">{MOT_DE_CONFIRMATION}</span> pour confirmer
        </label>
        <Input
          id="confirmation"
          autoComplete="off"
          value={saisie}
          onChange={(e) => setSaisie(e.target.value)}
          placeholder={MOT_DE_CONFIRMATION}
        />
      </ModalSection>
    </Modal>
  );
}
