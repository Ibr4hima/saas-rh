'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import type { DocumentCategory, EmployeeDocumentView } from '@teranga/contracts';
import {
  DOCUMENT_CATEGORY_LABELS,
  documentCategorySchema,
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
  cn,
  Field,
  Input,
  Select,
  Skeleton,
} from '@teranga/ui';
import { api, ApiError, apiUrl } from '../lib/api';
import { Icon } from './icons';
import { formatDate } from '../lib/hooks';
import { type ViewableDoc } from './doc-viewer';
import { FenetreDocument } from './fenetre-document';
import { Modal } from './modal';

const STATUS_LABELS: Record<string, string> = {
  pending: 'En vérification',
  approved: 'Au dossier',
  rejected: 'Rejeté',
};
const STATUS_TONES: Record<string, 'warning' | 'success' | 'danger'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
};

/** « 245 Ko », « 1,2 Mo ». */
function poids(octets: number): string {
  if (octets < 1024 * 1024) return `${Math.max(1, Math.round(octets / 1024))} Ko`;
  return `${(octets / (1024 * 1024)).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`;
}

/** Le signe d'un fichier : un PDF, ou une image. */
function SigneFichier({ contentType, grand = false }: { contentType: string; grand?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center rounded-[10px] bg-primary-soft text-primary',
        grand ? 'size-11' : 'size-10',
      )}
    >
      <Icon name={contentType === 'application/pdf' ? 'picture_as_pdf' : 'image'} size={20} />
    </span>
  );
}

/**
 * Les documents officiels d'un dossier : l'agent dépose les siens, la DCH
 * les vérifie (son directeur, ou le membre à qui il confie les pièces) — un
 * document ne rejoint le dossier qu'une fois validé, jamais par qui l'a
 * déposé. Aperçu dans la page. Sur « Joindre un document » (l'agent, qui
 * dépose) et sur la fiche (la DCH, qui vérifie ; elle ne dépose pas pour
 * l'agent).
 */
export function EmployeeDocumentsCard({
  employeeId,
  depot,
}: {
  employeeId: string;
  /** Le dossier de l'appelant : lui seul y dépose ses documents. */
  depot: boolean;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [viewed, setViewed] = useState<ViewableDoc | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [depotOuvert, setDepotOuvert] = useState(false);
  const [rejectComment, setRejectComment] = useState('');

  const documents = useQuery({
    queryKey: ['employee-documents', employeeId],
    queryFn: () => api<EmployeeDocumentView[]>(`/employees/${employeeId}/documents`),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['employee-documents', employeeId] });
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };

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

  const pieces = documents.data ?? [];
  // Ce qui attend MA décision, pas ce qui attend une décision : sur le portail
  // de l'agent, ses propres dépôts en attente sont attendus par la DCH — les
  // compter ici lui réclamait un geste qui ne lui revient pas.
  const aValider = pieces.filter((d) => d.canReview).length;

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <CardTitle>Documents officiels</CardTitle>
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
              {aValider} à vérifier
            </span>
          ) : null}
        </div>
        {depot ? (
          <Button variant="secondary" size="sm" onClick={() => setDepotOuvert(true)}>
            <Icon name="upload_file" size={15} />
            Déposer un document
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {documents.isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : documents.isError ? (
          <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
            Chargement des documents impossible — rechargez la page.
          </p>
        ) : pieces.length === 0 ? (
          depot ? (
            // Vide, la carte est elle-même l'invitation à déposer.
            <button
              type="button"
              onClick={() => setDepotOuvert(true)}
              className="group flex w-full flex-col items-center gap-3 rounded-[14px] border border-dashed border-line bg-surface-raised px-6 py-8 text-center transition-colors duration-150 hover:border-primary/45 hover:bg-primary/[0.03] focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
            >
              <span className="flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary transition-transform duration-200 group-hover:-translate-y-0.5">
                <Icon name="upload_file" size={22} />
              </span>
              <span className="max-w-md text-[12.5px] leading-relaxed text-ink-muted">
                Uploader vos documents officiels. La DCH procédera à la vérification.
              </span>
            </button>
          ) : (
            <p className="rounded-[11px] border border-dashed border-line bg-surface-raised px-4 py-5 text-center text-[12.5px] text-ink-muted">
              Aucun document au dossier.
            </p>
          )
        ) : (
          <ul className="flex flex-col gap-2">
            {pieces.map((d) => (
              <li
                key={d.id}
                className="rounded-[12px] border border-line-soft bg-surface px-3.5 py-3 transition-colors duration-150 hover:border-card-line-hover"
              >
                <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5">
                  <button
                    type="button"
                    onClick={() =>
                      setViewed({
                        url: apiUrl(`/employee-documents/${d.id}/content`),
                        filename: d.filename,
                        contentType: d.contentType,
                        titre: d.label,
                      })
                    }
                    className="group flex min-w-48 flex-1 basis-56 items-center gap-3.5 text-left"
                  >
                    <SigneFichier contentType={d.contentType} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-bold text-ink-strong group-hover:text-primary">
                        {d.label}
                      </span>
                      <span className="block truncate text-[11.5px] text-ink-muted">
                        {DOCUMENT_CATEGORY_LABELS[d.category]}
                        {depot
                          ? ''
                          : ` · ${d.uploadedByName}${d.uploadedBySide === 'hr' ? ' (DCH)' : ''}`}{' '}
                        · {formatDate(d.createdAt.slice(0, 10))} · {poids(d.sizeBytes)}
                      </span>
                    </span>
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
                  <p className="mt-2.5 rounded-[8px] bg-danger-soft px-2.5 py-1.5 text-[11.5px] text-danger">
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

        {error ? (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
      </CardContent>

      {depot ? (
        <FenetreDepot
          employeeId={employeeId}
          ouverte={depotOuvert}
          onFermer={() => setDepotOuvert(false)}
          onDepose={() => {
            setDepotOuvert(false);
            invalidate();
          }}
        />
      ) : null}
      <FenetreDocument doc={viewed} onClose={() => setViewed(null)} />
    </Card>
  );
}

// ———————————————————————————— le dépôt

interface FichierChoisi {
  /** « .pdf », « .jpg »… ; l'agent renomme le document, pas son format. */
  extension: string;
  contentType: string;
  contentBase64: string;
  taille: number;
}

/** « CNI recto.verso.pdf » → [« CNI recto.verso », « .pdf »]. */
function separerExtension(nom: string): [string, string] {
  const point = nom.lastIndexOf('.');
  return point > 0 ? [nom.slice(0, point), nom.slice(point)] : [nom, ''];
}

/**
 * Déposer un document : son type, puis le fichier — glissé ou choisi —, que
 * l'agent renomme s'il le veut avant de l'envoyer à la DCH.
 */
function FenetreDepot({
  employeeId,
  ouverte,
  onFermer,
  onDepose,
}: {
  employeeId: string;
  ouverte: boolean;
  onFermer: () => void;
  onDepose: () => void;
}) {
  const id = useId();
  const [type, setType] = useState<DocumentCategory | ''>('');
  const [fichier, setFichier] = useState<FichierChoisi | null>(null);
  const [nom, setNom] = useState('');
  const [survol, setSurvol] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const remettre = () => {
    setType('');
    setFichier(null);
    setNom('');
    setErreur(null);
  };

  const deposer = useMutation({
    mutationFn: () => {
      const label = nom.trim();
      return api(`/employees/${employeeId}/documents`, {
        method: 'POST',
        body: {
          category: type,
          label,
          filename: `${label}${fichier!.extension}`,
          contentType: fichier!.contentType,
          contentBase64: fichier!.contentBase64,
        },
      });
    },
    onSuccess: () => {
      remettre();
      onDepose();
    },
    onError: (err) => setErreur(err instanceof ApiError ? err.message : 'Dépôt impossible.'),
  });

  const choisir = (f: File | null | undefined) => {
    setErreur(null);
    if (!f) return;
    if (!(EMPLOYEE_DOCUMENT_TYPES as readonly string[]).includes(f.type)) {
      return setErreur('Formats acceptés : PDF, JPG ou PNG.');
    }
    if (f.size === 0 || f.size > MAX_EMPLOYEE_DOCUMENT_BYTES) {
      return setErreur('Le fichier doit faire entre 1 octet et 5 Mo.');
    }
    const reader = new FileReader();
    reader.onload = () => {
      const [base, extension] = separerExtension(f.name);
      setFichier({
        extension,
        contentType: f.type,
        contentBase64: String(reader.result).split(',')[1] ?? '',
        taille: f.size,
      });
      // Le nom du fichier, proposé tel quel : l'agent le change s'il veut.
      setNom(base.slice(0, 120));
    };
    reader.onerror = () => setErreur('Impossible de lire ce fichier.');
    reader.readAsDataURL(f);
  };

  const fermer = () => {
    remettre();
    onFermer();
  };

  return (
    <Modal
      open={ouverte}
      onClose={fermer}
      title="Déposer un document"
      maxWidth="max-w-lg"
      footer={
        <>
          {erreur ? (
            <p role="alert" className="min-w-0 flex-1 text-[12px] font-semibold text-danger">
              {erreur}
            </p>
          ) : null}
          <Button variant="secondary" onClick={fermer}>
            Annuler
          </Button>
          <Button
            disabled={!type || !fichier || !nom.trim()}
            loading={deposer.isPending}
            onClick={() => deposer.mutate()}
          >
            Déposer
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <Field label="Type de document" htmlFor={`${id}-type`}>
          <Select
            id={`${id}-type`}
            value={type}
            onChange={(e) => setType(e.target.value as DocumentCategory)}
          >
            <option value="" disabled hidden>
              Choisir un type
            </option>
            {documentCategorySchema.options.map((c) => (
              <option key={c} value={c}>
                {DOCUMENT_CATEGORY_LABELS[c]}
              </option>
            ))}
          </Select>
        </Field>

        {fichier ? (
          // Le fichier choisi : son nom se modifie sur place — c'est le nom
          // sous lequel il entre au dossier ; son format, lui, reste.
          <div className="flex items-center gap-3.5 rounded-[14px] border border-line bg-surface px-3.5 py-3">
            <SigneFichier contentType={fichier.contentType} grand />
            <div className="min-w-0 flex-1">
              <label htmlFor={`${id}-nom`} className="sr-only">
                Nom du document
              </label>
              <div className="flex items-center gap-1 border-b border-line pb-1 transition-colors focus-within:border-primary">
                <input
                  id={`${id}-nom`}
                  value={nom}
                  maxLength={120}
                  onChange={(e) => setNom(e.target.value)}
                  className="min-w-0 flex-1 bg-transparent text-[13px] font-semibold text-ink-strong outline-none placeholder:text-ink-muted/60"
                  placeholder="Nom du document"
                />
                <span className="shrink-0 text-[12.5px] text-ink-muted">{fichier.extension}</span>
                <Icon name="edit" size={15} className="shrink-0 text-ink-muted/70" />
              </div>
              <p className="mt-1 text-[11px] text-ink-muted">{poids(fichier.taille)}</p>
            </div>
            <button
              type="button"
              aria-label="Retirer le fichier"
              onClick={() => {
                setFichier(null);
                setNom('');
              }}
              className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-hover hover:text-danger"
            >
              <Icon name="close" size={18} />
            </button>
          </div>
        ) : (
          // Le sélecteur du navigateur annonce « Aucun fichier choisi » dans
          // sa propre langue et ne dit ni le format ni le poids permis : on
          // l'habille, et on accepte qu'on y glisse le fichier.
          <label
            htmlFor={`${id}-fichier`}
            onDragOver={(e) => {
              e.preventDefault();
              setSurvol(true);
            }}
            onDragLeave={() => setSurvol(false)}
            onDrop={(e) => {
              e.preventDefault();
              setSurvol(false);
              choisir(e.dataTransfer.files?.[0]);
            }}
            className={cn(
              'flex cursor-pointer flex-col items-center gap-2.5 rounded-[14px] border-[1.5px] border-dashed px-6 py-8 text-center transition-colors duration-150 focus-within:ring-2 focus-within:ring-primary/40',
              survol
                ? 'border-primary bg-primary/[0.05]'
                : 'border-line bg-surface-raised hover:border-primary/45 hover:bg-primary/[0.03]',
            )}
          >
            <input
              id={`${id}-fichier`}
              type="file"
              className="sr-only"
              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
              onChange={(e) => {
                choisir(e.target.files?.[0]);
                e.currentTarget.value = '';
              }}
            />
            <span className="flex size-11 items-center justify-center rounded-full bg-primary-soft text-primary">
              <Icon name="upload_file" size={21} />
            </span>
            <span className="text-[12.5px] text-ink">
              Glissez votre fichier ici, ou{' '}
              <span className="font-semibold text-primary underline-offset-2 hover:underline">
                parcourez
              </span>
            </span>
            <span className="text-[11.5px] text-ink-muted">PDF, JPG ou PNG · 5 Mo maximum</span>
          </label>
        )}
      </div>
    </Modal>
  );
}
