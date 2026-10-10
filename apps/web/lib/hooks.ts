'use client';

import { useQuery } from '@tanstack/react-query';
import type { SessionUser } from '@teranga/contracts';
import { api, isUnauthorized } from './api';

export function useMe() {
  return useQuery<SessionUser>({
    queryKey: ['me'],
    queryFn: () => api<SessionUser>('/me'),
    retry: (count, err) => !isUnauthorized(err) && count < 2,
    staleTime: 60_000,
  });
}

/** Formatte une date ISO (AAAA-MM-JJ) en français court. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
