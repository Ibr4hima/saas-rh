'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type {
  BalanceView,
  EmployeeBatchResult,
  EmployeeDetail,
  EmployeeHistoryEntry,
  InviteResult,
} from '@teranga/contracts';
import { peut, titreDeLaFiche } from '@teranga/contracts';
import {
  Badge,
  Button,
  Card,
  cn,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
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
import { api, ApiError } from '../lib/api';
import { CarteCertificatsAgent } from './academy-certificat';
import { CarteEvaluationsAgent } from './evaluation-objectifs';
import { EmployeeDocumentsCard } from './employee-documents-card';
import { ProfileChangeCard } from './profile-change-card';
import { EmployeeEditModal } from './employee-edit-modal';
import { Telephone } from './telephone';
import { Donnee, EnTete, Groupe, Peremption, Repere } from './fiche';
import { Icon } from './icons';
import { Modal } from './modal';
import { contractEnd, ID_DOCUMENT_LABELS, maritalLabels, SEX_LABELS } from '../lib/person';
import { formatDate, useMe } from '../lib/hooks';
import { aujourdhui } from '../lib/temps';
import type { ConsequencesHierarchie, OrgUnit, OrgUnitView } from '@teranga/contracts';
import { aDesConsequences, ListeConsequences } from './consequences-hierarchie';
import { n1DOffice, useResponsablesPossibles } from '../lib/responsables';
import { LoadFailure } from './load-failure';
import { Page } from './gabarit';
import { FenetreSignalement, SuiviSignalements } from './signalement';

const STATUS_LABELS: Record<string, string> = {
  active: 'Actif',
  archived: 'Inactif',
};
const CONTRACT_LABELS: Record<string, string> = {
  cdi: 'CDI',
  cdd: 'CDD',
  stage: 'Stage',
  consultant: 'Consultant',
  detachement: 'Détachement',
};
/** Un nouveau contrat : consultant et détachement ne se signent plus. */
const TYPES_DE_NOUVEAU_CONTRAT = ['cdi', 'cdd', 'stage'] as const;
const ACTION_LABELS: Record<string, string> = {
  INSERT: 'Création',
  UPDATE: 'Modification',
  DELETE: 'Suppression',
};
const TABLE_LABELS: Record<string, string> = {
  employees: 'Dossier employé',
  persons: 'État civil',
  assignments: 'Affectation',
  contracts: 'Contrat',
};

/** La borne haute d'un daterange est exclusive : le dernier jour est la veille. */
function lastDay(exclusiveEnd: string): string {
  const d = new Date(`${exclusiveEnd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Ancienneté en clair : « 3 ans et 2 mois », pas une date à soustraire. Les
 * intervalles entre un départ et un retour n'en font pas partie.
 */
function seniority(
  hiredOn: string,
  jusquAu: string | null,
  interruptions: EmployeeDetail['interruptions'],
): string {
  const JOUR = 1000 * 60 * 60 * 24;
  const t = (iso: string) => new Date(`${iso}T12:00:00Z`).getTime();
  // Inactif : l'ancienneté s'arrête à son dernier jour, pas à aujourd'hui.
  const fin = jusquAu ? t(jusquAu) : Date.now();
  const absent = interruptions.reduce(
    (total, i) => total + Math.max(0, t(i.repriseLe) - t(i.dernierJour) - JOUR),
    0,
  );
  const months = Math.max(0, (fin - t(hiredOn) - absent) / (JOUR * 30.44));
  const years = Math.floor(months / 12);
  const rest = Math.floor(months % 12);
  if (years === 0) return rest <= 1 ? '< 1 mois' : `${rest} mois`;
  const y = `${years} an${years > 1 ? 's' : ''}`;
  return rest === 0 ? y : `${y} et ${rest} mois`;
}

/** « 30 octobre 2026 ». */
const dateLongue = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

/**
 * La fiche d'un agent. `soi` : l'agent la lit dans son espace personnel —
 * « Mes infos personnelles » — la même fiche, sans les gestes de gestion, et
 * « Signaler un changement » à la place du stylo.
 */
export function FicheEmploye({ id, soi = false }: { id: string; soi?: boolean }) {
  const router = useRouter();
  // Même convention que la création : l'ouverture vit dans l'URL, si bien que
  // le bouton de la barre supérieure reste un lien et que Retour referme.
  const editOpen = useSearchParams().get('modifier') !== null;
  const [refusReactivation, setRefusReactivation] = useState<string | null>(null);
  const [signalement, setSignalement] = useState(false);
  const me = useMe();
  // Dans l'espace personnel, rien de la gestion : ni l'historique du dossier,
  // ni les signalements à traiter — même pour un membre de la DCH.
  const canSeeHistory = !soi && peut(me.data, 'personnel.consulter');
  /** Ce qui se lit de son propre dossier comme de celui d'un autre, pour qui le consulte. */
  const voitLeDossier = soi || canSeeHistory;
  /** Plus en activité : ses objectifs et l'Academy lui sont fermés jusqu'à la fin de son accès. */
  const finDAcces = soi ? (me.data?.finDAcces ?? null) : null;

  const detail = useQuery({
    queryKey: ['employee', id],
    queryFn: () => api<EmployeeDetail>(`/employees/${id}`),
  });
  const history = useQuery({
    queryKey: ['employee-history', id],
    queryFn: () => api<EmployeeHistoryEntry[]>(`/employees/${id}/history`),
    enabled: Boolean(canSeeHistory),
  });

  if (detail.isLoading) {
    return (
      <Page>
        <Skeleton className="mb-4 h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </Page>
    );
  }
  if (detail.isError) {
    return <LoadFailure error={detail.error} onRetry={() => void detail.refetch()} />;
  }
  const e = detail.data!;
  const current = e.assignments.find((a) => a.current);
  // Aucune habilitation de gestion ne s'applique à SON dossier : ce qui le
  // concerne passe par ses demandes, traitées par quelqu'un d'autre.
  const peutGerer = !soi && peut(me.data, 'personnel.gerer') && !e.soi;
  // Un agent inactif n'a ni portail, ni affectation nouvelle : sa fiche se
  // consulte, son contrat se renouvelle, et le dossier se réactive.
  const actif = e.status === 'active';

  return (
    <Page>
      <EmployeeEditModal
        open={!soi && editOpen && actif}
        employeeId={id}
        onClose={() => router.replace(`/employees/${id}`)}
      />
      {signalement ? (
        <FenetreSignalement employe={e} onClose={() => setSignalement(false)} />
      ) : null}
      {soi ? null : (
        // Le retour mène à l'onglet où se range le dossier : un inactif se
        // retrouve parmi les inactifs, pas en tête des actifs.
        <Link
          href={actif ? '/employees' : '/employees?onglet=inactifs'}
          className="mb-3 inline-flex items-center gap-1 text-[11.5px] font-semibold text-ink-muted transition-colors hover:text-primary"
        >
          ← Gestion du personnel
        </Link>
      )}
      {e.soi && !soi ? (
        <p className="mb-3 flex shrink-0 items-center gap-2 rounded-[12px] bg-primary/[0.06] px-3.5 py-2.5 text-[12.5px] text-ink">
          <Icon name="lock" size={16} className="shrink-0 text-primary" />
          <span className="min-w-0 flex-1">
            Vous ne pouvez pas modifier votre dossier personnel. Toute demande de modification se
            fait dans votre{' '}
            <Link href="/moi" className="font-semibold text-primary hover:underline">
              espace personnel
            </Link>
            .
          </span>
        </p>
      ) : null}
      {finDAcces ? (
        <p className="mb-3 flex shrink-0 items-center gap-2 rounded-[12px] bg-primary/[0.06] px-3.5 py-2.5 text-[12.5px] text-ink">
          <Icon name="schedule" size={16} className="shrink-0 text-primary" />
          <span className="min-w-0 flex-1">
            Votre accès au portail prend fin le {dateLongue(finDAcces)}.
          </span>
        </p>
      ) : null}

      {/* ———— Bande d'identité ————
          Ce qui permet de reconnaître un dossier en une seconde : le nom,
          l'état, le matricule, le poste, et les quatre repères qu'on cherche
          systématiquement. Le reste de la fiche approfondit ; cette bande
          identifie, et rien d'autre.

          Plus de cartouche d'initiales. Deux lettres dans un carré ne
          reconnaissent personne — le nom est écrit juste à côté, en vingt-deux
          pixels — et ce cartouche poussait toute la ligne vers la droite. Un
          avatar mérite sa place le jour où il porte une photographie.

          Les quatre repères ont aussi quitté leurs boîtes teintées : quatre
          cadres bleus alignés pesaient plus lourd que les valeurs qu'ils
          portaient. Un filet d'un pixel entre les colonnes sépare aussi bien,
          et rend son blanc à la carte. */}
      <EnTete
        titre={`${e.person.givenName} ${e.person.familyName}`}
        // L'état en un signe : vérifié, en vert, pour un agent actif ; barré,
        // en gris, pour un inactif. Le mot reste pour les lecteurs d'écran et
        // dans l'infobulle.
        marque={
          <span
            role="img"
            aria-label={STATUS_LABELS[e.status] ?? e.status}
            title={STATUS_LABELS[e.status] ?? e.status}
            className={cn('inline-flex', actif ? 'text-success' : 'text-ink-muted')}
          >
            <Icon name={actif ? 'verified' : 'verified_off'} size={22} />
          </span>
        }
        // Sous le nom, les deux choses qui désignent la personne dans une
        // conversation : le matricule qu'on cite au téléphone, et le poste
        // qu'on occupe. La direction, elle, a sa colonne.
        sousTitre={
          <>
            <span className="font-mono tracking-tight">{e.employeeNumber}</span>
            {actif && current?.positionTitle ? <> · {current.positionTitle}</> : null}
          </>
        }
        note={
          refusReactivation ? (
            <p role="alert" className="mt-2 text-[12px] font-semibold text-danger">
              {refusReactivation}
            </p>
          ) : null
        }
        // Inactif : sa fiche ne se modifie plus — le geste qui reste est de la
        // réactiver, une fois son nouveau contrat enregistré.
        action={
          soi ? (
            <Button variant="secondary" size="sm" onClick={() => setSignalement(true)}>
              <Icon name="edit" size={15} />
              Signaler un changement
            </Button>
          ) : peutGerer && !actif ? (
            <BoutonReactiver employe={e} onRefus={setRefusReactivation} />
          ) : peutGerer ? (
            <Link
              href={`/employees/${e.id}?modifier=1`}
              aria-label="Modifier la fiche"
              title="Modifier la fiche"
              className="flex size-9 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-ink-muted transition-colors duration-200 hover:border-primary/40 hover:bg-primary/[0.06] hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
            >
              <Icon name="edit" size={18} />
            </Link>
          ) : null
        }
        reperes={
          /* L'ABRÉGÉ, comme dans la colonne « Unité » de la liste : « DIPE »
              tient sur une ligne où « Direction de l'Intelligence et des
              Perspectives Économiques » se coupait en deux et finissait en
              points de suspension. Le nom complet reste en infobulle, et
              l'unité d'affectation exacte — département ou service — se lit
              juste en dessous dans la carte des affectations. */
          actif ? (
            <>
              <Repere
                label="Direction affectée"
                titre={current?.directionName ?? current?.orgUnitName ?? undefined}
                // Repli en cascade : l'abrégé, sinon le nom de la direction, sinon
                // l'unité elle-même — une direction dont l'abrégé n'est pas
                // renseigné vaut mieux qu'un « Service Comptabilité » qui ne
                // répond pas à la question posée par l'intitulé.
                valeur={
                  current?.directionShortName ?? current?.directionName ?? current?.orgUnitName
                }
              />
              <Repere
                label="Téléphone portable"
                titre={e.person.phone ?? undefined}
                valeur={e.person.phone ? <Telephone valeur={e.person.phone} /> : null}
              />
              <Repere
                label="Email professionnel"
                titre={e.workEmail ?? undefined}
                valeur={
                  e.workEmail ? (
                    // Comme le numéro juste avant : une adresse qu'on ne peut
                    // que recopier à la main est la seule donnée inerte d'une
                    // bande qui sert à joindre quelqu'un.
                    <a
                      href={`mailto:${e.workEmail}`}
                      className="break-all transition-colors hover:text-primary hover:underline"
                    >
                      {e.workEmail}
                    </a>
                  ) : null
                }
              />
              <Repere label="Ancienneté" valeur={seniority(e.hiredOn, null, e.interruptions)}>
                {e.interruptions.length > 0
                  ? `Retour le ${formatDate(e.interruptions[e.interruptions.length - 1]!.repriseLe)}`
                  : `Depuis le ${formatDate(e.hiredOn)}`}
              </Repere>
            </>
          ) : (
            // Inactif : quand son contrat a pris fin et pourquoi, puis ce
            // qu'il a fait à l'APIX — l'ancienneté arrêtée à son dernier jour.
            <>
              <Repere
                label="Fin contrat"
                valeur={e.finActivite ? formatDate(e.finActivite) : null}
              />
              <Repere
                label="Ancienneté"
                valeur={seniority(e.hiredOn, e.finActivite, e.interruptions)}
              >
                Arrivée le {formatDate(e.hiredOn)}
              </Repere>
              <Repere
                label="Email professionnel"
                titre={e.workEmail ?? undefined}
                valeur={
                  e.workEmail ? (
                    // Comme le numéro juste avant : une adresse qu'on ne peut
                    // que recopier à la main est la seule donnée inerte d'une
                    // bande qui sert à joindre quelqu'un.
                    <a
                      href={`mailto:${e.workEmail}`}
                      className="break-all transition-colors hover:text-primary hover:underline"
                    >
                      {e.workEmail}
                    </a>
                  ) : null
                }
              />
              <Repere
                label="Téléphone portable"
                titre={e.person.phone ?? undefined}
                valeur={e.person.phone ? <Telephone valeur={e.person.phone} /> : null}
              />
            </>
          )
        }
      />

      {/* Deux colonnes sur grand écran : à gauche ce qui décrit la personne
          et son emploi, à droite ce qui s'administre — accès, soldes, traces.
          En une colonne, la fiche demandait quatre écrans de défilement. */}
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>État civil et contact</CardTitle>
            </CardHeader>
            {/* Un peu d'air avant la première section : le titre de la carte et
                celui de la section sont tous deux en petites capitales, et
                collés ils se lisaient comme un seul bloc de deux lignes. */}
            <CardContent className="flex flex-col gap-7 pt-2">
              <Groupe titre="Identité">
                <Donnee label="Sexe">{e.person.gender ? SEX_LABELS[e.person.gender] : null}</Donnee>
                <Donnee label="Date de naissance">
                  {e.person.birthDate ? formatDate(e.person.birthDate) : null}
                </Donnee>
                <Donnee label="Pays de naissance">{e.person.birthPlace}</Donnee>
                <Donnee label="Situation matrimoniale">
                  {e.person.maritalStatus
                    ? maritalLabels(e.person.gender)[e.person.maritalStatus]
                    : null}
                </Donnee>
              </Groupe>

              <Groupe titre="Pièce d'identité">
                <Donnee label="Type de pièce d'identité">
                  {e.person.idDocumentType
                    ? (ID_DOCUMENT_LABELS[e.person.idDocumentType] ?? e.person.idDocumentType)
                    : null}
                </Donnee>
                <Donnee label="Numéro de la pièce">
                  {e.person.nationalId ? (
                    <span className="font-mono">{e.person.nationalId}</span>
                  ) : null}
                </Donnee>
                <Donnee label="Date de délivrance">
                  {e.person.idDocumentIssuedOn ? formatDate(e.person.idDocumentIssuedOn) : null}
                </Donnee>
                <Donnee label="Date d'expiration">
                  {e.person.idDocumentExpiresOn ? (
                    <>
                      {formatDate(e.person.idDocumentExpiresOn)}
                      <Peremption date={e.person.idDocumentExpiresOn} />
                    </>
                  ) : null}
                </Donnee>
              </Groupe>

              <Groupe titre="Coordonnées">
                <Donnee label="Téléphone">
                  {e.person.phone ? <Telephone valeur={e.person.phone} /> : null}
                </Donnee>
                <Donnee label="Téléphone professionnel">
                  {e.workPhone ? <Telephone valeur={e.workPhone} /> : null}
                </Donnee>
                {/* Écrire à quelqu'un est le geste qu'on veut permettre, comme
                    l'appeler : le numéro est déjà un lien `tel:` (cf.
                    components/telephone.tsx), l'adresse devient un `mailto:`
                    avec le même survol. */}
                <Donnee label="Email personnel">
                  {e.person.personalEmail ? (
                    <a
                      href={`mailto:${e.person.personalEmail}`}
                      className="break-all transition-colors hover:text-primary hover:underline"
                    >
                      {e.person.personalEmail}
                    </a>
                  ) : null}
                </Donnee>
                <Donnee label="Adresse" large>
                  {e.person.addressLine}
                </Donnee>
              </Groupe>
            </CardContent>
          </Card>

          <AssignmentsCard
            employeeId={e.id}
            assignments={e.assignments}
            team={e.team}
            managerId={e.managerId}
            canManage={peutGerer && actif}
          />

          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle>Contrats</CardTitle>
              {peutGerer ? (
                <NouveauContrat
                  employeeId={e.id}
                  prenom={e.person.givenName}
                  contrats={e.contracts}
                />
              ) : null}
            </CardHeader>
            {e.contracts.length === 0 ? (
              <CardContent>
                <p className="text-sm text-ink-muted">Aucun contrat enregistré.</p>
              </CardContent>
            ) : (
              <Table>
                <THead>
                  <tr>
                    <Th>Type</Th>
                    <Th>Début</Th>
                    <Th>Fin</Th>
                    {peutGerer ? (
                      <Th>
                        <span className="sr-only">Actions</span>
                      </Th>
                    ) : null}
                  </tr>
                </THead>
                <TBody>
                  {e.contracts.map((c, i) => (
                    <Tr key={c.id}>
                      <Td className="font-medium text-ink-strong">
                        {CONTRACT_LABELS[c.contractType] ?? c.contractType}
                      </Td>
                      <Td>{formatDate(c.startDate)}</Td>
                      <Td>{c.endDate ? formatDate(c.endDate) : null}</Td>
                      {peutGerer ? (
                        <Td className="text-right">
                          {/* Le plus récent d'abord : seul le dernier se corrige. */}
                          {i === 0 ? <CorrectionContrat employeeId={e.id} contrat={c} /> : null}
                        </Td>
                      ) : null}
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>

          {/* Les semestres évalués par le n+1, dès la validation : l'agent et
              le directeur du Capital Humain, eux seuls. */}
          {(soi || me.data?.dirigeLaDCH) && !finDAcces ? (
            <CarteEvaluationsAgent employeeId={e.id} />
          ) : null}

          {/* En tête des cartes de gauche : c'est ce qui attend une décision. */}
          {canSeeHistory ? <ProfileChangeCard employeeId={e.id} /> : null}

          {voitLeDossier ? (
            <EmployeeDocumentsCard
              employeeId={e.id}
              // On dépose ses documents depuis son espace personnel, pas d'ici.
              depot={soi}
              soi={e.soi}
              pieceAttendue={titreDeLaFiche(e.person.idDocumentType)}
            />
          ) : null}

          {voitLeDossier && !finDAcces ? <CarteCertificatsAgent employeeId={e.id} /> : null}

          {/* Les soldes sont un TABLEAU : ils appartiennent à la colonne large.
              Serrés dans le tiers de droite, leurs colonnes débordaient. */}
          <BalancesCard employeeId={e.id} />
        </div>

        {/* ———— Colonne d'administration : accès et traces — pour l'agent
            sur sa propre fiche, le suivi de ses signalements. ———— */}
        <div className="flex min-w-0 flex-col gap-4">
          {soi ? <SuiviSignalements /> : null}

          {/* Inactif : pas d'accès au portail, donc rien à lui transmettre. */}
          {peutGerer && actif ? (
            <PortalCard
              employeeId={e.id}
              portal={e.portal}
              prenom={e.person.givenName}
              gender={e.person.gender}
            />
          ) : null}

          {canSeeHistory ? <CarteHistorique history={history} /> : null}
        </div>
      </div>
    </Page>
  );
}

/**
 * L'historique des modifications, PLIÉ par défaut : on le consulte quand on
 * cherche qui a changé quoi, pas à chaque ouverture de la fiche. Le nombre
 * d'événements se lit sur la rangée repliée. Chaque événement dit le geste
 * et ce qu'il a touché — jamais les noms de colonnes de la base.
 */
function CarteHistorique({
  history,
}: {
  history: { isLoading: boolean; data?: EmployeeHistoryEntry[] };
}) {
  const [ouvert, setOuvert] = useState(false);
  const n = history.data?.length ?? 0;
  return (
    <Card>
      <CardHeader className="p-0">
        <button
          type="button"
          aria-expanded={ouvert}
          onClick={() => setOuvert((o) => !o)}
          className="flex w-full items-center gap-2 px-5 py-4 text-left focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
        >
          <CardTitle className="min-w-0 flex-1">Historique des modifications</CardTitle>
          {n > 0 ? (
            <span
              className="rounded-full bg-primary/[0.09] px-1.5 py-px text-[10px] font-extrabold text-primary"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {n}
            </span>
          ) : null}
          <Icon
            name="chevron_right"
            size={18}
            className={cn(
              'shrink-0 text-ink-muted transition-transform duration-200',
              ouvert && 'rotate-90',
            )}
          />
        </button>
      </CardHeader>
      {ouvert ? (
        <CardContent>
          {history.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : n === 0 ? (
            <p className="rounded-[11px] border border-dashed border-line bg-surface-raised px-4 py-5 text-center text-[12.5px] text-ink-muted">
              Aucune modification enregistrée.
            </p>
          ) : (
            /* Une frise : le fil vertical relie les événements et fait
               lire la colonne comme une suite, pas comme un tableau de
               dates dont chaque ligne repartirait de zéro. */
            <ol className="relative flex flex-col gap-4 border-l border-line-soft pl-4">
              {history.data!.map((h) => (
                <li key={h.id} className="relative">
                  <span
                    aria-hidden
                    className="absolute top-[6px] -left-[21px] size-[7px] rounded-full bg-primary/40 ring-[3px] ring-surface"
                  />
                  <p className="text-[12.5px] leading-snug font-semibold text-ink-strong">
                    {ACTION_LABELS[h.action] ?? h.action} ·{' '}
                    {TABLE_LABELS[h.tableName] ?? h.tableName}
                  </p>
                  <p className="mt-0.5 text-[11px] text-ink-muted/80">
                    {new Date(h.occurredAt).toLocaleString('fr-FR', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      ) : null}
    </Card>
  );
}

/** La direction d'une unité : elle-même, ou sa plus proche aïeule de type direction. */
function directionDe(unites: OrgUnit[], uniteId: string | null | undefined): OrgUnit | null {
  let u = unites.find((x) => x.id === uniteId) ?? null;
  // Une boucle d'unités d'avant la règle ne doit pas figer l'écran.
  const vus = new Set<string>();
  while (u && u.unitType !== 'direction' && !vus.has(u.id)) {
    vus.add(u.id);
    const parent: string | null = u.parentId;
    u = unites.find((x) => x.id === parent) ?? null;
  }
  return u?.unitType === 'direction' ? u : null;
}

/**
 * L'affectation qui fait foi — en cours, sinon la prochaine —, comme au
 * serveur : un agent qui n'a pas encore pris son poste est déjà de sa
 * direction.
 */
function affectationEnVigueur(assignments: EmployeeDetail['assignments']) {
  const aujourdhui = new Date().toISOString().slice(0, 10);
  return (
    assignments.find((a) => a.current) ??
    [...assignments]
      .filter((a) => a.validFrom > aujourdhui)
      .sort((a, b) => a.validFrom.localeCompare(b.validFrom))[0]
  );
}

function AssignmentsCard({
  employeeId,
  assignments,
  team,
  managerId,
  canManage,
}: {
  employeeId: string;
  assignments: EmployeeDetail['assignments'];
  team: EmployeeDetail['team'];
  managerId: string | null;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  // La dernière affectation, saisie par erreur : son poste ou sa date se
  // corrigent ; une mutation se défait, et la précédente reprend.
  const [geste, setGeste] = useState<'corriger' | 'annuler' | null>(null);
  const parDate = [...assignments].sort((a, b) => b.validFrom.localeCompare(a.validFrom));
  const derniere = parDate[0];
  const annulable = Boolean(derniere && parDate[1] && parDate[1].validTo === derniere.validFrom);
  const gestesDerniere = (
    <>
      <Button size="sm" variant="ghost" onClick={() => setGeste('corriger')}>
        Corriger
      </Button>
      {annulable ? (
        <Button size="sm" variant="ghost" onClick={() => setGeste('annuler')}>
          Annuler
        </Button>
      ) : null}
    </>
  );
  const [positionTitle, setPositionTitle] = useState('');
  const [orgUnitId, setOrgUnitId] = useState('');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [nouveauN1, setNouveauN1] = useState('');
  const [repreneur, setRepreneur] = useState('');
  const [bilan, setBilan] = useState<ConsequencesHierarchie | null>(null);
  const [error, setError] = useState<string | null>(null);

  const orgUnits = useQuery({
    queryKey: ['org-units'],
    queryFn: () => api<OrgUnitView[]>('/org-units'),
    enabled: canManage && open,
  });

  // ——— Changer de direction, c'est changer de n+1 — et, pour qui encadre,
  // confier son équipe, qui reste dans l'ancienne. Les deux se décident
  // ICI, dans la même opération : faits l'un après l'autre, chacun serait
  // refusé par la règle.
  const unites = orgUnits.data ?? [];
  const actuelle = affectationEnVigueur(assignments);
  const directionActuelle = directionDe(unites, actuelle?.orgUnitId);
  const directionVisee = directionDe(unites, orgUnitId || null);
  const changeDeDirection =
    open && orgUnits.isSuccess && directionVisee?.id !== directionActuelle?.id;
  const libelle = (u: OrgUnit | null) => (u ? (u.shortName ?? u.name) : null);
  const { options: n1Possibles } = useResponsablesPossibles(
    libelle(directionVisee),
    employeeId,
    false,
    open,
  );
  const { options: repreneursPossibles } = useResponsablesPossibles(
    libelle(directionActuelle),
    employeeId,
    false,
    open,
  );
  const repreneurRequis = changeDeDirection && team.length > 0;
  // Le directeur de la direction visée est son n+1 d'office : proposé d'emblée.
  const directeurVise = changeDeDirection ? n1DOffice(unites, orgUnitId || null, employeeId) : null;
  useEffect(() => {
    setNouveauN1(directeurVise ?? '');
  }, [directeurVise]);
  // Le n+1 n'est pas daté : il vaut dès aujourd'hui. Une mutation vers une
  // autre direction qui touche à la hiérarchie s'enregistre donc le jour où
  // elle prend effet — le serveur refuserait de la programmer.
  const programmee = startDate > new Date().toISOString().slice(0, 10);
  const bloqueeParLaDate =
    programmee && changeDeDirection && Boolean(managerId || nouveauN1 || team.length > 0);

  const create = useMutation({
    mutationFn: () =>
      api<ConsequencesHierarchie>(`/employees/${employeeId}/assignments`, {
        method: 'POST',
        body: {
          positionTitle,
          orgUnitId: orgUnitId || undefined,
          startDate,
          ...(changeDeDirection && nouveauN1 ? { managerEmployeeId: nouveauN1 } : {}),
          ...(repreneurRequis && repreneur ? { repreneurEquipeId: repreneur } : {}),
        },
      }),
    onSuccess: (res) => {
      setOpen(false);
      setPositionTitle('');
      setNouveauN1('');
      setRepreneur('');
      setError(null);
      setBilan(res ?? null);
      void queryClient.invalidateQueries({ queryKey: ['employee', employeeId] });
      void queryClient.invalidateQueries({ queryKey: ['employees'] });
      void queryClient.invalidateQueries({ queryKey: ['hierarchie-controle'] });
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Enregistrement impossible.'),
  });

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>Affectations</CardTitle>
        {canManage ? (
          <Button variant="secondary" size="sm" onClick={() => setOpen(!open)}>
            {open ? 'Fermer' : 'Nouvelle affectation'}
          </Button>
        ) : null}
      </CardHeader>
      {open ? (
        <CardContent className="border-b border-line-soft">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Field label="Nouveau poste" htmlFor="asg-title" required>
                <Input
                  id="asg-title"
                  placeholder="Ex : Chef de service études"
                  value={positionTitle}
                  onChange={(ev) => setPositionTitle(ev.target.value)}
                />
              </Field>
            </div>
            <div className="flex-1">
              <Field label="Unité" htmlFor="asg-unit">
                <Select
                  id="asg-unit"
                  value={orgUnitId}
                  onChange={(ev) => setOrgUnitId(ev.target.value)}
                >
                  <option value="">—</option>
                  {orgUnits.data?.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="w-full sm:w-44">
              <Field label="À compter du" htmlFor="asg-start" required>
                <Input
                  id="asg-start"
                  type="date"
                  value={startDate}
                  onChange={(ev) => setStartDate(ev.target.value)}
                />
              </Field>
            </div>
            <Button
              onClick={() => create.mutate()}
              loading={create.isPending}
              disabled={
                !positionTitle.trim() ||
                !startDate ||
                (repreneurRequis && !repreneur) ||
                bloqueeParLaDate
              }
            >
              Enregistrer
            </Button>
          </div>
          {changeDeDirection && directionVisee ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Nouveau n+1" htmlFor="asg-n1" hint={`Dans ${libelle(directionVisee)}.`}>
                <Select
                  id="asg-n1"
                  value={nouveauN1}
                  onChange={(ev) => setNouveauN1(ev.target.value)}
                >
                  <option value="">Garder le n+1 actuel</option>
                  {n1Possibles.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nom}
                      {m.poste ? ` — ${m.poste}` : ''}
                    </option>
                  ))}
                </Select>
              </Field>
              {repreneurRequis ? (
                <Field
                  label="Qui reprend son équipe"
                  htmlFor="asg-repreneur"
                  required
                  hint={`${team.map((m) => m.name).join(', ')} ${team.length > 1 ? 'restent' : 'reste'} dans ${libelle(directionActuelle) ?? 'sa direction'}.`}
                >
                  <Select
                    id="asg-repreneur"
                    value={repreneur}
                    onChange={(ev) => setRepreneur(ev.target.value)}
                  >
                    <option value="">Choisir</option>
                    {repreneursPossibles.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.nom}
                        {m.poste ? ` — ${m.poste}` : ''}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
            </div>
          ) : null}
          {bloqueeParLaDate ? (
            <p className="mt-3 flex items-start gap-2 text-[12.5px] leading-relaxed text-ink">
              <Icon name="event" size={16} className="mt-px shrink-0 text-primary" />
              <span>
                Une mutation vers une autre direction s’enregistre le jour où elle prend effet : le
                n+1 vaut dès aujourd’hui, et la chaîne hiérarchique resterait fausse jusqu’à cette
                date.
              </span>
            </p>
          ) : null}
          <p className="mt-2 text-xs text-ink-muted">
            L&apos;affectation en cours sera automatiquement clôturée la veille. L&apos;historique
            reste intact.
          </p>
          {error ? (
            <p className="mt-2 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
          ) : null}
        </CardContent>
      ) : null}
      {aDesConsequences(bilan) ? (
        <CardContent className="border-b border-line-soft">
          <ListeConsequences consequences={bilan!} faites />
        </CardContent>
      ) : null}
      {geste && derniere ? (
        <GesteAffectation
          employeeId={employeeId}
          affectation={derniere}
          geste={geste}
          onClose={() => setGeste(null)}
          onFait={(res) => {
            setGeste(null);
            if (res) setBilan(res);
          }}
        />
      ) : null}
      {assignments.length === 0 ? (
        <CardContent>
          <p className="text-sm text-ink-muted">Aucune affectation enregistrée.</p>
        </CardContent>
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>Poste</Th>
              <Th>Unité</Th>
              <Th>Du</Th>
              <Th>Au</Th>
              {canManage ? (
                <Th className="hidden sm:table-cell">
                  <span className="sr-only">Actions</span>
                </Th>
              ) : null}
            </tr>
          </THead>
          <TBody>
            {assignments.map((a) => (
              <Tr key={a.id}>
                <Td className="font-medium text-ink-strong">
                  {a.positionTitle}
                  {/* Sur téléphone, les gestes passent sous le poste : une
                      cinquième colonne sortirait de l'écran. */}
                  {canManage && a.id === derniere?.id ? (
                    <div className="mt-1.5 -ml-2.5 flex gap-1 sm:hidden">{gestesDerniere}</div>
                  ) : null}
                </Td>
                <Td>{a.orgUnitName ?? '—'}</Td>
                <Td className="whitespace-nowrap">{formatDate(a.validFrom)}</Td>
                {/* La colonne « Au » porte seule l'état : « aujourd'hui » dit
                    l'affectation en cours, « à venir » celle qui n'a pas
                    commencé. Un badge à côté répétait ce que la date dit. */}
                <Td className="whitespace-nowrap">
                  {a.validTo ? (
                    formatDate(lastDay(a.validTo))
                  ) : a.current ? (
                    <span className="font-semibold text-primary">aujourd&apos;hui</span>
                  ) : (
                    <span className="text-ink-muted">à venir</span>
                  )}
                </Td>
                {canManage ? (
                  <Td className="hidden text-right whitespace-nowrap sm:table-cell">
                    {a.id === derniere?.id ? gestesDerniere : null}
                  </Td>
                ) : null}
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}

/**
 * Les compteurs de congés de l'année.
 *
 * Le DROIT ne se saisit pas ici. Il est fixé par type d'absence dans
 * « Paramètres des congés » (le champ « Droit ouvert »), et c'est de là qu'il
 * doit venir : un droit modifiable sur chaque fiche se serait mis à diverger
 * agent par agent, et plus personne n'aurait su lequel faisait foi. Cette
 * carte montre l'état du compteur ; elle ne le décide pas.
 */
function BalancesCard({ employeeId }: { employeeId: string }) {
  const year = new Date().getFullYear();
  const balances = useQuery({
    queryKey: ['balances', employeeId, String(year)],
    queryFn: () => api<BalanceView[]>(`/employees/${employeeId}/balances?year=${year}`),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Congés {year}</CardTitle>
      </CardHeader>
      {balances.isLoading ? (
        <CardContent>
          <Skeleton className="h-16 w-full" />
        </CardContent>
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>Type</Th>
              {/* Quatre colonnes de nombres, cadrées à DROITE et en chiffres
                    de largeur fixe : les unités tombent sous les unités, et on
                    compare deux lignes sans les lire. */}
              <Th className="text-right">Droit</Th>
              <Th className="text-right">Pris</Th>
              <Th className="text-right">En attente</Th>
              <Th className="text-right">Restant</Th>
            </tr>
          </THead>
          <TBody>
            {balances.data?.map((b) => (
              <Tr key={b.absenceTypeId}>
                <Td className="font-medium text-ink-strong">{b.absenceTypeName}</Td>
                <Td className="text-right font-mono">
                  {b.deductsBalance ? b.entitledDays : <span className="text-ink-muted/45">—</span>}
                </Td>
                <Td className="text-right font-mono">{b.takenDays}</Td>
                <Td className="text-right font-mono">{b.pendingDays}</Td>
                <Td className="text-right font-mono font-semibold text-ink-strong">
                  {b.deductsBalance ? (
                    b.remainingDays
                  ) : (
                    <span className="font-normal text-ink-muted/45">—</span>
                  )}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}

/** Corriger le poste ou la date de la dernière affectation, ou l'annuler. */
function GesteAffectation({
  employeeId,
  affectation: a,
  geste,
  onClose,
  onFait,
}: {
  employeeId: string;
  affectation: EmployeeDetail['assignments'][number];
  geste: 'corriger' | 'annuler';
  onClose: () => void;
  onFait: (res: ConsequencesHierarchie | null) => void;
}) {
  const queryClient = useQueryClient();
  const [poste, setPoste] = useState(a.positionTitle);
  const [debut, setDebut] = useState(a.validFrom);
  const envoyer = useMutation({
    mutationFn: () =>
      geste === 'corriger'
        ? api<null>(`/employees/${employeeId}/assignments/${a.id}`, {
            method: 'PATCH',
            body: { positionTitle: poste.trim(), startDate: debut },
          })
        : api<ConsequencesHierarchie>(`/employees/${employeeId}/assignments/${a.id}`, {
            method: 'DELETE',
          }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['employee', employeeId] });
      void queryClient.invalidateQueries({ queryKey: ['employees'] });
      void queryClient.invalidateQueries({ queryKey: ['hierarchie-controle'] });
      onFait(res ?? null);
    },
  });
  const erreur = envoyer.error
    ? envoyer.error instanceof ApiError
      ? envoyer.error.message
      : 'Enregistrement impossible.'
    : null;
  return (
    <Modal
      open
      onClose={onClose}
      title={geste === 'corriger' ? 'Corriger l’affectation' : 'Annuler l’affectation'}
      subtitle={`${a.positionTitle}${a.orgUnitName ? ` · ${a.orgUnitName}` : ''}`}
      maxWidth="max-w-md"
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {geste === 'corriger' ? 'Annuler' : 'Garder l’affectation'}
          </Button>
          <Button
            variant={geste === 'annuler' ? 'danger' : 'primary'}
            loading={envoyer.isPending}
            disabled={geste === 'corriger' && (!poste.trim() || !debut)}
            onClick={() => envoyer.mutate()}
          >
            {geste === 'corriger' ? 'Enregistrer' : 'Annuler l’affectation'}
          </Button>
        </div>
      }
    >
      {geste === 'corriger' ? (
        <div className="flex flex-col gap-3.5">
          <Field label="Poste" htmlFor="corr-poste" required>
            <Input id="corr-poste" value={poste} onChange={(ev) => setPoste(ev.target.value)} />
          </Field>
          <Field label="Début" htmlFor="corr-debut" required>
            <Input
              id="corr-debut"
              type="date"
              value={debut}
              onChange={(ev) => setDebut(ev.target.value)}
            />
          </Field>
        </div>
      ) : (
        <p className="text-[13px] text-ink">L’affectation précédente reprend.</p>
      )}
      {erreur ? (
        <p role="alert" className="mt-3 text-[12.5px] text-danger">
          {erreur}
        </p>
      ) : null}
    </Modal>
  );
}

/**
 * Corriger le dernier contrat, saisi par erreur. Un dossier passé à tort
 * dans les inactifs par une fin erronée se rouvre.
 */
function CorrectionContrat({
  employeeId,
  contrat: c,
}: {
  employeeId: string;
  contrat: EmployeeDetail['contracts'][number];
}) {
  const queryClient = useQueryClient();
  const [ouvert, setOuvert] = useState(false);
  const corrigeable = (TYPES_DE_NOUVEAU_CONTRAT as readonly string[]).includes(c.contractType);
  const [type, setType] = useState(corrigeable ? c.contractType : 'cdd');
  const [debut, setDebut] = useState(c.startDate);
  const [fin, setFin] = useState(c.endDate ?? '');
  const avecFin = type === 'cdd' || type === 'stage';
  const corriger = useMutation({
    mutationFn: () =>
      api(`/employees/${employeeId}/contracts/${c.id}`, {
        method: 'PATCH',
        body: { contractType: type, startDate: debut, ...(avecFin && fin ? { endDate: fin } : {}) },
      }),
    onSuccess: async () => {
      setOuvert(false);
      await queryClient.invalidateQueries({ queryKey: ['employee', employeeId] });
      await queryClient.invalidateQueries({ queryKey: ['employees'] });
      await queryClient.invalidateQueries({ queryKey: ['contrats'] });
    },
  });
  const erreur = corriger.error
    ? corriger.error instanceof ApiError
      ? corriger.error.message
      : 'Enregistrement impossible.'
    : null;
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOuvert(true)}>
        Corriger
      </Button>
      {/* La fenêtre naît dans une cellule alignée à droite : elle reprend la gauche. */}
      <div className="text-left">
        <Modal
          open={ouvert}
          onClose={() => setOuvert(false)}
          title="Corriger le contrat"
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
              <Button variant="secondary" onClick={() => setOuvert(false)}>
                Annuler
              </Button>
              <Button
                loading={corriger.isPending}
                disabled={!debut || (avecFin && !fin)}
                onClick={() => corriger.mutate()}
              >
                Enregistrer
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3.5">
            <Field label="Type" htmlFor="corr-contrat-type" required>
              <Select
                id="corr-contrat-type"
                value={type}
                onChange={(ev) => setType(ev.target.value)}
              >
                {TYPES_DE_NOUVEAU_CONTRAT.map((v) => (
                  <option key={v} value={v}>
                    {CONTRACT_LABELS[v]}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid gap-3.5 sm:grid-cols-2">
              <Field label="Début" htmlFor="corr-contrat-debut" required>
                <Input
                  id="corr-contrat-debut"
                  type="date"
                  value={debut}
                  onChange={(ev) => setDebut(ev.target.value)}
                />
              </Field>
              {avecFin ? (
                <Field label="Fin" htmlFor="corr-contrat-fin" required>
                  <Input
                    id="corr-contrat-fin"
                    type="date"
                    min={debut || undefined}
                    value={fin}
                    onChange={(ev) => setFin(ev.target.value)}
                  />
                </Field>
              ) : null}
            </div>
          </div>
        </Modal>
      </div>
    </>
  );
}

function PortalCard({
  employeeId,
  portal,
  prenom,
  gender,
}: {
  employeeId: string;
  portal: EmployeeDetail['portal'];
  prenom: string;
  gender: string | null;
}) {
  const queryClient = useQueryClient();
  const [invite, setInvite] = useState<InviteResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = useMutation({
    mutationFn: () =>
      api<InviteResult>(`/employees/${employeeId}/invite`, { method: 'POST', body: {} }),
    onSuccess: (r) => {
      setInvite(r);
      setError(null);
      setCopied(false);
      void queryClient.invalidateQueries({ queryKey: ['employee', employeeId] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Génération impossible.'),
  });

  // Couper l'accès : déconnecté de partout, il ne se reconnecte plus ;
  // le rétablir lui rend la connexion, avec son mot de passe.
  const [aCouper, setACouper] = useState(false);
  const acces = useMutation({
    mutationFn: (geste: 'couper' | 'retablir') =>
      api(`/employees/${employeeId}/acces/${geste}`, { method: 'POST' }),
    onSuccess: () => {
      setACouper(false);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['employee', employeeId] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Action impossible.'),
  });

  const inviteUrl = invite ? `${window.location.origin}${invite.invitePath}` : null;
  const actif = portal.status === 'active';
  const coupe = portal.status === 'coupe';

  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-3">
        <CardTitle>Accès au portail</CardTitle>
        {actif ? (
          <Badge tone="teal">Compte actif</Badge>
        ) : coupe ? (
          <Badge tone="rouge">Accès coupé</Badge>
        ) : portal.status === 'invited' ? (
          <Badge tone="orange">Invitation en cours</Badge>
        ) : (
          <Badge tone="gris">Aucun accès</Badge>
        )}
      </CardHeader>

      <CardContent className="@container flex flex-col gap-4">
        {/* L'état, dit une fois, en entier : une pastille d'icône, une ligne
            qui NOMME la situation, une ligne qui l'explique. La pastille de
            l'en-tête classe la carte quand on balaie la colonne ; ce bloc-ci
            répond à « et concrètement ? ». */}
        <div className="flex items-start gap-3">
          <span
            className={cn(
              'flex size-9 shrink-0 items-center justify-center rounded-[11px]',
              actif
                ? 'bg-success-soft text-success'
                : coupe
                  ? 'bg-danger-soft text-danger'
                  : 'bg-primary/[0.07] text-primary',
            )}
          >
            <Icon name={actif ? 'how_to_reg' : 'lock'} size={19} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] leading-tight font-semibold text-ink-strong">
              {actif
                ? portal.role === 'admin'
                  ? 'Compte actif · administration'
                  : 'Compte actif'
                : coupe
                  ? 'Accès coupé'
                  : portal.status === 'invited'
                    ? 'Invitation envoyée, pas encore acceptée'
                    : 'Pas encore de compte'}
            </p>
            <p className="mt-1 text-[12px] leading-snug text-ink-muted">
              {coupe ? (
                <>La connexion au portail est refusée à {prenom} jusqu&apos;au rétablissement.</>
              ) : actif ? (
                <>
                  {prenom} se connecte au portail et y gère ses demandes de congés et de documents.
                  Ce qu&apos;on y fait de plus vient de sa place dans l&apos;organigramme (N+1
                  d&apos;une équipe, Direction du Capital Humain), pas d&apos;un rôle.
                </>
              ) : (
                <>
                  {/* Le pronom suit le sexe au dossier quand il y est. « Il ou
                      elle » n'est pas une faute, mais quand on connaît la
                      personne à qui l'on écrit, la phrase n'a pas à hésiter. */}
                  Transmettez le lien d&apos;invitation à{' '}
                  <span className="font-semibold text-ink">{prenom}</span>.{' '}
                  {gender === 'female' ? 'Elle' : gender === 'male' ? 'Il' : 'Il ou elle'} choisira
                  son mot de passe et son compte sera relié à ce dossier.
                </>
              )}
            </p>
          </div>
        </div>

        {actif || coupe ? (
          <>
            <div>
              <Button
                variant={coupe ? 'primary' : 'secondary'}
                loading={coupe && acces.isPending}
                onClick={() => (coupe ? acces.mutate('retablir') : setACouper(true))}
              >
                {coupe ? 'Rétablir l’accès' : 'Couper l’accès'}
              </Button>
            </div>
            {error && !aCouper ? (
              <p className="rounded-[10px] bg-danger-soft/55 px-3 py-2 text-[12.5px] text-danger ring-1 ring-danger/25 ring-inset">
                {error}
              </p>
            ) : null}
            <Modal
              open={aCouper}
              onClose={() => setACouper(false)}
              title={`Couper l’accès de ${prenom}`}
              maxWidth="max-w-md"
              footer={
                <div className="flex w-full justify-end gap-2">
                  <Button variant="secondary" onClick={() => setACouper(false)}>
                    Annuler
                  </Button>
                  <Button
                    variant="danger"
                    loading={acces.isPending}
                    onClick={() => acces.mutate('couper')}
                  >
                    Couper l’accès
                  </Button>
                </div>
              }
            >
              <p className="text-[13px] text-ink">
                Ses sessions se ferment sur tous ses appareils, et la connexion lui est refusée
                jusqu&apos;au rétablissement.
              </p>
              {error ? (
                <p role="alert" className="mt-2 text-[12.5px] text-danger">
                  {error}
                </p>
              ) : null}
            </Modal>
          </>
        ) : (
          <>
            {/* Pas de rôle à choisir : tout le monde entre comme agent, et
                l'organigramme donne le reste. */}
            <div className="flex flex-col gap-3 @[24rem]:flex-row @[24rem]:items-end">
              <Button
                onClick={() => generate.mutate()}
                loading={generate.isPending}
                className="w-full @[24rem]:w-auto"
              >
                {portal.status === 'invited' ? 'Régénérer le lien' : 'Générer le lien'}
              </Button>
            </div>

            {error ? (
              <p className="rounded-[10px] bg-danger-soft/55 px-3 py-2 text-[12.5px] text-danger ring-1 ring-danger/25 ring-inset">
                {error}
              </p>
            ) : null}

            {inviteUrl && invite ? (
              <div className="rounded-[13px] border border-primary/20 bg-primary-soft/45 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[9.5px] font-bold tracking-[0.1em] text-primary uppercase">
                    Lien d&apos;invitation
                  </p>
                  <button
                    type="button"
                    onClick={async () => {
                      await navigator.clipboard.writeText(inviteUrl);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                    className="flex shrink-0 items-center gap-1 rounded-full bg-surface px-2.5 py-1 text-[11px] font-semibold text-primary ring-1 ring-primary/20 ring-inset transition-colors hover:bg-primary hover:text-primary-ink focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
                  >
                    <Icon name={copied ? 'check' : 'content_copy'} size={14} />
                    {copied ? 'Copié' : 'Copier'}
                  </button>
                </div>
                {/* Le lien tient sur une ligne, coupé au besoin : c'est le
                    bouton qui le transmet, pas la lecture à l'œil. */}
                <p className="mt-2 truncate font-mono text-[11.5px] text-ink" title={inviteUrl}>
                  {inviteUrl}
                </p>
                <p className="mt-2 text-[11px] text-ink-muted">
                  Pour {invite.email} · valable jusqu&apos;au {formatDate(invite.expiresAt)}
                </p>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Le lendemain d'une date ISO. */
function lendemain(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Réactiver le dossier, à la place du stylo : la fiche d'un inactif ne se
 * modifie pas. La reprise se date : par défaut le début du contrat
 * enregistré depuis le départ, sinon aujourd'hui. Le serveur refuse tant que
 * le contrat est échu ; la raison s'affiche sous le matricule.
 */
function BoutonReactiver({
  employe: e,
  onRefus,
}: {
  employe: EmployeeDetail;
  onRefus: (raison: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const [ouvert, setOuvert] = useState(false);
  const jour = aujourdhui();
  const premier = e.finActivite ? lendemain(e.finActivite) : null;
  const parDefaut = e.repriseParDefaut ?? jour;
  const [le, setLe] = useState(parDefaut);
  const reactiver = useMutation({
    mutationFn: () =>
      api<EmployeeBatchResult>('/employees/archive', {
        method: 'POST',
        // La date proposée est celle du serveur : il ne la reçoit que changée.
        body: { ids: [e.id], archived: false, ...(le !== parDefaut ? { le } : {}) },
      }),
    onSuccess: async (r) => {
      setOuvert(false);
      if (r.done === 0) {
        onRefus(r.skipped[0]?.reason ?? 'Réactivation impossible.');
        return;
      }
      onRefus(null);
      await queryClient.invalidateQueries({ queryKey: ['employee', e.id] });
      await queryClient.invalidateQueries({ queryKey: ['employees'] });
    },
    onError: (err) => {
      setOuvert(false);
      onRefus(err instanceof ApiError ? err.message : 'Réactivation impossible.');
    },
  });
  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        className="shrink-0"
        onClick={() => {
          setLe(parDefaut);
          setOuvert(true);
        }}
      >
        <Icon name="unarchive" size={15} />
        Réactiver
      </Button>
      <Modal
        open={ouvert}
        onClose={() => setOuvert(false)}
        title="Réactiver le profil"
        maxWidth="max-w-md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOuvert(false)}>
              Annuler
            </Button>
            <Button
              loading={reactiver.isPending}
              disabled={!le || (premier !== null && le < premier)}
              onClick={() => reactiver.mutate()}
            >
              Réactiver
            </Button>
          </>
        }
      >
        <Field label="Reprise le" htmlFor="reprise-le" required>
          <Input
            id="reprise-le"
            type="date"
            min={premier ?? undefined}
            max={jour}
            // Un nouveau contrat qui commence plus tard fixe la reprise.
            disabled={parDefaut > jour}
            value={le}
            onChange={(ev) => setLe(ev.target.value)}
          />
        </Field>
      </Modal>
    </>
  );
}

/**
 * Un nouveau contrat : un CDD renouvelé, un stage suivi d'un CDD, un CDI. Le
 * précédent s'arrête la veille. Un CDD ou un stage se dit par sa durée, comme
 * à la création du dossier : la fin en découle, et c'est elle qui, le
 * lendemain, fera passer l'agent dans les inactifs. Le début peut être passé :
 * un contrat signé la semaine dernière s'enregistre à sa vraie date.
 */
function NouveauContrat({
  employeeId,
  prenom,
  contrats,
}: {
  employeeId: string;
  prenom: string;
  contrats: { startDate: string; endDate: string | null }[];
}) {
  const queryClient = useQueryClient();
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const [ouvert, setOuvert] = useState(false);
  const [type, setType] = useState('cdd');
  const [debut, setDebut] = useState(aujourdhui);
  const [mois, setMois] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const avecDuree = type === 'cdd' || type === 'stage';
  const fin = avecDuree && debut && Number(mois) > 0 ? contractEnd(debut, Number(mois)) : null;
  // Le contrat qui court aujourd'hui, s'il s'arrête pour laisser place au nouveau.
  const remplace = contrats.some(
    (c) =>
      c.startDate <= aujourdhui && (!c.endDate || (c.endDate >= aujourdhui && c.endDate >= debut)),
  );
  const fermer = () => {
    setOuvert(false);
    setMois('');
    setErreur(null);
  };
  const enregistrer = useMutation({
    mutationFn: () =>
      api(`/employees/${employeeId}/contracts`, {
        method: 'POST',
        body: { contractType: type, startDate: debut, ...(fin ? { endDate: fin } : {}) },
      }),
    onSuccess: async () => {
      fermer();
      await queryClient.invalidateQueries({ queryKey: ['employee', employeeId] });
      await queryClient.invalidateQueries({ queryKey: ['employees'] });
      await queryClient.invalidateQueries({ queryKey: ['contrats'] });
    },
    onError: (err) =>
      setErreur(err instanceof ApiError ? err.message : 'Enregistrement impossible.'),
  });
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOuvert(true)}>
        Nouveau contrat
      </Button>
      <Modal
        open={ouvert}
        onClose={fermer}
        title="Nouveau contrat"
        // En composant, pas en texte : la phrase passe à la ligne sur
        // téléphone au lieu d'être coupée.
        subtitle={
          <p className="text-xs text-ink-muted">
            Le contrat en cours s’arrête la veille du début du nouveau.
          </p>
        }
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
            <Button variant="secondary" onClick={fermer}>
              Annuler
            </Button>
            <Button
              loading={enregistrer.isPending}
              disabled={!debut || (avecDuree && !fin)}
              onClick={() => {
                setErreur(null);
                enregistrer.mutate();
              }}
            >
              Enregistrer
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3.5">
          {remplace ? (
            <p className="flex items-start gap-2 rounded-[12px] bg-warning-soft px-3.5 py-2.5 text-[12.5px] font-semibold text-warning ring-1 ring-current/15 ring-inset">
              <Icon name="warning" size={16} className="mt-px shrink-0" />
              {prenom} est actuellement sous contrat, ce nouveau contrat remplacera l’ancien.
            </p>
          ) : null}
          <Field label="Type" htmlFor="contrat-type" required>
            <Select id="contrat-type" value={type} onChange={(ev) => setType(ev.target.value)}>
              {TYPES_DE_NOUVEAU_CONTRAT.map((v) => (
                <option key={v} value={v}>
                  {CONTRACT_LABELS[v]}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label="Début" htmlFor="contrat-debut" required>
              <Input
                id="contrat-debut"
                type="date"
                value={debut}
                onChange={(ev) => setDebut(ev.target.value)}
              />
            </Field>
            {avecDuree ? (
              <Field label="Durée (mois)" htmlFor="contrat-duree" required>
                <Input
                  id="contrat-duree"
                  type="number"
                  min={1}
                  max={60}
                  value={mois}
                  onChange={(ev) => setMois(ev.target.value)}
                />
                {fin ? (
                  <p className="mt-1 text-xs text-ink-muted">
                    Fin du contrat : <span className="font-medium">{formatDate(fin)}</span>
                  </p>
                ) : null}
              </Field>
            ) : null}
          </div>
        </div>
      </Modal>
    </>
  );
}
