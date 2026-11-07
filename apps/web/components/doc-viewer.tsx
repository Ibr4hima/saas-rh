'use client';

import { useEffect, useState } from 'react';
import { Button, cn, Skeleton } from '@teranga/ui';
import { ApiError, erreurDe } from '../lib/api';
import { PdfViewer } from './pdf-viewer';

export interface ViewableDoc {
  /** URL API absolue du binaire (servie avec le cookie de session). */
  url: string;
  filename: string;
  contentType: string;
  /**
   * Ce que la pièce EST — « Curriculum Vitæ ». Quand l'appelant le connaît, le
   * lecteur l'affiche plutôt que le nom du fichier : « attestation-travail-
   * SF120099.pdf » est le classement de quelqu'un d'autre, pas une
   * information pour celui qui lit.
   */
  titre?: string | null;
}

/**
 * Le document lui-même, sans cadre ni commandes.
 *
 * Extrait de `DocViewer` pour pouvoir être posé AILLEURS que dans une
 * surcouche plein écran — une fenêtre de dossier, par exemple, où l'aperçu
 * n'est pas un détour mais le contenu principal. Le fichier est récupéré en
 * blob avec la session : pas de téléchargement forcé, et pas de dépendance
 * aux cookies tiers d'une iframe.
 */
export function ApercuDocument({ doc, className }: { doc: ViewableDoc; className?: string }) {
  const [contenu, setContenu] = useState<{ blobUrl: string; data: ArrayBuffer } | null>(null);
  const [error, setError] = useState<{ titre: string; detail?: string } | null>(null);

  // Le fichier se recharge quand l'ADRESSE change, pas à chaque rendu de la
  // page qui l'ouvre : un objet `doc` recréé à chaque rendu rechargeait le
  // document, et l'aperçu repassait par le squelette sous les yeux.
  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    setContenu(null);
    setError(null);
    fetch(doc.url, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw await erreurDe(res);
        const blob = await res.blob();
        const data = await blob.arrayBuffer();
        if (cancelled) return;
        revoked = URL.createObjectURL(blob);
        setContenu({ blobUrl: revoked, data });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        // Un refus se dit dans les mots de l'API : une attestation de
        // travail réservée aux agents en activité, par exemple. Une panne,
        // d'une phrase.
        const p = e instanceof ApiError ? e.problem : null;
        setError(
          p && p.status >= 400 && p.status < 500 && !p.title.startsWith('Erreur ')
            ? { titre: p.title, detail: p.detail }
            : { titre: 'Impossible de charger le document.' },
        );
      });
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [doc.url]);

  const isImage = doc.contentType.startsWith('image/');
  const isPdf = doc.contentType === 'application/pdf';

  return (
    <div className={cn('h-full bg-bg', !isPdf && 'overflow-auto', className)}>
      {error ? (
        <div className="p-8 text-center">
          <p className="text-sm font-semibold text-danger">{error.titre}</p>
          {error.detail ? (
            <p className="mt-1 text-[12.5px] text-ink-muted">{error.detail}</p>
          ) : null}
        </div>
      ) : !contenu ? (
        <div className="p-6">
          <Skeleton className="h-64 w-full" />
        </div>
      ) : isPdf ? (
        // Notre propre lecteur : le cadre du navigateur affichait une barre
        // noire et, pour titre, l'identifiant du blob.
        <PdfViewer
          data={contenu.data}
          titre={doc.titre === null ? undefined : (doc.titre ?? doc.filename)}
        />
      ) : isImage ? (
        <div className="flex min-h-full items-center justify-center p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={contenu.blobUrl}
            alt={doc.filename}
            className="max-w-full rounded-md shadow-sm"
          />
        </div>
      ) : (
        <div className="flex min-h-full flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="text-sm text-ink-muted">
            Aperçu indisponible pour ce format ({doc.contentType}).
          </p>
          <a href={contenu.blobUrl} download={doc.filename}>
            <Button variant="secondary">Télécharger {doc.filename}</Button>
          </a>
        </div>
      )}
    </div>
  );
}
