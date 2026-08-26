'use client';

import * as React from 'react';
import { cn } from '@teranga/ui';
import { useDialogue } from '../lib/dialogue';
import { Icon } from './icons';

/**
 * Fenêtre de saisie — la coquille commune à tous les formulaires du produit.
 *
 * Le parti pris vient de la plateforme APIX : le CORPS est en fond doux et
 * chaque section y est une carte blanche. Les groupes de champs sont ainsi
 * bornés — un formulaire long cesse d'être une colonne d'étiquettes et se lit
 * comme une suite de blocs. L'en-tête et le pied restent blancs, ce qui les
 * détache du corps sans qu'aucun trait n'ait à le dire.
 *
 * Créer une fiche n'est pas quitter la liste : la fenêtre garde la liste
 * visible derrière elle, et la fermer rend exactement l'écran d'où l'on vient.
 */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  enTete,
  footer,
  children,
  maxWidth = 'max-w-3xl',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: React.ReactNode;
  /**
   * Commandes posées sur la MÊME ligne que le titre — navigation, légende.
   * Les descendre dans le corps leur coûterait une bande de soixante pixels
   * que le contenu réclame, et les couperait du titre auquel elles se
   * rapportent.
   */
  enTete?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  maxWidth?: string;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  /**
   * Ne fermer sur le voile que si le clic a COMMENCÉ dessus. Sélectionner du
   * texte dans un champ et relâcher hors de la fenêtre ne doit pas la fermer :
   * un geste de lecture effacerait une saisie de dix minutes.
   */
  const startedOnBackdrop = React.useRef(false);
  const dialog = useDialogue(open);
  const titleId = React.useId();

  if (!open) return null;

  return (
    <div
      onMouseDown={(e) => {
        startedOnBackdrop.current = e.target === e.currentTarget;
      }}
      onMouseUp={(e) => {
        if (startedOnBackdrop.current && e.target === e.currentTarget) onClose();
        startedOnBackdrop.current = false;
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--tg-overlay)] backdrop-blur-[6px] sm:p-6"
    >
      <div
        {...dialog}
        aria-labelledby={titleId}
        className={cn(
          'modal-panel flex h-full w-full flex-col overflow-hidden border-line-soft bg-surface shadow-lg outline-none',
          // Plein écran sur téléphone : une fenêtre flottante y laisserait
          // deux centimètres de contexte inutile de chaque côté.
          'sm:h-auto sm:max-h-[92vh] sm:rounded-[20px] sm:border',
          maxWidth,
        )}
      >
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2.5 border-b border-line-soft px-6 py-4 sm:px-7">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="truncate text-[17px] leading-tight font-bold text-ink-strong"
            >
              {title}
            </h2>
            {subtitle ? <p className="mt-0.5 truncate text-xs text-ink-muted">{subtitle}</p> : null}
          </div>
          {enTete ? (
            <div className="order-last flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 sm:order-none sm:ml-auto">
              {enTete}
            </div>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-bg text-ink-muted transition-colors hover:bg-line-soft hover:text-ink focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
          >
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="flex flex-1 flex-col gap-3 overflow-y-auto bg-bg px-4 pt-4 pb-5 sm:px-[22px]">
          {children}
        </div>

        {footer ? (
          <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2.5 border-t border-line-soft px-4 py-3.5 sm:px-[22px]">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Section de formulaire : une carte blanche sur le fond doux du corps, coiffée
 * d'un intitulé en petites capitales de marque. C'est lui qui donne au
 * formulaire sa scansion — sans quoi vingt champs se suivent sans respirer.
 */
export function ModalSection({
  title,
  extra,
  children,
}: {
  title: string;
  extra?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[14px] border border-line-soft bg-surface px-4 pt-4 pb-[18px] sm:px-[18px]">
      <div className="mb-3.5 flex min-h-5 items-center justify-between gap-3">
        <p className="text-[10.5px] font-extrabold tracking-[0.14em] text-primary uppercase">
          {title}
        </p>
        {extra}
      </div>
      {children}
    </section>
  );
}

/** Grille de champs : deux colonnes, une seule sous 640 px. */
export function ModalGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn('grid grid-cols-1 gap-3.5 sm:grid-cols-2', className)}>{children}</div>;
}
