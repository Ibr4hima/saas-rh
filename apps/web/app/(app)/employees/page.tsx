'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  CardHeader,
  CardTitle,
  cn,
  EmptyState,
  Input,
  Select,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@teranga/ui';
import { api, ApiError } from '../../../lib/api';
import { formatDate, useMe } from '../../../lib/hooks';
import { EmployeeCreateModal } from '../../../components/employee-create-modal';
import { FenetreImportEmployes } from '../../../components/import-employes';
import { Icon } from '../../../components/icons';
import { Modal, ModalSection } from '../../../components/modal';
import { Onglets, OngletsBandeau } from '../../../components/onglets-bandeau';
import { Pagination } from '../../../components/pagination';
import { CartePleine, CorpsDefilant, Page } from '../../../components/gabarit';
import {
  BarreSelection,
  LIGNE_COCHEE,
  SqueletteTableau,
  ThCases,
  ThTri,
  TdCase,
  useSelection,
  type Sens,
} from '../../../components/tableau';

/** Ce qu'on tape pour confirmer un effacement — court, mais pas cliquable. */
const MOT_DE_CONFIRMATION = 'SUPPRIMER';

/**
 * Quinze lignes par page.
 *
 * Quinze tiennent dans un écran d'ordinateur portable sans faire défiler le
 * tableau, et c'est ce qui permet de comparer deux lignes éloignées d'un coup
 * d'œil. Vingt-cinq — la valeur d'avant, héritée du « Charger plus » — en
 * cachait toujours une partie.
 */
const PAR_PAGE = 15;

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

/**
 * Le sens du PREMIER clic sur chaque colonne.
 *
 * Un nom se lit de A à Z ; un début de contrat, du plus récent au plus ancien
 * — on cherche les arrivées, pas les fondateurs ; une fin de contrat, de la
 * plus proche à la plus lointaine — on cherche ce qui arrive à échéance.
 */
const PREMIER_SENS: Record<EmployeeSort, Sens> = {
  recent: 'desc',
  name: 'asc',
  contractStart: 'desc',
  contractEnd: 'asc',
};

export default function EmployeesPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  // La liste s'ouvre aussi à la paie, l'import non : il écrit des dossiers.
  const me = useMe();
  const peutImporter = Boolean(me.data && ['admin', 'hr'].includes(me.data.role));
  // L'ouverture passe par l'URL (?nouveau) : le bouton de la barre supérieure
  // est un lien, la fenêtre se partage, et le bouton Retour la referme au lieu
  // de quitter la liste.
  const createOpen = useSearchParams().get('nouveau') !== null;
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [onglet, setOnglet] = useState<EmployeeStatus>('active');
  const [filtres, setFiltres] = useState<Filtres>(SANS_FILTRE);
  const [sort, setSort] = useState<EmployeeSort>('recent');
  const [dir, setDir] = useState<Sens>('desc');
  const [panneau, setPanneau] = useState<'supprimer' | null>(null);
  // L'import ne passe PAS par l'URL, contrairement à la création : on y arrive
  // avec un fichier en main, et un lien partagé rouvrirait une fenêtre vide.
  const [importOuvert, setImportOuvert] = useState(false);
  const [ecartes, setEcartes] = useState<EmployeeBatchResult['skipped']>([]);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(id);
  }, [search]);

  // Toute requête NOUVELLE repart de la première page : rester à la page 4
  // après avoir tapé trois lettres montrerait le milieu d'un résultat dont on
  // n'a pas vu le début.
  useEffect(() => setPage(1), [debounced, onglet, filtres, sort, dir]);

  const query = useQuery({
    queryKey: ['employees', debounced, onglet, filtres, sort, dir, page],
    queryFn: () => {
      const params = new URLSearchParams({
        status: onglet,
        sort,
        dir,
        limit: String(PAR_PAGE),
        offset: String((page - 1) * PAR_PAGE),
      });
      if (debounced) params.set('q', debounced);
      if (filtres.positionTitle) params.set('positionTitle', filtres.positionTitle);
      if (filtres.managerId) params.set('managerId', filtres.managerId);
      if (filtres.unit) params.set('unit', filtres.unit);
      return api<EmployeeListPage>(`/employees?${params.toString()}`);
    },
    // La page précédente RESTE à l'écran pendant que la suivante arrive : sans
    // cela, chaque clic sur un numéro fait clignoter six lignes de squelette
    // pour deux cents millisecondes de réseau.
    placeholderData: keepPreviousData,
  });

  const donnees = query.data;
  const items = useMemo(() => donnees?.items ?? [], [donnees]);
  const counts = donnees?.counts ?? { active: 0, archived: 0 };
  const facets = donnees?.facets ?? { positions: [], managers: [], units: [] };
  const nbPages = Math.max(1, Math.ceil((donnees?.total ?? 0) / PAR_PAGE));

  /**
   * On ne reste pas sur une page qui n'existe plus.
   *
   * Filtrer depuis la page 5 d'une liste qui n'en compte plus que deux
   * afficherait un tableau vide sous une barre qui montre cinq pages. Le
   * serveur rend le total quelle que soit la page demandée : on retombe donc
   * sur la dernière page réelle.
   */
  useEffect(() => {
    if (page > nbPages) setPage(nbPages);
  }, [page, nbPages]);

  const sel = useSelection(items);
  const choisis = sel.choisis;

  /**
   * Changer de page : on relâche la sélection et l'on remonte en haut.
   *
   * La sélection d'abord — les cases cochées appartiennent aux lignes
   * AFFICHÉES, les garder ferait réapparaître « 3 dossiers sélectionnés » en
   * revenant, et un lot supprimé depuis une autre page est un lot qu'on n'a
   * pas relu.
   *
   * La remontée ensuite : on clique sur la barre EN BAS de la liste, et la
   * page suivante commence en haut. Sans ce geste, on atterrirait sous la
   * quinzième ligne d'un tableau qu'on n'a pas encore lu. C'est le panneau de
   * l'application qui défile, pas la fenêtre — d'où `data-scroll-root`, que
   * le gabarit pose sur lui.
   */
  const allerPage = (p: number) => {
    sel.vider();
    setPage(p);
    document.querySelector('[data-scroll-root]')?.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const actifsChoisis = choisis.filter((e) => e.status === 'active');
  const archivesChoisis = choisis.filter((e) => e.status === 'archived');

  /**
   * Un clic sur une colonne : on trie dessus, ou l'on retourne le sens si
   * c'est déjà elle. Le tri part au SERVEUR : la liste se pagine, et trier la
   * page affichée trierait un échantillon.
   */
  const trierPar = (colonne: EmployeeSort) => {
    if (sort === colonne) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(colonne);
      setDir(PREMIER_SENS[colonne]);
    }
    sel.vider();
  };

  const apresLot = async (res: EmployeeBatchResult) => {
    await queryClient.invalidateQueries({ queryKey: ['employees'] });
    await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    sel.vider();
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
    sel.vider();
  };

  return (
    <Page>
      <EmployeeCreateModal open={createOpen} onClose={() => router.replace('/employees')} />
      {importOuvert ? <FenetreImportEmployes onClose={() => setImportOuvert(false)} /> : null}

      <OngletsBandeau courant={onglet} onChange={changerOnglet} onglets={ONGLETS} />
      {/* Reprise du même contrôle là où le bandeau n'a plus la place de le
          porter : sans elle, l'écran étroit perdrait l'accès aux archives. */}
      <Onglets
        courant={onglet}
        onChange={changerOnglet}
        onglets={ONGLETS}
        className="mb-3 w-max md:hidden"
      />

      <CartePleine>
        <CardHeader className="flex shrink-0 flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <CardTitle>{TITRES[onglet]}</CardTitle>
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

          {/* À DROITE de la ligne du titre : c'est là qu'on cherche le
              geste qui remplit la liste, pas au pied du tableau. Il se
              retire quand des lignes sont cochées — la barre de sélection
              prend alors la place, et deux séries d'actions sur la même
              ligne feraient hésiter. */}
          {peutImporter && choisis.length === 0 ? (
            <Button
              size="sm"
              variant="secondary"
              className="h-8"
              onClick={() => setImportOuvert(true)}
              title="Importer l’effectif depuis un classeur .xlsx"
            >
              <Icon name="upload_file" size={15} />
              Importer
            </Button>
          ) : null}

          <BarreSelection sel={sel} quoi="dossier">
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
          </BarreSelection>
        </CardHeader>

        {/* Les filtres : trois listes de ce que l'onglet contient réellement,
            plus de quoi tout relâcher d'un geste. */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line-soft px-[18px] pb-3.5">
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

        {query.isLoading ? (
          <CorpsDefilant>
            <SqueletteTableau />
          </CorpsDefilant>
        ) : items.length === 0 ? (
          <CorpsDefilant className="grid place-items-center">
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
                    ? 'Créez le premier dossier, ou importez d’un coup le classeur de la Direction du Capital Humain.'
                    : 'Les dossiers désactivés se rangent ici, et se réactivent d’un geste.'
              }
              action={
                !filtreActif && onglet === 'active' ? (
                  // Le second point d'entrée de l'import, et le plus utile :
                  // le pied ne s'affiche qu'à partir d'une ligne, or c'est
                  // justement sur une plateforme VIDE qu'on importe le
                  // classeur. Sans ce bouton, l'écran d'accueil du personnel
                  // ne proposerait que la saisie une par une.
                  <span className="flex flex-wrap items-center justify-center gap-2">
                    <Link href="/employees/new">
                      <Button size="sm">Nouvel employé</Button>
                    </Link>
                    {peutImporter ? (
                      <Button size="sm" variant="secondary" onClick={() => setImportOuvert(true)}>
                        <Icon name="upload_file" size={15} />
                        Importer un fichier
                      </Button>
                    ) : null}
                  </span>
                ) : undefined
              }
            />
          </CorpsDefilant>
        ) : (
          // Pas de `pleine` ici, et c'est délibéré : le tableau ne défile
          // PAS dans une boîte à lui. Il s'étend sur toute sa hauteur, la
          // page descend avec lui, et la barre de pagination attend à la fin
          // de la liste — là où l'on arrive quand on a fini de lire.
          <Table>
            <THead>
              <tr>
                <ThCases sel={sel} />
                <Th>Matricule</Th>
                <ThTri label="Nom" colonne="name" courant={sort} sens={dir} onTrier={trierPar} />
                <Th>Poste</Th>
                <Th>Manager</Th>
                <Th>Unité</Th>
                <ThTri
                  label="Début contrat"
                  colonne="contractStart"
                  courant={sort}
                  sens={dir}
                  onTrier={trierPar}
                />
                <ThTri
                  label="Fin contrat"
                  colonne="contractEnd"
                  courant={sort}
                  sens={dir}
                  onTrier={trierPar}
                />
              </tr>
            </THead>
            <TBody>
              {items.map((e) => {
                const coche = sel.coche(e.id);
                return (
                  <Tr
                    key={e.id}
                    className={cn('cursor-pointer', coche && LIGNE_COCHEE)}
                    onClick={() => router.push(`/employees/${e.id}`)}
                  >
                    <TdCase sel={sel} id={e.id} quoi={`${e.givenName} ${e.familyName}`} />
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
        )}
      </CartePleine>

      {/* La barre vit SOUS la carte, centrée : elle navigue entre les pages,
          elle n'appartient donc pas au tableau qu'elle remplace. */}
      <Pagination page={page} pages={nbPages} onPage={allerPage} />

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
    </Page>
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
