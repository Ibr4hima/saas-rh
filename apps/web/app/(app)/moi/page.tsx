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
import { Icon } from '../../../components/icons';
import { api, ApiError } from '../../../lib/api';
import { ABSENCE_STATUS_LABELS, ABSENCE_STATUS_TONES } from '../../../lib/absences';
import { formatDate, useMe } from '../../../lib/hooks';

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
      <div className="mx-auto max-w-[880px]">
        <Skeleton className="mb-4 h-[104px] w-full rounded-[16px]" />
        <Skeleton className="mb-4 h-[132px] w-full rounded-[16px]" />
        <Skeleton className="h-52 w-full rounded-[16px]" />
      </div>
    );
  }
  if (myEmployee.isError) {
    const message =
      myEmployee.error instanceof ApiError ? myEmployee.error.message : 'Chargement impossible.';
    return (
      <div className="mx-auto max-w-[880px]">
        <Card>
          <EmptyState
            icon={<Icon name="error" size={22} />}
            title="Votre dossier n’est pas accessible"
            description={message}
          />
        </Card>
      </div>
    );
  }

  const emp = myEmployee.data!;
  const myRequests = (requests.data ?? []).filter((r) => r.employeeId === emp.employeeId);
  const deductible = (balances.data ?? []).filter((b) => b.deductsBalance);
  const enAttente = myRequests.filter((r) => r.status === 'pending').length;

  return (
    <div className="mx-auto flex max-w-[880px] flex-col gap-4">
      {/* ———— Qui je suis, et le seul geste qui compte ————
          Pas de cartouche d'initiales : le prénom est écrit juste à côté, en
          vingt-deux pixels, et l'agent sait qui il est. */}
      <Card>
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
        <Skeleton className="h-[132px] w-full rounded-[16px]" />
      ) : deductible.length === 0 ? null : (
        <div className={cn('grid gap-4', deductible.length > 1 && 'md:grid-cols-2')}>
          {deductible.map((b) => (
            <CarteSolde key={b.absenceTypeId} solde={b} />
          ))}
        </div>
      )}

      {/* ———— Mes demandes ———— */}
      <Card>
        <CardHeader className="flex items-center justify-between gap-3">
          <CardTitle>Mes demandes</CardTitle>
          {enAttente > 0 ? (
            <span className="shrink-0 text-[11.5px] text-ink-muted" style={TABULAIRE}>
              {enAttente} en attente de visa
            </span>
          ) : null}
        </CardHeader>
        <CardContent className="px-2 py-2">
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
        </CardContent>
      </Card>

      {/* ———— Mes documents ———— */}
      <Card>
        <CardHeader>
          <CardTitle>Mes documents</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center">
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
          <Link href="/moi/documents" className="sm:shrink-0">
            <Button variant="secondary" className="w-full sm:w-auto">
              Demander un document
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Le solde d'un type de congé : le chiffre qui compte, puis la barre qui dit
 * d'où il vient.
 *
 * Trois segments dans une même barre — pris, en attente, restant — parce que
 * « 30 j restants » ne se comprend qu'au regard du droit ouvert. L'orange des
 * jours en attente n'est pas décoratif : c'est la couleur que la charte
 * réserve à CE QUI ATTEND un geste (ici, le visa du responsable), et c'est
 * exactement ce que ces jours sont.
 *
 * Chaque segment porte son libellé écrit juste dessous : la couleur n'est
 * jamais seule à renseigner.
 */
function CarteSolde({ solde }: { solde: BalanceView }) {
  const total = Math.max(solde.entitledDays, solde.takenDays + solde.pendingDays);
  const part = (n: number) => (total > 0 ? `${(n / total) * 100}%` : '0%');
  const segments: { n: number; mot: string; teinte: string; pastille: string }[] = [
    { n: solde.takenDays, mot: 'pris', teinte: 'bg-chart', pastille: 'bg-chart' },
    { n: solde.pendingDays, mot: 'en attente', teinte: 'bg-accent', pastille: 'bg-accent' },
    {
      n: Math.max(0, solde.remainingDays),
      mot: 'restants',
      teinte: 'bg-chart-track',
      pastille: 'bg-chart-track',
    },
  ];

  return (
    <Card>
      <CardContent className="px-5 py-[18px]">
        <p className="text-[10px] font-bold tracking-[0.1em] text-ink-muted uppercase">
          {solde.absenceTypeName} {solde.year}
        </p>
        <p className="mt-2 flex items-baseline gap-1.5">
          <span
            className="text-[34px] leading-none font-bold tracking-[-0.025em] text-ink-strong"
            style={TABULAIRE}
          >
            {solde.remainingDays}
          </span>
          <span className="text-[13px] font-medium text-ink-muted">
            jour{solde.remainingDays > 1 ? 's' : ''} restant{solde.remainingDays > 1 ? 's' : ''} sur{' '}
            {solde.entitledDays}
          </span>
        </p>

        {/* Un jour de blanc entre les segments : sans lui, deux teintes
            voisines se lisent comme un seul bloc. */}
        <div className="mt-3.5 flex h-2 gap-[2px]">
          {segments.map((s) =>
            s.n > 0 ? (
              <span
                key={s.mot}
                className={cn('rounded-full', s.teinte)}
                style={{ width: part(s.n) }}
              />
            ) : null,
          )}
        </div>

        <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
          {segments.map((s) => (
            <li key={s.mot} className="flex items-center gap-1.5 text-[11.5px] text-ink-muted">
              <span aria-hidden className={cn('size-2 shrink-0 rounded-full', s.pastille)} />
              <span style={TABULAIRE}>
                {s.n} {s.mot}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
