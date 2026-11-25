'use client';

import { useState } from 'react';
import type { DocumentRequestView } from '@teranga/contracts';
import { MAX_LETTRE_DE_DEMANDE_BYTES } from '@teranga/contracts';
import { cn } from '@teranga/ui';
import { apiUrl } from '../lib/api';
import { lireEnBase64, taille } from '../lib/fichiers';
import { FenetreDocument } from './fenetre-document';
import { Icon } from './icons';

/*
   La lettre de demande (ADR-0189) : une mise en disponibilité, son
   renouvellement et une domiciliation bancaire se demandent par lettre.
   L'agent la joint à sa demande ; qui la traite la lit avant d'établir le
   document.
*/

/** La lettre choisie, prête à partir avec la demande. */
export interface LettreChoisie {
  filename: string;
  contentBase64: string;
  sizeBytes: number;
}

/**
 * Le choix de la lettre : un PDF de 5 Mo au plus, comme les pièces du
 * dossier. Un fichier refusé ne garde pas le précédent : on ne croit pas
 * avoir joint une lettre qui n'est plus là.
 */
export function ChoixDeLaLettre({
  id,
  lettre,
  onChoisir,
  onErreur,
  invalide,
}: {
  id: string;
  lettre: LettreChoisie | null;
  onChoisir: (lettre: LettreChoisie | null) => void;
  /** Le fichier refusé, et pourquoi ; null quand un fichier valable est choisi. */
  onErreur: (message: string | null) => void;
  invalide?: boolean;
}) {
  const choisir = async (fichier: File | null) => {
    onErreur(null);
    onChoisir(null);
    if (!fichier) return;
    if (fichier.type !== 'application/pdf') {
      onErreur('La lettre doit être un PDF');
      return;
    }
    if (fichier.size === 0 || fichier.size > MAX_LETTRE_DE_DEMANDE_BYTES) {
      onErreur('Le PDF est vide ou dépasse 5 Mo');
      return;
    }
    try {
      onChoisir({
        filename: fichier.name,
        contentBase64: await lireEnBase64(fichier),
        sizeBytes: fichier.size,
      });
    } catch (e) {
      onErreur(e instanceof Error ? e.message : 'Impossible de lire ce fichier, réessayez.');
    }
  };
  return (
    <>
      <label
        htmlFor={id}
        className={cn(
          'flex h-10 cursor-pointer items-center gap-2 rounded-controle border bg-surface px-3 text-[13px] transition-colors duration-150',
          lettre
            ? 'border-success/40 text-ink-strong'
            : invalide
              ? 'border-danger text-ink-muted'
              : 'border-line text-ink-muted hover:border-primary/40 hover:text-primary',
        )}
      >
        <Icon
          name={lettre ? 'check_circle' : 'upload_file'}
          size={17}
          className={cn('shrink-0', lettre ? 'text-success' : undefined)}
        />
        <span className="min-w-0 flex-1 truncate">
          {lettre ? `${lettre.filename} · ${taille(lettre.sizeBytes)}` : 'Choisir un fichier'}
        </span>
      </label>
      <input
        id={id}
        type="file"
        accept="application/pdf"
        className="sr-only"
        // Le même fichier, choisi de nouveau après un refus, se relit.
        onClick={(e) => {
          e.currentTarget.value = '';
        }}
        onChange={(e) => void choisir(e.target.files?.[0] ?? null)}
      />
    </>
  );
}

/** Un geste sur la ligne d'une demande : lire sa lettre, générer son document. */
export const GESTE_DE_LA_LIGNE =
  'inline-flex items-center gap-1 rounded-[6px] border border-line px-2.5 py-[3px] text-[11px] font-semibold whitespace-nowrap text-primary transition-colors hover:border-primary/40 hover:bg-primary/[0.07] focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none';

/**
 * La lettre jointe à une demande, à lire dans la fenêtre d'aperçu, pour qui
 * la traite : dans la file et sur la page du document. Sans lettre, rien ne
 * s'affiche.
 */
export function VoirLaLettre({
  demande: r,
  className,
}: {
  demande: Pick<DocumentRequestView, 'id' | 'employeeName' | 'lettre'>;
  className?: string;
}) {
  const [ouverte, setOuverte] = useState(false);
  const lettre = r.lettre;
  if (!lettre) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOuverte(true)}
        title={lettre.filename}
        className={cn(GESTE_DE_LA_LIGNE, className)}
      >
        <Icon name="mail" size={13} className="shrink-0" />
        Lettre de demande
      </button>
      {ouverte ? (
        <FenetreDocument
          doc={{
            url: apiUrl(`/document-requests/${r.id}/lettre`),
            filename: lettre.filename,
            contentType: 'application/pdf',
            titre: `Lettre de demande · ${r.employeeName}`,
          }}
          telechargement={apiUrl(`/document-requests/${r.id}/lettre?download=1`)}
          onClose={() => setOuverte(false)}
        />
      ) : null}
    </>
  );
}
