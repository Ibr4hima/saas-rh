'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type { AbsenceRequestView, BalanceView, MyEmployeeView } from '@teranga/contracts';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  EmptyState,
  Skeleton,
} from '@teranga/ui';
import { CarteSolde } from '../../../components/carte-solde';
import { Icon } from '../../../components/icons';
import { api, ApiError } from '../../../lib/api';
import { ABSENCE_STATUS_LABELS, ABSENCE_STATUS_TONES } from '../../../lib/absences';
import { formatDate, useMe } from '../../../lib/hooks';
import { CartePleine, CorpsDefilant, Page, PiedCarte } from '../../../components/gabarit';
import { ProchainsFeries } from '../../../components/prochains-feries';

/* ————————————————————————————————————————————————————————————————
   L'espace de l'agent répond à trois questions, dans cet ordre :
   1. « Combien me reste-t-il ? »   → le solde, en toutes lettres et en barre
   2. « Où en sont mes demandes ? » → la liste, avec l'état de chacune
   3. « Comment j'en pose une ? »   → une porte, toujours au même endroit

   C'est la même grammaire que côté RH : intitulés en petites capitales,
   rangées plutôt que tableaux quand il y a peu de lignes, aucune boîte
   teintée — le blanc et les filets suffisent à séparer.
   ———————————————————————————————————————————————————————————————— */

const TABULAIRE = { fontVariantNumeric: 'tabular-nums' } as const;

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Bonjour';
  if (h < 18) return 'Bon après-midi';
  return 'Bonsoir';
}

function plural(n: number, mot: string): string {
  return `${n} ${mot}${n > 1 ? 's' : ''}`;
}

export default function MySpacePage() {
  const me = useMe();
  const myEmployee = useQuery({
    queryKey: ['me-employee'],
    queryFn: () => api<MyEmployeeView>('/me/employee'),
    retry: false,
  });
  const employeeId = myEmployee.data?.employeeId;
  const year = new Date().getFullYear();

  const balances = useQuery({
    queryKey: ['balances', employeeId, String(year)],
    queryFn: () => api<BalanceView[]>(`/employees/${employeeId}/balances?year=${year}`),
    enabled: Boolean(employeeId),
  });
  const requests = useQuery({
    queryKey: ['my-requests', employeeId],
    queryFn: () => api<AbsenceRequestView[]>(`/absence-requests?employeeId=${employeeId}&limit=50`),
    enabled: Boolean(employeeId),
  });

  if (myEmployee.isLoading) {
    return (
      <Page>
        <Skeleton className="h-[104px] w-full shrink-0 rounded-[16px]" />
        <Skeleton className="h-[132px] w-full shrink-0 rounded-[16px]" />
        <Skeleton className="min-h-52 flex-1 rounded-[16px]" />
      </Page>
    );
  }
  if (myEmployee.isError) {
    const message =
      myEmployee.error instanceof ApiError ? myEmployee.error.message : 'Chargement impossible.';
    return (
      <Page>
        <CartePleine className="grid place-items-center">
          <EmptyState
            icon={<Icon name="error" size={22} />}
            title="Votre dossier n’est pas accessible"
            description={message}
          />
        </CartePleine>
      </Page>
    );
  }

  const emp = myEmployee.data!;
  const myRequests = (requests.data ?? []).filter((r) => r.employeeId === emp.employeeId);
  const deductible = (balances.data ?? []).filter((b) => b.deductsBalance);
  const enAttente = myRequests.filter((r) => r.status === 'pending').length;

  return (
    <Page>
      {/* ———— Qui je suis, et le seul geste qui compte ————
          Pas de cartouche d'initiales : le prénom est écrit juste à côté, en
          vingt-deux pixels, et l'agent sait qui il est. */}
      <Card className="shrink-0">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <h1 className="text-[22px] leading-tight font-bold tracking-[-0.02em] text-ink-strong">
              {me.data ? greeting() : 'Bonjour'}, {emp.givenName}
            </h1>
            <p className="mt-1.5 truncate text-[12.5px] leading-tight text-ink-muted">
              {emp.positionTitle ?? 'Poste non renseigné'}
              {emp.orgUnitName ? ` · ${emp.orgUnitName}` : ''}
            </p>
            <p className="mt-1 truncate text-[11.5px] leading-tight text-ink-muted">
              <span className="font-mono tracking-tight">{emp.employeeNumber}</span> · depuis le{' '}
              {formatDate(emp.hiredOn)}
            </p>
          </div>
          <Link href="/moi/conges" className="sm:shrink-0">
            <Button className="w-full sm:w-auto">
              <Icon name="add" size={16} />
              Poser une demande
            </Button>
          </Link>
        </div>
      </Card>

      {/* ———— Le solde ———— */}
      {balances.isLoading ? (
        <Skeleton className="h-[132px] w-full shrink-0 rounded-[16px]" />
      ) : deductible.length === 0 ? null : (
        <div className={cn('grid shrink-0 gap-4', deductible.length > 1 && 'md:grid-cols-2')}>
          {deductible.map((b) => (
            <CarteSolde key={b.absenceTypeId} solde={b} />
          ))}
        </div>
      )}

      {/* ———— Mes demandes, et le guichet des documents ————

          Une seule colonne de cartes empilées laissait, sur un écran de
          quatorze cents pixels, quarante pour cent de la page vide sous la
          dernière — et huit cents pixels de large pour une liste de dates. Le
          suivi des demandes prend les deux tiers et TOUTE la hauteur qui
          reste ; le guichet des documents, qui n'est qu'un geste, tient dans
          le tiers restant et garde sa taille. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3">
        <CartePleine className="lg:col-span-2">
          <CardHeader className="flex shrink-0 items-center justify-between gap-3">
            <CardTitle>Mes demandes</CardTitle>
            {enAttente > 0 ? (
              <span className="shrink-0 text-[11.5px] text-ink-muted" style={TABULAIRE}>
                {enAttente} en attente de visa
              </span>
            ) : null}
          </CardHeader>
          <CorpsDefilant className="px-2 py-2">
            {requests.isLoading ? (
              <div className="flex flex-col gap-1 px-2.5">
                {[0, 1].map((i) => (
                  <span key={i} className="flex items-center gap-3 py-2">
                    <Skeleton className="h-3 w-40" />
                  </span>
                ))}
              </div>
            ) : myRequests.length === 0 ? (
              <EmptyState
                className="py-7"
                icon={<Icon name="free_cancellation" size={22} />}
                title="Aucune demande pour le moment"
                description="Choisissez vos dates, le solde est vérifié pour vous, et la demande part à votre responsable."
                action={
                  <Link href="/moi/conges">
                    <Button size="sm" variant="secondary">
                      Poser une demande
                    </Button>
                  </Link>
                }
              />
            ) : (
              <ul className="flex flex-col">
                {myRequests.slice(0, 6).map((r) => (
                  <li key={r.id}>
                    <Link
                      href="/moi/conges"
                      className="group flex items-center gap-3 rounded-[9px] px-2.5 py-2.5 transition-colors duration-150 hover:bg-hover"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-semibold text-ink-strong">
                          {r.absenceTypeName}
                        </span>
                        <span
                          className="block truncate text-[11.5px] text-ink-muted"
                          style={TABULAIRE}
                        >
                          {formatDate(r.startDate)} → {formatDate(r.endDate)} ·{' '}
                          {plural(r.daysCount, 'jour')}
                        </span>
                      </span>
                      <Badge
                        tone={ABSENCE_STATUS_TONES[r.status] ?? 'neutral'}
                        className="shrink-0 whitespace-nowrap"
                      >
                        {ABSENCE_STATUS_LABELS[r.status] ?? r.status}
                      </Badge>
                    </Link>
                  </li>
                ))}
                {myRequests.length > 6 ? (
                  <li className="border-t border-line-soft px-2.5 pt-2.5 pb-1">
                    <Link
                      href="/moi/conges"
                      className="text-[11.5px] font-semibold text-primary hover:underline"
                    >
                      Voir mes {myRequests.length} demandes →
                    </Link>
                  </li>
                ) : null}
              </ul>
            )}
          </CorpsDefilant>
          {myRequests.length > 0 ? (
            <PiedCarte>{plural(myRequests.length, 'demande')}</PiedCarte>
          ) : null}
        </CartePleine>

        {/* ———— La colonne d'à côté : le guichet des documents, puis les
             fériés qui la finissent ———— */}
        <div className="flex min-h-0 flex-col gap-4">
          <Card className="shrink-0">
            <CardHeader>
              <CardTitle>Mes documents</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-[11px] bg-primary/[0.07] text-primary">
                <Icon name="folder_managed" size={19} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] leading-tight font-semibold text-ink-strong">
                  Attestation de travail, contrat, bulletin…
                </p>
                <p className="mt-1 text-[12px] leading-snug text-ink-muted">
                  La Direction du Capital Humain les prépare, les signe, et vous prévient dès
                  qu&apos;ils sont à retirer.
                </p>
              </div>
              <Link href="/moi/documents">
                <Button variant="secondary" className="w-full">
                  Demander un document
                </Button>
              </Link>
            </CardContent>
          </Card>

          {/* Personne ne choisit ses dates de congé sans savoir où tombe la
              Tabaski : la donnée manquait, et elle finit la colonne. */}
          <ProchainsFeries />
        </div>
      </div>
    </Page>
  );
}
