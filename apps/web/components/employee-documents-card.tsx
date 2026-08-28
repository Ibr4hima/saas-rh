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
import { Icon } from './icons';
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
  // Le dépôt est replié : la carte sert d'abord à LIRE le dossier. Déplié en
  // permanence, le formulaire occupait la moitié de la hauteur pour un geste
  // qu'on fait deux fois par recrutement.
  const [depotOuvert, setDepotOuvert] = useState(false);
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
      setDepotOuvert(false);
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

  const pieces = documents.data ?? [];
  const aValider = pieces.filter((d) => d.status === 'pending').length;

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <CardTitle>Pièces justificatives</CardTitle>
          {pieces.length > 0 ? (
            <span
              className="rounded-full bg-primary/[0.09] px-2 py-px text-[10.5px] font-extrabold text-primary"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {pieces.length}
            </span>
          ) : null}
          {/* Ce qui attend une décision se dit dans le titre : c'est la seule
              chose de cette carte qui demande une action aujourd'hui. */}
          {aValider > 0 ? (
            <span className="rounded-full bg-warning-soft px-2 py-px text-[10.5px] font-bold text-warning">
              {aValider} à valider
            </span>
          ) : null}
        </div>
        <Button variant="secondary" size="sm" onClick={() => setDepotOuvert(!depotOuvert)}>
          {depotOuvert ? 'Fermer' : 'Déposer une pièce'}
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {documents.isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : documents.isError ? (
          <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
            Chargement des pièces impossible — rechargez la page.
          </p>
        ) : pieces.length === 0 ? (
          <p className="rounded-[11px] border border-dashed border-line bg-surface-raised px-4 py-5 text-center text-[12.5px] text-ink-muted">
            Aucune pièce au dossier — pièce d&apos;identité, diplômes et attestations sont attendus.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {pieces.map((d) => (
              <li
                key={d.id}
                className="rounded-[11px] border border-line-soft bg-surface-raised px-3.5 py-3"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <Icon name="description" size={18} className="shrink-0 text-primary/70" />
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
                    <p className="truncate text-[13px] font-bold text-ink-strong hover:underline">
                      {d.label}
                    </p>
                    <p className="truncate text-[11.5px] text-ink-muted">
                      {DOCUMENT_CATEGORY_LABELS[d.category]} · {d.uploadedByName}
                      {d.uploadedBySide === 'hr' ? ' (RH)' : ''} ·{' '}
                      {formatDate(d.createdAt.slice(0, 10))}
                    </p>
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
                        variant="secondary"
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
                {d.status === 'rejected' && d.reviewComment ? (
                  <p className="mt-2 rounded-[8px] bg-danger-soft px-2.5 py-1.5 text-[11.5px] text-danger">
                    Motif du rejet : {d.reviewComment}
                  </p>
                ) : null}
                {rejectingId === d.id ? (
                  <div className="mt-2.5 flex items-center gap-2">
                    <Input
                      placeholder="Motif du rejet (ex : document illisible)"
                      value={rejectComment}
                      onChange={(e) => setRejectComment(e.target.value)}
                      className="h-8 flex-1 text-[12.5px]"
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

        {/* Le dépôt, quand on le demande. */}
        {depotOuvert ? (
          <div className="flex flex-col gap-3 rounded-[11px] border border-line-soft bg-bg px-3.5 py-3.5">
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

            {/* Le sélecteur du navigateur annonce « Aucun fichier choisi »
                dans sa propre langue et ne dit ni le format attendu ni le
                poids permis tant qu'on n'a pas échoué. On l'habille. */}
            <label
              htmlFor={`doc-file-${employeeId}`}
              className="flex cursor-pointer items-center gap-3 rounded-[10px] border border-dashed border-line bg-surface px-3.5 py-3 transition-colors focus-within:ring-2 focus-within:ring-primary/40 hover:border-primary/50"
            >
              <input
                id={`doc-file-${employeeId}`}
                type="file"
                className="sr-only"
                accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                onChange={(e) => {
                  pickFile(e.target.files?.[0] ?? null);
                  e.currentTarget.value = '';
                }}
              />
              <Icon
                name={file ? 'check_circle' : 'upload_file'}
                size={19}
                className={file ? 'shrink-0 text-success' : 'shrink-0 text-primary'}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-bold text-ink-strong">
                  {file ? file.filename : 'Choisir un fichier'}
                </span>
                <span className="block text-[11.5px] text-ink-muted">
                  PDF, JPG ou PNG · 5 Mo maximum
                </span>
              </span>
              <span className="shrink-0 text-[12px] font-semibold text-primary">
                {file ? 'Remplacer' : 'Parcourir…'}
              </span>
            </label>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11.5px] text-ink-muted">
                La contrepartie vérifie la pièce, puis la valide : elle rejoint alors le dossier.
              </p>
              <Button
                disabled={!label.trim() || !file}
                loading={upload.isPending}
                onClick={() => upload.mutate()}
              >
                Déposer
              </Button>
            </div>
            {fileError ? (
              <p role="alert" className="text-[12px] font-semibold text-danger">
                {fileError}
              </p>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
      </CardContent>

      <DocViewer doc={viewed} onClose={() => setViewed(null)} />
    </Card>
  );
}
