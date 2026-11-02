'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import {
  CHOIX_AUCUN,
  type ChoixImport,
  type InviterPlusieursResult,
  type LigneImport,
  type RapportImportEmployes,
} from '@teranga/contracts';
import { Badge, Button, Checkbox, cn, Select, Table, TBody, Td, Th, THead, Tr } from '@teranga/ui';
import { api, ApiError } from '../lib/api';
import { compte } from '../lib/mots';
import { Icon } from './icons';
import { Modal, ModalSection } from './modal';
import { Onglets } from './onglets';
import { Pagination, usePagination } from './pagination';

/* ────────────────────────────────────────────────────────────────
   Importer le fichier du personnel de la DCH (ADR-0159).

   Trois temps : on dépose, on lit ce que l'import fera, on applique.
   L'aperçu joue l'import en entier puis l'annule : ce qu'il annonce, refus
   compris, est ce que l'import fera. Le compte rendu est le même tableau
   avant et après, relu avec le résultat de chaque ligne.

   Un nom de N+1 porté par deux personnes se départage ici, avant l'import :
   une fois tous les noms départagés, l'aperçu se rejoue et montre les
   rattachements retenus.
   ──────────────────────────────────────────────────────────────── */

type Etape = 'depot' | 'apercu' | 'fait';
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
  // Les homonymes départagés, renvoyés avec le fichier à chaque envoi.
  const [departages, setDepartages] = useState<Record<string, string>>({});
  // Après l'import, l'invitation au portail des fiches créées.
  const [invitations, setInvitations] = useState<Set<string>>(new Set());
  const [invites, setInvites] = useState<InviterPlusieursResult | null>(null);
  const creees = (rapport?.lignes ?? []).filter(
    (l): l is LigneImport & { employeeId: string } => l.etat === 'a-creer' && Boolean(l.employeeId),
  );

  const envoyer = async (f: File, apercu: boolean, choix: Record<string, string>) => {
    setEnCours(true);
    setErreur(null);
    try {
      const parametres = new URLSearchParams();
      if (apercu) parametres.set('apercu', '1');
      if (Object.keys(choix).length > 0) parametres.set('choix', JSON.stringify(choix));
      const suite = parametres.toString();
      const r = await api<RapportImportEmployes>(`/employees/import${suite ? `?${suite}` : ''}`, {
        method: 'POST',
        body: f,
      });
      setRapport(r);
      setEtape(apercu ? 'apercu' : 'fait');
      if (!apercu) {
        setInvitations(
          new Set(
            r.lignes
              .filter((l) => l.etat === 'a-creer' && l.employeeId && l.emailPro)
              .map((l) => l.employeeId!),
          ),
        );
        await queryClient.invalidateQueries({ queryKey: ['employees'] });
        await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        await queryClient.invalidateQueries({ queryKey: ['org-units'] });
        await queryClient.invalidateQueries({ queryKey: ['hierarchie-controle'] });
      }
    } catch (err) {
      setErreur(err instanceof ApiError ? err.message : 'Lecture impossible, réessayez.');
    } finally {
      setEnCours(false);
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
    setDepartages({});
    void envoyer(f, true, {});
  };

  const restants = (choix: Record<string, string>) =>
    (rapport?.choix ?? []).filter((c) => !(choix[c.cle] ?? c.retenu)).length;
  // L'aperçu se rejoue une fois tous les noms départagés, pas à chaque choix :
  // sur trois cents agents, il prend quelques secondes.
  const departager = (cle: string, candidat: string) => {
    const suite = { ...departages, [cle]: candidat };
    setDepartages(suite);
    if (fichier && restants(suite) === 0) void envoyer(fichier, true, suite);
  };

  const bloquant = rapport !== null && rapport.colonnesManquantes.length > 0;
  const aDepartager = restants(departages);
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
      title="Importer un fichier d’employés"
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
      maxWidth="max-w-5xl"
      footer={
        etape === 'apercu' && rapport ? (
          <>
            <Button variant="secondary" onClick={() => setEtape('depot')}>
              Changer de fichier
            </Button>
            <Button
              loading={enCours}
              disabled={aEcrire === 0 || bloquant || aDepartager > 0}
              onClick={() => fichier && void envoyer(fichier, false, departages)}
            >
              {aEcrire === 0 ? 'Rien à importer' : `Importer ${compte(aEcrire, 'fiche')}`}
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
      {etape !== 'depot' && rapport ? (
        <Compte
          rapport={rapport}
          enCours={enCours}
          departages={departages}
          departager={etape === 'apercu' ? departager : null}
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
  departages,
  departager,
}: {
  rapport: RapportImportEmployes;
  enCours: boolean;
  departages: Record<string, string>;
  departager: ((cle: string, candidat: string) => void) | null;
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

      {departager && rapport.choix.length > 0 ? (
        <Departages
          choix={rapport.choix}
          enCours={enCours}
          departages={departages}
          departager={departager}
        />
      ) : null}

      <Organigramme rapport={rapport} />

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
          Non importées, à saisir sur la fiche : {rapport.colonnesNonImportees.join(', ')}.
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

/** Les unités que l'import crée, et les responsables qu'il désigne. */
function Organigramme({ rapport }: { rapport: RapportImportEmployes }) {
  const a = rapport.applique;
  if (rapport.unitesCreees.length === 0 && rapport.designations.length === 0) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {rapport.unitesCreees.length > 0 ? (
        <div className="rounded-bloc border border-line-soft px-3.5 py-2.5">
          <p className="text-[11.5px] font-bold text-ink-muted">
            {a ? 'Unités créées' : 'Unités à créer'}
          </p>
          <ul className="mt-1.5 flex flex-col gap-1 text-[12.5px] text-ink">
            {rapport.unitesCreees.map((u) => (
              <li key={`${u.parent}-${u.nom}`}>
                {u.nom} <span className="text-ink-muted">· {u.parent}</span>
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
