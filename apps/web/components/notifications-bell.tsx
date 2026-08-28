'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { NotificationView, NotificationsPage } from '@teranga/contracts';
import { cn, EmptyState } from '@teranga/ui';
import { api } from '../lib/api';
import { Icon, type IconName } from './icons';

function relativeTime(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  return `il y a ${days} j`;
}

/**
 * L'icône dit le SUJET de l'avis avant qu'on en lise le titre : sur dix lignes,
 * l'œil trie par famille au lieu de lire dix phrases.
 */
function iconOf(type: string): IconName {
  if (type.startsWith('document_')) return 'folder_managed';
  if (type === 'contract_deadline') return 'schedule';
  if (type === 'holiday_reminder') return 'flag';
  if (type === 'profile_change_request') return 'badge';
  return 'notifications';
}

export function NotificationsBell() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const boutonRef = useRef<HTMLButtonElement>(null);
  const panneauRef = useRef<HTMLDivElement>(null);

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
      const cible = e.target as Node;
      if (boutonRef.current?.contains(cible) || panneauRef.current?.contains(cible)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const unread = page.data?.unreadCount ?? 0;
  const items = page.data?.items ?? [];

  const ouvrir = (n: NotificationView) => {
    if (!n.readAt) markRead.mutate(n.id);
    setOpen(false);
    if (n.link) router.push(n.link);
  };

  return (
    <>
      <button
        ref={boutonRef}
        type="button"
        aria-label={`Notifications${unread > 0 ? ` (${unread} non lues)` : ''}`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        // Sur le bandeau : verre translucide, comme les commandes de la
        // plateforme APIX. L'anneau blanc dit le contour sans peser.
        className={cn(
          'relative flex size-9 shrink-0 items-center justify-center rounded-full border text-hero-ink transition-all duration-200',
          'focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none',
          open
            ? 'border-white/60 bg-white/25'
            : 'border-white/30 bg-white/10 hover:border-white/55 hover:bg-white/20',
        )}
      >
        <Icon name="notifications" size={20} fill={unread > 0} />
        {unread > 0 ? (
          // L'anneau blanc n'est pas un ornement : l'orange de la charte ne
          // fait que 1,4:1 sur le bleu du bandeau. Sans lui, la pastille se
          // fondrait dans la barre. L'encre est l'encre d'accent (4,5:1 sur
          // l'orange), pas du blanc, qui n'y passerait pas.
          <span
            className="absolute -top-[3px] -right-[3px] flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-accent px-[4.5px] text-[10px] leading-none font-extrabold text-accent-ink ring-[1.5px] ring-white"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <PanneauNotifications
          ancre={boutonRef}
          panneauRef={panneauRef}
          items={items}
          unread={unread}
          chargement={page.isLoading}
          onTousLus={() => markAll.mutate()}
          tousLusEnCours={markAll.isPending}
          onOuvrir={ouvrir}
        />
      ) : null}
    </>
  );
}

/**
 * Le panneau vit dans un PORTAIL, pas sous le bouton.
 *
 * Le bandeau porte `overflow: hidden` — ses halos débordent volontairement de
 * son cadre et doivent être rognés. Un panneau déplié depuis l'intérieur du
 * bandeau était donc coupé net sous les 58 px de la barre, quel que soit son
 * `z-index` : ce n'était pas un problème d'empilement mais de découpe. Sorti
 * dans `document.body`, il n'a plus d'ancêtre qui le rogne, et sa position est
 * calculée depuis le bouton.
 */
function PanneauNotifications({
  ancre,
  panneauRef,
  items,
  unread,
  chargement,
  onTousLus,
  tousLusEnCours,
  onOuvrir,
}: {
  ancre: React.RefObject<HTMLButtonElement | null>;
  panneauRef: React.RefObject<HTMLDivElement | null>;
  items: NotificationView[];
  unread: number;
  chargement: boolean;
  onTousLus: () => void;
  tousLusEnCours: boolean;
  onOuvrir: (n: NotificationView) => void;
}) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  const placer = useCallback(() => {
    const r = ancre.current?.getBoundingClientRect();
    if (!r) return;
    // Sous la BARRE, pas sous le bouton : le bouton est centré dans les 58 px
    // du bandeau, un simple décalage depuis son bas ferait mordre le panneau
    // sur le bleu. On descend jusqu'au bord de l'en-tête, puis on respire.
    const barre = ancre.current?.closest('header')?.getBoundingClientRect();
    setPos({
      top: (barre?.bottom ?? r.bottom) + 8,
      right: Math.max(12, window.innerWidth - r.right),
    });
  }, [ancre]);

  // Avant peinture : sans cela le panneau apparaît un instant en haut à gauche.
  useLayoutEffect(placer, [placer]);
  useEffect(() => {
    window.addEventListener('resize', placer);
    return () => window.removeEventListener('resize', placer);
  }, [placer]);

  if (typeof document === 'undefined' || !pos) return null;

  return createPortal(
    <div
      ref={panneauRef}
      role="dialog"
      aria-label="Notifications"
      style={{ top: pos.top, right: pos.right }}
      className={cn(
        'fixed z-[60] w-[23rem] overflow-hidden rounded-[16px] border border-card-line bg-surface shadow-lg',
        // Sur téléphone la fenêtre prend la largeur : un panneau de 368 px
        // calé à droite y dépasserait de l'écran.
        'max-sm:inset-x-3 max-sm:!right-auto max-sm:w-auto',
      )}
    >
      <header className="flex items-center justify-between gap-3 border-b border-line-soft px-4 py-3">
        <div className="flex items-center gap-2">
          <p className="text-[10.5px] font-extrabold tracking-[0.14em] text-primary uppercase">
            Notifications
          </p>
          {unread > 0 ? (
            <span
              className="rounded-full bg-primary/[0.09] px-1.5 py-px text-[10px] font-extrabold text-primary"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {unread}
            </span>
          ) : null}
        </div>
        {unread > 0 ? (
          <button
            type="button"
            onClick={onTousLus}
            disabled={tousLusEnCours}
            className="rounded-full px-2 py-1 text-[11.5px] font-semibold text-primary transition-colors hover:bg-primary/[0.07] disabled:opacity-50"
          >
            Tout marquer lu
          </button>
        ) : null}
      </header>

      <div className="max-h-[26rem] overflow-y-auto overscroll-contain">
        {chargement ? (
          <p className="px-4 py-8 text-center text-[12px] text-ink-muted">Chargement…</p>
        ) : items.length === 0 ? (
          <EmptyState
            className="py-9"
            icon={<Icon name="notifications" size={22} />}
            title="Rien à signaler"
            description="Les demandes, validations et échéances qui vous concernent arriveront ici."
          />
        ) : (
          <ul className="flex flex-col">
            {items.map((n) => {
              const lu = Boolean(n.readAt);
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => onOuvrir(n)}
                    className={cn(
                      'flex w-full items-start gap-3 border-b border-line-soft px-4 py-3 text-left transition-colors last:border-b-0',
                      // Le NON-LU est teinté, pas le lu grisé : rendre l'ancien
                      // illisible pour distinguer le récent punit la mémoire.
                      lu ? 'hover:bg-bg' : 'bg-primary/[0.035] hover:bg-primary/[0.06]',
                    )}
                  >
                    <span
                      className={cn(
                        'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[10px]',
                        lu ? 'bg-bg text-ink-muted' : 'bg-primary/[0.09] text-primary',
                      )}
                    >
                      <Icon name={iconOf(n.type)} size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          'block text-[12.5px] leading-snug',
                          lu ? 'font-semibold text-ink' : 'font-bold text-ink-strong',
                        )}
                      >
                        {n.title}
                      </span>
                      {n.body ? (
                        <span className="mt-0.5 line-clamp-2 block text-[11.5px] leading-snug text-ink-muted">
                          {n.body}
                        </span>
                      ) : null}
                      <span className="mt-1 block text-[10.5px] font-semibold text-ink-muted">
                        {relativeTime(n.createdAt)}
                      </span>
                    </span>
                    {/* La pastille marque le non-lu ; le chevron dit qu'on peut
                        y aller. Jamais les deux : l'un chasserait l'autre. */}
                    <span className="mt-1 flex size-4 shrink-0 items-center justify-center">
                      {lu ? (
                        <Icon name="chevron_right" size={15} className="text-ink-muted/60" />
                      ) : (
                        <span className="size-[7px] rounded-full bg-accent" />
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>,
    document.body,
  );
}
