'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import type { LigneImport, RapportImportEmployes } from '@teranga/contracts';
import { Badge, Button, cn, Table, TBody, Td, Th, THead, Tr } from '@teranga/ui';
import { api, ApiError } from '../lib/api';
import { compte } from '../lib/mots';
import { Icon } from './icons';
import { Modal, ModalSection } from './modal';

/* ————————————————————————————————————————————————————————————————
   Importer l'effectif depuis le classeur du RH.

   Saisir trois cents dossiers à la main, c'est trois cents fois quinze
   champs. Le fichier existe déjà — il est tenu à jour depuis des années —,
   et c'est lui qui doit remplir la plateforme.

   ——— On montre AVANT d'écrire

   Trois temps : on dépose, on LIT ce que la plateforme a compris, on
   applique. Le temps du milieu n'est pas une politesse : un import qui
   écrirait d'emblée trois cents dossiers à partir d'une colonne mal lue
   demanderait trois cents corrections. L'aperçu ne touche pas la base — le
   serveur lit, traduit, vérifie et rend son compte rendu.

   Le compte rendu est le MÊME tableau avant et après : ce qu'on a approuvé
   est ce qu'on relit, avec le résultat de chaque ligne. Une ligne refusée
   nomme sa ligne du fichier ET sa colonne, parce que la correction se fait
   dans le tableur, pas ici.
   ———————————————————————————————————————————————————————————————— */

type Etape = 'depot' | 'apercu' | 'fait';

const TONS: Record<LigneImport['etat'], 'success' | 'warning' | 'danger'> = {
  'a-creer': 'success',
  ignore: 'warning',
  erreur: 'danger',
};

/**
 * Le mot de l'état — et il change de temps une fois l'import appliqué.
 *
 * Le même tableau se relit après coup : une ligne qui annoncerait encore « À
 * créer » sous un compte rendu disant « 10 dossiers créés » ferait douter de
 * ce qui a réellement été écrit.
 */
function motDeLEtat(etat: LigneImport['etat'], applique: boolean): string {
  if (etat === 'a-creer') return applique ? 'Créé' : 'À créer';
  return etat === 'ignore' ? 'Ignorée' : 'Erreur';
}

export function FenetreImportEmployes({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [etape, setEtape] = useState<Etape>('depot');
  const [fichier, setFichier] = useState<File | null>(null);
  const [rapport, setRapport] = useState<RapportImportEmployes | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [survol, setSurvol] = useState(false);

  const envoyer = async (f: File, apercu: boolean) => {
    setEnCours(true);
    setErreur(null);
    try {
      const r = await api<RapportImportEmployes>(`/employees/import${apercu ? '?apercu=1' : ''}`, {
        method: 'POST',
        body: f,
      });
      setRapport(r);
      setEtape(apercu ? 'apercu' : 'fait');
      if (!apercu) {
        await queryClient.invalidateQueries({ queryKey: ['employees'] });
        await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        await queryClient.invalidateQueries({ queryKey: ['org-units'] });
        // Dix dossiers importés sans n+1, c'est dix anomalies de plus : le
        // bandeau doit le dire avant qu'on quitte l'écran.
        await queryClient.invalidateQueries({ queryKey: ['hierarchie-controle'] });
      }
    } catch (err) {
      setErreur(err instanceof ApiError ? err.message : 'Lecture impossible — réessayez.');
    } finally {
      setEnCours(false);
    }
  };

  /**
   * Ce qu'on refuse SANS demander au serveur.
   *
   * Le sélecteur de fichiers filtre déjà sur `.xlsx`, mais un glisser-déposer
   * ne filtre rien : on y traîne un PDF, un .csv, un dossier entier. Deux
   * douze-mégaoctets de PDF qui partent pour revenir en 422 sont deux
   * douze-mégaoctets de réseau perdus, et la réponse arrive une demi-minute
   * plus tard sur une connexion ordinaire.
   */
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
        `Ce fichier pèse ${(f.size / 1024 / 1024).toFixed(1)} Mo, au-delà des 12 Mo acceptés. Retirez les feuilles et les images inutiles, ou importez l’effectif en deux fois.`,
      );
    }
    setFichier(f);
    void envoyer(f, true);
  };

  const bloquant = rapport !== null && rapport.colonnesManquantes.length > 0;

  return (
    <Modal
      open
      onClose={onClose}
      title="Importer un fichier d’employés"
      subtitle={
        etape === 'depot' ? (
          'Le classeur de la Direction du Capital Humain, tel qu’il est tenu.'
        ) : (
          // La feuille est NOMMÉE : le classeur en porte souvent plusieurs
          // (« Actifs », « Départs », « Brouillon »), et la RH doit voir
          // laquelle a été lue avant d'approuver l'écriture.
          <p className="mt-0.5 truncate text-xs text-ink-muted">
            {fichier?.name}
            {rapport ? ` · feuille « ${rapport.feuille} »` : ''}
          </p>
        )
      }
      maxWidth="max-w-4xl"
      footer={
        etape === 'apercu' && rapport ? (
          <>
            <Button variant="secondary" onClick={() => setEtape('depot')}>
              Changer de fichier
            </Button>
            <Button
              loading={enCours}
              disabled={rapport.aCreer === 0 || bloquant}
              onClick={() => fichier && void envoyer(fichier, false)}
            >
              {rapport.aCreer === 0
                ? 'Rien à importer'
                : `Importer ${compte(rapport.aCreer, 'dossier')}`}
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
          className="mb-4 rounded-[10px] bg-danger-soft px-3.5 py-2.5 text-[12.5px] font-semibold text-danger"
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
              'flex cursor-pointer flex-col items-center gap-2 rounded-[14px] border border-dashed px-6 py-10 text-center transition-colors focus-within:ring-2 focus-within:ring-primary/40',
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
              {enCours ? 'Lecture du fichier…' : 'Déposez le classeur, ou cliquez pour le choisir'}
            </span>
            <span className="text-[12px] text-ink-muted">
              Classeur .xlsx · la première feuille est lue · 12 Mo maximum
            </span>
          </label>

          <ModalSection title="Ce que le fichier doit contenir">
            <p className="text-[12.5px] leading-relaxed text-ink">
              Une ligne par agent, et une première ligne d’intitulés. Quatre colonnes sont
              indispensables — <b>Prénom</b>, <b>Nom</b>, <b>Matricule</b>, <b>Début du contrat</b>{' '}
              ; les autres sont reprises si elles sont là.
            </p>
            <p className="mt-2 text-[12px] leading-relaxed text-ink-muted">
              Les intitulés se reconnaissent sans tenir compte des accents ni de la casse, et
              l’ordre des colonnes n’a pas d’importance. La direction se désigne par son abrégé («
              DCH ») ou par son nom complet. Rien n’est écrit avant que vous ne validiez l’aperçu.
            </p>
          </ModalSection>
        </>
      ) : null}

      {etape !== 'depot' && rapport ? <Compte rapport={rapport} /> : null}
    </Modal>
  );
}

/** Le compte rendu : les totaux d'abord, le détail ensuite. */
function Compte({ rapport }: { rapport: RapportImportEmployes }) {
  const bloquant = rapport.colonnesManquantes.length > 0;
  return (
    <div className="flex flex-col gap-4">
      {bloquant ? (
        <p
          role="alert"
          className="rounded-[10px] bg-danger-soft px-3.5 py-3 text-[12.5px] leading-relaxed text-danger"
        >
          <b>Ce fichier ne peut pas être importé.</b> Colonne
          {rapport.colonnesManquantes.length > 1 ? 's' : ''} absente
          {rapport.colonnesManquantes.length > 1 ? 's' : ''} :{' '}
          {rapport.colonnesManquantes.join(', ')}. Ajoutez-les à la première ligne du classeur.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Chiffre
            valeur={rapport.applique ? rapport.crees : rapport.aCreer}
            libelle={rapport.applique ? 'dossiers créés' : 'dossiers à créer'}
            ton="success"
          />
          <Chiffre valeur={rapport.ignores} libelle="lignes ignorées" ton="neutre" />
          <Chiffre valeur={rapport.erreurs} libelle="lignes en erreur" ton="danger" />
          {/* L'orange pour le SEUL chiffre qui laisse du travail : ces agents
              entrent sans direction, et quelqu'un devra les rattacher. Une
              ligne ignorée, elle, n'attend rien — le dossier existe déjà et
              reste intact. */}
          <Chiffre valeur={rapport.sansUnite} libelle="sans rattachement" ton="warning" />
        </div>
      )}

      {rapport.colonnesInconnues.length > 0 ? (
        <p className="text-[12px] leading-relaxed text-ink-muted">
          <Icon name="error" size={13} className="mr-1 inline align-[-2px]" />
          {compte(rapport.colonnesInconnues.length, 'colonne')} du fichier n’
          {rapport.colonnesInconnues.length > 1 ? 'ont' : 'a'} pas d’équivalent et{' '}
          {rapport.colonnesInconnues.length > 1 ? 'sont ignorées' : 'est ignorée'} :{' '}
          {rapport.colonnesInconnues.join(', ')}.
        </p>
      ) : null}

      {rapport.lignes.length > 0 ? (
        // Le tableau défile : trois cents lignes ne tiennent pas dans une
        // fenêtre, et l'on veut pouvoir chercher SA ligne.
        <div className="max-h-[22rem] overflow-auto rounded-[12px] border border-line-soft">
          <Table>
            <THead>
              <tr>
                <Th className="w-14 text-right">Ligne</Th>
                <Th>Matricule</Th>
                <Th>Nom</Th>
                {/* Sous 768 px, le poste et la direction sortent : c'est
                    l'ÉTAT qu'on vient lire, et il ne doit pas se trouver hors
                    de l'écran. Le motif d'un abrégé introuvable le nomme de
                    toute façon en clair. */}
                <Th className="hidden md:table-cell">Poste</Th>
                <Th className="hidden md:table-cell">Direction</Th>
                <Th>État</Th>
              </tr>
            </THead>
            <TBody>
              {rapport.lignes.map((l) => (
                <Fragment key={l.ligne}>
                  <Tr>
                    <Td className="text-right font-mono text-[11.5px] text-ink-muted tabular-nums">
                      {l.ligne}
                    </Td>
                    <Td className="font-mono text-[11.5px] whitespace-nowrap">
                      {l.matricule ?? '—'}
                    </Td>
                    <Td className="font-semibold text-ink-strong">{l.nom ?? '—'}</Td>
                    <Td className="hidden text-ink-muted md:table-cell">{l.poste ?? '—'}</Td>
                    <Td className="hidden whitespace-nowrap md:table-cell">
                      {l.uniteResolue ? (
                        <span title={l.uniteResolue}>{l.uniteAbrege ?? l.uniteResolue}</span>
                      ) : l.uniteAbrege ? (
                        // L'abrégé s'allume quand il laisse un dossier sans
                        // rattachement — pas sur une ligne qu'on n'écrit pas.
                        <span
                          className={cn(l.etat === 'a-creer' && 'text-accent-text')}
                          title={l.etat === 'a-creer' ? 'Abrégé inconnu' : undefined}
                        >
                          {l.uniteAbrege}
                        </span>
                      ) : (
                        <span className="text-ink-muted/60">—</span>
                      )}
                    </Td>
                    <Td>
                      <span className="flex flex-col items-start gap-1">
                        <Badge tone={TONS[l.etat]} className="whitespace-nowrap">
                          {motDeLEtat(l.etat, rapport.applique)}
                        </Badge>
                        {/* Le motif tient dans la colonne quand l'écran est
                            large ; sous 768 px il passe à la ligne suivante,
                            en pleine largeur. Serré dans un cinquième de
                            390 px, il se hachait sur huit lignes. */}
                        {l.motif ? (
                          <span className="hidden text-[11px] leading-snug text-ink-muted md:inline">
                            {l.colonne ? <b>{l.colonne} — </b> : null}
                            {l.motif}
                          </span>
                        ) : null}
                      </span>
                    </Td>
                  </Tr>
                  {l.motif ? (
                    <tr className="md:hidden">
                      <td colSpan={4} className="px-4 pb-3 text-[11px] leading-snug text-ink-muted">
                        {l.colonne ? <b>{l.colonne} — </b> : null}
                        {l.motif}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </TBody>
          </Table>
        </div>
      ) : null}
    </div>
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
    <div className="rounded-[12px] border border-line-soft bg-surface-raised/60 px-3.5 py-2.5">
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
