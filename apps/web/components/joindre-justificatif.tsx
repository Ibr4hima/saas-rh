'use client';

import { useMutation } from '@tanstack/react-query';
import { useId } from 'react';
import type { AbsenceRequestView } from '@teranga/contracts';
import { cn } from '@teranga/ui';
import { api, ApiError } from '../lib/api';

/*
 * Le justificatif qui suit la demande : un certificat médical arrive après
 * l'arrêt. L'agent le joint, qui a saisi pour lui, ou la DCH. Tant qu'il
 * manque à un type qui l'exige, le bouton est orange : la demande l'attend.
 */

const MAX_OCTETS = 5 * 1024 * 1024;

function lireEnBase64(fichier: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const lecteur = new FileReader();
    lecteur.onload = () => resolve(String(lecteur.result).split(',')[1] ?? '');
    lecteur.onerror = () => reject(new Error('Impossible de lire ce fichier, réessayez.'));
    lecteur.readAsDataURL(fichier);
  });
}

export function JoindreJustificatif({
  demande: r,
  onFait,
  onErreur,
}: {
  demande: AbsenceRequestView;
  onFait: () => void;
  onErreur: (texte: string) => void;
}) {
  const id = useId();
  const joindre = useMutation({
    mutationFn: async (fichier: File) => {
      if (fichier.type !== 'application/pdf') throw new Error('Le justificatif doit être un PDF.');
      if (fichier.size === 0 || fichier.size > MAX_OCTETS) {
        throw new Error('Le PDF doit faire 5 Mo au plus.');
      }
      return api(`/absence-requests/${r.id}/document`, {
        method: 'POST',
        body: { filename: fichier.name, contentBase64: await lireEnBase64(fichier) },
      });
    },
    onSuccess: onFait,
    onError: (err) =>
      onErreur(err instanceof ApiError || err instanceof Error ? err.message : 'Envoi impossible.'),
  });
  if (!r.gestes.joindreJustificatif) return null;
  return (
    <>
      <label
        htmlFor={id}
        aria-disabled={joindre.isPending}
        className={cn(
          'inline-flex cursor-pointer items-center rounded-full border px-2.5 py-[3px] text-[11px] font-semibold transition-colors focus-within:ring-2 focus-within:ring-primary',
          r.justificatifAttendu
            ? 'border-badge-orange-line text-badge-orange-ink hover:bg-accent-soft'
            : 'border-line text-primary hover:border-primary/40 hover:bg-primary/[0.07]',
          joindre.isPending && 'pointer-events-none opacity-60',
        )}
      >
        {r.documentName ? 'Remplacer' : 'Joindre'}
      </label>
      <input
        id={id}
        type="file"
        accept="application/pdf"
        className="sr-only"
        onChange={(e) => {
          const fichier = e.target.files?.[0];
          e.target.value = '';
          if (fichier) joindre.mutate(fichier);
        }}
      />
    </>
  );
}
