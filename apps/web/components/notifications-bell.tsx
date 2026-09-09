'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { NotificationScope, NotificationView, NotificationsPage } from '@teranga/contracts';
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
  const [vue, setVue] = useState<NotificationScope>('inbox');
  const boutonRef = useRef<HTMLButtonElement>(null);
  const panneauRef = useRef<HTMLDivElement>(null);

  const page = useQuery({
    queryKey: ['notifications', vue],
    queryFn: () => api<NotificationsPage>(`/notifications?scope=${vue}`),
    refetchInterval: 60_000,
  });

  // Toutes les écritures rafraîchissent LES DEUX vues : ranger fait sortir la
  // ligne d'un côté et entrer de l'autre — n'en rafraîchir qu'une laisserait
  // l'onglet d'en face mentir jusqu'au prochain sondage. La clé sans portée
  // (`['notifications']`) est le PRÉFIXE des deux : elle les invalide toutes.
  const rafraichir = () => void queryClient.invalidateQueries({ queryKey: ['notifications'] });

  const markRead = useMutation({
    mutationFn: (id: string) => api(`/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: rafraichir,
  });
  const markAll = useMutation({
    mutationFn: () => api('/notifications/read-all', { method: 'POST' }),
    onSuccess: rafraichir,
  });
  const ranger = useMutation({
    mutationFn: (ids: string[]) => api('/notifications/archive', { method: 'POST', body: { ids } }),
    onSuccess: rafraichir,
  });
  const ressortir = useMutation({
    mutationFn: (ids: string[]) =>
      api('/notifications/unarchive', { method: 'POST', body: { ids } }),
    onSuccess: rafraichir,
  });
  const toutArchiver = useMutation({
    mutationFn: () => api('/notifications/archive-all', { method: 'POST' }),
    onSuccess: rafraichir,
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

  const fermer = () => {
    setOpen(false);
    // On rouvre toujours sur la boîte : les archives sont un détour, pas un
    // état dans lequel on laisse quelqu'un sans qu'il s'en souvienne.
    setVue('inbox');
  };

  const ouvrir = (n: NotificationView) => {
    if (!n.readAt) markRead.mutate(n.id);
    fermer();
    if (n.link) router.push(n.link);
  };

  return (
    <>
      <button
        ref={boutonRef}
        type="button"
        aria-label={`Notifications${unread > 0 ? ` (${unread} non lues)` : ''}`}
        aria-expanded={open}
        onClick={() => (open ? fermer() : setOpen(true))}
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
        {unread > 0 ? <Pastille valeur={unread} /> : null}
      </button>

      {open ? (
        <PanneauNotifications
          ancre={boutonRef}
          panneauRef={panneauRef}
          items={items}
          unread={unread}
          archivees={page.data?.archivedCount ?? 0}
          vue={vue}
          onVue={setVue}
          chargement={page.isPending}
          onTousLus={() => markAll.mutate()}
          tousLusEnCours={markAll.isPending}
          onArchiver={(ids) => ranger.mutate(ids)}
          onRessortir={(ids) => ressortir.mutate(ids)}
          onToutArchiver={() => toutArchiver.mutate()}
          archivageEnCours={ranger.isPending || toutArchiver.isPending}
          onOuvrir={ouvrir}
          onFermer={fermer}
        />
      ) : null}
    </>
  );
}

/**
 * Le compteur d'avis en attente, posé sur le bandeau.
 *
 * Aplat rouge PÂLE et chiffre foncé — le badge est clair partout, et ne change
 * que de palier selon le fond (voir `--tg-alert-*` dans tokens.css). Le liseré
 * sombre n'est pas un ornement : la pastille mord sur le bouton en verre, dont
 * le fond remonte jusqu'à 25 % de blanc, où un aplat pâle tomberait à 2,4:1.
 */
function Pastille({ valeur }: { valeur: number }) {
  return (
    <span
      className="absolute -top-[3px] -right-[3px] flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-alert-hero px-[4.5px] text-[10px] leading-none font-extrabold text-alert-hero-ink ring-2 ring-[var(--tg-alert-ring)]"
      style={{ fontVariantNumeric: 'tabular-nums' }}
    >
      {valeur > 99 ? '99+' : valeur}
    </span>
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
  archivees,
  vue,
  onVue,
  chargement,
  onTousLus,
  tousLusEnCours,
  onArchiver,
  onRessortir,
  onToutArchiver,
  archivageEnCours,
  onOuvrir,
  onFermer,
}: {
  ancre: React.RefObject<HTMLButtonElement | null>;
  panneauRef: React.RefObject<HTMLDivElement | null>;
  items: NotificationView[];
  unread: number;
  archivees: number;
  vue: NotificationScope;
  onVue: (v: NotificationScope) => void;
  chargement: boolean;
  onTousLus: () => void;
  tousLusEnCours: boolean;
  onArchiver: (ids: string[]) => void;
  onRessortir: (ids: string[]) => void;
  onToutArchiver: () => void;
  archivageEnCours: boolean;
  onOuvrir: (n: NotificationView) => void;
  onFermer: () => void;
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

  const archive = vue === 'archive';

  return createPortal(
    <>
      {/* Le voile floute la page pour que le panneau ressorte. Il ferme aussi
          au clic — le gestionnaire global le ferait, mais un voile qui ne
          répond pas au clic passe pour un écran figé. */}
      <div
        aria-hidden
        onClick={onFermer}
        className="notif-voile fixed inset-0 z-[55]"
        style={{ top: pos.top - 8 }}
      />
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
        {/* L'en-tête tient sur deux lignes de rôles distincts : le titre et
            les deux commandes de masse d'abord, la navigation entre les deux
            vues ensuite, sur toute la largeur. L'ancienne disposition mêlait
            les trois sur deux rangs irréguliers — le titre poussait les
            onglets contre le bord, et les commandes formaient une deuxième
            ligne orpheline qui apparaissait et disparaissait sous eux. */}
        <header className="border-b border-line-soft px-3 pt-2.5 pb-3">
          <div className="flex h-7 items-center justify-between gap-3 pl-1">
            <p className="text-[10.5px] font-extrabold tracking-[0.14em] text-primary uppercase">
              Notifications
            </p>
            {!archive ? (
              <div className="flex items-center gap-0.5">
                {unread > 0 ? (
                  <ActionEntete
                    onClick={onTousLus}
                    disabled={tousLusEnCours}
                    icone="check"
                    libelle="Tout marquer lu"
                  />
                ) : null}
                {items.length > 0 ? (
                  <ActionEntete
                    onClick={onToutArchiver}
                    disabled={archivageEnCours}
                    icone="archive"
                    libelle="Tout archiver"
                  />
                ) : null}
              </div>
            ) : null}
          </div>
          {/* Deux vues, jamais plus : ce qui reste à voir, ce qu'on a archivé. */}
          <div className="mt-2 flex items-center gap-1 rounded-full bg-bg p-0.5">
            <Onglet actif={!archive} onClick={() => onVue('inbox')} compte={unread}>
              Boîte
            </Onglet>
            <Onglet actif={archive} onClick={() => onVue('archive')} compte={archivees}>
              Archives
            </Onglet>
          </div>
        </header>

        <div className="max-h-[26rem] overflow-y-auto overscroll-contain">
          {chargement ? (
            <p className="px-4 py-8 text-center text-[12px] text-ink-muted">Chargement…</p>
          ) : items.length === 0 ? (
            <EmptyState
              className="py-9"
              icon={<Icon name={archive ? 'archive' : 'notifications'} size={22} />}
              title={archive ? 'Aucune archive' : 'Rien à signaler'}
              description={
                archive
                  ? undefined
                  : 'Les demandes, validations et échéances qui vous concernent arriveront ici.'
              }
            />
          ) : (
            <ul className="flex flex-col">
              {items.map((n) => {
                const lu = Boolean(n.readAt);
                return (
                  <li
                    key={n.id}
                    className={cn(
                      'group flex items-start border-b border-line-soft transition-colors last:border-b-0',
                      // Le NON-LU est teinté, pas le lu grisé : rendre l'ancien
                      // illisible pour distinguer le récent punit la mémoire.
                      lu ? 'hover:bg-bg' : 'bg-primary/[0.035] hover:bg-primary/[0.06]',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onOuvrir(n)}
                      className="flex min-w-0 flex-1 items-start gap-3 py-3 pl-4 text-left"
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
                    </button>
                    {/* La pastille marque le non-lu ; le chevron dit qu'on peut
                        y aller. Jamais les deux : l'un chasserait l'autre. */}
                    <span className="flex shrink-0 items-center gap-0.5 py-3 pr-2 pl-1">
                      <span className="flex size-4 items-center justify-center">
                        {lu ? (
                          <Icon name="chevron_right" size={15} className="text-ink-muted/60" />
                        ) : (
                          <span className="size-[7px] rounded-full bg-alert" />
                        )}
                      </span>
                      <Archiver
                        archive={archive}
                        titre={n.title}
                        onClick={() => (archive ? onRessortir([n.id]) : onArchiver([n.id]))}
                      />
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}

/** Onglet : le compte fait partie de l'étiquette, pas d'un badge posé à côté. */
function Onglet({
  actif,
  onClick,
  compte,
  children,
}: {
  actif: boolean;
  onClick: () => void;
  compte: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={actif}
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11.5px] font-bold transition-colors',
        actif ? 'bg-surface text-primary shadow-sm' : 'text-ink-muted hover:text-ink',
      )}
    >
      {children}
      {compte > 0 ? (
        <span
          className="rounded-full bg-alert-soft px-1.5 py-px text-[10px] leading-none font-extrabold text-alert-text"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {compte > 99 ? '99+' : compte}
        </span>
      ) : null}
    </button>
  );
}

/**
 * Commande de masse. L'intitulé n'est pas écrit dans le bouton mais porté par
 * l'infobulle et le nom accessible : à deux commandes côte à côte dans une
 * en-tête de 336 px, « Tout marquer lu » et « Tout archiver » écrits en toutes
 * lettres mangeaient la ligne et laissaient les onglets sans place.
 */
function ActionEntete({
  onClick,
  disabled,
  icone,
  libelle,
}: {
  onClick: () => void;
  disabled: boolean;
  icone: IconName;
  libelle: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={libelle}
      title={libelle}
      className="flex size-7 items-center justify-center rounded-lg text-primary transition-colors hover:bg-primary/[0.09] focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none disabled:opacity-50"
    >
      <Icon name={icone} size={16} />
    </button>
  );
}

/**
 * Archiver une ligne — ou la ressortir.
 *
 * Le bouton reste discret au repos et se révèle au survol : une colonne
 * d'icônes toujours pleine ferait dix boutons visibles pour un geste qu'on
 * fait rarement. Au clavier et au doigt il n'y a pas de survol — d'où
 * `group-focus-within` et l'affichage permanent sous 640 px.
 */
function Archiver({
  archive,
  titre,
  onClick,
}: {
  archive: boolean;
  titre: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={archive ? `Remettre « ${titre} » dans la boîte` : `Archiver « ${titre} »`}
      title={archive ? 'Remettre dans la boîte' : 'Archiver'}
      className={cn(
        'flex size-7 items-center justify-center rounded-lg text-ink-muted transition-all',
        'hover:bg-primary/[0.09] hover:text-primary',
        'focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none',
        'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 max-sm:opacity-100',
      )}
    >
      <Icon name={archive ? 'unarchive' : 'archive'} size={16} />
    </button>
  );
}
