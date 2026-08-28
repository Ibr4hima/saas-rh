'use client';

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type {
  EmployeeBatchResult,
  EmployeeListItem,
  EmployeeListPage,
  EmployeeSort,
  EmployeeStatus,
} from '@teranga/contracts';
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
import { Onglets, OngletsBandeau } from '../../../components/onglets-bandeau';

/** Ce qu'on tape pour confirmer un effacement — court, mais pas cliquable. */
const MOT_DE_CONFIRMATION = 'SUPPRIMER';

const TITRES: Record<EmployeeStatus, string> = {
  active: 'Personnel actif',
  archived: 'Personnel inactif',
};

interface Filtres {
  positionTitle: string;
  managerId: string;
  unit: string;
}
const SANS_FILTRE: Filtres = { positionTitle: '', managerId: '', unit: '' };

export default function EmployeesPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  // L'ouverture passe par l'URL (?nouveau) : le bouton de la barre supérieure
  // est un lien, la fenêtre se partage, et le bouton Retour la referme au lieu
  // de quitter la liste.
  const createOpen = useSearchParams().get('nouveau') !== null;
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [onglet, setOnglet] = useState<EmployeeStatus>('active');
  const [filtres, setFiltres] = useState<Filtres>(SANS_FILTRE);
  const [sort, setSort] = useState<EmployeeSort>('recent');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [selection, setSelection] = useState<string[]>([]);
  const [panneau, setPanneau] = useState<'supprimer' | null>(null);
  const [ecartes, setEcartes] = useState<EmployeeBatchResult['skipped']>([]);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(id);
  }, [search]);

  const query = useInfiniteQuery({
    queryKey: ['employees', debounced, onglet, filtres, sort, dir],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ status: onglet, sort, dir, limit: '25' });
      if (debounced) params.set('q', debounced);
      if (filtres.positionTitle) params.set('positionTitle', filtres.positionTitle);
      if (filtres.managerId) params.set('managerId', filtres.managerId);
      if (filtres.unit) params.set('unit', filtres.unit);
      if (pageParam) params.set('offset', String(pageParam));
      return api<EmployeeListPage>(`/employees?${params.toString()}`);
    },
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
  });

  const pages = query.data?.pages ?? [];
  const items = useMemo(() => pages.flatMap((p) => p.items), [pages]);
  const derniere = pages[pages.length - 1];
  const counts = derniere?.counts ?? { active: 0, archived: 0 };
  const facets = derniere?.facets ?? { positions: [], managers: [], units: [] };

  const choisis = useMemo(() => items.filter((e) => selection.includes(e.id)), [items, selection]);
  const actifsChoisis = choisis.filter((e) => e.status === 'active');
  const archivesChoisis = choisis.filter((e) => e.status === 'archived');

  const bascule = (id: string) =>
    setSelection((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const toutBasculer = () =>
    setSelection((s) => (s.length === items.length ? [] : items.map((e) => e.id)));

  /**
   * Un clic sur une colonne : on trie dessus, ou l'on retourne le sens si
   * c'est déjà elle. Le premier sens dépend de la colonne — un nom se lit de
   * A à Z, une date se lit de la plus récente à la plus ancienne.
   */
  const trierPar = (colonne: EmployeeSort, premierSens: 'asc' | 'desc') => {
    if (sort === colonne) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(colonne);
      setDir(premierSens);
    }
    setSelection([]);
  };

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

  const filtreActif = Boolean(
    debounced || filtres.positionTitle || filtres.managerId || filtres.unit,
  );

  const ONGLETS = [
    { cle: 'active', label: 'Actifs', compte: counts.active },
    { cle: 'archived', label: 'Archivés', compte: counts.archived },
  ];
  const changerOnglet = (cle: string) => {
    setOnglet(cle as EmployeeStatus);
    // Les filtres portent sur des valeurs propres à l'onglet : un poste qui
    // n'existe que chez les actifs viderait l'onglet des archivés sans qu'on
    // comprenne pourquoi.
    setFiltres(SANS_FILTRE);
    setSelection([]);
  };

  return (
    <div className="mx-auto w-full max-w-6xl">
      <EmployeeCreateModal open={createOpen} onClose={() => router.replace('/employees')} />

      <OngletsBandeau courant={onglet} onChange={changerOnglet} onglets={ONGLETS} />
      {/* Reprise du même contrôle là où le bandeau n'a plus la place de le
          porter : sans elle, l'écran étroit perdrait l'accès aux archives. */}
      <Onglets
        courant={onglet}
        onChange={changerOnglet}
        onglets={ONGLETS}
        className="mb-3 w-max md:hidden"
      />

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <CardTitle>{TITRES[onglet]}</CardTitle>
            <span
              className="rounded-full bg-primary/[0.09] px-2 py-px text-[10.5px] font-extrabold text-primary"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {counts[onglet]}
            </span>
            {/* La recherche est un outil du tableau : elle se tient sur sa
                ligne de titre, pas au-dessus de la carte. */}
            <div className="relative">
              <Icon
                name="search"
                size={15}
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-muted/70"
              />
              <Input
                placeholder="Nom ou matricule…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Rechercher un employé"
                className="h-8 w-56 rounded-full pl-8 text-[12.5px]"
              />
            </div>
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

        {/* Les filtres : trois listes de ce que l'onglet contient réellement,
            plus de quoi tout relâcher d'un geste. */}
        <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-[18px] pb-3.5">
          <FiltreSelect
            label="Tous les postes"
            value={filtres.positionTitle}
            options={facets.positions.map((p) => ({ value: p, label: p }))}
            onChange={(v) => setFiltres((f) => ({ ...f, positionTitle: v }))}
          />
          <FiltreSelect
            label="Tous les managers"
            value={filtres.managerId}
            options={facets.managers.map((m) => ({ value: m.id, label: m.name }))}
            onChange={(v) => setFiltres((f) => ({ ...f, managerId: v }))}
          />
          <FiltreSelect
            label="Toutes les unités"
            value={filtres.unit}
            options={facets.units.map((u) => ({ value: u, label: u }))}
            onChange={(v) => setFiltres((f) => ({ ...f, unit: v }))}
          />
          {filtres.positionTitle || filtres.managerId || filtres.unit ? (
            <Button size="sm" variant="ghost" onClick={() => setFiltres(SANS_FILTRE)}>
              Tout afficher
            </Button>
          ) : null}
        </div>

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
              title={
                filtreActif
                  ? 'Aucun résultat'
                  : onglet === 'active'
                    ? 'Aucun employé actif'
                    : 'Aucun dossier archivé'
              }
              description={
                filtreActif
                  ? 'Essayez une autre recherche ou retirez les filtres.'
                  : onglet === 'active'
                    ? 'Créez votre premier employé pour démarrer le dossier du personnel.'
                    : 'Les dossiers désactivés se rangent ici, et se réactivent d’un geste.'
              }
              action={
                !filtreActif && onglet === 'active' ? (
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
                    <ThTri
                      label="Nom"
                      colonne="name"
                      sort={sort}
                      dir={dir}
                      onClick={() => trierPar('name', 'asc')}
                    />
                    <Th>Poste</Th>
                    <Th>Manager</Th>
                    <Th>Unité</Th>
                    <ThTri
                      label="Début contrat"
                      colonne="contractStart"
                      sort={sort}
                      dir={dir}
                      onClick={() => trierPar('contractStart', 'desc')}
                    />
                    <ThTri
                      label="Fin contrat"
                      colonne="contractEnd"
                      sort={sort}
                      dir={dir}
                      onClick={() => trierPar('contractEnd', 'asc')}
                    />
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
                          {e.givenName} {e.familyName}
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
 * Un en-tête qui trie.
 *
 * La flèche n'apparaît que sur la colonne active : trois flèches grises en
 * permanence ne diraient plus laquelle commande l'ordre à l'écran.
 */
function ThTri({
  label,
  colonne,
  sort,
  dir,
  onClick,
}: {
  label: string;
  colonne: EmployeeSort;
  sort: EmployeeSort;
  dir: 'asc' | 'desc';
  onClick: () => void;
}) {
  const actif = sort === colonne;
  return (
    <Th className="p-0">
      <button
        type="button"
        onClick={onClick}
        aria-sort={actif ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
        className={cn(
          'flex w-full items-center gap-1 px-3.5 py-[11px] text-left tracking-[0.12em] uppercase transition-colors',
          'focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none',
          actif ? 'text-primary' : 'text-ink-muted hover:text-ink',
        )}
      >
        {label}
        <Icon
          name="chevron_right"
          size={13}
          aria-hidden
          className={cn(
            'transition-[transform,opacity] duration-150',
            actif ? 'opacity-100' : 'opacity-0',
            dir === 'asc' ? '-rotate-90' : 'rotate-90',
          )}
        />
      </button>
    </Th>
  );
}

/** Une liste de filtre : l'intitulé au repos vaut « tout ». */
function FiltreSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <Select
      value={value}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
      disabled={options.length === 0}
      className={cn(
        'h-8 w-auto min-w-[9.5rem] rounded-full pr-8 text-[12.5px]',
        value ? 'border-primary/45 text-primary' : 'text-ink-muted',
      )}
    >
      <option value="">{label}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
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
