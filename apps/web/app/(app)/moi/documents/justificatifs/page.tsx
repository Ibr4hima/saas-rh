'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { AbsenceRequestView, MyEmployeeView } from '@teranga/contracts';
import { Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@teranga/ui';
import { api, apiUrl } from '../../../../../lib/api';
import { EmployeeDocumentsCard } from '../../../../../components/employee-documents-card';
import { type ViewableDoc } from '../../../../../components/doc-viewer';
import { FenetreDocument } from '../../../../../components/fenetre-document';
import { Icon } from '../../../../../components/icons';
import { formatDate } from '../../../../../lib/hooks';
import { LoadFailure } from '../../../../../components/load-failure';
import { Page } from '../../../../../components/gabarit';
import { compte } from '../../../../../lib/mots';

/* ————————————————————————————————————————————————————————————————
   « Joindre un justificatif » — ce que l'agent FOURNIT à la Direction du
   Capital Humain : les pièces de son dossier (pièce d'identité, diplômes,
   attestations), qu'elle vérifie avant de les y verser, et les justificatifs
   joints à ses absences.
   ———————————————————————————————————————————————————————————————— */

const TABULAIRE = { fontVariantNumeric: 'tabular-nums' } as const;

export default function JoindreUnJustificatifPage() {
  const [viewedDoc, setViewedDoc] = useState<ViewableDoc | null>(null);

  const myEmployee = useQuery({
    queryKey: ['me-employee'],
    queryFn: () => api<MyEmployeeView>('/me/employee'),
    retry: false,
  });
  const employeeId = myEmployee.data?.employeeId;

  const absences = useQuery({
    queryKey: ['my-requests', employeeId],
    queryFn: () =>
      api<AbsenceRequestView[]>(`/absence-requests?employeeId=${employeeId}&limit=100`),
    enabled: Boolean(employeeId),
  });

  if (myEmployee.isLoading) {
    return (
      <Page>
        <Skeleton className="h-48 w-full rounded-[16px]" />
      </Page>
    );
  }
  if (myEmployee.isError || !myEmployee.data) {
    return <LoadFailure error={myEmployee.error} onRetry={() => void myEmployee.refetch()} />;
  }

  const withDocument = (absences.data ?? []).filter((r) => r.documentName);

  return (
    <Page>
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <EmployeeDocumentsCard employeeId={myEmployee.data.employeeId} depot />

        <Card>
          <CardHeader className="flex items-center justify-between gap-3">
            <CardTitle>Mes justificatifs d&apos;absence</CardTitle>
            {withDocument.length > 0 ? (
              <span className="shrink-0 text-[11.5px] text-ink-muted" style={TABULAIRE}>
                {compte(withDocument.length, 'pièce')}
              </span>
            ) : null}
          </CardHeader>
          <CardContent className="px-2 pb-2">
            {absences.isLoading ? (
              <div className="flex flex-col gap-3 px-3 py-1">
                {[0, 1].map((i) => (
                  <Skeleton key={i} className="h-3 w-56" />
                ))}
              </div>
            ) : withDocument.length === 0 ? (
              <p className="flex items-start gap-2.5 px-3 py-2.5 text-[12px] leading-snug text-ink-muted">
                <Icon name="upload_file" size={17} className="mt-px shrink-0 text-ink-muted/60" />
                Aucun justificatif joint.
              </p>
            ) : (
              <ul className="flex flex-col">
                {withDocument.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[11px] px-3 py-3 transition-colors duration-150 hover:bg-hover"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-primary/[0.07] text-primary">
                      <Icon name="description" size={17} />
                    </span>
                    <div className="min-w-0 flex-1 basis-48">
                      <p className="truncate text-[12.5px] font-semibold text-ink-strong">
                        {r.documentName}
                      </p>
                      <p className="mt-0.5 truncate text-[11.5px] text-ink-muted" style={TABULAIRE}>
                        {r.absenceTypeName} · {formatDate(r.startDate)} → {formatDate(r.endDate)}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="ml-auto shrink-0"
                      onClick={() =>
                        setViewedDoc({
                          url: apiUrl(`/absence-requests/${r.id}/document`),
                          filename: r.documentName!,
                          contentType: 'application/pdf',
                          titre: 'Justificatif',
                        })
                      }
                    >
                      Aperçu
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <FenetreDocument doc={viewedDoc} onClose={() => setViewedDoc(null)} />
    </Page>
  );
}
