'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { NotificationsPage } from '@teranga/contracts';
import { Button } from '@teranga/ui';
import { api } from '../lib/api';
import { Icon } from './icons';

function relativeTime(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  return `il y a ${days} j`;
}

export function NotificationsBell() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const page = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<NotificationsPage>('/notifications'),
    refetchInterval: 60_000,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => api(`/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const markAll = useMutation({
    mutationFn: () => api('/notifications/read-all', { method: 'POST' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const unread = page.data?.unreadCount ?? 0;

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        aria-label={`Notifications${unread > 0 ? ` (${unread} non lues)` : ''}`}
        onClick={() => setOpen(!open)}
        // La cloche ne vit plus que sur le chrome (barre supérieure, en-tête
        // mobile) : elle en porte donc les couleurs, pas celles du contenu.
        className="relative flex size-9 items-center justify-center rounded-full text-chrome-ink-muted transition-colors hover:bg-chrome-hover hover:text-chrome-ink focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
      >
        <Icon name="notifications" size={20} />
        {unread > 0 ? (
          <span className="absolute top-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-ink ring-2 ring-white/30">
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-40 mt-2 w-80 overflow-hidden rounded-lg border border-line bg-surface shadow-md max-lg:fixed max-lg:inset-x-3 max-lg:top-14 max-lg:w-auto">
          <div className="flex items-center justify-between border-b border-line-soft px-3 py-2">
            <p className="text-sm font-semibold text-ink-strong">Notifications</p>
            {unread > 0 ? (
              <Button size="sm" variant="ghost" onClick={() => markAll.mutate()}>
                Tout marquer lu
              </Button>
            ) : null}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {(page.data?.items ?? []).length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-ink-muted">
                Rien à signaler pour le moment.
              </p>
            ) : (
              page.data!.items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => {
                    if (!n.readAt) markRead.mutate(n.id);
                    setOpen(false);
                    if (n.link) router.push(n.link);
                  }}
                  className={`block w-full border-b border-line-soft px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-line-soft/50 ${
                    n.readAt ? 'opacity-70' : ''
                  }`}
                >
                  <span className="flex items-start gap-2">
                    {!n.readAt ? (
                      <span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" />
                    ) : (
                      <span className="mt-1.5 size-2 shrink-0" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-ink-strong">{n.title}</span>
                      {n.body ? (
                        <span className="block text-xs text-ink-muted">{n.body}</span>
                      ) : null}
                      <span className="block text-[11px] text-ink-muted/80">
                        {relativeTime(n.createdAt)}
                      </span>
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
