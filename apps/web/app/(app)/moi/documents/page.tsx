'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import type {
  AbsenceRequestView,
  DocumentRequestView,
  MyEmployeeView,
  RequestableDoc,
} from '@teranga/contracts';
import { REQUESTABLE_DOC_LABELS } from '@teranga/contracts';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Skeleton,
} from '@teranga/ui';
import { api, ApiError, apiUrl } from '../../../../lib/api';
import { EmployeeDocumentsCard } from '../../../../components/employee-documents-card';
import { DocumentRequestRow } from '../../../../components/document-request-list';
import { DocViewer, type ViewableDoc } from '../../../../components/doc-viewer';
import { formatDate } from '../../../../lib/hooks';

const REQUESTABLE: RequestableDoc[] = [
  'attestation_travail',
  'contrat_travail',
  'bulletin_salaire',
  'attestation_salaire',
  'certificat_travail',
  'autre',
];

export default function MyDocumentsPage() {
  const queryClient = useQueryClient();
  const [viewedDoc, setViewedDoc] = useState<ViewableDoc | null>(null);
  const [selected, setSelected] = useState<RequestableDoc[]>([]);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

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

  const docRequests = useQuery({
    // scope=mine : l'espace personnel reste personnel même pour un membre RH.
    queryKey: ['document-requests', 'me'],
    queryFn: () => api<DocumentRequestView[]>('/document-requests?scope=mine'),
  });

  const submit = useMutation({
    mutationFn: () =>
      api('/document-requests', {
        method: 'POST',
        body: { docTypes: selected, note: note.trim() || undefined },
      }),
    onSuccess: () => {
      setSelected([]);
      setNote('');
      setError(null);
      setSent(true);
      void queryClient.invalidateQueries({ queryKey: ['document-requests'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Envoi impossible.'),
  });

  if (myEmployee.isLoading) {
    return (
      <div className="mx-auto max-w-2xl">
        <Skeleton className="mb-4 h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (myEmployee.isError || !myEmployee.data) {
    const message =
      myEmployee.error instanceof ApiError ? myEmployee.error.message : 'Chargement impossible.';
    return <p className="text-sm text-danger">{message}</p>;
  }

  const emp = myEmployee.data;
  const withDocument = (absences.data ?? []).filter((r) => r.documentName);
  const toggle = (doc: RequestableDoc) =>
    setSelected(selected.includes(doc) ? selected.filter((d) => d !== doc) : [...selected, doc]);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <Link href="/moi" className="text-sm text-ink-muted hover:text-ink">
          ← Mon espace
        </Link>
        <h1 className="mt-1 text-xl font-bold text-ink-strong">Mes documents</h1>
        <p className="text-sm text-ink-muted">
          Demandez vos documents administratifs et suivez leur traitement.
        </p>
      </div>

      <div className="flex flex-col gap-6">
        {/* Demander des documents */}
        <Card>
          <CardHeader>
            <CardTitle>Demander un document</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-ink-muted">
              Cochez ce dont vous avez besoin. La Direction du Capital Humain prépare les documents,
              les signe et les cachette : vous serez prévenu·e dès qu&apos;ils seront à retirer.
            </p>
            <div className="flex flex-wrap gap-2">
              {REQUESTABLE.map((doc) => (
                <button
                  key={doc}
                  type="button"
                  onClick={() => {
                    setSent(false);
                    toggle(doc);
                  }}
                  className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                    selected.includes(doc)
                      ? 'border-primary bg-primary-soft font-medium text-primary'
                      : 'border-line text-ink-muted hover:border-ink-muted/40'
                  }`}
                >
                  {selected.includes(doc) ? '✓ ' : ''}
                  {REQUESTABLE_DOC_LABELS[doc]}
                </button>
              ))}
            </div>
            <Field label="Précision (facultatif)" htmlFor="doc-note">
              <Input
                id="doc-note"
                placeholder="Ex : bulletin de juillet 2026, pour un dossier bancaire"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
            {error ? (
              <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
            ) : null}
            {sent ? (
              <p className="rounded-md bg-success-soft px-3 py-2 text-sm text-success">
                Demande envoyée — la Direction du Capital Humain a été prévenue.
              </p>
            ) : null}
            <Button
              disabled={selected.length === 0}
              loading={submit.isPending}
              onClick={() => submit.mutate()}
            >
              Envoyer ma demande
            </Button>
          </CardContent>
        </Card>

        {/* Suivi de mes demandes */}
        <Card>
          <CardHeader>
            <CardTitle>Suivi de mes demandes</CardTitle>
          </CardHeader>
          <CardContent>
            {docRequests.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : (docRequests.data ?? []).length === 0 ? (
              <p className="text-sm text-ink-muted">
                Aucune demande pour le moment — votre historique apparaîtra ici.
              </p>
            ) : (
              <ul className="flex flex-col">
                {docRequests.data!.map((r) => (
                  <DocumentRequestRow key={r.id} request={r} showEmployee={false} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <EmployeeDocumentsCard employeeId={emp.employeeId} />

        <Card>
          <CardHeader>
            <CardTitle>Mes justificatifs d&apos;absence</CardTitle>
          </CardHeader>
          <CardContent>
            {absences.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : withDocument.length === 0 ? (
              <p className="text-sm text-ink-muted">
                Aucun justificatif pour le moment — ils apparaissent ici quand vous joignez un PDF à
                une demande (maladie, mission…).
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {withDocument.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-ink-strong">{r.documentName}</p>
                      <p className="text-xs text-ink-muted">
                        {r.absenceTypeName} · {formatDate(r.startDate)} → {formatDate(r.endDate)}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="shrink-0"
                      onClick={() =>
                        setViewedDoc({
                          url: apiUrl(`/absence-requests/${r.id}/document`),
                          filename: r.documentName!,
                          contentType: 'application/pdf',
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

      <DocViewer doc={viewedDoc} onClose={() => setViewedDoc(null)} />
    </div>
  );
}
