'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type {
  BalanceView,
  EmployeeBatchResult,
  EmployeeDetail,
  EmployeeHistoryEntry,
  InviteResult,
} from '@teranga/contracts';
import { peut } from '@teranga/contracts';
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
import { api, ApiError } from '../../../../lib/api';
import { CarteCertificatsAgent } from '../../../../components/academy-certificat';
import { EmployeeDocumentsCard } from '../../../../components/employee-documents-card';
import { ProfileChangeCard } from '../../../../components/profile-change-card';
import { DocumentRequestRow } from '../../../../components/document-request-list';
import { EmployeeEditModal } from '../../../../components/employee-edit-modal';
import { Telephone } from '../../../../components/telephone';
import { Donnee, Groupe, Peremption } from '../../../../components/fiche';
import { Icon } from '../../../../components/icons';
import { Modal } from '../../../../components/modal';
import { ID_DOCUMENT_LABELS, maritalLabels, SEX_LABELS } from '../../../../lib/person';
import { formatDate, useMe } from '../../../../lib/hooks';
import type {
  ConsequencesHierarchie,
  DocumentRequestView,
  OrgUnit,
  OrgUnitView,
} from '@teranga/contracts';
import {
  aDesConsequences,
  ListeConsequences,
} from '../../../../components/consequences-hierarchie';
import { n1DOffice, useResponsablesPossibles } from '../../../../lib/responsables';
import { LoadFailure } from '../../../../components/load-failure';
import { Page } from '../../../../components/gabarit';

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

/** Ancienneté en clair : « 3 ans et 2 mois », pas une date à soustraire. */
function seniority(hiredOn: string, jusquAu?: string | null): string {
  const start = new Date(`${hiredOn}T12:00:00Z`);
  // Inactif : l'ancienneté s'arrête à son dernier jour, pas à aujourd'hui.
  const fin = jusquAu ? new Date(`${jusquAu}T12:00:00Z`).getTime() : Date.now();
  const months = Math.max(0, (fin - start.getTime()) / (1000 * 60 * 60 * 24 * 30.44));
  const years = Math.floor(months / 12);
  const rest = Math.floor(months % 12);
  if (years === 0) return rest <= 1 ? '< 1 mois' : `${rest} mois`;
  const y = `${years} an${years > 1 ? 's' : ''}`;
  return rest === 0 ? y : `${y} et ${rest} mois`;
}

/**
 * Une donnée du dossier : intitulé discret, valeur lisible.
 *
 * Pas une pastille. Les pastilles conviennent aux QUELQUES repères qu'on
 * cherche du regard — matricule, direction, ancienneté — et c'est ce que la
 * bande de tête en fait. Ici, treize champs en pastilles donnaient un mur de
 * cadres où plus rien ne ressortait ; un filet et de l'air suffisent, et
 * l'état civil se lit comme ce qu'il est : un registre.
 */
/**
 * Un repère de la bande d'identité : l'intitulé au-dessus, petit et gris, la
 * valeur en dessous. Pas de cadre — c'est le filet de la colonne voisine qui
 * sépare, et le blanc qui aère.
 *
 * Un intitulé de poste ou de direction peut être très long (« Direction de
 * l'Intelligence et des Perspectives Économiques ») : on le borne à deux
 * lignes, et l'infobulle rend le nom entier à qui en a besoin.
 */
function Repere({
  label,
  valeur,
  titre,
  children,
}: {
  label: string;
  /** Un texte, ou un composant quand la valeur s'actionne (un numéro, une adresse). */
  valeur?: React.ReactNode;
  /** L'infobulle, quand la valeur n'est pas un texte qu'on puisse y recopier. */
  titre?: string;
  /** Une seconde ligne, plus discrète — la date d'embauche sous l'ancienneté. */
  children?: React.ReactNode;
}) {
  const vide = valeur === null || valeur === undefined || valeur === '';
  return (
    <div className="min-w-0">
      <dt className="text-[9.5px] font-bold tracking-[0.11em] text-ink-muted uppercase">{label}</dt>
      <dd
        className={cn(
          'mt-1.5 line-clamp-2 text-[13.5px] leading-snug font-semibold break-words',
          vide ? 'text-ink-muted/45' : 'text-ink-strong',
        )}
        title={titre ?? (typeof valeur === 'string' ? valeur : undefined)}
      >
        {vide ? '—' : valeur}
      </dd>
      {children ? (
        <dd className="mt-1 text-[11.5px] leading-tight font-normal text-ink-muted">{children}</dd>
      ) : null}
    </div>
  );
}

export default function EmployeePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  // Même convention que la création : l'ouverture vit dans l'URL, si bien que
  // le bouton de la barre supérieure reste un lien et que Retour referme.
  const editOpen = useSearchParams().get('modifier') !== null;
  const [refusReactivation, setRefusReactivation] = useState<string | null>(null);
  const me = useMe();
  const canSeeHistory = peut(me.data, 'personnel.consulter');

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
  const peutGerer = peut(me.data, 'personnel.gerer') && !e.soi;
  const peutLesSoldes = peut(me.data, 'conges.soldes') && !e.soi;
  // Un agent inactif n'a ni portail, ni affectation nouvelle : sa fiche se
  // consulte, son contrat se renouvelle, et le dossier se réactive.
  const actif = e.status === 'active';

  return (
    <Page>
      <EmployeeEditModal
        open={editOpen && actif}
        employeeId={id}
        onClose={() => router.replace(`/employees/${id}`)}
      />
      <Link
        href="/employees"
        className="mb-3 inline-flex items-center gap-1 text-[11.5px] font-semibold text-ink-muted transition-colors hover:text-primary"
      >
        ← Gestion du personnel
      </Link>
      {e.soi ? (
        <p className="mb-3 flex shrink-0 items-center gap-2 rounded-[12px] bg-primary/[0.06] px-3.5 py-2.5 text-[12.5px] text-ink">
          <Icon name="lock" size={16} className="shrink-0 text-primary" />
          <span className="min-w-0 flex-1">
            Votre propre dossier : vous le consultez, mais ne le modifiez pas d’ici. Vos changements
            passent par vos demandes, comme pour tout agent — un autre membre de la DCH les traite.
          </span>
          <Link href="/moi" className="shrink-0 font-semibold text-primary hover:underline">
            Mon espace
          </Link>
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
      <Card className="mb-4">
        <div className="flex items-start gap-4 p-5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
              <h1 className="text-[22px] leading-tight font-bold tracking-[-0.02em] text-ink-strong">
                {e.person.givenName} {e.person.familyName}
              </h1>
              {/* L'état en un signe : vérifié, en vert, pour un agent actif ;
                  barré, en gris, pour un inactif. Le mot reste pour les
                  lecteurs d'écran et dans l'infobulle. */}
              <span
                role="img"
                aria-label={STATUS_LABELS[e.status] ?? e.status}
                title={STATUS_LABELS[e.status] ?? e.status}
                className={cn('inline-flex', actif ? 'text-success' : 'text-ink-muted')}
              >
                <Icon name={actif ? 'verified' : 'verified_off'} size={22} />
              </span>
            </div>
            {/* Sous le nom, les deux choses qui désignent la personne dans une
                conversation : le matricule qu'on cite au téléphone, et le
                poste qu'on occupe. La direction, elle, a sa colonne. */}
            <p className="mt-1.5 text-[12.5px] leading-tight text-ink-muted">
              <span className="font-mono tracking-tight">{e.employeeNumber}</span>
              {actif && current?.positionTitle ? <> · {current.positionTitle}</> : null}
            </p>
            {refusReactivation ? (
              <p role="alert" className="mt-2 text-[12px] font-semibold text-danger">
                {refusReactivation}
              </p>
            ) : null}
          </div>
          {/* Inactif : sa fiche ne se modifie plus — le geste qui reste est
              de la réactiver, une fois son nouveau contrat enregistré. */}
          {peutGerer && !actif ? (
            <BoutonReactiver employeeId={e.id} onRefus={setRefusReactivation} />
          ) : peutGerer ? (
            <Link
              href={`/employees/${e.id}?modifier=1`}
              aria-label="Modifier la fiche"
              title="Modifier la fiche"
              className="flex size-9 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-ink-muted transition-colors duration-200 hover:border-primary/40 hover:bg-primary/[0.06] hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
            >
              <Icon name="edit" size={18} />
            </Link>
          ) : null}
        </div>

        {/* Quatre colonnes séparées par un filet, repliées en deux sur une
            carte étroite — où le filet disparaît, deux valeurs empilées n'ayant
            rien à séparer. Le seuil suit la largeur du CONTENEUR et non celle
            de l'écran : la même bande servira un panneau latéral sans se
            couper en morceaux. */}
        <div className="@container border-t border-line-soft px-5 py-4">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-5 @[44rem]:grid-cols-4 @[44rem]:gap-x-0 @[44rem]:[&>*]:pr-5 @[44rem]:[&>*+*]:border-l @[44rem]:[&>*+*]:border-line-soft @[44rem]:[&>*+*]:pl-5">
            {/* L'ABRÉGÉ, comme dans la colonne « Unité » de la liste : « DIPE »
                tient sur une ligne où « Direction de l'Intelligence et des
                Perspectives Économiques » se coupait en deux et finissait en
                points de suspension. Le nom complet reste en infobulle, et
                l'unité d'affectation exacte — département ou service — se lit
                juste en dessous dans la carte des affectations. */}
            {actif ? (
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
                <Repere label="Ancienneté" valeur={seniority(e.hiredOn)}>
                  Depuis le {formatDate(e.hiredOn)}
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
                <Repere label="Ancienneté" valeur={seniority(e.hiredOn, e.finActivite)}>
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
            )}
          </dl>
        </div>
      </Card>

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
              {peutGerer ? <NouveauContrat employeeId={e.id} /> : null}
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
                  </tr>
                </THead>
                <TBody>
                  {e.contracts.map((c) => (
                    <Tr key={c.id}>
                      <Td className="font-medium text-ink-strong">
                        {CONTRACT_LABELS[c.contractType] ?? c.contractType}
                      </Td>
                      <Td>{formatDate(c.startDate)}</Td>
                      <Td>{c.endDate ? formatDate(c.endDate) : '—'}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>

          {/* En tête des cartes de gauche : c'est ce qui attend une décision. */}
          {canSeeHistory ? <ProfileChangeCard employeeId={e.id} /> : null}

          {canSeeHistory ? <EmployeeDocumentsCard employeeId={e.id} depot={e.soi} /> : null}

          {canSeeHistory ? <DocumentRequestsCard employeeId={e.id} /> : null}

          {canSeeHistory ? <CarteCertificatsAgent employeeId={e.id} /> : null}

          {/* Les soldes sont un TABLEAU : ils appartiennent à la colonne large.
              Serrés dans le tiers de droite, leurs colonnes débordaient. */}
          <BalancesCard employeeId={e.id} canEdit={peutLesSoldes && actif} />
        </div>

        {/* ———— Colonne d'administration : accès et traces ———— */}
        <div className="flex min-w-0 flex-col gap-4">
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
  const { options: n1Possibles } = useResponsablesPossibles(libelle(directionVisee), employeeId);
  const { options: repreneursPossibles } = useResponsablesPossibles(
    libelle(directionActuelle),
    employeeId,
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
                  <option value="">— Garder le n+1 actuel</option>
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
                    <option value="">— Choisir</option>
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
            L&apos;affectation en cours sera automatiquement clôturée la veille — l&apos;historique
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
            </tr>
          </THead>
          <TBody>
            {assignments.map((a) => (
              <Tr key={a.id}>
                <Td className="font-medium text-ink-strong">{a.positionTitle}</Td>
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
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}

/** Historique des demandes de documents de cet employé (ADR-0012). */
function DocumentRequestsCard({ employeeId }: { employeeId: string }) {
  const requests = useQuery({
    queryKey: ['document-requests', 'employee', employeeId],
    queryFn: () => api<DocumentRequestView[]>(`/document-requests?employeeId=${employeeId}`),
  });

  const liste = requests.data ?? [];

  return (
    <Card>
      <CardHeader className="flex items-center gap-2.5">
        <CardTitle>Demandes de documents</CardTitle>
        {liste.length > 0 ? (
          <span
            className="rounded-full bg-primary/[0.09] px-2 py-px text-[10.5px] font-extrabold text-primary"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {liste.length}
          </span>
        ) : null}
      </CardHeader>
      <CardContent>
        {requests.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : liste.length === 0 ? (
          <p className="rounded-[11px] border border-dashed border-line bg-surface-raised px-4 py-5 text-center text-[12.5px] text-ink-muted">
            Aucune demande à ce jour.
          </p>
        ) : (
          <ul className="flex flex-col">
            {liste.map((r) => (
              <DocumentRequestRow key={r.id} request={r} showEmployee={false} />
            ))}
          </ul>
        )}
      </CardContent>
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
function BalancesCard({ employeeId, canEdit }: { employeeId: string; canEdit: boolean }) {
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
        <>
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
                    {b.deductsBalance ? (
                      b.entitledDays
                    ) : (
                      <span className="text-ink-muted/45">—</span>
                    )}
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
          {/* Là où le droit se règle. Sans ce renvoi, on cherche le champ de
              saisie sur cette carte — c'est là qu'il était.
              Le nom n'est plus un LIEN : « Paramètres des congés » est éteint
              dans le menu en attendant d'être repris, et une phrase qui y
              mène dirait le contraire de la navigation. Elle continue de dire
              OÙ le droit se règle, ce qui est tout ce qu'on lui demande. */}
          {canEdit ? (
            <CardContent className="border-t border-line-soft py-3">
              <p className="text-[11.5px] text-ink-muted">
                Le droit annuel se règle par type d&apos;absence dans{' '}
                <span className="font-semibold text-ink">Paramètres des congés</span>.
              </p>
            </CardContent>
          ) : null}
        </>
      )}
    </Card>
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

  const inviteUrl = invite ? `${window.location.origin}${invite.invitePath}` : null;
  const actif = portal.status === 'active';

  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-3">
        <CardTitle>Accès au portail</CardTitle>
        {actif ? (
          <Badge tone="success">Compte actif</Badge>
        ) : portal.status === 'invited' ? (
          <Badge tone="warning">Invitation en cours</Badge>
        ) : (
          <Badge tone="neutral">Aucun accès</Badge>
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
              actif ? 'bg-success-soft text-success' : 'bg-primary/[0.07] text-primary',
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
                : portal.status === 'invited'
                  ? 'Invitation envoyée, pas encore acceptée'
                  : 'Pas encore de compte'}
            </p>
            <p className="mt-1 text-[12px] leading-snug text-ink-muted">
              {actif ? (
                <>
                  {prenom} se connecte au portail et y gère ses demandes de congés et de documents.
                  Ce qu&apos;on y fait de plus vient de sa place dans l&apos;organigramme — N+1
                  d&apos;une équipe, Direction du Capital Humain — pas d&apos;un rôle.
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

        {actif ? null : (
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

/**
 * Réactiver le dossier, à la place du stylo : la fiche d'un inactif ne se
 * modifie pas. Le serveur refuse tant que le contrat est échu — la raison
 * s'affiche sous le matricule.
 */
function BoutonReactiver({
  employeeId,
  onRefus,
}: {
  employeeId: string;
  onRefus: (raison: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const reactiver = useMutation({
    mutationFn: () =>
      api<EmployeeBatchResult>('/employees/archive', {
        method: 'POST',
        body: { ids: [employeeId], archived: false },
      }),
    onSuccess: async (r) => {
      if (r.done === 0) {
        onRefus(r.skipped[0]?.reason ?? 'Réactivation impossible.');
        return;
      }
      onRefus(null);
      await queryClient.invalidateQueries({ queryKey: ['employee', employeeId] });
      await queryClient.invalidateQueries({ queryKey: ['employees'] });
    },
    onError: (err) => onRefus(err instanceof ApiError ? err.message : 'Réactivation impossible.'),
  });
  return (
    <Button
      size="sm"
      variant="secondary"
      className="shrink-0"
      loading={reactiver.isPending}
      onClick={() => reactiver.mutate()}
    >
      <Icon name="unarchive" size={15} />
      Réactiver
    </Button>
  );
}

/**
 * Un nouveau contrat : un CDD renouvelé, un stage suivi d'un CDD, un CDI. Le
 * précédent s'arrête la veille. Un CDD ou un stage a une date de fin — c'est
 * elle qui, le lendemain, fera passer l'agent dans les inactifs.
 */
function NouveauContrat({ employeeId }: { employeeId: string }) {
  const queryClient = useQueryClient();
  const [ouvert, setOuvert] = useState(false);
  const [type, setType] = useState('cdd');
  const [debut, setDebut] = useState(new Date().toISOString().slice(0, 10));
  const [fin, setFin] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const finRequise = type === 'cdd' || type === 'stage';
  const enregistrer = useMutation({
    mutationFn: () =>
      api(`/employees/${employeeId}/contracts`, {
        method: 'POST',
        body: { contractType: type, startDate: debut, ...(fin ? { endDate: fin } : {}) },
      }),
    onSuccess: async () => {
      setOuvert(false);
      setFin('');
      setErreur(null);
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
        onClose={() => setOuvert(false)}
        title="Nouveau contrat"
        subtitle="Renouvellement, ou changement de contrat. Le contrat en cours s’arrête la veille."
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
              loading={enregistrer.isPending}
              disabled={!debut || (finRequise && !fin)}
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
          <Field label="Type" htmlFor="contrat-type" required>
            <Select id="contrat-type" value={type} onChange={(ev) => setType(ev.target.value)}>
              {Object.entries(CONTRACT_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
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
            <Field
              label="Fin"
              htmlFor="contrat-fin"
              required={finRequise}
              hint={finRequise ? undefined : 'Facultative pour ce type de contrat.'}
            >
              <Input
                id="contrat-fin"
                type="date"
                value={fin}
                min={debut}
                onChange={(ev) => setFin(ev.target.value)}
              />
            </Field>
          </div>
        </div>
      </Modal>
    </>
  );
}
