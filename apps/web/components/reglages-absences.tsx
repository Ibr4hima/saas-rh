'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@teranga/ui';
import { Icon } from './icons';
import { Modal, ModalSection } from './modal';
import { api, ApiError } from '../lib/api';

/**
 * Ce que les écrans de paramétrage des congés ont en commun — les types
 * d'absences et les jours fériés se règlent sur deux pages, avec les mêmes
 * gestes de ligne et la même fenêtre de retrait.
 */

export function messageErreur(err: unknown, defaut: string): string {
  return err instanceof ApiError ? err.message : defaut;
}

/**
 * Deux gestes par ligne, en gris tant qu'on ne les vise pas.
 *
 * Ils ne se cachent PAS jusqu'au survol : une ligne qui n'offre rien à voir
 * laisse croire qu'elle ne se modifie pas — et c'est précisément ce que dit,
 * elle, la mention « Date fixe » des six dates civiles. Le contraste entre les
 * deux ne tient que si les autres lignes montrent leurs gestes.
 */
export function Actions({
  nom,
  onModifier,
  onSupprimer,
}: {
  nom: string;
  /** Omis quand la ligne se retire mais ne se modifie pas (date civile). */
  onModifier?: () => void;
  onSupprimer: () => void;
}) {
  const base =
    'inline-flex size-7 items-center justify-center rounded-md text-ink-muted transition-colors duration-150';
  return (
    <div className="flex items-center justify-end gap-0.5">
      {onModifier ? (
        <button
          type="button"
          aria-label={`Modifier ${nom}`}
          className={`${base} hover:bg-primary-soft hover:text-primary`}
          onClick={onModifier}
        >
          <Icon name="edit" size={16} />
        </button>
      ) : null}
      <button
        type="button"
        aria-label={`Retirer ${nom}`}
        className={`${base} hover:bg-danger-soft hover:text-danger`}
        onClick={onSupprimer}
      >
        <Icon name="delete" size={16} />
      </button>
    </div>
  );
}

export function FenetreSuppression({
  titre,
  nom,
  bouton,
  chemin,
  onClose,
  onSupprime,
  children,
}: {
  titre: string;
  nom: string;
  bouton: string;
  chemin: string;
  onClose: () => void;
  onSupprime: () => void;
  children: React.ReactNode;
}) {
  const [erreur, setErreur] = React.useState<string | null>(null);
  const supprimer = useMutation({
    mutationFn: () => api(chemin, { method: 'DELETE' }),
    onSuccess: onSupprime,
    onError: (err) => setErreur(messageErreur(err, 'Suppression impossible.')),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={titre}
      subtitle={nom}
      maxWidth="max-w-lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant="danger"
            loading={supprimer.isPending}
            onClick={() => {
              setErreur(null);
              supprimer.mutate();
            }}
          >
            {bouton}
          </Button>
        </>
      }
    >
      {erreur ? (
        <p className="rounded-[9px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{erreur}</p>
      ) : null}
      <ModalSection title="Ce que ça change">{children}</ModalSection>
    </Modal>
  );
}
