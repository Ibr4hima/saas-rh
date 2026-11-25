'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Fragment, useMemo, useRef, useState } from 'react';
import {
  CHOIX_AUCUN,
  orgUnitLabel,
  uniteAvecArticle,
  type AgentImport,
  type ChoixImport,
  type InviterPlusieursResult,
  type LigneImport,
  type NoeudImport,
  type OrgUnitView,
  type RapportImportEmployes,
  type RattachementImport,
  type ResponsableImport,
  type UniteCreeeImport,
} from '@teranga/contracts';
import {
  Badge,
  Button,
  Checkbox,
  cn,
  Input,
  Select,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@teranga/ui';
import { api, ApiError } from '../lib/api';
import { compte } from '../lib/mots';
import { Icon } from './icons';
import { Modal, ModalSection } from './modal';
import { Onglets } from './onglets';
import { Organigramme } from './organigramme';
import { Pagination, usePagination } from './pagination';

/* ────────────────────────────────────────────────────────────────
   Importer le fichier du personnel de la DCH (ADR-0159).

   Trois temps : on dépose, on lit ce que l'import fera, on applique.
   L'aperçu joue l'import en entier puis l'annule : ce qu'il annonce, refus
   compris, est ce que l'import fera. Le compte rendu est le même tableau
   avant et après, relu avec le résultat de chaque ligne.

   Un nom de N+1 porté par deux personnes se départage ici, avant l'import :
   une fois tous les noms départagés, l'aperçu se rejoue et montre les
   rattachements retenus. Le nom d'une unité à créer se corrige ici aussi :
   l'unité naît avec le bon nom, et le poste de son responsable avec elle.
   Dans une direction qui compte plusieurs départements, chaque service se
   range sous celui qu'on choisit ici (ADR-0178).

   Avant d'importer, on voit l'organigramme que l'import laisse : un clic
   sur une unité liste ses agents, et chaque agent que l'import crée se
   place dans un département ou un service de sa direction. Une unité qui a
   des agents sans responsable attend qu'on le désigne (ADR-0179).
   ──────────────────────────────────────────────────────────────── */

type Etape = 'depot' | 'apercu' | 'organigramme' | 'fait';

/** Ce qu'on règle à l'aperçu, renvoyé avec le fichier à chaque envoi. */
interface Reglages {
  /** Les homonymes départagés : la clé du choix, le candidat retenu. */
  departages: Record<string, string>;
  /** Les noms d'unités corrigés : la clé de l'unité, son nom. */
  noms: Record<string, string>;
  /** Les services rangés : la clé du service, celle du département. */
  rattachements: Record<string, string>;
  /** Les responsables désignés : la clé de l'unité, celle de la personne. */
  responsables: Record<string, string>;
  /** Les agents placés : la ligne du fichier, la clé de l'unité. */
  placements: Record<number, string>;
}

const REGLAGES_VIDES: Reglages = {
  departages: {},
  noms: {},
  rattachements: {},
  responsables: {},
  placements: {},
};

/** Ce qu'on peut régler dans l'aperçu ; absent une fois l'import appliqué. */
interface ActionsDeLApercu {
  departager: (cle: string, candidat: string) => void;
  rattacher: (cle: string, departement: string) => void;
  designer: (cle: string, personne: string) => void;
  renommer: (unite: UniteCreeeImport, nom: string) => void;
}
type Filtre = 'toutes' | LigneImport['etat'];

const TONS: Record<LigneImport['etat'], 'teal' | 'bleu' | 'gris' | 'rouge'> = {
  'a-creer': 'teal',
  'a-modifier': 'bleu',
  inchange: 'gris',
  erreur: 'rouge',
};

/** Le mot de l'état : il change de temps une fois l'import appliqué. */
function motDeLEtat(etat: LigneImport['etat'], applique: boolean): string {
  if (etat === 'a-creer') return applique ? 'Créée' : 'À créer';
  if (etat === 'a-modifier') return applique ? 'Modifiée' : 'À modifier';
  return etat === 'inchange' ? 'Inchangée' : 'Erreur';
}

export function FenetreImportEmployes({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [etape, setEtape] = useState<Etape>('depot');
  const [fichier, setFichier] = useState<File | null>(null);
  const [rapport, setRapport] = useState<RapportImportEmployes | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [survol, setSurvol] = useState(false);
  const [reglages, setReglages] = useState<Reglages>(REGLAGES_VIDES);
  // Seule la réponse au dernier envoi s'affiche : deux corrections de suite
  // lancent deux aperçus, et le premier peut revenir après le second.
  const dernierEnvoi = useRef(0);
  // Les agents placés que l'aperçu affiché a déjà pris en compte.
  const placementsJoues = useRef('{}');
  // Après l'import, l'invitation au portail des fiches créées.
  const [invitations, setInvitations] = useState<Set<string>>(new Set());
  const [invites, setInvites] = useState<InviterPlusieursResult | null>(null);
  const creees = (rapport?.lignes ?? []).filter(
    (l): l is LigneImport & { employeeId: string } => l.etat === 'a-creer' && Boolean(l.employeeId),
  );

  const envoyer = async (f: File, apercu: boolean, r: Reglages) => {
    const envoi = ++dernierEnvoi.current;
    setEnCours(true);
    setErreur(null);
    try {
      const parametres = new URLSearchParams();
      if (apercu) parametres.set('apercu', '1');
      const joindre = (nom: string, valeur: object) => {
        if (Object.keys(valeur).length > 0) parametres.set(nom, JSON.stringify(valeur));
      };
      joindre('choix', r.departages);
      joindre('noms', r.noms);
      joindre('rattachements', r.rattachements);
      joindre('responsables', r.responsables);
      // Groupés par unité : l'adresse reste courte, même pour trois cents agents.
      const parUnite: Record<string, number[]> = {};
      for (const [ligne, unite] of Object.entries(r.placements)) {
        (parUnite[unite] ??= []).push(Number(ligne));
      }
      joindre('placements', parUnite);
      const suite = parametres.toString();
      const res = await api<RapportImportEmployes>(`/employees/import${suite ? `?${suite}` : ''}`, {
        method: 'POST',
        body: f,
      });
      if (envoi !== dernierEnvoi.current) return;
      placementsJoues.current = JSON.stringify(r.placements);
      setRapport(res);
      setEtape((e) => (!apercu ? 'fait' : e === 'organigramme' ? e : 'apercu'));
      if (!apercu) {
        setInvitations(
          new Set(
            res.lignes
              .filter((l) => l.etat === 'a-creer' && l.employeeId && l.emailPro)
              .map((l) => l.employeeId!),
          ),
        );
        await queryClient.invalidateQueries({ queryKey: ['employees'] });
        await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        await queryClient.invalidateQueries({ queryKey: ['org-units'] });
        await queryClient.invalidateQueries({ queryKey: ['hierarchie-controle'] });
        await queryClient.invalidateQueries({ queryKey: ['vidage'] });
      }
    } catch (err) {
      if (envoi !== dernierEnvoi.current) return;
      setErreur(err instanceof ApiError ? err.message : 'Lecture impossible, réessayez.');
    } finally {
      if (envoi === dernierEnvoi.current) setEnCours(false);
    }
  };

  /** Ce qu'on refuse sans demander au serveur : un fichier qui n'est pas un .xlsx, ou trop lourd. */
  const choisir = (f: File | null) => {
    if (!f) return;
    if (!/\.xlsx$/i.test(f.name)) {
      setFichier(null);
      setRapport(null);
      return setErreur(
        `« ${f.name} » n’est pas un classeur .xlsx. Enregistrez le fichier au format Excel (.xlsx) depuis votre tableur, puis déposez-le ici.`,
      );
    }
    if (f.size > 12 * 1024 * 1024) {
      setFichier(null);
      setRapport(null);
      return setErreur(
        `Ce fichier pèse ${(f.size / 1024 / 1024).toFixed(1)} Mo, au-delà de la limite de 12 Mo. Retirez les feuilles et les images inutiles, ou importez l’effectif en deux fois.`,
      );
    }
    setFichier(f);
    setReglages(REGLAGES_VIDES);
    void envoyer(f, true, REGLAGES_VIDES);
  };

  // Ce qui reste à choisir : les homonymes, les départements des services,
  // les responsables des unités qui n'en ont pas.
  const restants = (r: Reglages) =>
    (rapport?.choix ?? []).filter((c) => !(r.departages[c.cle] ?? c.retenu)).length +
    (rapport?.rattachements ?? []).filter((x) => !(r.rattachements[x.cle] ?? x.retenu)).length +
    (rapport?.unitesSansResponsable ?? []).filter((u) => !(r.responsables[u.cle] ?? u.retenu))
      .length;
  // L'aperçu se rejoue une fois tout choisi, pas à chaque choix : sur trois
  // cents agents, il prend quelques secondes.
  const regler = (suite: Reglages, rejouer: 'si-complet' | 'toujours' | 'jamais') => {
    setReglages(suite);
    if (!fichier || rejouer === 'jamais') return;
    if (rejouer === 'toujours' || restants(suite) === 0) void envoyer(fichier, true, suite);
  };
  const actions: ActionsDeLApercu = {
    departager: (cle, candidat) =>
      regler(
        { ...reglages, departages: { ...reglages.departages, [cle]: candidat } },
        'si-complet',
      ),
    rattacher: (cle, departement) =>
      regler(
        { ...reglages, rattachements: { ...reglages.rattachements, [cle]: departement } },
        'si-complet',
      ),
    designer: (cle, personne) =>
      regler(
        { ...reglages, responsables: { ...reglages.responsables, [cle]: personne } },
        'si-complet',
      ),
    // Un nom d'unité corrigé : l'aperçu se rejoue, les postes des responsables
    // suivent le nouveau nom.
    renommer: (unite, nom) => {
      const noms = { ...reglages.noms };
      if (nom === unite.propose) delete noms[unite.cle];
      else noms[unite.cle] = nom;
      regler({ ...reglages, noms }, 'toujours');
    },
  };
  // Un agent placé : l'aperçu se rejoue quand on quitte la fiche de l'unité,
  // une fois tous ses agents placés.
  const placer = (ligne: number, unite: string) =>
    regler({ ...reglages, placements: { ...reglages.placements, [ligne]: unite } }, 'jamais');
  const rejouerLesPlacements = () => {
    if (fichier && JSON.stringify(reglages.placements) !== placementsJoues.current) {
      void envoyer(fichier, true, reglages);
    }
  };

  const bloquant = rapport !== null && rapport.colonnesManquantes.length > 0;
  const aChoisir = restants(reglages);
  const aEcrire = rapport ? rapport.aCreer + rapport.aModifier : 0;

  const inviter = async () => {
    setEnCours(true);
    setErreur(null);
    try {
      setInvites(
        await api<InviterPlusieursResult>('/portail/invitations', {
          method: 'POST',
          body: { ids: [...invitations] },
        }),
      );
    } catch (err) {
      setErreur(err instanceof ApiError ? err.message : 'Envoi impossible, réessayez.');
    } finally {
      setEnCours(false);
    }
  };
  const proposerLesInvitations = etape === 'fait' && creees.length > 0 && !invites;

  return (
    <Modal
      open
      onClose={onClose}
      title={
        etape === 'organigramme' ? 'Organigramme après l’import' : 'Importer un fichier d’employés'
      }
      subtitle={
        etape === 'depot' ? (
          'Le fichier Excel du personnel tenu par la DCH.'
        ) : (
          // La feuille est nommée : un classeur en porte souvent plusieurs.
          <p className="mt-0.5 truncate text-xs text-ink-muted">
            {fichier?.name}
            {rapport ? ` · feuille « ${rapport.feuille} »` : ''}
          </p>
        )
      }
      maxWidth={etape === 'organigramme' ? 'max-w-7xl' : 'max-w-5xl'}
      footer={
        etape === 'apercu' && rapport ? (
          <>
            <Button variant="secondary" onClick={() => setEtape('depot')}>
              Changer de fichier
            </Button>
            {/* L'organigramme avant l'import : c'est de là qu'on valide. */}
            <Button
              loading={enCours}
              disabled={aEcrire === 0 || bloquant || aChoisir > 0}
              onClick={() => setEtape('organigramme')}
            >
              {aEcrire === 0 ? 'Rien à importer' : 'Voir l’organigramme'}
            </Button>
          </>
        ) : etape === 'organigramme' && rapport ? (
          <>
            <Button variant="secondary" disabled={enCours} onClick={() => setEtape('apercu')}>
              Revenir à l’aperçu
            </Button>
            <Button
              loading={enCours}
              disabled={aEcrire === 0 || bloquant || aChoisir > 0}
              onClick={() => fichier && void envoyer(fichier, false, reglages)}
            >
              {`Importer ${compte(aEcrire, 'fiche')}`}
            </Button>
          </>
        ) : proposerLesInvitations ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Plus tard
            </Button>
            <Button
              loading={enCours}
              disabled={invitations.size === 0}
              onClick={() => void inviter()}
            >
              {invitations.size === 0 ? 'Inviter' : `Inviter ${compte(invitations.size, 'agent')}`}
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>{etape === 'fait' ? 'Terminer' : 'Fermer'}</Button>
        )
      }
    >
      {erreur ? (
        <p
          role="alert"
          className="mb-4 rounded-bloc bg-danger-soft px-3.5 py-2.5 text-[12.5px] font-semibold text-danger"
        >
          {erreur}
        </p>
      ) : null}

      {etape === 'depot' ? (
        <>
          <label
            htmlFor="import-employes"
            onDragOver={(e) => {
              e.preventDefault();
              setSurvol(true);
            }}
            onDragLeave={() => setSurvol(false)}
            onDrop={(e) => {
              e.preventDefault();
              setSurvol(false);
              choisir(e.dataTransfer.files?.[0] ?? null);
            }}
            className={cn(
              'flex cursor-pointer flex-col items-center gap-2 rounded-bloc border border-dashed px-6 py-10 text-center transition-colors focus-within:ring-2 focus-within:ring-primary/40',
              survol ? 'border-primary bg-primary/[0.04]' : 'border-line hover:border-primary/50',
            )}
          >
            <input
              id="import-employes"
              type="file"
              className="sr-only"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => {
                choisir(e.target.files?.[0] ?? null);
                e.currentTarget.value = '';
              }}
            />
            <Icon name={enCours ? 'schedule' : 'upload_file'} size={26} className="text-primary" />
            <span className="text-[13.5px] font-bold text-ink-strong">
              {enCours ? 'Lecture du fichier…' : 'Déposez le fichier, ou cliquez pour le choisir'}
            </span>
            <span className="text-[12px] text-ink-muted">
              Fichier .xlsx · seule la première feuille est lue · 12 Mo maximum
            </span>
          </label>

          <ModalSection title="Ce que le fichier doit contenir">
            <p className="text-[12.5px] leading-relaxed text-ink">
              Une ligne par agent, et une première ligne d’intitulés, dans l’ordre que vous voulez.
              Quatre colonnes sont indispensables : <b>Matricule</b>, <b>Prénom</b>, <b>Nom</b> et{' '}
              <b>Date d’entrée</b> (ou <b>Ancienneté</b>).
            </p>
            <p className="mt-2 text-[12px] leading-relaxed text-ink-muted">
              Un matricule déjà connu met sa fiche à jour : l’aperçu liste chaque changement, et une
              case vide n’efface rien. Rien n’est enregistré avant que vous ne validiez l’aperçu.
            </p>
          </ModalSection>
        </>
      ) : null}

      {etape === 'fait' && creees.length > 0 ? (
        <InvitationsDuLot
          creees={creees}
          choix={invitations}
          setChoix={setInvitations}
          invites={invites}
        />
      ) : null}
      {etape === 'organigramme' && rapport ? (
        <OrganigrammeFinal
          rapport={rapport}
          enCours={enCours}
          reglages={reglages}
          designer={actions.designer}
          placer={placer}
          onQuitterLaFiche={rejouerLesPlacements}
        />
      ) : etape !== 'depot' && rapport ? (
        <Compte
          rapport={rapport}
          enCours={enCours}
          reglages={reglages}
          actions={etape === 'apercu' ? actions : null}
        />
      ) : null}
    </Modal>
  );
}

/** Les fiches créées, à inviter au portail : toutes d'un coup, ou celles qu'on coche. */
function InvitationsDuLot({
  creees,
  choix,
  setChoix,
  invites,
}: {
  creees: (LigneImport & { employeeId: string })[];
  choix: Set<string>;
  setChoix: (s: Set<string>) => void;
  invites: InviterPlusieursResult | null;
}) {
  const invitables = creees.filter((l) => l.emailPro);
  const tous = invitables.length > 0 && invitables.every((l) => choix.has(l.employeeId));
  const basculer = (id: string, oui: boolean) => {
    const s = new Set(choix);
    if (oui) s.add(id);
    else s.delete(id);
    setChoix(s);
  };
  if (invites) {
    return (
      <ModalSection title="Accès au portail">
        <p className="flex items-center gap-2 text-[12.5px] font-semibold text-ink-strong">
          <Icon name="task_alt" size={17} className="text-success" />
          {compte(invites.invites.length, 'invitation envoyée', 'invitations envoyées')}
        </p>
        {invites.refus.length > 0 ? (
          <ul className="mt-2 flex flex-col gap-1 text-[12px] text-ink-muted">
            {invites.refus.map((r) => (
              <li key={r.employeeId}>
                <span className="font-semibold text-ink">{r.nom}</span> : {r.raison}
              </li>
            ))}
          </ul>
        ) : null}
      </ModalSection>
    );
  }
  return (
    <ModalSection title="Accès au portail">
      <div className="mb-4 overflow-hidden rounded-bloc border border-line-soft">
        <label className="flex cursor-pointer items-center gap-3 border-b border-line-soft bg-surface-raised px-3.5 py-2.5 text-[12.5px] font-semibold text-ink-strong">
          <Checkbox
            checked={tous}
            indeterminate={!tous && choix.size > 0}
            disabled={invitables.length === 0}
            onChange={(e) =>
              setChoix(new Set(e.target.checked ? invitables.map((l) => l.employeeId) : []))
            }
          />
          Inviter tous les agents importés
        </label>
        <ul className="max-h-[14rem] divide-y divide-line-soft overflow-auto">
          {creees.map((l) => {
            const adresse = l.emailPro ?? null;
            return (
              <li key={l.employeeId}>
                <label
                  className={cn(
                    'flex items-center gap-3 px-3.5 py-2 text-[12.5px]',
                    adresse ? 'cursor-pointer' : 'text-ink-muted',
                  )}
                >
                  <Checkbox
                    checked={choix.has(l.employeeId)}
                    disabled={!adresse}
                    onChange={(e) => basculer(l.employeeId, e.target.checked)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-ink">{l.nom}</span>
                    <span className="block truncate text-[11.5px] text-ink-muted">
                      {adresse ?? 'Sans adresse pro'}
                    </span>
                  </span>
                  <span className="hidden font-mono text-[11.5px] text-ink-muted sm:block">
                    {l.matricule}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>
    </ModalSection>
  );
}

/** Le compte rendu : les totaux, ce qui reste à départager, puis le détail ligne par ligne. */
function Compte({
  rapport,
  enCours,
  reglages,
  actions,
}: {
  rapport: RapportImportEmployes;
  enCours: boolean;
  reglages: Reglages;
  actions: ActionsDeLApercu | null;
}) {
  const [filtre, setFiltre] = useState<Filtre>('toutes');
  const bloquant = rapport.colonnesManquantes.length > 0;
  const lignes =
    filtre === 'toutes' ? rapport.lignes : rapport.lignes.filter((l) => l.etat === filtre);
  const { tranche, barre } = usePagination(lignes);
  const a = rapport.applique;

  if (bloquant) {
    return (
      <p
        role="alert"
        className="rounded-bloc bg-danger-soft px-3.5 py-3 text-[12.5px] leading-relaxed text-danger"
      >
        <b>Ce fichier ne peut pas être importé.</b> Colonne
        {rapport.colonnesManquantes.length > 1 ? 's' : ''} absente
        {rapport.colonnesManquantes.length > 1 ? 's' : ''} : {rapport.colonnesManquantes.join(', ')}
        . Ajoutez-les à la première ligne du classeur.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        <Chiffre
          valeur={rapport.aCreer}
          libelle={a ? 'fiches créées' : 'fiches à créer'}
          ton="success"
        />
        <Chiffre
          valeur={rapport.aModifier}
          libelle={a ? 'fiches modifiées' : 'fiches à modifier'}
          ton="neutre"
        />
        <Chiffre valeur={rapport.inchanges} libelle="fiches inchangées" ton="neutre" />
        <Chiffre valeur={rapport.erreurs} libelle="lignes en erreur" ton="danger" />
        {/* L'orange pour ce qui laisse du travail : sans N+1, un agent ne
            peut pas être évalué. */}
        <Chiffre valeur={rapport.sansN1} libelle="sans N+1" ton="warning" />
      </div>

      {actions && rapport.choix.length > 0 ? (
        <Departages
          choix={rapport.choix}
          enCours={enCours}
          departages={reglages.departages}
          departager={actions.departager}
        />
      ) : null}

      {actions && rapport.rattachements.length > 0 ? (
        <Rattachements
          rattachements={rapport.rattachements}
          enCours={enCours}
          choisis={reglages.rattachements}
          rattacher={actions.rattacher}
        />
      ) : null}

      {actions && rapport.unitesSansResponsable.length > 0 ? (
        <SansResponsable
          unites={rapport.unitesSansResponsable}
          enCours={enCours}
          choisis={reglages.responsables}
          designer={actions.designer}
        />
      ) : null}

      <UnitesEtResponsables rapport={rapport} renommer={actions?.renommer ?? null} />

      {rapport.colonnesInconnues.length > 0 ? (
        <Remarque>
          {compte(rapport.colonnesInconnues.length, 'colonne')} du fichier n’
          {rapport.colonnesInconnues.length > 1 ? 'ont' : 'a'} pas d’équivalent et{' '}
          {rapport.colonnesInconnues.length > 1 ? 'sont ignorées' : 'est ignorée'} :{' '}
          {rapport.colonnesInconnues.join(', ')}.
        </Remarque>
      ) : null}
      {rapport.colonnesNonImportees.length > 0 ? (
        <Remarque>
          Non importées, réservées à l’accès aux données sensibles :{' '}
          {rapport.colonnesNonImportees.join(', ')}.
        </Remarque>
      ) : null}

      {rapport.lignes.length > 0 ? (
        <>
          <Onglets
            label="Filtrer les lignes"
            className="self-start overflow-x-auto"
            courant={filtre}
            onChange={(c) => setFiltre(c as Filtre)}
            onglets={[
              { cle: 'toutes', label: 'Toutes', compte: rapport.total },
              { cle: 'a-creer', label: a ? 'Créées' : 'À créer', compte: rapport.aCreer },
              {
                cle: 'a-modifier',
                label: a ? 'Modifiées' : 'À modifier',
                compte: rapport.aModifier,
              },
              { cle: 'inchange', label: 'Inchangées', compte: rapport.inchanges },
              { cle: 'erreur', label: 'En erreur', compte: rapport.erreurs },
            ]}
          />
          <div className="max-h-[24rem] overflow-auto rounded-bloc border border-line-soft">
            <Table>
              <THead>
                <tr>
                  <Th className="w-14 text-right">Ligne</Th>
                  <Th>Matricule</Th>
                  <Th>Nom</Th>
                  <Th className="hidden md:table-cell">Poste</Th>
                  <Th className="hidden md:table-cell">Unité</Th>
                  <Th className="hidden lg:table-cell">N+1</Th>
                  <Th>État</Th>
                </tr>
              </THead>
              <TBody>
                {tranche.map((l) => (
                  <Fragment key={l.ligne}>
                    <Tr>
                      <Td className="text-right font-mono text-[11.5px] text-ink-muted tabular-nums">
                        {l.ligne}
                      </Td>
                      <Td className="font-mono text-[11.5px] whitespace-nowrap">
                        {l.matricule}
                        {l.matriculeProvisoire ? (
                          <span className="ml-1.5 font-sans text-[10.5px] font-semibold text-accent-text">
                            provisoire
                          </span>
                        ) : null}
                      </Td>
                      <Td className="font-semibold text-ink-strong">{l.nom}</Td>
                      <Td className="hidden text-ink-muted md:table-cell">{l.poste}</Td>
                      <Td className="hidden whitespace-nowrap md:table-cell">{l.unite}</Td>
                      <Td className="hidden whitespace-nowrap lg:table-cell">{l.responsable}</Td>
                      <Td>
                        <Badge tone={TONS[l.etat]}>{motDeLEtat(l.etat, a)}</Badge>
                      </Td>
                    </Tr>
                    {aDesDetails(l) ? (
                      // Le détail court sous la ligne, sur toute la largeur : dans
                      // la colonne de l'état, il se hachait sur dix lignes.
                      <tr>
                        <td colSpan={7} className="px-4 pt-0 pb-3.5">
                          <span className="flex flex-col gap-1 md:pl-14">
                            <Details ligne={l} />
                          </span>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </TBody>
            </Table>
          </div>
          <Pagination {...barre} />
        </>
      ) : null}
    </div>
  );
}

const aDesDetails = (l: LigneImport) =>
  Boolean(l.motif) ||
  l.changements.length > 0 ||
  l.corrections.length > 0 ||
  l.avertissements.length > 0;

/** Sous une ligne : le refus, les changements, les corrections, ce qui manquera. */
function Details({ ligne: l }: { ligne: LigneImport }) {
  const texte = 'text-[11.5px] leading-snug';
  return (
    <>
      {l.motif ? (
        <span className={cn(texte, 'text-ink')}>
          {l.colonne ? <b>{l.colonne} : </b> : null}
          {l.motif}
        </span>
      ) : null}
      {l.changements.map((c, i) => (
        <span key={`c-${i}`} className={cn(texte, 'text-ink')}>
          <b>{c.champ} : </b>
          {c.avant ? `${c.avant} → ` : ''}
          {c.apres}
        </span>
      ))}
      {l.corrections.map((c, i) => (
        <span key={`r-${i}`} className={cn(texte, 'text-ink-muted')}>
          <b>{c.colonne} : </b>
          {c.lu ? `« ${c.lu} »` : 'case vide'} → {c.retenu}
        </span>
      ))}
      {l.avertissements.map((a, i) => (
        <span key={`a-${i}`} className={cn(texte, 'text-ink-muted')}>
          <b>{a.colonne} : </b>
          {a.texte}
        </span>
      ))}
    </>
  );
}

/** Les noms portés par plusieurs personnes : on choisit, puis l'aperçu se rejoue. */
function Departages({
  choix,
  enCours,
  departages,
  departager,
}: {
  choix: ChoixImport[];
  enCours: boolean;
  departages: Record<string, string>;
  departager: (cle: string, candidat: string) => void;
}) {
  return (
    <ModalSection title="À départager">
      <ul className="flex flex-col gap-3">
        {choix.map((c) => (
          <li key={c.cle} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-4">
            <span className="min-w-0 flex-1 text-[12.5px] text-ink">
              <b>« {c.nom} »</b>
              <span className="text-ink-muted">
                {' '}
                · {c.role === 'n1' ? 'N+1' : 'Responsable fonctionnel'} ·{' '}
                {c.lignes.length > 1 ? 'lignes' : 'ligne'} {c.lignes.join(', ')}
              </span>
            </span>
            <Select
              aria-label={`Qui est « ${c.nom} »`}
              className="sm:w-[22rem]"
              disabled={enCours}
              value={departages[c.cle] ?? c.retenu ?? ''}
              onChange={(e) => departager(c.cle, e.target.value)}
            >
              <option value="" disabled>
                Choisir la personne
              </option>
              {c.candidats.map((x) => (
                <option key={x.cle} value={x.cle}>
                  {`${x.nom} · ${x.detail}`}
                </option>
              ))}
              <option value={CHOIX_AUCUN}>Aucune de ces personnes</option>
            </Select>
          </li>
        ))}
      </ul>
    </ModalSection>
  );
}

/** Les services d'une direction à plusieurs départements : on choisit, puis l'aperçu se rejoue. */
function Rattachements({
  rattachements,
  enCours,
  choisis,
  rattacher,
}: {
  rattachements: RattachementImport[];
  enCours: boolean;
  choisis: Record<string, string>;
  rattacher: (cle: string, departement: string) => void;
}) {
  return (
    <ModalSection title="Services à rattacher">
      <ul className="flex flex-col gap-3">
        {rattachements.map((r) => (
          <li key={r.cle} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-4">
            <span className="min-w-0 flex-1 text-[12.5px] text-ink">
              <b>{r.service}</b>
              <span className="text-ink-muted">
                {' '}
                · {r.direction} · {r.lignes.length > 1 ? 'lignes' : 'ligne'} {r.lignes.join(', ')}
              </span>
            </span>
            <Select
              aria-label={`Département de rattachement de « ${r.service} »`}
              className="sm:w-[22rem]"
              disabled={enCours}
              value={choisis[r.cle] ?? r.retenu ?? ''}
              onChange={(e) => rattacher(r.cle, e.target.value)}
            >
              <option value="" disabled>
                Choisir le département
              </option>
              {r.departements.map((d) => (
                <option key={d.cle} value={d.cle}>
                  {d.nom}
                </option>
              ))}
            </Select>
          </li>
        ))}
      </ul>
    </ModalSection>
  );
}

/** Les unités qui ont des agents sans responsable : on désigne, puis l'aperçu se rejoue. */
function SansResponsable({
  unites,
  enCours,
  choisis,
  designer,
}: {
  unites: ResponsableImport[];
  enCours: boolean;
  choisis: Record<string, string>;
  designer: (cle: string, personne: string) => void;
}) {
  return (
    <ModalSection title="Unités sans responsable">
      <ul className="flex flex-col gap-3">
        {unites.map((u) => (
          <li key={u.cle} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-4">
            <span className="min-w-0 flex-1 text-[12.5px] text-ink">
              <b>{u.unite}</b>
              <span className="text-ink-muted">
                {u.direction !== u.unite ? ` · ${u.direction}` : ''} · {compte(u.effectif, 'agent')}
              </span>
              {u.echec ? (
                <span className="block text-[11.5px] text-danger">Non désigné : {u.echec}</span>
              ) : null}
            </span>
            <ChoixDuResponsable
              unite={u}
              enCours={enCours}
              valeur={choisis[u.cle] ?? u.retenu ?? ''}
              designer={designer}
              className="sm:w-[22rem]"
            />
          </li>
        ))}
      </ul>
    </ModalSection>
  );
}

/** Le responsable d'une unité qui n'en a pas : un agent de sa direction, ou « Non désigné ». */
function ChoixDuResponsable({
  unite,
  enCours,
  valeur,
  designer,
  className,
}: {
  unite: ResponsableImport;
  enCours: boolean;
  valeur: string;
  designer: (cle: string, personne: string) => void;
  className?: string;
}) {
  return (
    <Select
      aria-label={`Responsable de « ${unite.unite} »`}
      className={className}
      disabled={enCours}
      value={valeur}
      onChange={(e) => designer(unite.cle, e.target.value)}
    >
      <option value="" disabled>
        Choisir le responsable
      </option>
      {unite.candidats.map((c) => (
        <option key={c.cle} value={c.cle}>
          {`${c.nom} · ${c.detail}`}
        </option>
      ))}
      <option value={CHOIX_AUCUN}>Non désigné</option>
    </Select>
  );
}

/** L'arbre de l'organigramme final : les enfants de chaque unité, et le périmètre de chacune. */
function useArbre(noeuds: NoeudImport[]) {
  return useMemo(() => {
    const parCle = new Map(noeuds.map((n) => [n.cle, n]));
    const enfants = new Map<string, NoeudImport[]>();
    for (const n of noeuds) {
      if (!n.parent) continue;
      enfants.set(n.parent, [...(enfants.get(n.parent) ?? []), n]);
    }
    for (const l of enfants.values()) {
      l.sort((a, b) => {
        const rang = (n: NoeudImport) => (n.type === 'department' ? 0 : 1);
        return rang(a) - rang(b) || a.nom.localeCompare(b.nom, 'fr');
      });
    }
    /** L'unité et ce qui en descend, sans entrer dans les directions qu'elle coiffe. */
    const perimetre = (cle: string): Set<string> => {
      const vus = new Set([cle]);
      const pile = [cle];
      while (pile.length > 0) {
        for (const e of enfants.get(pile.pop()!) ?? []) {
          if (vus.has(e.cle) || e.type === 'direction') continue;
          vus.add(e.cle);
          pile.push(e.cle);
        }
      }
      return vus;
    };
    /** La plus proche direction en remontant, l'unité comprise. */
    const direction = (cle: string): NoeudImport | null => {
      let n = parCle.get(cle) ?? null;
      for (let i = 0; n && i < 64; i += 1) {
        if (n.type === 'direction') return n;
        n = n.parent ? (parCle.get(n.parent) ?? null) : null;
      }
      return null;
    };
    /** Les unités d'une direction, dans l'ordre de l'arbre : elle, ses départements et leurs services. */
    const unitesDe = (dir: NoeudImport): NoeudImport[] => {
      const liste: NoeudImport[] = [dir];
      const descendre = (n: NoeudImport) => {
        for (const e of enfants.get(n.cle) ?? []) {
          if (e.type === 'direction') continue;
          liste.push(e);
          descendre(e);
        }
      };
      descendre(dir);
      return liste;
    };
    return { parCle, perimetre, direction, unitesDe };
  }, [noeuds]);
}

/**
 * L'organigramme tel que l'import le laisse, avant de valider (ADR-0179). Un
 * clic sur une unité liste ses agents : les agents que l'import crée se placent
 * dans un département ou un service de leur direction. Quitter la fiche
 * rejoue l'aperçu avec ces placements.
 */
function OrganigrammeFinal({
  rapport,
  enCours,
  reglages,
  designer,
  placer,
  onQuitterLaFiche,
}: {
  rapport: RapportImportEmployes;
  enCours: boolean;
  reglages: Reglages;
  designer: (cle: string, personne: string) => void;
  placer: (ligne: number, unite: string) => void;
  onQuitterLaFiche: () => void;
}) {
  const [ouverte, setOuverte] = useState<string | null>(null);
  const arbre = useArbre(rapport.organigramme);
  // Le bloc de l'organigramme se lit comme celui de la page Organigramme.
  const vues = useMemo<OrgUnitView[]>(() => {
    const effectif = (cle: string) => {
      const p = arbre.perimetre(cle);
      return rapport.agents.filter((a) => p.has(a.unite)).length;
    };
    return rapport.organigramme.map((n) => ({
      id: n.cle,
      name: n.nom,
      unitType: n.type,
      parentId: n.parent,
      shortName: n.sigle,
      managerEmployeeId: n.responsable ? n.cle : null,
      managerName: n.responsable?.nom ?? null,
      managerShortName: n.responsable?.nomAbrege ?? null,
      managerGender: n.responsable?.genre ?? null,
      managerNumber: n.responsable?.matricule ?? null,
      managerPosition: null,
      managerDepuis: null,
      adjoint: null,
      sommet: n.sommet,
      directionDuPersonnel: false,
      headcount: effectif(n.cle),
      attachedEmployees: effectif(n.cle),
    }));
  }, [rapport, arbre]);
  // Une unité sans responsable peut apparaître après un placement : on la
  // désigne ici, sans repasser par l'aperçu.
  const enAttente = rapport.unitesSansResponsable.filter(
    (u) => !(reglages.responsables[u.cle] ?? u.retenu),
  );
  const noeud = ouverte ? arbre.parCle.get(ouverte) : undefined;

  // L'organigramme et la fiche d'une unité tiennent dans la même hauteur :
  // passer de l'un à l'autre ne déplace pas la fenêtre, centrée (ADR-0180).
  return (
    <div className="flex h-[min(68vh,720px)] min-h-0 flex-col gap-4 overflow-y-auto">
      {noeud ? (
        <FicheDUnite
          noeud={noeud}
          rapport={rapport}
          arbre={arbre}
          enCours={enCours}
          reglages={reglages}
          designer={designer}
          placer={placer}
          onRetour={() => {
            setOuverte(null);
            onQuitterLaFiche();
          }}
        />
      ) : (
        <>
          {enAttente.length > 0 ? (
            <SansResponsable
              unites={enAttente}
              enCours={enCours}
              choisis={reglages.responsables}
              designer={designer}
            />
          ) : null}
          <div className="min-h-[420px] flex-1 overflow-hidden rounded-bloc border border-line-soft bg-surface">
            <Organigramme
              unites={vues}
              selectionId={null}
              actions={{ onOuvrir: (u) => setOuverte(u.id) }}
            />
          </div>
        </>
      )}
    </div>
  );
}

/** Une unité dans une liste : la direction par son sigle, les autres par leur nom. */
const nomCourt = (n: NoeudImport | undefined) =>
  n ? (n.type === 'direction' && n.sigle ? n.sigle : n.nom) : '';

/** La fiche d'une unité de l'organigramme final : son responsable, et ses agents à placer. */
function FicheDUnite({
  noeud: n,
  rapport,
  arbre,
  enCours,
  reglages,
  designer,
  placer,
  onRetour,
}: {
  noeud: NoeudImport;
  rapport: RapportImportEmployes;
  arbre: ReturnType<typeof useArbre>;
  enCours: boolean;
  reglages: Reglages;
  designer: (cle: string, personne: string) => void;
  placer: (ligne: number, unite: string) => void;
  onRetour: () => void;
}) {
  const parent = n.parent ? arbre.parCle.get(n.parent) : undefined;
  const direction = arbre.direction(n.cle);
  // Où placer un agent : sa direction, ses départements, ses services.
  const unites = direction ? arbre.unitesDe(direction) : [n];
  const perimetre = arbre.perimetre(n.cle);
  const agents: AgentImport[] = rapport.agents.filter((a) => perimetre.has(a.unite));
  const question = rapport.unitesSansResponsable.find((u) => u.cle === n.cle);
  const rattachement = parent
    ? `Rattachée ${uniteAvecArticle(
        'à',
        { name: parent.nom, unitType: parent.type, shortName: parent.sigle },
        orgUnitLabel({ name: parent.nom, shortName: parent.sigle }),
      )}`
    : null;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-2.5">
        <Button
          variant="secondary"
          size="sm"
          className="shrink-0"
          aria-label="Revenir à l’organigramme"
          onClick={onRetour}
        >
          <Icon name="chevron_backward" size={18} />
        </Button>
        <div className="min-w-0">
          <p className="text-[15px] leading-tight font-bold text-ink-strong">{n.nom}</p>
          {n.sigle || rattachement ? (
            <p className="mt-1 text-[12px] text-ink-muted">
              {[n.sigle, rattachement].filter(Boolean).join(' · ')}
            </p>
          ) : null}
        </div>
      </div>

      <ModalSection title="Responsable">
        {question ? (
          <div className="flex flex-col gap-1.5">
            <ChoixDuResponsable
              unite={question}
              enCours={enCours}
              valeur={reglages.responsables[question.cle] ?? question.retenu ?? ''}
              designer={designer}
              className="sm:max-w-[26rem]"
            />
            {question.echec ? (
              <p className="text-[11.5px] text-danger">Non désigné : {question.echec}</p>
            ) : null}
          </div>
        ) : n.responsable ? (
          <p className="text-[12.5px] text-ink">
            <b className="text-ink-strong">{n.responsable.nom}</b>
            <span className="text-ink-muted"> · {n.responsable.matricule}</span>
          </p>
        ) : (
          <p className="text-[12.5px] text-ink-muted">Non désigné</p>
        )}
      </ModalSection>

      <ModalSection
        title="Agents"
        extra={<span className="text-[12px] text-ink-muted">{compte(agents.length, 'agent')}</span>}
      >
        {agents.length === 0 ? (
          <p className="text-[12.5px] text-ink-muted">Aucun agent dans cette unité.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line-soft">
            {agents.map((a) => (
              <li
                key={a.cle}
                className="flex flex-col gap-1.5 py-2.5 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:gap-4"
              >
                <span className="min-w-0 flex-1 text-[12.5px] text-ink">
                  <b className="text-ink-strong">{a.nom}</b>
                  <span className="text-ink-muted">
                    {' '}
                    · {a.matricule}
                    {a.poste ? ` · ${a.poste}` : ''}
                  </span>
                </span>
                {a.modifiable && a.ligne !== null && unites.length > 1 ? (
                  <Select
                    aria-label={`Unité de ${a.nom}`}
                    className="sm:w-[20rem]"
                    disabled={enCours}
                    value={reglages.placements[a.ligne] ?? a.unite}
                    onChange={(e) => placer(a.ligne!, e.target.value)}
                  >
                    {unites.map((u) => (
                      <option key={u.cle} value={u.cle}>
                        {nomCourt(u)}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <span className="text-[12.5px] text-ink-muted sm:w-[20rem] sm:text-right">
                    {nomCourt(arbre.parCle.get(a.unite))}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </ModalSection>
    </div>
  );
}

/** Les unités que l'import crée, et les responsables qu'il désigne. */
function UnitesEtResponsables({
  rapport,
  renommer,
}: {
  rapport: RapportImportEmployes;
  renommer: ((unite: UniteCreeeImport, nom: string) => void) | null;
}) {
  const a = rapport.applique;
  if (
    rapport.unitesCreees.length === 0 &&
    rapport.servicesRanges.length === 0 &&
    rapport.designations.length === 0
  ) {
    return null;
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {rapport.unitesCreees.length > 0 ? (
        <div className="rounded-bloc border border-line-soft px-3.5 py-2.5">
          <p className="text-[11.5px] font-bold text-ink-muted">
            {a ? 'Unités créées' : 'Unités à créer'}
          </p>
          <ul
            className={cn(
              'mt-1.5 text-[12.5px] text-ink',
              // Les champs s'alignent d'une ligne à l'autre ; la colonne du
              // rattachement prend la largeur du plus long.
              renommer
                ? 'grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-2'
                : 'flex flex-col gap-1',
            )}
          >
            {rapport.unitesCreees.map((u) =>
              renommer ? (
                // La clé suit le nom : l'aperçu rejoué remet le champ à jour.
                <NomDUnite key={`${u.cle}:${u.nom}`} unite={u} renommer={renommer} />
              ) : (
                <li key={u.cle}>
                  {u.nom} <span className="text-ink-muted">· {u.parent}</span>
                  {u.echec ? (
                    <span className="block text-[11.5px] text-danger">Non créée : {u.echec}</span>
                  ) : null}
                </li>
              ),
            )}
          </ul>
        </div>
      ) : null}
      {rapport.servicesRanges.length > 0 ? (
        <div className="rounded-bloc border border-line-soft px-3.5 py-2.5">
          <p className="text-[11.5px] font-bold text-ink-muted">
            {a ? 'Services déplacés' : 'Services à déplacer'}
          </p>
          <ul className="mt-1.5 flex flex-col gap-1 text-[12.5px] text-ink">
            {rapport.servicesRanges.map((r) => (
              <li key={r.service}>
                {r.service} <span className="text-ink-muted">· {r.departement}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {rapport.designations.length > 0 ? (
        <div className="rounded-bloc border border-line-soft px-3.5 py-2.5">
          <p className="text-[11.5px] font-bold text-ink-muted">
            {a ? 'Responsables désignés' : 'Responsables à désigner'}
          </p>
          <ul className="mt-1.5 flex flex-col gap-1 text-[12.5px] text-ink">
            {rapport.designations.map((d) => (
              <li key={`${d.poste}-${d.nom}`}>
                {d.poste} <span className="text-ink-muted">· {d.nom}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** Le nom d'une unité à créer, à corriger avant l'import. */
function NomDUnite({
  unite,
  renommer,
}: {
  unite: UniteCreeeImport;
  renommer: (unite: UniteCreeeImport, nom: string) => void;
}) {
  const [valeur, setValeur] = useState(unite.nom);
  const valider = () => {
    const nom = valeur.replace(/\s+/g, ' ').trim();
    if (!nom) return setValeur(unite.nom);
    if (nom !== unite.nom) renommer(unite, nom);
  };
  return (
    <li className="col-span-2 grid grid-cols-subgrid items-center">
      <Input
        value={valeur}
        maxLength={120}
        aria-label={`Nom de l’unité à créer sous ${unite.parent}`}
        aria-invalid={unite.echec ? true : undefined}
        onChange={(e) => setValeur(e.target.value)}
        onBlur={valider}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        className={cn('h-9 min-w-0 text-[12.5px]', unite.echec && 'border-danger')}
      />
      <span className="max-w-[11rem] truncate text-ink-muted" title={unite.parent}>
        · {unite.parent}
      </span>
      {unite.echec ? (
        <p className="col-span-2 mt-1 text-[11.5px] text-danger">Non créée : {unite.echec}</p>
      ) : null}
    </li>
  );
}

function Remarque({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[12px] leading-relaxed text-ink-muted">
      <Icon name="error" size={13} className="mr-1 inline align-[-2px]" />
      {children}
    </p>
  );
}

function Chiffre({
  valeur,
  libelle,
  ton,
}: {
  valeur: number;
  libelle: string;
  ton: 'success' | 'warning' | 'danger' | 'neutre';
}) {
  // Un zéro ne s'allume pas : « 0 erreur » en rouge se lit comme une alerte.
  const eteint = valeur === 0;
  return (
    <div className="rounded-bloc border border-line-soft bg-surface-raised/60 px-3.5 py-2.5">
      <p
        className={cn(
          'text-[22px] leading-none font-bold tabular-nums',
          eteint
            ? 'text-ink-muted/50'
            : ton === 'success'
              ? 'text-success'
              : ton === 'warning'
                ? 'text-accent-text'
                : ton === 'danger'
                  ? 'text-danger'
                  : 'text-ink-strong',
        )}
      >
        {valeur}
      </p>
      <p className="mt-1 text-[11px] leading-tight text-ink-muted">{libelle}</p>
    </div>
  );
}
