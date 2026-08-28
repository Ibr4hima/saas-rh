'use client';

import { useEffect, useState } from 'react';
import { Button, Skeleton } from '@teranga/ui';

export interface ViewableDoc {
  /** URL API absolue du binaire (servie avec le cookie de session). */
  url: string;
  filename: string;
  contentType: string;
}

/**
 * Aperçu de document dans la page (PDF via le lecteur du navigateur, images
 * en direct) : le fichier est récupéré en blob avec la session — pas de
 * téléchargement forcé, pas de dépendance aux cookies d'iframe.
 */
export function DocViewer({ doc, onClose }: { doc: ViewableDoc | null; onClose: () => void }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!doc) return;
    let revoked: string | null = null;
    let cancelled = false;
    setBlobUrl(null);
    setError(null);
    fetch(doc.url, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (cancelled) return;
        revoked = URL.createObjectURL(blob);
        setBlobUrl(revoked);
      })
      .catch(() => {
        if (!cancelled) setError('Impossible de charger le document.');
      });
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [doc]);

  useEffect(() => {
    if (!doc) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doc, onClose]);

  if (!doc) return null;
  const isImage = doc.contentType.startsWith('image/');
  const previewable = isImage || doc.contentType === 'application/pdf';

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/60 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Aperçu de ${doc.filename}`}
      onClick={onClose}
    >
      <div
        className="mx-auto flex h-full w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-surface shadow-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink-strong">
            {doc.filename}
          </p>
          {blobUrl ? (
            <a href={blobUrl} download={doc.filename}>
              <Button size="sm" variant="secondary">
                Télécharger
              </Button>
            </a>
          ) : null}
          <Button size="sm" variant="ghost" onClick={onClose}>
            Fermer ✕
          </Button>
        </div>
        <div className="flex-1 overflow-auto bg-bg">
          {error ? (
            <p className="p-8 text-center text-sm text-danger">{error}</p>
          ) : !blobUrl ? (
            <div className="p-6">
              <Skeleton className="h-64 w-full" />
            </div>
          ) : !previewable ? (
            <div className="flex min-h-full flex-col items-center justify-center gap-3 p-8 text-center">
              <p className="text-sm text-ink-muted">
                Aperçu indisponible pour ce format ({doc.contentType}).
              </p>
              <a href={blobUrl} download={doc.filename}>
                <Button variant="secondary">Télécharger {doc.filename}</Button>
              </a>
            </div>
          ) : isImage ? (
            <div className="flex min-h-full items-center justify-center p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={blobUrl} alt={doc.filename} className="max-w-full rounded-md shadow-sm" />
            </div>
          ) : (
            <iframe src={blobUrl} title={doc.filename} className="h-full w-full border-0" />
          )}
        </div>
      </div>
    </div>
  );
}
