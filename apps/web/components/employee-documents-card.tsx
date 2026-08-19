'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { DocumentCategory, EmployeeDocumentView } from '@teranga/contracts';
import {
  DOCUMENT_CATEGORY_LABELS,
  EMPLOYEE_DOCUMENT_TYPES,
  MAX_EMPLOYEE_DOCUMENT_BYTES,
} from '@teranga/contracts';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Select,
  Skeleton,
} from '@teranga/ui';
import { api, ApiError, apiUrl } from '../lib/api';
import { formatDate } from '../lib/hooks';
import { DocViewer, type ViewableDoc } from './doc-viewer';

const STATUS_LABELS: Record<string, string> = {
  pending: 'À valider',
  approved: 'Au dossier',
  rejected: 'Rejeté',
};
const STATUS_TONES: Record<string, 'warning' | 'success' | 'danger'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
};

/**
 * Pièces justificatives d'un dossier : dépôt (par l'employé ou la RH),
 * validation croisée par la contrepartie, aperçu dans la page.
 * Utilisée telle quelle sur la fiche (RH) et sur /moi/documents (employé).
 */
export function EmployeeDocumentsCard({ employeeId }: { employeeId: string }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [viewed, setViewed] = useState<ViewableDoc | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectComment, setRejectComment] = useState('');

  // Dépôt
  const [category, setCategory] = useState<DocumentCategory>('piece_identite');
  const [label, setLabel] = useState('');
  const [file, setFile] = useState<{
    filename: string;
    contentType: string;
    contentBase64: string;
  } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const documents = useQuery({
    queryKey: ['employee-documents', employeeId],
    queryFn: () => api<EmployeeDocumentView[]>(`/employees/${employeeId}/documents`),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['employee-documents', employeeId] });
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };

  const upload = useMutation({
    mutationFn: () =>
      api(`/employees/${employeeId}/documents`, {
        method: 'POST',
        body: { category, label, ...file },
      }),
    onSuccess: () => {
      setLabel('');
      setFile(null);
      setError(null);
      invalidate();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Dépôt impossible.'),
  });

  const review = useMutation({
    mutationFn: (input: { id: string; decision: 'approved' | 'rejected'; comment?: string }) =>
      api(`/employee-documents/${input.id}/review`, {
        method: 'POST',
        body: { decision: input.decision, comment: input.comment },
      }),
    onSuccess: () => {
      setRejectingId(null);
      setRejectComment('');
      setError(null);
      invalidate();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Action impossible.'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/employee-documents/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Suppression impossible.'),
  });

  const pickFile = (f: File | null) => {
    setFileError(null);
    setFile(null); // toute sélection invalide doit désarmer « Déposer »
    if (!f) return;
    if (!(EMPLOYEE_DOCUMENT_TYPES as readonly string[]).includes(f.type)) {
      return setFileError('Formats acceptés : PDF, JPG ou PNG.');
    }
    if (f.size === 0 || f.size > MAX_EMPLOYEE_DOCUMENT_BYTES) {
      return setFileError('Le fichier doit faire entre 1 octet et 5 Mo.');
    }
    const reader = new FileReader();
    reader.onload = () =>
      setFile({
        filename: f.name,
        contentType: f.type,
        contentBase64: String(reader.result).split(',')[1] ?? '',
      });
    reader.onerror = () => setFileError('Impossible de lire ce fichier.');
    reader.readAsDataURL(f);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pièces justificatives</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {documents.isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : documents.isError ? (
          <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
            Chargement des pièces impossible — rechargez la page.
          </p>
        ) : (documents.data ?? []).length === 0 ? (
          <p className="text-sm text-ink-muted">
            Aucune pièce pour le moment — pièce d&apos;identité, diplômes et attestations sont
            attendus au dossier.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {documents.data!.map((d) => (
              <li key={d.id} className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <button
                    type="button"
                    onClick={() =>
                      setViewed({
                        url: apiUrl(`/employee-documents/${d.id}/content`),
                        filename: d.filename,
                        contentType: d.contentType,
                      })
                    }
                    className="min-w-40 flex-1 basis-48 text-left"
                  >
                    <p className="truncate text-sm font-medium text-ink-strong hover:underline">
                      {d.label}
                    </p>
                    <p className="text-xs text-ink-muted">
                      {DOCUMENT_CATEGORY_LABELS[d.category]} · déposé par {d.uploadedByName}
                      {d.uploadedBySide === 'hr' ? ' (RH)' : ''} ·{' '}
                      {formatDate(d.createdAt.slice(0, 10))}
                    </p>
                    {d.status === 'rejected' && d.reviewComment ? (
                      <p className="text-xs text-danger">Motif : {d.reviewComment}</p>
                    ) : null}
                  </button>
                  <Badge tone={STATUS_TONES[d.status] ?? 'warning'}>
                    {STATUS_LABELS[d.status] ?? d.status}
                  </Badge>
                  {d.canReview ? (
                    <div className="flex shrink-0 gap-1.5">
                      <Button
                        size="sm"
                        onClick={() => review.mutate({ id: d.id, decision: 'approved' })}
                        loading={review.isPending}
                      >
                        Valider
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => setRejectingId(rejectingId === d.id ? null : d.id)}
                      >
                        Rejeter
                      </Button>
                    </div>
                  ) : d.canDelete && d.status !== 'pending' ? (
                    <Button size="sm" variant="ghost" onClick={() => remove.mutate(d.id)}>
                      Retirer
                    </Button>
                  ) : null}
                </div>
                {rejectingId === d.id ? (
                  <div className="flex items-center gap-2 pl-2">
                    <Input
                      placeholder="Motif du rejet (ex : document illisible)"
                      value={rejectComment}
                      onChange={(e) => setRejectComment(e.target.value)}
                      className="h-8 flex-1"
                    />
                    <Button
                      size="sm"
                      variant="danger"
                      loading={review.isPending}
                      onClick={() =>
                        review.mutate({
                          id: d.id,
                          decision: 'rejected',
                          comment: rejectComment.trim() || undefined,
                        })
                      }
                    >
                      Confirmer le rejet
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {/* Dépôt */}
        <div className="flex flex-col gap-3 border-t border-line-soft pt-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Type de pièce" htmlFor={`doc-cat-${employeeId}`}>
              <Select
                id={`doc-cat-${employeeId}`}
                value={category}
                onChange={(e) => setCategory(e.target.value as DocumentCategory)}
              >
                {Object.entries(DOCUMENT_CATEGORY_LABELS).map(([value, text]) => (
                  <option key={value} value={value}>
                    {text}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Libellé" htmlFor={`doc-label-${employeeId}`}>
              <Input
                id={`doc-label-${employeeId}`}
                placeholder="Ex : CNI, Master 2 Finance — UCAD…"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </Field>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
              onChange={(e) => {
                pickFile(e.target.files?.[0] ?? null);
                e.currentTarget.value = '';
              }}
              className="block w-full text-sm text-ink-muted file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-primary-soft file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary hover:file:opacity-90"
            />
            <Button
              className="sm:shrink-0"
              disabled={!label.trim() || !file}
              loading={upload.isPending}
              onClick={() => upload.mutate()}
            >
              Déposer
            </Button>
          </div>
          <p className="text-xs text-ink-muted">
            PDF, JPG ou PNG — 5 Mo max. La contrepartie (RH ou employé) vérifie la conformité puis
            valide : le document rejoint alors le dossier.
          </p>
          {fileError ? <p className="text-xs text-danger">{fileError}</p> : null}
          {error ? (
            <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
          ) : null}
        </div>
      </CardContent>

      <DocViewer doc={viewed} onClose={() => setViewed(null)} />
    </Card>
  );
}
