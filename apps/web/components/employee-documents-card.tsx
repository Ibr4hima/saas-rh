'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import type { DocumentCategory, EmployeeDocumentView } from '@teranga/contracts';
import {
  aUneExpiration,
  DOCUMENT_CATEGORY_LABELS,
  documentCategorySchema,
  EMPLOYEE_DOCUMENT_TYPES,
  estUnique,
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

/** Aujourd'hui, au calendrier de l'agent : « 2026-10-02 ». */
function aujourdhui(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Le signe d'un fichier : un PDF — ou une image, sur les dépôts anciens. */
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
  pieceAttendue = null,
}: {
  employeeId: string;
  /** Le dossier de l'appelant : lui seul y dépose ses documents. */
  depot: boolean;
  /** Le titre d'identité de la fiche, que l'agent doit déposer — CNI ou passeport. */
  pieceAttendue?: 'cni' | 'passeport' | null;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [viewed, setViewed] = useState<ViewableDoc | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [depotOuvert, setDepotOuvert] = useState(false);
  // Le type proposé à l'ouverture : celui du titre attendu, le cas échéant.
  const [typeInitial, setTypeInitial] = useState<DocumentCategory | null>(null);
  // Le dépôt dont l'agent change le fichier, tant qu'il est en vérification.
  const [aRemplacer, setARemplacer] = useState<EmployeeDocumentView | null>(null);
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
  // Le titre de la fiche, tant qu'aucun n'est en vérification ni au dossier :
  // l'agent est tenu de le déposer — et la DCH le voit sur sa fiche.
  const manquante =
    !documents.isLoading &&
    pieceAttendue &&
    !pieces.some((d) => d.category === pieceAttendue && d.status !== 'rejected')
      ? pieceAttendue
      : null;

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
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setTypeInitial(null);
              setDepotOuvert(true);
            }}
          >
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
        ) : pieces.length === 0 && !manquante ? (
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
            {manquante && !depot ? (
              // Côté DCH : le constat, sans geste — c'est à l'agent de déposer.
              <li className="flex items-center gap-3.5 rounded-[12px] border border-dashed border-accent/40 bg-accent-soft/20 px-3.5 py-3">
                <span
                  aria-hidden
                  className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-accent-soft text-accent-text"
                >
                  <Icon name="upload_file" size={20} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold text-ink-strong">
                    {DOCUMENT_CATEGORY_LABELS[manquante]}
                  </span>
                  <span className="block truncate text-[11.5px] text-ink-muted">Obligatoire</span>
                </span>
                <span className="inline-flex items-center rounded-full bg-accent-soft/70 px-2.5 py-[3px] text-[11px] font-semibold text-accent-text ring-1 ring-accent/25 ring-inset">
                  {manquante === 'cni' ? 'Non déposée' : 'Non déposé'}
                </span>
              </li>
            ) : manquante ? (
              <li>
                <button
                  type="button"
                  onClick={() => {
                    setTypeInitial(manquante);
                    setDepotOuvert(true);
                  }}
                  className="group flex w-full items-center gap-3.5 rounded-[12px] border border-dashed border-accent/40 bg-accent-soft/20 px-3.5 py-3 text-left transition-colors duration-150 hover:border-accent/60 hover:bg-accent-soft/35 focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
                >
                  <span
                    aria-hidden
                    className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-accent-soft text-accent-text"
                  >
                    <Icon name="upload_file" size={20} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold text-ink-strong">
                      {DOCUMENT_CATEGORY_LABELS[manquante]}
                    </span>
                    <span className="block truncate text-[11.5px] text-ink-muted">Obligatoire</span>
                  </span>
                  <span className="inline-flex items-center rounded-full bg-accent-soft/70 px-2.5 py-[3px] text-[11px] font-semibold text-accent-text ring-1 ring-accent/25 ring-inset">
                    Uploader
                  </span>
                </button>
              </li>
            ) : null}
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
                      {/* Au téléphone, la ligne passe à la ligne : la date
                          d'expiration ne se coupe pas. */}
                      <span className="block truncate text-[11.5px] text-ink-muted max-sm:whitespace-normal">
                        {DOCUMENT_CATEGORY_LABELS[d.category]}
                        {depot
                          ? ''
                          : ` · ${d.uploadedByName}${d.uploadedBySide === 'hr' ? ' (DCH)' : ''}`}{' '}
                        · {formatDate(d.createdAt.slice(0, 10))}
                        {d.expiresOn ? ` · expire le ${formatDate(d.expiresOn)}` : ''}
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
                  ) : d.canReplace ? (
                    // En vérification : l'agent change le fichier, ou annule.
                    <div className="flex shrink-0 gap-1.5">
                      <Button size="sm" variant="secondary" onClick={() => setARemplacer(d)}>
                        Remplacer
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={remove.isPending && remove.variables === d.id}
                        onClick={() => remove.mutate(d.id)}
                      >
                        Annuler
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
          ouverte={depotOuvert || aRemplacer !== null}
          remplace={aRemplacer}
          typeInitial={typeInitial}
          // Un seul exemplaire en vérification : on change celui-là.
          enVerification={
            new Set(
              pieces
                .filter((d) => d.status === 'pending' && estUnique(d.category))
                .map((d) => d.category),
            )
          }
          onFermer={() => {
            setDepotOuvert(false);
            setTypeInitial(null);
            setARemplacer(null);
          }}
          onDepose={() => {
            setDepotOuvert(false);
            setTypeInitial(null);
            setARemplacer(null);
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
  contentType: string;
  contentBase64: string;
}

/** « CNI recto.verso.pdf » → « CNI recto.verso » : l'agent nomme le document, pas son format. */
function sansExtension(nom: string): string {
  const point = nom.lastIndexOf('.');
  return point > 0 ? nom.slice(0, point) : nom;
}

/**
 * Déposer un document : son type, puis le fichier — glissé ou choisi —, que
 * l'agent renomme s'il le veut avant de l'envoyer à la DCH. Une CNI, un
 * passeport : leur date d'expiration aussi. Ou remplacer le fichier d'un
 * dépôt encore en vérification : son type reste.
 */
function FenetreDepot({
  employeeId,
  ouverte,
  remplace,
  typeInitial,
  enVerification,
  onFermer,
  onDepose,
}: {
  employeeId: string;
  ouverte: boolean;
  remplace: EmployeeDocumentView | null;
  /** Le type déjà choisi à l'ouverture — le titre d'identité attendu. */
  typeInitial: DocumentCategory | null;
  /** Les types à exemplaire unique dont un dépôt attend déjà la vérification. */
  enVerification: ReadonlySet<DocumentCategory>;
  onFermer: () => void;
  onDepose: () => void;
}) {
  const id = useId();
  const [choisi, setType] = useState<DocumentCategory | ''>('');
  const [fichier, setFichier] = useState<FichierChoisi | null>(null);
  const [nom, setNom] = useState('');
  const [expiration, setExpiration] = useState<string | null>(null);
  const [survol, setSurvol] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const type = remplace?.category ?? (choisi || typeInitial || '');
  // Au remplacement, la date déjà donnée, que l'agent corrige s'il le faut.
  const expiresOn = expiration ?? remplace?.expiresOn ?? '';
  const demandeLaDate = type !== '' && aUneExpiration(type);

  const remettre = () => {
    setType('');
    setFichier(null);
    setNom('');
    setExpiration(null);
    setErreur(null);
  };

  const deposer = useMutation({
    mutationFn: () => {
      const label = nom.trim();
      const corps = {
        label,
        filename: `${label}.pdf`,
        contentType: fichier!.contentType,
        contentBase64: fichier!.contentBase64,
        ...(demandeLaDate ? { expiresOn } : {}),
      };
      return remplace
        ? api(`/employee-documents/${remplace.id}`, { method: 'PUT', body: corps })
        : api(`/employees/${employeeId}/documents`, {
            method: 'POST',
            body: { category: type, ...corps },
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
      return setErreur('Seul le PDF est accepté.');
    }
    if (f.size === 0 || f.size > MAX_EMPLOYEE_DOCUMENT_BYTES) {
      return setErreur('Le fichier doit faire entre 1 octet et 5 Mo.');
    }
    const reader = new FileReader();
    reader.onload = () => {
      setFichier({
        contentType: f.type,
        contentBase64: String(reader.result).split(',')[1] ?? '',
      });
      // Le nom du fichier, proposé tel quel : l'agent le change s'il veut.
      setNom(sansExtension(f.name).slice(0, 120));
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
      title={remplace ? 'Remplacer le document' : 'Déposer un document'}
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
            disabled={!type || !fichier || !nom.trim() || (demandeLaDate && !expiresOn)}
            loading={deposer.isPending}
            onClick={() => deposer.mutate()}
          >
            {remplace ? 'Remplacer' : 'Déposer'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <Field label="Type de document" htmlFor={`${id}-type`}>
          <Select
            id={`${id}-type`}
            value={type}
            disabled={remplace !== null}
            onChange={(e) => setType(e.target.value as DocumentCategory)}
          >
            <option value="" disabled hidden>
              Choisir un type
            </option>
            {(remplace ? [remplace.category] : documentCategorySchema.options).map((c) => (
              <option key={c} value={c} disabled={!remplace && enVerification.has(c)}>
                {DOCUMENT_CATEGORY_LABELS[c]}
                {!remplace && enVerification.has(c) ? ' — en vérification' : ''}
              </option>
            ))}
          </Select>
        </Field>

        {demandeLaDate ? (
          <Field label="Date d’expiration" htmlFor={`${id}-expiration`} required>
            <Input
              id={`${id}-expiration`}
              type="date"
              min={aujourdhui()}
              value={expiresOn}
              onChange={(e) => setExpiration(e.target.value)}
            />
          </Field>
        ) : null}

        {fichier ? (
          // Le fichier choisi : son nom se modifie sur place — c'est le nom
          // sous lequel il entre au dossier.
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
                <Icon name="edit" size={15} className="shrink-0 text-ink-muted/70" />
              </div>
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
              accept=".pdf,application/pdf"
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
            <span className="text-[11.5px] text-ink-muted">PDF · 5 Mo maximum</span>
          </label>
        )}
      </div>
    </Modal>
  );
}
