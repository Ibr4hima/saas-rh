'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { CertificateSummary } from '@teranga/contracts';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, cn, Skeleton } from '@teranga/ui';
import { FOND_COUVERTURE, pourcent, STATUTS_CERTIFICAT } from '../lib/academy';
import { api, apiUrl } from '../lib/api';
import { formatDate } from '../lib/hooks';
import { FenetreDocument } from './fenetre-document';
import { Icon } from './icons';

/* ————————————————————————————————————————————————————————————————
   Les certificats d'APIX Academy, à l'écran.

   Un certificat se CONSULTE dans l'aperçu du produit — comme toute pièce —
   et se télécharge de là. Son authenticité se vérifie par le QR code
   imprimé dessus : un recruteur ou un partenaire le scanne, sans compte.
   ———————————————————————————————————————————————————————————————— */

export function ApercuCertificat({
  certificat,
  onClose,
}: {
  certificat: CertificateSummary;
  onClose: () => void;
}) {
  return (
    <FenetreDocument
      doc={{
        url: apiUrl(`/academy/certificats/${certificat.id}/pdf?disposition=inline`),
        filename: `Certificat ${certificat.number}.pdf`,
        contentType: 'application/pdf',
        titre: `Certificat — ${certificat.courseTitle}`,
      }}
      sousTitre={`N° ${certificat.number}`}
      telechargement={apiUrl(`/academy/certificats/${certificat.id}/pdf`)}
      onClose={onClose}
    />
  );
}

/** Une ligne par certificat : la formation, la date, le score, le statut. */
export function ListeCertificats({
  certificats,
  compact = false,
}: {
  certificats: CertificateSummary[];
  compact?: boolean;
}) {
  const [ouvert, setOuvert] = useState<CertificateSummary | null>(null);
  return (
    <>
      <ul className="flex flex-col">
        {certificats.map((c) => {
          const statut = STATUTS_CERTIFICAT[c.status];
          return (
            <li
              key={c.id}
              className="flex flex-col gap-2 border-b border-line-soft py-3 last:border-b-0 sm:flex-row sm:items-center sm:gap-4"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span
                  className="grid size-9 shrink-0 place-items-center rounded-[10px] text-white"
                  style={{ background: FOND_COUVERTURE }}
                >
                  <Icon name="workspace_premium" size={19} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-bold text-ink-strong">
                    {c.courseTitle}
                  </span>
                  <span className="block text-[11.5px] text-ink-muted">
                    Obtenu le {formatDate(c.issuedAt)} · {pourcent(c.score)}
                    {c.expiresAt ? ` · jusqu’au ${formatDate(c.expiresAt)}` : ''}
                    {!compact ? (
                      <>
                        {' · '}
                        <span className="font-mono tracking-tight">{c.number}</span>
                      </>
                    ) : null}
                  </span>
                </span>
              </div>
              <div className={cn('flex flex-wrap items-center gap-1.5 pl-12 sm:pl-0')}>
                <Badge tone={statut.tone}>{statut.label}</Badge>
                <Button variant="secondary" size="sm" onClick={() => setOuvert(c)}>
                  <Icon name="visibility" size={15} />
                  Voir
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      {ouvert ? <ApercuCertificat certificat={ouvert} onClose={() => setOuvert(null)} /> : null}
    </>
  );
}

/**
 * Les certificats d'un agent, dans son dossier : ce que la RH consulte
 * quand on lui demande qui est formé à quoi.
 */
export function CarteCertificatsAgent({ employeeId }: { employeeId: string }) {
  const certificats = useQuery({
    queryKey: ['academy', 'certificats', employeeId],
    queryFn: () => api<CertificateSummary[]>(`/academy/employees/${employeeId}/certificats`),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>APIX Academy — certificats</CardTitle>
      </CardHeader>
      <CardContent>
        {certificats.isPending ? (
          <Skeleton className="h-12 w-full" />
        ) : !certificats.data || certificats.data.length === 0 ? (
          <p className="text-[12.5px] text-ink-muted">
            Aucun certificat pour l’instant. Ils apparaissent ici dès qu’une évaluation finale est
            réussie.
          </p>
        ) : (
          <ListeCertificats certificats={certificats.data} compact />
        )}
      </CardContent>
    </Card>
  );
}
