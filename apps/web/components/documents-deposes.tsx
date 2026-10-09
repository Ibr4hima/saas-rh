'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type DragEvent } from 'react';
import { createPortal } from 'react-dom';
import type { DocumentRequestView, FichierRemisView } from '@teranga/contracts';
import { documentDemande, FICHIERS_REMIS_MAX, MAX_FICHIER_REMIS_BYTES } from '@teranga/contracts';
import { cn } from '@teranga/ui';
import { api, ApiError, apiUrl } from '../lib/api';
import { lireEnBase64, taille } from '../lib/fichiers';
import type { ViewableDoc } from './doc-viewer';
import { FenetreDocument } from './fenetre-document';
import { Icon } from './icons';

/** Un PDF : celui que le poste annonce, ou à défaut son extension. */
const estUnPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

/** « Attestation Awa.pdf » → « Attestation Awa » : on nomme le document, pas son format. */
function sansExtension(nom: string): string {
  return nom.replace(/\.pdf$/i, '');
}

/** Un nom trop long se coupe avant l'extension, qui dit ce qu'est le fichier. */
function nomDuFichier(nom: string): string {
  if (nom.length <= 200) return nom;
  const point = nom.lastIndexOf('.');
  const ext = point > 0 ? nom.slice(point) : '';
  return nom.slice(0, 200 - ext.length) + ext;
}

/**
 * Les documents remis en ligne d'une demande : qui la traite y dépose le
 * PDF (« Joindre », ou en y glissant le fichier), l'ouvre pour vérifier ce
 * qui part, le renomme, retire un mauvais fichier. Chaque geste part aussitôt
 * au serveur : rien ne se perd si la fenêtre se ferme.
 *
 * `lot` : une demande parmi d'autres, en carte, avec le nom de l'agent. Sinon,
 * la demande seule : ses fichiers, puis la zone où les déposer.
 * `attendu` : le dépôt est ce qu'attend la demande pour partir ; tant
 * qu'elle n'a aucun document, l'appel à déposer est orange.
 */
export function DocumentsDeposes({
  demande: r,
  lot = false,
  attendu = false,
  onErreur,
}: {
  demande: DocumentRequestView;
  lot?: boolean;
  attendu?: boolean;
  onErreur: (texte: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const [survol, setSurvol] = useState(false);
  const [apercu, setApercu] = useState<ViewableDoc | null>(null);

  // Une clé commune : la fenêtre qui les contient attend la fin des envois.
  const deposer = useMutation({
    mutationKey: ['documents-deposes'],
    mutationFn: async (fichiers: File[]) => {
      if (r.fichiers.length + fichiers.length > FICHIERS_REMIS_MAX) {
        throw new Error(
          `Au plus ${FICHIERS_REMIS_MAX} fichiers par demande : regroupez les pages dans un seul PDF.`,
        );
      }
      for (const f of fichiers) {
        if (!estUnPdf(f)) throw new Error(`« ${f.name} » n’est pas un PDF.`);
        if (f.size === 0 || f.size > MAX_FICHIER_REMIS_BYTES) {
          throw new Error(`« ${f.name} » dépasse ${taille(MAX_FICHIER_REMIS_BYTES)}.`);
        }
      }
      for (const f of fichiers) {
        await api(`/document-requests/${r.id}/fichiers`, {
          method: 'POST',
          body: {
            filename: nomDuFichier(f.name),
            contentType: 'application/pdf',
            contentBase64: await lireEnBase64(f),
          },
        });
      }
    },
    onSuccess: () => onErreur(null),
    onError: (err) => onErreur(err instanceof Error ? err.message : 'Envoi impossible.'),
    // Le geste ne se termine qu'une fois la liste relue : le fichier apparaît
    // au moment où « Envoi… » disparaît.
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['document-requests'] }),
  });

  const choisir = (liste: FileList | null | undefined) => {
    const fichiers = [...(liste ?? [])];
    if (fichiers.length > 0) deposer.mutate(fichiers);
  };
  const glisser = {
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      setSurvol(true);
    },
    onDragLeave: () => setSurvol(false),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setSurvol(false);
      choisir(e.dataTransfer.files);
    },
  };
  const champ = (
    <input
      type="file"
      // Dans un lot, chaque « Joindre » dit pour qui il dépose.
      aria-label={lot ? `Joindre un document pour ${r.employeeName}` : undefined}
      multiple
      accept=".pdf,application/pdf"
      className="sr-only"
      onChange={(e) => {
        choisir(e.target.files);
        e.currentTarget.value = '';
      }}
    />
  );
  const enAttente = attendu && r.fichiers.length === 0;

  // Prête et sans point de retrait, la demande garde au moins un document :
  // on dépose d'abord le bon, puis on retire le mauvais.
  const dernierGarde = r.status === 'ready' && !r.pickupContact && r.fichiers.length <= 1;
  const liste =
    r.fichiers.length > 0 ? (
      <ul className="flex flex-col gap-1.5">
        {r.fichiers.map((f) => (
          <LigneDuFichier
            key={f.id}
            demande={r}
            fichier={f}
            dernierGarde={dernierGarde}
            onApercu={() =>
              setApercu({
                url: apiUrl(`/document-requests/${r.id}/fichiers/${f.id}`),
                filename: f.filename,
                contentType: f.contentType,
              })
            }
            onErreur={onErreur}
          />
        ))}
      </ul>
    ) : null;

  // L'aperçu s'ouvre AU-DESSUS de la fenêtre qui contient la liste : rendu
  // dans le corps de la page, il n'est pas rogné par elle.
  const fenetre =
    apercu && typeof document !== 'undefined'
      ? createPortal(
          <FenetreDocument
            doc={apercu}
            onClose={() => setApercu(null)}
            sousTitre={`${r.employeeName} · ${r.docTypes
              .map((d) => documentDemande(d, r.bulletin))
              .join(' · ')}`}
          />,
          document.body,
        )
      : null;

  if (!lot) {
    return (
      <div className="flex flex-col gap-3">
        {liste}
        <label
          {...glisser}
          aria-disabled={deposer.isPending}
          className={cn(
            'flex cursor-pointer flex-col items-center gap-2 rounded-[14px] border-[1.5px] border-dashed px-6 py-6 text-center transition-colors duration-150 focus-within:ring-2 focus-within:ring-primary/40',
            survol
              ? 'border-primary bg-primary/[0.05]'
              : enAttente
                ? 'border-badge-orange-line bg-surface-raised hover:bg-accent-soft'
                : 'border-line bg-surface-raised hover:border-primary/45 hover:bg-primary/[0.03]',
            deposer.isPending && 'pointer-events-none opacity-60',
          )}
        >
          {champ}
          <span
            className={cn(
              'flex size-10 items-center justify-center rounded-full',
              enAttente && !survol
                ? 'bg-accent-soft text-badge-orange-ink'
                : 'bg-primary-soft text-primary',
            )}
          >
            <Icon name="upload_file" size={20} />
          </span>
          <span className="text-[12.5px] text-ink">
            {deposer.isPending ? (
              'Envoi…'
            ) : (
              <>
                Glissez le PDF ici, ou{' '}
                <span className="font-semibold text-primary underline-offset-2 hover:underline">
                  parcourez
                </span>
              </>
            )}
          </span>
          <span className="text-[11.5px] text-ink-muted">
            PDF · {taille(MAX_FICHIER_REMIS_BYTES)} maximum
          </span>
        </label>
        {fenetre}
      </div>
    );
  }

  return (
    <div
      {...glisser}
      className={cn(
        'rounded-[14px] border px-3.5 py-3 transition-colors duration-150',
        survol ? 'border-primary bg-primary/[0.05]' : 'border-line-soft bg-surface',
      )}
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-bold text-ink-strong">{r.employeeName}</p>
          <p className="truncate text-[11.5px] text-ink-muted">
            {r.docTypes.map((d) => documentDemande(d, r.bulletin)).join(' · ')}
          </p>
        </div>
        <label
          aria-disabled={deposer.isPending}
          className={cn(
            'inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors focus-within:ring-2 focus-within:ring-primary/40',
            enAttente
              ? 'border-badge-orange-line text-badge-orange-ink hover:bg-accent-soft'
              : 'border-line text-primary hover:border-primary/40 hover:bg-primary/[0.07]',
            deposer.isPending && 'pointer-events-none opacity-60',
          )}
        >
          <Icon name="upload_file" size={15} />
          {deposer.isPending ? 'Envoi…' : 'Joindre'}
          {champ}
        </label>
      </div>
      {liste ? <div className="mt-2.5 border-t border-line-soft pt-2.5">{liste}</div> : null}
      {fenetre}
    </div>
  );
}

/**
 * Un document déposé. Un clic l'ouvre, pour voir ce qui part ; le crayon
 * le renomme, sur place : c'est le nom que l'agent verra et enregistrera.
 */
function LigneDuFichier({
  demande: r,
  fichier: f,
  dernierGarde,
  onApercu,
  onErreur,
}: {
  demande: DocumentRequestView;
  fichier: FichierRemisView;
  dernierGarde: boolean;
  onApercu: () => void;
  onErreur: (texte: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const [edition, setEdition] = useState(false);
  const [nom, setNom] = useState('');
  const rafraichir = () => queryClient.invalidateQueries({ queryKey: ['document-requests'] });

  const renommer = useMutation({
    mutationKey: ['documents-deposes'],
    mutationFn: (nouveau: string) =>
      api(`/document-requests/${r.id}/fichiers/${f.id}`, {
        method: 'PATCH',
        body: { filename: nouveau },
      }),
    onSuccess: () => {
      onErreur(null);
      setEdition(false);
    },
    onError: (err) => onErreur(err instanceof ApiError ? err.message : 'Renommage impossible.'),
    onSettled: rafraichir,
  });
  const retirer = useMutation({
    mutationKey: ['documents-deposes'],
    mutationFn: () => api(`/document-requests/${r.id}/fichiers/${f.id}`, { method: 'DELETE' }),
    onSuccess: () => onErreur(null),
    onError: (err) => onErreur(err instanceof ApiError ? err.message : 'Retrait impossible.'),
    onSettled: rafraichir,
  });

  const valider = () => {
    const net = nom.trim();
    if (!net || net === sansExtension(f.filename)) {
      setEdition(false);
      return;
    }
    renommer.mutate(net);
  };

  return (
    <li className="flex min-w-0 items-center gap-2.5">
      <button
        type="button"
        aria-label={`Ouvrir ${f.filename}`}
        onClick={onApercu}
        className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-primary-soft text-primary transition-colors hover:bg-primary/15"
      >
        <Icon name={f.contentType === 'application/pdf' ? 'picture_as_pdf' : 'image'} size={17} />
      </button>
      {edition ? (
        // Le nom se modifie sur place, comme au dépôt d'une pièce : Entrée
        // l'enregistre, Échap l'abandonne sans fermer la fenêtre.
        <div className="flex min-w-0 flex-1 items-center gap-1 border-b border-primary pb-0.5">
          <label htmlFor={`nom-${f.id}`} className="sr-only">
            Nom du document
          </label>
          <input
            id={`nom-${f.id}`}
            autoFocus
            autoComplete="off"
            value={nom}
            maxLength={120}
            disabled={renommer.isPending}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setNom(e.target.value)}
            onBlur={valider}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                valider();
              } else if (e.key === 'Escape') {
                e.stopPropagation();
                e.nativeEvent.stopImmediatePropagation();
                setEdition(false);
              }
            }}
            className="min-w-0 flex-1 bg-transparent text-[12.5px] font-semibold text-ink-strong outline-none disabled:opacity-60"
          />
          <Icon name="edit" size={14} className="shrink-0 text-ink-muted/70" />
        </div>
      ) : (
        <>
          <button
            type="button"
            title={f.filename}
            onClick={onApercu}
            className="min-w-0 truncate text-left text-[12.5px] font-semibold text-ink-strong hover:text-primary hover:underline"
          >
            {f.filename}
          </button>
          <button
            type="button"
            aria-label={`Renommer ${f.filename}`}
            onClick={() => {
              setNom(sansExtension(f.filename));
              setEdition(true);
            }}
            className="flex size-7 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-hover hover:text-primary"
          >
            <Icon name="edit" size={15} />
          </button>
          <span className="flex-1" />
        </>
      )}
      <span className="shrink-0 text-[11.5px] text-ink-muted tabular-nums">
        {taille(f.sizeBytes)}
      </span>
      <button
        type="button"
        aria-label={`Retirer ${f.filename}`}
        title={dernierGarde ? 'Déposez d’abord le bon fichier' : undefined}
        disabled={dernierGarde || retirer.isPending}
        onClick={() => retirer.mutate()}
        className="flex size-7 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-hover hover:text-danger disabled:pointer-events-none disabled:opacity-40"
      >
        <Icon name="close" size={16} />
      </button>
    </li>
  );
}
