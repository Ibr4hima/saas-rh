'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { CursorPage, EmployeeListItem } from '@teranga/contracts';
import {
  Badge,
  Button,
  Card,
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
import { api } from '../../../lib/api';
import { formatDate } from '../../../lib/hooks';

const STATUS_TONES: Record<string, 'success' | 'warning' | 'neutral'> = {
  active: 'success',
  suspended: 'warning',
  terminated: 'neutral',
};
const STATUS_LABELS: Record<string, string> = {
  active: 'Actif',
  suspended: 'Suspendu',
  terminated: 'Sorti',
};

export default function EmployeesPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState('');

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

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-ink-strong">Employés</h1>
          <p className="text-sm text-ink-muted">
            {items.length} affiché{items.length > 1 ? 's' : ''}
          </p>
        </div>
        <Link href="/employees/new">
          <Button>Nouvel employé</Button>
        </Link>
      </div>

      <div className="mb-4 flex gap-3">
        <Input
          placeholder="Rechercher par nom ou matricule…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40">
          <option value="">Tous les statuts</option>
          <option value="active">Actifs</option>
          <option value="suspended">Suspendus</option>
          <option value="terminated">Sortis</option>
        </Select>
      </div>

      <Card>
        {query.isLoading ? (
          <div className="flex flex-col gap-3 p-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            title={debounced || status ? 'Aucun résultat' : 'Aucun employé pour le moment'}
            description={
              debounced || status
                ? 'Essayez une autre recherche ou retirez les filtres.'
                : 'Créez votre premier employé ou importez votre fichier existant.'
            }
            action={
              !debounced && !status ? (
                <div className="flex gap-2">
                  <Link href="/employees/new">
                    <Button size="sm">Nouvel employé</Button>
                  </Link>
                  <Link href="/import">
                    <Button size="sm" variant="secondary">
                      Importer un fichier
                    </Button>
                  </Link>
                </div>
              ) : undefined
            }
          />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <Th>Matricule</Th>
                  <Th>Nom</Th>
                  <Th>Poste</Th>
                  <Th>Unité</Th>
                  <Th>Embauche</Th>
                  <Th>Statut</Th>
                </tr>
              </THead>
              <TBody>
                {items.map((e) => (
                  <Tr
                    key={e.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/employees/${e.id}`)}
                  >
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
                    <Td>{e.orgUnitName ?? '—'}</Td>
                    <Td className="whitespace-nowrap">{formatDate(e.hiredOn)}</Td>
                    <Td>
                      <Badge tone={STATUS_TONES[e.status] ?? 'neutral'}>
                        {STATUS_LABELS[e.status] ?? e.status}
                      </Badge>
                    </Td>
                  </Tr>
                ))}
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
      </Card>
    </div>
  );
}
