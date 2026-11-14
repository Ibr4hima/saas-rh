'use client';

import type { ProfileChangeRequestView } from '@teranga/contracts';
import { apiUrl } from '../lib/api';
import type { ViewableDoc } from './doc-viewer';

/**
 * Le certificat de mariage joint à un passage à « Marié(e) », à lire avant de
 * décider (ADR-0080) : le bouton de la colonne « Justificatif ». Le serveur
 * ne le décrit qu'à qui peut le lire, et tant que la demande attend : sans
 * lui, rien ne s'affiche.
 */
export function PrevisualiserCertificat({
  demande: r,
  onOuvrir,
}: {
  demande: ProfileChangeRequestView;
  onOuvrir: (doc: ViewableDoc) => void;
}) {
  const certificat = r.certificat;
  if (!certificat) return null;
  return (
    <button
      type="button"
      onClick={() =>
        onOuvrir({
          url: apiUrl(`/profile-changes/${r.id}/certificat`),
          filename: certificat.filename,
          contentType: 'application/pdf',
          titre: `Certificat de mariage · ${r.employeeName}`,
        })
      }
      title={certificat.filename}
      className="inline-flex items-center rounded-[6px] border border-line px-2.5 py-[3px] text-[11px] font-semibold text-primary transition-colors hover:border-primary/40 hover:bg-primary/[0.07] focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
    >
      Prévisualiser
    </button>
  );
}
